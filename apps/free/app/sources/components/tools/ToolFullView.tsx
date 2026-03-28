import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { Text, View, ScrollView, useWindowDimensions } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { extractErrorMessage } from '@saaskit-dev/agentbridge/common';
import { CodeView } from '../CodeView';
import { toolFullViewStyles } from './toolFullViewStyles';
import { getToolFullViewComponent } from './views/_all';
import { useLocalSetting } from '@/sync/storage';
import { Metadata } from '@/sync/storageTypes';
import { ToolCall, Message } from '@/sync/typesMessage';
import { t } from '@/text';

interface ToolFullViewProps {
  tool: ToolCall;
  metadata?: Metadata | null;
  messages?: Message[];
}

export function ToolFullView({ tool, metadata, messages = [] }: ToolFullViewProps) {
  // Check if there's a specialized content view for this tool
  const SpecializedFullView = getToolFullViewComponent(tool.name);
  const screenWidth = useWindowDimensions().width;
  const devModeEnabled = useLocalSetting('devModeEnabled') || __DEV__;
  const { theme } = useUnistyles();

  const sectionIconColors = {
    info: theme.colors.tool.subtitle,
    input: theme.colors.tool.title,
    output: theme.colors.tool.success,
    error: theme.colors.tool.error,
    empty: theme.colors.tool.success,
    raw: theme.colors.tool.warning,
  } as const;

  return (
    <ScrollView
      style={[toolFullViewStyles.container, { paddingHorizontal: screenWidth > 700 ? 16 : 0 }]}
    >
      <View style={toolFullViewStyles.contentWrapper}>
        {/* Tool-specific content or generic fallback */}
        {SpecializedFullView ? (
          <SpecializedFullView tool={tool} metadata={metadata || null} messages={messages} />
        ) : (
          <>
            {/* Generic fallback for tools without specialized views */}
            {/* Tool Description */}
            {tool.description && (
              <View style={toolFullViewStyles.section}>
                <View style={toolFullViewStyles.sectionHeader}>
                  <Ionicons
                    name="information-circle"
                    size={20}
                    color={sectionIconColors.info}
                  />
                  <Text style={toolFullViewStyles.sectionTitle}>
                    {t('tools.fullView.description')}
                  </Text>
                </View>
                <Text style={toolFullViewStyles.description}>{tool.description}</Text>
              </View>
            )}
            {/* Input Parameters */}
            {tool.input && (
              <View style={toolFullViewStyles.section}>
                <View style={toolFullViewStyles.sectionHeader}>
                  <Ionicons name="log-in" size={20} color={sectionIconColors.input} />
                  <Text style={toolFullViewStyles.sectionTitle}>
                    {t('tools.fullView.inputParams')}
                  </Text>
                </View>
                <CodeView code={JSON.stringify(tool.input, null, 2)} />
              </View>
            )}

            {/* Result/Output */}
            {tool.state === 'completed' && tool.result && (
              <View style={toolFullViewStyles.section}>
                <View style={toolFullViewStyles.sectionHeader}>
                  <Ionicons name="log-out" size={20} color={sectionIconColors.output} />
                  <Text style={toolFullViewStyles.sectionTitle}>{t('tools.fullView.output')}</Text>
                </View>
                <CodeView
                  code={
                    typeof tool.result === 'string'
                      ? tool.result
                      : JSON.stringify(tool.result, null, 2)
                  }
                />
              </View>
            )}

            {/* Error Details */}
            {tool.state === 'error' && tool.result && (
              <View style={toolFullViewStyles.section}>
                <View style={toolFullViewStyles.sectionHeader}>
                  <Ionicons name="close-circle" size={20} color={sectionIconColors.error} />
                  <Text style={toolFullViewStyles.sectionTitle}>{t('tools.fullView.error')}</Text>
                </View>
                <View style={toolFullViewStyles.errorContainer}>
                  <Text style={toolFullViewStyles.errorText}>
                    {extractErrorMessage(tool.result)}
                  </Text>
                </View>
              </View>
            )}

            {/* No Output Message */}
            {tool.state === 'completed' && !tool.result && (
              <View style={toolFullViewStyles.section}>
                <View style={toolFullViewStyles.emptyOutputContainer}>
                  <Ionicons
                    name="checkmark-circle-outline"
                    size={48}
                    color={sectionIconColors.empty}
                  />
                  <Text style={toolFullViewStyles.emptyOutputText}>
                    {t('tools.fullView.completed')}
                  </Text>
                  <Text style={toolFullViewStyles.emptyOutputSubtext}>
                    {t('tools.fullView.noOutput')}
                  </Text>
                </View>
              </View>
            )}
          </>
        )}

        {/* Raw JSON View (Dev Mode Only) */}
        {devModeEnabled && (
          <View style={toolFullViewStyles.section}>
            <View style={toolFullViewStyles.sectionHeader}>
              <Ionicons name="code-slash" size={20} color={sectionIconColors.raw} />
              <Text style={toolFullViewStyles.sectionTitle}>
                {t('tools.fullView.rawJsonDevMode')}
              </Text>
            </View>
            <CodeView
              code={JSON.stringify(
                {
                  name: tool.name,
                  state: tool.state,
                  description: tool.description,
                  input: tool.input,
                  result: tool.result,
                  createdAt: tool.createdAt,
                  startedAt: tool.startedAt,
                  completedAt: tool.completedAt,
                  permission: tool.permission,
                  messages,
                },
                null,
                2
              )}
            />
          </View>
        )}
      </View>
    </ScrollView>
  );
}
