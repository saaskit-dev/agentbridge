import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import React from 'react';
import { View, Pressable, Platform, ActivityIndicator } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Avatar } from './Avatar';
import { buildProjectSessionGroups } from './activeSessionGroups';
import { CompactGitStatus } from './CompactGitStatus';
import { ProjectGitStatus } from './ProjectGitStatus';
import { SessionRowActionButton } from './SessionRowActionButton';
import { StatusDot } from './StatusDot';
import { WebPortal } from './web/WebPortal';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { machineSpawnNewSession, sessionKill } from '@/sync/ops';
import { useAllMachines, useSetting } from '@/sync/storage';
import { Session } from '@/sync/storageTypes';
import { isMachineOnline } from '@/utils/machineUtils';
import { useIsTablet } from '@/utils/responsive';
import { useSessionStatus } from '@/utils/sessionUtils';
import { storage } from '@/sync/storage';
import { Modal } from '@/modal';
import { t } from '@/text';
import { useNavigateToSession } from '@/hooks/useNavigateToSession';
import { useFreeAction } from '@/hooks/useFreeAction';
import { FreeError } from '@/utils/errors';

const stylesheet = StyleSheet.create((theme, runtime) => ({
  container: {
    backgroundColor: theme.colors.groupped.background,
    paddingTop: 8,
  },
  projectCard: {
    backgroundColor: theme.colors.surface,
    marginBottom: 8,
    marginHorizontal: Platform.select({ ios: 16, default: 12 }),
    borderRadius: Platform.select({ ios: 10, default: 16 }),
    overflow: 'hidden',
    shadowColor: theme.colors.shadow.color,
    shadowOffset: { width: 0, height: 0.33 },
    shadowOpacity: theme.colors.shadow.opacity,
    shadowRadius: 0,
    elevation: 1,
  },
  sectionHeader: {
    paddingTop: 12,
    paddingBottom: Platform.select({ ios: 6, default: 8 }),
    paddingHorizontal: Platform.select({ ios: 32, default: 24 }),
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
  },
  sectionHeaderPath: {
    ...Typography.default('regular'),
    color: theme.colors.groupped.sectionTitle,
    fontSize: Platform.select({ ios: 13, default: 14 }),
    lineHeight: Platform.select({ ios: 18, default: 20 }),
    letterSpacing: Platform.select({ ios: -0.08, default: 0.1 }),
    fontWeight: Platform.select({ ios: 'normal', default: '500' }),
  },
  sectionHeaderMachine: {
    ...Typography.default('regular'),
    color: theme.colors.groupped.sectionTitle,
    fontSize: Platform.select({ ios: 13, default: 14 }),
    lineHeight: Platform.select({ ios: 18, default: 20 }),
    letterSpacing: Platform.select({ ios: -0.08, default: 0.1 }),
    fontWeight: Platform.select({ ios: 'normal', default: '500' }),
    maxWidth: 150,
    textAlign: 'right',
  },
  sessionRow: {
    height: 88,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    backgroundColor: theme.colors.surface,
  },
  sessionRowWithBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.divider,
  },
  sessionRowSelected: {
    backgroundColor: theme.colors.surfaceSelected,
  },
  sessionContent: {
    flex: 1,
    marginLeft: 16,
    justifyContent: 'center',
  },
  sessionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  sessionTitle: {
    fontSize: 15,
    fontWeight: '500',
    ...Typography.default('semiBold'),
  },
  sessionTitleConnected: {
    color: theme.colors.text,
  },
  sessionTitleDisconnected: {
    color: theme.colors.textSecondary,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statusDotContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 16,
    marginTop: 2,
    marginRight: 4,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 16,
    ...Typography.default(),
  },
  avatarContainer: {
    position: 'relative',
    width: 48,
    height: 48,
  },
  newSessionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.divider,
    backgroundColor: theme.colors.surface,
  },
  newSessionButtonDisabled: {
    opacity: 0.5,
  },
  newSessionButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  newSessionButtonIcon: {
    marginRight: 6,
    width: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  newSessionButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: theme.colors.text,
    ...Typography.default('semiBold'),
  },
  newSessionButtonTextDisabled: {
    color: theme.colors.textSecondary,
  },
  taskStatusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surfaceHighest,
    paddingHorizontal: 4,
    height: 16,
    borderRadius: 4,
  },
  taskStatusText: {
    fontSize: 10,
    fontWeight: '500',
    color: theme.colors.textSecondary,
    ...Typography.default(),
  },
  swipeAction: {
    width: 112,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.status.error,
  },
  swipeActionText: {
    marginTop: 4,
    fontSize: 12,
    color: '#FFFFFF',
    textAlign: 'center',
    ...Typography.default('semiBold'),
  },
}));

