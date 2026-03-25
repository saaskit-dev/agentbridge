import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { ToolCall } from '@/sync/typesMessage';
interface ToolStatusIndicatorProps {
  tool: ToolCall;
}

export function ToolStatusIndicator({ tool }: ToolStatusIndicatorProps) {
  const { theme } = useUnistyles();
  return (
    <View style={styles.container}>
      <StatusIndicator
        state={tool.state}
        runningColor={theme.colors.tool.running}
        successColor={theme.colors.tool.success}
        errorColor={theme.colors.tool.error}
      />
    </View>
  );
}

function StatusIndicator({
  state,
  runningColor,
  successColor,
  errorColor,
}: {
  state: ToolCall['state'];
  runningColor: string;
  successColor: string;
  errorColor: string;
}) {
  switch (state) {
    case 'running':
      return <ActivityIndicator size="small" color={runningColor} />;
    case 'completed':
      return <Ionicons name="checkmark-circle" size={22} color={successColor} />;
    case 'error':
      return <Ionicons name="close-circle" size={22} color={errorColor} />;
    default:
      return null;
  }
}

const styles = StyleSheet.create({
  container: {
    width: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
