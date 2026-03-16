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
import { useStreamingText } from '@/hooks/useStreamingText';

/**
 * StreamingText props
 */
export interface StreamingTextProps {
  /** Session ID for streaming events */
  sessionId: string;
  /** Message ID to match streaming events */
  messageId: string | null;
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
    onTextComplete: (msgId, text) => {
      // Optionally handle completion
    },
  });

  // Determine what text to display
  const isCurrentMessage = state.messageId === messageId;
  const isStreaming = state.isStreaming && isCurrentMessage;
  const displayText =
    isStreaming
      ? state.pendingText
      : state.isComplete && isCurrentMessage && state.finalText
        ? state.finalText
        : finalText;

  // Reset when message ID changes
  useEffect(() => {
    if (messageId && state.messageId && messageId !== state.messageId) {
      reset();
    }
  }, [messageId, state.messageId, reset]);

  // Don't render if no text
  if (!displayText && !isStreaming) {
    return null;
  }

  return (
    <View style={[styles.container, containerStyle]}>
      {useMarkdown ? (
        <MarkdownView markdown={displayText} onOptionPress={onOptionPress} />
      ) : (
        <Text style={[styles.text, textStyle]}>{displayText}</Text>
      )}
      {isStreaming && showCursor && (
        <BlinkingCursor char={cursorChar} interval={cursorBlinkInterval} style={styles.cursor} />
      )}
    </View>
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
    text: string;
    isThinking?: boolean;
  };
  onOptionPress?: (option: Option) => void;
}) {
  return (
    <StreamingText
      sessionId={sessionId}
      messageId={message.id}
      finalText={message.text}
      onOptionPress={onOptionPress}
      useMarkdown
      showCursor
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    flexWrap: 'wrap',
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