interface ActiveSessionsGroupProps {
  sessions: Session[];
  selectedSessionId?: string;
}

type ContextMenuState = {
  x: number;
  y: number;
  sessionId: string;
  sessionName: string;
};

const SessionContextMenu = React.memo(
  ({
    position,
    onClose,
    onOpen,
    onArchive,
    onCopyTitle,
  }: {
    position: ContextMenuState;
    onClose: () => void;
    onOpen: () => void;
    onArchive: () => void;
    onCopyTitle: () => void;
  }) => {
    const { theme } = useUnistyles();
    const menuWidth = 260;
    const fallbackMenuHeight = 220;
    const [menuHeight, setMenuHeight] = React.useState(fallbackMenuHeight);
    const viewportWidth =
      typeof window !== 'undefined' ? window.innerWidth : position.x + menuWidth + 16;
    const viewportHeight =
      typeof window !== 'undefined' ? window.innerHeight : position.y + menuHeight + 16;
    const cursorOffset = 10;
    const preferredLeft = position.x + cursorOffset;
    const preferredTop = position.y + cursorOffset;
    const left =
      preferredLeft + menuWidth <= viewportWidth - 8
        ? preferredLeft
        : Math.max(8, position.x - menuWidth - cursorOffset);
    const top =
      preferredTop + menuHeight <= viewportHeight - 8
        ? preferredTop
        : Math.max(8, position.y - menuHeight - cursorOffset);
    const itemStyle = {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
    };

    return (
      <WebPortal>
        <Pressable
          onPress={onClose}
          // @ts-ignore - Web-only right click support on overlay
          onContextMenu={(event: any) => {
            event.preventDefault();
            onClose();
          }}
          style={{
            position: 'fixed' as any,
            inset: 0,
            zIndex: 999,
          }}
        />
        <View
          onLayout={event => {
            const nextHeight = Math.ceil(event.nativeEvent.layout.height);
            if (nextHeight > 0 && nextHeight !== menuHeight) {
              setMenuHeight(nextHeight);
            }
          }}
          style={{
            position: 'fixed' as any,
            left,
            top,
            zIndex: 1000,
            width: menuWidth,
            maxHeight: viewportHeight - 16,
            backgroundColor: theme.colors.surface,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: theme.colors.divider,
            shadowColor: '#000',
            shadowOpacity: 0.14,
            shadowRadius: 18,
            shadowOffset: { width: 0, height: 8 },
            elevation: 10,
            overflow: 'hidden',
          }}
        >
          <View
            style={[
              itemStyle,
              {
                alignItems: 'flex-start',
                borderBottomWidth: StyleSheet.hairlineWidth,
                borderBottomColor: theme.colors.divider,
              },
            ]}
          >
            <Ionicons name="document-text-outline" size={16} color={theme.colors.textSecondary} />
            <Text
              numberOfLines={2}
              style={{
                flex: 1,
                color: theme.colors.text,
                ...Typography.default('semiBold'),
                fontSize: 13,
                lineHeight: 18,
              }}
            >
              {position.sessionName}
            </Text>
          </View>
          <Pressable onPress={onOpen} style={itemStyle}>
            <Ionicons name="open-outline" size={16} color={theme.colors.text} />
            <Text style={{ color: theme.colors.text, ...Typography.default() }}>打开会话</Text>
          </Pressable>
          <Pressable onPress={onCopyTitle} style={itemStyle}>
            <Ionicons name="copy-outline" size={16} color={theme.colors.text} />
            <Text style={{ color: theme.colors.text, ...Typography.default() }}>{t('common.copy')}</Text>
          </Pressable>
          <Pressable
            onPress={onArchive}
            style={[
              itemStyle,
              {
                borderTopWidth: StyleSheet.hairlineWidth,
                borderTopColor: theme.colors.divider,
              },
            ]}
          >
            <Ionicons name="archive-outline" size={16} color={theme.colors.status.error} />
            <Text style={{ color: theme.colors.status.error, ...Typography.default() }}>
              {t('sessionInfo.archiveSession')}
            </Text>
          </Pressable>
        </View>
      </WebPortal>
    );
  }
);

