import { Controller, Get } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TenantCtx, TenantContext } from '../common/decorators/tenant-context.decorator';
import { TenantProvider } from '../entities/tenant-provider.entity';
import { ModelPricingCacheService } from '../model-prices/model-pricing-cache.service';
import { CustomProviderService } from './custom-provider/custom-provider.service';
import type { DiscoveredModel } from '../model-discovery/model-fetcher';
import type { CustomProviderModel } from '../entities/custom-provider.entity';

export interface ConnectedModelEntry {
  /** Raw model name used for cross-provider grouping (built-in: native id, custom: raw name). */
  model_key: string;
  /** Routable model id (built-in: native id, custom: `custom:<uuid>/<name>`). */
  model_name: string;
  display_name: string | null;
  provider: string;
  /** Resolved name for `custom:<uuid>` providers; null for built-ins. */
  provider_display_name: string | null;
  auth_type: string;
  connection_id: string;
  connection_label: string;
  is_active: boolean;
  input_price_per_million: number | null;
  output_price_per_million: number | null;
  context_window: number | null;
  capability_reasoning: boolean;
  capability_code: boolean;
  quality_score: number;
  models_fetched_at: string | null;
}

export interface ConnectedModelsStats {
  total_entries: number;
  unique_models: number;
  providers_with_models: number;
  free_models: number;
  models_with_pricing: number;
  reasoning_models: number;
  code_models: number;
  cheapest_input_per_million: number | null;
  cheapest_output_per_million: number | null;
}

export interface ConnectedModelsResponse {
  models: ConnectedModelEntry[];
  stats: ConnectedModelsStats;
}

/**
 * Tenant-level provider management endpoints.
 * Returns all providers for the tenant (not scoped to a specific agent).
 *
 * CONFIG ONLY. This endpoint must stay cheap: it reads `tenant_providers`
 * (small) plus the in-memory pricing cache, and never touches `agent_messages`.
 * Usage stats (consumption_*, last_used_at, sparkline_7d) moved to
 * `GET /api/v1/providers/usage` (ProviderUsageController) so a config read no
 * longer triggers two multi-second scans over the 8GB messages table. The
 * frontend fetches the two halves independently and merges by
 * (provider, auth_type).
 */
@Controller('api/v1/providers')
export class TenantProvidersController {
  constructor(
    @InjectRepository(TenantProvider)
    private readonly providerRepo: Repository<TenantProvider>,
    private readonly pricingCache: ModelPricingCacheService,
    private readonly customProviderService: CustomProviderService,
  ) {}

