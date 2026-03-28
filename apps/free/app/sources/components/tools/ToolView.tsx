import { Ionicons, Octicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as React from 'react';
import { Text, View, TouchableOpacity, ActivityIndicator, Platform } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { CodeView } from '../CodeView';
import { PermissionFooter } from './PermissionFooter';
import { ToolError } from './ToolError';
import { ToolSectionView } from './ToolSectionView';
import { getToolSummary, getToolTitle } from './toolPresentation';
import { getToolViewComponent } from './views/_all';
import { knownTools } from '@/components/tools/knownTools';
import { useElapsedTime } from '@/hooks/useElapsedTime';
import { Metadata } from '@/sync/storageTypes';
import { Message, ToolCall } from '@/sync/typesMessage';
import { t } from '@/text';
import { parseToolUseError } from '@/utils/toolErrorParser';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';
const logger = new Logger('app/components/tools/ToolView');

interface ToolViewProps {
  metadata: Metadata | null;
  tool: ToolCall;
  messages?: Message[];
  onPress?: () => void;
  sessionId?: string;
  messageId?: string;
}

export const ToolView = React.memo<ToolViewProps>(props => {
  const { tool, onPress, sessionId, messageId } = props;
  const router = useRouter();
  const { theme } = useUnistyles();
  const [isExpanded, setIsExpanded] = React.useState(false);

  const handleOpenDetails = React.useCallback(() => {
    logger.info('tool_card_open', {
      toolName: tool.name,
      state: tool.state,
      sessionId,
      messageId,
      hasPermission: !!tool.permission,
    });
    if (onPress) {
      onPress();
    } else if (sessionId && messageId) {
      router.push(`/session/${sessionId}/message/${messageId}`);
    }
  }, [onPress, sessionId, messageId, router, tool.name, tool.permission, tool.state]);

  const knownTool = knownTools[tool.name as keyof typeof knownTools] as any;

  let description: string | null = null;
  let status: string | null = null;
  let minimal = false;
  let icon = <Ionicons name="construct-outline" size={16} color={theme.colors.textSecondary} />;
  let noStatus = false;
  let hideDefaultError = false;
  let autoCollapseOnSettled = true;

  // For Gemini/OpenCode: unknown tools should be rendered as minimal (hidden)
  // This prevents showing raw INPUT/OUTPUT for internal tools
  // that we haven't explicitly added to knownTools
  const isGemini = props.metadata?.flavor === 'gemini';
  const isOpenCode = props.metadata?.flavor === 'opencode';
  if (!knownTool && (isGemini || isOpenCode)) {
    minimal = true;
  }

  // Extract status first to potentially use as title
  if (knownTool && typeof knownTool.extractStatus === 'function') {
    const state = knownTool.extractStatus({ tool, metadata: props.metadata });
    if (typeof state === 'string' && state) {
      status = state;
    }
  }

  let toolTitle = getToolTitle(tool, props.metadata);

  // Special handling for MCP tools
  if (tool.name.startsWith('mcp__')) {
    icon = (
      <Ionicons name="extension-puzzle-outline" size={16} color={theme.colors.tool.subtitle} />
    );
    minimal = true;
  }

  const summary = getToolSummary(tool, props.metadata);
  if (summary) {
    description = summary;
  }
  if (knownTool && knownTool.minimal !== undefined) {
    if (typeof knownTool.minimal === 'function') {
      minimal = knownTool.minimal({ tool, metadata: props.metadata, messages: props.messages });
    } else {
      minimal = knownTool.minimal;
    }
  }

  // Special handling for CodexBash to determine icon based on parsed_cmd
  if (
    tool.name === 'CodexBash' &&
    tool.input?.parsed_cmd &&
    Array.isArray(tool.input.parsed_cmd) &&
    tool.input.parsed_cmd.length > 0
  ) {
    const parsedCmd = tool.input.parsed_cmd[0];
    if (parsedCmd.type === 'read') {
      icon = <Octicons name="eye" size={16} color={theme.colors.tool.title} />;
    } else if (parsedCmd.type === 'write') {
      icon = <Octicons name="file-diff" size={16} color={theme.colors.tool.title} />;
    } else {
      icon = <Octicons name="terminal" size={16} color={theme.colors.tool.title} />;
    }
  } else if (knownTool && typeof knownTool.icon === 'function') {
    icon = knownTool.icon(16, theme.colors.tool.title);
  }

  if (knownTool && typeof knownTool.noStatus === 'boolean') {
    noStatus = knownTool.noStatus;
  }
  if (knownTool && typeof knownTool.hideDefaultError === 'boolean') {
    hideDefaultError = knownTool.hideDefaultError;
  }
  if (knownTool && typeof knownTool.autoCollapseOnSettled === 'boolean') {
    autoCollapseOnSettled = knownTool.autoCollapseOnSettled;
  }

  let statusIcon = null;

  let isToolUseError = false;
  if (tool.state === 'error' && tool.result && parseToolUseError(tool.result).isToolUseError) {
    isToolUseError = true;
    logger.debug('isToolUseError', tool.result);
  }

  // Permission resolved (approved/denied/canceled) → collapse to minimal header
  const isPermissionResolved =
    tool.permission &&
    tool.permission.status !== 'pending' &&
    // Don't collapse if the tool is still running (approved → executing)
    tool.state !== 'running';
  const isSettled = tool.state !== 'running';

  if (isPermissionResolved) {
    minimal = true;
  }
  if (autoCollapseOnSettled && isSettled && tool.permission?.status !== 'pending') {
    minimal = true;
  }

  React.useEffect(() => {
    if (autoCollapseOnSettled && isSettled) {
      setIsExpanded(false);
    }
  }, [autoCollapseOnSettled, isSettled, tool.completedAt, tool.state]);

  const canOpenDetails = !!(onPress || (sessionId && messageId));
  const canToggleInline = minimal;
  const isContentExpanded = !minimal || isExpanded;
  const showDescription = !!description && isContentExpanded;

  const handleHeaderPress = React.useCallback(() => {
    if (canToggleInline) {
      setIsExpanded(current => !current);
      return;
    }
    if (canOpenDetails) {
      handleOpenDetails();
    }
  }, [canOpenDetails, canToggleInline, handleOpenDetails]);

  // Check permission status first for denied/canceled states
  if (
    tool.permission &&
    (tool.permission.status === 'denied' || tool.permission.status === 'canceled')
  ) {
    statusIcon = (
      <Ionicons name="remove-circle-outline" size={16} color={theme.colors.textSecondary} />
    );
  } else if (
    tool.permission &&
    tool.permission.status === 'approved' &&
    tool.state !== 'running'
  ) {
    statusIcon = <Ionicons name="checkmark-circle" size={16} color={theme.colors.success} />;
  } else if (isToolUseError) {
    statusIcon = (
      <Ionicons name="remove-circle-outline" size={16} color={theme.colors.textSecondary} />
    );
    hideDefaultError = true;
    minimal = true;
  } else {
    switch (tool.state) {
      case 'running':
        if (!noStatus) {
          statusIcon = (
            <ActivityIndicator
              size="small"
              color={theme.colors.tool.running}
              style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
            />
          );
        }
        break;
      case 'completed':
        // if (!noStatus) {
        //     statusIcon = <Ionicons name="checkmark-circle" size={16} color={theme.colors.success} />;
        // }
        break;
      case 'error':
        statusIcon = (
          <Ionicons name="alert-circle-outline" size={16} color={theme.colors.tool.error} />
        );
        break;
    }
  }

  return (
    <View style={styles.container}>
      {canToggleInline || canOpenDetails ? (
        <TouchableOpacity style={styles.header} onPress={handleHeaderPress} activeOpacity={0.8}>
          <View style={styles.headerLeft}>
            <View style={styles.iconContainer}>{icon}</View>
            <View style={styles.titleContainer}>
              <Text style={styles.toolName} numberOfLines={1}>
                {toolTitle}
                {status ? <Text style={styles.status}>{` ${status}`}</Text> : null}
              </Text>
              {showDescription && (
                <Text style={styles.toolDescription} numberOfLines={1}>
                  {description}
                </Text>
              )}
            </View>
            <ToolDuration tool={tool} />
            {statusIcon}
            {canToggleInline ? (
              <Ionicons
                name={isContentExpanded ? 'chevron-up' : 'chevron-down'}
                size={16}
                color={theme.colors.tool.muted}
              />
            ) : null}
          </View>
          {canOpenDetails ? (
            <TouchableOpacity
              onPress={handleOpenDetails}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={styles.detailButton}
            >
              <Ionicons
                name="open-outline"
                size={15}
                color={theme.colors.tool.muted}
              />
            </TouchableOpacity>
          ) : null}
        </TouchableOpacity>
      ) : (
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View style={styles.iconContainer}>{icon}</View>
            <View style={styles.titleContainer}>
              <Text style={styles.toolName} numberOfLines={1}>
                {toolTitle}
                {status ? <Text style={styles.status}>{` ${status}`}</Text> : null}
              </Text>
              {showDescription && (
                <Text style={styles.toolDescription} numberOfLines={1}>
                  {description}
                </Text>
              )}
            </View>
            <ToolDuration tool={tool} />
            {statusIcon}
          </View>
        </View>
      )}

      {/* Content area - either custom children or tool-specific view */}
      {(() => {
        // Check if minimal first - minimal tools don't show content
        if (!isContentExpanded) {
          return null;
        }

        // Try to use a specific tool view component first
        const SpecificToolView = getToolViewComponent(tool.name);
        if (SpecificToolView) {
          return (
            <View style={styles.content}>
              <SpecificToolView
                tool={tool}
                metadata={props.metadata}
                messages={props.messages ?? []}
                sessionId={sessionId}
              />
              {tool.state === 'error' &&
                tool.result &&
                !(
                  tool.permission &&
                  (tool.permission.status === 'denied' || tool.permission.status === 'canceled')
                ) &&
                !hideDefaultError && <ToolError message={tool.result} />}
            </View>
          );
        }

        // Show error state if present (but not for denied/canceled permissions and not when hideDefaultError is true)
        if (
          tool.state === 'error' &&
          tool.result &&
          !(
            tool.permission &&
            (tool.permission.status === 'denied' || tool.permission.status === 'canceled')
          ) &&
          !isToolUseError
        ) {
          return (
            <View style={styles.content}>
              <ToolError message={tool.result} />
            </View>
          );
        }

        // Fall back to default view - only render if there's actual content
        const hasInput = !!tool.input;
        const hasOutput = tool.state === 'completed' && !!tool.result;
        if (!hasInput && !hasOutput) return null;

        return (
          <View style={styles.content}>
            {hasInput && (
              <ToolSectionView title={t('toolView.input')}>
                <CodeView code={JSON.stringify(tool.input, null, 2)} />
              </ToolSectionView>
            )}
            {hasOutput && (
              <ToolSectionView title={t('toolView.output')}>
                <CodeView
                  code={
                    typeof tool.result === 'string'
                      ? tool.result
                      : JSON.stringify(tool.result, null, 2)
                  }
                />
              </ToolSectionView>
            )}
          </View>
        );
      })()}

      {/* Permission footer - only show when pending (collapse after approval/denial) */}
      {/* AskUserQuestion has its own Submit button UI - no permission footer needed */}
      {tool.permission && sessionId && tool.name !== 'AskUserQuestion' && (
        <PermissionFooter
          permission={tool.permission}
          sessionId={sessionId}
          toolName={tool.name}
          toolInput={tool.input}
          metadata={props.metadata}
        />
      )}
    </View>
  );
});

function ToolDuration({ tool }: { tool: ToolCall }) {
  if (tool.state === 'running') {
    return (
      <View style={styles.elapsedContainer}>
        <ElapsedView from={tool.createdAt} />
      </View>
    );
  }
  if ((tool.state === 'completed' || tool.state === 'error') && tool.completedAt) {
    const duration = (tool.completedAt - tool.createdAt) / 1000;
    if (duration < 0.5) return null;
    return (
      <View style={styles.elapsedContainer}>
        <Text style={styles.elapsedText}>{formatDuration(duration)}</Text>
      </View>
    );
  }
  return null;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}m${secs}s`;
}

function ElapsedView(props: { from: number }) {
  const { from } = props;
  const elapsed = useElapsedTime(from);
  return <Text style={styles.elapsedText}>{elapsed.toFixed(1)}s</Text>;
}

const styles = StyleSheet.create(theme => ({
  container: {
    backgroundColor: theme.colors.tool.cardBackground,
    borderRadius: theme.borderRadius.lg,
    marginVertical: 2,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: theme.colors.tool.cardBorder,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
    paddingHorizontal: 9,
    minHeight: 34,
    backgroundColor: theme.colors.tool.headerBackground,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flex: 1,
  },
  iconContainer: {
    width: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.92,
  },
  titleContainer: {
    flex: 1,
  },
  elapsedContainer: {
    marginLeft: 4,
  },
  detailButton: {
    marginLeft: 4,
    width: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  elapsedText: {
    fontSize: 10,
    color: theme.colors.tool.muted,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
  },
  toolName: {
    fontSize: 11,
    fontWeight: '600',
    color: theme.colors.tool.title,
  },
  status: {
    fontWeight: '400',
    opacity: 0.6,
    fontSize: 11,
    color: theme.colors.tool.muted,
  },
  toolDescription: {
    fontSize: 9,
    lineHeight: 11,
    color: theme.colors.tool.subtitle,
    marginTop: 1,
  },
  content: {
    paddingHorizontal: 9,
    paddingTop: 5,
    paddingBottom: 2,
    overflow: 'visible',
  },
}));
