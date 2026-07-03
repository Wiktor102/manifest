import { describe, it, expect } from "vitest";
import {
  entryDisplayName,
  entryProviderName,
  isFreeEntry,
  formatPerMillion,
  cheapestInput,
  cheapestOutput,
  filterEntries,
  sortEntries,
  groupByModel,
  groupByProvider,
  groupModels,
  sortGroups,
} from "../../src/services/connected-models";
import type { ConnectedModelEntry } from "../../src/services/api/providers";

function makeEntry(overrides: Partial<ConnectedModelEntry> = {}): ConnectedModelEntry {
  return {
    model_key: 'gpt-4o',
    model_name: 'gpt-4o',
    display_name: null,
    provider: 'openai',
    provider_display_name: null,
    auth_type: 'api_key',
    connection_id: 'c1',
    connection_label: 'Default',
    is_active: true,
    input_price_per_million: 5,
    output_price_per_million: 15,
    context_window: 128000,
    capability_reasoning: false,
    capability_code: false,
    quality_score: 3,
    models_fetched_at: null,
    ...overrides,
  };
}

describe("connected-models entryDisplayName", () => {
  it("uses display_name when present", () => {
    expect(entryDisplayName(makeEntry({ display_name: 'GPT-4o' }))).toBe('GPT-4o');
  });
  it("falls back to model_key when display_name is null", () => {
    expect(entryDisplayName(makeEntry({ display_name: null }))).toBe('gpt-4o');
  });
  it("strips a trailing (free) tag", () => {
    expect(entryDisplayName(makeEntry({ display_name: 'Llama 3 (free)' }))).toBe('Llama 3');
  });
});

describe("connected-models entryProviderName", () => {
  it("uses provider_display_name for custom providers", () => {
    expect(
      entryProviderName(
        makeEntry({ provider: 'custom:u1', provider_display_name: 'MyLLM' }),
      ),
    ).toBe('MyLLM');
  });
  it("falls back to provider id", () => {
    expect(entryProviderName(makeEntry({ provider: 'openai' }))).toBe('openai');
  });
});

describe("connected-models isFreeEntry", () => {
  it("is true when both prices are zero", () => {
    expect(isFreeEntry(makeEntry({ input_price_per_million: 0, output_price_per_million: 0 }))).toBe(true);
  });
  it("is false when input price is non-zero", () => {
    expect(isFreeEntry(makeEntry({ input_price_per_million: 0, output_price_per_million: 1 }))).toBe(false);
  });
});

describe("connected-models formatPerMillion", () => {
  it("returns em-dash for null", () => {
    expect(formatPerMillion(null)).toBe('\u2014');
  });
  it("returns Free for zero", () => {
    expect(formatPerMillion(0)).toBe('Free');
  });
  it("returns < $0.01 for sub-cent", () => {
    expect(formatPerMillion(0.005)).toBe('< $0.01');
  });
  it("returns 3 decimals under $1", () => {
    expect(formatPerMillion(0.15)).toBe('$0.150');
  });
  it("returns 2 decimals at $1 and above", () => {
    expect(formatPerMillion(5)).toBe('$5.00');
  });
});

describe("connected-models cheapestInput / cheapestOutput", () => {
  it("finds the cheapest non-free input price", () => {
    const entries = [
      makeEntry({ input_price_per_million: 10, output_price_per_million: 30 }),
      makeEntry({ input_price_per_million: 0, output_price_per_million: 0 }),
      makeEntry({ input_price_per_million: 3, output_price_per_million: 12 }),
    ];
    expect(cheapestInput(entries)).toBe(3);
    expect(cheapestOutput(entries)).toBe(12);
  });
  it("returns null when all entries are free", () => {
    const entries = [
      makeEntry({ input_price_per_million: 0, output_price_per_million: 0 }),
    ];
    expect(cheapestInput(entries)).toBeNull();
    expect(cheapestOutput(entries)).toBeNull();
  });
  it("returns null when prices are null", () => {
    const entries = [
      makeEntry({ input_price_per_million: null, output_price_per_million: null }),
    ];
    expect(cheapestInput(entries)).toBeNull();
    expect(cheapestOutput(entries)).toBeNull();
  });
  it("ignores null prices but keeps non-null ones", () => {
    const entries = [
      makeEntry({ input_price_per_million: null, output_price_per_million: null }),
      makeEntry({ input_price_per_million: 2, output_price_per_million: 8 }),
    ];
    expect(cheapestInput(entries)).toBe(2);
    expect(cheapestOutput(entries)).toBe(8);
  });
});

describe("connected-models filterEntries", () => {
  it("returns all entries when query is empty", () => {
    const entries = [makeEntry(), makeEntry({ model_key: 'claude-3' })];
    expect(filterEntries(entries, '')).toHaveLength(2);
  });
  it("filters by model key", () => {
    const entries = [makeEntry({ model_key: 'gpt-4o' }), makeEntry({ model_key: 'claude-3' })];
    expect(filterEntries(entries, 'gpt')).toHaveLength(1);
  });
  it("filters by provider display name", () => {
    const entries = [
      makeEntry({ provider: 'custom:u1', provider_display_name: 'MyLLM' }),
      makeEntry({ provider: 'openai' }),
    ];
    expect(filterEntries(entries, 'myllm')).toHaveLength(1);
  });
  it("filters by auth_type", () => {
    const entries = [
      makeEntry({ auth_type: 'api_key' }),
      makeEntry({ auth_type: 'subscription' }),
    ];
    expect(filterEntries(entries, 'sub')).toHaveLength(1);
  });
  it("is case-insensitive and trims whitespace", () => {
    const entries = [makeEntry({ model_key: 'GPT-4o' })];
    expect(filterEntries(entries, '  gpt  ')).toHaveLength(1);
  });
});