  /**
   * List all tenant-level providers (config only). Groups by
   * (provider, auth_type) and returns the connected keys, model counts, and
   * display names. No usage aggregation — see ProviderUsageController.
   */
  @Get()
  async listProviders(@TenantCtx() ctx: TenantContext) {
    const tenantId = ctx.tenantId;
    const providers = tenantId
      ? await this.providerRepo.find({ where: { tenant_id: tenantId } })
      : [];

    // Group providers and build response
    const grouped = new Map<
      string,
      {
        provider: string;
        auth_type: string;
        connections: Array<{
          id: string;
          label: string;
          key_prefix: string | null;
          priority: number;
          connected_at: string;
          models_fetched_at: string | null;
          cached_model_count: number;
          is_active: boolean;
        }>;
        total_models: number;
      }
    >();

    for (const p of providers) {
      const key = `${p.provider}::${p.auth_type}`;
      const existing = grouped.get(key);
      const modelCount = Array.isArray(p.cached_models) ? p.cached_models.length : 0;

      if (existing) {
        existing.connections.push({
          id: p.id,
          label: p.label,
          key_prefix: p.key_prefix,
          priority: p.priority,
          connected_at: p.connected_at,
          models_fetched_at: p.models_fetched_at,
          cached_model_count: modelCount,
          is_active: p.is_active,
        });
        existing.total_models = Math.max(existing.total_models, modelCount);
      } else {
        grouped.set(key, {
          provider: p.provider,
          auth_type: p.auth_type,
          connections: [
            {
              id: p.id,
              label: p.label,
              key_prefix: p.key_prefix,
              priority: p.priority,
              connected_at: p.connected_at,
              models_fetched_at: p.models_fetched_at,
              cached_model_count: modelCount,
              is_active: p.is_active,
            },
          ],
          total_models: modelCount,
        });
      }
    }

    // Resolve custom provider display names (provider key = `custom:<uuid>`).
    const customProviders = tenantId ? await this.customProviderService.list(tenantId) : [];
    const customNameById = new Map(customProviders.map((cp) => [cp.id, cp.name]));

    const result = Array.from(grouped.values()).map((g) => ({
      provider: g.provider,
      auth_type: g.auth_type,
      display_name: g.provider.startsWith('custom:')
        ? (customNameById.get(g.provider.slice('custom:'.length)) ?? null)
        : null,
      connection_count: g.connections.length,
      connections: g.connections,
      total_models: g.total_models,
    }));

    // Count models per provider from the global pricing cache (covers all providers, connected or not)
    const allPricing = this.pricingCache.getAll();
    const modelCountByProvider = new Map<string, number>();
    for (const entry of allPricing) {
      const prov = entry.provider?.toLowerCase();
      if (prov) {
        modelCountByProvider.set(prov, (modelCountByProvider.get(prov) ?? 0) + 1);
      }
    }

    return {
      providers: result,
      model_counts: Object.fromEntries(modelCountByProvider),
    };
  }

  /**
   * List every connected model across all of the tenant's providers — one row
   * per (connection, model) pair so the same model exposed by two providers (or
   * two keys) shows up twice with its own price. CONFIG ONLY: reads
   * `tenant_providers.cached_models` + `custom_providers.models` and never
   * touches `agent_messages`.
   */
  @Get('models')
  async listConnectedModels(@TenantCtx() ctx: TenantContext): Promise<ConnectedModelsResponse> {
    const tenantId = ctx.tenantId;
    if (!tenantId) return { models: [], stats: emptyStats() };

    const providers = await this.providerRepo.find({ where: { tenant_id: tenantId } });
    const customProviders = await this.customProviderService.list(tenantId);

    // Index companion tenant_providers rows for custom providers so each custom
    // model can inherit auth_type / label / is_active from its backing row.
    const customProviderRowById = new Map<string, TenantProvider>();
    for (const p of providers) {
      if (p.provider.startsWith('custom:')) {
        customProviderRowById.set(p.provider.slice('custom:'.length), p);
      }
    }

    const entries: ConnectedModelEntry[] = [];

    // Built-in providers: project cached_models directly.
    for (const p of providers) {
      if (p.provider.startsWith('custom:')) continue;
      if (!Array.isArray(p.cached_models)) continue;
      for (const m of p.cached_models as DiscoveredModel[]) {
        entries.push(projectBuiltin(m, p));
      }
    }

    // Custom providers: project custom_providers.models, inheriting connection
    // metadata from the companion tenant_providers row.
    for (const cp of customProviders) {
      if (!Array.isArray(cp.models)) continue;
      const row = customProviderRowById.get(cp.id);
      const authType = row?.auth_type ?? 'api_key';
      const isActive = row?.is_active ?? true;
      const label = row?.label ?? 'Default';
      const connectionId = row?.id ?? cp.id;
      const modelsFetchedAt = row?.models_fetched_at ?? null;
      for (const cm of cp.models) {
        entries.push(
          projectCustom(
            cm,
            cp.id,
            cp.name,
            authType,
            isActive,
            label,
            connectionId,
            modelsFetchedAt,
          ),
        );
      }
    }

    return { models: entries, stats: computeStats(entries) };
  }
}

