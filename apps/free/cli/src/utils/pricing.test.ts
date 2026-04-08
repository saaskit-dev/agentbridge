import { describe, expect, it } from 'vitest';
import { calculateCost } from './pricing';

describe('calculateCost', () => {
  it('uses GPT-5 Codex pricing for codex-family models', () => {
    const result = calculateCost(
      {
        input_tokens: 1_000_000,
        output_tokens: 1_000_000,
      },
      'gpt-5-codex'
    );

    expect(result).toEqual({
      input: 1.25,
      output: 10,
      total: 11.25,
    });
  });

  it('uses Gemini pricing for gemini-family models', () => {
    const result = calculateCost(
      {
        input_tokens: 1_000_000,
        output_tokens: 1_000_000,
      },
      'gemini-2.5-pro'
    );

    expect(result).toEqual({
      input: 1.25,
      output: 10,
      total: 11.25,
    });
  });

  it('returns zero cost for unknown model families instead of using Claude fallback pricing', () => {
    const result = calculateCost(
      {
        input_tokens: 1_000_000,
        output_tokens: 1_000_000,
      },
      'totally-unknown-model'
    );

    expect(result).toEqual({
      input: 0,
      output: 0,
      total: 0,
    });
  });
});
