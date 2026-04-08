type UsageTotals = Record<string, number>;
export type UsageDimension = 'none' | 'agent' | 'model' | 'startedBy';
export const UNKNOWN_USAGE_FILTER_VALUE = '__unknown__';

export type UsageBreakdownPoint = {
  tokens: UsageTotals;
  cost: UsageTotals;
  reportCount: number;
};

export type UsageReportRecord = {
  createdAt: Date;
  updatedAt?: Date;
  data: {
    tokens: UsageTotals;
    cost: UsageTotals;
    timestamp?: number;
    agentType?: string;
    model?: string;
    startedBy?: 'cli' | 'daemon' | 'app';
  };
};

export type AggregateUsageReportsOptions = {
  startTime?: number;
  endTime?: number;
  groupBy: 'hour' | 'day';
  groupDimension?: UsageDimension;
  filters?: {
    agent?: string;
    model?: string;
    startedBy?: 'cli' | 'daemon' | 'app';
    agentUnknown?: boolean;
    modelUnknown?: boolean;
    startedByUnknown?: boolean;
  };
};

export type AggregatedUsagePoint = {
  timestamp: number;
  tokens: UsageTotals;
  cost: UsageTotals;
  reportCount: number;
  breakdown?: Record<string, UsageBreakdownPoint>;
};

export function getUsageReportTimestampMs(report: UsageReportRecord): number {
  if (typeof report.data.timestamp === 'number') {
    return report.data.timestamp;
  }
  if (report.updatedAt instanceof Date) {
    return report.updatedAt.getTime();
  }
  return report.createdAt.getTime();
}

export function aggregateUsageReports(
  reports: UsageReportRecord[],
  options: AggregateUsageReportsOptions
): AggregatedUsagePoint[] {
  const {
    startTime,
    endTime,
    groupBy,
    groupDimension = 'none',
    filters,
  } = options;
  const startTimeMs = startTime ? startTime * 1000 : undefined;
  const endTimeMs = endTime ? endTime * 1000 : undefined;
  const aggregated = new Map<
    string,
    {
      tokens: UsageTotals;
      cost: UsageTotals;
      reportCount: number;
      timestamp: number;
      breakdown?: Record<string, UsageBreakdownPoint>;
    }
  >();

  const isMissingDimensionValue = (value: string | undefined): boolean => !value;

  for (const report of reports) {
    if (filters?.agentUnknown && !isMissingDimensionValue(report.data.agentType)) {
      continue;
    }
    if (filters?.agent && report.data.agentType !== filters.agent) {
      continue;
    }
    if (filters?.modelUnknown && !isMissingDimensionValue(report.data.model)) {
      continue;
    }
    if (filters?.model && report.data.model !== filters.model) {
      continue;
    }
    if (filters?.startedByUnknown && report.data.startedBy !== undefined) {
      continue;
    }
    if (filters?.startedBy && report.data.startedBy !== filters.startedBy) {
      continue;
    }

    const reportTimestampMs = getUsageReportTimestampMs(report);

    if (startTimeMs !== undefined && reportTimestampMs < startTimeMs) {
      continue;
    }
    if (endTimeMs !== undefined && reportTimestampMs > endTimeMs) {
      continue;
    }

    const reportDate = new Date(reportTimestampMs);
    const bucketDate =
      groupBy === 'hour'
        ? new Date(
            reportDate.getFullYear(),
            reportDate.getMonth(),
            reportDate.getDate(),
            reportDate.getHours(),
            0,
            0,
            0
          )
        : new Date(
            reportDate.getFullYear(),
            reportDate.getMonth(),
            reportDate.getDate(),
            0,
            0,
            0,
            0
          );
    const bucketTimestamp = Math.floor(bucketDate.getTime() / 1000);
    const bucketKey = String(bucketTimestamp);

    if (!aggregated.has(bucketKey)) {
      aggregated.set(bucketKey, {
        tokens: {},
        cost: {},
        reportCount: 0,
        timestamp: bucketTimestamp,
        breakdown: groupDimension === 'none' ? undefined : {},
      });
    }

    const bucket = aggregated.get(bucketKey)!;
    bucket.reportCount += 1;

    for (const [tokenKey, tokenValue] of Object.entries(report.data.tokens)) {
      if (typeof tokenValue === 'number') {
        bucket.tokens[tokenKey] = (bucket.tokens[tokenKey] || 0) + tokenValue;
      }
    }

    for (const [costKey, costValue] of Object.entries(report.data.cost)) {
      if (typeof costValue === 'number') {
        bucket.cost[costKey] = (bucket.cost[costKey] || 0) + costValue;
      }
    }

    if (groupDimension !== 'none' && bucket.breakdown) {
      const dimensionValue =
        groupDimension === 'agent'
          ? report.data.agentType
          : groupDimension === 'model'
            ? report.data.model
            : report.data.startedBy;
      const breakdownKey = dimensionValue || 'unknown';
      const breakdownPoint = (bucket.breakdown[breakdownKey] ??= {
        tokens: {},
        cost: {},
        reportCount: 0,
      });
      breakdownPoint.reportCount += 1;

      for (const [tokenKey, tokenValue] of Object.entries(report.data.tokens)) {
        if (typeof tokenValue === 'number') {
          breakdownPoint.tokens[tokenKey] = (breakdownPoint.tokens[tokenKey] || 0) + tokenValue;
        }
      }

      for (const [costKey, costValue] of Object.entries(report.data.cost)) {
        if (typeof costValue === 'number') {
          breakdownPoint.cost[costKey] = (breakdownPoint.cost[costKey] || 0) + costValue;
        }
      }
    }
  }

  return Array.from(aggregated.values()).sort((a, b) => a.timestamp - b.timestamp);
}
