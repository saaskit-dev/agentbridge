import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter, useSegments } from 'expo-router';
import * as React from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Header } from './navigation/Header';
import { StatusDot } from './StatusDot';
import { Typography } from '@/constants/Typography';
import { getServerInfo } from '@/sync/serverConfig';
import { t } from '@/text';
import { useSocketConnectionStatus } from '@/utils/socketConnectionStatus';

const stylesheet = StyleSheet.create((theme, runtime) => ({
  headerButton: {
    // marginHorizontal: 4,
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButton: {
    color: theme.colors.header.tint,
  },
  logoContainer: {
    // marginHorizontal: 4,
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    tintColor: theme.colors.header.tint,
  },
  titleContainer: {
    flex: 1,
    alignItems: 'center',
  },
  titleText: {
    fontSize: 17,
    color: theme.colors.header.tint,
    fontWeight: '600',
    ...Typography.default('semiBold'),
  },
  subtitleText: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    marginTop: -2,
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: -2,
  },
  statusDot: {
    marginRight: 4,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 16,
    ...Typography.default(),
  },
  // Status colors
  statusConnected: {
    color: theme.colors.status.connected,
  },
  statusConnecting: {
    color: theme.colors.status.connecting,
  },
  statusDisconnected: {
    color: theme.colors.status.disconnected,
  },
  statusError: {
    color: theme.colors.status.error,
  },
  statusDefault: {
    color: theme.colors.status.default,
  },
  centeredTitle: {
    textAlign: Platform.OS === 'ios' ? 'center' : 'left',
    alignSelf: Platform.OS === 'ios' ? 'center' : 'flex-start',
    flex: 1,
  },
}));

export const HomeHeader = React.memo(() => {
  const { theme } = useUnistyles();

  return (
    <View style={{ backgroundColor: theme.colors.groupped.background }}>
      <Header
        title={<HeaderTitleWithSubtitle />}
        headerRight={() => <HeaderRight />}
        headerLeft={() => <HeaderLeft />}
        headerShadowVisible={false}
        headerTransparent={true}
      />
    </View>
  );
});

export const HomeHeaderNotAuth = React.memo(() => {
  useSegments(); // Re-rendered automatically when screen navigates back
  const serverInfo = getServerInfo();
  const { theme } = useUnistyles();
  return (
    <Header
      title={
        <HeaderTitleWithSubtitle
          subtitle={
            serverInfo.isCustom
              ? serverInfo.hostname + (serverInfo.port ? `:${serverInfo.port}` : '')
              : undefined
          }
        />
      }
      headerRight={() => <HeaderRightNotAuth />}
      headerLeft={() => <HeaderLeft />}
      headerShadowVisible={false}
      headerBackgroundColor={theme.colors.groupped.background}
    />
  );
});

function HeaderRight() {
  const router = useRouter();
  const styles = stylesheet;
  const { theme } = useUnistyles();

  return (
    <Pressable onPress={() => router.push('/new')} hitSlop={15} style={styles.headerButton}>
      <Ionicons name="add-outline" size={28} color={theme.colors.header.tint} />
    </Pressable>
  );
}

function HeaderRightNotAuth() {
  const router = useRouter();
  const { theme } = useUnistyles();
  const styles = stylesheet;

  return (
    <Pressable onPress={() => router.push('/server')} hitSlop={15} style={styles.headerButton}>
      <Ionicons name="server-outline" size={24} color={theme.colors.header.tint} />
    </Pressable>
  );
}

function HeaderLeft() {
  const styles = stylesheet;
  const { theme } = useUnistyles();
  return (
    <View style={styles.logoContainer}>
      <Ionicons name="code-slash" size={24} color={theme.colors.header.tint} />
    </View>
  );
}

function HeaderTitleWithSubtitle({ subtitle }: { subtitle?: string }) {
  const styles = stylesheet;
  const connectionStatus = useSocketConnectionStatus();

  const hasCustomSubtitle = !!subtitle;
  const showConnectionStatus = !hasCustomSubtitle && connectionStatus.text;

  return (
    <View style={styles.titleContainer}>
      <Text style={styles.titleText}>{t('sidebar.sessionsTitle')}</Text>
      {hasCustomSubtitle && <Text style={styles.subtitleText}>{subtitle}</Text>}
      {showConnectionStatus && (
        <View style={styles.statusContainer}>
          <StatusDot
            color={connectionStatus.color}
            isPulsing={connectionStatus.isPulsing}
            size={6}
            style={styles.statusDot}
          />
          <Text style={[styles.statusText, { color: connectionStatus.textColor }]}>
            {connectionStatus.text}
          </Text>
        </View>
      )}
    </View>
  );
}
