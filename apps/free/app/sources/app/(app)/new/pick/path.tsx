import { Ionicons } from '@expo/vector-icons';
import { CommonActions, useNavigation } from '@react-navigation/native';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator, Platform } from 'react-native';
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
import { isDesktopPlatform } from '@/utils/platform';

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
  keyboardHint: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    paddingHorizontal: 16,
    paddingBottom: 12,
    ...Typography.default(),
  },
}));

type KeyboardTarget =
  | { type: 'recent'; path: string }
  | { type: 'directory'; entry: DirectoryEntry }
  | { type: 'parent' };

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
  const isDesktop = isDesktopPlatform();

  const [customPath, setCustomPath] = useState(params.selectedPath || '');
  const [browsePath, setBrowsePath] = useState<string | null>(null);
  const [entries, setEntries] = useState<DirectoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const isNavigatingRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(0);

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
  const suggestedPaths = useMemo(() => {
    const homeDir = machine?.metadata?.homeDir || '/home';
    return [homeDir, `${homeDir}/projects`, `${homeDir}/Documents`, `${homeDir}/Desktop`];
  }, [machine?.metadata?.homeDir]);
  const quickAccessPaths = recentPaths.length > 0 ? recentPaths : suggestedPaths;
  const keyboardTargets = useMemo<KeyboardTarget[]>(() => {
    const targets: KeyboardTarget[] = [];
    quickAccessPaths.forEach(path => {
      targets.push({ type: 'recent', path });
    });
    if (browsePath !== null) {
      if (browsePath !== '/') {
        targets.push({ type: 'parent' });
      }
      directoryEntries.forEach(entry => {
        targets.push({ type: 'directory', entry });
      });
    }
    return targets;
  }, [browsePath, directoryEntries, quickAccessPaths]);

  useEffect(() => {
    if (!isDesktop) return;
    inputRef.current?.focus();
  }, [isDesktop]);

  useEffect(() => {
    setHighlightedIndex(current => {
      if (keyboardTargets.length === 0) return 0;
      return Math.min(current, keyboardTargets.length - 1);
    });
  }, [keyboardTargets.length]);

  const activateKeyboardTarget = useCallback(
    (target: KeyboardTarget | undefined) => {
      if (!target) {
        handleSelectPath();
        return;
      }
      if (target.type === 'recent') {
        handleStartBrowse(target.path);
        return;
      }
      if (target.type === 'parent') {
        handleGoUp();
        return;
      }
      handleEntryPress(target.entry);
    },
    [handleEntryPress, handleGoUp, handleSelectPath, handleStartBrowse]
  );

  useEffect(() => {
    if (!isDesktop || Platform.OS !== 'web') return;

    const handleWindowKeyDown = (event: KeyboardEvent) => {
      const isModifierPressed = event.metaKey || event.ctrlKey;
      if (isModifierPressed && event.key.toLowerCase() === 'l') {
        event.preventDefault();
        inputRef.current?.focus();
        return;
      }

      if (isModifierPressed && event.key === 'Enter') {
        event.preventDefault();
        handleSelectPath();
        return;
      }

      if (event.altKey && event.key === 'ArrowUp' && browsePath && browsePath !== '/') {
        event.preventDefault();
        handleGoUp();
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        router.back();
      }
    };

    window.addEventListener('keydown', handleWindowKeyDown);
    return () => window.removeEventListener('keydown', handleWindowKeyDown);
  }, [browsePath, handleGoUp, handleSelectPath, isDesktop, router]);

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
          automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
        >
          <View style={styles.contentWrapper}>
            {/* Recent paths — always on top */}
            {recentPaths.length > 0 && (
              <ItemGroup title={t('pathPicker.recentPaths')}>
                {recentPaths.map((path, index) => {
                  const isSelected = customPath.trim() === path;
                  const keyboardSelected =
                    keyboardTargets[highlightedIndex]?.type === 'recent' &&
                    keyboardTargets[highlightedIndex]?.path === path;
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
                      selected={isSelected || keyboardSelected}
                      showChevron={false}
                      pressableStyle={
                        isSelected || keyboardSelected
                          ? { backgroundColor: theme.colors.surfaceSelected }
                          : undefined
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
                {suggestedPaths.map((path, index) => {
                  const isSelected = customPath.trim() === path;
                  const keyboardSelected =
                    keyboardTargets[highlightedIndex]?.type === 'recent' &&
                    keyboardTargets[highlightedIndex]?.path === path;

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
                      selected={isSelected || keyboardSelected}
                      showChevron={false}
                      pressableStyle={
                        isSelected || keyboardSelected
                          ? { backgroundColor: theme.colors.surfaceSelected }
                          : undefined
                      }
                      showDivider={index < suggestedPaths.length - 1}
                    />
                  );
                })}
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
                    onKeyPress={event => {
                      if (event.key === 'ArrowDown') {
                        setHighlightedIndex(current =>
                          Math.min(current + 1, Math.max(0, keyboardTargets.length - 1))
                        );
                        return keyboardTargets.length > 0;
                      }
                      if (event.key === 'ArrowUp') {
                        setHighlightedIndex(current => Math.max(current - 1, 0));
                        return keyboardTargets.length > 0;
                      }
                      if (event.key === 'Enter' && !event.shiftKey) {
                        activateKeyboardTarget(keyboardTargets[highlightedIndex]);
                        return true;
                      }
                      return false;
                    }}
                    placeholder={t('pathPicker.enterPathPlaceholder')}
                    maxHeight={76}
                    paddingTop={8}
                    paddingBottom={8}
                  />
                </View>
              </View>
              {isDesktop ? (
                <Text style={styles.keyboardHint}>
                  Arrow Up/Down browse, Enter open, Cmd/Ctrl+Enter confirm, Cmd/Ctrl+L focus path,
                  Alt+↑ parent
                </Text>
              ) : null}
            </ItemGroup>

            {/* Directory browser */}
            <ItemGroup title={t('pathPicker.browse')}>
              {loading ? (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator size="small" color={theme.colors.textLink} />
                </View>
              ) : browseError ? (
                <Text style={styles.errorText}>{browseError}</Text>
              ) : browsePath === null ? (
                <Text style={styles.errorText}>{t('pathPicker.browseError')}</Text>
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
                      selected={keyboardTargets[highlightedIndex]?.type === 'parent'}
                      showChevron={false}
                      pressableStyle={
                        keyboardTargets[highlightedIndex]?.type === 'parent'
                          ? { backgroundColor: theme.colors.surfaceSelected }
                          : undefined
                      }
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
                      selected={
                        keyboardTargets[highlightedIndex]?.type === 'directory' &&
                        keyboardTargets[highlightedIndex]?.entry.name === entry.name
                      }
                      pressableStyle={
                        keyboardTargets[highlightedIndex]?.type === 'directory' &&
                        keyboardTargets[highlightedIndex]?.entry.name === entry.name
                          ? { backgroundColor: theme.colors.surfaceSelected }
                          : undefined
                      }
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
          </View>
        </ScrollView>
      </View>
    </>
  );
}
