/**
 * OpenCodeDisplay - Ink UI component for OpenCode agent
 *
 * This component provides a terminal UI for the OpenCode agent,
 * displaying messages, status, and handling user input.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Text, useStdout, useInput } from 'ink';
import { MessageBuffer, type BufferedMessage } from './messageBuffer';

interface OpenCodeDisplayProps {
  messageBuffer: MessageBuffer;
  logPath?: string;
  onExit?: () => void;
}

export const OpenCodeDisplay: React.FC<OpenCodeDisplayProps> = ({ messageBuffer, logPath, onExit }) => {
  const [messages, setMessages] = useState<BufferedMessage[]>([]);
  const [confirmationMode, setConfirmationMode] = useState<boolean>(false);
  const [actionInProgress, setActionInProgress] = useState<boolean>(false);
  const confirmationTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const { stdout } = useStdout();
  const terminalWidth = stdout.columns || 80;
  const terminalHeight = stdout.rows || 24;

  useEffect(() => {
    setMessages(messageBuffer.getMessages());

    const unsubscribe = messageBuffer.onUpdate((newMessages) => {
      setMessages(newMessages);
    });

    return () => {
      unsubscribe();
      if (confirmationTimeoutRef.current) {
        clearTimeout(confirmationTimeoutRef.current);
      }
    };
  }, [messageBuffer]);

  const resetConfirmation = useCallback(() => {
    setConfirmationMode(false);
    if (confirmationTimeoutRef.current) {
      clearTimeout(confirmationTimeoutRef.current);
      confirmationTimeoutRef.current = null;
    }
  }, []);

  const setConfirmationWithTimeout = useCallback(() => {
    setConfirmationMode(true);
    if (confirmationTimeoutRef.current) {
      clearTimeout(confirmationTimeoutRef.current);
    }
    confirmationTimeoutRef.current = setTimeout(() => {
      resetConfirmation();
    }, 15000);
  }, [resetConfirmation]);

  useInput(useCallback(async (input, key) => {
    if (actionInProgress) return;

    // Handle Ctrl-C
    if (key.ctrl && input === 'c') {
      if (confirmationMode) {
        // Second Ctrl-C, exit
        resetConfirmation();
        setActionInProgress(true);
        await new Promise(resolve => setTimeout(resolve, 100));
        onExit?.();
      } else {
        // First Ctrl-C, ask for confirmation
        setConfirmationWithTimeout();
      }
    } else if (confirmationMode) {
      // Any other key resets confirmation
      resetConfirmation();
    }
  }, [confirmationMode, actionInProgress, onExit, resetConfirmation, setConfirmationWithTimeout]));

  // Get last N messages to display (leave room for header and status)
  const maxDisplayMessages = terminalHeight - 6;
  const displayMessages = messages.slice(-maxDisplayMessages);

  return (
    <Box flexDirection="column" height={terminalHeight}>
      {/* Header */}
      <Box borderStyle="single" borderColor="cyan" paddingX={1}>
        <Text bold color="cyan">OpenCode Agent</Text>
        <Text dimColor> | </Text>
        <Text dimColor>v{require('../../../package.json').version}</Text>
        {logPath && (
          <>
            <Text dimColor> | </Text>
            <Text dimColor>Logs: {logPath}</Text>
          </>
        )}
      </Box>

      {/* Messages */}
      <Box flexDirection="column" flexGrow={1} paddingX={1} overflow="hidden">
        {displayMessages.map((msg, index) => (
          <Box key={index} marginBottom={0}>
            {msg.type === 'user' && (
              <Text color="green">
                <Text bold>&gt; </Text>
                {msg.content}
              </Text>
            )}
            {msg.type === 'assistant' && (
              <Text color="white">{msg.content}</Text>
            )}
            {msg.type === 'tool' && (
              <Text dimColor color="yellow">
                [Tool] {msg.content}
              </Text>
            )}
            {msg.type === 'result' && (
              <Text dimColor>{msg.content}</Text>
            )}
            {msg.type === 'system' && (
              <Text dimColor color="gray">
                {msg.content}
              </Text>
            )}
            {msg.type === 'status' && (
              <Text color="blue">{msg.content}</Text>
            )}
          </Box>
        ))}
      </Box>

      {/* Status bar */}
      <Box borderStyle="single" borderColor="gray" paddingX={1}>
        {confirmationMode ? (
          <Text color="red" bold>
            Press Ctrl-C again to exit (any other key to cancel)
          </Text>
        ) : (
          <Text dimColor>
            Press Ctrl-C twice to exit
          </Text>
        )}
      </Box>
    </Box>
  );
};