/** Project a built-in provider's cached DiscoveredModel into a flat entry. */
function projectBuiltin(m: DiscoveredModel, p: TenantProvider): ConnectedModelEntry {
  return {
    model_key: m.id,
    model_name: m.id,
    display_name: m.displayName ?? null,
    provider: p.provider,
    provider_display_name: null,
    auth_type: p.auth_type,
    connection_id: p.id,
    connection_label: p.label,
    is_active: p.is_active,
    input_price_per_million: perTokenToPerMillion(m.inputPricePerToken),
    output_price_per_million: perTokenToPerMillion(m.outputPricePerToken),
    context_window: m.contextWindow ?? null,
    capability_reasoning: m.capabilityReasoning ?? false,
    capability_code: m.capabilityCode ?? false,
    quality_score: m.qualityScore ?? 0,
    models_fetched_at: p.models_fetched_at,
  };
}

/** Project a custom provider model into a flat entry. */
function projectCustom(
  cm: CustomProviderModel,
  cpId: string,
  cpName: string,
  authType: string,
  isActive: boolean,
  label: string,
  connectionId: string,
  modelsFetchedAt: string | null,
): ConnectedModelEntry {
  const rawName = cm.model_name;
  return {
    model_key: rawName,
    model_name: CustomProviderService.modelKey(cpId, rawName),
    display_name: rawName,
    provider: CustomProviderService.providerKey(cpId),
    provider_display_name: cpName,
    auth_type: authType,
    connection_id: connectionId,
    connection_label: label,
    is_active: isActive,
    input_price_per_million: cm.input_price_per_million_tokens ?? null,
    output_price_per_million: cm.output_price_per_million_tokens ?? null,
    context_window: cm.context_window ?? null,
    capability_reasoning: false,
    capability_code: false,
    quality_score: 2,
    models_fetched_at: modelsFetchedAt,
  };
}

function perTokenToPerMillion(perToken: number | null | undefined): number | null {
  if (perToken == null) return null;
  return Number((perToken * 1_000_000).toFixed(6));
}

function emptyStats(): ConnectedModelsStats {
  return {
    total_entries: 0,
    unique_models: 0,
    providers_with_models: 0,
    free_models: 0,
    models_with_pricing: 0,
    reasoning_models: 0,
    code_models: 0,
    cheapest_input_per_million: null,
    cheapest_output_per_million: null,
  };
}

function computeStats(entries: ConnectedModelEntry[]): ConnectedModelsStats {
  const uniqueModels = new Set<string>();
  const providersWithModels = new Set<string>();
  let freeModels = 0;
  let modelsWithPricing = 0;
  let reasoningModels = 0;
  let codeModels = 0;
  let cheapestInput: number | null = null;
  let cheapestOutput: number | null = null;

  for (const e of entries) {
    uniqueModels.add(e.model_key);
    providersWithModels.add(e.provider);
    const isFree = e.input_price_per_million === 0 && e.output_price_per_million === 0;
    if (isFree) freeModels++;
    if (e.input_price_per_million != null) modelsWithPricing++;
    if (e.capability_reasoning) reasoningModels++;
    if (e.capability_code) codeModels++;
    // Free (zero-price) models are excluded from "cheapest" so a $0 model
    // doesn't crowd out a genuinely cheap paid one.
    if (!isFree && e.input_price_per_million != null) {
      if (cheapestInput == null || e.input_price_per_million < cheapestInput) {
        cheapestInput = e.input_price_per_million;
      }
    }
    if (!isFree && e.output_price_per_million != null) {
      if (cheapestOutput == null || e.output_price_per_million < cheapestOutput) {
        cheapestOutput = e.output_price_per_million;
      }
    }
  }

  return {
    total_entries: entries.length,
    unique_models: uniqueModels.size,
    providers_with_models: providersWithModels.size,
    free_models: freeModels,
    models_with_pricing: modelsWithPricing,
    reasoning_models: reasoningModels,
    code_models: codeModels,
    cheapest_input_per_million: cheapestInput,
    cheapest_output_per_million: cheapestOutput,
  };
}
