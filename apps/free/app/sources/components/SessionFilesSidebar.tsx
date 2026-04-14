import { Ionicons, Octicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import * as React from 'react';
import { FlatList, Pressable, TextInput, View, type ViewStyle } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { FileIcon } from '@/components/FileIcon';
import { Text } from '@/components/StyledText';
import { WebPortal } from '@/components/web/WebPortal';
import { Typography } from '@/constants/Typography';
import { useDesktopSessionFilesSidebar } from '@/hooks/useDesktopSessionFilesSidebar';
import { Modal } from '@/modal';
import { getGitStatusFiles, type GitFileStatus, type GitStatusFiles } from '@/sync/gitStatusFiles';
import { sessionBash, sessionListDirectory, type DirectoryEntry } from '@/sync/ops';
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

type SidebarTool = 'files' | 'git';

type ContextMenuKind = 'file' | 'git';

type ContextMenuState = {
  x: number;
  y: number;
  kind: ContextMenuKind;
  path: string;
  absolutePath: string;
  fileName?: string;
  isStaged?: boolean;
  status?: GitFileStatus['status'];
  section?: 'staged' | 'unstaged';
  isDirectory?: boolean;
};

type FileTreeNode = {
  id: string;
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileTreeNode[];
  loaded?: boolean;
  loading?: boolean;
};

type GitTreeNode = {
  id: string;
  name: string;
  path: string;
  type: 'file' | 'directory';
  section: 'staged' | 'unstaged';
  status?: GitFileStatus;
  loaded?: boolean;
  children?: GitTreeNode[];
};

type VisibleFileTreeRow = {
  key: string;
  node: FileTreeNode;
  depth: number;
};

type VisibleGitTreeRow = {
  key: string;
  node: GitTreeNode;
  depth: number;
};

type GitListRow =
  | {
      type: 'section';
      key: string;
      title: string;
      tone: 'success' | 'warning';
    }
  | {
      type: 'node';
      key: string;
      node: GitTreeNode;
      depth: number;
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
  toolTabs: {
    flexDirection: 'row',
    gap: 8,
    marginHorizontal: 8,
  },
  toolTab: {
    flex: 1,
    height: 28,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolTabActive: {
    backgroundColor: '#3B82F6',
  },
  toolTabInactive: {
    backgroundColor: 'rgba(148,163,184,0.14)',
  },
  toolTabText: {
    fontSize: 12,
    ...Typography.default('semiBold'),
  },
  toolTabTextActive: {
    color: '#FFFFFF',
  },
  toolTabTextInactive: {
    color: theme.colors.text,
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
  gitCard: {
    marginHorizontal: 8,
    marginTop: 10,
    marginBottom: 8,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  gitCardHeader: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 6,
  },
  gitBranchRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  gitBranchText: {
    marginLeft: 6,
    fontSize: 13,
    ...Typography.default('semiBold'),
  },
  gitSummaryText: {
    fontSize: 11,
    ...Typography.default(),
  },
  gitEmptyWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 18,
  },
  gitEmptyTitle: {
    marginTop: 10,
    fontSize: 13,
    textAlign: 'center',
    ...Typography.default('semiBold'),
  },
  gitEmptySubtitle: {
    marginTop: 6,
    fontSize: 12,
    textAlign: 'center',
    ...Typography.default(),
  },
  gitSectionHeader: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  gitSectionTitle: {
    fontSize: 12,
    ...Typography.default('semiBold'),
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
  rowMeta: {
    marginTop: 2,
    fontSize: 11,
    color: theme.colors.textSecondary,
    ...Typography.mono(),
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
  contextMenu: {
    width: 214,
    backgroundColor: theme.colors.surface,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.divider,
    overflow: 'hidden',
  },
  contextMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  contextMenuText: {
    color: theme.colors.text,
    fontSize: 12,
    ...Typography.default(),
  },
  contextMenuTextDanger: {
    color: theme.colors.textDestructive,
    fontSize: 12,
    ...Typography.default(),
  },
  contextMenuDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.colors.divider,
  },
  toolbar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'stretch',
    gap: 8,
    paddingHorizontal: 8,
    marginTop: 10,
    marginBottom: 4,
  },
  toolbarButton: {
    minWidth: 84,
    flex: 1,
    minHeight: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.divider,
    backgroundColor: theme.colors.surface,
  },
  toolbarButtonDisabled: {
    opacity: 0.5,
  },
  toolbarButtonText: {
    fontSize: 11,
    ...Typography.default('semiBold'),
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

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function gitFileNodePathKey(section: 'staged' | 'unstaged', filePath: string): string {
  return `${section}:${filePath}`;
}

function buildGitTree(
  files: GitFileStatus[],
  section: 'staged' | 'unstaged'
): GitTreeNode[] {
  const root: GitTreeNode[] = [];
  const nodeMap = new Map<string, GitTreeNode>();
  const ensureNode = (path: string, name: string, type: 'file' | 'directory', current: GitTreeNode[]) => {
    const key = gitFileNodePathKey(section, path);
    const existing = nodeMap.get(key);
    if (existing) {
      return existing;
    }
    const node: GitTreeNode = {
      id: key,
      name,
      path,
      type,
      section,
      children: type === 'directory' ? [] : undefined,
    };
    nodeMap.set(key, node);
    current.push(node);
    return node;
  };

  for (const file of files) {
    const parts = file.fullPath.split('/').filter(Boolean);
    let nodes = root;
    let currentPath = '';
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      const nextPath = currentPath ? `${currentPath}/${part}` : part;
      const isLeaf = index === parts.length - 1;
      const node = ensureNode(nextPath, part, isLeaf ? 'file' : 'directory', nodes);
      if (!isLeaf) {
        if (!node.children) node.children = [];
        nodes = node.children;
      } else {
        node.status = file;
      }
      currentPath = nextPath;
    }
  }

  const sortNodes = (nodes: GitTreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const node of nodes) {
      if (node.children) {
        sortNodes(node.children);
      }
    }
  };

  sortNodes(root);
  return root;
}

function flattenVisibleFileTree(
  nodes: FileTreeNode[],
  expandedPaths: Set<string>,
  depth: number = 0
): VisibleFileTreeRow[] {
  const rows: VisibleFileTreeRow[] = [];

  for (const node of nodes) {
    rows.push({ key: node.id, node, depth });
    if (node.type === 'directory' && expandedPaths.has(node.path) && node.children?.length) {
      rows.push(...flattenVisibleFileTree(node.children, expandedPaths, depth + 1));
    }
  }

  return rows;
}

function flattenVisibleGitTree(
  nodes: GitTreeNode[],
  expandedPaths: Set<string>,
  depth: number = 0
): VisibleGitTreeRow[] {
  const rows: VisibleGitTreeRow[] = [];

  for (const node of nodes) {
    rows.push({ key: node.id, node, depth });
    if (
      node.type === 'directory' &&
      expandedPaths.has(gitFileNodePathKey(node.section, node.path)) &&
      node.children?.length
    ) {
      rows.push(...flattenVisibleGitTree(node.children, expandedPaths, depth + 1));
    }
  }

  return rows;
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
  const {
    width: persistedWidth,
    setWidth: persistWidth,
    collapsed: persistedCollapsed,
    setCollapsed: persistCollapsed,
    defaultWidth,
  } =
    useDesktopSessionFilesSidebar();
  const normalizedActiveFilePath =
    activeFilePath && activeFilePath.startsWith('/')
      ? activeFilePath
      : activeFilePath
        ? `${rootPath.replace(/\/+$/, '')}/${activeFilePath}`
        : null;
  const [tree, setTree] = React.useState<FileTreeNode[]>([]);
  const [expandedPaths, setExpandedPaths] = React.useState<Set<string>>(new Set());
  const [selectedFilePath, setSelectedFilePath] = React.useState<string | null>(normalizedActiveFilePath);
  const [searchQuery, setSearchQuery] = React.useState('');
  const [searchResults, setSearchResults] = React.useState<FileItem[]>([]);
  const [isLoadingRoot, setIsLoadingRoot] = React.useState(false);
  const [gitStatusFiles, setGitStatusFiles] = React.useState<GitStatusFiles | null>(null);
  const [isLoadingGit, setIsLoadingGit] = React.useState(false);
  const [activeTool, setActiveTool] = React.useState<SidebarTool>('files');
  const [contextMenu, setContextMenu] = React.useState<ContextMenuState | null>(null);
  const [gitExpandedPaths, setGitExpandedPaths] = React.useState<Set<string>>(new Set());
  const [gitCommandBusy, setGitCommandBusy] = React.useState(false);
  const [isSearching, setIsSearching] = React.useState(false);
  const [isDragging, setIsDragging] = React.useState(false);
  const [isHovering, setIsHovering] = React.useState(false);
  const lastFilePressRef = React.useRef<{ path: string; at: number } | null>(null);
  const [liveWidth, setLiveWidth] = React.useState(persistedWidth);
  const [liveCollapsed, setLiveCollapsed] = React.useState(persistedCollapsed);

  React.useEffect(() => {
    if (!isDragging) {
      setLiveWidth(persistedWidth);
    }
  }, [isDragging, persistedWidth]);

  React.useEffect(() => {
    if (!isDragging) {
      setLiveCollapsed(persistedCollapsed);
    }
  }, [isDragging, persistedCollapsed]);

  const commitSidebarLayout = React.useCallback(
    (nextWidth: number, nextCollapsed: boolean) => {
      setLiveWidth(nextWidth);
      setLiveCollapsed(nextCollapsed);

      if (nextCollapsed !== persistedCollapsed) {
        persistCollapsed(nextCollapsed);
      }
      if (!nextCollapsed && nextWidth !== persistedWidth) {
        persistWidth(nextWidth);
      }
    },
    [persistCollapsed, persistWidth, persistedCollapsed, persistedWidth]
  );

  const panelWidth = liveCollapsed ? SIDEBAR_COLLAPSED_WIDTH : liveWidth;

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
        await loadDirectory(ancestor, ancestor);
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
    let cancelled = false;

    const loadGitStatus = async () => {
      setIsLoadingGit(true);
      try {
        const result = await getGitStatusFiles(sessionId);
        if (!cancelled) {
          setGitStatusFiles(result);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingGit(false);
        }
      }
    };

    void loadGitStatus();

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  React.useEffect(() => {
    if (!activeFilePath) return;
    const absolutePath = activeFilePath.startsWith('/')
      ? activeFilePath
      : `${rootPath.replace(/\/+$/, '')}/${activeFilePath}`;
    void revealPath(absolutePath);
  }, [activeFilePath, revealPath, rootPath]);

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

  const resolveFileAbsolutePath = React.useCallback(
    (relativePath: string) => {
      if (relativePath.startsWith('/')) return relativePath;
      return `${rootPath.replace(/\/+$/, '')}/${relativePath}`;
    },
    [rootPath]
  );

  React.useEffect(() => {
    if (!activeFilePath) {
      setSelectedFilePath(null);
      return;
    }
    setSelectedFilePath(resolveFileAbsolutePath(activeFilePath));
  }, [activeFilePath, resolveFileAbsolutePath]);

  const absoluteActiveFilePath = React.useMemo(() => {
    if (!activeFilePath) return null;
    return resolveFileAbsolutePath(activeFilePath);
  }, [activeFilePath, resolveFileAbsolutePath]);

  const closeContextMenu = React.useCallback(() => {
    setContextMenu(null);
  }, []);

  const openContextMenu = React.useCallback(
    (event: React.MouseEvent | any, kind: ContextMenuKind, path: string, options?: Partial<ContextMenuState>) => {
      if (typeof document === 'undefined') return;
      const x = event?.clientX ?? event?.nativeEvent?.clientX ?? event?.pageX ?? 0;
      const y = event?.clientY ?? event?.nativeEvent?.clientY ?? event?.pageY ?? 0;
      setContextMenu({
        x,
        y,
        kind,
        path,
        absolutePath: options?.absolutePath ?? resolveFileAbsolutePath(path),
        fileName: options?.fileName,
        isStaged: options?.isStaged,
        status: options?.status,
        section: options?.section,
        isDirectory: options?.isDirectory,
      });
      event?.preventDefault?.();
    },
    [resolveFileAbsolutePath]
  );

  const handleCopyPath = React.useCallback(async (path?: string) => {
    const targetPath = path ?? selectedFilePath ?? activeFilePath;
    if (!targetPath) return;
    const absoluteTargetPath = targetPath.startsWith('/')
      ? targetPath
      : resolveFileAbsolutePath(targetPath);
    await Clipboard.setStringAsync(absoluteTargetPath);
    Modal.alert(t('common.copied'), t('files.pathCopied'));
  }, [activeFilePath, resolveFileAbsolutePath, selectedFilePath]);

  const refreshGitData = React.useCallback(async () => {
    setIsLoadingGit(true);
    try {
      const result = await getGitStatusFiles(sessionId);
      setGitStatusFiles(result);
    } finally {
      setIsLoadingGit(false);
    }
  }, [sessionId]);

  const runGitCommand = React.useCallback(
    async (command: string, options?: { refresh?: boolean }) => {
      const target = options?.refresh ?? true;
      setGitCommandBusy(true);
      try {
        const result = await sessionBash(sessionId, {
          command,
          cwd: rootPath,
          timeout: 120000,
        });

        if (!result.success || result.exitCode !== 0) {
          const output = result.stderr || result.stdout || 'Git command failed';
          throw new Error(output.trim() || 'Git command failed');
        }

        if (target) {
          await refreshGitData();
        }
        return true;
      } catch (error) {
        logger.error('git command failed', toError(error), { sessionId, command });
        Modal.alert('Git command failed', String(toError(error)));
        return false;
      } finally {
        setGitCommandBusy(false);
      }
    },
    [refreshGitData, rootPath, sessionId]
  );

  const runGitStage = React.useCallback(
    async (path: string) => {
      const targetPath = path.startsWith('/') ? path : `./${path}`;
      return runGitCommand(`git add --all -- ${shellQuote(targetPath)}`);
    },
    [runGitCommand]
  );

  const runGitUnstage = React.useCallback(
    async (path: string) => {
      const targetPath = path.startsWith('/') ? path : `./${path}`;
      return runGitCommand(`git restore --staged -- ${shellQuote(targetPath)}`);
    },
    [runGitCommand]
  );

  const runGitDiscard = React.useCallback(
    async (
      path: string,
      options?: {
        section?: 'staged' | 'unstaged';
        status?: GitFileStatus['status'];
      }
    ) => {
      const targetPath = path.startsWith('/') ? path : `./${path}`;
      const section = options?.section ?? 'unstaged';
      const command =
        section === 'staged'
          ? `git restore --staged --worktree -- ${shellQuote(targetPath)}`
          : options?.status === 'untracked'
            ? `git clean -fd -- ${shellQuote(targetPath)}`
            : `git restore --worktree -- ${shellQuote(targetPath)}; git clean -fd -- ${shellQuote(targetPath)}`;
      return runGitCommand(command);
    },
    [runGitCommand]
  );

  const handleGitAction = React.useCallback(
    async (
      type: string,
      relativePath?: string,
      options?: {
        section?: 'staged' | 'unstaged';
        status?: GitFileStatus['status'];
      }
    ) => {
      const filePath = relativePath ?? '';
      switch (type) {
        case 'fetch': {
          await runGitCommand('git fetch --all --prune');
          break;
        }
        case 'sync': {
          const pullResult = await runGitCommand('git pull --rebase', { refresh: false });
          if (!pullResult) {
            return;
          }

          const pushResult = await runGitCommand('git push', { refresh: false });
          if (!pushResult) {
            return;
          }
          break;
        }
        case 'stash': {
          const message = await Modal.prompt('Stash changes', 'Enter stash message (optional)', {
            placeholder: 'Optional stash message',
            confirmText: 'Stash',
          });
          if (message === null) {
            return;
          }

          const stashCommand = message.trim()
            ? `git stash push -m ${shellQuote(message.trim())}`
            : 'git stash push';
          await runGitCommand(stashCommand);
          break;
        }
        case 'stash-pop': {
          const stashList = await sessionBash(sessionId, {
            command: 'git stash list',
            cwd: rootPath,
            timeout: 120000,
          });
          if (!stashList.success || stashList.exitCode !== 0) {
            const output = stashList.stderr || stashList.stdout || 'Failed to read stash list';
            logger.error('check git stash list failed', { sessionId, error: output });
            Modal.alert('Git command failed', output);
            return;
          }

          if (!(stashList.stdout || '').trim()) {
            Modal.alert('No stash', 'There are no stashed changes.');
            return;
          }

          await runGitCommand('git stash pop');
          break;
        }
        case 'stage': {
          await runGitStage(filePath);
          break;
        }
        case 'unstage': {
          await runGitUnstage(filePath);
          break;
        }
        case 'discard': {
          const section = options?.section ?? 'unstaged';
          const isUntracked = options?.status === 'untracked';
          const confirm = await Modal.confirm(
            'Confirm discard',
            isUntracked
              ? 'This will remove the selected untracked file or folder.'
              : section === 'staged'
                ? 'This will remove staged changes and keep unstaged changes if any.'
                : 'This will discard local changes for the selected path.',
            { confirmText: 'Discard', destructive: true }
          );
          if (!confirm) {
            return;
          }
          await runGitDiscard(filePath, {
            section,
            status: options?.status,
          });
          break;
        }
        case 'open': {
          const absolute = resolveFileAbsolutePath(filePath);
          setSelectedFilePath(absolute);
          onOpenFile(absolute);
          break;
        }
        case 'copy': {
          await handleCopyPath(resolveFileAbsolutePath(filePath));
          break;
        }
        case 'commit': {
          const message = await Modal.prompt('Commit', 'Enter commit message', {
            placeholder: 'Commit message',
            confirmText: 'Commit',
          });
          if (!message || !message.trim()) return;
          await runGitCommand(`git commit -m ${shellQuote(message.trim())}`);
          break;
        }
        case 'pull': {
          await runGitCommand('git pull');
          break;
        }
        case 'push': {
          await runGitCommand('git push');
          break;
        }
        case 'stage-all': {
          await runGitCommand('git add --all');
          break;
        }
        case 'unstage-all': {
          await runGitCommand('git restore --staged -- .');
          break;
        }
        case 'discard-all': {
          const confirm = await Modal.confirm(
            'Confirm discard',
            'This will discard all staged and unstaged changes and remove untracked files.',
            { confirmText: 'Discard', destructive: true }
          );
          if (!confirm) {
            return;
          }
          await runGitCommand('git reset --hard');
          await runGitCommand('git clean -fd');
          break;
        }
        default:
          break;
      }
      closeContextMenu();
      await refreshGitData();
    },
    [
      closeContextMenu,
      handleCopyPath,
      onOpenFile,
      refreshGitData,
      resolveFileAbsolutePath,
      runGitCommand,
      runGitDiscard,
      runGitStage,
      runGitUnstage,
    ]
  );

  const toggleGitNode = React.useCallback((node: GitTreeNode) => {
    const key = gitFileNodePathKey(node.section, node.path);
    setGitExpandedPaths(current => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const isGitNodeExpanded = React.useCallback(
    (node: GitTreeNode) => gitExpandedPaths.has(gitFileNodePathKey(node.section, node.path)),
    [gitExpandedPaths]
  );

  const stagedGitTree = React.useMemo(
    () => buildGitTree(gitStatusFiles?.stagedFiles ?? [], 'staged'),
    [gitStatusFiles?.stagedFiles]
  );
  const unstagedGitTree = React.useMemo(
    () => buildGitTree(gitStatusFiles?.unstagedFiles ?? [], 'unstaged'),
    [gitStatusFiles?.unstagedFiles]
  );
  const visibleFileRows = React.useMemo(
    () => flattenVisibleFileTree(tree, expandedPaths),
    [expandedPaths, tree]
  );
  const visibleStagedGitRows = React.useMemo(
    () => flattenVisibleGitTree(stagedGitTree, gitExpandedPaths),
    [gitExpandedPaths, stagedGitTree]
  );
  const visibleUnstagedGitRows = React.useMemo(
    () => flattenVisibleGitTree(unstagedGitTree, gitExpandedPaths),
    [gitExpandedPaths, unstagedGitTree]
  );

  const startResize = React.useCallback(
    (startClientX: number) => {
      if (typeof window === 'undefined') return;

      let finalWidth = liveWidth;
      let finalCollapsed = liveCollapsed;

      const handleMove = (event: MouseEvent) => {
        const nextWidth = window.innerWidth - event.clientX;
        if (nextWidth < SIDEBAR_HIDE_THRESHOLD) {
          finalCollapsed = true;
          setLiveCollapsed(true);
          return;
        }

        const maxVisibleWidth = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, window.innerWidth - 360));
        finalCollapsed = false;
        finalWidth = Math.max(SIDEBAR_MIN_WIDTH, Math.min(nextWidth, maxVisibleWidth));
        setLiveCollapsed(false);
        setLiveWidth(finalWidth);
      };

      const handleUp = (event: MouseEvent) => {
        handleMove(event);
        setIsDragging(false);
        setResizeCursor(false);
        window.removeEventListener('mousemove', handleMove);
        window.removeEventListener('mouseup', handleUp);
        commitSidebarLayout(finalWidth, finalCollapsed);
      };

      setIsDragging(true);
      setResizeCursor(true);
      window.addEventListener('mousemove', handleMove);
      window.addEventListener('mouseup', handleUp);
      handleMove({ clientX: startClientX } as MouseEvent);
    },
    [commitSidebarLayout, liveCollapsed, liveWidth]
  );

  const handleFilePress = React.useCallback(
    (path: string) => {
      const absolutePath = resolveFileAbsolutePath(path);
      const now = Date.now();
      const previous = lastFilePressRef.current;
      if (previous && previous.path === absolutePath && now - previous.at < 320) {
        lastFilePressRef.current = null;
        setSelectedFilePath(absolutePath);
        onOpenFile(absolutePath);
        return;
      }

      lastFilePressRef.current = { path: absolutePath, at: now };
      setSelectedFilePath(absolutePath);
    },
    [onOpenFile, resolveFileAbsolutePath]
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

  const renderFileTreeRow = React.useCallback(
    ({ item }: { item: VisibleFileTreeRow }) => {
      const { node, depth } = item;
      const expanded = expandedPaths.has(node.path);
      const absolutePath = resolveFileAbsolutePath(node.path);
      const selected = selectedFilePath === absolutePath || absoluteActiveFilePath === absolutePath;

      return (
        <Pressable
          onPress={() => {
            if (node.type === 'directory') {
              void handleToggleDirectory(node);
            } else {
              handleFilePress(node.path);
            }
          }}
          // @ts-ignore web
          onContextMenu={(event: any) => {
            openContextMenu(event, 'file', node.path, {
              absolutePath,
              fileName: node.name,
              isDirectory: node.type === 'directory',
            });
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
      );
    },
    [
      absoluteActiveFilePath,
      expandedPaths,
      handleFilePress,
      handleToggleDirectory,
      openContextMenu,
      resolveFileAbsolutePath,
      selectedFilePath,
      theme.colors.textSecondary,
    ]
  );

  const renderSearchResultRow = React.useCallback(
    ({ item }: { item: FileItem }) => {
      const absolutePath = resolveSearchResultPath(item);
      const selected = absoluteActiveFilePath === absolutePath || selectedFilePath === absolutePath;
      return (
        <Pressable
          onPress={() => {
            if (item.fileType === 'folder') {
              void handleDirectorySearchResultPress(absolutePath);
              return;
            }
            handleFilePress(absolutePath);
          }}
          // @ts-ignore web
          onContextMenu={(event: any) => {
            openContextMenu(event, 'file', absolutePath, {
              absolutePath,
              fileName: item.fileName,
              isDirectory: item.fileType === 'folder',
            });
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
      absoluteActiveFilePath,
      handleDirectorySearchResultPress,
      handleFilePress,
      openContextMenu,
      resolveSearchResultPath,
      selectedFilePath,
      theme.colors.textSecondary,
    ]
  );

  const renderGitStatusIcon = React.useCallback(
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

  const renderGitFileSubtitle = React.useCallback(
    (file: GitFileStatus) => {
      const pathPart = file.filePath || t('files.projectRoot');
      const parts = [pathPart];
      const lineChanges: string[] = [];
      if (file.linesAdded > 0) lineChanges.push(`+${file.linesAdded}`);
      if (file.linesRemoved > 0) lineChanges.push(`-${file.linesRemoved}`);
      if (lineChanges.length > 0) {
        parts.push(lineChanges.join(' '));
      }
      return parts.join(' • ');
    },
    []
  );

  const hasGitChanges =
    (gitStatusFiles?.totalStaged || 0) > 0 || (gitStatusFiles?.totalUnstaged || 0) > 0;

  const isGitBusy = isLoadingGit || gitCommandBusy;
  const filesListHeader = React.useMemo(() => {
    if (searchQuery.trim()) {
      return <Text style={styles.sectionLabel}>Search</Text>;
    }
    if (tree.length > 0) {
      return <Text style={styles.sectionLabel}>Project</Text>;
    }
    return null;
  }, [searchQuery, tree.length]);
  const gitListRows = React.useMemo(() => {
    const rows: GitListRow[] = [];

    if (visibleStagedGitRows.length > 0) {
      rows.push({
        type: 'section',
        key: 'section-staged',
        title: t('files.stagedChanges', { count: gitStatusFiles?.stagedFiles.length ?? 0 }),
        tone: 'success',
      });
      rows.push(
        ...visibleStagedGitRows.map(row => ({
          type: 'node' as const,
          key: row.key,
          node: row.node,
          depth: row.depth,
        }))
      );
    }

    if (visibleUnstagedGitRows.length > 0) {
      rows.push({
        type: 'section',
        key: 'section-unstaged',
        title: t('files.unstagedChanges', { count: gitStatusFiles?.unstagedFiles.length ?? 0 }),
        tone: 'warning',
      });
      rows.push(
        ...visibleUnstagedGitRows.map(row => ({
          type: 'node' as const,
          key: row.key,
          node: row.node,
          depth: row.depth,
        }))
      );
    }

    return rows;
  }, [
    gitStatusFiles?.stagedFiles.length,
    gitStatusFiles?.unstagedFiles.length,
    visibleStagedGitRows,
    visibleUnstagedGitRows,
  ]);
  const renderGitRow = React.useCallback(
    ({ item }: { item: GitListRow }) => {
      if (item.type === 'section') {
        const sectionColor =
          item.tone === 'success' ? theme.colors.success : theme.colors.warning;
        return (
          <View
            style={[
              styles.gitSectionHeader,
              { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.divider },
            ]}
          >
            <Text style={[styles.gitSectionTitle, { color: sectionColor }]}>{item.title}</Text>
          </View>
        );
      }

      const { node, depth } = item;
      const expanded = isGitNodeExpanded(node);
      const absolutePath = resolveFileAbsolutePath(node.path);
      const selected =
        node.type === 'file' &&
        (selectedFilePath === absolutePath || absoluteActiveFilePath === absolutePath);

      return (
        <Pressable
          onPress={() => {
            if (node.type === 'directory') {
              toggleGitNode(node);
            } else if (node.status) {
              setSelectedFilePath(absolutePath);
              onOpenFile(absolutePath);
            }
          }}
          // @ts-ignore web
          onContextMenu={(event: any) => {
            openContextMenu(event, 'git', node.path, {
              absolutePath,
              fileName: node.name,
              isDirectory: node.type === 'directory',
              isStaged: node.section === 'staged',
              status: node.status?.status,
              section: node.section,
            });
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
          <View style={{ flex: 1 }}>
            <Text style={styles.rowLabel} numberOfLines={1}>
              {node.name}
            </Text>
            {node.status ? (
              <Text style={styles.rowMeta} numberOfLines={1}>
                {renderGitFileSubtitle(node.status)}
              </Text>
            ) : null}
          </View>
          {node.status ? renderGitStatusIcon(node.status) : null}
        </Pressable>
      );
    },
    [
      absoluteActiveFilePath,
      isGitNodeExpanded,
      onOpenFile,
      openContextMenu,
      renderGitFileSubtitle,
      renderGitStatusIcon,
      resolveFileAbsolutePath,
      selectedFilePath,
      theme.colors.divider,
      theme.colors.success,
      theme.colors.surface,
      theme.colors.textSecondary,
      theme.colors.warning,
      toggleGitNode,
    ]
  );

  const renderFooter = React.useCallback(() => {
    const pathText =
      activeTool === 'files'
        ? selectedFilePath ?? absoluteActiveFilePath ?? rootPath
        : gitStatusFiles?.branch || t('files.detachedHead');

    return (
      <View style={styles.footer}>
        <Text style={styles.footerLabel}>{activeTool === 'files' ? t('common.files') : 'Git'}</Text>
        <Text style={styles.footerPath} numberOfLines={2}>
          {pathText}
        </Text>
      </View>
    );
  }, [activeTool, absoluteActiveFilePath, gitStatusFiles?.branch, rootPath, selectedFilePath]);

  const renderGitToolbar = React.useCallback(() => {
    if (activeTool !== 'git' || !gitStatusFiles) return null;
    const canStageAll = (gitStatusFiles?.totalUnstaged || 0) > 0;
    const canUnstageAll = (gitStatusFiles?.totalStaged || 0) > 0;
    const canDiscardAll =
      (gitStatusFiles?.totalUnstaged || 0) > 0 || (gitStatusFiles?.totalStaged || 0) > 0;
    const canStash =
      (gitStatusFiles?.totalUnstaged || 0) > 0 || (gitStatusFiles?.totalStaged || 0) > 0;

    return (
      <View style={styles.toolbar}>
        <Pressable
          onPress={() => void refreshGitData()}
          style={[styles.toolbarButton, isGitBusy && styles.toolbarButtonDisabled]}
          disabled={isGitBusy}
        >
          <Ionicons name="refresh-outline" size={14} color={theme.colors.text} />
          <Text style={styles.toolbarButtonText}>Refresh</Text>
        </Pressable>
        <Pressable
          onPress={() => void handleGitAction('stage-all')}
          disabled={isGitBusy || !canStageAll}
          style={[styles.toolbarButton, (isGitBusy || !canStageAll) && styles.toolbarButtonDisabled]}
        >
          <Ionicons name="git-branch-outline" size={14} color={theme.colors.text} />
          <Text style={styles.toolbarButtonText}>Stage All</Text>
        </Pressable>
        <Pressable
          onPress={() => void handleGitAction('unstage-all')}
          disabled={isGitBusy || !canUnstageAll}
          style={[styles.toolbarButton, (isGitBusy || !canUnstageAll) && styles.toolbarButtonDisabled]}
        >
          <Ionicons name="git-compare-outline" size={14} color={theme.colors.text} />
          <Text style={styles.toolbarButtonText}>Unstage All</Text>
        </Pressable>
        <Pressable
          onPress={() => void handleGitAction('discard-all')}
          disabled={isGitBusy || !canDiscardAll}
          style={[styles.toolbarButton, (isGitBusy || !canDiscardAll) && styles.toolbarButtonDisabled]}
        >
          <Ionicons name="trash-outline" size={14} color={theme.colors.text} />
          <Text style={styles.toolbarButtonText}>Discard</Text>
        </Pressable>
        <Pressable
          onPress={() => void handleGitAction('commit')}
          disabled={isGitBusy}
          style={[styles.toolbarButton, isGitBusy && styles.toolbarButtonDisabled]}
        >
          <Ionicons name="git-commit-outline" size={14} color={theme.colors.text} />
          <Text style={styles.toolbarButtonText}>Commit</Text>
        </Pressable>
        <Pressable
          onPress={() => void handleGitAction('fetch')}
          disabled={isGitBusy}
          style={[styles.toolbarButton, isGitBusy && styles.toolbarButtonDisabled]}
        >
          <Ionicons name="cloud-download-outline" size={14} color={theme.colors.text} />
          <Text style={styles.toolbarButtonText}>Fetch</Text>
        </Pressable>
        <Pressable
          onPress={() => void handleGitAction('pull')}
          disabled={isGitBusy}
          style={[styles.toolbarButton, isGitBusy && styles.toolbarButtonDisabled]}
        >
          <Ionicons name="cloud-download-outline" size={14} color={theme.colors.text} />
          <Text style={styles.toolbarButtonText}>Pull</Text>
        </Pressable>
        <Pressable
          onPress={() => void handleGitAction('sync')}
          disabled={isGitBusy}
          style={[styles.toolbarButton, isGitBusy && styles.toolbarButtonDisabled]}
        >
          <Ionicons name="refresh-outline" size={14} color={theme.colors.text} />
          <Text style={styles.toolbarButtonText}>Sync</Text>
        </Pressable>
        <Pressable
          onPress={() => void handleGitAction('push')}
          disabled={isGitBusy}
          style={[styles.toolbarButton, isGitBusy && styles.toolbarButtonDisabled]}
        >
          <Ionicons name="cloud-upload-outline" size={14} color={theme.colors.text} />
          <Text style={styles.toolbarButtonText}>Push</Text>
        </Pressable>
        <Pressable
          onPress={() => void handleGitAction('stash')}
          disabled={isGitBusy || !canStash}
          style={[styles.toolbarButton, (isGitBusy || !canStash) && styles.toolbarButtonDisabled]}
        >
          <Ionicons name="archive-outline" size={14} color={theme.colors.text} />
          <Text style={styles.toolbarButtonText}>Stash</Text>
        </Pressable>
        <Pressable
          onPress={() => void handleGitAction('stash-pop')}
          disabled={isGitBusy}
          style={[styles.toolbarButton, isGitBusy && styles.toolbarButtonDisabled]}
        >
          <Ionicons name="archive" size={14} color={theme.colors.text} />
          <Text style={styles.toolbarButtonText}>Stash Pop</Text>
        </Pressable>
      </View>
    );
    }, [
    activeTool,
    gitStatusFiles,
    gitStatusFiles?.totalStaged,
    gitStatusFiles?.totalUnstaged,
    isGitBusy,
    handleGitAction,
    refreshGitData,
    theme.colors.text,
  ]);

  const gitListHeader = React.useMemo(
    () => (
      <>
        <View
          style={[
            styles.gitCard,
            {
              backgroundColor: theme.colors.surfaceHigh,
              borderColor: theme.colors.divider,
            },
          ]}
        >
          <View
            style={[
              styles.gitCardHeader,
              { backgroundColor: theme.colors.surfaceHigh, borderBottomColor: theme.colors.divider },
            ]}
          >
            <View style={styles.gitBranchRow}>
              <Octicons name="git-branch" size={15} color={theme.colors.textSecondary} />
              <Text style={[styles.gitBranchText, { color: theme.colors.text }]}>
                {gitStatusFiles?.branch || t('files.detachedHead')}
              </Text>
            </View>
            <Text style={[styles.gitSummaryText, { color: theme.colors.textSecondary }]}>
              {gitStatusFiles
                ? t('files.summary', {
                    staged: gitStatusFiles.totalStaged,
                    unstaged: gitStatusFiles.totalUnstaged,
                  })
                : isLoadingGit
                  ? t('common.loading')
                  : t('files.notRepo')}
            </Text>
          </View>
        </View>
        {renderGitToolbar()}
      </>
    ),
    [
      gitStatusFiles,
      isLoadingGit,
      renderGitToolbar,
      theme.colors.divider,
      theme.colors.surfaceHigh,
      theme.colors.text,
      theme.colors.textSecondary,
    ]
  );

  const renderContextMenu = React.useCallback(() => {
    if (!contextMenu) return null;

    const items: Array<{
      key: string;
      icon:
        | keyof typeof Ionicons.glyphMap
        | keyof typeof Octicons.glyphMap;
      label: string;
      danger?: boolean;
      action: string;
    }> = [];

    if (contextMenu.kind === 'file') {
      if (!contextMenu.isDirectory) {
        items.push({ key: 'open', icon: 'open-outline', label: 'Open', action: 'open' });
      }
      items.push({ key: 'copy', icon: 'copy-outline', label: 'Copy Path', action: 'copy-path' });
    } else if (contextMenu.kind === 'git') {
      if (!contextMenu.isDirectory) {
        items.push({ key: 'open', icon: 'open-outline', label: 'Open', action: 'open' });
      }
      if (contextMenu.isStaged) {
        items.push({ key: 'unstage', icon: 'arrow-undo', label: 'Unstage', action: 'unstage' });
      } else {
        items.push({ key: 'stage', icon: 'arrow-up', label: 'Stage', action: 'stage' });
      }
      items.push({
        key: 'discard',
        icon: 'trash-outline',
        label: 'Discard',
        danger: true,
        action: 'discard',
      });
      items.push({
        key: 'copy',
        icon: 'copy-outline',
        label: 'Copy Path',
        action: 'copy-path',
      });
    }

    const handleAction = (action: string) => {
      if (action === 'open') {
        if (contextMenu.kind === 'file') {
          setSelectedFilePath(contextMenu.absolutePath);
          onOpenFile(contextMenu.absolutePath);
        } else {
          void handleGitAction('open', contextMenu.path);
        }
      } else if (action === 'copy-path') {
        void handleCopyPath(contextMenu.absolutePath);
      } else if (action === 'stage') {
        void handleGitAction('stage', contextMenu.path);
      } else if (action === 'unstage') {
        void handleGitAction('unstage', contextMenu.path);
      } else if (action === 'discard') {
        void handleGitAction('discard', contextMenu.path, {
          section: contextMenu.section,
          status: contextMenu.status,
        });
      }
      closeContextMenu();
    };

    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1400;
    const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 700;
    const menuWidth = 220;
    const left = Math.max(8, Math.min(contextMenu.x + 10, viewportWidth - menuWidth - 8));
    const top = Math.max(8, Math.min(contextMenu.y + 10, viewportHeight - 220 - 8));

    return (
        <WebPortal>
        <Pressable
          onPress={closeContextMenu}
          // @ts-ignore web
          onContextMenu={(event: any) => {
            event.preventDefault?.();
            closeContextMenu();
          }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 999,
          }}
        />
        <View
          style={[
            styles.contextMenu,
            {
              position: 'fixed',
              left,
              top,
              zIndex: 1000,
            },
          ]}
        >
          <View
            style={[
              styles.contextMenuItem,
              { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.divider },
            ]}
          >
            <Ionicons name="information-circle-outline" size={16} color={theme.colors.textSecondary} />
            <Text numberOfLines={1} style={[styles.contextMenuText, { maxWidth: 170 }]}>
              {contextMenu.fileName ?? contextMenu.path}
            </Text>
          </View>
          {items.map(item => (
            <Pressable key={item.key} onPress={() => handleAction(item.action)} style={styles.contextMenuItem}>
              <Ionicons
                name={item.icon as any}
                size={16}
                color={item.danger ? theme.colors.textDestructive : theme.colors.text}
              />
              <Text style={item.danger ? styles.contextMenuTextDanger : styles.contextMenuText}>
                {item.label}
              </Text>
            </Pressable>
          ))}
          <View style={styles.contextMenuDivider} />
          <Pressable onPress={closeContextMenu} style={styles.contextMenuItem}>
            <Text style={styles.contextMenuText}>{t('common.cancel')}</Text>
          </Pressable>
        </View>
      </WebPortal>
    );
  }, [
    contextMenu,
    handleCopyPath,
    handleGitAction,
    onOpenFile,
    theme.colors.divider,
    theme.colors.text,
    theme.colors.textDestructive,
    theme.colors.textSecondary,
    closeContextMenu,
    styles.contextMenu,
    styles.contextMenuDivider,
    styles.contextMenuItem,
    styles.contextMenuText,
    styles.contextMenuTextDanger,
  ]);

  const resizeHandleStyle: ViewStyle = {
    position: 'absolute',
    top: 0,
    left: 0,
    width: liveCollapsed ? SIDEBAR_COLLAPSED_WIDTH : 12,
    height: '100%',
    backgroundColor:
      liveCollapsed || isDragging || isHovering ? 'rgba(0, 0, 0, 0.08)' : 'transparent',
    borderRightWidth: !liveCollapsed && (isDragging || isHovering) ? 1 : 0,
    borderRightColor: 'rgba(0, 0, 0, 0.12)',
    borderLeftWidth: liveCollapsed ? 1 : 0,
    borderLeftColor: 'rgba(0, 0, 0, 0.08)',
  };

  return (
    <View style={[styles.container, { width: panelWidth, position: 'relative', overflow: 'hidden' }]}>
      {!liveCollapsed ? (
        <>
          <View style={styles.header}>
            <View style={styles.headerTop}>
              <Octicons name="repo" size={16} color={theme.colors.textSecondary} />
              <View style={styles.headerTitleWrap}>
                <Text style={styles.headerTitle}>{activeTool === 'files' ? t('common.files') : 'Git'}</Text>
                <Text style={styles.headerSubtitle} numberOfLines={1}>
                  {getProjectLabel(rootPath)}
                </Text>
              </View>
              <View style={styles.headerActions}>
                <Pressable
                  hitSlop={8}
                  onPress={() => {
                    if (activeTool === 'files') {
                      directoryCache.delete(cacheKey(sessionId, rootPath));
                      void loadDirectory(rootPath);
                    } else {
                      void refreshGitData();
                    }
                  }}
                  style={styles.headerButton}
                >
                  <Ionicons name="refresh-outline" size={16} color={theme.colors.textSecondary} />
                </Pressable>
                {activeTool === 'files' ? (
                  <Pressable
                    hitSlop={8}
                    onPress={() => {
                      const target = absoluteActiveFilePath || selectedFilePath;
                      if (target) {
                        void revealPath(target);
                      }
                    }}
                    style={styles.headerButton}
                  >
                    <Ionicons name="locate-outline" size={16} color={theme.colors.textSecondary} />
                  </Pressable>
                ) : null}
                <Pressable
                  hitSlop={8}
                  onPress={() => router.push(`/session/${sessionId}/files`)}
                  style={styles.headerButton}
                >
                  <Ionicons name="open-outline" size={16} color={theme.colors.textSecondary} />
                </Pressable>
              </View>
            </View>
            <View style={styles.toolTabs}>
              <Pressable
                onPress={() => {
                  setActiveTool('files');
                  setSearchQuery('');
                  setSearchResults([]);
                  setContextMenu(null);
                }}
                style={[
                  styles.toolTab,
                  activeTool === 'files' ? styles.toolTabActive : styles.toolTabInactive,
                ]}
              >
                <Text
                  style={[
                    styles.toolTabText,
                    activeTool === 'files' ? styles.toolTabTextActive : styles.toolTabTextInactive,
                  ]}
                >
                  Files
                </Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setActiveTool('git');
                  setSearchQuery('');
                  setContextMenu(null);
                }}
                style={[
                  styles.toolTab,
                  activeTool === 'git' ? styles.toolTabActive : styles.toolTabInactive,
                ]}
              >
                <Text
                  style={[
                    styles.toolTabText,
                    activeTool === 'git' ? styles.toolTabTextActive : styles.toolTabTextInactive,
                  ]}
                >
                  Git
                </Text>
              </Pressable>
            </View>
            {activeTool === 'files' ? (
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder={t('files.searchPlaceholder')}
                placeholderTextColor={theme.colors.textSecondary}
                style={styles.searchInput}
              />
            ) : null}
          </View>

          {activeTool === 'files' ? (
            searchQuery.trim() ? (
              isSearching ? (
                <View style={styles.treeScroll}>
                  {filesListHeader}
                  <View style={styles.emptyWrap}>
                    <Ionicons name="search-outline" size={20} color={theme.colors.textSecondary} />
                    <Text style={styles.emptyText}>{t('files.searching')}</Text>
                  </View>
                </View>
              ) : searchResults.length === 0 ? (
                <View style={styles.treeScroll}>
                  {filesListHeader}
                  <View style={styles.emptyWrap}>
                    <Ionicons name="search-outline" size={20} color={theme.colors.textSecondary} />
                    <Text style={styles.emptyText}>{t('files.noFilesFound')}</Text>
                  </View>
                </View>
              ) : (
                <FlatList
                  style={styles.treeScroll}
                  contentContainerStyle={styles.treeContent}
                  data={searchResults}
                  keyExtractor={item => item.fullPath}
                  renderItem={renderSearchResultRow}
                  ListHeaderComponent={filesListHeader}
                  initialNumToRender={40}
                  maxToRenderPerBatch={24}
                  windowSize={10}
                  keyboardShouldPersistTaps="handled"
                />
              )
            ) : isLoadingRoot ? (
              <View style={[styles.treeScroll, styles.emptyWrap]}>
                <Ionicons name="sync-outline" size={20} color={theme.colors.textSecondary} />
                <Text style={styles.emptyText}>{t('common.loading')}</Text>
              </View>
            ) : tree.length === 0 ? (
              <View style={[styles.treeScroll, styles.emptyWrap]}>
                <Octicons name="file-directory" size={20} color={theme.colors.textSecondary} />
                <Text style={styles.emptyText}>{t('files.noFilesInProject')}</Text>
              </View>
            ) : (
              <FlatList
                style={styles.treeScroll}
                contentContainerStyle={styles.treeContent}
                data={visibleFileRows}
                keyExtractor={item => item.key}
                renderItem={renderFileTreeRow}
                ListHeaderComponent={filesListHeader}
                initialNumToRender={60}
                maxToRenderPerBatch={32}
                windowSize={12}
                keyboardShouldPersistTaps="handled"
              />
            )
          ) : isLoadingGit ? (
            <View style={styles.treeScroll}>
              {gitListHeader}
              <View style={styles.emptyWrap}>
                <Ionicons name="sync-outline" size={20} color={theme.colors.textSecondary} />
                <Text style={styles.emptyText}>{t('common.loading')}</Text>
              </View>
            </View>
          ) : !gitStatusFiles ? (
            <View style={styles.treeScroll}>
              {gitListHeader}
              <View style={styles.emptyWrap}>
                <Octicons name="git-branch" size={20} color={theme.colors.textSecondary} />
                <Text style={styles.emptyText}>{t('files.notRepo')}</Text>
                <Text style={[styles.emptyText, { marginTop: 0 }]}>{t('files.notUnderGit')}</Text>
              </View>
            </View>
          ) : !hasGitChanges ? (
            <View style={styles.treeScroll}>
              {gitListHeader}
              <View style={styles.emptyWrap}>
                <Octicons name="check-circle" size={20} color={theme.colors.success} />
                <Text style={styles.emptyText}>{t('files.noChanges')}</Text>
              </View>
            </View>
          ) : (
            <FlatList
              style={styles.treeScroll}
              contentContainerStyle={styles.treeContent}
              data={gitListRows}
              keyExtractor={item => item.key}
              renderItem={renderGitRow}
              ListHeaderComponent={gitListHeader}
              initialNumToRender={60}
              maxToRenderPerBatch={32}
              windowSize={12}
              keyboardShouldPersistTaps="handled"
            />
          )}

          {renderFooter()}
        </>
      ) : null}

      {renderContextMenu()}

      <Pressable
        onPress={() => {
          if (liveCollapsed) {
            commitSidebarLayout(defaultWidth, false);
          }
        }}
        // @ts-ignore web
        onDoubleClick={() => {
          const nextCollapsed = !liveCollapsed;
          commitSidebarLayout(nextCollapsed ? liveWidth : defaultWidth, nextCollapsed);
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
