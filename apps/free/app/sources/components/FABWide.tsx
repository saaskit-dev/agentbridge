import * as React from 'react';
import { View, Pressable, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { t } from '@/text';

const stylesheet = StyleSheet.create((theme, runtime) => ({
  container: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    shadowColor: theme.colors.shadow.color,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 3.84,
    shadowOpacity: theme.colors.shadow.opacity,
    elevation: 5,
    borderRadius: 12,
  },
  mainButton: {
    flex: 1,
    borderTopLeftRadius: 12,
    borderBottomLeftRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.fab.background,
  },
  mainButtonPressed: {
    backgroundColor: theme.colors.fab.backgroundPressed,
  },
  mainButtonRounded: {
    // When there's no trailing action, all corners are rounded
    borderTopRightRadius: 12,
    borderBottomRightRadius: 12,
  },
  divider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: theme.colors.divider,
    alignSelf: 'stretch',
    opacity: 0.3,
  },
  trailingButton: {
    borderTopRightRadius: 12,
    borderBottomRightRadius: 12,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.fab.background,
  },
  trailingButtonPressed: {
    backgroundColor: theme.colors.fab.backgroundPressed,
  },
  text: {
    fontSize: 16,
    fontWeight: '600',
    color: theme.colors.fab.icon,
  },
}));

interface FABWideProps {
  onPress: () => void;
  trailingAction?: {
    icon: React.ReactNode;
    onPress: () => void;
    accessibilityLabel?: string;
    isActive?: boolean;
  };
}

export const FABWide = React.memo(({ onPress, trailingAction }: FABWideProps) => {
  const styles = stylesheet;
  const { theme } = useUnistyles();
  const safeArea = useSafeAreaInsets();

  return (
    <View style={[styles.container, { bottom: safeArea.bottom + 16 }]}>
      <Pressable
        style={({ pressed }) => [
          styles.mainButton,
          !trailingAction && styles.mainButtonRounded,
          pressed && styles.mainButtonPressed,
        ]}
        onPress={onPress}
      >
        <Text style={styles.text}>{t('newSession.title')}</Text>
      </Pressable>

      {trailingAction && (
        <>
          <View style={styles.divider} />
          <Pressable
            style={({ pressed }) => [
              styles.trailingButton,
              trailingAction.isActive && {
                backgroundColor: theme.colors.button.primary.background,
              },
              pressed && styles.trailingButtonPressed,
            ]}
            onPress={trailingAction.onPress}
            accessibilityLabel={trailingAction.accessibilityLabel}
            hitSlop={4}
          >
            {trailingAction.icon}
          </Pressable>
        </>
      )}
    </View>
  );
});
