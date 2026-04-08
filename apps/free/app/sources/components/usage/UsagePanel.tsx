import { Ionicons } from '@expo/vector-icons';
import React, { useState, useEffect } from 'react';
import { View, ActivityIndicator, ScrollView, Pressable } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { UsageBar } from './UsageBar';
import { UsageChart } from './UsageChart';
import { useAuth } from '@/auth/AuthContext';
import { ItemGroup } from '@/components/ItemGroup';
import { Text } from '@/components/StyledText';
import {
  getUsageForPeriod,
  calculateTotals,
  UNKNOWN_USAGE_FILTER_VALUE,
  type UsageDataPoint,
  type UsageGroupDimension,
} from '@/sync/apiUsage';
import { t } from '@/text';
import { FreeError } from '@/utils/errors';
import { Logger, toError } from '@saaskit-dev/agentbridge/telemetry';
const logger = new Logger('app/components/usage/UsagePanel');

type TimePeriod = 'today' | '7days' | '30days';
type BreakdownDimension = Exclude<UsageGroupDimension, 'none'>;
const UNKNOWN_BREAKDOWN_LABEL = 'unknown';

function toUsageDimensionFilterValue(value: string | null): string | undefined {
  if (!value) {
    return undefined;
  }
  return value === UNKNOWN_BREAKDOWN_LABEL ? UNKNOWN_USAGE_FILTER_VALUE : value;
}

const styles = StyleSheet.create(theme => ({
  container: {
    flex: 1,
  },
  periodSelector: {
    flexDirection: 'row',
    padding: 16,
    gap: 8,
  },
  periodButton: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: theme.colors.surface,
    alignItems: 'center',
  },
  periodButtonActive: {
    backgroundColor: '#007AFF',
  },
  periodText: {
    fontSize: 14,
    color: theme.colors.text,
    fontWeight: '500',
  },
  periodTextActive: {
    color: '#FFFFFF',
  },
  statsContainer: {
    padding: 16,
    backgroundColor: theme.colors.surface,
    margin: 16,
    borderRadius: 12,
    gap: 12,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 16,
    color: theme.colors.text,
  },
  statValue: {
    fontSize: 20,
    fontWeight: '700',
    color: theme.colors.text,
  },
  chartSection: {
    marginTop: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: theme.colors.text,
    marginHorizontal: 16,
    marginBottom: 8,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  errorContainer: {
    padding: 32,
    alignItems: 'center',
  },
  errorText: {
    fontSize: 14,
    color: theme.colors.status.error,
    textAlign: 'center',
  },
  metricToggle: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    padding: 16,
  },
  filterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  filterText: {
    fontSize: 13,
    color: theme.colors.textSecondary,
  },
  clearFilterButton: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: theme.colors.divider,
  },
  clearFilterText: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.colors.text,
  },
  metricButton: {
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 16,
    backgroundColor: theme.colors.divider,
  },
  metricButtonActive: {
    backgroundColor: '#007AFF',
  },
  metricText: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    fontWeight: '500',
  },
  metricTextActive: {
    color: '#FFFFFF',
  },
}));

type UsagePanelProps = {
  sessionId?: string;
  initialBreakdownDimension?: BreakdownDimension;
  initialSelectedBreakdownValue?: string | null;
  lockSession?: boolean;
};

