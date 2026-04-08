import { describe, expect, it } from 'vitest';
import {
  aggregateUsageReports,
  getUsageReportTimestampMs,
  UNKNOWN_USAGE_FILTER_VALUE,
  type UsageReportRecord,
} from '../usageAggregation';

describe('getUsageReportTimestampMs', () => {
  it('prefers the usage event timestamp over row creation time', () => {
    const createdAt = new Date('2026-04-07T00:00:00.000Z');
    const timestamp = Date.parse('2026-04-08T12:34:56.000Z');

    expect(
      getUsageReportTimestampMs({
        createdAt,
        data: {
          tokens: { total: 100 },
          cost: { total: 1 },
          timestamp,
        },
      })
    ).toBe(timestamp);
  });

  it('falls back to row creation time for legacy reports', () => {
    const createdAt = new Date('2026-04-07T00:00:00.000Z');

    expect(
      getUsageReportTimestampMs({
        createdAt,
        data: {
          tokens: { total: 100 },
          cost: { total: 1 },
        },
      })
    ).toBe(createdAt.getTime());
  });

  it('uses updatedAt for legacy rows that were repeatedly overwritten', () => {
    const createdAt = new Date('2026-04-01T00:00:00.000Z');
    const updatedAt = new Date('2026-04-08T09:30:00.000Z');

    expect(
      getUsageReportTimestampMs({
        createdAt,
        updatedAt,
        data: {
          tokens: { total: 100 },
          cost: { total: 1 },
        },
      })
    ).toBe(updatedAt.getTime());
  });
});

