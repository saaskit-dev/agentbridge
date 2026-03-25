import * as React from 'react';
import { Text, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { knownTools } from '@/components/tools/knownTools';
import { getToolHeaderIcon, getToolSubtitle, getToolTitle } from '@/components/tools/toolPresentation';
import { Metadata } from '@/sync/storageTypes';
import { ToolCall } from '@/sync/typesMessage';

interface ToolHeaderProps {
  tool: ToolCall;
  metadata: Metadata | null;
}

export function ToolHeader({ tool, metadata }: ToolHeaderProps) {
  const { theme } = useUnistyles();
  const knownTool = knownTools[tool.name as keyof typeof knownTools] as any;

  // Extract status first for Bash tool to potentially use as title
  let status: string | null = null;
  if (knownTool && typeof knownTool.extractStatus === 'function') {
    const extractedStatus = knownTool.extractStatus({ tool, metadata });
    if (typeof extractedStatus === 'string' && extractedStatus) {
      status = extractedStatus;
    }
  }

  const toolTitle = getToolTitle(tool, metadata);
  const icon = getToolHeaderIcon(tool, metadata, 18, theme.colors.header.tint);
  const subtitle = getToolSubtitle(tool, metadata);

  return (
    <View style={styles.container}>
      <View style={styles.titleContainer}>
        <View style={styles.titleRow}>
          {icon}
          <Text style={styles.title} numberOfLines={1}>
            {toolTitle}
          </Text>
        </View>
        {subtitle && (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create(theme => ({
  container: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    flexGrow: 1,
    flexBasis: 0,
    paddingHorizontal: 4,
  },
  titleContainer: {
    flexDirection: 'column',
    alignItems: 'center',
    flexGrow: 1,
    flexBasis: 0,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  title: {
    fontSize: 14,
    fontWeight: '500',
    color: theme.colors.text,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 11,
    color: theme.colors.textSecondary,
    textAlign: 'center',
    marginTop: 2,
  },
}));
