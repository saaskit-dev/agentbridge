/**
 * StreamingText Component
 *
 * Displays text with typewriter effect.
 * Shows pending streaming text while waiting for completion.
 *
 * @module components/StreamingText
 */

import React, { useEffect, useState, useRef } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { MarkdownView } from './markdown/MarkdownView';
import type { Option } from './markdown/MarkdownView';
import { buildMarkdownViewProps } from './markdown/markdownViewProps';
import { recordReactCommit } from '@/dev/performanceMonitor';
import { useStreamingText } from '@/hooks/useStreamingText';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';

const logger = new Logger('app/components/StreamingText');

/**
 * StreamingText props
 */
export interface StreamingTextProps {
  /** Session ID for streaming events */
  sessionId: string;
  /** Message ID to match streaming events */
  messageId: string | null;
  /** Candidate message IDs to match streaming events after reducer merges */
  messageIds?: string[];
  /** Final text (from message) */
  finalText: string;
  /** Called when an option is pressed */
  onOptionPress?: (option: Option) => void;
  /** Whether to use markdown rendering */
  useMarkdown?: boolean;
  /** Custom style for the container */
  containerStyle?: any;
  /** Custom style for the text */
  textStyle?: any;
  /** Show cursor during streaming */
  showCursor?: boolean;
  /** Cursor character */
  cursorChar?: string;
  /** Cursor blink interval in ms */
  cursorBlinkInterval?: number;
}

/**
 * Cursor component
 */
function Cursor({ visible, char = '▋', style }: { visible: boolean; char?: string; style?: any }) {
  if (!visible) return null;

  return <Text style={[styles.cursor, style]}>{char}</Text>;
}

/**
 * Blinking cursor component
 */
function BlinkingCursor({
  char = '▋',
  interval = 530,
  style,
}: {
  char?: string;
  interval?: number;
  style?: any;
}) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setInterval(() => {
      setVisible(v => !v);
    }, interval);

    return () => clearInterval(timer);
  }, [interval]);

  return <Cursor visible={visible} char={char} style={style} />;
}

/**
 * StreamingText Component
 *
 * Displays text with typewriter effect for streaming messages.
 * When streaming is active, shows the pending text with a blinking cursor.
 * When streaming completes, shows the final text (optionally with markdown).
 *
 * @example
 * ```tsx
 * <StreamingText
 *   sessionId={session.id}
 *   messageId={message.id}
 *   finalText={message.text}
 *   useMarkdown
 *   showCursor
 * />
 * ```
 */
