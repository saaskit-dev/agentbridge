import { getServerUrl } from './serverConfig';
import { AuthCredentials } from '@/auth/tokenStorage';
import { backoff } from '@/utils/time';

export interface UsageDataPoint {
  timestamp: number;
  tokens: Record<string, number>;
  cost: Record<string, number>;
  reportCount: number;
  breakdown?: Record<
    string,
    {
      tokens: Record<string, number>;
      cost: Record<string, number>;
      reportCount: number;
    }
  >;
}

export type UsageGroupDimension = 'none' | 'agent' | 'model' | 'startedBy';
export const UNKNOWN_USAGE_FILTER_VALUE = '__unknown__';

export interface UsageQueryParams {
  sessionId?: string;
  startTime?: number; // Unix timestamp in seconds
  endTime?: number; // Unix timestamp in seconds
  groupBy?: 'hour' | 'day';
  groupDimension?: UsageGroupDimension;
  agent?: string;
  model?: string;
  startedBy?: 'cli' | 'daemon' | 'app' | typeof UNKNOWN_USAGE_FILTER_VALUE;
}

export interface UsageResponse {
  usage: UsageDataPoint[];
  groupDimension?: UsageGroupDimension;
}

/**
 * Query usage data from the server
 */
export async function queryUsage(
  credentials: AuthCredentials,
  params: UsageQueryParams = {}
): Promise<UsageResponse> {
  const API_ENDPOINT = getServerUrl();

  return await backoff(async () => {
    const response = await fetch(`${API_ENDPOINT}/v1/usage/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${credentials.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      if (response.status === 404 && params.sessionId) {
        throw new Error('Session not found');
      }
      throw new Error(`Failed to query usage: ${response.status}`);
    }

    const data = (await response.json()) as UsageResponse;
    return data;
  });
}

/**
 * Helper function to get usage for a specific time period
 */
export async function getUsageForPeriod(
  credentials: AuthCredentials,
  period: 'today' | '7days' | '30days',
  sessionId?: string,
  params: Pick<UsageQueryParams, 'groupDimension' | 'agent' | 'model' | 'startedBy'> = {}
): Promise<UsageResponse> {
  const now = Math.floor(Date.now() / 1000);
  const oneDaySeconds = 24 * 60 * 60;

  let startTime: number;
  let groupBy: 'hour' | 'day';

  switch (period) {
    case 'today':
      // Start of today (local timezone)
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      startTime = Math.floor(today.getTime() / 1000);
      groupBy = 'hour';
      break;
    case '7days':
      startTime = now - 7 * oneDaySeconds;
      groupBy = 'day';
      break;
    case '30days':
      startTime = now - 30 * oneDaySeconds;
      groupBy = 'day';
      break;
  }

  return queryUsage(credentials, {
    sessionId,
    startTime,
    endTime: now,
    groupBy,
    ...params,
  });
}

/**
 * Calculate total tokens and cost from usage data
 */
export function calculateTotals(usage: UsageDataPoint[]): {
  totalTokens: number;
  totalCost: number;
  breakdown: Record<
    string,
    {
      tokens: number;
      cost: number;
      reportCount: number;
    }
  >;
} {
  const result = {
    totalTokens: 0,
    totalCost: 0,
    breakdown: {} as Record<
      string,
      {
        tokens: number;
        cost: number;
        reportCount: number;
      }
    >,
  };

  for (const dataPoint of usage) {
    result.totalTokens += dataPoint.tokens.total || 0;
    result.totalCost += dataPoint.cost.total || 0;

    for (const [label, entry] of Object.entries(dataPoint.breakdown || {})) {
      if (!result.breakdown[label]) {
        result.breakdown[label] = { tokens: 0, cost: 0, reportCount: 0 };
      }
      result.breakdown[label].tokens += entry.tokens.total || 0;
      result.breakdown[label].cost += entry.cost.total || 0;
      result.breakdown[label].reportCount += entry.reportCount || 0;
    }
  }

  return result;
}
