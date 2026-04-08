import { Usage } from '../api/types';

/**
 * Pricing rates per million tokens for different models
 * Source: https://www.anthropic.com/api (approximate as of early 2025)
 */
export const PRICING = {
  // --- Claude 4 & Future Models ---
  'claude-4.5-opus': {
    input: 5.0,
    output: 25.0,
    cache_write: 6.25,
    cache_read: 0.5,
  },
  'claude-4.1-opus': {
    input: 15.0,
    output: 75.0,
    cache_write: 18.75,
    cache_read: 1.5,
  },
  'claude-4-opus': {
    input: 15.0,
    output: 75.0,
    cache_write: 18.75,
    cache_read: 1.5,
  },
  'claude-4.5-sonnet': {
    input: 3.0,
    output: 15.0,
    cache_write: 3.75,
    cache_read: 0.3,
  },
  'claude-4-sonnet': {
    input: 3.0,
    output: 15.0,
    cache_write: 3.75,
    cache_read: 0.3,
  },
  'claude-4.5-haiku': {
    input: 1.0,
    output: 5.0,
    cache_write: 1.25,
    cache_read: 0.1,
  },

  // --- Legacy / Claude 3 ---
  'claude-3-opus-20240229': {
    input: 15.0,
    output: 75.0,
    cache_write: 18.75,
    cache_read: 1.5,
  },
  'claude-3-sonnet-20240229': {
    input: 3.0,
    output: 15.0,
    cache_write: 3.75,
    cache_read: 0.3,
  },
  'claude-3-5-sonnet-20240620': {
    input: 3.0,
    output: 15.0,
    cache_write: 3.75,
    cache_read: 0.3,
  },
  // New Sonnet 3.5 updated model
  'claude-3-5-sonnet-20241022': {
    input: 3.0,
    output: 15.0,
    cache_write: 3.75,
    cache_read: 0.3,
  },
  'claude-3-haiku-20240307': {
    input: 0.25,
    output: 1.25,
    cache_write: 0.3125,
    cache_read: 0.025,
  },
  'claude-3-5-haiku-20241022': {
    input: 0.8,
    output: 4.0,
    cache_write: 1.0, // Approx based on 1.25x rule usually or custom
    cache_read: 0.08,
  },

  // --- OpenAI / Codex / Cursor / OpenCode (model-family based) ---
  'gpt-5.4': {
    input: 2.5,
    output: 15.0,
    cache_write: 2.5,
    cache_read: 0.25,
  },
  'gpt-5.4-mini': {
    input: 0.75,
    output: 4.5,
    cache_write: 0.75,
    cache_read: 0.075,
  },
  'gpt-5.4-nano': {
    input: 0.2,
    output: 1.25,
    cache_write: 0.2,
    cache_read: 0.02,
  },
  'gpt-5.2': {
    input: 1.75,
    output: 14.0,
    cache_write: 1.75,
    cache_read: 0.175,
  },
  'gpt-5.2-pro': {
    input: 21.0,
    output: 168.0,
    cache_write: 21.0,
    cache_read: 0,
  },
  'gpt-5.1': {
    input: 1.25,
    output: 10.0,
    cache_write: 1.25,
    cache_read: 0.125,
  },
  'gpt-5.1-codex': {
    input: 1.25,
    output: 10.0,
    cache_write: 1.25,
    cache_read: 0.125,
  },
  'gpt-5': {
    input: 1.25,
    output: 10.0,
    cache_write: 1.25,
    cache_read: 0.125,
  },
  'gpt-5-codex': {
    input: 1.25,
    output: 10.0,
    cache_write: 1.25,
    cache_read: 0.125,
  },
  'gpt-5-mini': {
    input: 0.25,
    output: 2.0,
    cache_write: 0.25,
    cache_read: 0.025,
  },
  'gpt-5-nano': {
    input: 0.05,
    output: 0.4,
    cache_write: 0.05,
    cache_read: 0.005,
  },
  'gpt-5-pro': {
    input: 15.0,
    output: 120.0,
    cache_write: 15.0,
    cache_read: 0,
  },
  'gpt-4.1': {
    input: 2.0,
    output: 8.0,
    cache_write: 2.0,
    cache_read: 0.5,
  },
  'gpt-4.1-mini': {
    input: 0.4,
    output: 1.6,
    cache_write: 0.4,
    cache_read: 0.1,
  },
  'gpt-4.1-nano': {
    input: 0.1,
    output: 0.4,
    cache_write: 0.1,
    cache_read: 0.025,
  },
  'gpt-4o': {
    input: 2.5,
    output: 10.0,
    cache_write: 2.5,
    cache_read: 1.25,
  },
  'gpt-4o-mini': {
    input: 0.15,
    output: 0.6,
    cache_write: 0.15,
    cache_read: 0.075,
  },

  // --- Google Gemini ---
  'gemini-2.5-pro': {
    input: 1.25,
    output: 10.0,
    cache_write: 0.125,
    cache_read: 0.125,
  },
  'gemini-2.5-flash': {
    input: 0.3,
    output: 2.5,
    cache_write: 0.03,
    cache_read: 0.03,
  },
  'gemini-2.5-flash-lite': {
    input: 0.1,
    output: 0.4,
    cache_write: 0.01,
    cache_read: 0.01,
  },
  'gemini-2.0-flash': {
    input: 0.1,
    output: 0.4,
    cache_write: 0.025,
    cache_read: 0.025,
  },
} as const;

