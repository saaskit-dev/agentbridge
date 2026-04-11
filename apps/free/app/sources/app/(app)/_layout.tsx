import { Stack } from 'expo-router';
import 'react-native-reanimated';
import * as React from 'react';
import { Platform, TouchableOpacity, Text } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { createHeader } from '@/components/navigation/Header';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { isDesktopPlatform } from '@/utils/platform';

export const unstable_settings = {
  initialRouteName: 'index',
};

export default function RootLayout() {
  // Use custom header on Android and Mac Catalyst, native header on iOS (non-Catalyst)
  const shouldUseCustomHeader = Platform.OS === 'android' || isDesktopPlatform();
  const { theme } = useUnistyles();

  return (
    <Stack
      initialRouteName="index"
      screenOptions={{
        header: shouldUseCustomHeader ? createHeader : undefined,
        headerBackTitle: t('common.back'),
        headerShadowVisible: false,
        contentStyle: {
          backgroundColor: theme.colors.surface,
        },
        headerStyle: {
          backgroundColor: theme.colors.header.background,
        },
        headerTintColor: theme.colors.header.tint,
        headerTitleStyle: {
          color: theme.colors.header.tint,
          ...Typography.default('semiBold'),
        },
      }}
    >
      <Stack.Screen
        name="index"
        options={{
          headerShown: false,
          headerTitle: '',
        }}
      />
      <Stack.Screen
        name="inbox/index"
        options={{
          headerShown: false,
          headerTitle: t('tabs.inbox'),
          headerBackTitle: t('common.home'),
        }}
      />
      <Stack.Screen
        name="settings/index"
        options={{
          headerShown: true,
          headerTitle: t('settings.title'),
          headerBackTitle: t('common.home'),
        }}
      />
      <Stack.Screen
        name="session/[id]"
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="session/[id]/message/[messageId]"
        options={{
          headerShown: true,
          headerBackTitle: t('common.back'),
          headerTitle: t('common.message'),
        }}
      />
      <Stack.Screen
        name="session/[id]/info"
        options={{
          headerShown: true,
          headerTitle: '',
          headerBackTitle: t('common.back'),
        }}
      />
      <Stack.Screen
        name="session/[id]/usage"
        options={{
          headerShown: true,
          headerTitle: t('settings.usage'),
          headerBackTitle: t('common.back'),
        }}
      />
      <Stack.Screen
        name="session/[id]/files"
        options={{
          headerShown: true,
          headerTitle: t('common.files'),
          headerBackTitle: t('common.back'),
        }}
      />
      <Stack.Screen
        name="session/[id]/file"
        options={{
          headerShown: true,
          headerTitle: t('common.fileViewer'),
          headerBackTitle: t('common.files'),
        }}
      />
      <Stack.Screen
        name="settings/account"
        options={{
          headerTitle: t('settings.account'),
        }}
      />
      <Stack.Screen
        name="settings/appearance"
        options={{
          headerTitle: t('settings.appearance'),
        }}
      />
      <Stack.Screen
        name="settings/permissions"
        options={{
          headerTitle: t('settings.permissions'),
        }}
      />
      <Stack.Screen
        name="settings/features"
        options={{
          headerTitle: t('settings.features'),
        }}
      />
      <Stack.Screen
        name="settings/focus-audio"
        options={{
          headerTitle: t('focusAudio.pageTitle'),
        }}
      />
      <Stack.Screen
        name="terminal/connect"
        options={{
          headerTitle: t('navigation.connectTerminal'),
        }}
      />
      <Stack.Screen
        name="terminal/index"
        options={{
          headerTitle: t('navigation.connectTerminal'),
        }}
      />
      <Stack.Screen
        name="restore/index"
        options={{
          headerShown: true,
          headerTitle: t('navigation.linkNewDevice'),
          headerBackTitle: t('common.back'),
        }}
      />
      <Stack.Screen
        name="restore/manual"
        options={{
          headerShown: true,
          headerTitle: t('navigation.restoreWithSecretKey'),
          headerBackTitle: t('common.back'),
        }}
      />
      <Stack.Screen
        name="changelog"
        options={{
          headerShown: true,
          headerTitle: t('navigation.whatsNew'),
          headerBackTitle: t('common.back'),
        }}
      />
      <Stack.Screen
        name="artifacts/index"
        options={{
          headerShown: true,
          headerTitle: t('artifacts.title'),
          headerBackTitle: t('common.back'),
        }}
      />
      <Stack.Screen
        name="artifacts/[id]"
        options={{
          headerShown: false, // We'll set header dynamically
        }}
      />
      <Stack.Screen
        name="artifacts/new"
        options={{
          headerShown: true,
          headerTitle: t('artifacts.new'),
          headerBackTitle: t('common.cancel'),
        }}
      />
      <Stack.Screen
        name="artifacts/edit/[id]"
        options={{
          headerShown: true,
          headerTitle: t('artifacts.edit'),
          headerBackTitle: t('common.cancel'),
        }}
      />
      <Stack.Screen
        name="text-selection"
        options={{
          headerShown: true,
          headerTitle: t('textSelection.title'),
          headerBackTitle: t('common.back'),
        }}
      />
      <Stack.Screen
        name="friends/index"
        options={({ navigation }) => ({
          headerShown: true,
          headerTitle: t('navigation.friends'),
          headerBackTitle: t('common.back'),
          headerRight: () => (
            <TouchableOpacity
              onPress={() => navigation.navigate('friends/search' as never)}
              style={{ paddingHorizontal: 16 }}
            >
              <Text style={{ color: theme.colors.button.primary.tint, fontSize: 16 }}>
                {t('friends.addFriend')}
              </Text>
            </TouchableOpacity>
          ),
        })}
      />
      <Stack.Screen
        name="friends/search"
        options={{
          headerShown: true,
          headerTitle: t('friends.addFriend'),
          headerBackTitle: t('common.back'),
        }}
      />
      <Stack.Screen
        name="machine/[id]/import-sessions"
        options={{
          headerShown: true,
          headerTitle: t('navigation.importExistingAgentSessions'),
          headerBackTitle: t('common.back'),
        }}
      />
      <Stack.Screen
        name="user/[id]"
        options={{
          headerShown: true,
          headerTitle: '',
          headerBackTitle: t('common.back'),
        }}
      />
      <Stack.Screen
        name="dev/index"
        options={{
          headerTitle: t('navigation.developerTools'),
        }}
      />

      <Stack.Screen
        name="dev/list-demo"
        options={{
          headerTitle: t('navigation.listComponentsDemo'),
        }}
      />
      <Stack.Screen
        name="dev/typography"
        options={{
          headerTitle: t('navigation.typography'),
        }}
      />
      <Stack.Screen
        name="dev/colors"
        options={{
          headerTitle: t('navigation.colors'),
        }}
      />
      <Stack.Screen
        name="dev/tools2"
        options={{
          headerTitle: t('navigation.toolViewsDemo'),
        }}
      />
      <Stack.Screen
        name="dev/shimmer-demo"
        options={{
          headerTitle: t('navigation.shimmerViewDemo'),
        }}
      />
      <Stack.Screen
        name="dev/multi-text-input"
        options={{
          headerTitle: t('navigation.multiTextInput'),
        }}
      />
      <Stack.Screen
        name="session/recent"
        options={{
          headerShown: true,
          headerTitle: t('sessionHistory.title'),
          headerBackTitle: t('common.back'),
        }}
      />
      <Stack.Screen
        name="settings/connect/claude"
        options={{
          headerShown: true,
          headerTitle: t('navigation.connectTo', { name: 'Claude' }),
          headerBackTitle: t('common.back'),
          // headerStyle: {
          //     backgroundColor: Platform.OS === 'web' ? theme.colors.header.background : '#1F1E1C',
          // },
          // headerTintColor: Platform.OS === 'web' ? theme.colors.header.tint : '#FFFFFF',
          // headerTitleStyle: {
          //     color: Platform.OS === 'web' ? theme.colors.header.tint : '#FFFFFF',
          // },
        }}
      />
      <Stack.Screen
        name="new/pick/machine"
        options={{
          headerTitle: '',
          headerBackTitle: t('common.back'),
        }}
      />
      <Stack.Screen
        name="new/pick/path"
        options={{
          headerTitle: '',
          headerBackTitle: t('common.back'),
        }}
      />
      <Stack.Screen
        name="new/pick/agent"
        options={{
          headerTitle: '',
          headerBackTitle: t('common.back'),
        }}
      />
      <Stack.Screen
        name="new/index"
        options={{
          headerTitle: t('newSession.title'),
          headerBackTitle: t('common.back'),
        }}
      />
      <Stack.Screen
        name="support/index"
        options={{
          headerShown: false,
        }}
      />
    </Stack>
  );
}
