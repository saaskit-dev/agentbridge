import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { parseToolUseError } from '@/utils/toolErrorParser';
import { extractErrorMessage } from '@saaskit-dev/agentbridge/common';

export function ToolError(props: { message: unknown }) {
  const { theme } = useUnistyles();
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const msg = extractErrorMessage(props.message);
  const { isToolUseError, errorMessage } = parseToolUseError(msg);
  const displayMessage = isToolUseError && errorMessage ? errorMessage : msg;

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  function handlePress() {
    Clipboard.setStringAsync(displayMessage);
    setCopied(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [
        styles.errorContainer,
        isToolUseError && styles.toolUseErrorContainer,
        pressed && { opacity: 0.7 },
      ]}
    >
      {isToolUseError && (
        <Ionicons name="warning" size={16} color={theme.colors.box.warning.text} />
      )}
      <Text style={[styles.errorText, isToolUseError && styles.toolUseErrorText]}>
        {displayMessage}
      </Text>
      {copied && (
        <Text style={styles.copiedBadge}>
          ✓
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create(theme => ({
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: theme.colors.box.error.background,
    borderRadius: 6,
    padding: 12,
    borderWidth: 1,
    borderColor: theme.colors.box.error.border,
    marginBottom: 12,
    maxHeight: 115,
    overflow: 'hidden',
  },
  toolUseErrorContainer: {
    backgroundColor: theme.colors.box.error.background,
    borderColor: theme.colors.box.error.border,
  },
  errorText: {
    fontSize: 13,
    color: theme.colors.box.error.text,
    flex: 1,
  },
  toolUseErrorText: {
    color: theme.colors.box.error.text,
  },
  copiedBadge: {
    position: 'absolute',
    top: 6,
    right: 8,
    fontSize: 13,
    fontWeight: '600',
    opacity: 0.7,
    color: theme.colors.box.error.text,
  },
}));
