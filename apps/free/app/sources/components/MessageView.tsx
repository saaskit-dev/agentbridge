import * as Clipboard from 'expo-clipboard';
import * as React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Pressable, Platform } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { layout } from './layout';
import { MarkdownView } from './markdown/MarkdownView';
import { Option } from './markdown/MarkdownView';
import { StreamingAgentText } from './StreamingText';
import { ToolView } from './tools/ToolView';
import { useLocalSetting, useSetting } from '@/sync/storage';
import { Metadata } from '@/sync/storageTypes';
import { sync } from '@/sync/sync';
import { Message, UserTextMessage, AgentTextMessage, ToolCallMessage } from '@/sync/typesMessage';
import { AgentEvent } from '@/sync/typesRaw';
import { apiSocket } from '@/sync/apiSocket';
import { t } from '@/text';
import { Logger, toError } from '@saaskit-dev/agentbridge/telemetry';
const logger = new Logger('app/components/MessageView');

export const MessageView = (props: {
  message: Message;
  metadata: Metadata | null;
  sessionId: string;
  getMessageById?: (id: string) => Message | null;
}) => {
  return (
    <View style={styles.messageContainer} renderToHardwareTextureAndroid={true}>
      <View style={styles.messageContent}>
        <RenderBlock
          message={props.message}
          metadata={props.metadata}
          sessionId={props.sessionId}
          getMessageById={props.getMessageById}
        />
      </View>
    </View>
  );
};

// RenderBlock function that dispatches to the correct component based on message kind
function RenderBlock(props: {
  message: Message;
  metadata: Metadata | null;
  sessionId: string;
  getMessageById?: (id: string) => Message | null;
}): React.ReactElement {
  switch (props.message.kind) {
    case 'user-text':
      return <UserTextBlock message={props.message} sessionId={props.sessionId} />;

    case 'agent-text':
      return <AgentTextBlock message={props.message} sessionId={props.sessionId} />;

    case 'tool-call':
      return (
        <ToolCallBlock
          message={props.message}
          metadata={props.metadata}
          sessionId={props.sessionId}
          getMessageById={props.getMessageById}
        />
      );

    case 'agent-event':
      return <AgentEventBlock event={props.message.event} metadata={props.metadata} sessionId={props.sessionId} />;

    default:
      // Exhaustive check - TypeScript will error if we miss a case
      const _exhaustive: never = props.message;
      throw new Error(`Unknown message kind: ${_exhaustive}`);
  }
}

/** Tap-to-copy text badge for dev mode. */
function CopyableDevText({ label, value, color }: { label: string; value: string; color: string }) {
  const [copied, setCopied] = React.useState(false);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
  const handlePress = React.useCallback(async () => {
    await Clipboard.setStringAsync(value);
    setCopied(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 1200);
  }, [value]);
  return (
    <Pressable onPress={handlePress} hitSlop={4}>
      <Text
        style={[
          styles.devBadgeText,
          {
            color: copied ? '#4ade80' : color,
            fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
          },
        ]}
      >
        {copied ? 'copied!' : `${label}:${value}`}
      </Text>
    </Pressable>
  );
}

/** Small monospace overlay shown in dev mode below a message. */
function DevTraceBadge(props: { traceId?: string; id: string; alignSelf?: 'flex-start' | 'flex-end' }) {
  const devModeEnabled = useLocalSetting('devModeEnabled') || __DEV__;
  if (!devModeEnabled) return null;
  return (
    <View style={[styles.devBadgeContainer, props.alignSelf ? { alignSelf: props.alignSelf } : undefined]}>
      {!!props.traceId && (
        <CopyableDevText label="trace" value={props.traceId} color="#888" />
      )}
      <CopyableDevText label="id" value={props.id} color="#aaa" />
    </View>
  );
}

