import { Octicons } from '@expo/vector-icons';
import { cacheDirectory, writeAsStringAsync, EncodingType } from 'expo-file-system/legacy';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import * as React from 'react';
import {
  View,
  ActivityIndicator,
  Platform,
  TextInput,
  Pressable,
  RefreshControl,
  ActionSheetIOS,
  Alert,
} from 'react-native';
import { useUnistyles, StyleSheet } from 'react-native-unistyles';
import { FileIcon } from '@/components/FileIcon';
import { Item } from '@/components/Item';
import { ItemList } from '@/components/ItemList';
import { layout } from '@/components/layout';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { Modal } from '@/modal';
import {
  sessionListDirectory,
  sessionReadFile,
  sessionDeleteFile,
  type DirectoryEntry,
} from '@/sync/ops';
import { useSession } from '@/sync/storage';
import { invalidateSessionFileSearchCache, searchFiles, FileItem } from '@/sync/suggestionFile';
import { t } from '@/text';
import { encodeSessionFilePathForRoute } from '@/utils/sessionFilePath';
import { Logger, toError } from '@saaskit-dev/agentbridge/telemetry';
const logger = new Logger('app/session/files');

/** Simple string hash for generating unique cache filenames. */
function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return h;
}

/**
 * Joins an absolute directory path with a single entry name (POSIX-style).
 */
function joinPathSegment(baseDir: string, name: string): string {
  const b = baseDir.replace(/\/+$/, '');
  return `${b}/${name}`;
}

/**
 * Relative path from project root for the browse breadcrumb (e.g. "src/app").
 */
function relativePathFromRoot(rootPath: string, currentPath: string): string {
  const r = rootPath.replace(/\/+$/, '');
  const c = currentPath.replace(/\/+$/, '');
  if (c === r) return '.';
  if (c.startsWith(r + '/')) return c.slice(r.length + 1);
  return c;
}

function getBrowseEntryKind(
  entry: DirectoryEntry
): 'directory' | 'file' | 'broken-symlink' | 'special' {
  if (entry.type === 'directory') return 'directory';
  if (entry.type === 'symlink' && entry.symlinkTargetType === 'directory') return 'directory';
  if (entry.type === 'file') return 'file';
  if (entry.type === 'symlink' && entry.symlinkTargetType === 'file') return 'file';
  if (entry.type === 'symlink' && entry.isBrokenSymlink) return 'broken-symlink';
  return 'special';
}

function mapBrowseErrorMessage(errorCode?: string, fallback?: string): string {
  const code = (errorCode || '').toUpperCase();
  if (code === 'EACCES' || code === 'EPERM') return t('files.permissionDenied');
  return fallback || t('files.browseLoadFailed');
}

