import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { Stack, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { AgentFlavorIcon } from '@/components/AgentFlavorIcon';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { Typography } from '@/constants/Typography';
import { Modal } from '@/modal';
import {
  machineListExternalAgentSessionsForAgent,
  machineListSupportedAgents,
  machineSpawnNewSession,
  type ExternalAgentSessionSummary,
} from '@/sync/ops';
import { useMachine, useSessions } from '@/sync/storage';
import type { Session } from '@/sync/storageTypes';
import { t } from '@/text';
import { formatPathRelativeToHome } from '@/utils/sessionUtils';
import { useNavigateToSession } from '@/hooks/useNavigateToSession';

type AgentFilter = 'all' | string;
type DisplaySession = ExternalAgentSessionSummary & { importedSessionId?: string | null };
type AgentLoadState = 'idle' | 'loading' | 'ready' | 'unsupported' | 'error';

type ScreenCacheEntry = {
  sessions: ExternalAgentSessionSummary[];
  agentStates: Record<string, AgentLoadState>;
  loadErrors: Array<{ agentType: string; error: string }>;
  cachedAt: number | null;
  candidateAgents: string[];
};

const screenCache = new Map<string, ScreenCacheEntry>();

const styles = StyleSheet.create(theme => ({
  page: {
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
  },
  searchWrap: {
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 16,
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.divider,
  },
  searchInput: {
    flex: 1,
    color: theme.colors.text,
    fontSize: 15,
    ...Typography.default(),
  },
  filterSection: {
    marginBottom: 8,
  },
  chipScrollContent: {
    paddingHorizontal: 16,
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.divider,
  },
  chipActive: {
    borderColor: theme.colors.button.primary.background,
    backgroundColor: theme.colors.surfaceSelected,
  },
  chipText: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    ...Typography.default('semiBold'),
  },
  chipTextActive: {
    color: theme.colors.button.primary.background,
  },
  emptyText: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    ...Typography.default(),
  },
  listContent: {
    paddingBottom: 24,
  },
  emptyState: {
    marginHorizontal: 16,
    paddingVertical: 16,
  },
}));

function formatAgentLabel(agent: string): string {
  if (agent === 'claude') return 'Claude';
  if (agent === 'codex') return 'Codex';
  if (agent === 'opencode') return 'OpenCode';
  if (agent === 'cursor') return 'Cursor';
  if (agent === 'gemini') return 'Gemini';
  return agent;
}

function sessionBelongsToMachine(session: Session, machineId: string): boolean {
  return session.metadata?.machineId === machineId;
}

