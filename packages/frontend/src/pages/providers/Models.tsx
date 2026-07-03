import { Title, Meta } from '@solidjs/meta';
import { createResource, createSignal, createMemo, Show, For, type Component } from 'solid-js';
import ErrorState from '../../components/ErrorState.jsx';
import Select from '../../components/Select.jsx';
import { providerIcon, customProviderLogo } from '../../components/ProviderIcon.jsx';
import { authBadgeFor, authLabel } from '../../components/AuthBadge.jsx';
import { getConnectedModels } from '../../services/api.js';
import { customProviderColor } from '../../services/formatters.js';
import { resolveProviderId, stripCustomPrefix } from '../../services/routing-utils.js';
import {
  groupModels,
  sortGroups,
  filterEntries,
  formatPerMillion,
  cheapestInput,
  cheapestOutput,
  entryDisplayName,
  entryProviderName,
  isFreeEntry,
  type GroupMode,
  type SortKey,
  type SortDir,
} from '../../services/connected-models.js';
import { routingPing } from '../../services/sse.js';
import { PROVIDERS } from '../../services/providers.js';
import '../../styles/analytics-overview.css';

const GROUP_OPTIONS = [
  { label: 'By model', value: 'model' },
  { label: 'By provider', value: 'provider' },
];

function providerDisplayName(provider: string, providerDisplayName: string | null): string {
  if (providerDisplayName) return providerDisplayName;
  const pid = resolveProviderId(provider);
  return PROVIDERS.find((p) => p.id === pid)?.name ?? provider;
}

function formatContext(ctx: number | null): string {
  if (ctx == null) return '\u2014';
  if (ctx >= 1_000_000) return `${(ctx / 1_000_000).toFixed(ctx % 1_000_000 === 0 ? 0 : 1)}M`;
  if (ctx >= 1_000) return `${Math.round(ctx / 1_000)}k`;
  return String(ctx);
}

