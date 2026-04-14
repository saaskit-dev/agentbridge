import { Octicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import * as React from 'react';
import {
  View,
  ActivityIndicator,
  Platform,
  TextInput,
  Pressable,
  RefreshControl,
} from 'react-native';
import { useUnistyles, StyleSheet } from 'react-native-unistyles';
import { FileIcon } from '@/components/FileIcon';
import { Item } from '@/components/Item';
import { ItemList } from '@/components/ItemList';
import { layout } from '@/components/layout';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { Modal } from '@/modal';
import { getGitStatusFiles, type GitFileStatus, type GitStatusFiles } from '@/sync/gitStatusFiles';
import {
  sessionListDirectory,
  sessionReadFile,
  sessionDeleteFile,
  type DirectoryEntry,
} from '@/sync/ops';
import { useSession } from '@/sync/storage';
import { invalidateSessionFileSearchCache, searchFiles, type FileItem } from '@/sync/suggestionFile';
import { t } from '@/text';
import { downloadBase64File } from '@/utils/fileDownload';
import { getImageMimeType } from '@/utils/filePreview';
import { encodeSessionFilePathForRoute } from '@/utils/sessionFilePath';
import { Logger, toError } from '@saaskit-dev/agentbridge/telemetry';

const logger = new Logger('app/session/files');

type FilesViewMode = 'diff' | 'files';

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
  const { theme } = useUnistyles();

  const [viewMode, setViewMode] = React.useState<FilesViewMode>('diff');
  const [gitStatusFiles, setGitStatusFiles] = React.useState<GitStatusFiles | null>(null);
  const [isGitStatusLoading, setIsGitStatusLoading] = React.useState(false);
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
  const gitStatusRequestIdRef = React.useRef(0);

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

  const resolveProjectPath = React.useCallback(
    (path: string) => {
      const normalized = path.replace(/\/+$/, '');
      if (!normalized) return rootPath;
      if (normalized.startsWith('/')) return normalized;
      return joinPathSegment(rootPath, normalized);
    },
    [rootPath]
  );

  const openFilePreview = React.useCallback(
    (absolutePath: string) => {
      const encodedPath = encodeURIComponent(encodeSessionFilePathForRoute(absolutePath));
      router.push(`/session/${sessionId}/file?path=${encodedPath}`);
    },
    [router, sessionId]
  );

  const loadGitStatus = React.useCallback(async () => {
    if (!sessionId) {
      setGitStatusFiles(null);
      setIsGitStatusLoading(false);
      return;
    }

    const requestId = ++gitStatusRequestIdRef.current;
    setIsGitStatusLoading(true);
    try {
      const result = await getGitStatusFiles(sessionId);
      if (gitStatusRequestIdRef.current !== requestId) return;
      setGitStatusFiles(result);
      if (
        result &&
        (result.totalStaged > 0 || result.totalUnstaged > 0) &&
        searchQuery.trim().length === 0
      ) {
        setViewMode('diff');
      }
    } catch (error) {
      if (gitStatusRequestIdRef.current === requestId) {
        logger.error('Failed to load git status files', toError(error));
        setGitStatusFiles(null);
      }
    } finally {
      if (gitStatusRequestIdRef.current === requestId) {
        setIsGitStatusLoading(false);
      }
    }
  }, [searchQuery, sessionId]);

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
        logger.error('Failed to search files', toError(error));
        setSearchResults([]);
      }
    } finally {
      if (searchRequestIdRef.current === requestId) {
        setIsSearching(false);
      }
    }
  }, [searchQuery, sessionId]);

  React.useEffect(() => {
    void loadBrowseEntries();
  }, [loadBrowseEntries, refreshKey]);

  React.useEffect(() => {
    void loadGitStatus();
  }, [loadGitStatus, refreshKey]);

  React.useEffect(() => {
    if (searchQuery.trim()) {
      setViewMode('files');
      const delay = 300;
      const timer = setTimeout(() => {
        void loadSearchResults();
      }, delay);
      return () => clearTimeout(timer);
    }

    searchRequestIdRef.current += 1;
    setSearchResults([]);
    setIsSearching(false);
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
      await Promise.all([loadGitStatus(), loadBrowseEntries(), loadSearchResults()]);
    } finally {
      setIsRefreshing(false);
    }
  }, [loadBrowseEntries, loadGitStatus, loadSearchResults, sessionId]);

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
        const mimeType = getImageMimeType(fileName) ?? 'application/octet-stream';
        await downloadBase64File(fileName, response.content, mimeType);
      } catch (error) {
        logger.error('downloadFile failed', toError(error));
        Modal.alert(t('common.error'), t('files.downloadError'));
      } finally {
        setIsBusy(false);
      }
    },
    [isBusy, sessionId]
  );

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

      const buttons = [
        ...(!isDir
          ? [
              {
                text: t('files.download'),
                onPress: () => {
                  void downloadFile(absolutePath, name);
                },
              },
            ]
          : []),
        {
          text: t('files.delete'),
          style: 'destructive' as const,
          onPress: () => {
            void handleDelete();
          },
        },
        { text: t('common.cancel'), style: 'cancel' as const },
      ];
      Modal.alert(name, undefined, buttons);
    },
    [downloadFile, isBusy, refreshFileState, sessionId]
  );

  const renderFileIconForSearch = React.useCallback((file: FileItem) => {
    if (file.fileType === 'folder') {
      return <Octicons name="file-directory" size={29} color="#007AFF" />;
    }

    return <FileIcon fileName={file.fileName} size={29} />;
  }, []);

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

  const renderStatusIcon = React.useCallback(
    (file: GitFileStatus) => {
      let statusColor: string;
      let statusIcon: string;

      switch (file.status) {
        case 'modified':
          statusColor = '#FF9500';
          statusIcon = 'diff-modified';
          break;
        case 'added':
          statusColor = '#34C759';
          statusIcon = 'diff-added';
          break;
        case 'deleted':
          statusColor = theme.colors.textDestructive;
          statusIcon = 'diff-removed';
          break;
        case 'renamed':
          statusColor = '#007AFF';
          statusIcon = 'arrow-right';
          break;
        case 'untracked':
          statusColor = theme.colors.textSecondary;
          statusIcon = 'file';
          break;
        default:
          return null;
      }

      return <Octicons name={statusIcon as any} size={16} color={statusColor} />;
    },
    [theme.colors.textDestructive, theme.colors.textSecondary]
  );

  const renderLineChanges = React.useCallback((file: GitFileStatus) => {
    const parts: string[] = [];
    if (file.linesAdded > 0) {
      parts.push(`+${file.linesAdded}`);
    }
    if (file.linesRemoved > 0) {
      parts.push(`-${file.linesRemoved}`);
    }
    return parts.length > 0 ? parts.join(' ') : '';
  }, []);

  const renderGitFileSubtitle = React.useCallback(
    (file: GitFileStatus) => {
      const lineChanges = renderLineChanges(file);
      const pathPart = file.filePath || t('files.projectRoot');
      return lineChanges ? `${pathPart} • ${lineChanges}` : pathPart;
    },
    [renderLineChanges]
  );

  const handleGitFilePress = React.useCallback(
    (file: GitFileStatus) => {
      const absolutePath = resolveProjectPath(file.fullPath);
      if (!absolutePath) return;
      openFilePreview(absolutePath);
    },
    [openFilePreview, resolveProjectPath]
  );

  const hasGitChanges = (gitStatusFiles?.totalStaged || 0) > 0 || (gitStatusFiles?.totalUnstaged || 0) > 0;

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
      {isBusy ? (
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
      ) : null}

      <View
        style={{
          padding: 16,
          gap: 12,
          borderBottomWidth: Platform.select({ ios: 0.33, default: 1 }),
          borderBottomColor: theme.colors.divider,
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            backgroundColor: theme.colors.surfaceHigh,
            borderRadius: 12,
            padding: 4,
          }}
        >
          <Pressable
            onPress={() => setViewMode('diff')}
            style={{
              flex: 1,
              borderRadius: 10,
              paddingVertical: 10,
              paddingHorizontal: 12,
              backgroundColor: viewMode === 'diff' ? theme.colors.textLink : 'transparent',
            }}
          >
            <Text
              style={{
                fontSize: 14,
                textAlign: 'center',
                color: viewMode === 'diff' ? '#fff' : theme.colors.textSecondary,
                ...Typography.default('semiBold'),
              }}
            >
              {t('files.diff')}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setViewMode('files')}
            style={{
              flex: 1,
              borderRadius: 10,
              paddingVertical: 10,
              paddingHorizontal: 12,
              backgroundColor: viewMode === 'files' ? theme.colors.textLink : 'transparent',
            }}
          >
            <Text
              style={{
                fontSize: 14,
                textAlign: 'center',
                color: viewMode === 'files' ? '#fff' : theme.colors.textSecondary,
                ...Typography.default('semiBold'),
              }}
            >
              {t('files.file')}
            </Text>
          </Pressable>
        </View>

        {viewMode === 'files' ? (
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
        ) : null}
      </View>

      <ItemList
        style={{ flex: 1 }}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />}
      >
        {viewMode === 'diff' ? (
          <>
            {isGitStatusLoading ? (
              <View style={{ paddingTop: 40, alignItems: 'center' }}>
                <ActivityIndicator size="small" color={theme.colors.textSecondary} />
              </View>
            ) : !gitStatusFiles ? (
              <View
                style={{
                  alignItems: 'center',
                  paddingTop: 40,
                  paddingHorizontal: 20,
                }}
              >
                <Octicons name="git-branch" size={48} color={theme.colors.textSecondary} />
                <Text
                  style={{
                    fontSize: 16,
                    color: theme.colors.textSecondary,
                    textAlign: 'center',
                    marginTop: 16,
                    ...Typography.default(),
                  }}
                >
                  {t('files.notRepo')}
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
                  {t('files.notUnderGit')}
                </Text>
              </View>
            ) : (
              <>
                <View
                  style={{
                    backgroundColor: theme.colors.surfaceHigh,
                    paddingHorizontal: 16,
                    paddingVertical: 14,
                    borderBottomWidth: Platform.select({ ios: 0.33, default: 1 }),
                    borderBottomColor: theme.colors.divider,
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                    <Octicons
                      name="git-branch"
                      size={16}
                      color={theme.colors.textSecondary}
                      style={{ marginRight: 6 }}
                    />
                    <Text
                      style={{
                        fontSize: 16,
                        color: theme.colors.text,
                        ...Typography.default('semiBold'),
                      }}
                    >
                      {gitStatusFiles.branch || t('files.detachedHead')}
                    </Text>
                  </View>
                  <Text
                    style={{
                      fontSize: 12,
                      color: theme.colors.textSecondary,
                      ...Typography.default(),
                    }}
                  >
                    {t('files.summary', {
                      staged: gitStatusFiles.totalStaged,
                      unstaged: gitStatusFiles.totalUnstaged,
                    })}
                  </Text>
                </View>

                {!hasGitChanges ? (
                  <View
                    style={{
                      alignItems: 'center',
                      paddingTop: 40,
                      paddingHorizontal: 20,
                    }}
                  >
                    <Octicons name="check-circle" size={48} color={theme.colors.success} />
                    <Text
                      style={{
                        fontSize: 16,
                        color: theme.colors.text,
                        textAlign: 'center',
                        marginTop: 16,
                        ...Typography.default('semiBold'),
                      }}
                    >
                      {t('files.noChanges')}
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
                      {t('files.browseTitle')}
                    </Text>
                  </View>
                ) : null}

                {gitStatusFiles.stagedFiles.length > 0 ? (
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
                          color: theme.colors.success,
                          ...Typography.default('semiBold'),
                        }}
                      >
                        {t('files.stagedChanges', { count: gitStatusFiles.stagedFiles.length })}
                      </Text>
                    </View>
                    {gitStatusFiles.stagedFiles.map((file, index) => (
                      <Item
                        key={`staged-${file.fullPath}-${index}`}
                        title={file.fileName}
                        subtitle={renderGitFileSubtitle(file)}
                        icon={<FileIcon fileName={file.fileName} size={29} />}
                        rightElement={renderStatusIcon(file)}
                        onPress={() => handleGitFilePress(file)}
                        showDivider={
                          index < gitStatusFiles.stagedFiles.length - 1 ||
                          gitStatusFiles.unstagedFiles.length > 0
                        }
                      />
                    ))}
                  </>
                ) : null}

                {gitStatusFiles.unstagedFiles.length > 0 ? (
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
                          color: theme.colors.warning,
                          ...Typography.default('semiBold'),
                        }}
                      >
                        {t('files.unstagedChanges', { count: gitStatusFiles.unstagedFiles.length })}
                      </Text>
                    </View>
                    {gitStatusFiles.unstagedFiles.map((file, index) => (
                      <Item
                        key={`unstaged-${file.fullPath}-${index}`}
                        title={file.fileName}
                        subtitle={renderGitFileSubtitle(file)}
                        icon={<FileIcon fileName={file.fileName} size={29} />}
                        rightElement={renderStatusIcon(file)}
                        onPress={() => handleGitFilePress(file)}
                        showDivider={index < gitStatusFiles.unstagedFiles.length - 1}
                      />
                    ))}
                  </>
                ) : null}
              </>
            )}
          </>
        ) : (
          <>
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
                    <Octicons name="search" size={48} color={theme.colors.textSecondary} />
                    <Text
                      style={{
                        fontSize: 16,
                        color: theme.colors.textSecondary,
                        textAlign: 'center',
                        marginTop: 16,
                        ...Typography.default(),
                      }}
                    >
                      {t('files.noFilesFound')}
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
                        const absolutePath = resolveProjectPath(file.fullPath);
                        if (!absolutePath) return;
                        if (file.fileType === 'folder') {
                          setBrowsePath(absolutePath);
                          setSearchQuery('');
                          return;
                        }
                        openFilePreview(absolutePath);
                      }}
                      onLongPress={() => {
                        const absolutePath = resolveProjectPath(file.fullPath);
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
            ) : rootPath ? (
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
                            {i > 0 ? (
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
                            ) : null}
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    maxWidth: layout.maxWidth,
    alignSelf: 'center',
    width: '100%',
  },
});
