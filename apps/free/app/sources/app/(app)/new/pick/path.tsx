import { Ionicons } from '@expo/vector-icons';
import { CommonActions, useNavigation } from '@react-navigation/native';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { layout } from '@/components/layout';
import { MultiTextInput, MultiTextInputHandle } from '@/components/MultiTextInput';
import { Typography } from '@/constants/Typography';
import { machineListDirectory } from '@/sync/ops';
import type { DirectoryEntry } from '@/sync/ops';
import { useAllMachines, useSessions, useSetting } from '@/sync/storage';
import { t } from '@/text';

const stylesheet = StyleSheet.create(theme => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.groupped.background,
  },
  scrollContainer: {
    flex: 1,
  },
  scrollContent: {
    alignItems: 'center',
  },
  contentWrapper: {
    width: '100%',
    maxWidth: layout.maxWidth,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  emptyText: {
    fontSize: 16,
    color: theme.colors.textSecondary,
    textAlign: 'center',
    ...Typography.default(),
  },
  pathInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  pathInput: {
    flex: 1,
    backgroundColor: theme.colors.input.background,
    borderRadius: 10,
    paddingHorizontal: 12,
    minHeight: 36,
    position: 'relative',
    borderWidth: 0.5,
    borderColor: theme.colors.divider,
  },
  loadingContainer: {
    padding: 20,
    alignItems: 'center',
  },
  errorText: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    textAlign: 'center',
    padding: 16,
    ...Typography.default(),
  },
}));