export type ModelId = keyof typeof PRICING;

// Default to zero-cost when model is unknown; silently using Claude pricing for
// non-Claude models skews usage analytics much more severely than under-reporting.
const DEFAULT_PRICING = {
  input: 0,
  output: 0,
  cache_write: 0,
  cache_read: 0,
} as const;

function getPricingForModel(modelId?: string) {
  if (!modelId) {
    return DEFAULT_PRICING;
  }

  const normalized = modelId.toLowerCase();
  const exact = PRICING[normalized as ModelId];
  if (exact) {
    return exact;
  }

  // Anthropic
  if (normalized.includes('opus')) {
    if (normalized.includes('4.5')) return PRICING['claude-4.5-opus'];
    if (normalized.includes('4.1')) return PRICING['claude-4.1-opus'];
    if (normalized.includes('4')) return PRICING['claude-4-opus'];
    return PRICING['claude-3-opus-20240229'];
  }
  if (normalized.includes('sonnet')) {
    if (normalized.includes('4.5')) return PRICING['claude-4.5-sonnet'];
    if (normalized.includes('4')) return PRICING['claude-4-sonnet'];
    return PRICING['claude-3-5-sonnet-20241022'];
  }
  if (normalized.includes('haiku')) {
    if (normalized.includes('4.5')) return PRICING['claude-4.5-haiku'];
    if (normalized.includes('3.5')) return PRICING['claude-3-5-haiku-20241022'];
    return PRICING['claude-3-haiku-20240307'];
  }

  // OpenAI / Codex family
  if (normalized.includes('gpt-5.4-mini')) return PRICING['gpt-5.4-mini'];
  if (normalized.includes('gpt-5.4-nano')) return PRICING['gpt-5.4-nano'];
  if (normalized.includes('gpt-5.4')) return PRICING['gpt-5.4'];
  if (normalized.includes('gpt-5.2-pro')) return PRICING['gpt-5.2-pro'];
  if (normalized.includes('gpt-5.2')) return PRICING['gpt-5.2'];
  if (normalized.includes('gpt-5.1-codex') || normalized.includes('gpt-5-codex')) {
    return PRICING['gpt-5-codex'];
  }
  if (normalized.includes('gpt-5-pro')) return PRICING['gpt-5-pro'];
  if (normalized.includes('gpt-5-mini') || normalized.includes('codex-mini')) {
    return PRICING['gpt-5-mini'];
  }
  if (normalized.includes('gpt-5-nano')) return PRICING['gpt-5-nano'];
  if (normalized.includes('gpt-5.1') || normalized === 'gpt-5') return PRICING['gpt-5'];
  if (normalized.includes('gpt-4.1-mini')) return PRICING['gpt-4.1-mini'];
  if (normalized.includes('gpt-4.1-nano')) return PRICING['gpt-4.1-nano'];
  if (normalized.includes('gpt-4.1')) return PRICING['gpt-4.1'];
  if (normalized.includes('gpt-4o-mini')) return PRICING['gpt-4o-mini'];
  if (normalized.includes('gpt-4o')) return PRICING['gpt-4o'];

  // Gemini family
  if (normalized.includes('gemini-2.5-pro')) return PRICING['gemini-2.5-pro'];
  if (normalized.includes('gemini-2.5-flash-lite')) return PRICING['gemini-2.5-flash-lite'];
  if (normalized.includes('gemini-2.5-flash')) return PRICING['gemini-2.5-flash'];
  if (normalized.includes('gemini-2.0-flash')) return PRICING['gemini-2.0-flash'];

  return DEFAULT_PRICING;
}

/**
 * Calculate cost for usage
 * @param usage - Usage stats
 * @param modelId - Model ID (optional, defaults to Sonnet 3.5)
 */
export function calculateCost(
  usage: Usage,
  modelId?: string
): { total: number; input: number; output: number } {
  const pricing = getPricingForModel(modelId);

  const inputCost = (usage.input_tokens / 1_000_000) * pricing.input;
  const outputCost = (usage.output_tokens / 1_000_000) * pricing.output;

  // Cache costs
  const cacheWriteCost =
    ((usage.cache_creation_input_tokens || 0) / 1_000_000) * pricing.cache_write;
  const cacheReadCost = ((usage.cache_read_input_tokens || 0) / 1_000_000) * pricing.cache_read;

  const totalInputCost = inputCost + cacheWriteCost + cacheReadCost;

  return {
    total: totalInputCost + outputCost,
    input: totalInputCost,
    output: outputCost,
  };
}