describe('aggregateUsageReports', () => {
  it('filters and groups using usage timestamps instead of row creation time', () => {
    const reports: UsageReportRecord[] = [
      {
        createdAt: new Date('2026-04-01T00:00:00.000Z'),
        data: {
          timestamp: Date.parse('2026-04-07T03:15:00.000Z'),
          tokens: { total: 120, input: 80, output: 40 },
          cost: { total: 0.25 },
        },
      },
      {
        createdAt: new Date('2026-04-01T00:05:00.000Z'),
        data: {
          timestamp: Date.parse('2026-04-07T11:30:00.000Z'),
          tokens: { total: 30, input: 20, output: 10 },
          cost: { total: 0.05 },
        },
      },
      {
        createdAt: new Date('2026-04-01T00:10:00.000Z'),
        data: {
          timestamp: Date.parse('2026-04-06T23:59:59.000Z'),
          tokens: { total: 999 },
          cost: { total: 9.99 },
        },
      },
    ];

    const result = aggregateUsageReports(reports, {
      startTime: Math.floor(Date.parse('2026-04-07T00:00:00.000Z') / 1000),
      endTime: Math.floor(Date.parse('2026-04-07T23:59:59.000Z') / 1000),
      groupBy: 'day',
    });
    const localBucketStart = Math.floor(new Date(2026, 3, 7, 0, 0, 0, 0).getTime() / 1000);

    expect(result).toEqual([
      {
        timestamp: localBucketStart,
        tokens: { total: 150, input: 100, output: 50 },
        cost: { total: 0.3 },
        reportCount: 2,
      },
    ]);
  });

  it('keeps legacy overwritten rows visible by falling back to updatedAt', () => {
    const reports = [
      {
        createdAt: new Date('2026-04-01T00:00:00.000Z'),
        updatedAt: new Date('2026-04-08T09:30:00.000Z'),
        data: {
          tokens: { total: 80, input: 50, output: 30 },
          cost: { total: 0.16 },
        },
      },
    ];

    const result = aggregateUsageReports(reports, {
      startTime: Math.floor(Date.parse('2026-04-08T00:00:00.000Z') / 1000),
      endTime: Math.floor(Date.parse('2026-04-08T23:59:59.000Z') / 1000),
      groupBy: 'day',
    });
    const localBucketStart = Math.floor(new Date(2026, 3, 8, 0, 0, 0, 0).getTime() / 1000);

    expect(result).toEqual([
      {
        timestamp: localBucketStart,
        tokens: { total: 80, input: 50, output: 30 },
        cost: { total: 0.16 },
        reportCount: 1,
      },
    ]);
  });

  it('adds per-dimension breakdowns when grouping by agent', () => {
    const reports = [
      {
        createdAt: new Date('2026-04-08T01:00:00.000Z'),
        data: {
          timestamp: Date.parse('2026-04-08T10:00:00.000Z'),
          agentType: 'claude',
          model: 'claude-sonnet',
          startedBy: 'cli' as const,
          tokens: { total: 100, input: 60, output: 40 },
          cost: { total: 0.2 },
        },
      },
      {
        createdAt: new Date('2026-04-08T01:05:00.000Z'),
        data: {
          timestamp: Date.parse('2026-04-08T11:00:00.000Z'),
          agentType: 'codex',
          model: 'gpt-5.4',
          startedBy: 'app' as const,
          tokens: { total: 50, input: 20, output: 30 },
          cost: { total: 0.12 },
        },
      },
    ];

    const result = aggregateUsageReports(reports, {
      startTime: Math.floor(Date.parse('2026-04-08T00:00:00.000Z') / 1000),
      endTime: Math.floor(Date.parse('2026-04-08T23:59:59.000Z') / 1000),
      groupBy: 'day',
      groupDimension: 'agent',
    });
    const localBucketStart = Math.floor(new Date(2026, 3, 8, 0, 0, 0, 0).getTime() / 1000);

    expect(result).toEqual([
      {
        timestamp: localBucketStart,
        tokens: { total: 150, input: 80, output: 70 },
        cost: { total: 0.32 },
        reportCount: 2,
        breakdown: {
          claude: {
            tokens: { total: 100, input: 60, output: 40 },
            cost: { total: 0.2 },
            reportCount: 1,
          },
          codex: {
            tokens: { total: 50, input: 20, output: 30 },
            cost: { total: 0.12 },
            reportCount: 1,
          },
        },
      },
    ]);
  });

  it('filters by usage dimensions before aggregating', () => {
    const reports = [
      {
        createdAt: new Date('2026-04-08T01:00:00.000Z'),
        data: {
          timestamp: Date.parse('2026-04-08T10:00:00.000Z'),
          agentType: 'claude',
          model: 'claude-sonnet',
          startedBy: 'cli' as const,
          tokens: { total: 100 },
          cost: { total: 0.2 },
        },
      },
      {
        createdAt: new Date('2026-04-08T01:05:00.000Z'),
        data: {
          timestamp: Date.parse('2026-04-08T11:00:00.000Z'),
          agentType: 'claude',
          model: 'claude-sonnet',
          startedBy: 'app' as const,
          tokens: { total: 50 },
          cost: { total: 0.1 },
        },
      },
    ];

    const result = aggregateUsageReports(reports, {
      startTime: Math.floor(Date.parse('2026-04-08T00:00:00.000Z') / 1000),
      endTime: Math.floor(Date.parse('2026-04-08T23:59:59.000Z') / 1000),
      groupBy: 'day',
      groupDimension: 'startedBy',
      filters: {
        startedBy: 'cli',
      },
    });
    const localBucketStart = Math.floor(new Date(2026, 3, 8, 0, 0, 0, 0).getTime() / 1000);

    expect(result).toEqual([
      {
        timestamp: localBucketStart,
        tokens: { total: 100 },
        cost: { total: 0.2 },
        reportCount: 1,
        breakdown: {
          cli: {
            tokens: { total: 100 },
            cost: { total: 0.2 },
            reportCount: 1,
          },
        },
      },
    ]);
  });

  it('filters missing dimension values when the unknown bucket is selected', () => {
    const reports = [
      {
        createdAt: new Date('2026-04-08T01:00:00.000Z'),
        data: {
          timestamp: Date.parse('2026-04-08T10:00:00.000Z'),
          tokens: { total: 40 },
          cost: { total: 0.08 },
        },
      },
      {
        createdAt: new Date('2026-04-08T01:05:00.000Z'),
        data: {
          timestamp: Date.parse('2026-04-08T11:00:00.000Z'),
          agentType: 'claude',
          model: 'claude-sonnet',
          startedBy: 'app' as const,
          tokens: { total: 50 },
          cost: { total: 0.1 },
        },
      },
    ];

    const result = aggregateUsageReports(reports, {
      startTime: Math.floor(Date.parse('2026-04-08T00:00:00.000Z') / 1000),
      endTime: Math.floor(Date.parse('2026-04-08T23:59:59.000Z') / 1000),
      groupBy: 'day',
      groupDimension: 'agent',
      filters: {
        agentUnknown: true,
      },
    });
    const localBucketStart = Math.floor(new Date(2026, 3, 8, 0, 0, 0, 0).getTime() / 1000);

    expect(result).toEqual([
      {
        timestamp: localBucketStart,
        tokens: { total: 40 },
        cost: { total: 0.08 },
        reportCount: 1,
        breakdown: {
          unknown: {
            tokens: { total: 40 },
            cost: { total: 0.08 },
            reportCount: 1,
          },
        },
      },
    ]);
  });

  it('accepts the unknown sentinel for startedBy filters via route-level mapping', () => {
    const reports = [
      {
        createdAt: new Date('2026-04-08T01:00:00.000Z'),
        data: {
          timestamp: Date.parse('2026-04-08T10:00:00.000Z'),
          tokens: { total: 25 },
          cost: { total: 0.05 },
        },
      },
      {
        createdAt: new Date('2026-04-08T01:05:00.000Z'),
        data: {
          timestamp: Date.parse('2026-04-08T11:00:00.000Z'),
          startedBy: 'cli' as const,
          tokens: { total: 70 },
          cost: { total: 0.14 },
        },
      },
    ];

    const result = aggregateUsageReports(reports, {
      startTime: Math.floor(Date.parse('2026-04-08T00:00:00.000Z') / 1000),
      endTime: Math.floor(Date.parse('2026-04-08T23:59:59.000Z') / 1000),
      groupBy: 'day',
      groupDimension: 'startedBy',
      filters: {
        startedByUnknown: UNKNOWN_USAGE_FILTER_VALUE === '__unknown__',
      },
    });
    const localBucketStart = Math.floor(new Date(2026, 3, 8, 0, 0, 0, 0).getTime() / 1000);

    expect(result).toEqual([
      {
        timestamp: localBucketStart,
        tokens: { total: 25 },
        cost: { total: 0.05 },
        reportCount: 1,
        breakdown: {
          unknown: {
            tokens: { total: 25 },
            cost: { total: 0.05 },
            reportCount: 1,
          },
        },
      },
    ]);
  });
});
