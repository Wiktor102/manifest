import { TenantProvidersController } from './tenant-providers.controller';
import type { TenantContext } from '../common/decorators/tenant-context.decorator';
import type { TenantProvider } from '../entities/tenant-provider.entity';

const makeProvider = (id: string, label: string): TenantProvider =>
  ({
    id,
    tenant_id: 'tenant-1',
    created_by_user_id: 'user-1',
    agent_id: null,
    provider: 'openai',
    auth_type: 'api_key',
    label,
    priority: 0,
    api_key_encrypted: 'encrypted-same-key',
    key_prefix: 'sk-test',
    region: null,
    is_active: true,
    connected_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    cached_models: [{ id: 'gpt-4o' }] as never,
    models_fetched_at: '2026-01-01T00:00:00.000Z',
  }) as TenantProvider;

describe('TenantProvidersController', () => {
  const ctx: TenantContext = { tenantId: 'tenant-1', userId: 'user-1' };

  it('lists multiple provider rows without deleting them', async () => {
    const providerRepo = {
      find: jest
        .fn()
        .mockResolvedValue([
          makeProvider('provider-agent-a', 'Default'),
          makeProvider('provider-agent-b', 'Default [provider-agent-b]'),
        ]),
      delete: jest.fn(),
    };
    const controller = new TenantProvidersController(
      providerRepo as never,
      { getAll: jest.fn().mockReturnValue([]) } as never,
      { list: jest.fn().mockResolvedValue([]) } as never,
    );

    const result = await controller.listProviders(ctx);

    expect(providerRepo.find).toHaveBeenCalledWith({ where: { tenant_id: 'tenant-1' } });
    expect(providerRepo.delete).not.toHaveBeenCalled();
    expect(result.providers).toEqual([
      expect.objectContaining({
        provider: 'openai',
        auth_type: 'api_key',
        connection_count: 2,
        connections: [
          expect.objectContaining({ id: 'provider-agent-a', label: 'Default' }),
          expect.objectContaining({
            id: 'provider-agent-b',
            label: 'Default [provider-agent-b]',
          }),
        ],
      }),
    ]);
  });

  it('does not expose usage fields (split out to /providers/usage)', async () => {
    const providerRepo = {
      find: jest.fn().mockResolvedValue([makeProvider('p1', 'Default')]),
    };
    const controller = new TenantProvidersController(
      providerRepo as never,
      { getAll: jest.fn().mockReturnValue([]) } as never,
      { list: jest.fn().mockResolvedValue([]) } as never,
    );

    const result = await controller.listProviders(ctx);

    // The slim config endpoint must NOT carry any usage stats.
    expect(result.providers[0]).not.toHaveProperty('consumption_tokens');
    expect(result.providers[0]).not.toHaveProperty('consumption_messages');
    expect(result.providers[0]).not.toHaveProperty('consumption_cost');
    expect(result.providers[0]).not.toHaveProperty('last_used_at');
    expect(result.providers[0]).not.toHaveProperty('sparkline_7d');
  });

  it('returns empty providers when tenant has none', async () => {
    const providerRepo = {
      find: jest.fn().mockResolvedValue([]),
    };
    const controller = new TenantProvidersController(
      providerRepo as never,
      { getAll: jest.fn().mockReturnValue([]) } as never,
      { list: jest.fn().mockResolvedValue([]) } as never,
    );

    const result = await controller.listProviders(ctx);

    expect(result.providers).toEqual([]);
    expect(result.model_counts).toEqual({});
  });

  it('returns empty providers when ctx has no tenant (fresh account)', async () => {
    const providerRepo = { find: jest.fn() };
    const customProviderService = { list: jest.fn() };
    const controller = new TenantProvidersController(
      providerRepo as never,
      { getAll: jest.fn().mockReturnValue([]) } as never,
      customProviderService as never,
    );

    const result = await controller.listProviders({ tenantId: null, userId: 'user-1' });

    expect(providerRepo.find).not.toHaveBeenCalled();
    expect(customProviderService.list).not.toHaveBeenCalled();
    expect(result.providers).toEqual([]);
    expect(result.model_counts).toEqual({});
  });

  it('groups providers by provider+auth_type key', async () => {
    const providerRepo = {
      find: jest.fn().mockResolvedValue([
        {
          ...makeProvider('p1', 'Key1'),
          provider: 'anthropic',
          auth_type: 'api_key',
          cached_models: [],
        },
        {
          ...makeProvider('p2', 'Key2'),
          provider: 'openai',
          auth_type: 'api_key',
          cached_models: [],
        },
        {
          ...makeProvider('p3', 'OpenAI Sub'),
          provider: 'openai',
          auth_type: 'subscription',
          cached_models: [],
        },
      ]),
    };
    const controller = new TenantProvidersController(
      providerRepo as never,
      { getAll: jest.fn().mockReturnValue([]) } as never,
      { list: jest.fn().mockResolvedValue([]) } as never,
    );

    const result = await controller.listProviders(ctx);

    expect(result.providers).toHaveLength(3);
    expect(
      result.providers.map(
        (p: { provider: string; auth_type: string }) => `${p.provider}::${p.auth_type}`,
      ),
    ).toEqual(
      expect.arrayContaining(['anthropic::api_key', 'openai::api_key', 'openai::subscription']),
    );
  });

  it('reports total_models as the max cached_models length across keys in a group', async () => {
    const providerRepo = {
      find: jest.fn().mockResolvedValue([
        { ...makeProvider('p1', 'Default'), cached_models: [{ id: 'a' }] as never },
        {
          ...makeProvider('p2', 'Second'),
          cached_models: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] as never,
        },
      ]),
    };
    const controller = new TenantProvidersController(
      providerRepo as never,
      { getAll: jest.fn().mockReturnValue([]) } as never,
      { list: jest.fn().mockResolvedValue([]) } as never,
    );

    const result = await controller.listProviders(ctx);

    expect(result.providers[0].total_models).toBe(3);
    expect(result.providers[0].connection_count).toBe(2);
  });

  it('treats a non-array cached_models as zero models', async () => {
    const providerRepo = {
      find: jest
        .fn()
        .mockResolvedValue([{ ...makeProvider('p1', 'Default'), cached_models: null as never }]),
    };
    const controller = new TenantProvidersController(
      providerRepo as never,
      { getAll: jest.fn().mockReturnValue([]) } as never,
      { list: jest.fn().mockResolvedValue([]) } as never,
    );

    const result = await controller.listProviders(ctx);

    expect(result.providers[0].total_models).toBe(0);
    expect(result.providers[0].connections[0].cached_model_count).toBe(0);
  });

  it('returns model_counts from pricing cache', async () => {
    const providerRepo = { find: jest.fn().mockResolvedValue([]) };
    const controller = new TenantProvidersController(
      providerRepo as never,
      {
        getAll: jest.fn().mockReturnValue([
          { provider: 'OpenAI', model_name: 'gpt-4o' },
          { provider: 'OpenAI', model_name: 'gpt-4o-mini' },
          { provider: 'Anthropic', model_name: 'claude-3-5-sonnet' },
          // Pricing rows with no provider are skipped.
          { provider: null, model_name: 'mystery' },
        ]),
      } as never,
      { list: jest.fn().mockResolvedValue([]) } as never,
    );

    const result = await controller.listProviders(ctx);

    expect(result.model_counts).toEqual({ openai: 2, anthropic: 1 });
  });

  it('resolves display_name for custom provider groups', async () => {
    const providerRepo = {
      find: jest
        .fn()
        .mockResolvedValue([{ ...makeProvider('p1', 'Default'), provider: 'custom:u-9' }]),
    };
    const customProviderService = {
      list: jest.fn().mockResolvedValue([{ id: 'u-9', name: 'MyLLM' }]),
    };
    const controller = new TenantProvidersController(
      providerRepo as never,
      { getAll: jest.fn().mockReturnValue([]) } as never,
      customProviderService as never,
    );

    const result = await controller.listProviders(ctx);

    expect(customProviderService.list).toHaveBeenCalledWith('tenant-1');
    expect(result.providers[0]).toMatchObject({
      provider: 'custom:u-9',
      display_name: 'MyLLM',
    });
  });

  it('returns null display_name for built-in groups and deleted custom providers', async () => {
    const providerRepo = {
      find: jest
        .fn()
        .mockResolvedValue([
          makeProvider('p1', 'Default'),
          { ...makeProvider('p2', 'Gone'), provider: 'custom:gone' },
        ]),
    };
    const controller = new TenantProvidersController(
      providerRepo as never,
      { getAll: jest.fn().mockReturnValue([]) } as never,
      { list: jest.fn().mockResolvedValue([]) } as never,
    );

    const result = await controller.listProviders(ctx);

    expect(
      result.providers.find((p: { provider: string }) => p.provider === 'openai')!.display_name,
    ).toBeNull();
    expect(
      result.providers.find((p: { provider: string }) => p.provider === 'custom:gone')!
        .display_name,
    ).toBeNull();
  });
});