export const UsagePanel: React.FC<UsagePanelProps> = ({
  sessionId,
  initialBreakdownDimension = 'agent',
  initialSelectedBreakdownValue = null,
  lockSession = false,
}) => {
  const { theme } = useUnistyles();
  const auth = useAuth();
  const [period, setPeriod] = useState<TimePeriod>('7days');
  const [chartMetric, setChartMetric] = useState<'tokens' | 'cost'>('tokens');
  const [breakdownDimension, setBreakdownDimension] =
    useState<BreakdownDimension>(initialBreakdownDimension);
  const [selectedBreakdownValue, setSelectedBreakdownValue] =
    useState<string | null>(initialSelectedBreakdownValue);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usageData, setUsageData] = useState<UsageDataPoint[]>([]);
  const [totals, setTotals] = useState({
    totalTokens: 0,
    totalCost: 0,
    breakdown: {} as Record<string, { tokens: number; cost: number; reportCount: number }>,
  });

  useEffect(() => {
    void loadUsageData();
  }, [period, sessionId, breakdownDimension, selectedBreakdownValue]);

  const loadUsageData = async () => {
    if (!auth.credentials) {
      setError('Not authenticated');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const filterValue = toUsageDimensionFilterValue(selectedBreakdownValue);
      const response = await getUsageForPeriod(auth.credentials, period, sessionId, {
        groupDimension: breakdownDimension,
        agent: breakdownDimension === 'agent' ? filterValue : undefined,
        model: breakdownDimension === 'model' ? filterValue : undefined,
        startedBy:
          breakdownDimension === 'startedBy' && filterValue
            ? (filterValue as 'cli' | 'daemon' | 'app' | typeof UNKNOWN_USAGE_FILTER_VALUE)
            : undefined,
      });
      setUsageData(response.usage || []);
      setTotals(calculateTotals(response.usage || []));
    } catch (err) {
      logger.error('Failed to load usage data:', toError(err));
      if (err instanceof FreeError) {
        setError(err.message);
      } else {
        setError('Failed to load usage data');
      }
    } finally {
      setLoading(false);
    }
  };

  const formatTokens = (tokens: number): string => {
    if (tokens >= 1000000) {
      return `${(tokens / 1000000).toFixed(2)}M`;
    } else if (tokens >= 1000) {
      return `${(tokens / 1000).toFixed(1)}K`;
    }
    return tokens.toLocaleString();
  };

  const formatCost = (cost: number): string => {
    return `$${cost.toFixed(4)}`;
  };

  const periodLabels: Record<TimePeriod, string> = {
    today: t('usage.today'),
    '7days': t('usage.last7Days'),
    '30days': t('usage.last30Days'),
  };
  const breakdownLabels: Record<BreakdownDimension, string> = {
    agent: t('usage.agent'),
    model: t('usage.modelDimension'),
    startedBy: t('usage.source'),
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.errorContainer}>
        <Ionicons name="alert-circle-outline" size={48} color={theme.colors.status.error} />
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }

  const topBreakdown = Object.entries(totals.breakdown)
    .sort(([, a], [, b]) =>
      chartMetric === 'tokens' ? b.tokens - a.tokens : b.cost - a.cost
    )
    .slice(0, 5);
  const maxBreakdownValue = Math.max(
    ...topBreakdown.map(([, value]) => (chartMetric === 'tokens' ? value.tokens : value.cost)),
    1
  );
  const breakdownTitle = breakdownLabels[breakdownDimension];

  return (
    <ScrollView style={styles.container}>
      {/* Period Selector */}
      <View style={styles.periodSelector}>
        {(['today', '7days', '30days'] as TimePeriod[]).map(p => (
          <Pressable
            key={p}
            style={[styles.periodButton, period === p && styles.periodButtonActive]}
            onPress={() => setPeriod(p)}
          >
            <Text style={[styles.periodText, period === p && styles.periodTextActive]}>
              {periodLabels[p]}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Summary Stats */}
      <View style={styles.statsContainer}>
        <View style={styles.statRow}>
          <Text style={styles.statLabel}>{t('usage.totalTokens')}</Text>
          <Text style={styles.statValue}>{formatTokens(totals.totalTokens)}</Text>
        </View>
        <View style={styles.statRow}>
          <Text style={styles.statLabel}>{t('usage.totalCost')}</Text>
          <Text style={styles.statValue}>{formatCost(totals.totalCost)}</Text>
        </View>
      </View>

      {/* Usage Chart */}
      {usageData.length > 0 && (
        <View style={styles.chartSection}>
          <Text style={styles.sectionTitle}>{t('usage.usageOverTime')}</Text>

          {/* Metric Toggle */}
          <View style={styles.metricToggle}>
            <Pressable
              style={[styles.metricButton, chartMetric === 'tokens' && styles.metricButtonActive]}
              onPress={() => setChartMetric('tokens')}
            >
              <Text
                style={[styles.metricText, chartMetric === 'tokens' && styles.metricTextActive]}
              >
                {t('usage.tokens')}
              </Text>
            </Pressable>
            <Pressable
              style={[styles.metricButton, chartMetric === 'cost' && styles.metricButtonActive]}
              onPress={() => setChartMetric('cost')}
            >
              <Text style={[styles.metricText, chartMetric === 'cost' && styles.metricTextActive]}>
                {t('usage.cost')}
              </Text>
            </Pressable>
          </View>

          <UsageChart data={usageData} metric={chartMetric} height={180} />
        </View>
      )}

      {usageData.length === 0 && (
        <View style={styles.errorContainer}>
          <Ionicons name="bar-chart-outline" size={48} color={theme.colors.textSecondary} />
          <Text style={[styles.errorText, { color: theme.colors.textSecondary }]}>
            {t('usage.noData')}
          </Text>
        </View>
      )}

      {usageData.length > 0 && (
        <View style={styles.chartSection}>
          <Text style={styles.sectionTitle}>{t('usage.breakdown')}</Text>
          <View style={styles.metricToggle}>
            {(Object.keys(breakdownLabels) as BreakdownDimension[]).map(option => (
              <Pressable
                key={option}
                style={[
                  styles.metricButton,
                  breakdownDimension === option && styles.metricButtonActive,
                ]}
                onPress={() => {
                  setBreakdownDimension(option);
                  setSelectedBreakdownValue(null);
                }}
              >
                <Text
                  style={[
                    styles.metricText,
                    breakdownDimension === option && styles.metricTextActive,
                  ]}
                >
                  {breakdownLabels[option]}
                </Text>
              </Pressable>
            ))}
          </View>
          {lockSession && sessionId && (
            <View style={styles.filterRow}>
              <Text style={styles.filterText}>{t('usage.sessionOnly')}</Text>
            </View>
          )}
        </View>
      )}

      {topBreakdown.length > 0 && (
        <ItemGroup title={breakdownTitle}>
          {selectedBreakdownValue && (
            <View style={styles.filterRow}>
              <Text style={styles.filterText}>
                {t('usage.filteringBy', {
                  dimension: breakdownLabels[breakdownDimension],
                  value: selectedBreakdownValue,
                })}
              </Text>
              <Pressable
                style={styles.clearFilterButton}
                onPress={() => setSelectedBreakdownValue(null)}
              >
                <Text style={styles.clearFilterText}>{t('usage.clearFilter')}</Text>
              </Pressable>
            </View>
          )}
          <View style={{ padding: 16 }}>
            {topBreakdown.map(([label, values]) => (
              <Pressable
                key={label}
                onPress={() =>
                  setSelectedBreakdownValue(current => (current === label ? null : label))
                }
              >
                <UsageBar
                  label={label}
                  value={chartMetric === 'tokens' ? values.tokens : values.cost}
                  maxValue={maxBreakdownValue}
                  color={
                    selectedBreakdownValue === label
                      ? '#34C759'
                      : chartMetric === 'tokens'
                        ? '#007AFF'
                        : '#FF9500'
                  }
                  formatValue={chartMetric === 'tokens' ? formatTokens : formatCost}
                />
              </Pressable>
            ))}
          </View>
        </ItemGroup>
      )}
    </ScrollView>
  );
};
