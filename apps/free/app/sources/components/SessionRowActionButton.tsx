import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { Pressable, GestureResponderEvent, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';

export function SessionRowActionButton(props: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
  destructive?: boolean;
  disabled?: boolean;
}) {
  const styles = stylesheet;

  const handlePress = React.useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation?.();
      props.onPress();
    },
    [props]
  );

  const tintStyle = props.destructive ? styles.destructiveTint : styles.defaultTint;

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={props.label}
        onPress={handlePress}
        disabled={props.disabled}
        style={({ pressed }) => [
          styles.button,
          tintStyle,
          pressed && styles.buttonPressed,
          props.disabled && styles.buttonDisabled,
        ]}
      >
        <Ionicons
          name={props.icon}
          size={14}
          color={props.destructive ? '#FFFFFF' : '#0A84FF'}
        />
        <Text style={[styles.label, props.destructive ? styles.destructiveLabel : styles.defaultLabel]}>
          {props.label}
        </Text>
      </Pressable>
    </View>
  );
}

const stylesheet = StyleSheet.create(theme => ({
  container: {
    marginLeft: 12,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  button: {
    minWidth: 78,
    height: 32,
    paddingHorizontal: 10,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderWidth: 1,
  },
  defaultTint: {
    backgroundColor: theme.colors.surfaceHighest,
    borderColor: theme.colors.divider,
  },
  destructiveTint: {
    backgroundColor: theme.colors.status.error,
    borderColor: theme.colors.status.error,
  },
  label: {
    fontSize: 12,
    lineHeight: 16,
    ...Typography.default('semiBold'),
  },
  defaultLabel: {
    color: '#0A84FF',
  },
  destructiveLabel: {
    color: '#FFFFFF',
  },
  buttonPressed: {
    opacity: 0.8,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
}));