export default function ImportSessionsScreen() {
  const { theme } = useUnistyles();
  const { id: machineId } = useLocalSearchParams<{ id: string }>();
  const machine = useMachine(machineId!);
  const allSessions = useSessions();
  const navigateToSession = useNavigateToSession();
  const initialCache = machineId ? screenCache.get(machineId) : undefined;

  const [query, setQuery] = React.useState('');
  const [agentFilter, setAgentFilter] = React.useState<AgentFilter>('all');
  const [loading, setLoading] = React.useState(!initialCache);
  const [refreshing, setRefreshing] = React.useState(false);
  const [candidateAgents, setCandidateAgents] = React.useState<string[]>(initialCache?.candidateAgents ?? []);
  const [externalSessions, setExternalSessions] = React.useState<ExternalAgentSessionSummary[]>(
    initialCache?.sessions ?? []
  );
  const [agentStates, setAgentStates] = React.useState<Record<string, AgentLoadState>>(
    initialCache?.agentStates ?? {}
  );
  const [loadErrors, setLoadErrors] = React.useState<Array<{ agentType: string; error: string }>>(
    initialCache?.loadErrors ?? []
  );
  const [cachedAt, setCachedAt] = React.useState<number | null>(initialCache?.cachedAt ?? null);
  const [importingId, setImportingId] = React.useState<string | null>(null);
  const requestIdRef = React.useRef(0);
  const inFlightAgentsRef = React.useRef(new Set<string>());

  const applyAgentResult = React.useCallback(
    (
      agentType: string,
      result: {
        sessions: ExternalAgentSessionSummary[];
        listableAgents: string[];
        errors: Array<{ agentType: string; error: string }>;
        cachedAt?: number;
      }
    ) => {
      setCachedAt(result.cachedAt ?? Date.now());
      setExternalSessions(current => [
        ...current.filter(item => item.agentType !== agentType),
        ...result.sessions,
      ]);
      setLoadErrors(current => [
        ...current.filter(item => item.agentType !== agentType),
        ...result.errors,
      ]);

      const failed = result.errors.some(item => item.agentType === agentType);
      const listable = result.listableAgents.includes(agentType);
      setAgentStates(current => ({
        ...current,
        [agentType]: failed ? 'error' : listable ? 'ready' : 'unsupported',
      }));
    },
    []
  );

  const loadAgent = React.useCallback(
    async (agentType: string, requestId: number, forceRefresh: boolean) => {
      if (!machineId || inFlightAgentsRef.current.has(agentType)) return;
      inFlightAgentsRef.current.add(agentType);
      setAgentStates(current => ({ ...current, [agentType]: 'loading' }));
      try {
        const result = await machineListExternalAgentSessionsForAgent(
          machineId,
          agentType,
          undefined,
          forceRefresh
        );
        if (requestIdRef.current !== requestId) return;
        applyAgentResult(agentType, result);
      } catch {
        if (requestIdRef.current !== requestId) return;
        setLoadErrors(current => {
          const next = current.filter(item => item.agentType !== agentType);
          return [...next, { agentType, error: 'load_failed' }];
        });
        setAgentStates(current => ({ ...current, [agentType]: 'error' }));
      } finally {
        inFlightAgentsRef.current.delete(agentType);
      }
    },
    [applyAgentResult, machineId]
  );

  const load = React.useCallback(async (forceRefresh = false) => {
    if (!machineId) return;
    const requestId = ++requestIdRef.current;
    inFlightAgentsRef.current.clear();
    setRefreshing(true);
    try {
      const supported = await machineListSupportedAgents(machineId);
      if (requestIdRef.current !== requestId) return;

      const nextCandidateAgents = supported.filter(agent =>
        ['claude', 'codex', 'opencode', 'gemini', 'cursor'].includes(agent)
      );
      setCandidateAgents(nextCandidateAgents);

      setAgentStates(current => {
        const next: Record<string, AgentLoadState> = {};
        for (const agent of nextCandidateAgents) {
          if (!forceRefresh && current[agent] && current[agent] !== 'idle') {
            next[agent] = current[agent];
          } else {
            next[agent] = 'idle';
          }
        }
        return next;
      });
      setLoadErrors(current => current.filter(item => nextCandidateAgents.includes(item.agentType)));
      if (forceRefresh) {
        setExternalSessions([]);
      }

      const prioritizedAgent = nextCandidateAgents[0];
      const remainingAgents = nextCandidateAgents.filter(agent => agent !== prioritizedAgent);

      if (prioritizedAgent) {
        await loadAgent(prioritizedAgent, requestId, forceRefresh);
      }
      if (requestIdRef.current !== requestId) return;
      setLoading(false);

      for (const agent of remainingAgents) {
        if (requestIdRef.current !== requestId) return;
        await loadAgent(agent, requestId, forceRefresh);
      }
    } finally {
      if (requestIdRef.current === requestId) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [loadAgent, machineId]);

  useFocusEffect(
    React.useCallback(() => {
      load(false).catch(() => undefined);
    }, [load])
  );

  React.useEffect(() => {
    if (!machineId) return;
    screenCache.set(machineId, {
      sessions: externalSessions,
      agentStates,
      loadErrors,
      cachedAt,
      candidateAgents,
    });
  }, [agentStates, cachedAt, candidateAgents, externalSessions, loadErrors, machineId]);

  const importedSessionMap = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const item of allSessions) {
      if (typeof item === 'string') continue;
      const session = item as Session;
      if (!sessionBelongsToMachine(session, machineId!)) continue;
      const agentSessionId = session.metadata?.agentSessionId;
      if (agentSessionId && session.metadata?.flavor) {
        map.set(`${session.metadata.flavor}:${agentSessionId}`, session.id);
      } else if (agentSessionId) {
        map.set(agentSessionId, session.id);
      }
    }
    return map;
  }, [allSessions, machineId]);

  const displaySessions = React.useMemo<DisplaySession[]>(() => {
    const agentOrder = new Map(candidateAgents.map((agent, index) => [agent, index]));
    return externalSessions
      .map(session => ({
        ...session,
        importedSessionId:
          importedSessionMap.get(`${session.agentType}:${session.sessionId}`) ??
          importedSessionMap.get(session.sessionId) ??
          null,
      }))
      .sort((a, b) => {
        const agentDiff = (agentOrder.get(a.agentType) ?? 999) - (agentOrder.get(b.agentType) ?? 999);
        if (agentDiff !== 0) return agentDiff;
        return String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? ''));
      });
  }, [candidateAgents, externalSessions, importedSessionMap]);

  const agentOptions = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const session of displaySessions) {
      counts.set(session.agentType, (counts.get(session.agentType) ?? 0) + 1);
    }
    const allAgents = candidateAgents.length > 0 ? candidateAgents : Object.keys(agentStates);
    return [
      { id: 'all', label: t('machineImport.filters.allAgents'), count: displaySessions.length },
      ...allAgents.map(agent => ({
        id: agent,
        label: formatAgentLabel(agent),
        count: counts.get(agent) ?? 0,
        state: agentStates[agent],
      })),
    ];
  }, [agentStates, candidateAgents, displaySessions]);

  const unsupportedAgents = React.useMemo(
    () => Object.entries(agentStates).filter(([, state]) => state === 'unsupported').map(([agent]) => agent),
    [agentStates]
  );

  const loadingAgents = React.useMemo(
    () => Object.entries(agentStates).filter(([, state]) => state === 'loading').map(([agent]) => agent),
    [agentStates]
  );

  const filtered = React.useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return displaySessions.filter(session => {
      if (agentFilter !== 'all' && session.agentType !== agentFilter) return false;
      if (!normalized) return true;
      return (
        (session.title ?? '').toLowerCase().includes(normalized) ||
        session.cwd.toLowerCase().includes(normalized) ||
        session.agentType.toLowerCase().includes(normalized)
      );
    });
  }, [agentFilter, displaySessions, query]);

  const visibleSessions = filtered;

  const machineLabel = machine?.metadata?.displayName || machine?.metadata?.host || machineId;

  const handleImport = React.useCallback(
    async (session: DisplaySession) => {
      if (session.importedSessionId) {
        navigateToSession(session.importedSessionId);
        return;
      }

      const confirmed = await Modal.confirm(
        t('machineImport.continueTitle'),
        t('machineImport.continueBody', { agent: formatAgentLabel(session.agentType) }),
        {
          cancelText: t('common.cancel'),
          confirmText: t('machineImport.continueHere'),
        }
      );
      if (!confirmed) return;

      setImportingId(session.sessionId);
      try {
        const result = await machineSpawnNewSession({
          machineId: machineId!,
          directory: session.cwd,
          agent: session.agentType,
          resumeAgentSessionId: session.sessionId,
        });

        if (result.type === 'success') {
          navigateToSession(result.sessionId);
          return;
        }

        if (result.type === 'requestToApproveDirectoryCreation') {
          const approved = await Modal.confirm(
            t('machineImport.directoryMissingTitle'),
            t('machineImport.directoryMissingBody', { directory: result.directory }),
            { cancelText: t('common.cancel'), confirmText: t('common.create') }
          );
          if (!approved) return;

          const retried = await machineSpawnNewSession({
            machineId: machineId!,
            directory: result.directory,
            agent: session.agentType,
            resumeAgentSessionId: session.sessionId,
            approvedNewDirectoryCreation: true,
          });
          if (retried.type === 'success') {
            navigateToSession(retried.sessionId);
          } else if (retried.type === 'error') {
            Modal.alert(t('common.error'), retried.errorMessage);
          }
          return;
        }

        Modal.alert(t('common.error'), result.errorMessage);
      } finally {
        setImportingId(null);
      }
    },
    [machineId, navigateToSession]
  );

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: String(machineLabel),
          headerBackTitle: t('machine.back'),
        }}
      />

      <View style={{ flex: 1, backgroundColor: theme.colors.groupped.background }}>
        <FlatList
          data={visibleSessions}
          keyExtractor={item => `${item.agentType}:${item.sessionId}`}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={16}
          maxToRenderPerBatch={16}
          windowSize={8}
          removeClippedSubviews
          ListHeaderComponent={
            <View style={styles.page}>
              <View style={styles.searchWrap}>
                {loading ? (
                  <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                ) : (
                  <Ionicons name="search" size={16} color={theme.colors.textSecondary} />
                )}
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder={t('machineImport.searchPlaceholder')}
                  placeholderTextColor={theme.colors.textSecondary}
                  style={styles.searchInput}
                  editable={!loading}
                />
                {!loading && (
                  <Pressable onPress={() => load(true)} hitSlop={8}>
                    <Ionicons name="refresh" size={16} color={theme.colors.textSecondary} />
                  </Pressable>
                )}
              </View>

              {agentOptions.length > 1 && (
                <View style={styles.filterSection}>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.chipScrollContent}
                  >
                    {agentOptions.map(option => {
                      const active = agentFilter === option.id;
                      return (
                        <Pressable
                          key={option.id}
                          onPress={() => setAgentFilter(option.id)}
                          style={[styles.chip, active && styles.chipActive]}
                        >
                          <Text style={[styles.chipText, active && styles.chipTextActive]}>
                            {option.id === 'all'
                              ? `${option.label} · ${option.count}`
                              : `${option.label}${option.state === 'loading' ? ' · …' : ` · ${option.count}`}`}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>
              )}

              {(loadingAgents.length > 0 || loadErrors.length > 0 || unsupportedAgents.length > 0 || cachedAt) && (
                <ItemGroup title={undefined}>
                  {loadingAgents.length > 0 && (
                    <Item
                      title={t('machineImport.loadingProgress', {
                        loaded: Object.values(agentStates).filter(state => state !== 'loading').length,
                        total: Object.keys(agentStates).length,
                      })}
                      subtitle={loadingAgents.map(formatAgentLabel).join(' · ')}
                      subtitleLines={1}
                      leftElement={<ActivityIndicator size="small" color={theme.colors.textSecondary} />}
                      showChevron={false}
                    />
                  )}
                  {loadErrors.length > 0 && (
                    <Item
                      title={t('machineImport.noticeLoadFailed')}
                      subtitle={t('machineImport.partialFailure', {
                        count: loadErrors.length,
                        agents: loadErrors.map(item => formatAgentLabel(item.agentType)).join(' · '),
                      })}
                      subtitleLines={0}
                      leftElement={<Ionicons name="warning-outline" size={18} color={theme.colors.textSecondary} />}
                      showChevron={false}
                    />
                  )}
                  {unsupportedAgents.length > 0 && (
                    <Item
                      title={t('machineImport.noticeUnsupported')}
                      subtitle={t('machineImport.unsupportedAgents', {
                        agents: unsupportedAgents.map(formatAgentLabel).join(' · '),
                      })}
                      subtitleLines={0}
                      leftElement={<Ionicons name="information-circle-outline" size={18} color={theme.colors.textSecondary} />}
                      showChevron={false}
                    />
                  )}
                  {cachedAt && loadingAgents.length === 0 && (
                    <Item
                      title={t('machineImport.noticeUpdated')}
                      subtitle={t('machineImport.cachedAt', {
                        time: new Date(cachedAt).toLocaleTimeString(),
                      })}
                      leftElement={<Ionicons name="time-outline" size={18} color={theme.colors.textSecondary} />}
                      showChevron={false}
                    />
                  )}
                </ItemGroup>
              )}
            </View>
          }
          renderItem={({ item }) => {
            const imported = Boolean(item.importedSessionId);
            const path = formatPathRelativeToHome(item.cwd, machine?.metadata?.homeDir);
            const meta = `${path} · ${formatAgentLabel(item.agentType)} · ${item.updatedAt ?? ''}`;
            return (
              <View style={styles.page}>
                <ItemGroup title={undefined} headerStyle={{ paddingTop: 0, paddingBottom: 0 }}>
                  <Item
                    title={item.title || item.sessionId}
                    subtitle={meta}
                    subtitleLines={2}
                    leftElement={<AgentFlavorIcon flavor={item.agentType as any} size={20} tintColor={null} />}
                    detail={imported ? t('machineImport.managed') : undefined}
                    detailStyle={{ color: imported ? '#1E8E3E' : theme.colors.textSecondary }}
                    loading={importingId === item.sessionId}
                    disabled={importingId != null && importingId !== item.sessionId}
                    onPress={() => handleImport(item)}
                    rightElement={
                      importingId === item.sessionId ? undefined : (
                        <Ionicons name="chevron-forward" size={18} color={theme.colors.textSecondary} />
                      )
                    }
                  />
                </ItemGroup>
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={[styles.page, styles.emptyState]}>
              <Text style={styles.emptyText}>
                {loading || refreshing ? t('common.loading') : t('machineImport.emptyBody')}
              </Text>
            </View>
          }
        />
      </View>
    </>
  );
}