const ConnectedModels: Component = () => {
  const [data, { refetch }] = createResource(
    () => routingPing(),
    () => getConnectedModels(),
  );
  const [groupBy, setGroupBy] = createSignal<GroupMode>('model');
  const [query, setQuery] = createSignal('');
  const [sortKey, setSortKey] = createSignal<SortKey>('input_price_per_million');
  const [sortDir, setSortDir] = createSignal<SortDir>('asc');
  const [collapsedGroups, setCollapsedGroups] = createSignal<Set<string>>(new Set());

  const handleSort = (key: SortKey) => {
    if (sortKey() === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const indicator = (key: SortKey) => {
    if (sortKey() !== key) return '';
    return sortDir() === 'asc' ? ' \u25B2' : ' \u25BC';
  };

  const allEntries = createMemo(() => data()?.models ?? []);

  const filtered = createMemo(() => filterEntries(allEntries(), query()));

  const grouped = createMemo(() => {
    const groups = groupModels(filtered(), groupBy());
    return sortGroups(groups, sortKey(), sortDir());
  });

  const toggleGroup = (key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const stats = createMemo(() => data()?.stats);

  const renderProviderIcon = (entry: {
    provider: string;
    provider_display_name: string | null;
  }) => {
    const isCustom = entry.provider.startsWith('custom:');
    const name = providerDisplayName(entry.provider, entry.provider_display_name);
    if (isCustom) {
      return (
        customProviderLogo(name, 16) ?? (
          <span
            style={{
              display: 'inline-flex',
              'align-items': 'center',
              'justify-content': 'center',
              width: '16px',
              height: '16px',
              'border-radius': '3px',
              'font-size': '9px',
              'font-weight': '600',
              color: 'white',
              background: customProviderColor(name),
              'flex-shrink': '0',
            }}
          >
            {name.charAt(0).toUpperCase()}
          </span>
        )
      );
    }
    const pid = resolveProviderId(entry.provider);
    return pid ? providerIcon(pid, 16) : null;
  };

  return (
    <div class="container--full">
      <Title>Models - Manifest</Title>
      <Meta
        name="description"
        content="All connected models across your providers, grouped by model or provider."
      />
      <div class="page-header" style="border-bottom: none; padding-bottom: 0;">
        <div>
          <h1 class="page-header__title">Models</h1>
          <p class="page-header__subtitle">All connected models across your providers</p>
        </div>
        <Show when={!data.loading && (allEntries().length > 0 || query())}>
          <div style="display: flex; align-items: center; gap: 8px;">
            <input
              type="text"
              class="model-search-input"
              placeholder="Search models or providers..."
              value={query()}
              onInput={(e) => setQuery(e.currentTarget.value)}
              style="padding: 6px 12px; border: 1px solid hsl(var(--border)); border-radius: var(--radius); font-size: var(--font-size-sm); background: hsl(var(--card)); color: hsl(var(--foreground)); min-width: 220px;"
            />
            <Select
              value={groupBy()}
              onChange={(v) => setGroupBy(v as GroupMode)}
              options={GROUP_OPTIONS}
            />
          </div>
        </Show>
      </div>

      <Show
        when={!data.loading}
        fallback={
          <div
            class="panel"
            style="min-height: 400px; display: flex; align-items: center; justify-content: center;"
          >
            <div class="loading-spinner" />
          </div>
        }
      >
        <Show when={!data.error} fallback={<ErrorState error={data.error} onRetry={refetch} />}>
          <Show
            when={allEntries().length > 0}
            fallback={
              <div style="display: flex; flex-direction: column; align-items: center; text-align: center; padding: 48px 24px; gap: 8px; background: hsl(var(--muted) / 0.45); border-radius: var(--radius);">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="32"
                  height="32"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                  style="color: hsl(var(--muted-foreground)); margin-bottom: 4px;"
                  aria-hidden="true"
                >
                  <path d="M4 2H2v19c0 .55.45 1 1 1h19v-2H4z" />
                  <path d="M11 18c.55 0 1-.45 1-1V6c0-.55-.45-1-1-1H7c-.55 0-1 .45-1 1v11c0 .55.45 1 1 1zm-1-2H8v-2h2zm0-9v5H8V7zm9 11c.55 0 1-.45 1-1V3c0-.55-.45-1-1-1h-4c-.55 0-1 .45-1 1v14c0 .55.45 1 1 1zm-1-2h-2v-6h2zM16 4h2v4h-2z" />
                </svg>
                <div style="font-size: var(--font-size-base); font-weight: 600; color: hsl(var(--foreground));">
                  No connected models
                </div>
                <div style="font-size: var(--font-size-sm); color: hsl(var(--muted-foreground)); margin-bottom: 8px;">
                  Connect a provider to see its available models here.
                </div>
              </div>
            }
          >
            {/* Stat cards */}
            <Show when={stats()}>
              <div class="overview-stats" style="grid-template-columns: repeat(5, 1fr);">
                <div class="overview-stat-card">
                  <span class="overview-stat-card__label">Total models</span>
                  <span class="overview-stat-card__value">{stats()!.total_entries}</span>
                </div>
                <div class="overview-stat-card">
                  <span class="overview-stat-card__label">Unique models</span>
                  <span class="overview-stat-card__value">{stats()!.unique_models}</span>
                </div>
                <div class="overview-stat-card">
                  <span class="overview-stat-card__label">Providers</span>
                  <span class="overview-stat-card__value">{stats()!.providers_with_models}</span>
                </div>
                <div class="overview-stat-card">
                  <span class="overview-stat-card__label">Free models</span>
                  <span class="overview-stat-card__value">{stats()!.free_models}</span>
                </div>
                <div class="overview-stat-card">
                  <span class="overview-stat-card__label">Cheapest in / 1M</span>
                  <span class="overview-stat-card__value">
                    {formatPerMillion(stats()!.cheapest_input_per_million)}
                  </span>
                </div>
              </div>
            </Show>

            {/* Grouped table */}
            <div class="panel scroll-panel">
              <div class="scroll-panel__body" style="max-height: 600px;">
                <table class="data-table" style="width: 100%;">
                  <thead>
                    <tr>
                      <Show
                        when={groupBy() === 'model'}
                        fallback={
                          <>
                            <th
                              class="data-table__sortable"
                              onClick={() => handleSort('display_name')}
                            >
                              Model{indicator('display_name')}
                            </th>
                            <th>Provider</th>
                          </>
                        }
                      >
                        <th>Model</th>
                        <th class="data-table__sortable" onClick={() => handleSort('provider')}>
                          Provider{indicator('provider')}
                        </th>
                      </Show>
                      <th>Auth</th>
                      <th
                        class="data-table__sortable"
                        onClick={() => handleSort('input_price_per_million')}
                      >
                        In / 1M{indicator('input_price_per_million')}
                      </th>
                      <th
                        class="data-table__sortable"
                        onClick={() => handleSort('output_price_per_million')}
                      >
                        Out / 1M{indicator('output_price_per_million')}
                      </th>
                      <th class="data-table__sortable" onClick={() => handleSort('context_window')}>
                        Context{indicator('context_window')}
                      </th>
                      <th>Capabilities</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={grouped()}>
                      {(group) => {
                        const isCollapsed = () => collapsedGroups().has(group.key);
                        const groupCheapestIn = () => cheapestInput(group.entries);
                        const groupCheapestOut = () => cheapestOutput(group.entries);
                        const freeCount = () => group.entries.filter(isFreeEntry).length;
                        return (
                          <>
                            <tr
                              class="model-group-header"
                              style="cursor: pointer;"
                              onClick={() => toggleGroup(group.key)}
                            >
                              <td
                                colspan="7"
                                style="font-weight: 600; background: hsl(var(--muted) / 0.3); border-top: 1px solid hsl(var(--border));"
                              >
                                <span style="display: inline-flex; align-items: center; gap: 8px;">
                                  <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    width="12"
                                    height="12"
                                    fill="currentColor"
                                    viewBox="0 0 24 24"
                                    aria-hidden="true"
                                    style={{
                                      transition: 'transform 150ms',
                                      transform: isCollapsed() ? 'rotate(-90deg)' : 'rotate(0deg)',
                                    }}
                                  >
                                    <path d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z" />
                                  </svg>
                                  {group.label}
                                  <span style="font-weight: 400; font-size: var(--font-size-xs); color: hsl(var(--muted-foreground));">
                                    {group.entries.length}{' '}
                                    {groupBy() === 'model' ? 'provider' : 'model'}
                                    {group.entries.length !== 1 ? 's' : ''}
                                  </span>
                                  <Show when={groupBy() === 'model' && group.entries.length > 1}>
                                    <span style="font-weight: 400; font-size: var(--font-size-xs); color: hsl(var(--muted-foreground));">
                                      {' \u00B7 cheapest '}
                                      {formatPerMillion(groupCheapestIn())}
                                      {' / '}
                                      {formatPerMillion(groupCheapestOut())}
                                    </span>
                                  </Show>
                                  <Show when={freeCount() > 0}>
                                    <span style="font-weight: 400; font-size: var(--font-size-xs); color: hsl(var(--success));">
                                      {' \u00B7 '}
                                      {freeCount()} free
                                    </span>
                                  </Show>
                                </span>
                              </td>
                            </tr>
                            <Show when={!isCollapsed()}>
                              <For each={group.entries}>
                                {(entry) => (
                                  <tr>
                                    <Show
                                      when={groupBy() === 'model'}
                                      fallback={
                                        <>
                                          <td style="font-size: var(--font-size-sm);">
                                            {entryDisplayName(entry)}
                                          </td>
                                          <td>
                                            <span style="display: inline-flex; align-items: center; gap: 6px;">
                                              <span style="display: inline-flex; flex-shrink: 0;">
                                                {renderProviderIcon(entry)}
                                              </span>
                                              <span style="font-weight: 500;">
                                                {entryProviderName(entry)}
                                              </span>
                                            </span>
                                          </td>
                                        </>
                                      }
                                    >
                                      <td>
                                        <div style="display: flex; flex-direction: column; font-size: var(--font-size-sm);">
                                          <span style="font-weight: 500;">
                                            {entryDisplayName(entry)}
                                          </span>
                                          <span style="font-family: var(--font-mono); font-size: var(--font-size-xs); color: hsl(var(--muted-foreground));">
                                            {entry.model_name.startsWith('custom:')
                                              ? stripCustomPrefix(entry.model_name)
                                              : entry.model_key}
                                          </span>
                                        </div>
                                      </td>
                                      <td>
                                        <span style="display: inline-flex; align-items: center; gap: 6px;">
                                          <span style="display: inline-flex; flex-shrink: 0;">
                                            {renderProviderIcon(entry)}
                                          </span>
                                          <span style="font-weight: 500;">
                                            {providerDisplayName(
                                              entry.provider,
                                              entry.provider_display_name,
                                            )}
                                          </span>
                                          <Show when={entry.provider.startsWith('custom:')}>
                                            <span style="font-size: 10px; font-weight: 500; color: hsl(var(--muted-foreground)); background: hsl(var(--muted)); padding: 1px 6px; border-radius: var(--radius-sm);">
                                              custom
                                            </span>
                                          </Show>
                                        </span>
                                      </td>
                                    </Show>
                                    <td>
                                      <span style="display: inline-flex; align-items: center; gap: 4px;">
                                        {authBadgeFor(entry.auth_type, 12)}
                                        <span style="font-size: var(--font-size-xs); color: hsl(var(--muted-foreground));">
                                          {authLabel(entry.auth_type)}
                                        </span>
                                      </span>
                                    </td>
                                    <td style="font-family: var(--font-mono); font-variant-numeric: tabular-nums;">
                                      {formatPerMillion(entry.input_price_per_million)}
                                    </td>
                                    <td style="font-family: var(--font-mono); font-variant-numeric: tabular-nums;">
                                      {formatPerMillion(entry.output_price_per_million)}
                                    </td>
                                    <td style="font-size: var(--font-size-sm); color: hsl(var(--muted-foreground));">
                                      {formatContext(entry.context_window)}
                                    </td>
                                    <td>
                                      <span style="display: inline-flex; gap: 4px;">
                                        <Show when={entry.capability_reasoning}>
                                          <span style="display: inline-flex; padding: 2px 6px; border-radius: var(--radius-sm); background: hsl(var(--primary) / 0.1); color: hsl(var(--primary)); font-size: var(--font-size-xs); font-weight: 500;">
                                            Reasoning
                                          </span>
                                        </Show>
                                        <Show when={entry.capability_code}>
                                          <span style="display: inline-flex; padding: 2px 6px; border-radius: var(--radius-sm); background: hsl(var(--success) / 0.1); color: hsl(var(--success)); font-size: var(--font-size-xs); font-weight: 500;">
                                            Code
                                          </span>
                                        </Show>
                                        <Show when={isFreeEntry(entry)}>
                                          <span style="display: inline-flex; padding: 2px 6px; border-radius: var(--radius-sm); background: hsl(var(--success) / 0.1); color: hsl(var(--success)); font-size: var(--font-size-xs); font-weight: 500;">
                                            Free
                                          </span>
                                        </Show>
                                      </span>
                                    </td>
                                  </tr>
                                )}
                              </For>
                            </Show>
                          </>
                        );
                      }}
                    </For>
                    <Show when={grouped().length === 0}>
                      <tr>
                        <td
                          colspan="7"
                          style="text-align: center; color: hsl(var(--muted-foreground)); padding: 24px 0;"
                        >
                          No models match your search
                        </td>
                      </tr>
                    </Show>
                  </tbody>
                </table>
              </div>
            </div>
          </Show>
        </Show>
      </Show>
    </div>
  );
};

export default ConnectedModels;
