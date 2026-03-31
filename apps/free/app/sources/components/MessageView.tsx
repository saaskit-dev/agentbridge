import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import * as React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Pressable, Platform } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { layout } from './layout';
import { MarkdownView } from './markdown/MarkdownView';
import { Option } from './markdown/MarkdownView';
import { StreamingAgentText } from './StreamingText';

import { ToolView } from './tools/ToolView';
import { useLocalSetting, useSetting, useSession } from '@/sync/storage';
import { Metadata } from '@/sync/storageTypes';
import { sync } from '@/sync/sync';
import { Message, UserTextMessage, AgentTextMessage, ToolCallMessage } from '@/sync/typesMessage';
import { AgentEvent } from '@/sync/typesRaw';
import { apiSocket } from '@/sync/apiSocket';
import { getAttachmentLocalUri, loadAttachmentUri } from '@/sync/attachmentUpload';
import { Modal } from '@/modal';
import { t } from '@/text';
import { Logger, toError } from '@saaskit-dev/agentbridge/telemetry';
const logger = new Logger('app/components/MessageView');

export const MessageView = React.memo(function MessageView(props: {
  message: Message;
  metadata: Metadata | null;
  sessionId: string;
  getMessageById?: (id: string) => Message | null;
}) {
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
});

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
      return (
        <AgentEventBlock
          event={props.message.event}
          metadata={props.metadata}
          sessionId={props.sessionId}
        />
      );

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
  React.useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );
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
function DevTraceBadge(props: {
  traceId?: string;
  id: string;
  alignSelf?: 'flex-start' | 'flex-end';
}) {
  const devModeEnabled = useLocalSetting('devModeEnabled') || __DEV__;
  const showDebugIds = useLocalSetting('showDebugIds');
  if (!devModeEnabled || !showDebugIds) return null;
  return (
    <View
      style={[
        styles.devBadgeContainer,
        props.alignSelf ? { alignSelf: props.alignSelf } : undefined,
      ]}
    >
      {!!props.traceId && <CopyableDevText label="trace" value={props.traceId} color="#888" />}
      <CopyableDevText label="id" value={props.id} color="#aaa" />
    </View>
  );
}

// --- Attachment thumbnails & fullscreen preview ---

type AttachmentInfo = { id: string; mimeType: string; thumbhash?: string; filename?: string };

const THUMB_SIZE_SINGLE = 180;
const THUMB_SIZE_MULTI = 72;
const THUMB_RADIUS = 6;

function AttachmentThumbnails({
  attachments,
  onPress,
  sessionId,
}: {
  attachments: AttachmentInfo[];
  onPress: (uri: string) => void;
  sessionId: string;
}) {
  const count = attachments.length;
  const size = count === 1 ? THUMB_SIZE_SINGLE : THUMB_SIZE_MULTI;

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 8, marginBottom: 4 }}>
      {attachments.map(att => (
        <AttachmentThumb
          key={att.id}
          att={att}
          size={size}
          onPress={onPress}
          sessionId={sessionId}
        />
      ))}
    </View>
  );
}

/**
 * Single attachment thumbnail with async URI loading.
 * On native the sync filesystem check resolves instantly (no flash).
 * On web, IndexedDB blobs are loaded asynchronously via useEffect.
 */