describe("connected-models sortEntries", () => {
  it("sorts by display_name ascending", () => {
    const entries = [
      makeEntry({ model_key: 'zeta', display_name: 'Zeta' }),
      makeEntry({ model_key: 'alpha', display_name: 'Alpha' }),
    ];
    const sorted = sortEntries(entries, 'display_name', 'asc');
    expect(sorted[0]!.display_name).toBe('Alpha');
  });
  it("sorts by input_price descending", () => {
    const entries = [
      makeEntry({ input_price_per_million: 1 }),
      makeEntry({ input_price_per_million: 10 }),
    ];
    const sorted = sortEntries(entries, 'input_price_per_million', 'desc');
    expect(sorted[0]!.input_price_per_million).toBe(10);
  });
  it("sorts by provider name", () => {
    const entries = [
      makeEntry({ provider: 'openai' }),
      makeEntry({ provider: 'anthropic' }),
    ];
    const sorted = sortEntries(entries, 'provider', 'asc');
    expect(sorted[0]!.provider).toBe('anthropic');
  });
  it("sorts null prices to the bottom regardless of direction", () => {
    const entries = [
      makeEntry({ input_price_per_million: null }),
      makeEntry({ input_price_per_million: 5 }),
    ];
    const asc = sortEntries(entries, 'input_price_per_million', 'asc');
    expect(asc[0]!.input_price_per_million).toBe(5);
    const desc = sortEntries(entries, 'input_price_per_million', 'desc');
    expect(desc[0]!.input_price_per_million).toBe(5);
  });
  it("does not mutate the original array", () => {
    const entries = [
      makeEntry({ input_price_per_million: 10 }),
      makeEntry({ input_price_per_million: 1 }),
    ];
    sortEntries(entries, 'input_price_per_million', 'asc');
    expect(entries[0]!.input_price_per_million).toBe(10);
  });
});

describe("connected-models groupByModel", () => {
  it("groups entries by model_key", () => {
    const entries = [
      makeEntry({ model_key: 'gpt-4o', provider: 'openai' }),
      makeEntry({ model_key: 'gpt-4o', provider: 'openrouter' }),
      makeEntry({ model_key: 'claude-3', provider: 'anthropic' }),
    ];
    const groups = groupByModel(entries);
    expect(groups).toHaveLength(2);
    const gpt = groups.find((g) => g.key === 'gpt-4o')!;
    expect(gpt.entries).toHaveLength(2);
    expect(gpt.label).toBe('gpt-4o');
  });
  it("sorts groups alphabetically by label", () => {
    const entries = [
      makeEntry({ model_key: 'zeta', display_name: 'Zeta' }),
      makeEntry({ model_key: 'alpha', display_name: 'Alpha' }),
    ];
    const groups = groupByModel(entries);
    expect(groups[0]!.label).toBe('Alpha');
  });
  it("uses display_name for the group label", () => {
    const entries = [makeEntry({ model_key: 'gpt-4o', display_name: 'GPT-4o' })];
    expect(groupByModel(entries)[0]!.label).toBe('GPT-4o');
  });
});

describe("connected-models groupByProvider", () => {
  it("groups entries by provider", () => {
    const entries = [
      makeEntry({ model_key: 'gpt-4o', provider: 'openai' }),
      makeEntry({ model_key: 'gpt-4o-mini', provider: 'openai' }),
      makeEntry({ model_key: 'claude-3', provider: 'anthropic' }),
    ];
    const groups = groupByProvider(entries);
    expect(groups).toHaveLength(2);
    const openai = groups.find((g) => g.key === 'openai')!;
    expect(openai.entries).toHaveLength(2);
  });
  it("uses provider_display_name for the group label", () => {
    const entries = [
      makeEntry({ provider: 'custom:u1', provider_display_name: 'MyLLM' }),
    ];
    expect(groupByProvider(entries)[0]!.label).toBe('MyLLM');
  });
});

describe("connected-models groupModels", () => {
  it("delegates to groupByModel for mode model", () => {
    const entries = [makeEntry({ model_key: 'a', provider: 'openai' })];
    expect(groupModels(entries, 'model')).toEqual(groupByModel(entries));
  });
  it("delegates to groupByProvider for mode provider", () => {
    const entries = [makeEntry({ model_key: 'a', provider: 'openai' })];
    expect(groupModels(entries, 'provider')).toEqual(groupByProvider(entries));
  });
});

describe("connected-models sortGroups", () => {
  it("sorts entries within each group without changing group order", () => {
    const entries = [
      makeEntry({ model_key: 'gpt-4o', provider: 'openai', input_price_per_million: 10 }),
      makeEntry({ model_key: 'gpt-4o', provider: 'openrouter', input_price_per_million: 2 }),
    ];
    const groups = groupByModel(entries);
    const sorted = sortGroups(groups, 'input_price_per_million', 'asc');
    expect(sorted[0]!.entries[0]!.input_price_per_million).toBe(2);
  });
});
