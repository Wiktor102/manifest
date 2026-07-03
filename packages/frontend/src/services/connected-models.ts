import type { ConnectedModelEntry } from './api/providers.js';

export type GroupMode = 'model' | 'provider';

export type SortKey =
  | 'display_name'
  | 'provider'
  | 'input_price_per_million'
  | 'output_price_per_million'
  | 'context_window';

export type SortDir = 'asc' | 'desc';

/**
 * A group of connected-model entries that share a common key (model name or
 * provider). `label` is the display heading for the group.
 */
export interface ModelGroupRow {
  key: string;
  label: string;
  entries: ConnectedModelEntry[];
}

/**
 * Resolve the best display name for a model entry. Prefers the entry's
 * display_name, falls back to the raw model key.
 */
export function entryDisplayName(entry: ConnectedModelEntry): string {
  return (entry.display_name || entry.model_key).replace(/\s*\(free\)/i, '');
}

/**
 * Resolve the display name for a provider entry. Built-ins use the provider id
 * (the page maps it to a branded name via PROVIDERS); custom providers carry
 * their own display name.
 */
export function entryProviderName(entry: ConnectedModelEntry): string {
  return entry.provider_display_name ?? entry.provider;
}

/** True when both input and output per-million prices are exactly zero. */
export function isFreeEntry(entry: ConnectedModelEntry): boolean {
  return entry.input_price_per_million === 0 && entry.output_price_per_million === 0;
}

/** Format a per-million-token price. */
export function formatPerMillion(price: number | null | undefined): string {
  if (price == null) return '\u2014';
  if (price === 0) return 'Free';
  if (price < 0.01) return '< $0.01';
  if (price < 1) return `$${price.toFixed(3)}`;
  return `$${price.toFixed(2)}`;
}

/** The cheapest non-null input price across a set of entries (free excluded). */
export function cheapestInput(entries: ConnectedModelEntry[]): number | null {
  let best: number | null = null;
  for (const e of entries) {
    if (e.input_price_per_million == null) continue;
    if (isFreeEntry(e)) continue;
    if (best == null || e.input_price_per_million < best) best = e.input_price_per_million;
  }
  return best;
}

/** The cheapest non-null output price across a set of entries (free excluded). */
export function cheapestOutput(entries: ConnectedModelEntry[]): number | null {
  let best: number | null = null;
  for (const e of entries) {
    if (e.output_price_per_million == null) continue;
    if (isFreeEntry(e)) continue;
    if (best == null || e.output_price_per_million < best) best = e.output_price_per_million;
  }
  return best;
}

/**
 * Filter entries by a free-text query. Matches against model name, display
 * name, provider name, and provider display name (case-insensitive).
 */
export function filterEntries(
  entries: ConnectedModelEntry[],
  query: string,
): ConnectedModelEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  return entries.filter((e) => {
    return (
      e.model_key.toLowerCase().includes(q) ||
      (e.display_name ?? '').toLowerCase().includes(q) ||
      e.provider.toLowerCase().includes(q) ||
      (e.provider_display_name ?? '').toLowerCase().includes(q) ||
      e.auth_type.toLowerCase().includes(q)
    );
  });
}

/**
 * Sort a flat list of entries by the given key/direction. Nulls sort to the
 * bottom regardless of direction.
 */
export function sortEntries(
  entries: ConnectedModelEntry[],
  key: SortKey,
  dir: SortDir,
): ConnectedModelEntry[] {
  const sorted = [...entries].sort((a, b) => {
    if (key === 'display_name') {
      const av = entryDisplayName(a);
      const bv = entryDisplayName(b);
      return dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    }
    if (key === 'provider') {
      const av = entryProviderName(a);
      const bv = entryProviderName(b);
      return dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    }
    const av = a[key] as number | null;
    const bv = b[key] as number | null;
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return dir === 'asc' ? av - bv : bv - av;
  });
  return sorted;
}

/**
 * Group entries by model. Each group is keyed by `model_key` and labelled
 * with the best display name. Groups are sorted alphabetically by label.
 */
export function groupByModel(entries: ConnectedModelEntry[]): ModelGroupRow[] {
  const map = new Map<string, ConnectedModelEntry[]>();
  for (const e of entries) {
    const list = map.get(e.model_key);
    if (list) list.push(e);
    else map.set(e.model_key, [e]);
  }
  const groups: ModelGroupRow[] = [];
  for (const [key, list] of map) {
    groups.push({ key, label: entryDisplayName(list[0]!), entries: list });
  }
  groups.sort((a, b) => a.label.localeCompare(b.label));
  return groups;
}

/**
 * Group entries by provider. Each group is keyed by the provider id and
 * labelled with the provider display name. Groups are sorted alphabetically.
 */
export function groupByProvider(entries: ConnectedModelEntry[]): ModelGroupRow[] {
  const map = new Map<string, ConnectedModelEntry[]>();
  for (const e of entries) {
    const list = map.get(e.provider);
    if (list) list.push(e);
    else map.set(e.provider, [e]);
  }
  const groups: ModelGroupRow[] = [];
  for (const [key, list] of map) {
    groups.push({ key, label: entryProviderName(list[0]!), entries: list });
  }
  groups.sort((a, b) => a.label.localeCompare(b.label));
  return groups;
}

/**
 * Group entries according to the selected mode. Returns the grouped structure
 * the page renders.
 */
export function groupModels(entries: ConnectedModelEntry[], mode: GroupMode): ModelGroupRow[] {
  return mode === 'model' ? groupByModel(entries) : groupByProvider(entries);
}

/**
 * Sort the entries within each group by the given key/direction.
 */
export function sortGroups(groups: ModelGroupRow[], key: SortKey, dir: SortDir): ModelGroupRow[] {
  return groups.map((g) => ({ ...g, entries: sortEntries(g.entries, key, dir) }));
}
