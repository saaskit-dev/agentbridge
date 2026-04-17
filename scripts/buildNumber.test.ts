import { describe, expect, it } from 'vitest';

const { getNextBuildNumber, parseMaxBuildNumber } = require('./buildNumber.js') as {
  getNextBuildNumber: (env?: Record<string, string>) => string;
  parseMaxBuildNumber: (raw: string) => number;
};

describe('scripts/buildNumber.js', () => {
  it('parses the highest ASC build number', () => {
    const raw = JSON.stringify({
      data: [
        { attributes: { version: '41' } },
        { attributes: { version: '43' } },
        { attributes: { version: '42' } },
      ],
    });

    expect(parseMaxBuildNumber(raw)).toBe(43);
  });

  it('falls back to git-based build numbers when ASC is unavailable', () => {
    expect(Number.parseInt(getNextBuildNumber({ ASC_APP_ID: '' }), 10)).toBeGreaterThan(0);
  });
});
