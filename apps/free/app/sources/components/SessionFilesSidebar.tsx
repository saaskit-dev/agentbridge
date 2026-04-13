import { Ionicons, Octicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import * as React from 'react';
import { Pressable, ScrollView, TextInput, View, type ViewStyle } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { FileIcon } from '@/components/FileIcon';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { useDesktopSessionFilesSidebar } from '@/hooks/useDesktopSessionFilesSidebar';
import { Modal } from '@/modal';
import { sessionListDirectory, type DirectoryEntry } from '@/sync/ops';
import { searchFiles, type FileItem } from '@/sync/suggestionFile';
import { t } from '@/text';
import {
  SIDEBAR_COLLAPSED_WIDTH,
  SIDEBAR_HIDE_THRESHOLD,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from '@/utils/sidebarSizing';
import { Logger, toError } from '@saaskit-dev/agentbridge/telemetry';

const logger = new Logger('app/components/SessionFilesSidebar');

type FileTreeNode = {
  id: string;
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileTreeNode[];
  loaded?: boolean;
  loading?: boolean;
};

const directoryCache = new Map<string, { loadedAt: number; nodes: FileTreeNode[] }>();

const styles = StyleSheet.create(theme => ({
  container: {
    height: '100%',
    backgroundColor: theme.colors.surface,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: theme.colors.divider,
  },
  header: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.divider,
    gap: 10,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTitleWrap: {
    flex: 1,
    marginLeft: 10,
  },
  headerTitle: {
    fontSize: 15,
    color: theme.colors.text,
    ...Typography.default('semiBold'),
  },
  headerSubtitle: {
    fontSize: 11,
    color: theme.colors.textSecondary,
    marginTop: 2,
    ...Typography.default(),
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  headerButton: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchInput: {
    height: 36,
    borderRadius: 10,
    backgroundColor: theme.colors.input.background,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.divider,
    paddingHorizontal: 12,
    color: theme.colors.text,
    ...Typography.default(),
  },
  sectionLabel: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 4,
    fontSize: 11,
    color: theme.colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    ...Typography.default('semiBold'),
  },
  treeScroll: {
    flex: 1,
  },
  treeContent: {
    paddingVertical: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 32,
    paddingRight: 10,
    borderRadius: 8,
    marginHorizontal: 6,
  },
  rowSelected: {
    backgroundColor: theme.colors.surfaceSelected,
  },
  rowLabel: {
    flex: 1,
    fontSize: 13,
    color: theme.colors.text,
    ...Typography.default(),
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.divider,
    padding: 12,
    gap: 10,
  },
  footerLabel: {
    fontSize: 11,
    color: theme.colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    ...Typography.default('semiBold'),
  },
  footerPath: {
    fontSize: 12,
    color: theme.colors.text,
    ...Typography.mono(),
  },
  footerActions: {
    flexDirection: 'row',
    gap: 8,
  },
  footerAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: theme.colors.input.background,
  },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  emptyText: {
    marginTop: 10,
    fontSize: 13,
    textAlign: 'center',
    color: theme.colors.textSecondary,
    ...Typography.default(),
  },
}));

function setResizeCursor(active: boolean) {
  if (typeof document === 'undefined') return;
  document.body.style.cursor = active ? 'col-resize' : '';
  document.body.style.userSelect = active ? 'none' : '';
}

function cacheKey(sessionId: string, path: string) {
  return `${sessionId}:${path}`;
}

function getProjectLabel(rootPath: string): string {
  const normalized = rootPath.replace(/\/+$/, '');
  if (!normalized || normalized === '/') return rootPath || '/';
  const segments = normalized.split('/');
  return segments[segments.length - 1] || normalized;
}

function mapEntryToNode(basePath: string, entry: DirectoryEntry): FileTreeNode | null {
  const isDirectory =
    entry.type === 'directory' ||
    (entry.type === 'symlink' && entry.symlinkTargetType === 'directory');
  const isFile =
    entry.type === 'file' || (entry.type === 'symlink' && entry.symlinkTargetType === 'file');
  if (!isDirectory && !isFile) return null;

  const cleanBase = basePath.replace(/\/+$/, '');
  const path = cleanBase ? `${cleanBase}/${entry.name}` : entry.name;

  return {
    id: path,
    name: entry.name,
    path,
    type: isDirectory ? 'directory' : 'file',
    loaded: false,
  };
}

function updateNodeTree(
  nodes: FileTreeNode[],
  targetPath: string,
  updater: (node: FileTreeNode) => FileTreeNode
): FileTreeNode[] {
  return nodes.map(node => {
    if (node.path === targetPath) {
      return updater(node);
    }
    if (!node.children) {
      return node;
    }
    return {
      ...node,
      children: updateNodeTree(node.children, targetPath, updater),
    };
  });
}

function parentPath(path: string): string | null {
  const normalized = path.replace(/\/+$/, '');
  const idx = normalized.lastIndexOf('/');
  if (idx <= 0) return null;
  return normalized.slice(0, idx);
}

export function SessionFilesSidebar({
  sessionId,
  rootPath,
  activeFilePath,
  onOpenFile,
}: {
  sessionId: string;
  rootPath: string;
  activeFilePath: string | null;
  onOpenFile: (path: string) => void;
}) {
  const router = useRouter();
  const { theme } = useUnistyles();
  const { width, setWidth, collapsed, setCollapsed, defaultWidth } =
    useDesktopSessionFilesSidebar();
  const [tree, setTree] = React.useState<FileTreeNode[]>([]);
  const [expandedPaths, setExpandedPaths] = React.useState<Set<string>>(new Set());
  const [selectedFilePath, setSelectedFilePath] = React.useState<string | null>(activeFilePath);
  const [searchQuery, setSearchQuery] = React.useState('');
  const [searchResults, setSearchResults] = React.useState<FileItem[]>([]);
  const [isLoadingRoot, setIsLoadingRoot] = React.useState(false);
  const [isSearching, setIsSearching] = React.useState(false);
  const [isDragging, setIsDragging] = React.useState(false);
  const [isHovering, setIsHovering] = React.useState(false);
  const lastFilePressRef = React.useRef<{ path: string; at: number } | null>(null);

  React.useEffect(() => {
    setSelectedFilePath(activeFilePath);
  }, [activeFilePath]);

  const panelWidth = collapsed ? SIDEBAR_COLLAPSED_WIDTH : width;

  const loadDirectory = React.useCallback(
    async (path: string, targetPath?: string): Promise<FileTreeNode[]> => {
      const cached = directoryCache.get(cacheKey(sessionId, path));
      if (cached && Date.now() - cached.loadedAt < 5 * 60 * 1000) {
        if (!targetPath) {
          setTree(cached.nodes);
        } else {
          setTree(current =>
            updateNodeTree(current, targetPath, node => ({
              ...node,
              loading: false,
              loaded: true,
              children: cached.nodes,
            }))
          );
        }
        return cached.nodes;
      }

      if (!targetPath) {
        setIsLoadingRoot(true);
      } else {
        setTree(current =>
          updateNodeTree(current, targetPath, node => ({ ...node, loading: true }))
        );
      }

      try {
        const result = await sessionListDirectory(sessionId, path);
        if (!result.success) {
          throw new Error(result.error || t('files.browseLoadFailed'));
        }

        const nodes = (result.entries ?? [])
          .map(entry => mapEntryToNode(path, entry))
          .filter((node): node is FileTreeNode => node !== null)
          .sort((a, b) => {
            if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
            return a.name.localeCompare(b.name);
          });

        directoryCache.set(cacheKey(sessionId, path), {
          loadedAt: Date.now(),
          nodes,
        });

        if (!targetPath) {
          setTree(nodes);
        } else {
          setTree(current =>
            updateNodeTree(current, targetPath, node => ({
              ...node,
              loading: false,
              loaded: true,
              children: nodes,
            }))
          );
        }

        return nodes;
      } catch (error) {
        logger.error('load session sidebar directory failed', toError(error), { sessionId, path });
        if (!targetPath) {
          setTree([]);
        } else {
          setTree(current =>
            updateNodeTree(current, targetPath, node => ({ ...node, loading: false, loaded: true }))
          );
        }
        return [];
      } finally {
        if (!targetPath) {
          setIsLoadingRoot(false);
        }
      }
    },
    [sessionId]
  );

  const revealPath = React.useCallback(
    async (absolutePath: string) => {
      if (!absolutePath || !absolutePath.startsWith(rootPath)) return;

      const ancestorPaths: string[] = [];
      let current = parentPath(absolutePath);
      while (current && current.startsWith(rootPath)) {
        ancestorPaths.unshift(current);
        if (current === rootPath) break;
        current = parentPath(current);
      }

      if (tree.length === 0) {
        await loadDirectory(rootPath);
      }

      for (const ancestor of ancestorPaths) {
        if (ancestor === rootPath) continue;
        setExpandedPaths(prev => new Set(prev).add(ancestor));
        const node = ancestorPaths
          ? ancestor
          : rootPath;
        await loadDirectory(ancestor, ancestor);
        void node;
      }
    },
    [loadDirectory, rootPath, tree.length]
  );

  React.useEffect(() => {
    setExpandedPaths(new Set());
    setSearchQuery('');
    setSearchResults([]);
    void loadDirectory(rootPath);
  }, [loadDirectory, rootPath, sessionId]);

  React.useEffect(() => {
    if (!activeFilePath) return;
    void revealPath(activeFilePath);
  }, [activeFilePath, revealPath]);

  React.useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    let cancelled = false;
    setIsSearching(true);
    const timer = setTimeout(() => {
      void searchFiles(sessionId, searchQuery, { limit: 100 }).then(results => {
        if (!cancelled) {
          setSearchResults(results);
          setIsSearching(false);
        }
      });
    }, 180);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchQuery, sessionId]);

  const handleToggleDirectory = React.useCallback(
    async (node: FileTreeNode) => {
      setExpandedPaths(current => {
        const next = new Set(current);
        if (next.has(node.path)) {
          next.delete(node.path);
        } else {
          next.add(node.path);
        }
        return next;
      });

      if (!node.loaded && !node.loading) {
        await loadDirectory(node.path, node.path);
      }
    },
    [loadDirectory]
  );

  const resolveSearchResultPath = React.useCallback(
    (item: FileItem) => {
      const normalized = item.fullPath.replace(/\/+$/, '');
      if (!normalized) return rootPath;
      if (normalized.startsWith('/')) return normalized;
      return `${rootPath.replace(/\/+$/, '')}/${normalized}`;
    },
    [rootPath]
  );

  const handleCopyPath = React.useCallback(async () => {
    const path = selectedFilePath ?? activeFilePath;
    if (!path) return;
    await Clipboard.setStringAsync(path);
    Modal.alert(t('common.copied'), t('files.pathCopied'));
  }, [activeFilePath, selectedFilePath]);

  const startResize = React.useCallback(
    (startClientX: number) => {
      if (typeof window === 'undefined') return;

      const handleMove = (event: MouseEvent) => {
        const nextWidth = window.innerWidth - event.clientX;
        if (nextWidth < SIDEBAR_HIDE_THRESHOLD) {
          setCollapsed(true);
          return;
        }

        const maxVisibleWidth = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, window.innerWidth - 360));
        setCollapsed(false);
        setWidth(Math.max(SIDEBAR_MIN_WIDTH, Math.min(nextWidth, maxVisibleWidth)));
      };

      const handleUp = (event: MouseEvent) => {
        handleMove(event);
        setIsDragging(false);
        setResizeCursor(false);
        window.removeEventListener('mousemove', handleMove);
        window.removeEventListener('mouseup', handleUp);
      };

      setIsDragging(true);
      setResizeCursor(true);
      window.addEventListener('mousemove', handleMove);
      window.addEventListener('mouseup', handleUp);
      handleMove({ clientX: startClientX } as MouseEvent);
    },
    [setCollapsed, setWidth]
  );

  const handleFilePress = React.useCallback(
    (path: string) => {
      const now = Date.now();
      const previous = lastFilePressRef.current;
      if (previous && previous.path === path && now - previous.at < 320) {
        lastFilePressRef.current = null;
        setSelectedFilePath(path);
        onOpenFile(path);
        return;
      }

      lastFilePressRef.current = { path, at: now };
      setSelectedFilePath(path);
    },
    [onOpenFile]
  );

  const handleDirectorySearchResultPress = React.useCallback(
    async (path: string) => {
      setSelectedFilePath(path);
      setSearchQuery('');
      setSearchResults([]);
      await revealPath(path);
      setExpandedPaths(current => {
        const next = new Set(current);
        next.add(path);
        return next;
      });
      await loadDirectory(path, path);
    },
    [loadDirectory, revealPath]
  );

  const renderNode = React.useCallback(
    (node: FileTreeNode, depth: number): React.ReactNode => {
      const expanded = expandedPaths.has(node.path);
      const selected = selectedFilePath === node.path || activeFilePath === node.path;

      return (
        <View key={node.id}>
          <Pressable
            onPress={() => {
              if (node.type === 'directory') {
                void handleToggleDirectory(node);
              } else {
                handleFilePress(node.path);
              }
            }}
            style={[styles.row, selected && styles.rowSelected, { paddingLeft: 10 + depth * 14 }]}
          >
            {node.type === 'directory' ? (
              <Ionicons
                name={expanded ? 'chevron-down' : 'chevron-forward'}
                size={14}
                color={theme.colors.textSecondary}
                style={{ marginRight: 4 }}
              />
            ) : (
              <View style={{ width: 18 }} />
            )}
            {node.type === 'directory' ? (
              <Octicons
                name="file-directory"
                size={15}
                color="#007AFF"
                style={{ marginRight: 8 }}
              />
            ) : (
              <View style={{ marginRight: 8 }}>
                <FileIcon fileName={node.name} size={16} />
              </View>
            )}
            <Text style={styles.rowLabel} numberOfLines={1}>
              {node.name}
            </Text>
            {node.loading ? (
              <Ionicons name="sync-outline" size={14} color={theme.colors.textSecondary} />
            ) : null}
          </Pressable>
          {node.type === 'directory' && expanded && node.children?.map(child => renderNode(child, depth + 1))}
        </View>
      );
    },
    [activeFilePath, expandedPaths, handleFilePress, handleToggleDirectory, selectedFilePath, theme.colors.textSecondary]
  );

  const renderSearchResult = React.useCallback(
    (item: FileItem) => {
      const absolutePath = resolveSearchResultPath(item);
      const selected = activeFilePath === absolutePath || selectedFilePath === absolutePath;
      return (
        <Pressable
          key={item.fullPath}
          onPress={() => {
            if (item.fileType === 'folder') {
              void handleDirectorySearchResultPress(absolutePath);
              return;
            }
            handleFilePress(absolutePath);
          }}
          style={[styles.row, selected && styles.rowSelected, { paddingLeft: 10 }]}
        >
          <View style={{ marginRight: 8 }}>
            {item.fileType === 'folder' ? (
              <Octicons name="file-directory" size={15} color="#007AFF" />
            ) : (
              <FileIcon fileName={item.fileName} size={16} />
            )}
          </View>
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={styles.rowLabel}>
              {item.fileName}
            </Text>
            <Text numberOfLines={1} style={{ fontSize: 11, color: theme.colors.textSecondary, ...Typography.mono() }}>
              {item.fullPath}
            </Text>
          </View>
        </Pressable>
      );
    },
    [
      activeFilePath,
      handleDirectorySearchResultPress,
      handleFilePress,
      resolveSearchResultPath,
      selectedFilePath,
      theme.colors.textSecondary,
    ]
  );

  const resizeHandleStyle: ViewStyle = {
    position: 'absolute',
    top: 0,
    left: 0,
    width: collapsed ? SIDEBAR_COLLAPSED_WIDTH : 12,
    height: '100%',
    backgroundColor:
      collapsed || isDragging || isHovering ? 'rgba(0, 0, 0, 0.08)' : 'transparent',
    borderRightWidth: !collapsed && (isDragging || isHovering) ? 1 : 0,
    borderRightColor: 'rgba(0, 0, 0, 0.12)',
    borderLeftWidth: collapsed ? 1 : 0,
    borderLeftColor: 'rgba(0, 0, 0, 0.08)',
  };

  return (
    <View style={[styles.container, { width: panelWidth, position: 'relative', overflow: 'hidden' }]}>
      {!collapsed ? (
        <>
          <View style={styles.header}>
            <View style={styles.headerTop}>
              <Octicons name="repo" size={16} color={theme.colors.textSecondary} />
              <View style={styles.headerTitleWrap}>
                <Text style={styles.headerTitle}>Files</Text>
                <Text style={styles.headerSubtitle} numberOfLines={1}>
                  {getProjectLabel(rootPath)}
                </Text>
              </View>
              <View style={styles.headerActions}>
                <Pressable
                  hitSlop={8}
                  onPress={() => {
                    directoryCache.delete(cacheKey(sessionId, rootPath));
                    void loadDirectory(rootPath);
                  }}
                  style={styles.headerButton}
                >
                  <Ionicons name="refresh-outline" size={16} color={theme.colors.textSecondary} />
                </Pressable>
                <Pressable
                  hitSlop={8}
                  onPress={() => {
                    const target = activeFilePath || selectedFilePath;
                    if (target) {
                      void revealPath(target);
                    }
                  }}
                  style={styles.headerButton}
                >
                  <Ionicons name="locate-outline" size={16} color={theme.colors.textSecondary} />
                </Pressable>
                <Pressable
                  hitSlop={8}
                  onPress={() => router.push(`/session/${sessionId}/files`)}
                  style={styles.headerButton}
                >
                  <Ionicons name="open-outline" size={16} color={theme.colors.textSecondary} />
                </Pressable>
              </View>
            </View>
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder={t('files.searchPlaceholder')}
              placeholderTextColor={theme.colors.textSecondary}
              style={styles.searchInput}
            />
          </View>

          <ScrollView style={styles.treeScroll} contentContainerStyle={styles.treeContent}>
            {searchQuery.trim() ? (
              <>
                <Text style={styles.sectionLabel}>Search</Text>
                {isSearching ? (
                  <View style={styles.emptyWrap}>
                    <Ionicons name="search-outline" size={20} color={theme.colors.textSecondary} />
                    <Text style={styles.emptyText}>{t('files.searching')}</Text>
                  </View>
                ) : searchResults.length === 0 ? (
                  <View style={styles.emptyWrap}>
                    <Ionicons name="search-outline" size={20} color={theme.colors.textSecondary} />
                    <Text style={styles.emptyText}>{t('files.noFilesFound')}</Text>
                  </View>
                ) : (
                  searchResults.map(renderSearchResult)
                )}
              </>
            ) : isLoadingRoot ? (
              <View style={styles.emptyWrap}>
                <Ionicons name="sync-outline" size={20} color={theme.colors.textSecondary} />
                <Text style={styles.emptyText}>Loading files...</Text>
              </View>
            ) : tree.length === 0 ? (
              <View style={styles.emptyWrap}>
                <Octicons name="file-directory" size={20} color={theme.colors.textSecondary} />
                <Text style={styles.emptyText}>{t('files.noFilesInProject')}</Text>
              </View>
            ) : (
              <>
                <Text style={styles.sectionLabel}>Project</Text>
                {tree.map(node => renderNode(node, 0))}
              </>
            )}
          </ScrollView>

          <View style={styles.footer}>
            <Text style={styles.footerLabel}>{t('files.file')}</Text>
            <Text style={styles.footerPath} numberOfLines={2}>
              {selectedFilePath ?? activeFilePath ?? rootPath}
            </Text>
            <View style={styles.footerActions}>
              <Pressable
                style={styles.footerAction}
                onPress={() => {
                  const target = selectedFilePath ?? activeFilePath;
                  if (target) {
                    onOpenFile(target);
                  } else {
                    router.push(`/session/${sessionId}/files`);
                  }
                }}
              >
                <Ionicons name="open-outline" size={14} color={theme.colors.text} />
                <Text style={{ color: theme.colors.text, ...Typography.default() }}>Open</Text>
              </Pressable>
              <Pressable style={styles.footerAction} onPress={() => void handleCopyPath()}>
                <Ionicons name="copy-outline" size={14} color={theme.colors.text} />
                <Text style={{ color: theme.colors.text, ...Typography.default() }}>
                  {t('common.copy')}
                </Text>
              </Pressable>
            </View>
          </View>
        </>
      ) : null}

      <Pressable
        onPress={() => {
          if (collapsed) {
            setCollapsed(false);
            setWidth(defaultWidth);
          } else {
            setCollapsed(true);
          }
        }}
        style={{
          position: 'absolute',
          top: 18,
          left: collapsed ? 6 : 10,
          zIndex: 2,
          minWidth: collapsed ? 32 : 84,
          height: 32,
          paddingHorizontal: collapsed ? 0 : 10,
          borderRadius: 999,
          backgroundColor: 'rgba(255,255,255,0.96)',
          borderWidth: 1,
          borderColor: 'rgba(15,23,42,0.08)',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          shadowColor: '#000',
          shadowOpacity: 0.08,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 4 },
        }}
      >
        <Ionicons
          name={collapsed ? 'chevron-back' : 'chevron-forward'}
          size={16}
          color="#334155"
        />
        {!collapsed ? (
          <Text
            style={{
              fontSize: 12,
              color: '#334155',
              ...Typography.default('semiBold'),
            }}
          >
            Collapse
          </Text>
        ) : null}
      </Pressable>

      <Pressable
        onPress={() => {
          if (collapsed) {
            setCollapsed(false);
            setWidth(defaultWidth);
          }
        }}
        // @ts-ignore web
        onDoubleClick={() => {
          const nextCollapsed = !collapsed;
          setCollapsed(nextCollapsed);
          if (!nextCollapsed) {
            setWidth(defaultWidth);
          }
        }}
        // @ts-ignore web
        onMouseDown={(event: any) => {
          startResize(event.clientX ?? event.nativeEvent?.clientX ?? 0);
        }}
        onHoverIn={() => setIsHovering(true)}
        onHoverOut={() => setIsHovering(false)}
        style={[resizeHandleStyle, { cursor: 'col-resize' } as any]}
      />
    </View>
  );
}