export function StreamingText({
  sessionId,
  messageId,
  messageIds,
  finalText,
  onOptionPress,
  useMarkdown = true,
  containerStyle,
  textStyle,
  showCursor = true,
  cursorChar = '▋',
  cursorBlinkInterval = 530,
}: StreamingTextProps) {
  const { state, reset } = useStreamingText({
    sessionId,
    messageId,
    onTextComplete: (msgId, text) => {
      // Optionally handle completion
    },
  });

  const candidateMessageIds = React.useMemo(() => {
    const ids = new Set<string>();
    if (messageId) ids.add(messageId);
    messageIds?.forEach(id => {
      if (id) ids.add(id);
    });
    return Array.from(ids);
  }, [messageId, messageIds]);

  // Determine what text to display
  const isCurrentMessage =
    !!state.messageId &&
    (candidateMessageIds.length > 0
      ? candidateMessageIds.includes(state.messageId)
      : state.messageId === messageId);
  const isStreaming = state.isStreaming && isCurrentMessage;
  const previousDisplaySignatureRef = useRef<string | null>(null);
  const finalStateLength = state.finalText?.length ?? 0;
  const canUsePendingFallback =
    !isStreaming &&
    state.pendingText.length > finalText.length &&
    (finalText.length === 0 ||
      state.pendingText.startsWith(finalText) ||
      finalText.startsWith(state.pendingText));
  const canUseCompletedFallback =
    state.isComplete &&
    !!state.finalText &&
    state.finalText.length > finalText.length &&
    (finalText.length === 0 ||
      state.finalText.startsWith(finalText) ||
      finalText.startsWith(state.finalText));
  const resolvedDisplayText = isStreaming
    ? state.pendingText
    : state.isComplete && isCurrentMessage && state.finalText
      ? state.finalText
      : canUseCompletedFallback
        ? state.finalText
        : canUsePendingFallback
          ? state.pendingText
          : finalText;
  const displayText = resolvedDisplayText ?? '';

  // Reset when message ID changes
  useEffect(() => {
    if (
      state.messageId &&
      candidateMessageIds.length > 0 &&
      !candidateMessageIds.includes(state.messageId)
    ) {
      reset();
    }
  }, [candidateMessageIds, reset, state.messageId]);

  useEffect(() => {
    const signature = JSON.stringify({
      sessionId,
      messageId,
      messageIds: candidateMessageIds,
      hookMessageId: state.messageId,
      isCurrentMessage,
      isStreaming,
      isComplete: state.isComplete,
      pendingLength: state.pendingText.length,
      finalStateLength,
      finalPropLength: finalText.length,
      displayLength: displayText.length,
      canUsePendingFallback,
      canUseCompletedFallback,
    });

    if (previousDisplaySignatureRef.current === signature) {
      return;
    }

    logger.debug('[streaming-text] display state changed', {
      sessionId,
      messageId,
      messageIds: candidateMessageIds,
      hookMessageId: state.messageId,
      isCurrentMessage,
      isStreaming,
      isComplete: state.isComplete,
      pendingLength: state.pendingText.length,
      finalStateLength,
      finalPropLength: finalText.length,
      displayLength: displayText.length,
    });
    previousDisplaySignatureRef.current = signature;
  }, [
    displayText.length,
    finalText.length,
    candidateMessageIds,
    isCurrentMessage,
    isStreaming,
    messageId,
    sessionId,
    finalStateLength,
    state.isComplete,
    state.messageId,
    state.pendingText.length,
    canUseCompletedFallback,
    canUsePendingFallback,
  ]);

  // Don't render if no text
  if (!displayText && !isStreaming) {
    return null;
  }

  return (
    <React.Profiler
      id="StreamingText"
      onRender={(_, phase, actualDuration) => {
        recordReactCommit('StreamingText', actualDuration, phase);
      }}
    >
    <View style={[styles.container, containerStyle]}>
      {useMarkdown ? (
        <MarkdownView {...buildMarkdownViewProps(displayText, sessionId, onOptionPress)} />
      ) : (
        <Text style={[styles.text, textStyle]}>{displayText}</Text>
      )}
      {isStreaming && showCursor && (
        <BlinkingCursor char={cursorChar} interval={cursorBlinkInterval} style={styles.cursor} />
      )}
    </View>
    </React.Profiler>
  );
}

/**
 * StreamingAgentText - Convenience component for agent messages
 *
 * Combines AgentTextMessage with streaming capability.
 * Falls back to static text if streaming is not available.
 */
export function StreamingAgentText({
  sessionId,
  message,
  onOptionPress,
}: {
  sessionId: string;
  message: {
    id: string;
    sourceId?: string;
    sourceIds?: string[];
    text: string;
    isThinking?: boolean;
  };
  onOptionPress?: (option: Option) => void;
}) {
  return (
    <StreamingText
      sessionId={sessionId}
      messageId={message.sourceId ?? message.id}
      messageIds={message.sourceIds}
      finalText={message.text}
      onOptionPress={onOptionPress}
      useMarkdown
      showCursor
    />
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    minWidth: 0,
    alignItems: 'flex-start',
  },
  text: {
    fontSize: 14,
    lineHeight: 20,
  },
  cursor: {
    fontSize: 14,
    lineHeight: 20,
    opacity: 0.8,
  },
});
