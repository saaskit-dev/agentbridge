import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { Text, View, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { knownTools } from '../../tools/knownTools';
import { getToolFamilyLabel, getToolSummary, classifyToolFamily, type ToolFamily } from '../toolPresentation';
import { ToolViewProps } from './types';
import { ToolCall } from '@/sync/typesMessage';
import { t } from '@/text';

interface FilteredTool {
  tool: ToolCall;
  title: string;
  summary: string | null;
  state: 'running' | 'completed' | 'error';
  family: ToolFamily;
}

export const TaskView = React.memo<ToolViewProps>(({ tool, metadata, messages }) => {
  const { theme } = useUnistyles();
  const filtered: FilteredTool[] = [];
  const familyCounts = new Map<ToolFamily, number>();
  let errorCount = 0;
  let runningCount = 0;

  for (const m of messages) {
    if (m.kind === 'tool-call') {
      const knownTool = knownTools[m.tool.name as keyof typeof knownTools] as any;

      // Extract title using extractDescription if available, otherwise use title
      let title = m.tool.name;
      if (knownTool) {
        if (
          'extractDescription' in knownTool &&
          typeof knownTool.extractDescription === 'function'
        ) {
          title = knownTool.extractDescription({ tool: m.tool, metadata });
        } else if (knownTool.title) {
          // Handle optional title and function type
          if (typeof knownTool.title === 'function') {
            title = knownTool.title({ tool: m.tool, metadata });
          } else {
            title = knownTool.title;
          }
        }
      }

      if (m.tool.state === 'running' || m.tool.state === 'completed' || m.tool.state === 'error') {
        const family = classifyToolFamily(m.tool.name);
        familyCounts.set(family, (familyCounts.get(family) || 0) + 1);
        if (m.tool.state === 'error') errorCount += 1;
        if (m.tool.state === 'running') runningCount += 1;
        filtered.push({
          tool: m.tool,
          title,
          summary: getToolSummary(m.tool, metadata),
          state: m.tool.state,
          family,
        });
      }
    }
  }

  const labelForFamily = (family: ToolFamily, count: number) => getToolFamilyLabel(family, count);

  const familyOrder: ToolFamily[] = ['write', 'read', 'shell', 'search', 'browser', 'mcp', 'other'];

  const familyIcons: Record<ToolFamily, keyof typeof Ionicons.glyphMap> = {
    write: 'create-outline',
    read: 'document-text-outline',
    shell: 'terminal-outline',
    search: 'search-outline',
    browser: 'globe-outline',
    mcp: 'extension-puzzle-outline',
    other: 'layers-outline',
  };

  const groupedFamilies = familyOrder
    .map(family => ({
      family,
      count: familyCounts.get(family) || 0,
      items: filtered.filter(item => item.family === family).slice(-2),
    }))
    .filter(group => group.count > 0);

  const styles = StyleSheet.create({
    container: {
      paddingTop: 4,
      paddingBottom: 12,
      gap: 8,
    },
    summaryRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
      paddingHorizontal: 4,
    },
    summaryChip: {
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 999,
      backgroundColor: theme.colors.tool.previewBackground,
      borderWidth: 1,
      borderColor: theme.colors.tool.cardBorder,
    },
    summaryChipText: {
      fontSize: 11,
      fontWeight: '600',
      color: theme.colors.tool.subtitle,
      textTransform: 'uppercase',
      letterSpacing: 0.3,
    },
    groupSection: {
      paddingHorizontal: 4,
      gap: 6,
    },
    groupHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingTop: 4,
    },
    groupTitle: {
      fontSize: 12,
      fontWeight: '700',
      color: theme.colors.tool.title,
      textTransform: 'uppercase',
      letterSpacing: 0.3,
    },
    groupItems: {
      gap: 2,
    },
    toolItem: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      paddingVertical: 4,
      paddingLeft: 28,
      paddingRight: 2,
      gap: 10,
    },
    toolText: {
      flex: 1,
    },
    toolTitle: {
      fontSize: 13,
      fontWeight: '500',
      color: theme.colors.tool.subtitle,
    },
    toolSummary: {
      fontSize: 12,
      lineHeight: 16,
      color: theme.colors.tool.muted,
      marginTop: 1,
    },
    statusContainer: {
      marginLeft: 'auto',
      paddingLeft: 8,
      paddingTop: 2,
    },
    loadingItem: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 8,
      paddingHorizontal: 4,
    },
    loadingText: {
      marginLeft: 8,
      fontSize: 14,
      color: theme.colors.textSecondary,
    },
    moreToolsItem: {
      paddingVertical: 4,
      paddingHorizontal: 4,
    },
    moreToolsText: {
      fontSize: 13,
      color: theme.colors.tool.muted,
      fontStyle: 'italic',
      opacity: 0.7,
    },
  });

  if (filtered.length === 0) {
    return null;
  }

  const familySummaryItems = [...familyCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([family, count]) => ({ family, count }));

  const visibleSummary = [
    ...(runningCount > 0 ? [{ key: 'running', label: `${runningCount} running` }] : []),
    ...(errorCount > 0 ? [{ key: 'errors', label: `${errorCount} errors` }] : []),
    ...familySummaryItems.map(item => ({
      key: `${item.family}-${item.count}`,
      label: labelForFamily(item.family, item.count),
    })),
  ].slice(0, 4);
  const visibleGroups = groupedFamilies.slice(0, 3);
  const remainingCount =
    filtered.length - visibleGroups.reduce((total, group) => total + group.items.length, 0);

  return (
    <View style={styles.container}>
      {visibleSummary.length > 0 && (
        <View style={styles.summaryRow}>
          {visibleSummary.map(item => (
            <View key={item.key} style={styles.summaryChip}>
              <Text style={styles.summaryChipText}>{item.label}</Text>
            </View>
          ))}
        </View>
      )}
      {visibleGroups.map(group => (
        <View key={group.family} style={styles.groupSection}>
          <View style={styles.groupHeader}>
            <Ionicons
              name={familyIcons[group.family]}
              size={14}
              color={theme.colors.tool.muted}
            />
            <Text style={styles.groupTitle}>{labelForFamily(group.family, group.count)}</Text>
          </View>
          <View style={styles.groupItems}>
            {group.items.map((item, index) => (
              <View key={`${group.family}-${item.tool.name}-${index}`} style={styles.toolItem}>
                <View style={styles.toolText}>
                  <Text style={styles.toolTitle} numberOfLines={1}>
                    {item.title}
                  </Text>
                  {item.summary ? (
                    <Text style={styles.toolSummary} numberOfLines={1}>
                      {item.summary}
                    </Text>
                  ) : null}
                </View>
                <View style={styles.statusContainer}>
                  {item.state === 'running' && (
                    <ActivityIndicator
                      size={Platform.OS === 'ios' ? 'small' : (14 as any)}
                      color={theme.colors.tool.running}
                    />
                  )}
                  {item.state === 'completed' && (
                    <Ionicons name="checkmark-circle" size={16} color={theme.colors.tool.success} />
                  )}
                  {item.state === 'error' && (
                    <Ionicons name="close-circle" size={16} color={theme.colors.tool.error} />
                  )}
                </View>
              </View>
            ))}
          </View>
        </View>
      ))}
      {remainingCount > 0 && (
        <View style={styles.moreToolsItem}>
          <Text style={styles.moreToolsText}>
            {t('tools.taskView.moreTools', { count: remainingCount })}
          </Text>
        </View>
      )}
    </View>
  );
});