export default function FilesScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const rawId = params.id;
  const sessionId = (Array.isArray(rawId) ? rawId[0] : rawId) ?? '';
  const session = useSession(sessionId);
  const rootPath = session?.metadata?.path?.replace(/\/+$/, '') ?? '';

  const [searchQuery, setSearchQuery] = React.useState('');
  const [searchResults, setSearchResults] = React.useState<FileItem[]>([]);
  const [isSearching, setIsSearching] = React.useState(false);

  const [browsePath, setBrowsePath] = React.useState('');
  const [browseEntries, setBrowseEntries] = React.useState<DirectoryEntry[]>([]);
  const [browseLoading, setBrowseLoading] = React.useState(false);
  const [browseError, setBrowseError] = React.useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [isBusy, setIsBusy] = React.useState(false);
  const [refreshKey, setRefreshKey] = React.useState(0);
  const browseRequestIdRef = React.useRef(0);
  const searchRequestIdRef = React.useRef(0);

  const { theme } = useUnistyles();

  // Keep browse path inside session cwd when root metadata updates
  React.useEffect(() => {
    if (!rootPath) return;
    setBrowsePath(prev => {
      if (!prev) return rootPath;
      const p = prev.replace(/\/+$/, '');
      if (p === rootPath || p.startsWith(rootPath + '/')) return prev;
      return rootPath;
    });
  }, [rootPath]);

  const refreshFileState = React.useCallback(
    (options?: { clearSearchCache?: boolean }) => {
      if (!sessionId) return;
      if (options?.clearSearchCache) {
        invalidateSessionFileSearchCache(sessionId);
      }
      setRefreshKey(prev => prev + 1);
    },
    [sessionId]
  );

  const loadBrowseEntries = React.useCallback(async () => {
    if (!sessionId || !browsePath || !rootPath) return;
    const requestId = ++browseRequestIdRef.current;

    setBrowseLoading(true);
    setBrowseError(null);
    try {
      const res = await sessionListDirectory(sessionId, browsePath);
      if (browseRequestIdRef.current !== requestId) return;
      if (!res.success) {
        setBrowseError(mapBrowseErrorMessage(res.errorCode, res.error));
        setBrowseEntries([]);
        return;
      }
      const raw = res.entries || [];
      const sorted = [...raw].sort((a, b) => {
        const rank = (entryType: DirectoryEntry['type']) => (entryType === 'directory' ? 0 : 1);
        const dr = rank(a.type) - rank(b.type);
        if (dr !== 0) return dr;
        return a.name.localeCompare(b.name);
      });
      setBrowseEntries(sorted);
    } catch (error) {
      if (browseRequestIdRef.current === requestId) {
        logger.error('browse listDirectory failed', toError(error));
        setBrowseError(t('files.browseLoadFailed'));
        setBrowseEntries([]);
      }
    } finally {
      if (browseRequestIdRef.current === requestId) {
        setBrowseLoading(false);
      }
    }
  }, [browsePath, rootPath, sessionId]);

  const loadSearchResults = React.useCallback(async () => {
    if (!sessionId || !searchQuery.trim()) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }
    const requestId = ++searchRequestIdRef.current;

    try {
      setIsSearching(true);
      const results = await searchFiles(sessionId, searchQuery, { limit: 100 });
      if (searchRequestIdRef.current !== requestId) return;
      setSearchResults(results);
    } catch (error) {
      if (searchRequestIdRef.current === requestId) {
        logger.error('Failed to search files:', toError(error));
        setSearchResults([]);
      }
    } finally {
      if (searchRequestIdRef.current === requestId) {
        setIsSearching(false);
      }
    }
  }, [searchQuery, sessionId]);

  // Load directory listing from daemon (same sandbox as agent working directory)
  React.useEffect(() => {
    void loadBrowseEntries();
  }, [loadBrowseEntries, refreshKey]);

  // Handle search results from the full filesystem, including gitignored files.
  React.useEffect(() => {
    if (searchQuery.trim()) {
      const delay = 300;
      const timer = setTimeout(() => {
        void loadSearchResults();
      }, delay);
      return () => clearTimeout(timer);
    } else {
      searchRequestIdRef.current += 1;
      setSearchResults([]);
      setIsSearching(false);
    }
  }, [loadSearchResults, refreshKey, searchQuery]);

  const hasMountedRef = React.useRef(false);
  useFocusEffect(
    React.useCallback(() => {
      if (!hasMountedRef.current) {
        hasMountedRef.current = true;
        refreshFileState({ clearSearchCache: true });
      }
    }, [refreshFileState])
  );

  const handleRefresh = React.useCallback(async () => {
    if (sessionId) {
      invalidateSessionFileSearchCache(sessionId);
    }
    setIsRefreshing(true);
    try {
      await Promise.all([loadBrowseEntries(), loadSearchResults()]);
    } finally {
      setIsRefreshing(false);
    }
  }, [loadBrowseEntries, loadSearchResults, sessionId]);

  /**
   * Opens the session file preview screen for an absolute path on the daemon machine.
   */
  const openFilePreview = React.useCallback(
    (absolutePath: string) => {
      const encodedPath = encodeURIComponent(encodeSessionFilePathForRoute(absolutePath));
      router.push(`/session/${sessionId}/file?path=${encodedPath}`);
    },
    [router, sessionId]
  );

  /**
   * Download a single file from the daemon machine to the device via share sheet.
   */
  const downloadFile = React.useCallback(
    async (absolutePath: string, fileName: string) => {
      if (isBusy) return;
      setIsBusy(true);
      try {
        const MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024;
        const sizeCheck = await sessionReadFile(sessionId, absolutePath, 1);
        if (typeof sizeCheck.size === 'number' && sizeCheck.size > MAX_DOWNLOAD_BYTES) {
          Modal.alert(t('common.error'), t('files.fileTooLargeToDownload'));
          return;
        }
        const response = await sessionReadFile(sessionId, absolutePath);
        if (!response.success || typeof response.content !== 'string') {
          Modal.alert(t('common.error'), t('files.downloadError'));
          return;
        }
        // Use a hash prefix to avoid collision between same-named files in different dirs
        const pathHash = Math.abs(hashCode(absolutePath)).toString(36);
        const localUri = cacheDirectory + `${pathHash}-${fileName}`;
        await writeAsStringAsync(localUri, response.content, {
          encoding: EncodingType.Base64,
        });
        const canShare = await Sharing.isAvailableAsync();
        if (canShare) {
          await Sharing.shareAsync(localUri, { dialogTitle: fileName });
        } else {
          Modal.alert(t('common.error'), t('files.downloadError'));
        }
      } catch (error) {
        logger.error('downloadFile failed', toError(error));
        Modal.alert(t('common.error'), t('files.downloadError'));
      } finally {
        setIsBusy(false);
      }
    },
    [sessionId, isBusy]
  );

  /**
   * Show the long-press action menu for a file or directory entry.
   * Directories only support delete; download is file-only.
   */
  const showEntryActions = React.useCallback(
    (absolutePath: string, name: string, kind: 'file' | 'directory') => {
      if (isBusy) return;
      const isDir = kind === 'directory';

      const handleDelete = async () => {
        const confirmMsg = isDir
          ? t('files.deleteFolderConfirm', { name })
          : t('files.deleteFileConfirm', { name });
        const confirmed = await Modal.confirm(t('common.delete'), confirmMsg, {
          destructive: true,
        });
        if (!confirmed) return;
        setIsBusy(true);
        try {
          const result = await sessionDeleteFile(sessionId, absolutePath, isDir);
          if (result.success) {
            refreshFileState({ clearSearchCache: true });
          } else {
            Modal.alert(t('common.error'), result.error ?? t('files.deleteError'));
          }
        } finally {
          setIsBusy(false);
        }
      };

      if (Platform.OS === 'ios') {
        if (isDir) {
          ActionSheetIOS.showActionSheetWithOptions(
            {
              title: name,
              options: [t('files.delete'), t('common.cancel')],
              destructiveButtonIndex: 0,
              cancelButtonIndex: 1,
            },
            async buttonIndex => {
              if (buttonIndex === 0) await handleDelete();
            }
          );
        } else {
          ActionSheetIOS.showActionSheetWithOptions(
            {
              title: name,
              options: [t('files.download'), t('files.delete'), t('common.cancel')],
              destructiveButtonIndex: 1,
              cancelButtonIndex: 2,
            },
            async buttonIndex => {
              if (buttonIndex === 0) {
                await downloadFile(absolutePath, name);
              } else if (buttonIndex === 1) {
                await handleDelete();
              }
            }
          );
        }
      } else {
        // Android / Web: use Alert for action menu, then Modal.confirm for delete
        const buttons = [
          ...(!isDir
            ? [
                {
                  text: t('files.download'),
                  onPress: () => {
                    downloadFile(absolutePath, name).catch(() => {});
                  },
                },
              ]
            : []),
          {
            text: t('files.delete'),
            style: 'destructive' as const,
            onPress: () => {
              handleDelete().catch(() => {});
            },
          },
          { text: t('common.cancel'), style: 'cancel' as const },
        ];
        Alert.alert(name, undefined, buttons);
      }
    },
    [downloadFile, isBusy, refreshFileState, sessionId]
  );

  const renderFileIconForSearch = (file: FileItem) => {
    if (file.fileType === 'folder') {
      return <Octicons name="file-directory" size={29} color="#007AFF" />;
    }

    return <FileIcon fileName={file.fileName} size={29} />;
  };

  const renderBrowseEntryIcon = React.useCallback(
    (entry: DirectoryEntry) => {
      const kind = getBrowseEntryKind(entry);
      if (entry.type === 'symlink') {
        if (kind === 'directory') {
          return <Octicons name="file-directory" size={29} color="#007AFF" />;
        }
        if (kind === 'file') {
          return <Octicons name="file" size={29} color={theme.colors.textSecondary} />;
        }
        if (kind === 'broken-symlink') {
          return <Octicons name="alert" size={29} color={theme.colors.warning} />;
        }
      }
      if (kind === 'directory') {
        return <Octicons name="file-directory" size={29} color="#007AFF" />;
      }
      if (kind === 'special') {
        return <Octicons name="file" size={29} color={theme.colors.textSecondary} />;
      }
      return <FileIcon fileName={entry.name} size={29} />;
    },
    [theme.colors.textSecondary, theme.colors.warning]
  );

  const getBrowseEntrySubtitle = React.useCallback(
    (entry: DirectoryEntry, fullPath: string) => {
      const rel = relativePathFromRoot(rootPath, fullPath);
      if (entry.type !== 'symlink') return rel;
      if (entry.isBrokenSymlink) {
        return `${rel} • ${t('files.brokenSymlink')}`;
      }
      if (entry.symlinkTargetType === 'directory' || entry.symlinkTargetType === 'file') {
        return `${rel} • ${t('files.symlinkTo', { target: entry.symlinkTarget || '' })}`;
      }
      return `${rel} • ${t('files.specialFile')}`;
    },
    [rootPath]
  );

  const resolveSearchResultPath = React.useCallback(
    (path: string) => {
      const normalized = path.replace(/\/+$/, '');
      if (!normalized) return rootPath;
      if (normalized.startsWith('/')) return normalized;
      return joinPathSegment(rootPath, normalized);
    },
    [rootPath]
  );

  if (!sessionId) {
    return (
      <View
        style={[
          styles.container,
          {
            flex: 1,
            backgroundColor: theme.colors.surface,
            justifyContent: 'center',
            padding: 24,
          },
        ]}
      >
        <Text
          style={{
            ...Typography.default(),
            color: theme.colors.textSecondary,
            textAlign: 'center',
          }}
        >
          {t('errors.sessionDeleted')}
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.surface }]}>
      {isBusy && (
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 10,
            backgroundColor: 'rgba(0,0,0,0.15)',
            justifyContent: 'center',
            alignItems: 'center',
          }}
          pointerEvents="auto"
        >
          <ActivityIndicator size="large" color={theme.colors.textLink} />
        </View>
      )}
      {/* Search Input - Always Visible */}
      <View
        style={{
          padding: 16,
          borderBottomWidth: Platform.select({ ios: 0.33, default: 1 }),
          borderBottomColor: theme.colors.divider,
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: theme.colors.input.background,
            borderRadius: 10,
            paddingHorizontal: 12,
            paddingVertical: 8,
          }}
        >
          <Octicons
            name="search"
            size={16}
            color={theme.colors.textSecondary}
            style={{ marginRight: 8 }}
          />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder={t('files.searchPlaceholder')}
            style={{
              flex: 1,
              fontSize: 16,
              ...Typography.default(),
            }}
            placeholderTextColor={theme.colors.input.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
      </View>

      {/* Full filesystem browser + search */}
      <ItemList
        style={{ flex: 1 }}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />}
      >
        {searchQuery.trim() ? (
          <>
            <View
              style={{
                backgroundColor: theme.colors.surfaceHigh,
                paddingHorizontal: 16,
                paddingVertical: 12,
                borderBottomWidth: Platform.select({ ios: 0.33, default: 1 }),
                borderBottomColor: theme.colors.divider,
              }}
            >
              <Text
                style={{
                  fontSize: 14,
                  fontWeight: '600',
                  color: theme.colors.text,
                  ...Typography.default(),
                }}
              >
                {t('files.searchResults', { count: searchResults.length })}
              </Text>
            </View>
            {isSearching ? (
              <View style={{ paddingVertical: 24, alignItems: 'center' }}>
                <ActivityIndicator size="small" color={theme.colors.textSecondary} />
              </View>
            ) : searchResults.length === 0 ? (
              <View
                style={{
                  justifyContent: 'center',
                  alignItems: 'center',
                  paddingTop: 40,
                  paddingHorizontal: 20,
                }}
              >
                <Octicons
                  name={searchQuery ? 'search' : 'file-directory'}
                  size={48}
                  color={theme.colors.textSecondary}
                />
                <Text
                  style={{
                    fontSize: 16,
                    color: theme.colors.textSecondary,
                    textAlign: 'center',
                    marginTop: 16,
                    ...Typography.default(),
                  }}
                >
                  {searchQuery ? t('files.noFilesFound') : t('files.noFilesInProject')}
                </Text>
                <Text
                  style={{
                    fontSize: 14,
                    color: theme.colors.textSecondary,
                    textAlign: 'center',
                    marginTop: 8,
                    ...Typography.default(),
                  }}
                >
                  {t('files.tryDifferentTerm')}
                </Text>
              </View>
            ) : (
              searchResults.map((file, index) => (
                <Item
                  key={`file-${file.fullPath}-${index}`}
                  title={file.fileName}
                  subtitle={file.filePath || t('files.projectRoot')}
                  icon={renderFileIconForSearch(file)}
                  onPress={() => {
                    const absolutePath = resolveSearchResultPath(file.fullPath);
                    if (!absolutePath) return;
                    if (file.fileType === 'folder') {
                      setBrowsePath(absolutePath);
                      setSearchQuery('');
                      return;
                    }
                    openFilePreview(absolutePath);
                  }}
                  onLongPress={() => {
                    const absolutePath = resolveSearchResultPath(file.fullPath);
                    if (!absolutePath) return;
                    showEntryActions(
                      absolutePath,
                      file.fileName,
                      file.fileType === 'folder' ? 'directory' : 'file'
                    );
                  }}
                  showDivider={index < searchResults.length - 1}
                />
              ))
            )}
          </>
        ) : (
          <>
            {/* Drill-down directory tree (daemon working directory); tap file → file preview */}
            {rootPath ? (
              <>
                <View
                  style={{
                    backgroundColor: theme.colors.surfaceHigh,
                    paddingHorizontal: 16,
                    paddingVertical: 12,
                    borderBottomWidth: Platform.select({ ios: 0.33, default: 1 }),
                    borderBottomColor: theme.colors.divider,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 14,
                      fontWeight: '600',
                      color: theme.colors.text,
                      marginBottom: 6,
                      ...Typography.default(),
                    }}
                  >
                    {t('files.browseTitle')}
                  </Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' }}>
                    {(() => {
                      const rel = relativePathFromRoot(rootPath, browsePath || rootPath);
                      const segments = rel === '.' ? [] : rel.split('/');
                      const allSegments = [
                        { label: 'root', path: rootPath },
                        ...segments.map((seg, i) => ({
                          label: seg,
                          path: rootPath + '/' + segments.slice(0, i + 1).join('/'),
                        })),
                      ];
                      return allSegments.map((seg, i) => {
                        const isLast = i === allSegments.length - 1;
                        return (
                          <View
                            key={seg.path}
                            style={{ flexDirection: 'row', alignItems: 'center' }}
                          >
                            {i > 0 && (
                              <Text
                                style={{
                                  fontSize: 12,
                                  color: theme.colors.textSecondary,
                                  marginHorizontal: 4,
                                  ...Typography.mono(),
                                }}
                              >
                                /
                              </Text>
                            )}
                            {isLast ? (
                              <Text
                                style={{
                                  fontSize: 12,
                                  color: theme.colors.text,
                                  ...Typography.mono(),
                                }}
                              >
                                {seg.label}
                              </Text>
                            ) : (
                              <Pressable onPress={() => setBrowsePath(seg.path)} hitSlop={4}>
                                <Text
                                  style={{
                                    fontSize: 12,
                                    color: theme.colors.textLink,
                                    ...Typography.mono(),
                                  }}
                                >
                                  {seg.label}
                                </Text>
                              </Pressable>
                            )}
                          </View>
                        );
                      });
                    })()}
                  </View>
                </View>
                {browseLoading ? (
                  <View style={{ paddingVertical: 24, alignItems: 'center' }}>
                    <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                  </View>
                ) : browseError ? (
                  <View style={{ paddingHorizontal: 16, paddingVertical: 16 }}>
                    <Text
                      style={{
                        fontSize: 14,
                        color: theme.colors.textDestructive,
                        ...Typography.default(),
                      }}
                    >
                      {browseError}
                    </Text>
                  </View>
                ) : browseEntries.length === 0 ? (
                  <View style={{ paddingHorizontal: 16, paddingVertical: 16 }}>
                    <Text
                      style={{
                        fontSize: 14,
                        color: theme.colors.textSecondary,
                        ...Typography.default(),
                      }}
                    >
                      {t('files.browseEmpty')}
                    </Text>
                  </View>
                ) : (
                  browseEntries.map((entry, index) => {
                    const fullPath = joinPathSegment(browsePath || rootPath, entry.name);
                    const entryKind = getBrowseEntryKind(entry);
                    return (
                      <Item
                        key={`browse-${fullPath}-${entry.type}`}
                        title={entry.name}
                        subtitle={getBrowseEntrySubtitle(entry, fullPath)}
                        icon={renderBrowseEntryIcon(entry)}
                        onPress={() => {
                          if (entryKind === 'directory') {
                            setBrowsePath(fullPath);
                          } else if (entryKind === 'file') {
                            openFilePreview(fullPath);
                          } else if (entryKind === 'broken-symlink') {
                            Modal.alert(t('common.error'), t('files.brokenSymlink'));
                          } else {
                            Modal.alert(t('common.error'), t('files.specialFile'));
                          }
                        }}
                        onLongPress={() => {
                          if (entryKind === 'file' || entryKind === 'directory') {
                            showEntryActions(fullPath, entry.name, entryKind);
                          }
                        }}
                        showDivider={index < browseEntries.length - 1}
                      />
                    );
                  })
                )}
              </>
            ) : (
              <View style={{ paddingHorizontal: 16, paddingVertical: 16 }}>
                <Text
                  style={{
                    fontSize: 14,
                    color: theme.colors.textSecondary,
                    ...Typography.default(),
                  }}
                >
                  {t('files.browseNoPath')}
                </Text>
              </View>
            )}
          </>
        )}
      </ItemList>
    </View>
  );
}

const styles = StyleSheet.create(theme => ({
  container: {
    flex: 1,
    maxWidth: layout.maxWidth,
    alignSelf: 'center',
    width: '100%',
  },
}));