function UserTextBlock(props: { message: UserTextMessage; sessionId: string }) {
  const handleOptionPress = React.useCallback(
    (option: Option) => {
      sync.sendMessage(props.sessionId, option.title);
    },
    [props.sessionId]
  );

  return (
    <View style={styles.userMessageContainer}>
      <View style={styles.userMessageBubble}>
        <MarkdownView
          markdown={props.message.displayText || props.message.text}
          onOptionPress={handleOptionPress}
        />
        {/* {__DEV__ && (
          <Text style={styles.debugText}>{JSON.stringify(props.message.meta)}</Text>
        )} */}
      </View>
      <DevTraceBadge traceId={props.message.traceId} id={props.message.id} alignSelf="flex-end" />
    </View>
  );
}

function AgentTextBlock(props: { message: AgentTextMessage; sessionId: string }) {
  const experiments = useSetting('experiments');
  const handleOptionPress = React.useCallback(
    (option: Option) => {
      sync.sendMessage(props.sessionId, option.title);
    },
    [props.sessionId]
  );

  // Hide thinking messages unless experiments is enabled
  if (props.message.isThinking && !experiments) {
    return null;
  }

  return (
    <View style={styles.agentMessageContainer}>
      <StreamingAgentText
        sessionId={props.sessionId}
        message={{
          id: props.message.sourceId ?? props.message.id,
          text: props.message.text,
          isThinking: props.message.isThinking,
        }}
        onOptionPress={handleOptionPress}
      />
      <DevTraceBadge traceId={props.message.traceId} id={props.message.id} />
    </View>
  );
}

