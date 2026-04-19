import * as React from 'react';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';

type PerfMetric = {
  name: string;
  count: number;
  totalDurationMs: number;
  avgDurationMs: number;
  maxDurationMs: number;
  lastDurationMs: number;
  lastUpdatedAt: number;
};

type PerfSnapshot = {
  metrics: PerfMetric[];
  updatedAt: number;
};

const logger = new Logger('app/dev/performance');
const MAX_METRICS = 24;
const MAX_LOG_INTERVAL_MS = 5_000;
const MAX_TIMELINE_MEASURES = 200;

const listeners = new Set<() => void>();
const metricMap = new Map<string, PerfMetric>();
let snapshot: PerfSnapshot = { metrics: [], updatedAt: 0 };
let lastSummaryLoggedAt = 0;

function isPerformanceProfilingEnabled(): boolean {
  try {
    const { storage } = require('@/sync/storage') as typeof import('@/sync/storage');
    return storage.getState().localSettings.performanceProfilingEnabled === true;
  } catch {
    return false;
  }
}

function publishSnapshot() {
  snapshot = {
    metrics: Array.from(metricMap.values()).sort((left, right) => {
      if (right.lastUpdatedAt !== left.lastUpdatedAt) {
        return right.lastUpdatedAt - left.lastUpdatedAt;
      }
      return right.maxDurationMs - left.maxDurationMs;
    }),
    updatedAt: Date.now(),
  };
  listeners.forEach(listener => listener());
}

function maybeLogSummary() {
  const now = Date.now();
  if (now - lastSummaryLoggedAt < MAX_LOG_INTERVAL_MS) {
    return;
  }
  lastSummaryLoggedAt = now;

  const topMetrics = snapshot.metrics.slice(0, 5).map(metric => ({
    name: metric.name,
    lastMs: Number(metric.lastDurationMs.toFixed(2)),
    avgMs: Number(metric.avgDurationMs.toFixed(2)),
    maxMs: Number(metric.maxDurationMs.toFixed(2)),
    count: metric.count,
  }));

  logger.debug('Desktop performance summary', { metrics: topMetrics });
}

function canUsePerformanceTimeline(): boolean {
  return typeof performance !== 'undefined' && typeof performance.mark === 'function' && typeof performance.measure === 'function';
}

function recordTimelineMeasure(name: string, durationMs: number) {
  if (!canUsePerformanceTimeline()) {
    return;
  }

  try {
    const endTime = performance.now();
    const startTime = Math.max(0, endTime - durationMs);
    performance.measure(name, {
      start: startTime,
      end: endTime,
    });
  } catch {
    // Ignore timeline failures; profiling should stay non-blocking.
  } finally {
    const measures = performance.getEntriesByName(name, 'measure');
    if (measures.length > MAX_TIMELINE_MEASURES) {
      performance.clearMeasures(name);
    }
  }
}

export function resetPerformanceMetrics() {
  metricMap.clear();
  publishSnapshot();
}

export function recordPerformanceMetric(name: string, durationMs: number) {
  if (!isPerformanceProfilingEnabled()) {
    return;
  }

  const now = Date.now();
  const existing = metricMap.get(name);
  if (existing) {
    existing.count += 1;
    existing.totalDurationMs += durationMs;
    existing.avgDurationMs = existing.totalDurationMs / existing.count;
    existing.maxDurationMs = Math.max(existing.maxDurationMs, durationMs);
    existing.lastDurationMs = durationMs;
    existing.lastUpdatedAt = now;
  } else {
    if (metricMap.size >= MAX_METRICS) {
      const oldestMetric = Array.from(metricMap.values()).sort(
        (left, right) => left.lastUpdatedAt - right.lastUpdatedAt
      )[0];
      if (oldestMetric) {
        metricMap.delete(oldestMetric.name);
      }
    }
    metricMap.set(name, {
      name,
      count: 1,
      totalDurationMs: durationMs,
      avgDurationMs: durationMs,
      maxDurationMs: durationMs,
      lastDurationMs: durationMs,
      lastUpdatedAt: now,
    });
  }

  publishSnapshot();
  maybeLogSummary();
  recordTimelineMeasure(name, durationMs);
}

export function measurePerformance<T>(name: string, work: () => T): T {
  if (!isPerformanceProfilingEnabled()) {
    return work();
  }

  const start = performance.now();
  try {
    return work();
  } finally {
    recordPerformanceMetric(name, performance.now() - start);
  }
}

export function recordReactCommit(
  name: string,
  actualDuration: number,
  phase: 'mount' | 'update' | 'nested-update'
) {
  recordPerformanceMetric(`react:${name}:${phase}`, actualDuration);
}

export function usePerformanceSnapshot(): PerfSnapshot {
  return React.useSyncExternalStore(
    React.useCallback(listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }, []),
    () => snapshot,
    () => snapshot
  );
}