function AttachmentThumb({
  att,
  size,
  onPress,
  sessionId,
}: {
  att: AttachmentInfo;
  size: number;
  onPress: (uri: string) => void;
  sessionId: string;
}) {
  const [uri, setUri] = React.useState(() => getAttachmentLocalUri(att.id, att.mimeType));

  React.useEffect(() => {
    if (uri) return;
    let cancelled = false;
    loadAttachmentUri(att.id, att.mimeType, sessionId).then(loaded => {
      if (loaded && !cancelled) setUri(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [att.id, att.mimeType, sessionId, uri]);

  return (
    <Pressable
      onPress={() => uri && onPress(uri)}
      style={{
        width: size,
        height: size,
        borderRadius: THUMB_RADIUS,
        overflow: 'hidden',
        backgroundColor: '#e8e8e8',
      }}
    >
      {uri ? (
        <Image source={{ uri }} style={{ width: size, height: size }} contentFit="cover" />
      ) : att.thumbhash ? (
        <Image
          style={{ width: size, height: size }}
          placeholder={{ thumbhash: att.thumbhash }}
          contentFit="cover"
        />
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 10, color: '#aaa' }}>IMG</Text>
        </View>
      )}
    </Pressable>
  );
}

// Re-export shared modal for local use
import { ImagePreviewModal } from './ImagePreviewModal';

function UserTextBlock(props: { message: UserTextMessage; sessionId: string }) {
  const handleOptionPress = React.useCallback(
    (option: Option) => {
      void sync.sendMessage(props.sessionId, option.title).then(result => {
        if (!result.ok) {
          Modal.alert(
            t('common.error'),
            result.reason === 'server_disconnected'
              ? t('session.sendBlockedServerDisconnected')
              : t('session.sendBlockedDaemonOffline')
          );
        }
      });
    },
    [props.sessionId]
  );

  const attachments = props.message.attachments;
  const [previewUri, setPreviewUri] = React.useState<string | null>(null);

  return (
    <View style={styles.userMessageContainer}>
      <View style={styles.userMessageBubble}>
        {attachments && attachments.length > 0 && (
          <AttachmentThumbnails
            attachments={attachments}
            onPress={setPreviewUri}
            sessionId={props.sessionId}
          />
        )}
        {props.message.text ? (
          <MarkdownView
            markdown={props.message.displayText || props.message.text}
            onOptionPress={handleOptionPress}
          />
        ) : null}
      </View>
      <DevTraceBadge traceId={props.message.traceId} id={props.message.id} alignSelf="flex-end" />
      {previewUri && <ImagePreviewModal uri={previewUri} onClose={() => setPreviewUri(null)} />}
    </View>
  );
}

function ThinkingBlock(props: { message: AgentTextMessage; sessionId: string }) {
  const { theme } = useUnistyles();
  const isSessionThinking = useSession(props.sessionId)?.thinking ?? false;

  // Track whether the user has manually toggled this block.
  // Once manually toggled, auto-expand/collapse is disabled.
  const manualRef = React.useRef(false);
  const [isCollapsed, setIsCollapsed] = React.useState(true);

  React.useEffect(() => {
    if (manualRef.current) return;
    // Auto-expand when session starts thinking, auto-collapse when it stops
    setIsCollapsed(!isSessionThinking);
  }, [isSessionThinking]);

  // Strip the "*Thinking...*\n\n" prefix added by the reducer for display
  const contentText = props.message.text.replace(/^\*Thinking\.\.\.\*\n\n/, '');
  const messageId = props.message.sourceId ?? props.message.id;

  return (
    <View
      style={[
        styles.toolContainer,
        {
          backgroundColor: theme.colors.tool.cardBackground,
          borderRadius: theme.borderRadius.lg,
          marginVertical: 4,
          overflow: 'hidden',
        },
      ]}
    >
      <Pressable
        onPress={() => {
          manualRef.current = true;
          setIsCollapsed(c => !c);
        }}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingVertical: 8,
          paddingHorizontal: 12,
          backgroundColor: theme.colors.tool.headerBackground,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ fontSize: 13 }}>💭</Text>
          <Text style={{ color: theme.colors.agentEventText, fontSize: 13, fontStyle: 'italic' }}>
            Thinking
          </Text>
        </View>
        <Text style={{ color: theme.colors.agentEventText, fontSize: 11 }}>
          {isCollapsed ? '▶' : '▼'}
        </Text>
      </Pressable>
      {!isCollapsed && (
        <View style={{ padding: 12, opacity: 0.8 }}>
          <StreamingAgentText
            sessionId={props.sessionId}
            message={{ id: messageId, text: contentText }}
          />
        </View>
      )}
    </View>
  );
}

