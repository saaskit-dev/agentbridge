import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUnistyles } from 'react-native-unistyles';
import { layout } from './layout';
import { StatusDot } from './StatusDot';
import { VoiceBars } from './VoiceBars';
import { Typography } from '@/constants/Typography';
import { stopRealtimeSession } from '@/realtime/RealtimeSession';
import { useRealtimeStatus, useRealtimeMode } from '@/sync/storage';
import { t } from '@/text';
import { Logger, toError } from '@saaskit-dev/agentbridge/telemetry';
const logger = new Logger('app/components/VoiceAssistantStatusBar');

interface VoiceAssistantStatusBarProps {
  variant?: 'full' | 'sidebar';
  style?: any;
}

export const VoiceAssistantStatusBar = React.memo(
  ({ variant = 'full', style }: VoiceAssistantStatusBarProps) => {
    const { theme } = useUnistyles();
    const realtimeStatus = useRealtimeStatus();
    const realtimeMode = useRealtimeMode();

    if (realtimeStatus === 'disconnected') {
      return null;
    }

    // Check if voice assistant is speaking
    const isVoiceSpeaking = realtimeMode === 'speaking';

    const getStatusInfo = () => {
      switch (realtimeStatus) {
        case 'connecting':
          return {
            color: theme.colors.status.connecting,
            backgroundColor: theme.colors.surfaceHighest,
            isPulsing: true,
            text: t('voiceStatusBar.connecting'),
            textColor: theme.colors.text,
          };
        case 'reconnecting':
          return {
            color: theme.colors.status.connecting,
            backgroundColor: theme.colors.surfaceHighest,
            isPulsing: true,
            text: t('voiceStatusBar.reconnecting'),
            textColor: theme.colors.text,
          };
        case 'connected':
          return {
            color: theme.colors.status.connected,
            backgroundColor: theme.colors.surfaceHighest,
            isPulsing: false,
            text: t('voiceStatusBar.active'),
            textColor: theme.colors.text,
          };
        case 'error':
          return {
            color: theme.colors.status.error,
            backgroundColor: theme.colors.surfaceHighest,
            isPulsing: false,
            text: t('voiceStatusBar.error'),
            textColor: theme.colors.text,
          };
        default:
          return {
            color: theme.colors.status.default,
            backgroundColor: theme.colors.surfaceHighest,
            isPulsing: false,
            text: t('voiceStatusBar.default'),
            textColor: theme.colors.text,
          };
      }
    };

    const statusInfo = getStatusInfo();

    const handlePress = async () => {
      if (realtimeStatus === 'connected' || realtimeStatus === 'connecting' || realtimeStatus === 'reconnecting') {
        try {
          await stopRealtimeSession();
        } catch (error) {
          logger.error('Error stopping voice session:', toError(error));
        }
      }
    };

    if (variant === 'full') {
      // Mobile full-width version
      return (
        <View
          style={{
            backgroundColor: statusInfo.backgroundColor,
            height: 32,
            width: '100%',
            justifyContent: 'center',
            alignItems: 'center',
            paddingHorizontal: 16,
          }}
        >
          <Pressable
            onPress={handlePress}
            style={{
              height: 32,
              width: '100%',
              maxWidth: layout.maxWidth,
              justifyContent: 'center',
              alignItems: 'center',
            }}
            hitSlop={10}
          >
            <View style={styles.content}>
              <View style={styles.leftSection}>
                <StatusDot
                  color={statusInfo.color}
                  isPulsing={statusInfo.isPulsing}
                  size={8}
                  style={styles.statusDot}
                />
                <Ionicons
                  name="mic"
                  size={16}
                  color={statusInfo.textColor}
                  style={styles.micIcon}
                />
                <Text style={[styles.statusText, { color: statusInfo.textColor }]}>
                  {statusInfo.text}
                </Text>
              </View>

              <View style={styles.rightSection}>
                {isVoiceSpeaking && (
                  <VoiceBars isActive={isVoiceSpeaking} color={statusInfo.textColor} size="small" />
                )}
                <Text
                  style={[
                    styles.tapToEndText,
                    { color: statusInfo.textColor, marginLeft: isVoiceSpeaking ? 8 : 0 },
                  ]}
                >
                  {t('voiceStatusBar.tapToEnd')}
                </Text>
              </View>
            </View>
          </Pressable>
        </View>
      );
    }

    // Sidebar version
    const containerStyle = [
      styles.container,
      styles.sidebarContainer,
      {
        backgroundColor: statusInfo.backgroundColor,
      },
      style,
    ];

    return (
      <View style={containerStyle}>
        <Pressable onPress={handlePress} style={styles.pressable} hitSlop={5}>
          <View style={styles.content}>
            <View style={styles.leftSection}>
              <StatusDot
                color={statusInfo.color}
                isPulsing={statusInfo.isPulsing}
                size={8}
                style={styles.statusDot}
              />
              <Ionicons name="mic" size={16} color={statusInfo.textColor} style={styles.micIcon} />
              <Text
                style={[
                  styles.statusText,
                  styles.sidebarStatusText,
                  { color: statusInfo.textColor },
                ]}
              >
                {statusInfo.text}
              </Text>
            </View>

            {isVoiceSpeaking && (
              <VoiceBars isActive={isVoiceSpeaking} color={statusInfo.textColor} size="small" />
            )}

            <Ionicons
              name="close"
              size={14}
              color={statusInfo.textColor}
              style={[styles.closeIcon, { marginLeft: isVoiceSpeaking ? 4 : 8 }]}
            />
          </View>
        </Pressable>
      </View>
    );
  }
);

const styles = StyleSheet.create({
  container: {
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    borderRadius: 0,
    marginHorizontal: 0,
    marginVertical: 0,
  },
  fullContainer: {
    justifyContent: 'flex-end',
  },
  sidebarContainer: {},
  pressable: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    paddingHorizontal: 12,
  },
  leftSection: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  rightSection: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    marginRight: 6,
  },
  micIcon: {
    marginRight: 6,
  },
  closeIcon: {
    marginLeft: 8,
  },
  statusText: {
    fontSize: 14,
    fontWeight: '500',
    ...Typography.default(),
  },
  sidebarStatusText: {
    fontSize: 12,
  },
  tapToEndText: {
    fontSize: 12,
    fontWeight: '400',
    opacity: 0.8,
    ...Typography.default(),
  },
});