function AgentEventBlock(props: { event: AgentEvent; metadata: Metadata | null; sessionId: string }) {
  const { theme } = useUnistyles();
  const [loadingDecision, setLoadingDecision] = React.useState<'allow' | 'deny' | null>(null);
  const [resolved, setResolved] = React.useState<'allow' | 'deny' | null>(null);

  if (props.event.type === 'permission_request') {
    const { requestId, toolName, permissionMode } = props.event;
    const isPending = resolved === null;

    const handleDecision = async (decision: 'allow' | 'deny') => {
      if (!isPending || loadingDecision !== null) return;
      setLoadingDecision(decision);
      try {
        await apiSocket.sessionRPC<{ ok: boolean }, { requestId: string; toolName: string; decision: 'allow' | 'deny' }>(
          props.sessionId,
          'permission_response',
          { requestId, toolName, decision }
        );
        setResolved(decision);
      } catch (error) {
        logger.error('[MessageView] permission_response RPC failed', toError(error), { requestId, decision });
      } finally {
        setLoadingDecision(null);
      }
    };

    return (
      <View style={styles.permissionRequestContainer}>
        <Text style={[styles.agentEventText, { color: theme.colors.text, fontWeight: '500', marginBottom: 4 }]}>
          {t('message.permissionRequest', { toolName })}
        </Text>
        <Text style={[styles.agentEventText, { fontSize: 12, marginBottom: 8, opacity: 0.6 }]}>
          {t('message.permissionMode', { mode: permissionMode })}
        </Text>
        <View style={styles.permissionButtonRow}>
          <TouchableOpacity
            style={[
              styles.permissionButton,
              styles.permissionButtonAllow,
              !isPending && styles.permissionButtonInactive,
              resolved === 'allow' && styles.permissionButtonSelected,
            ]}
            onPress={() => handleDecision('allow')}
            disabled={!isPending || loadingDecision !== null}
            activeOpacity={0.7}
          >
            {loadingDecision === 'allow' ? (
              <ActivityIndicator size="small" color={theme.colors.permissionButton.allow.background} />
            ) : (
              <Text style={[
                styles.permissionButtonText,
                { color: theme.colors.permissionButton.allow.background },
                resolved === 'allow' && { color: theme.colors.text, fontWeight: '600' },
              ]}>
                {t('common.yes')}
              </Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.permissionButton,
              styles.permissionButtonDeny,
              !isPending && styles.permissionButtonInactive,
              resolved === 'deny' && styles.permissionButtonSelected,
            ]}
            onPress={() => handleDecision('deny')}
            disabled={!isPending || loadingDecision !== null}
            activeOpacity={0.7}
          >
            {loadingDecision === 'deny' ? (
              <ActivityIndicator size="small" color={theme.colors.permissionButton.deny.background} />
            ) : (
              <Text style={[
                styles.permissionButtonText,
                { color: theme.colors.permissionButton.deny.background },
                resolved === 'deny' && { color: theme.colors.text, fontWeight: '600' },
              ]}>
                {t('common.no')}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (props.event.type === 'switch') {
    return (
      <View style={styles.agentEventContainer}>
        <Text style={styles.agentEventText}>
          {t('message.switchedToMode', { mode: props.event.mode })}
        </Text>
      </View>
    );
  }
  if (props.event.type === 'message') {
    return (
      <View style={styles.agentEventContainer}>
        <Text style={styles.agentEventText}>{props.event.message}</Text>
      </View>
    );
  }
  if (props.event.type === 'limit-reached') {
    const formatTime = (timestamp: number): string => {
      try {
        const date = new Date(timestamp * 1000); // Convert from Unix timestamp
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      } catch {
        return t('message.unknownTime');
      }
    };

    return (
      <View style={styles.agentEventContainer}>
        <Text style={styles.agentEventText}>
          {t('message.usageLimitUntil', { time: formatTime(props.event.endsAt) })}
        </Text>
      </View>
    );
  }
  if (props.event.type === 'error') {
    return (
      <View style={styles.agentEventContainer}>
        <Text style={[styles.agentEventText, { color: theme.colors.error }]}>
          {props.event.message}
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.agentEventContainer}>
      <Text style={styles.agentEventText}>{t('message.unknownEvent')}</Text>
    </View>
  );
}

function ToolCallBlock(props: {
  message: ToolCallMessage;
  metadata: Metadata | null;
  sessionId: string;
  getMessageById?: (id: string) => Message | null;
}) {
  if (!props.message.tool) {
    return null;
  }
  return (
    <View style={styles.toolContainer}>
      <ToolView
        tool={props.message.tool}
        metadata={props.metadata}
        messages={props.message.children}
        sessionId={props.sessionId}
        messageId={props.message.id}
      />
      <DevTraceBadge traceId={props.message.traceId} id={props.message.id} />
    </View>
  );
}

const styles = StyleSheet.create(theme => ({
  messageContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  messageContent: {
    flexDirection: 'column',
    flexGrow: 1,
    flexBasis: 0,
    maxWidth: layout.maxWidth,
  },
  userMessageContainer: {
    maxWidth: '100%',
    flexDirection: 'column',
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
  },
  userMessageBubble: {
    backgroundColor: theme.colors.userMessageBackground,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    marginBottom: 12,
    maxWidth: '100%',
  },
  agentMessageContainer: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 16,
    alignSelf: 'flex-start',
  },
  agentEventContainer: {
    marginHorizontal: 8,
    alignItems: 'center',
    paddingVertical: 8,
  },
  agentEventText: {
    color: theme.colors.agentEventText,
    fontSize: 14,
  },
  permissionRequestContainer: {
    marginHorizontal: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  permissionButtonRow: {
    flexDirection: 'row',
    gap: 8,
  },
  permissionButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 36,
    minWidth: 64,
  },
  permissionButtonAllow: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: theme.colors.permissionButton.allow.background,
  },
  permissionButtonDeny: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: theme.colors.permissionButton.deny.background,
  },
  permissionButtonSelected: {
    opacity: 1,
  },
  permissionButtonInactive: {
    opacity: 0.4,
  },
  permissionButtonText: {
    fontSize: 14,
    fontWeight: '500',
  },
  toolContainer: {
    marginHorizontal: 8,
  },
  debugText: {
    color: theme.colors.agentEventText,
    fontSize: 12,
  },
  devBadgeContainer: {
    flexDirection: 'column',
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginTop: 2,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 4,
    alignSelf: 'flex-start',
    gap: 1,
  },
  devBadgeText: {
    fontFamily: 'Courier',
    fontSize: 9,
    color: '#4ade80',
  },
}));