export function ActiveSessionsGroup({ sessions, selectedSessionId }: ActiveSessionsGroupProps) {
  const styles = stylesheet;
  const machines = useAllMachines();
  const navigateToSession = useNavigateToSession();
  const [contextMenu, setContextMenu] = React.useState<ContextMenuState | null>(null);
  const projectGroups = React.useMemo(
    () =>
      buildProjectSessionGroups(sessions, machines, {
        unknownMachineId: 'unknown',
        unknownMachineDisplayName: '<unknown>',
      }),
    [machines, sessions]
  );

  return (
    <View style={styles.container}>
      {projectGroups.map(projectGroup => {
        const projectPath = projectGroup.path;
        const firstSession = projectGroup.firstSession;
        return (
          <View key={projectPath}>
            {/* Section header on grouped background */}
            <View style={styles.sectionHeader}>
              <View style={styles.sectionHeaderLeft}>
                <Text style={styles.sectionHeaderPath}>{projectGroup.displayPath}</Text>
              </View>
              {/* Show git status instead of machine name */}
              {firstSession ? (
                <ProjectGitStatus sessionId={firstSession.id} />
              ) : (
                <Text style={styles.sectionHeaderMachine} numberOfLines={1}>
                  {projectGroup.machineLabel}
                </Text>
              )}
            </View>

            {/* Card with just the sessions */}
            <View style={styles.projectCard}>
              {/* Sessions grouped by machine within the card */}
              {projectGroup.machineGroups.map((machineGroup, machineIndex) => (
                <View key={`${projectPath}-${machineGroup.machineId}`}>
                  {machineGroup.sessions.map((item, index) => (
                    <CompactSessionRow
                      key={item.session.id}
                      session={item.session}
                      sessionName={item.sessionName}
                      avatarId={item.avatarId}
                      selected={selectedSessionId === item.session.id}
                      onOpenContextMenu={setContextMenu}
                      showBorder={
                        index < machineGroup.sessions.length - 1 ||
                        machineIndex < projectGroup.machineGroups.length - 1
                      }
                    />
                  ))}
                </View>
              ))}
            </View>
          </View>
        );
      })}
      {contextMenu ? (
        <SessionContextMenu
          position={contextMenu}
          onClose={() => setContextMenu(null)}
          onOpen={() => {
            setContextMenu(null);
            navigateToSession(contextMenu.sessionId);
          }}
          onArchive={() => {
            const session = sessions.find(item => item.id === contextMenu.sessionId);
            setContextMenu(null);
            if (!session) return;
            Modal.alert(t('sessionInfo.archiveSession'), t('sessionInfo.archiveSessionConfirm'), [
              { text: t('common.cancel'), style: 'cancel' },
              {
                text: t('sessionInfo.archiveSession'),
                style: 'destructive',
                onPress: async () => {
                  const result = await sessionKill(session.id);
                  if (!result.success) {
                    throw new FreeError(
                      result.message || t('sessionInfo.failedToArchiveSession'),
                      false
                    );
                  }
                },
              },
            ]);
          }}
          onCopyTitle={async () => {
            await Clipboard.setStringAsync(contextMenu.sessionName);
            setContextMenu(null);
            Modal.alert(
              t('common.copied'),
              t('items.copiedToClipboard', { label: contextMenu.sessionName })
            );
          }}
        />
      ) : null}
    </View>
  );
}

