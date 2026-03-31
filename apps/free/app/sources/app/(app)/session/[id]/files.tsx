import { Octicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import * as React from 'react';
import { View, ActivityIndicator, Platform, TextInput, Pressable } from 'react-native';
import { useUnistyles, StyleSheet } from 'react-native-unistyles';
import { FileIcon } from '@/components/FileIcon';
import { Item } from '@/components/Item';
import { ItemList } from '@/components/ItemList';
import { layout } from '@/components/layout';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { getGitStatusFiles, GitFileStatus, GitStatusFiles } from '@/sync/gitStatusFiles';
import { sessionListDirectory, type DirectoryEntry } from '@/sync/ops';
import { useSession } from '@/sync/storage';
import { searchFiles, FileItem } from '@/sync/suggestionFile';
import { t } from '@/text';
import { encodeSessionFilePathForRoute, parentPathWithinRoot } from '@/utils/sessionFilePath';
import { Logger, toError } from '@saaskit-dev/agentbridge/telemetry';
const logger = new Logger('app/session/files');

/** Directory names filtered out of the browse listing to reduce noise. */
const NOISY_DIR_NAMES = new Set(['node_modules', '__pycache__', 'dist', 'build']);

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

export default function FilesScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const rawId = params.id;
  const sessionId = (Array.isArray(rawId) ? rawId[0] : rawId) ?? '';
  const session = useSession(sessionId);
  const rootPath = session?.metadata?.path?.replace(/\/+$/, '') ?? '';

  const [gitStatusFiles, setGitStatusFiles] = React.useState<GitStatusFiles | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [searchQuery, setSearchQuery] = React.useState('');
  const [searchResults, setSearchResults] = React.useState<FileItem[]>([]);
  const [isSearching, setIsSearching] = React.useState(false);

  const [browsePath, setBrowsePath] = React.useState('');
  const [browseEntries, setBrowseEntries] = React.useState<DirectoryEntry[]>([]);
  const [browseLoading, setBrowseLoading] = React.useState(false);
  const [browseError, setBrowseError] = React.useState<string | null>(null);

  // Use project git status first, fallback to session git status for backward compatibility
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

  // Load directory listing from daemon (same sandbox as agent working directory)
  React.useEffect(() => {
    if (!sessionId || !browsePath || !rootPath) return;
    let cancelled = false;

    const load = async () => {
      setBrowseLoading(true);
      setBrowseError(null);
      try {
        const res = await sessionListDirectory(sessionId, browsePath);
        if (cancelled) return;
        if (!res.success) {
          setBrowseError(res.error || t('files.browseLoadFailed'));
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
        const filtered = sorted.filter(entry => {
          if (entry.type !== 'directory') return true;
          if (entry.name.startsWith('.')) return false;
          if (NOISY_DIR_NAMES.has(entry.name)) return false;
          return true;
        });
        setBrowseEntries(filtered);
      } catch (error) {
        if (!cancelled) {
          logger.error('browse listDirectory failed', toError(error));
          setBrowseError(t('files.browseLoadFailed'));
          setBrowseEntries([]);
        }
      } finally {
        if (!cancelled) setBrowseLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [sessionId, browsePath, rootPath]);

  // Load git status files
  const loadGitStatusFiles = React.useCallback(async () => {
    if (!sessionId) {
      setGitStatusFiles(null);
      setIsLoading(false);
      return;
    }
    try {
      setIsLoading(true);
      const result = await getGitStatusFiles(sessionId);
      setGitStatusFiles(result);
    } catch (error) {
      logger.error('Failed to load git status files:', toError(error));
      setGitStatusFiles(null);
    } finally {
      setIsLoading(false);
    }
  }, [sessionId]);

  // Initial load + refresh when returning to this screen
  useFocusEffect(
    React.useCallback(() => {
      loadGitStatusFiles();
    }, [loadGitStatusFiles])
  );

  // Handle search and file loading
  React.useEffect(() => {
    const loadFiles = async () => {
      if (!sessionId) return;

      try {
        setIsSearching(true);
        const results = await searchFiles(sessionId, searchQuery, { limit: 100 });
        setSearchResults(results);
      } catch (error) {
        logger.error('Failed to search files:', toError(error));
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    };

    const shouldShowAllFiles =
      searchQuery || (gitStatusFiles?.totalStaged === 0 && gitStatusFiles?.totalUnstaged === 0);

    if (shouldShowAllFiles && !isLoading) {
      const delay = searchQuery ? 300 : 0;
      const timer = setTimeout(() => { loadFiles(); }, delay);
      return () => clearTimeout(timer);
    } else if (!searchQuery) {
      setSearchResults([]);
      setIsSearching(false);
    }
  }, [searchQuery, gitStatusFiles, sessionId, isLoading]);

  const handleFilePress = React.useCallback(
    (file: GitFileStatus | FileItem) => {
      const encodedPath = encodeURIComponent(encodeSessionFilePathForRoute(file.fullPath));
      router.push(`/session/${sessionId}/file?path=${encodedPath}`);
    },
    [router, sessionId]
  );

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

  const renderFileIcon = (file: GitFileStatus) => {
    return <FileIcon fileName={file.fileName} size={32} />;
  };

  const renderStatusIcon = (file: GitFileStatus) => {
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
        statusColor = '#FF3B30';
        statusIcon = 'diff-removed';
        break;
      case 'renamed':
        statusColor = '#007AFF';
        statusIcon = 'arrow-right';
        break;
      case 'untracked':
        statusColor = theme.dark ? '#b0b0b0' : '#8E8E93';
        statusIcon = 'file';
        break;
      default:
        return null;
    }

    return <Octicons name={statusIcon as any} size={16} color={statusColor} />;
  };

  const renderLineChanges = (file: GitFileStatus) => {
    const parts = [];
    if (file.linesAdded > 0) {
      parts.push(`+${file.linesAdded}`);
    }
    if (file.linesRemoved > 0) {
      parts.push(`-${file.linesRemoved}`);
    }
    return parts.length > 0 ? parts.join(' ') : '';
  };

  const renderFileSubtitle = (file: GitFileStatus) => {
    const lineChanges = renderLineChanges(file);
    const pathPart = file.filePath || t('files.projectRoot');
    return lineChanges ? `${pathPart} • ${lineChanges}` : pathPart;
  };

  const renderFileIconForSearch = (file: FileItem) => {
    if (file.fileType === 'folder') {
      return <Octicons name="file-directory" size={29} color="#007AFF" />;
    }

    return <FileIcon fileName={file.fileName} size={29} />;
  };

  const browseParent = rootPath ? parentPathWithinRoot(browsePath, rootPath) : null;

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
        <Text style={{ ...Typography.default(), color: theme.colors.textSecondary, textAlign: 'center' }}>
          {t('errors.sessionDeleted')}
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.surface }]}>
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

      {/* Header with branch info */}
      {!isLoading && gitStatusFiles && (
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
              marginBottom: 8,
            }}
          >
            <Octicons
              name="git-branch"
              size={16}
              color={theme.colors.textSecondary}
              style={{ marginRight: 6 }}
            />
            <Text
              style={{
                fontSize: 16,
                fontWeight: '600',
                color: theme.colors.text,
                ...Typography.default(),
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
      )}

      {/* Git Status List + directory browse */}
      <ItemList style={{ flex: 1 }}>
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
                  const allSegments = [{ label: 'root', path: rootPath }, ...segments.map((seg, i) => ({
                    label: seg,
                    path: rootPath + '/' + segments.slice(0, i + 1).join('/'),
                  }))];
                  return allSegments.map((seg, i) => {
                    const isLast = i === allSegments.length - 1;
                    return (
                      <View key={seg.path} style={{ flexDirection: 'row', alignItems: 'center' }}>
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
                const isDir = entry.type === 'directory';
                const rel = relativePathFromRoot(rootPath, fullPath);
                return (
                  <Item
                    key={`browse-${fullPath}-${entry.type}`}
                    title={entry.name}
                    subtitle={rel}
                    icon={
                      isDir ? (
                        <Octicons name="file-directory" size={29} color="#007AFF" />
                      ) : (
                        <FileIcon fileName={entry.name} size={29} />
                      )
                    }
                    onPress={() => {
                      if (isDir) {
                        setBrowsePath(fullPath);
                      } else {
                        openFilePreview(fullPath);
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

        {isLoading ? (
          <View
            style={{
              justifyContent: 'center',
              alignItems: 'center',
              paddingTop: 32,
              paddingBottom: 24,
            }}
          >
            <ActivityIndicator size="small" color={theme.colors.textSecondary} />
          </View>
        ) : !gitStatusFiles ? (
          <View
            style={{
              alignItems: 'center',
              paddingTop: 24,
              paddingBottom: 32,
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
        ) : searchQuery ||
          (gitStatusFiles.totalStaged === 0 && gitStatusFiles.totalUnstaged === 0) ? (
          // Show search results or all files when clean repo
          isSearching ? (
            <View
              style={{
                justifyContent: 'center',
                alignItems: 'center',
                paddingTop: 40,
              }}
            >
              <ActivityIndicator size="small" color={theme.colors.textSecondary} />
              <Text
                style={{
                  fontSize: 16,
                  color: theme.colors.textSecondary,
                  textAlign: 'center',
                  marginTop: 16,
                  ...Typography.default(),
                }}
              >
                {t('files.searching')}
              </Text>
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
              {searchQuery && (
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
              )}
            </View>
          ) : (
            // Show search results or all files
            <>
              {searchQuery && (
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
                      color: theme.colors.textLink,
                      ...Typography.default(),
                    }}
                  >
                    {t('files.searchResults', { count: searchResults.length })}
                  </Text>
                </View>
              )}
              {searchResults.map((file, index) => (
                <Item
                  key={`file-${file.fullPath}-${index}`}
                  title={file.fileName}
                  subtitle={file.filePath || t('files.projectRoot')}
                  icon={renderFileIconForSearch(file)}
                  onPress={() => handleFilePress(file)}
                  showDivider={index < searchResults.length - 1}
                />
              ))}
            </>
          )
        ) : (
          <>
            {/* Staged Changes Section */}
            {gitStatusFiles.stagedFiles.length > 0 && (
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
                      color: theme.colors.success,
                      ...Typography.default(),
                    }}
                  >
                    {t('files.stagedChanges', { count: gitStatusFiles.stagedFiles.length })}
                  </Text>
                </View>
                {gitStatusFiles.stagedFiles.map((file, index) => (
                  <Item
                    key={`staged-${file.fullPath}-${index}`}
                    title={file.fileName}
                    subtitle={renderFileSubtitle(file)}
                    icon={renderFileIcon(file)}
                    rightElement={renderStatusIcon(file)}
                    onPress={() => handleFilePress(file)}
                    showDivider={
                      index < gitStatusFiles.stagedFiles.length - 1 ||
                      gitStatusFiles.unstagedFiles.length > 0
                    }
                  />
                ))}
              </>
            )}

            {/* Unstaged Changes Section */}
            {gitStatusFiles.unstagedFiles.length > 0 && (
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
                      color: theme.colors.warning,
                      ...Typography.default(),
                    }}
                  >
                    {t('files.unstagedChanges', { count: gitStatusFiles.unstagedFiles.length })}
                  </Text>
                </View>
                {gitStatusFiles.unstagedFiles.map((file, index) => (
                  <Item
                    key={`unstaged-${file.fullPath}-${index}`}
                    title={file.fileName}
                    subtitle={renderFileSubtitle(file)}
                    icon={renderFileIcon(file)}
                    rightElement={renderStatusIcon(file)}
                    onPress={() => handleFilePress(file)}
                    showDivider={index < gitStatusFiles.unstagedFiles.length - 1}
                  />
                ))}
              </>
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
