import { Ionicons, Octicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import React, { useState, useMemo, useCallback, useRef } from 'react';
import { View, Text, ActivityIndicator, RefreshControl, Platform, Pressable } from 'react-native';
import { useUnistyles, StyleSheet } from 'react-native-unistyles';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { MultiTextInput, type MultiTextInputHandle } from '@/components/MultiTextInput';
import { Typography } from '@/constants/Typography';
import { useNavigateToSession } from '@/hooks/useNavigateToSession';
import { Modal } from '@/modal';
import { machineListExternalAgentSessions, machineStopDaemon, machineUpdateMetadata } from '@/sync/ops';
import { machineSpawnNewSession } from '@/sync/ops';
import { compareUpdatedDesc } from '@/sync/entitySort';
import { useSessions, useMachine } from '@/sync/storage';
import type { Session } from '@/sync/storageTypes';
import { sync } from '@/sync/sync';
import { t } from '@/text';
import { isMachineOnline } from '@/utils/machineUtils';
import { resolveAbsolutePath } from '@/utils/pathUtils';
import { safeStringify } from '@saaskit-dev/agentbridge/common';
import { formatPathRelativeToHome, getSessionName, getSessionSubtitle } from '@/utils/sessionUtils';

const styles = StyleSheet.create(theme => ({
  pathInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  pathInput: {
    flex: 1,
    borderRadius: 8,
    backgroundColor: theme.colors.input?.background ?? theme.colors.groupped.background,
    borderWidth: 1,
    borderColor: theme.colors.divider,
    minHeight: 44,
    position: 'relative',
    paddingHorizontal: 12,
    paddingVertical: Platform.select({ web: 10, ios: 8, default: 10 }) as any,
  },
  inlineSendButton: {
    position: 'absolute',
    right: 8,
    bottom: 10,
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  inlineSendActive: {
    backgroundColor: theme.colors.button.primary.background,
  },
  inlineSendInactive: {
    // Use a darker neutral in light theme to avoid blending into input
    backgroundColor: Platform.select({
      ios: theme.colors.permissionButton?.inactive?.background ?? theme.colors.surfaceHigh,
      android: theme.colors.permissionButton?.inactive?.background ?? theme.colors.surfaceHigh,
      default: theme.colors.permissionButton?.inactive?.background ?? theme.colors.surfaceHigh,
    }) as any,
  },
}));

export default function MachineDetailScreen() {
  const { theme } = useUnistyles();
  const { id: machineId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const sessions = useSessions();
  const machine = useMachine(machineId!);
  const navigateToSession = useNavigateToSession();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isStoppingDaemon, setIsStoppingDaemon] = useState(false);
  const [isRenamingMachine, setIsRenamingMachine] = useState(false);
  const [customPath, setCustomPath] = useState('');
  const [isSpawning, setIsSpawning] = useState(false);
  const inputRef = useRef<MultiTextInputHandle>(null);
  const [showAllPaths, setShowAllPaths] = useState(false);
  const [externalSessionCount, setExternalSessionCount] = useState<number | null>(null);
  // Variant D only

  const machineSessions = useMemo(() => {
    if (!sessions || !machineId) return [];

    return sessions.filter(item => {
      if (typeof item === 'string') return false;
      const session = item as Session;
      return session.metadata?.machineId === machineId;
    }) as Session[];
  }, [sessions, machineId]);

  const previousSessions = useMemo(() => {
    return [...machineSessions].sort(compareUpdatedDesc).slice(0, 5);
  }, [machineSessions]);

  const recentPaths = useMemo(() => {
    const paths = new Set<string>();
    machineSessions.forEach(session => {
      if (session.metadata?.path) {
        paths.add(session.metadata.path);
      }
    });
    return Array.from(paths).sort();
  }, [machineSessions]);

  const pathsToShow = useMemo(() => {
    if (showAllPaths) return recentPaths;
    return recentPaths.slice(0, 5);
  }, [recentPaths, showAllPaths]);

  // Determine daemon status from metadata
  const refreshExternalSessionCount = useCallback(async () => {
    if (!machineId || !machine || !isMachineOnline(machine)) {
      setExternalSessionCount(null);
      return;
    }

    try {
      const result = await machineListExternalAgentSessions(machineId);
      setExternalSessionCount(result.sessions.length);
    } catch {
      setExternalSessionCount(null);
    }
  }, [machine, machineId]);

  useFocusEffect(
    useCallback(() => {
      refreshExternalSessionCount().catch(() => undefined);
    }, [refreshExternalSessionCount])
  );

  const daemonStatus = useMemo(() => {
    if (!machine) return 'unknown';

    // Check metadata for daemon status
    const metadata = machine.metadata as any;
    if (metadata?.daemonLastKnownStatus === 'shutting-down') {
      return 'stopped';
    }

    // Use machine online status as proxy for daemon status
    return isMachineOnline(machine) ? 'likely alive' : 'stopped';
  }, [machine]);

  const handleStopDaemon = async () => {
    // Show confirmation modal using alert with buttons
    Modal.alert(
      t('machine.stopDaemonConfirmTitle'),
      t('machine.stopDaemonConfirmMessage'),
      [
        {
          text: t('common.cancel'),
          style: 'cancel',
        },
        {
          text: t('machine.stopDaemon'),
          style: 'destructive',
          onPress: async () => {
            setIsStoppingDaemon(true);
            try {
              const result = await machineStopDaemon(machineId!);
              Modal.alert(t('machine.daemonStopped'), result.message);
              // Refresh to get updated metadata
              await sync.refreshMachines();
            } catch (error) {
              Modal.alert(t('common.error'), t('machine.failedToStopDaemon'));
            } finally {
              setIsStoppingDaemon(false);
            }
          },
        },
      ]
    );
  };

  // inline control below

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await sync.refreshMachines();
    setIsRefreshing(false);
  };

  const handleRenameMachine = async () => {
    if (!machine || !machineId) return;

    const newDisplayName = await Modal.prompt(
      t('machine.renameMachine'),
      t('machine.renameMachineMessage'),
      {
        defaultValue: machine.metadata?.displayName || '',
        placeholder: machine.metadata?.host || t('machine.enterMachineName'),
        cancelText: t('common.cancel'),
        confirmText: t('common.rename'),
      }
    );

    if (newDisplayName !== null) {
      setIsRenamingMachine(true);
      try {
        const updatedMetadata = {
          ...machine.metadata!,
          displayName: newDisplayName.trim() || undefined,
        };

        await machineUpdateMetadata(machineId, updatedMetadata, machine.metadataVersion);

        Modal.alert(t('common.success'), t('machine.machineRenamed'));
      } catch (error) {
        Modal.alert(t('common.error'), safeStringify(error));
        // Refresh to get latest state
        await sync.refreshMachines();
      } finally {
        setIsRenamingMachine(false);
      }
    }
  };

  const handleStartSession = async (
    approvedNewDirectoryCreation: boolean = false
  ): Promise<void> => {
    if (!machine || !machineId) return;
    try {
      const pathToUse = customPath.trim() || '~';
      if (!isMachineOnline(machine)) return;
      setIsSpawning(true);
      const absolutePath = resolveAbsolutePath(pathToUse, machine?.metadata?.homeDir);
      const result = await machineSpawnNewSession({
        machineId: machineId!,
        directory: absolutePath,
        approvedNewDirectoryCreation,
      });
      switch (result.type) {
        case 'success':
          // Dismiss machine picker & machine detail screen
          router.back();
          router.back();
          navigateToSession(result.sessionId);
          break;
        case 'requestToApproveDirectoryCreation': {
          const approved = await Modal.confirm(
            t('machine.createDirectoryTitle'),
            t('machine.createDirectoryMessage', { directory: result.directory }),
            { cancelText: t('common.cancel'), confirmText: t('common.create') }
          );
          if (approved) {
            await handleStartSession(true);
          }
          break;
        }
        case 'error':
          Modal.alert(t('common.error'), result.errorMessage);
          break;
      }
    } catch (error) {
      let errorMessage = t('machine.failedToStartSession');
      const errMsg = safeStringify(error);
      if (!errMsg.includes('Failed to spawn session')) {
        errorMessage = errMsg;
      }
      Modal.alert(t('common.error'), errorMessage);
    } finally {
      setIsSpawning(false);
    }
  };

  if (!machine) {
    return (
      <>
        <Stack.Screen
          options={{
            headerShown: true,
            headerTitle: '',
            headerBackTitle: t('machine.back'),
          }}
        />
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <Text style={[Typography.default(), { fontSize: 16, color: '#666' }]}>
            {t('machine.machineNotFound')}
          </Text>
        </View>
      </>
    );
  }

  const metadata = machine.metadata;
  const machineName = metadata?.displayName || metadata?.host || 'unknown machine';

  const spawnButtonDisabled = !customPath.trim() || isSpawning || !isMachineOnline(machine!);

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: () => (
            <View style={{ alignItems: 'center' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Ionicons
                  name="desktop-outline"
                  size={18}
                  color={theme.colors.header.tint}
                  style={{ marginRight: 6 }}
                />
                <Text
                  style={[
                    Typography.default('semiBold'),
                    { fontSize: 17, color: theme.colors.header.tint },
                  ]}
                >
                  {machineName}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                <View
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: isMachineOnline(machine) ? '#34C759' : '#999',
                    marginRight: 4,
                  }}
                />
                <Text
                  style={[
                    Typography.default(),
                    {
                      fontSize: 12,
                      color: isMachineOnline(machine) ? '#34C759' : '#999',
                    },
                  ]}
                >
                  {isMachineOnline(machine) ? t('status.online') : t('status.offline')}
                </Text>
              </View>
            </View>
          ),
          headerRight: () => (
            <Pressable
              onPress={handleRenameMachine}
              hitSlop={10}
              style={{
                opacity: isRenamingMachine ? 0.5 : 1,
              }}
              disabled={isRenamingMachine}
            >
              <Octicons name="pencil" size={24} color={theme.colors.text} />
            </Pressable>
          ),
          headerBackTitle: t('machine.back'),
        }}
      />
      <ItemList
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
      >
        {/* Launch section */}
        {machine && (
          <>
            {!isMachineOnline(machine) && (
              <ItemGroup>
                <Item
                  title={t('machine.offlineUnableToSpawn')}
                  subtitle={t('machine.offlineHelp')}
                  subtitleLines={0}
                  showChevron={false}
                />
              </ItemGroup>
            )}
            <ItemGroup title={t('machine.launchNewSessionInDirectory')}>
              <View style={{ opacity: isMachineOnline(machine) ? 1 : 0.5 }}>
                <View style={styles.pathInputContainer}>
                  <View style={[styles.pathInput, { paddingVertical: 8 }]}>
                    <MultiTextInput
                      ref={inputRef}
                      value={customPath}
                      onChangeText={setCustomPath}
                      placeholder={t('machine.enterCustomPath')}
                      maxHeight={76}
                      paddingTop={8}
                      paddingBottom={8}
                      paddingRight={48}
                    />
                    <Pressable
                      onPress={() => handleStartSession()}
                      disabled={spawnButtonDisabled}
                      style={[
                        styles.inlineSendButton,
                        spawnButtonDisabled ? styles.inlineSendInactive : styles.inlineSendActive,
                      ]}
                    >
                      <Ionicons
                        name="play"
                        size={16}
                        color={
                          spawnButtonDisabled
                            ? theme.colors.textSecondary
                            : theme.colors.button.primary.tint
                        }
                        style={{ marginLeft: 1 }}
                      />
                    </Pressable>
                  </View>
                </View>
                <View style={{ paddingTop: 4 }} />
                {pathsToShow.map((path, index) => {
                  const display = formatPathRelativeToHome(path, machine.metadata?.homeDir);
                  const isSelected = customPath.trim() === display;
                  const isLast = index === pathsToShow.length - 1;
                  const hideDivider = isLast && pathsToShow.length <= 5;
                  return (
                    <Item
                      key={path}
                      title={display}
                      leftElement={
                        <Ionicons
                          name="folder-outline"
                          size={18}
                          color={theme.colors.textSecondary}
                        />
                      }
                      onPress={
                        isMachineOnline(machine)
                          ? () => {
                              setCustomPath(display);
                              setTimeout(() => inputRef.current?.focus(), 50);
                            }
                          : undefined
                      }
                      disabled={!isMachineOnline(machine)}
                      selected={isSelected}
                      showChevron={false}
                      pressableStyle={
                        isSelected ? { backgroundColor: theme.colors.surfaceSelected } : undefined
                      }
                      showDivider={!hideDivider}
                    />
                  );
                })}
                {recentPaths.length > 5 && (
                  <Item
                    title={
                      showAllPaths
                        ? t('machineLauncher.showLess')
                        : t('machineLauncher.showAll', { count: recentPaths.length })
                    }
                    onPress={() => setShowAllPaths(!showAllPaths)}
                    showChevron={false}
                    showDivider={false}
                    titleStyle={{
                      textAlign: 'center',
                      color: (theme as any).dark
                        ? theme.colors.button.primary.tint
                        : theme.colors.button.primary.background,
                    }}
                  />
                )}
              </View>
            </ItemGroup>
          </>
        )}

        {/* Daemon */}
        <ItemGroup title={t('machine.daemon')}>
          <Item
            title={t('machine.status')}
            detail={daemonStatus}
            detailStyle={{
              color: daemonStatus === 'likely alive' ? '#34C759' : '#FF9500',
            }}
            showChevron={false}
          />
          <Item
            title={t('machine.stopDaemon')}
            titleStyle={{
              color: daemonStatus === 'stopped' ? '#999' : '#FF9500',
            }}
            onPress={daemonStatus === 'stopped' ? undefined : handleStopDaemon}
            disabled={isStoppingDaemon || daemonStatus === 'stopped'}
            rightElement={
              isStoppingDaemon ? (
                <ActivityIndicator size="small" color={theme.colors.textSecondary} />
              ) : (
                <Ionicons
                  name="stop-circle"
                  size={20}
                  color={daemonStatus === 'stopped' ? '#999' : '#FF9500'}
                />
              )
            }
          />
          {machine.daemonState && (
            <>
              {machine.daemonState.pid && (
                <Item
                  title={t('machine.lastKnownPid')}
                  subtitle={String(machine.daemonState.pid)}
                  subtitleStyle={{ fontFamily: 'Menlo', fontSize: 13 }}
                />
              )}
              {machine.daemonState.httpPort && (
                <Item
                  title={t('machine.lastKnownHttpPort')}
                  subtitle={String(machine.daemonState.httpPort)}
                  subtitleStyle={{ fontFamily: 'Menlo', fontSize: 13 }}
                />
              )}
              {machine.daemonState.startTime && (
                <Item
                  title={t('machine.startedAt')}
                  subtitle={new Date(machine.daemonState.startTime).toLocaleString()}
                />
              )}
              {machine.daemonState.startedWithCliVersion && (
                <Item
                  title={t('machine.cliVersion')}
                  subtitle={machine.daemonState.startedWithCliVersion}
                  subtitleStyle={{ fontFamily: 'Menlo', fontSize: 13 }}
                />
              )}
            </>
          )}
          <Item
            title={t('machine.daemonStateVersion')}
            subtitle={String(machine.daemonStateVersion)}
          />
        </ItemGroup>

        {/* Previous Sessions (debug view) */}
        {previousSessions.length > 0 && (
          <ItemGroup title={t('machine.previousSessions')}>
            {previousSessions.map(session => (
              <Item
                key={session.id}
                title={getSessionName(session)}
                subtitle={getSessionSubtitle(session)}
                onPress={() => navigateToSession(session.id)}
                rightElement={<Ionicons name="chevron-forward" size={20} color="#C7C7CC" />}
              />
            ))}
          </ItemGroup>
        )}

        <ItemGroup title={t('machineImport.title')}>
          <Item
            title={t('machineImport.browse')}
            subtitle={
              externalSessionCount == null
                ? t('machineImport.machineSummarySimple')
                : t('machineImport.machineSummaryCount', { count: externalSessionCount })
            }
            subtitleLines={0}
            leftElement={
              <Ionicons name="sparkles-outline" size={18} color={theme.colors.textSecondary} />
            }
            onPress={() => router.push(`/machine/${machineId}/import-sessions`)}
          />
        </ItemGroup>

        {/* Machine */}
        <ItemGroup title={t('machine.machineGroup')}>
          <Item title={t('machine.host')} subtitle={metadata?.host || machineId} />
          <Item
            title={t('machine.machineId')}
            subtitle={machineId}
            subtitleStyle={{ fontFamily: 'Menlo', fontSize: 12 }}
          />
          {metadata?.username && (
            <Item title={t('machine.username')} subtitle={metadata.username} />
          )}
          {metadata?.homeDir && (
            <Item
              title={t('machine.homeDirectory')}
              subtitle={metadata.homeDir}
              subtitleStyle={{ fontFamily: 'Menlo', fontSize: 13 }}
            />
          )}
          {metadata?.platform && (
            <Item title={t('machine.platform')} subtitle={metadata.platform} />
          )}
          {metadata?.arch && <Item title={t('machine.architecture')} subtitle={metadata.arch} />}
          <Item
            title={t('machine.lastSeen')}
            subtitle={
              machine.activeAt ? new Date(machine.activeAt).toLocaleString() : t('machine.never')
            }
          />
          <Item title={t('machine.metadataVersion')} subtitle={String(machine.metadataVersion)} />
        </ItemGroup>
      </ItemList>
    </>
  );
}