// Compact session row component with status line
const CompactSessionRow = React.memo(
  ({
    session,
    sessionName,
    avatarId,
    selected,
    onOpenContextMenu,
    showBorder,
  }: {
    session: Session;
    sessionName: string;
    avatarId: string;
    selected?: boolean;
    onOpenContextMenu: React.Dispatch<React.SetStateAction<ContextMenuState | null>>;
    showBorder?: boolean;
  }) => {
    const styles = stylesheet;
    const sessionStatus = useSessionStatus(session);
    const navigateToSession = useNavigateToSession();
    const isTablet = useIsTablet();
    const swipeableRef = React.useRef<Swipeable | null>(null);
    const swipeEnabled = Platform.OS !== 'web';
    const [archivingSession, performArchive] = useFreeAction(async () => {
      const result = await sessionKill(session.id);
      if (!result.success) {
        throw new FreeError(result.message || t('sessionInfo.failedToArchiveSession'), false);
      }
    });

    const handleArchive = React.useCallback(() => {
      swipeableRef.current?.close();
      onOpenContextMenu(null);
      Modal.alert(t('sessionInfo.archiveSession'), t('sessionInfo.archiveSessionConfirm'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('sessionInfo.archiveSession'),
          style: 'destructive',
          onPress: performArchive,
        },
      ]);
    }, [onOpenContextMenu, performArchive]);

    const handleOpen = React.useCallback(() => {
      onOpenContextMenu(null);
      navigateToSession(session.id);
    }, [navigateToSession, onOpenContextMenu, session.id]);

    const handleCopyTitle = React.useCallback(async () => {
      onOpenContextMenu(null);
      await Clipboard.setStringAsync(sessionName);
      Modal.alert(t('common.copied'), t('items.copiedToClipboard', { label: sessionName }));
    }, [onOpenContextMenu, sessionName]);

    const itemContent = (
      <Pressable
        style={[
          styles.sessionRow,
          showBorder && styles.sessionRowWithBorder,
          selected && styles.sessionRowSelected,
        ]}
        onPressIn={() => {
          if (isTablet) {
            navigateToSession(session.id);
          }
        }}
        onPress={() => {
          if (!isTablet) {
            navigateToSession(session.id);
          }
        }}
        // @ts-ignore - Web-only right click support
        onContextMenu={
          Platform.OS === 'web'
            ? (event: any) => {
                event.preventDefault();
                onOpenContextMenu({
                  x: event.nativeEvent?.clientX ?? event.clientX ?? 0,
                  y: event.nativeEvent?.clientY ?? event.clientY ?? 0,
                  sessionId: session.id,
                  sessionName,
                });
              }
            : undefined
        }
      >
        <View style={styles.avatarContainer}>
          <Avatar
            id={avatarId}
            size={48}
            monochrome={!sessionStatus.isConnected}
            flavor={session.metadata?.flavor}
          />
        </View>
        <View style={styles.sessionContent}>
          {/* Title line */}
          <View style={styles.sessionTitleRow}>
            <Text
              style={[
                styles.sessionTitle,
                sessionStatus.isConnected
                  ? styles.sessionTitleConnected
                  : styles.sessionTitleDisconnected,
              ]}
              numberOfLines={2}
            >
              {sessionName}
            </Text>
          </View>

          {/* Status line with dot */}
          <View style={styles.statusRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={styles.statusDotContainer}>
                <StatusDot
                  color={sessionStatus.statusDotColor}
                  isPulsing={sessionStatus.isPulsing}
                />
              </View>
              <Text style={[styles.statusText, { color: sessionStatus.statusColor }]}>
                {sessionStatus.statusText}
              </Text>
            </View>

            {/* Status indicators on the right side */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                transform: [{ translateY: 1 }],
              }}
            >
              {/* Draft status indicator */}
              {!!session.draft && (
                <View style={styles.taskStatusContainer}>
                  <Ionicons name="create-outline" size={10} color={styles.taskStatusText.color} />
                </View>
              )}

              {/* No longer showing git status per item - it's in the header */}

              {/* Task status indicator */}
              {session.todos &&
                session.todos.length > 0 &&
                (() => {
                  const totalTasks = session.todos.length;
                  const completedTasks = session.todos.filter(t => t.status === 'completed').length;

                  // Don't show if all tasks are completed
                  if (completedTasks === totalTasks) {
                    return null;
                  }

                  return (
                    <View style={styles.taskStatusContainer}>
                      <Ionicons
                        name="bulb-outline"
                        size={10}
                        color={styles.taskStatusText.color}
                        style={{ marginRight: 2 }}
                      />
                      <Text style={styles.taskStatusText}>
                        {completedTasks}/{totalTasks}
                      </Text>
                    </View>
                  );
                })()}
            </View>
          </View>
        </View>
      </Pressable>
    );

    if (!swipeEnabled) {
      return itemContent;
    }

    const renderRightActions = () => (
      <Pressable style={styles.swipeAction} onPress={handleArchive} disabled={archivingSession}>
        <Ionicons name="archive-outline" size={20} color="#FFFFFF" />
        <Text style={styles.swipeActionText} numberOfLines={2}>
          {t('sessionInfo.archiveSession')}
        </Text>
      </Pressable>
    );

    return (
      <Swipeable
        ref={swipeableRef}
        renderRightActions={renderRightActions}
        overshootRight={false}
        enabled={!archivingSession}
      >
        {itemContent}
      </Swipeable>
    );
  }
);