export default function PathPickerScreen() {
  const { theme } = useUnistyles();
  const styles = stylesheet;
  const router = useRouter();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ machineId?: string; selectedPath?: string }>();
  const machines = useAllMachines();
  const sessions = useSessions();
  const inputRef = useRef<MultiTextInputHandle>(null);
  const recentMachinePaths = useSetting('recentMachinePaths');

  const [customPath, setCustomPath] = useState(params.selectedPath || '');
  const [browsePath, setBrowsePath] = useState<string | null>(null);
  const [entries, setEntries] = useState<DirectoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const isNavigatingRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Get the selected machine
  const machine = useMemo(() => {
    return machines.find(m => m.id === params.machineId);
  }, [machines, params.machineId]);

  // Get recent paths for this machine
  const recentPaths = useMemo(() => {
    if (!params.machineId) return [];

    const paths: string[] = [];
    const pathSet = new Set<string>();

    recentMachinePaths.forEach(entry => {
      if (entry.machineId === params.machineId && !pathSet.has(entry.path)) {
        paths.push(entry.path);
        pathSet.add(entry.path);
      }
    });

    if (sessions) {
      const pathsWithTimestamps: Array<{ path: string; timestamp: number }> = [];

      sessions.forEach(item => {
        if (typeof item === 'string') return;

        const session = item as any;
        if (session.metadata?.machineId === params.machineId && session.metadata?.path) {
          const path = session.metadata.path;
          if (!pathSet.has(path)) {
            pathSet.add(path);
            pathsWithTimestamps.push({
              path,
              timestamp: session.updatedAt || session.createdAt,
            });
          }
        }
      });

      pathsWithTimestamps
        .sort((a, b) => b.timestamp - a.timestamp)
        .forEach(item => paths.push(item.path));
    }

    return paths;
  }, [sessions, params.machineId, recentMachinePaths]);

  // Load directory contents
  const loadDirectory = useCallback(
    async (rawPath: string) => {
      if (!params.machineId) return;
      // Normalize: collapse consecutive slashes, strip trailing slash (keep root /)
      const path = rawPath.replace(/\/+/g, '/').replace(/(.)\/$/, '$1');
      setLoading(true);
      setBrowseError(null);
      try {
        const result = await machineListDirectory(params.machineId, path);
        if (result.success && result.entries) {
          const sorted = [...result.entries].sort((a, b) => {
            if (a.type === 'directory' && b.type !== 'directory') return -1;
            if (a.type !== 'directory' && b.type === 'directory') return 1;
            return a.name.localeCompare(b.name);
          });
          setEntries(sorted);
          setBrowsePath(path);
          // Sync input — mark as navigating to avoid debounce loop
          isNavigatingRef.current = true;
          setCustomPath(path);
        } else {
          setBrowseError(result.error || t('pathPicker.browseError'));
        }
      } catch {
        setBrowseError(t('pathPicker.browseError'));
      } finally {
        setLoading(false);
      }
    },
    [params.machineId]
  );

  // Navigate into a subdirectory
  const handleEntryPress = useCallback(
    (entry: DirectoryEntry) => {
      if (entry.type !== 'directory' || !browsePath) return;
      const newPath = browsePath === '/' ? `/${entry.name}` : `${browsePath}/${entry.name}`;
      loadDirectory(newPath);
    },
    [browsePath, loadDirectory]
  );

  // Navigate to parent directory
  const handleGoUp = useCallback(() => {
    if (!browsePath || browsePath === '/') return;
    const parent = browsePath.substring(0, browsePath.lastIndexOf('/')) || '/';
    loadDirectory(parent);
  }, [browsePath, loadDirectory]);

  // Start browsing from a path
  const handleStartBrowse = useCallback(
    (path: string) => {
      setCustomPath(path);
      loadDirectory(path);
    },
    [loadDirectory]
  );

  // Handle user typing in the path input
  const handlePathInput = useCallback(
    (text: string) => {
      setCustomPath(text);
      // Skip debounce if this change came from loadDirectory
      if (isNavigatingRef.current) {
        isNavigatingRef.current = false;
        return;
      }
      // Debounce: sync browser to input after user stops typing
      if (debounceRef.current) clearTimeout(debounceRef.current);
      const trimmed = text.trim();
      if (trimmed.startsWith('/')) {
        debounceRef.current = setTimeout(() => {
          if (trimmed !== browsePath) {
            loadDirectory(trimmed);
          }
        }, 500);
      }
    },
    [browsePath, loadDirectory]
  );

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Auto-browse when the screen opens
  useEffect(() => {
    if (!params.machineId || browsePath !== null) return;
    const target = params.selectedPath || machine?.metadata?.homeDir;
    if (target) loadDirectory(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machine?.metadata?.homeDir]);

  const handleSelectPath = React.useCallback(() => {
    const pathToUse = customPath.trim() || machine?.metadata?.homeDir || '/home';
    const state = navigation.getState();
    const previousRoute = state?.routes?.[state.index - 1];
    if (state && state.index > 0 && previousRoute) {
      navigation.dispatch({
        ...CommonActions.setParams({ path: pathToUse }),
        source: previousRoute.key,
      } as never);
    }
    router.back();
  }, [customPath, router, machine, navigation]);

  const directoryEntries = useMemo(
    () => entries.filter(e => e.type === 'directory'),
    [entries]
  );

  if (!machine) {
    return (
      <>
        <Stack.Screen
          options={{
            headerShown: true,
            headerTitle: t('pathPicker.headerTitle'),
            headerBackTitle: t('common.back'),
            headerRight: () => (
              <Pressable
                onPress={handleSelectPath}
                disabled={!customPath.trim()}
                style={({ pressed }) => ({
                  marginRight: 16,
                  opacity: pressed ? 0.7 : 1,
                  padding: 4,
                })}
              >
                <Ionicons name="checkmark" size={24} color={theme.colors.header.tint} />
              </Pressable>
            ),
          }}
        />
        <View style={styles.container}>
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>{t('pathPicker.noMachineSelected')}</Text>
          </View>
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: t('pathPicker.headerTitle'),
          headerBackTitle: t('common.back'),
          headerRight: () => (
            <Pressable
              onPress={handleSelectPath}
              disabled={!customPath.trim()}
              style={({ pressed }) => ({
                opacity: pressed ? 0.7 : 1,
                padding: 4,
              })}
            >
              <Ionicons name="checkmark" size={24} color={theme.colors.header.tint} />
            </Pressable>
          ),
        }}
      />
      <View style={styles.container}>
        <ScrollView
          style={styles.scrollContainer}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.contentWrapper}>
            {/* Recent paths — always on top */}
            {recentPaths.length > 0 && (
              <ItemGroup title={t('pathPicker.recentPaths')}>
                {recentPaths.map((path, index) => {
                  const isSelected = customPath.trim() === path;
                  const isLast = index === recentPaths.length - 1;

                  return (
                    <Item
                      key={path}
                      title={path}
                      leftElement={
                        <Ionicons
                          name="folder-outline"
                          size={18}
                          color={theme.colors.textSecondary}
                        />
                      }
                      onPress={() => handleStartBrowse(path)}
                      selected={isSelected}
                      showChevron={false}
                      pressableStyle={
                        isSelected ? { backgroundColor: theme.colors.surfaceSelected } : undefined
                      }
                      showDivider={!isLast}
                    />
                  );
                })}
              </ItemGroup>
            )}

            {/* Suggested paths — when no recent */}
            {recentPaths.length === 0 && (
              <ItemGroup title={t('pathPicker.suggestedPaths')}>
                {(() => {
                  const homeDir = machine.metadata?.homeDir || '/home';
                  const suggestedPaths = [
                    homeDir,
                    `${homeDir}/projects`,
                    `${homeDir}/Documents`,
                    `${homeDir}/Desktop`,
                  ];
                  return suggestedPaths.map((path, index) => {
                    const isSelected = customPath.trim() === path;

                    return (
                      <Item
                        key={path}
                        title={path}
                        leftElement={
                          <Ionicons
                            name="folder-outline"
                            size={18}
                            color={theme.colors.textSecondary}
                          />
                        }
                        onPress={() => handleStartBrowse(path)}
                        selected={isSelected}
                        showChevron={false}
                        pressableStyle={
                          isSelected ? { backgroundColor: theme.colors.surfaceSelected } : undefined
                        }
                        showDivider={index < 3}
                      />
                    );
                  });
                })()}
              </ItemGroup>
            )}

            {/* Path input */}
            <ItemGroup title={t('pathPicker.enterPath')}>
              <View style={styles.pathInputContainer}>
                <View style={[styles.pathInput, { paddingVertical: 8 }]}>
                  <MultiTextInput
                    ref={inputRef}
                    value={customPath}
                    onChangeText={handlePathInput}
                    placeholder={t('pathPicker.enterPathPlaceholder')}
                    maxHeight={76}
                    paddingTop={8}
                    paddingBottom={8}
                  />
                </View>
              </View>
            </ItemGroup>

            {/* Directory browser */}
            {browsePath !== null && (
              <ItemGroup title={t('pathPicker.browse')}>
                {loading ? (
                  <View style={styles.loadingContainer}>
                    <ActivityIndicator size="small" color={theme.colors.textLink} />
                  </View>
                ) : browseError ? (
                  <Text style={styles.errorText}>{browseError}</Text>
                ) : (
                  <>
                    {/* Go up (..) */}
                    {browsePath !== '/' && (
                      <Item
                        title=".."
                        leftElement={
                          <Ionicons
                            name="return-up-back-outline"
                            size={18}
                            color={theme.colors.textSecondary}
                          />
                        }
                        onPress={handleGoUp}
                        showChevron={false}
                        showDivider={directoryEntries.length > 0}
                      />
                    )}
                    {directoryEntries.map((entry, index) => (
                      <Item
                        key={entry.name}
                        title={entry.name}
                        leftElement={
                          <Ionicons
                            name="folder-outline"
                            size={18}
                            color={theme.colors.textLink}
                          />
                        }
                        onPress={() => handleEntryPress(entry)}
                        showChevron
                        showDivider={index < directoryEntries.length - 1}
                      />
                    ))}
                    {directoryEntries.length === 0 && browsePath !== '/' && (
                      <Text style={styles.errorText}>{t('pathPicker.emptyDirectory')}</Text>
                    )}
                  </>
                )}
              </ItemGroup>
            )}
          </View>
        </ScrollView>
      </View>
    </>
  );
}
