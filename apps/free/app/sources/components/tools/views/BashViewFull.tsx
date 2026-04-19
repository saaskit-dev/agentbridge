import * as React from 'react';
import { View, ScrollView, StyleSheet, Text } from 'react-native';
import { CommandView } from '@/components/CommandView';
import { knownTools } from '@/components/tools/knownTools';
import { Metadata } from '@/sync/storageTypes';
import { ToolCall } from '@/sync/typesMessage';
import { getBashPreviewNotice } from '@/utils/toolResultUtils';

interface BashViewFullProps {
  tool: ToolCall;
  metadata: Metadata | null;
}

export const BashViewFull = React.memo<BashViewFullProps>(({ tool, metadata }) => {
  const { input, result, state } = tool;

  // Parse the result
  let parsedResult: { stdout?: string; stderr?: string; output?: string } | null = null;
  let unparsedOutput: string | null = null;
  let error: string | null = null;
  const previewNotice = getBashPreviewNotice(result);

  if (state === 'completed' && result) {
    if (typeof result === 'string') {
      // Handle unparsed string result
      unparsedOutput = result;
    } else {
      // Try to parse as structured result
      const parsed = knownTools.Bash.result.safeParse(result);
      if (parsed.success) {
        parsedResult = parsed.data;
      } else {
        // If parsing fails but it's not a string, stringify it
        unparsedOutput = JSON.stringify(result);
      }
    }
  } else if (state === 'error' && typeof result === 'string') {
    error = result;
  }

  return (
    <View style={styles.container}>
      <View style={styles.terminalContainer}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={true}
          contentContainerStyle={styles.scrollContent}
        >
          <View style={styles.commandWrapper}>
            {previewNotice ? <Text style={styles.previewNotice}>{previewNotice}</Text> : null}
            <CommandView
              command={input.command}
              stdout={parsedResult?.stdout || parsedResult?.output || unparsedOutput}
              stderr={parsedResult?.stderr}
              error={error}
              fullWidth
            />
          </View>
        </ScrollView>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 0,
    paddingTop: 32,
    paddingBottom: 64,
    marginBottom: 0,
    flex: 1,
  },
  terminalContainer: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  commandWrapper: {
    flex: 1,
    minWidth: '100%',
  },
  previewNotice: {
    marginBottom: 12,
    fontSize: 12,
    lineHeight: 18,
    color: '#9A6A00',
  },
});
