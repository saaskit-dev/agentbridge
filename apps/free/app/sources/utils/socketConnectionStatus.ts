import * as React from 'react';
import { useUnistyles } from 'react-native-unistyles';
import { useActiveSessionCount, useSocketStatus } from '@/sync/storage';
import { t } from '@/text';

const SOCKET_RECOVERY_WINDOW_MS = 12_000;

export function useSocketConnectionStatus() {
  const { theme } = useUnistyles();
  const socketStatus = useSocketStatus();
  const activeSessionCount = useActiveSessionCount();
  const [now, setNow] = React.useState(() => Date.now());

  const recoveryDeadline = React.useMemo(() => {
    if (activeSessionCount === 0) {
      return null;
    }
    if (socketStatus.status !== 'connecting' && socketStatus.status !== 'disconnected') {
      return null;
    }

    const lastActivityAt = Math.max(
      socketStatus.lastConnectedAt ?? 0,
      socketStatus.lastDisconnectedAt ?? 0
    );
    if (lastActivityAt === 0) {
      return null;
    }

    return lastActivityAt + SOCKET_RECOVERY_WINDOW_MS;
  }, [
    activeSessionCount,
    socketStatus.lastConnectedAt,
    socketStatus.lastDisconnectedAt,
    socketStatus.status,
  ]);

  React.useEffect(() => {
    if (!recoveryDeadline || recoveryDeadline <= now) {
      return;
    }

    const timeoutMs = recoveryDeadline - now;
    const timer = setTimeout(() => {
      setNow(Date.now());
    }, timeoutMs);

    return () => clearTimeout(timer);
  }, [now, recoveryDeadline]);

  const isRecovering = recoveryDeadline !== null && recoveryDeadline > now;

  if (socketStatus.authError) {
    return {
      color: theme.colors.status.error,
      isPulsing: false,
      text: t('status.authError') ?? 'Auth expired, please re-login',
      textColor: theme.colors.status.error,
    };
  }

  if (isRecovering) {
    return {
      color: theme.colors.status.connecting,
      isPulsing: true,
      text: t('voiceStatusBar.reconnecting'),
      textColor: theme.colors.status.connecting,
    };
  }

  switch (socketStatus.status) {
    case 'connected':
      return {
        color: theme.colors.status.connected,
        isPulsing: false,
        text: t('status.connected'),
        textColor: theme.colors.status.connected,
      };
    case 'connecting':
      return {
        color: theme.colors.status.connecting,
        isPulsing: true,
        text: t('status.connecting'),
        textColor: theme.colors.status.connecting,
      };
    case 'disconnected':
      return {
        color: theme.colors.status.disconnected,
        isPulsing: false,
        text: t('status.disconnected'),
        textColor: theme.colors.status.disconnected,
      };
    case 'error':
      return {
        color: theme.colors.status.error,
        isPulsing: false,
        text: t('status.error'),
        textColor: theme.colors.status.error,
      };
    default:
      return {
        color: theme.colors.status.default,
        isPulsing: false,
        text: '',
        textColor: theme.colors.status.default,
      };
  }
}
