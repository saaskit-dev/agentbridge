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
    paddingVertical: 16,
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
  breadcrumbContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 8,
    flexWrap: 'wrap',
    gap: 2,
  },
  breadcrumbText: {
    fontSize: 13,
    color: theme.colors.tint,
    ...Typography.default(),
  },
  breadcrumbSeparator: {
    fontSize: 13,
    color: theme.colors.textTertiary,
    marginHorizontal: 2,
    ...Typography.default(),
  },
  breadcrumbCurrent: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    ...Typography.default(),
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
    async (path: string) => {
      if (!params.machineId) return;
      setLoading(true);
      setBrowseError(null);
      try {
        const result = await machineListDirectory(params.machineId, path);
        if (result.success && result.entries) {
          // Sort: directories first, then alphabetical
          const sorted = [...result.entries].sort((a, b) => {
            if (a.type === 'directory' && b.type !== 'directory') return -1;
            if (a.type !== 'directory' && b.type === 'directory') return 1;
            return a.name.localeCompare(b.name);
          });
          setEntries(sorted);
          setBrowsePath(path);
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

  // Auto-browse when the screen opens with a selectedPath
  useEffect(() => {
    if (params.selectedPath && params.machineId) {
      loadDirectory(params.selectedPath);
    } else if (params.machineId && machine?.metadata?.homeDir) {
      loadDirectory(machine.metadata.homeDir);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Breadcrumb segments
  const breadcrumbs = useMemo(() => {
    if (!browsePath) return [];
    const parts = browsePath.split('/').filter(Boolean);
    const segments: Array<{ label: string; path: string }> = [{ label: '/', path: '/' }];
    let accumulated = '';
    for (const part of parts) {
      accumulated += '/' + part;
      segments.push({ label: part, path: accumulated });
    }
    return segments;
  }, [browsePath]);

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
            <ItemGroup title={t('pathPicker.enterPath')}>
              <View style={styles.pathInputContainer}>
                <View style={[styles.pathInput, { paddingVertical: 8 }]}>
                  <MultiTextInput
                    ref={inputRef}
                    value={customPath}
                    onChangeText={setCustomPath}
                    placeholder={t('pathPicker.enterPathPlaceholder')}
                    maxHeight={76}
                    paddingTop={8}
                    paddingBottom={8}
                  />
                </View>
              </View>
            </ItemGroup>

            {/* Breadcrumb navigation */}
            {browsePath && breadcrumbs.length > 0 && (
              <View style={styles.breadcrumbContainer}>
                {breadcrumbs.map((seg, i) => {
                  const isLast = i === breadcrumbs.length - 1;
                  return (
                    <React.Fragment key={seg.path}>
                      {i > 0 && <Text style={styles.breadcrumbSeparator}>/</Text>}
                      {isLast ? (
                        <Text style={styles.breadcrumbCurrent}>{seg.label}</Text>
                      ) : (
                        <Pressable onPress={() => loadDirectory(seg.path)}>
                          <Text style={styles.breadcrumbText}>{seg.label}</Text>
                        </Pressable>
                      )}
                    </React.Fragment>
                  );
                })}
              </View>
            )}

            {/* Directory browser */}
            {browsePath !== null && (
              <ItemGroup title={t('pathPicker.browse')}>
                {loading ? (
                  <View style={styles.loadingContainer}>
                    <ActivityIndicator size="small" color={theme.colors.tint} />
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
                            color={theme.colors.tint}
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

            {/* Recent paths */}
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
          </View>
        </ScrollView>
      </View>
    </>
  );
}