function AgentTextBlock(props: { message: AgentTextMessage; sessionId: string }) {
  const handleOptionPress = React.useCallback(
    (option: Option) => {
      void sync.sendMessage(props.sessionId, option.title).then(result => {
        if (!result.ok) {
          Modal.alert(
            t('common.error'),
            result.reason === 'server_disconnected'
              ? t('session.sendBlockedServerDisconnected')
              : t('session.sendBlockedDaemonOffline')
          );
        }
      });
    },
    [props.sessionId]
  );

  if (props.message.isThinking) {
    return <ThinkingBlock message={props.message} sessionId={props.sessionId} />;
  }

  return (
    <View style={styles.agentMessageContainer}>
      <StreamingAgentText
        sessionId={props.sessionId}
        message={{
          id: props.message.sourceId ?? props.message.id,
          text: props.message.text,
        }}
        onOptionPress={handleOptionPress}
      />
      <DevTraceBadge traceId={props.message.traceId} id={props.message.id} />
    </View>
  );
}

function AgentEventBlock(props: {
  event: AgentEvent;
  metadata: Metadata | null;
  sessionId: string;
}) {
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
        await apiSocket.sessionRPC<
          { ok: boolean },
          { requestId: string; toolName: string; decision: 'allow' | 'deny' }
        >(props.sessionId, 'permission_response', { requestId, toolName, decision });
        setResolved(decision);
      } catch (error) {
        logger.error('[MessageView] permission_response RPC failed', toError(error), {
          requestId,
          decision,
        });
      } finally {
        setLoadingDecision(null);
      }
    };

    return (
      <View style={styles.permissionRequestContainer}>
        <Text
          style={[
            styles.agentEventText,
            { color: theme.colors.text, fontWeight: '500', marginBottom: 4 },
          ]}
        >
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
              <ActivityIndicator
                size="small"
                color={theme.colors.permissionButton.allow.background}
              />
            ) : (
              <Text
                style={[
                  styles.permissionButtonText,
                  { color: theme.colors.permissionButton.allow.background },
                  resolved === 'allow' && { color: theme.colors.text, fontWeight: '600' },
                ]}
              >
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
              <ActivityIndicator
                size="small"
                color={theme.colors.permissionButton.deny.background}
              />
            ) : (
              <Text
                style={[
                  styles.permissionButtonText,
                  { color: theme.colors.permissionButton.deny.background },
                  resolved === 'deny' && { color: theme.colors.text, fontWeight: '600' },
                ]}
              >
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
  if (props.event.type === 'daemon-log') {
    return <DaemonLogBlock event={props.event} />;
  }
  return (
    <View style={styles.agentEventContainer}>
      <Text style={styles.agentEventText}>{t('message.unknownEvent')}</Text>
    </View>
  );
}

function DaemonLogBlock(props: { event: AgentEvent & { type: 'daemon-log' } }) {
  const { theme } = useUnistyles();
  const { level, component, message, error } = props.event;
  const color = level === 'error' ? theme.colors.warningCritical : theme.colors.warning;
  const fullText = `${component}: ${message}${error ? `\n${error}` : ''}`;
  const [copied, setCopied] = React.useState(false);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  const handlePress = React.useCallback(async () => {
    await Clipboard.setStringAsync(fullText);
    setCopied(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 2000);
  }, [fullText]);

  return (
    <Pressable onPress={handlePress} style={[styles.agentEventContainer, { opacity: 0.8 }]}>
      <Text style={[styles.agentEventText, { color, fontSize: 11 }]}>
        {component}: {message}
        {error ? `\n${error}` : ''}
      </Text>
      {copied && (
        <Text
          style={[
            styles.agentEventText,
            { color: theme.colors.success, fontSize: 11, marginLeft: 8 },
          ]}
        >
          ✓
        </Text>
      )}
    </Pressable>
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
    paddingHorizontal: 5,
    paddingVertical: 1,
    marginTop: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 4,
    alignSelf: 'flex-start',
    gap: 0,
  },
  devBadgeText: {
    fontFamily: 'Courier',
    fontSize: 8,
    lineHeight: 10,
    color: '#4ade80',
  },
}));
