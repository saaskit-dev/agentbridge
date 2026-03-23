import * as React from 'react';
import { View, Text } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { ToolSectionView } from '../../tools/ToolSectionView';
import { ToolViewProps } from './types';

/**
 * Parse tool.result into an array of tool references.
 *
 * After normalization, tool.result can be:
 * - An array of {type, tool_name} objects (direct from Claude API)
 * - A JSON string containing such an array
 * - A string containing <functions> XML block
 * - An object with a .tools array
 */
function parseResults(result: any): Array<{ type?: string; tool_name?: string; name?: string }> {
  if (!result) return [];

  // Claude API content blocks: [{type: "text", text: "..."}]
  // Must check before generic Array.isArray — these are NOT tool reference objects.
  if (
    Array.isArray(result) &&
    result.length > 0 &&
    result[0]?.type === 'text' &&
    typeof result[0]?.text === 'string'
  ) {
    const combinedText = result.map((b: any) => b.text ?? '').join('\n');
    return parseResults(combinedText);
  }

  // Direct array of tool reference objects
  if (Array.isArray(result)) return result;

  // Object with .tools array
  if (Array.isArray(result?.tools)) return result.tools;

  // JSON string → try parse
  if (typeof result === 'string') {
    const trimmed = result.trim();
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed;
        if (Array.isArray(parsed?.tools)) return parsed.tools;
      } catch {
        // not JSON
      }
    }

    // <functions> block → extract tool names from <function> tags
    const names: Array<{ tool_name: string }> = [];
    const re = /"name"\s*:\s*"([^"]+)"/g;
    let m;
    while ((m = re.exec(trimmed)) !== null) {
      names.push({ tool_name: m[1] });
    }
    if (names.length > 0) return names;
  }

  return [];
}

export const ToolSearchView = React.memo<ToolViewProps>(({ tool }) => {
  const results = parseResults(tool.result);

  if (results.length === 0 && tool.state === 'completed') {
    return (
      <ToolSectionView>
        <Text style={styles.emptyText}>No tools found</Text>
      </ToolSectionView>
    );
  }

  if (results.length === 0) {
    return null;
  }

  return (
    <ToolSectionView title={`${results.length} tool${results.length > 1 ? 's' : ''} found`}>
      <View style={styles.list}>
        {results.map((item, index) => {
          const name = item.tool_name || item.name || 'unknown';
          const display = formatToolName(name);
          return (
            <View key={name + index} style={styles.item}>
              <Ionicons name="extension-puzzle-outline" size={14} style={styles.itemIcon} />
              <Text style={styles.itemText} numberOfLines={1}>
                {display}
              </Text>
            </View>
          );
        })}
      </View>
    </ToolSectionView>
  );
});

function formatToolName(name: string): string {
  // mcp__free__change_title → free / change_title
  const parts = name.split('__');
  if (parts.length >= 3 && parts[0] === 'mcp') {
    return `${parts[1]} / ${parts.slice(2).join('__')}`;
  }
  // select:xxx → xxx
  if (name.startsWith('select:')) {
    return name.slice(7);
  }
  return name;
}

const styles = StyleSheet.create(theme => ({
  list: {
    gap: 6,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
    paddingHorizontal: 8,
    backgroundColor: theme.colors.surfaceHigh,
    borderRadius: 6,
  },
  itemIcon: {
    color: theme.colors.textSecondary,
  },
  itemText: {
    fontSize: 13,
    fontFamily: 'monospace',
    color: theme.colors.text,
    flex: 1,
  },
  emptyText: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    fontStyle: 'italic',
  },
}));