describe('TenantProvidersController.listConnectedModels', () => {
  const ctx: TenantContext = { tenantId: 'tenant-1', userId: 'user-1' };

  const makeModel = (id: string, overrides: Partial<Record<string, unknown>> = {}): unknown => ({
    id,
    displayName: null,
    provider: 'openai',
    contextWindow: 128000,
    inputPricePerToken: 0.000005,
    outputPricePerToken: 0.000015,
    capabilityReasoning: false,
    capabilityCode: false,
    qualityScore: 3,
    ...overrides,
  });

  const makeProviderWithModels = (
    id: string,
    provider: string,
    models: unknown[],
    overrides: Partial<TenantProvider> = {},
  ): TenantProvider =>
    ({
      ...makeProvider(id, 'Default'),
      provider,
      cached_models: models as never,
      ...overrides,
    }) as TenantProvider;

  it('returns empty models and zeroed stats when ctx has no tenant', async () => {
    const providerRepo = { find: jest.fn() };
    const customProviderService = { list: jest.fn() };
    const controller = new TenantProvidersController(
      providerRepo as never,
      { getAll: jest.fn() } as never,
      customProviderService as never,
    );

    const result = await controller.listConnectedModels({ tenantId: null, userId: 'user-1' });

    expect(providerRepo.find).not.toHaveBeenCalled();
    expect(customProviderService.list).not.toHaveBeenCalled();
    expect(result.models).toEqual([]);
    expect(result.stats).toEqual({
      total_entries: 0,
      unique_models: 0,
      providers_with_models: 0,
      free_models: 0,
      models_with_pricing: 0,
      reasoning_models: 0,
      code_models: 0,
      cheapest_input_per_million: null,
      cheapest_output_per_million: null,
    });
  });

  it('projects built-in provider cached_models with per-million pricing', async () => {
    const providerRepo = {
      find: jest
        .fn()
        .mockResolvedValue([
          makeProviderWithModels('p1', 'openai', [
            makeModel('gpt-4o', { inputPricePerToken: 0.0000025, outputPricePerToken: 0.00001 }),
          ]),
        ]),
    };
    const controller = new TenantProvidersController(
      providerRepo as never,
      { getAll: jest.fn() } as never,
      { list: jest.fn().mockResolvedValue([]) } as never,
    );

    const result = await controller.listConnectedModels(ctx);

    expect(result.models).toHaveLength(1);
    const m = result.models[0]!;
    expect(m.model_key).toBe('gpt-4o');
    expect(m.model_name).toBe('gpt-4o');
    expect(m.provider).toBe('openai');
    expect(m.provider_display_name).toBeNull();
    expect(m.input_price_per_million).toBe(2.5);
    expect(m.output_price_per_million).toBe(10);
    expect(m.connection_id).toBe('p1');
    expect(m.is_active).toBe(true);
  });

  it('converts null per-token prices to null per-million', async () => {
    const providerRepo = {
      find: jest
        .fn()
        .mockResolvedValue([
          makeProviderWithModels('p1', 'anthropic', [
            makeModel('claude-x', { inputPricePerToken: null, outputPricePerToken: null }),
          ]),
        ]),
    };
    const controller = new TenantProvidersController(
      providerRepo as never,
      { getAll: jest.fn() } as never,
      { list: jest.fn().mockResolvedValue([]) } as never,
    );

    const result = await controller.listConnectedModels(ctx);

    expect(result.models[0]!.input_price_per_million).toBeNull();
    expect(result.models[0]!.output_price_per_million).toBeNull();
  });

  it('skips built-in providers with non-array cached_models', async () => {
    const providerRepo = {
      find: jest
        .fn()
        .mockResolvedValue([
          makeProviderWithModels('p1', 'openai', null as never),
          makeProviderWithModels('p2', 'anthropic', [makeModel('claude-3')]),
        ]),
    };
    const controller = new TenantProvidersController(
      providerRepo as never,
      { getAll: jest.fn() } as never,
      { list: jest.fn().mockResolvedValue([]) } as never,
    );

    const result = await controller.listConnectedModels(ctx);

    expect(result.models).toHaveLength(1);
    expect(result.models[0]!.model_key).toBe('claude-3');
  });

  it('projects custom provider models with routable custom:<uuid>/<name> ids', async () => {
    const customProvider = { id: 'u-1', name: 'MyLLM', models: [{ model_name: 'llama-3' }] };
    const providerRepo = {
      find: jest.fn().mockResolvedValue([
        makeProviderWithModels('p-custom', 'custom:u-1', [], {
          auth_type: 'api_key',
          label: 'Default',
          is_active: true,
        }),
      ]),
    };
    const controller = new TenantProvidersController(
      providerRepo as never,
      { getAll: jest.fn() } as never,
      { list: jest.fn().mockResolvedValue([customProvider]) } as never,
    );

    const result = await controller.listConnectedModels(ctx);

    expect(result.models).toHaveLength(1);
    const m = result.models[0]!;
    expect(m.model_key).toBe('llama-3');
    expect(m.model_name).toBe('custom:u-1/llama-3');
    expect(m.provider).toBe('custom:u-1');
    expect(m.provider_display_name).toBe('MyLLM');
    expect(m.auth_type).toBe('api_key');
    expect(m.is_active).toBe(true);
    expect(m.connection_id).toBe('p-custom');
  });

  it('defaults custom provider connection metadata when no companion row exists', async () => {
    const customProvider = {
      id: 'orphan',
      name: 'Orphan',
      models: [{ model_name: 'm1', input_price_per_million_tokens: 1.5 }],
    };
    const providerRepo = { find: jest.fn().mockResolvedValue([]) };
    const controller = new TenantProvidersController(
      providerRepo as never,
      { getAll: jest.fn() } as never,
      { list: jest.fn().mockResolvedValue([customProvider]) } as never,
    );

    const result = await controller.listConnectedModels(ctx);

    const m = result.models[0]!;
    expect(m.auth_type).toBe('api_key');
    expect(m.is_active).toBe(true);
    expect(m.connection_label).toBe('Default');
    expect(m.input_price_per_million).toBe(1.5);
  });

  it('keeps duplicate model ids across providers as separate entries', async () => {
    const providerRepo = {
      find: jest
        .fn()
        .mockResolvedValue([
          makeProviderWithModels('p1', 'openai', [makeModel('shared-model')]),
          makeProviderWithModels('p2', 'openrouter', [
            makeModel('shared-model', { inputPricePerToken: 0.000001 }),
          ]),
        ]),
    };
    const controller = new TenantProvidersController(
      providerRepo as never,
      { getAll: jest.fn() } as never,
      { list: jest.fn().mockResolvedValue([]) } as never,
    );

    const result = await controller.listConnectedModels(ctx);

    expect(result.models).toHaveLength(2);
    expect(result.models[0]!.model_key).toBe('shared-model');
    expect(result.models[1]!.model_key).toBe('shared-model');
    // Different providers and different prices preserved
    expect(result.models[0]!.provider).toBe('openai');
    expect(result.models[1]!.provider).toBe('openrouter');
    expect(result.models[0]!.input_price_per_million).toBe(5);
    expect(result.models[1]!.input_price_per_million).toBe(1);
  });

  it('computes stats: unique models, providers, pricing, free, reasoning, code, cheapest', async () => {
    const providerRepo = {
      find: jest.fn().mockResolvedValue([
        makeProviderWithModels('p1', 'openai', [
          makeModel('gpt-4o', {
            inputPricePerToken: 0.0000025,
            outputPricePerToken: 0.00001,
            capabilityReasoning: true,
          }),
          makeModel('gpt-4o-mini', {
            inputPricePerToken: 0.00000015,
            outputPricePerToken: 0.0000006,
            capabilityCode: true,
          }),
        ]),
        makeProviderWithModels('p2', 'anthropic', [
          makeModel('claude-free', {
            inputPricePerToken: 0,
            outputPricePerToken: 0,
          }),
        ]),
        makeProviderWithModels('p3', 'openai', [
          // gpt-4o again — same model, different connection
          makeModel('gpt-4o', { inputPricePerToken: 0.000002 }),
        ]),
      ]),
    };
    const controller = new TenantProvidersController(
      providerRepo as never,
      { getAll: jest.fn() } as never,
      { list: jest.fn().mockResolvedValue([]) } as never,
    );

    const result = await controller.listConnectedModels(ctx);

    expect(result.stats.total_entries).toBe(4);
    expect(result.stats.unique_models).toBe(3); // gpt-4o, gpt-4o-mini, claude-free
    expect(result.stats.providers_with_models).toBe(2); // openai, anthropic
    expect(result.stats.free_models).toBe(1);
    expect(result.stats.models_with_pricing).toBe(4); // all have non-null input
    expect(result.stats.reasoning_models).toBe(1);
    expect(result.stats.code_models).toBe(1);
    // cheapest excludes the free model; cheapest input = 0.15 (gpt-4o-mini)
    expect(result.stats.cheapest_input_per_million).toBe(0.15);
    // cheapest output = 0.6 (gpt-4o-mini)
    expect(result.stats.cheapest_output_per_million).toBe(0.6);
  });

  it('returns null cheapest when all models are free', async () => {
    const providerRepo = {
      find: jest
        .fn()
        .mockResolvedValue([
          makeProviderWithModels('p1', 'groq', [
            makeModel('free-a', { inputPricePerToken: 0, outputPricePerToken: 0 }),
          ]),
        ]),
    };
    const controller = new TenantProvidersController(
      providerRepo as never,
      { getAll: jest.fn() } as never,
      { list: jest.fn().mockResolvedValue([]) } as never,
    );

    const result = await controller.listConnectedModels(ctx);

    expect(result.stats.free_models).toBe(1);
    expect(result.stats.cheapest_input_per_million).toBeNull();
    expect(result.stats.cheapest_output_per_million).toBeNull();
  });

  it('returns empty when tenant has no providers', async () => {
    const providerRepo = { find: jest.fn().mockResolvedValue([]) };
    const controller = new TenantProvidersController(
      providerRepo as never,
      { getAll: jest.fn() } as never,
      { list: jest.fn().mockResolvedValue([]) } as never,
    );

    const result = await controller.listConnectedModels(ctx);

    expect(result.models).toEqual([]);
    expect(result.stats.total_entries).toBe(0);
  });

  it('skips custom providers with non-array models', async () => {
    const customProvider = { id: 'u-1', name: 'Broken', models: null as never };
    const providerRepo = {
      find: jest
        .fn()
        .mockResolvedValue([
          makeProviderWithModels('p-custom', 'custom:u-1', [], { auth_type: 'api_key' }),
        ]),
    };
    const controller = new TenantProvidersController(
      providerRepo as never,
      { getAll: jest.fn() } as never,
      { list: jest.fn().mockResolvedValue([customProvider]) } as never,
    );

    const result = await controller.listConnectedModels(ctx);

    expect(result.models).toEqual([]);
  });
});
