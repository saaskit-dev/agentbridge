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
import { sessionAbort, sessionBash, sessionListDirectory, type DirectoryEntry } from '@/sync/ops';
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

type ContextMenuKind = 'file' | 'git' | 'git-toolbar';

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

type InlineNotice = {
  tone: 'success' | 'error' | 'info';
  message: string;
};

type GitNetworkOperation = 'fetch' | 'pull' | 'push' | 'sync';

type GitNetworkTask = {
  id: string;
  type: GitNetworkOperation;
  label: string;
  state: 'queued' | 'running';
  cancelRequested: boolean;
  enqueuedAt: number;
};

const GIT_DEFAULT_TIMEOUT_MS = 120_000;
const GIT_NETWORK_TIMEOUT_MS = 600_000;

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

type GitFileBuckets = {
  tracked: GitFileStatus[];
  untracked: GitFileStatus[];
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
  toolbarButtonPrimary: {
    backgroundColor: '#3B82F6',
    borderColor: '#3B82F6',
  },
  toolbarButtonTextPrimary: {
    color: '#FFFFFF',
  },
  gitToolbarCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  gitToolbarCompactTitle: {
    fontSize: 12,
    ...Typography.default('semiBold'),
  },
  gitToolbarCompactActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  gitNetworkTaskBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  gitNetworkTaskText: {
    flex: 1,
    fontSize: 11,
    ...Typography.default('semiBold'),
  },
  gitNetworkTaskActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  gitNetworkTaskAction: {
    minHeight: 22,
    borderRadius: 6,
    paddingHorizontal: 8,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gitNetworkTaskActionText: {
    fontSize: 10,
    ...Typography.default('semiBold'),
  },
  gitToolbarCompactAction: {
    minHeight: 24,
    borderRadius: 6,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 4,
  },
  gitToolbarCompactActionText: {
    fontSize: 11,
    ...Typography.default('semiBold'),
  },
  gitStageToggle: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  gitSelectToggle: {
    width: 18,
    height: 18,
    borderRadius: 5,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  gitCommitDock: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 10,
    gap: 8,
  },
  gitCommitInput: {
    height: 34,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    ...Typography.default(),
    fontSize: 12,
  },
  gitCommitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  gitCommitButton: {
    minWidth: 108,
    minHeight: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
  },
  gitCommitButtonText: {
    fontSize: 12,
    ...Typography.default('semiBold'),
  },
  gitBranchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  gitBranchBarText: {
    fontSize: 11,
    ...Typography.default('semiBold'),
  },
  gitFetchButton: {
    minHeight: 24,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gitFetchButtonText: {
    fontSize: 11,
    ...Typography.default('semiBold'),
  },
  inlineNoticeWrap: {
    position: 'absolute',
    top: 10,
    left: 12,
    right: 12,
    zIndex: 1200,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  inlineNoticeText: {
    flex: 1,
    fontSize: 12,
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

function matchesGitPath(candidate: string, targetPath: string): boolean {
  return candidate === targetPath || candidate.startsWith(`${targetPath}/`);
}

function cloneGitFile(file: GitFileStatus, overrides?: Partial<GitFileStatus>): GitFileStatus {
  return {
    ...file,
    ...overrides,
  };
}

function dedupeGitFiles(files: GitFileStatus[]): GitFileStatus[] {
  const map = new Map<string, GitFileStatus>();
  for (const file of files) {
    map.set(file.fullPath, file);
  }
  return Array.from(map.values()).sort((a, b) => a.fullPath.localeCompare(b.fullPath));
}

function recalcGitTotals(status: GitStatusFiles): GitStatusFiles {
  const stagedFiles = dedupeGitFiles(status.stagedFiles);
  const unstagedFiles = dedupeGitFiles(status.unstagedFiles);
  return {
    ...status,
    stagedFiles,
    unstagedFiles,
    totalStaged: stagedFiles.length,
    totalUnstaged: unstagedFiles.length,
  };
}

function optimisticallyStagePath(
  status: GitStatusFiles | null,
  targetPath: string
): GitStatusFiles | null {
  if (!status) return status;
  const moved = status.unstagedFiles.filter(file => matchesGitPath(file.fullPath, targetPath));
  if (moved.length === 0) return status;

  const movedToStaged = moved.map(file =>
    cloneGitFile(file, {
      isStaged: true,
      status: file.status === 'untracked' ? 'added' : file.status,
    })
  );

  return recalcGitTotals({
    ...status,
    stagedFiles: [...status.stagedFiles, ...movedToStaged],
    unstagedFiles: status.unstagedFiles.filter(file => !matchesGitPath(file.fullPath, targetPath)),
  });
}

function optimisticallyUnstagePath(
  status: GitStatusFiles | null,
  targetPath: string
): GitStatusFiles | null {
  if (!status) return status;
  const moved = status.stagedFiles.filter(file => matchesGitPath(file.fullPath, targetPath));
  if (moved.length === 0) return status;

  const existingUnstaged = new Set(
    status.unstagedFiles
      .filter(file => matchesGitPath(file.fullPath, targetPath))
      .map(file => file.fullPath)
  );
  const movedToUnstaged = moved
    .filter(file => !existingUnstaged.has(file.fullPath))
    .map(file =>
      cloneGitFile(file, {
        isStaged: false,
        status: file.status === 'added' ? 'untracked' : file.status,
      })
    );

  return recalcGitTotals({
    ...status,
    stagedFiles: status.stagedFiles.filter(file => !matchesGitPath(file.fullPath, targetPath)),
    unstagedFiles: [...status.unstagedFiles, ...movedToUnstaged],
  });
}

function optimisticallyDiscardPath(
  status: GitStatusFiles | null,
  targetPath: string,
  section: 'staged' | 'unstaged'
): GitStatusFiles | null {
  if (!status) return status;
  if (section === 'staged') {
    return recalcGitTotals({
      ...status,
      stagedFiles: status.stagedFiles.filter(file => !matchesGitPath(file.fullPath, targetPath)),
      unstagedFiles: status.unstagedFiles.filter(file => !matchesGitPath(file.fullPath, targetPath)),
    });
  }
  return recalcGitTotals({
    ...status,
    unstagedFiles: status.unstagedFiles.filter(file => !matchesGitPath(file.fullPath, targetPath)),
  });
}

function optimisticallyStageAll(status: GitStatusFiles | null): GitStatusFiles | null {
  if (!status) return status;
  const movedToStaged = status.unstagedFiles.map(file =>
    cloneGitFile(file, {
      isStaged: true,
      status: file.status === 'untracked' ? 'added' : file.status,
    })
  );
  return recalcGitTotals({
    ...status,
    stagedFiles: [...status.stagedFiles, ...movedToStaged],
    unstagedFiles: [],
  });
}

function optimisticallyUnstageAll(status: GitStatusFiles | null): GitStatusFiles | null {
  if (!status) return status;
  const movedToUnstaged = status.stagedFiles.map(file =>
    cloneGitFile(file, {
      isStaged: false,
      status: file.status === 'added' ? 'untracked' : file.status,
    })
  );
  return recalcGitTotals({
    ...status,
    stagedFiles: [],
    unstagedFiles: [...status.unstagedFiles, ...movedToUnstaged],
  });
}

function optimisticallyDiscardAll(status: GitStatusFiles | null): GitStatusFiles | null {
  if (!status) return status;
  return {
    ...status,
    stagedFiles: [],
    unstagedFiles: [],
    totalStaged: 0,
    totalUnstaged: 0,
  };
}

function optimisticallyCommit(status: GitStatusFiles | null): GitStatusFiles | null {
  if (!status) return status;
  return {
    ...status,
    stagedFiles: [],
    totalStaged: 0,
  };
}

const FileTreeRow = React.memo(
  ({
    node,
    depth,
    selected,
    expanded,
    absolutePath,
    onToggleDirectory,
    onFilePress,
    onOpenContextMenu,
  }: {
    node: FileTreeNode;
    depth: number;
    selected: boolean;
    expanded: boolean;
    absolutePath: string;
    onToggleDirectory: (node: FileTreeNode) => void;
    onFilePress: (path: string) => void;
    onOpenContextMenu: (event: any, kind: ContextMenuKind, path: string, options?: Partial<ContextMenuState>) => void;
  }) => {
    const { theme } = useUnistyles();

    return (
      <Pressable
        onPress={() => {
          if (node.type === 'directory') {
            onToggleDirectory(node);
          } else {
            onFilePress(node.path);
          }
        }}
        // @ts-ignore web
        onContextMenu={(event: any) => {
          onOpenContextMenu(event, 'file', node.path, {
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
          <Octicons name="file-directory" size={15} color="#007AFF" style={{ marginRight: 8 }} />
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
  }
);

const GitTreeRow = React.memo(
  ({
    node,
    depth,
    selected,
    absolutePath,
    expanded,
    onToggleNode,
    onOpenFile,
    onSelectFile,
    onOpenContextMenu,
    renderGitFileSubtitle,
    renderGitStatusIcon,
    onHandleGitAction,
    isChecked,
    onToggleChecked,
  }: {
    node: GitTreeNode;
    depth: number;
    selected: boolean;
    absolutePath: string;
    expanded: boolean;
    onToggleNode: (node: GitTreeNode) => void;
    onOpenFile: (path: string) => void;
    onSelectFile: (path: string) => void;
    onOpenContextMenu: (event: any, kind: ContextMenuKind, path: string, options?: Partial<ContextMenuState>) => void;
    renderGitFileSubtitle: (file: GitFileStatus) => string;
    renderGitStatusIcon: (file: GitFileStatus) => React.ReactNode;
    onHandleGitAction: (
      type: string,
      relativePath?: string,
      options?: { section?: 'staged' | 'unstaged'; status?: GitFileStatus['status'] }
    ) => void;
    isChecked: boolean;
    onToggleChecked: (path: string) => void;
  }) => {
    const { theme } = useUnistyles();
    const isStaged = Boolean(node.status?.isStaged);

    return (
      <Pressable
        onPress={() => {
          if (node.type === 'directory') {
            onToggleNode(node);
          } else if (node.status) {
            onSelectFile(absolutePath);
            onOpenFile(absolutePath);
          }
        }}
        // @ts-ignore web
        onContextMenu={(event: any) => {
          onOpenContextMenu(event, 'git', node.path, {
            absolutePath,
            fileName: node.name,
            isDirectory: node.type === 'directory',
            isStaged,
            status: node.status?.status,
            section: isStaged ? 'staged' : 'unstaged',
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
          <Octicons name="file-directory" size={15} color="#007AFF" style={{ marginRight: 8 }} />
        ) : (
          <>
            <Pressable
              onPress={(event: any) => {
                event?.stopPropagation?.();
                onToggleChecked(node.path);
              }}
              style={[
                styles.gitSelectToggle,
                {
                  borderColor: isChecked ? '#3B82F6' : theme.colors.divider,
                  backgroundColor: isChecked ? '#3B82F6' : theme.colors.surface,
                },
              ]}
            >
              {isChecked ? <Ionicons name="checkmark" size={11} color="#FFFFFF" /> : null}
            </Pressable>
            <View style={{ marginRight: 8 }}>
              <FileIcon fileName={node.name} size={16} />
            </View>
          </>
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
        {node.status ? (
          <>
            {renderGitStatusIcon(node.status)}
            {node.type === 'file' ? (
              <Pressable
                onPress={(event: any) => {
                  event?.stopPropagation?.();
                  onHandleGitAction(isStaged ? 'unstage' : 'stage', node.path, {
                    section: isStaged ? 'staged' : 'unstaged',
                    status: node.status?.status,
                  });
                }}
                style={[
                  styles.gitStageToggle,
                  {
                    borderColor: isStaged ? '#3B82F6' : theme.colors.divider,
                    backgroundColor: isStaged ? '#3B82F6' : theme.colors.surface,
                  },
                ]}
              >
                {isStaged ? <Ionicons name="checkmark" size={12} color="#FFFFFF" /> : null}
              </Pressable>
            ) : null}
          </>
        ) : null}
      </Pressable>
    );
  }
);

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
  const [selectedGitPaths, setSelectedGitPaths] = React.useState<Set<string>>(new Set());
  const [gitCommandBusy, setGitCommandBusy] = React.useState(false);
  const [gitNetworkBusy, setGitNetworkBusy] = React.useState(false);
  const [gitNetworkTasks, setGitNetworkTasks] = React.useState<GitNetworkTask[]>([]);
  const [gitCommitMessage, setGitCommitMessage] = React.useState('');
  const [inlineNotice, setInlineNotice] = React.useState<InlineNotice | null>(null);
  const [isSearching, setIsSearching] = React.useState(false);
  const [isDragging, setIsDragging] = React.useState(false);
  const [isHovering, setIsHovering] = React.useState(false);
  const lastFilePressRef = React.useRef<{ path: string; at: number } | null>(null);
  const inlineNoticeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const gitRefreshInFlightRef = React.useRef<Promise<void> | null>(null);
  const gitNetworkTasksRef = React.useRef<GitNetworkTask[]>([]);
  const gitNetworkRunningRef = React.useRef(false);
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

  const showInlineNotice = React.useCallback((message: string, tone: InlineNotice['tone'] = 'info') => {
    if (inlineNoticeTimerRef.current) {
      clearTimeout(inlineNoticeTimerRef.current);
    }
    setInlineNotice({ tone, message });
    inlineNoticeTimerRef.current = setTimeout(() => {
      setInlineNotice(null);
      inlineNoticeTimerRef.current = null;
    }, 2000);
  }, []);

  React.useEffect(
    () => () => {
      if (inlineNoticeTimerRef.current) {
        clearTimeout(inlineNoticeTimerRef.current);
      }
    },
    []
  );

  const mutateGitNetworkTasks = React.useCallback(
    (updater: (current: GitNetworkTask[]) => GitNetworkTask[]) => {
      const next = updater(gitNetworkTasksRef.current);
      gitNetworkTasksRef.current = next;
      setGitNetworkTasks(next);
      return next;
    },
    []
  );

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
    showInlineNotice(t('files.pathCopied'), 'success');
  }, [activeFilePath, resolveFileAbsolutePath, selectedFilePath, showInlineNotice]);

  const refreshGitData = React.useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    if (!silent) {
      setIsLoadingGit(true);
    }
    if (gitRefreshInFlightRef.current) {
      try {
        await gitRefreshInFlightRef.current;
      } finally {
        if (!silent) {
          setIsLoadingGit(false);
        }
      }
      return;
    }

    const refreshPromise = (async () => {
      const result = await getGitStatusFiles(sessionId);
      setGitStatusFiles(result);
    })();
    gitRefreshInFlightRef.current = refreshPromise;
    try {
      await refreshPromise;
    } finally {
      gitRefreshInFlightRef.current = null;
      if (!silent) {
        setIsLoadingGit(false);
      }
    }
  }, [sessionId]);

  const runGitCommand = React.useCallback(
    async (
      command: string,
      options?: {
        refresh?: boolean;
        timeoutMs?: number;
        blockUi?: boolean;
        optimisticUpdate?: (current: GitStatusFiles | null) => GitStatusFiles | null;
        suppressErrorNotice?: boolean;
      }
    ) => {
      const target = options?.refresh ?? true;
      const timeoutMs = options?.timeoutMs ?? GIT_DEFAULT_TIMEOUT_MS;
      const blockUi = options?.blockUi ?? true;
      const optimisticUpdate = options?.optimisticUpdate;
      const suppressErrorNotice = options?.suppressErrorNotice ?? false;
      if (blockUi) {
        setGitCommandBusy(true);
      }
      if (optimisticUpdate) {
        setGitStatusFiles(current => optimisticUpdate(current));
      }
      try {
        const result = await sessionBash(sessionId, {
          command,
          cwd: rootPath,
          timeout: timeoutMs,
        });

        if (!result.success || result.exitCode !== 0) {
          const output = result.stderr || result.stdout || 'Git command failed';
          throw new Error(output.trim() || 'Git command failed');
        }

        if (target) {
          await refreshGitData({ silent: true });
        }
        return true;
      } catch (error) {
        logger.error('git command failed', toError(error), { sessionId, command });
        if (optimisticUpdate) {
          void refreshGitData({ silent: true });
        }
        if (!suppressErrorNotice) {
          showInlineNotice(String(toError(error)), 'error');
        }
        return false;
      } finally {
        if (blockUi) {
          setGitCommandBusy(false);
        }
      }
    },
    [refreshGitData, rootPath, sessionId, showInlineNotice]
  );

  const runGitStage = React.useCallback(
    async (path: string) => {
      const targetPath = path.startsWith('/') ? path : `./${path}`;
      return runGitCommand(`git add --all -- ${shellQuote(targetPath)}`, {
        optimisticUpdate: current => optimisticallyStagePath(current, path),
      });
    },
    [runGitCommand]
  );

  const runGitUnstage = React.useCallback(
    async (path: string) => {
      const targetPath = path.startsWith('/') ? path : `./${path}`;
      return runGitCommand(`git restore --staged -- ${shellQuote(targetPath)}`, {
        optimisticUpdate: current => optimisticallyUnstagePath(current, path),
      });
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
      return runGitCommand(command, {
        optimisticUpdate: current => optimisticallyDiscardPath(current, path, section),
      });
    },
    [runGitCommand]
  );

  const executeGitNetworkTask = React.useCallback(
    async (task: GitNetworkTask) => {
      const isCancelled = () =>
        Boolean(gitNetworkTasksRef.current.find(candidate => candidate.id === task.id)?.cancelRequested);
      const failIfNeeded = (message: string) => {
        if (!isCancelled()) {
          showInlineNotice(message, 'error');
        }
      };

      if (task.type === 'fetch') {
        const success = await runGitCommand('git fetch --all --prune', {
          timeoutMs: GIT_NETWORK_TIMEOUT_MS,
          blockUi: false,
          suppressErrorNotice: true,
        });
        if (!success) failIfNeeded('Fetch failed.');
        if (success && !isCancelled()) showInlineNotice('Fetch complete.', 'success');
        return;
      }

      if (task.type === 'pull') {
        const success = await runGitCommand('git pull', {
          timeoutMs: GIT_NETWORK_TIMEOUT_MS,
          blockUi: false,
          suppressErrorNotice: true,
        });
        if (!success) failIfNeeded('Pull failed.');
        if (success && !isCancelled()) showInlineNotice('Pull complete.', 'success');
        return;
      }

      if (task.type === 'push') {
        const success = await runGitCommand('git push', {
          timeoutMs: GIT_NETWORK_TIMEOUT_MS,
          blockUi: false,
          suppressErrorNotice: true,
        });
        if (!success) failIfNeeded('Push failed.');
        if (success && !isCancelled()) showInlineNotice('Push complete.', 'success');
        return;
      }

      const pullResult = await runGitCommand('git pull --rebase', {
        refresh: false,
        timeoutMs: GIT_NETWORK_TIMEOUT_MS,
        blockUi: false,
        suppressErrorNotice: true,
      });
      if (!pullResult) {
        failIfNeeded('Sync failed during pull.');
        return;
      }
      if (isCancelled()) return;

      const pushResult = await runGitCommand('git push', {
        refresh: false,
        timeoutMs: GIT_NETWORK_TIMEOUT_MS,
        blockUi: false,
        suppressErrorNotice: true,
      });
      if (!pushResult) {
        failIfNeeded('Sync failed during push.');
        return;
      }
      if (isCancelled()) return;

      await refreshGitData({ silent: true });
      if (!isCancelled()) {
        showInlineNotice('Sync complete.', 'success');
      }
    },
    [refreshGitData, runGitCommand, showInlineNotice]
  );

  const processGitNetworkQueue = React.useCallback(async () => {
    if (gitNetworkRunningRef.current) return;
    const nextTask = gitNetworkTasksRef.current.find(task => task.state === 'queued');
    if (!nextTask) return;

    gitNetworkRunningRef.current = true;
    setGitNetworkBusy(true);
    mutateGitNetworkTasks(current =>
      current.map(task => (task.id === nextTask.id ? { ...task, state: 'running' } : task))
    );

    try {
      await executeGitNetworkTask(nextTask);
    } finally {
      mutateGitNetworkTasks(current => current.filter(task => task.id !== nextTask.id));
      gitNetworkRunningRef.current = false;
      setGitNetworkBusy(false);
      void processGitNetworkQueue();
    }
  }, [executeGitNetworkTask, mutateGitNetworkTasks]);

  const enqueueGitNetworkTask = React.useCallback(
    (type: GitNetworkOperation) => {
      const labelByType: Record<GitNetworkOperation, string> = {
        fetch: 'Fetch',
        pull: 'Pull',
        push: 'Push',
        sync: 'Sync',
      };
      const task: GitNetworkTask = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type,
        label: labelByType[type],
        state: 'queued',
        cancelRequested: false,
        enqueuedAt: Date.now(),
      };
      mutateGitNetworkTasks(current => [...current, task]);
      showInlineNotice(`${task.label} queued.`, 'info');
      void processGitNetworkQueue();
    },
    [mutateGitNetworkTasks, processGitNetworkQueue, showInlineNotice]
  );

  const cancelRunningGitNetworkTask = React.useCallback(async () => {
    const running = gitNetworkTasksRef.current.find(task => task.state === 'running');
    if (!running) return;
    mutateGitNetworkTasks(current =>
      current.map(task => (task.id === running.id ? { ...task, cancelRequested: true } : task))
    );
    try {
      await sessionAbort(sessionId);
      showInlineNotice(`${running.label} cancel requested.`, 'info');
    } catch (error) {
      logger.error('failed to cancel git network task', toError(error), { sessionId });
      showInlineNotice('Failed to cancel running task.', 'error');
    }
  }, [mutateGitNetworkTasks, sessionId, showInlineNotice]);

  const clearQueuedGitNetworkTasks = React.useCallback(() => {
    const queuedCount = gitNetworkTasksRef.current.filter(task => task.state === 'queued').length;
    if (queuedCount === 0) return;
    mutateGitNetworkTasks(current => current.filter(task => task.state !== 'queued'));
    showInlineNotice(`Cleared ${queuedCount} queued task${queuedCount > 1 ? 's' : ''}.`, 'info');
  }, [mutateGitNetworkTasks, showInlineNotice]);

  const selectedGitPathList = React.useMemo(
    () => Array.from(selectedGitPaths).sort((a, b) => a.localeCompare(b)),
    [selectedGitPaths]
  );

  const runGitStageSelected = React.useCallback(async () => {
    if (selectedGitPathList.length === 0) return;
    const targets = selectedGitPathList
      .map(path => (path.startsWith('/') ? path : `./${path}`))
      .map(path => shellQuote(path))
      .join(' ');
    const success = await runGitCommand(`git add --all -- ${targets}`, {
      optimisticUpdate: current =>
        selectedGitPathList.reduce<GitStatusFiles | null>(
          (acc, path) => optimisticallyStagePath(acc, path),
          current
        ),
    });
    if (success) {
      setSelectedGitPaths(new Set());
      showInlineNotice('Staged selected files.', 'success');
    }
  }, [runGitCommand, selectedGitPathList, showInlineNotice]);

  const runGitUnstageSelected = React.useCallback(async () => {
    if (selectedGitPathList.length === 0) return;
    const targets = selectedGitPathList
      .map(path => (path.startsWith('/') ? path : `./${path}`))
      .map(path => shellQuote(path))
      .join(' ');
    const success = await runGitCommand(`git restore --staged -- ${targets}`, {
      optimisticUpdate: current =>
        selectedGitPathList.reduce<GitStatusFiles | null>(
          (acc, path) => optimisticallyUnstagePath(acc, path),
          current
        ),
    });
    if (success) {
      setSelectedGitPaths(new Set());
      showInlineNotice('Unstaged selected files.', 'success');
    }
  }, [runGitCommand, selectedGitPathList, showInlineNotice]);

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
      const isWriteAction =
        type !== 'open' &&
        type !== 'copy' &&
        type !== 'fetch' &&
        type !== 'pull' &&
        type !== 'push' &&
        type !== 'sync';
      if (gitNetworkBusy && isWriteAction) {
        showInlineNotice('Git network operation in progress. Please wait.', 'info');
        return;
      }
      switch (type) {
        case 'fetch': {
          enqueueGitNetworkTask('fetch');
          break;
        }
        case 'sync': {
          enqueueGitNetworkTask('sync');
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
            showInlineNotice(output, 'error');
            return;
          }

          if (!(stashList.stdout || '').trim()) {
            showInlineNotice('There are no stashed changes.', 'info');
            return;
          }

          await runGitCommand('git stash pop');
          break;
        }
        case 'switch-branch': {
          const raw = await Modal.prompt('Switch branch', 'Enter branch name (local or remote)', {
            placeholder: 'e.g. main or feature/my-branch',
            confirmText: 'Switch',
          });
          if (raw === null) {
            return;
          }
          const branchName = raw.trim();
          if (!branchName) {
            showInlineNotice('Branch name is required.', 'error');
            return;
          }
          const escaped = shellQuote(branchName);
          const switchCommand = `git switch ${escaped} || git switch --track origin/${escaped}`;
          await runGitCommand(switchCommand);
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
          await runGitCommand(`git commit -m ${shellQuote(message.trim())}`, {
            optimisticUpdate: current => optimisticallyCommit(current),
          });
          break;
        }
        case 'pull': {
          enqueueGitNetworkTask('pull');
          break;
        }
        case 'push': {
          enqueueGitNetworkTask('push');
          break;
        }
        case 'stage-all': {
          await runGitCommand('git add --all', {
            optimisticUpdate: current => optimisticallyStageAll(current),
          });
          break;
        }
        case 'stage-selected': {
          await runGitStageSelected();
          break;
        }
        case 'unstage-all': {
          await runGitCommand('git restore --staged -- .', {
            optimisticUpdate: current => optimisticallyUnstageAll(current),
          });
          break;
        }
        case 'unstage-selected': {
          await runGitUnstageSelected();
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
          setGitStatusFiles(current => optimisticallyDiscardAll(current));
          await runGitCommand('git reset --hard', { refresh: false });
          await runGitCommand('git clean -fd', { refresh: false });
          await refreshGitData({ silent: true });
          break;
        }
        default:
          break;
      }
      closeContextMenu();
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
      runGitStageSelected,
      runGitUnstageSelected,
      showInlineNotice,
      gitNetworkBusy,
      enqueueGitNetworkTask,
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

  const gitFileBuckets = React.useMemo<GitFileBuckets>(() => {
    const byPath = new Map<string, GitFileStatus>();
    const stagedFiles = gitStatusFiles?.stagedFiles ?? [];
    const unstagedFiles = gitStatusFiles?.unstagedFiles ?? [];

    for (const file of stagedFiles) {
      byPath.set(file.fullPath, { ...file, isStaged: true });
    }

    for (const file of unstagedFiles) {
      const existing = byPath.get(file.fullPath);
      if (existing) {
        byPath.set(file.fullPath, {
          ...existing,
          status: file.status === 'untracked' ? existing.status : file.status,
          linesAdded: Math.max(existing.linesAdded, file.linesAdded),
          linesRemoved: Math.max(existing.linesRemoved, file.linesRemoved),
        });
      } else {
        byPath.set(file.fullPath, { ...file, isStaged: false });
      }
    }

    const tracked: GitFileStatus[] = [];
    const untracked: GitFileStatus[] = [];
    for (const file of byPath.values()) {
      if (file.status === 'untracked' && !file.isStaged) {
        untracked.push(file);
      } else {
        tracked.push(file);
      }
    }

    tracked.sort((a, b) => a.fullPath.localeCompare(b.fullPath));
    untracked.sort((a, b) => a.fullPath.localeCompare(b.fullPath));

    return { tracked, untracked };
  }, [gitStatusFiles?.stagedFiles, gitStatusFiles?.unstagedFiles]);

  const selectableGitPaths = React.useMemo(
    () => new Set([...gitFileBuckets.tracked, ...gitFileBuckets.untracked].map(file => file.fullPath)),
    [gitFileBuckets.tracked, gitFileBuckets.untracked]
  );

  React.useEffect(() => {
    setSelectedGitPaths(current => {
      const next = new Set(Array.from(current).filter(path => selectableGitPaths.has(path)));
      return next.size === current.size ? current : next;
    });
  }, [selectableGitPaths]);

  const toggleGitPathSelection = React.useCallback((path: string) => {
    setSelectedGitPaths(current => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const trackedGitTree = React.useMemo(
    () => buildGitTree(gitFileBuckets.tracked, 'staged'),
    [gitFileBuckets.tracked]
  );
  const untrackedGitTree = React.useMemo(
    () => buildGitTree(gitFileBuckets.untracked, 'unstaged'),
    [gitFileBuckets.untracked]
  );
  const visibleFileRows = React.useMemo(
    () => flattenVisibleFileTree(tree, expandedPaths),
    [expandedPaths, tree]
  );
  const visibleTrackedGitRows = React.useMemo(
    () => flattenVisibleGitTree(trackedGitTree, gitExpandedPaths),
    [gitExpandedPaths, trackedGitTree]
  );
  const visibleUntrackedGitRows = React.useMemo(
    () => flattenVisibleGitTree(untrackedGitTree, gitExpandedPaths),
    [gitExpandedPaths, untrackedGitTree]
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
        <FileTreeRow
          node={node}
          depth={depth}
          selected={selected}
          expanded={expanded}
          absolutePath={absolutePath}
          onToggleDirectory={handleToggleDirectory}
          onFilePress={handleFilePress}
          onOpenContextMenu={openContextMenu}
        />
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

  const runningGitNetworkTask = React.useMemo(
    () => gitNetworkTasks.find(task => task.state === 'running') ?? null,
    [gitNetworkTasks]
  );
  const queuedGitNetworkTaskCount = React.useMemo(
    () => gitNetworkTasks.filter(task => task.state === 'queued').length,
    [gitNetworkTasks]
  );
  const stagedPathSet = React.useMemo(
    () => new Set((gitStatusFiles?.stagedFiles ?? []).map(file => file.fullPath)),
    [gitStatusFiles?.stagedFiles]
  );
  const unstagedPathSet = React.useMemo(
    () => new Set((gitStatusFiles?.unstagedFiles ?? []).map(file => file.fullPath)),
    [gitStatusFiles?.unstagedFiles]
  );
  const selectedGitCount = selectedGitPathList.length;
  const canStageSelected = React.useMemo(
    () => selectedGitPathList.some(path => unstagedPathSet.has(path)),
    [selectedGitPathList, unstagedPathSet]
  );
  const canUnstageSelected = React.useMemo(
    () => selectedGitPathList.some(path => stagedPathSet.has(path)),
    [selectedGitPathList, stagedPathSet]
  );
  const isGitBusy = isLoadingGit || gitCommandBusy || gitNetworkBusy;
  const isGitNetworkActionBusy = isLoadingGit || gitNetworkBusy;
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

    if (visibleTrackedGitRows.length > 0) {
      rows.push({
        type: 'section',
        key: 'section-tracked',
        title: `Tracked (${gitFileBuckets.tracked.length})`,
        tone: 'success',
      });
      rows.push(
        ...visibleTrackedGitRows.map(row => ({
          type: 'node' as const,
          key: row.key,
          node: row.node,
          depth: row.depth,
        }))
      );
    }

    if (visibleUntrackedGitRows.length > 0) {
      rows.push({
        type: 'section',
        key: 'section-untracked',
        title: `Untracked (${gitFileBuckets.untracked.length})`,
        tone: 'warning',
      });
      rows.push(
        ...visibleUntrackedGitRows.map(row => ({
          type: 'node' as const,
          key: row.key,
          node: row.node,
          depth: row.depth,
        }))
      );
    }

    return rows;
  }, [
    gitFileBuckets.tracked.length,
    gitFileBuckets.untracked.length,
    visibleTrackedGitRows,
    visibleUntrackedGitRows,
  ]);
  const renderGitRow = React.useCallback(
    ({ item }: { item: GitListRow }) => {
      if (item.type === 'section') {
      const sectionColor =
          item.tone === 'success' ? theme.colors.textSecondary : theme.colors.warning;
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
      const isStaged = Boolean(node.status?.isStaged);

      return (
        <GitTreeRow
          node={node}
          depth={depth}
          selected={selected}
          absolutePath={absolutePath}
          expanded={expanded}
          onToggleNode={toggleGitNode}
          onOpenFile={onOpenFile}
          onSelectFile={setSelectedFilePath}
          onOpenContextMenu={openContextMenu}
          renderGitFileSubtitle={renderGitFileSubtitle}
          renderGitStatusIcon={renderGitStatusIcon}
          onHandleGitAction={(type, relativePath, options) => {
            void handleGitAction(type, relativePath, options);
          }}
          isChecked={node.type === 'file' ? selectedGitPaths.has(node.path) : false}
          onToggleChecked={toggleGitPathSelection}
        />
      );
    },
    [
      absoluteActiveFilePath,
      isGitNodeExpanded,
      onOpenFile,
      openContextMenu,
      handleGitAction,
      renderGitFileSubtitle,
      renderGitStatusIcon,
      resolveFileAbsolutePath,
      selectedFilePath,
      selectedGitPaths,
      theme.colors.warning,
      toggleGitPathSelection,
      toggleGitNode,
    ]
  );

  const renderFooter = React.useCallback(() => {
    if (activeTool !== 'files') {
      return null;
    }
    const pathText = selectedFilePath ?? absoluteActiveFilePath ?? rootPath;

    return (
      <View style={styles.footer}>
        <Text style={styles.footerLabel}>{t('common.files')}</Text>
        <Text style={styles.footerPath} numberOfLines={2}>
          {pathText}
        </Text>
      </View>
    );
  }, [activeTool, absoluteActiveFilePath, rootPath, selectedFilePath]);

  const renderGitToolbar = React.useCallback(() => {
    if (activeTool !== 'git' || !gitStatusFiles) return null;
    const canStageAll = (gitStatusFiles?.totalUnstaged || 0) > 0;
    const totalChanges = (gitStatusFiles?.totalStaged || 0) + (gitStatusFiles?.totalUnstaged || 0);
    const runningLabel = runningGitNetworkTask?.label ?? null;
    const taskBarLabel = runningLabel
      ? `${runningLabel} running`
      : queuedGitNetworkTaskCount > 0
        ? `${queuedGitNetworkTaskCount} queued`
        : null;

    return (
      <>
        <View style={[styles.gitToolbarCompact, { borderBottomColor: theme.colors.divider }]}>
          <Text style={[styles.gitToolbarCompactTitle, { color: theme.colors.textSecondary }]}>
            {totalChanges} Changes
          </Text>
          <View style={styles.gitToolbarCompactActions}>
            <Pressable
              onPress={() => {
                setSelectedGitPaths(new Set(selectableGitPaths));
                showInlineNotice('Selected all files.', 'info');
              }}
              disabled={isGitBusy || selectableGitPaths.size === 0}
              style={[
                styles.gitToolbarCompactAction,
                {
                  borderColor: theme.colors.divider,
                  backgroundColor: theme.colors.surface,
                },
                (isGitBusy || selectableGitPaths.size === 0) && styles.toolbarButtonDisabled,
              ]}
            >
              <Text style={[styles.gitToolbarCompactActionText, { color: theme.colors.textSecondary }]}>All</Text>
            </Pressable>
            <Pressable
              onPress={() => setSelectedGitPaths(new Set())}
              disabled={isGitBusy || selectedGitCount === 0}
              style={[
                styles.gitToolbarCompactAction,
                {
                  borderColor: theme.colors.divider,
                  backgroundColor: theme.colors.surface,
                },
                (isGitBusy || selectedGitCount === 0) && styles.toolbarButtonDisabled,
              ]}
            >
              <Text style={[styles.gitToolbarCompactActionText, { color: theme.colors.textSecondary }]}>Clear</Text>
            </Pressable>
            <Pressable
              onPress={() => void handleGitAction('stage-selected')}
              disabled={isGitBusy || !canStageSelected}
              style={[
                styles.gitToolbarCompactAction,
                {
                  borderColor: canStageSelected ? '#3B82F6' : theme.colors.divider,
                  backgroundColor: canStageSelected ? '#3B82F6' : theme.colors.surface,
                },
                (isGitBusy || !canStageSelected) && styles.toolbarButtonDisabled,
              ]}
            >
              <Text
                style={[
                  styles.gitToolbarCompactActionText,
                  { color: canStageSelected ? '#FFFFFF' : theme.colors.textSecondary },
                ]}
              >
                Stage Sel
              </Text>
            </Pressable>
            <Pressable
              onPress={() => void handleGitAction('unstage-selected')}
              disabled={isGitBusy || !canUnstageSelected}
              style={[
                styles.gitToolbarCompactAction,
                {
                  borderColor: canUnstageSelected ? '#3B82F6' : theme.colors.divider,
                  backgroundColor: canUnstageSelected ? '#3B82F6' : theme.colors.surface,
                },
                (isGitBusy || !canUnstageSelected) && styles.toolbarButtonDisabled,
              ]}
            >
              <Text
                style={[
                  styles.gitToolbarCompactActionText,
                  { color: canUnstageSelected ? '#FFFFFF' : theme.colors.textSecondary },
                ]}
              >
                Unstage Sel
              </Text>
            </Pressable>
            <Pressable
              onPress={() => void handleGitAction('stage-all')}
              disabled={isGitBusy || !canStageAll}
              style={[
                styles.gitToolbarCompactAction,
                {
                  borderColor: canStageAll ? '#3B82F6' : theme.colors.divider,
                  backgroundColor: canStageAll ? '#3B82F6' : theme.colors.surface,
                },
                (isGitBusy || !canStageAll) && styles.toolbarButtonDisabled,
              ]}
            >
              <Text
                style={[
                  styles.gitToolbarCompactActionText,
                  { color: canStageAll ? '#FFFFFF' : theme.colors.text },
                ]}
              >
                Stage All
              </Text>
            </Pressable>
            <Pressable
              onPress={(event: any) => {
                openContextMenu(event, 'git-toolbar', '__toolbar__', {
                  fileName: gitStatusFiles?.branch || 'Git actions',
                });
              }}
              disabled={isGitNetworkActionBusy}
              style={[
                styles.gitToolbarCompactAction,
                {
                  borderColor: theme.colors.divider,
                  backgroundColor: theme.colors.surface,
                },
                isGitNetworkActionBusy && styles.toolbarButtonDisabled,
              ]}
            >
              <Ionicons name="ellipsis-horizontal" size={14} color={theme.colors.text} />
            </Pressable>
          </View>
        </View>
        {taskBarLabel ? (
          <View
            style={[
              styles.gitNetworkTaskBar,
              {
                borderBottomColor: theme.colors.divider,
                backgroundColor: theme.colors.surfaceHigh,
              },
            ]}
          >
            <Text style={[styles.gitNetworkTaskText, { color: theme.colors.textSecondary }]}>
              {taskBarLabel}
            </Text>
            <View style={styles.gitNetworkTaskActions}>
              {runningGitNetworkTask ? (
                <Pressable
                  onPress={() => void cancelRunningGitNetworkTask()}
                  style={[
                    styles.gitNetworkTaskAction,
                    { borderColor: theme.colors.divider, backgroundColor: theme.colors.surface },
                  ]}
                >
                  <Text style={[styles.gitNetworkTaskActionText, { color: theme.colors.text }]}>Cancel</Text>
                </Pressable>
              ) : null}
              {queuedGitNetworkTaskCount > 0 ? (
                <Pressable
                  onPress={clearQueuedGitNetworkTasks}
                  style={[
                    styles.gitNetworkTaskAction,
                    { borderColor: theme.colors.divider, backgroundColor: theme.colors.surface },
                  ]}
                >
                  <Text style={[styles.gitNetworkTaskActionText, { color: theme.colors.textSecondary }]}>
                    Clear Queue
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : null}
      </>
    );
  }, [
    activeTool,
    gitStatusFiles,
    gitStatusFiles?.totalStaged,
    gitStatusFiles?.totalUnstaged,
    isGitBusy,
    selectableGitPaths,
    selectedGitCount,
    canStageSelected,
    canUnstageSelected,
    isGitNetworkActionBusy,
    runningGitNetworkTask,
    queuedGitNetworkTaskCount,
    handleGitAction,
    openContextMenu,
    showInlineNotice,
    cancelRunningGitNetworkTask,
    clearQueuedGitNetworkTasks,
    theme.colors.divider,
    theme.colors.surface,
    theme.colors.surfaceHigh,
    theme.colors.text,
    theme.colors.textSecondary,
  ]);

  const gitListHeader = React.useMemo(
    () => (
      <>
        {renderGitToolbar()}
      </>
    ),
    [renderGitToolbar]
  );

  const commitWithMessage = React.useCallback(async () => {
    const message = gitCommitMessage.trim();
    if (!message) {
      showInlineNotice('Please enter a commit message.', 'error');
      return;
    }
    const success = await runGitCommand(`git commit -m ${shellQuote(message)}`, {
      optimisticUpdate: current => optimisticallyCommit(current),
    });
    if (success) {
      setGitCommitMessage('');
      showInlineNotice('Commit created.', 'success');
    }
  }, [gitCommitMessage, runGitCommand, showInlineNotice]);

  const renderGitCommitDock = React.useCallback(() => {
    if (activeTool !== 'git' || !gitStatusFiles) return null;
    const canCommit = (gitStatusFiles.totalStaged || 0) > 0 && gitCommitMessage.trim().length > 0;
    const branchText = `${getProjectLabel(rootPath)} / ${gitStatusFiles.branch || t('files.detachedHead')}`;

    return (
      <View
        style={[
          styles.gitCommitDock,
          {
            borderTopColor: theme.colors.divider,
            backgroundColor: theme.colors.surface,
          },
        ]}
      >
        <View style={styles.gitBranchBar}>
          <Pressable
            onPress={() => void handleGitAction('switch-branch')}
            disabled={isGitNetworkActionBusy}
            style={isGitNetworkActionBusy ? styles.toolbarButtonDisabled : undefined}
          >
            <Text style={[styles.gitBranchBarText, { color: theme.colors.textSecondary }]} numberOfLines={1}>
              {branchText}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => void handleGitAction('fetch')}
            disabled={isGitNetworkActionBusy}
            style={[
              styles.gitFetchButton,
              {
                borderColor: theme.colors.divider,
                backgroundColor: theme.colors.surface,
              },
              isGitNetworkActionBusy && styles.toolbarButtonDisabled,
            ]}
          >
            <Text style={[styles.gitFetchButtonText, { color: theme.colors.text }]}>Fetch</Text>
          </Pressable>
        </View>
        <TextInput
          value={gitCommitMessage}
          onChangeText={setGitCommitMessage}
          placeholder="Enter commit message"
          placeholderTextColor={theme.colors.textSecondary}
          style={[
            styles.gitCommitInput,
            {
              borderColor: theme.colors.divider,
              backgroundColor: theme.colors.input.background,
              color: theme.colors.text,
            },
          ]}
        />
        <Pressable
          onPress={() => void commitWithMessage()}
          disabled={isGitBusy || !canCommit}
          style={[
            styles.gitCommitButton,
            {
              borderColor: '#3B82F6',
              backgroundColor: '#3B82F6',
              alignSelf: 'flex-end',
            },
            (isGitBusy || !canCommit) && styles.toolbarButtonDisabled,
          ]}
        >
          <Text style={[styles.gitCommitButtonText, { color: '#FFFFFF' }]}>Commit Tracked</Text>
        </Pressable>
      </View>
    );
  }, [
    activeTool,
    commitWithMessage,
    gitCommitMessage,
    gitStatusFiles,
    handleGitAction,
    isGitBusy,
    isGitNetworkActionBusy,
    rootPath,
    theme.colors.divider,
    theme.colors.input.background,
    theme.colors.surface,
    theme.colors.text,
    theme.colors.textSecondary,
  ]);

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
        items.push({
          key: 'unstage',
          icon: 'arrow-undo',
          label: contextMenu.isDirectory ? 'Unstage Folder' : 'Unstage',
          action: 'unstage',
        });
      } else {
        items.push({
          key: 'stage',
          icon: 'arrow-up',
          label: contextMenu.isDirectory ? 'Stage Folder' : 'Stage',
          action: 'stage',
        });
      }
      items.push({
        key: 'discard',
        icon: 'trash-outline',
        label: contextMenu.isDirectory ? 'Discard Folder' : 'Discard',
        danger: true,
        action: 'discard',
      });
      items.push({
        key: 'copy',
        icon: 'copy-outline',
        label: 'Copy Path',
        action: 'copy-path',
      });
    } else if (contextMenu.kind === 'git-toolbar') {
      items.push({ key: 'switch-branch', icon: 'git-branch-outline', label: 'Switch Branch', action: 'switch-branch' });
      items.push({ key: 'fetch', icon: 'cloud-download-outline', label: 'Fetch', action: 'fetch' });
      items.push({ key: 'sync', icon: 'refresh-outline', label: 'Sync', action: 'sync' });
      if (selectedGitCount > 0) {
        items.push({ key: 'stage-selected', icon: 'checkmark-circle-outline', label: 'Stage Selected', action: 'stage-selected' });
        items.push({ key: 'unstage-selected', icon: 'remove-circle-outline', label: 'Unstage Selected', action: 'unstage-selected' });
      }
      items.push({ key: 'stage-all', icon: 'git-branch-outline', label: 'Stage All', action: 'stage-all' });
      items.push({ key: 'unstage-all', icon: 'git-compare-outline', label: 'Unstage All', action: 'unstage-all' });
      items.push({ key: 'stash', icon: 'archive-outline', label: 'Stash', action: 'stash' });
      items.push({ key: 'stash-pop', icon: 'archive', label: 'Stash Pop', action: 'stash-pop' });
      items.push({ key: 'discard-all', icon: 'trash-outline', label: 'Discard All', danger: true, action: 'discard-all' });
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
      } else if (contextMenu.kind === 'git-toolbar') {
        void handleGitAction(action);
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
    selectedGitCount,
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
          {inlineNotice ? (
            <View
              style={[
                styles.inlineNoticeWrap,
                {
                  borderColor:
                    inlineNotice.tone === 'error'
                      ? theme.colors.textDestructive
                      : inlineNotice.tone === 'success'
                        ? theme.colors.success
                        : theme.colors.divider,
                  backgroundColor:
                    inlineNotice.tone === 'error'
                      ? `${theme.colors.textDestructive}1A`
                      : inlineNotice.tone === 'success'
                        ? `${theme.colors.success}1A`
                        : theme.colors.surfaceHigh,
                },
              ]}
            >
              <Ionicons
                name={
                  inlineNotice.tone === 'error'
                    ? 'alert-circle-outline'
                    : inlineNotice.tone === 'success'
                      ? 'checkmark-circle-outline'
                      : 'information-circle-outline'
                }
                size={14}
                color={
                  inlineNotice.tone === 'error'
                    ? theme.colors.textDestructive
                    : inlineNotice.tone === 'success'
                      ? theme.colors.success
                      : theme.colors.textSecondary
                }
              />
              <Text
                numberOfLines={1}
                style={[
                  styles.inlineNoticeText,
                  {
                    color:
                      inlineNotice.tone === 'error'
                        ? theme.colors.textDestructive
                        : inlineNotice.tone === 'success'
                          ? theme.colors.success
                          : theme.colors.textSecondary,
                  },
                ]}
              >
                {inlineNotice.message}
              </Text>
            </View>
          ) : null}
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
          ) : isLoadingGit && !gitStatusFiles ? (
            <View style={styles.treeScroll}>
              {gitListHeader}
              <View style={styles.emptyWrap}>
                <Ionicons name="sync-outline" size={20} color={theme.colors.textSecondary} />
                <Text style={styles.emptyText}>{t('common.loading')}</Text>
              </View>
              {renderGitCommitDock()}
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
              {renderGitCommitDock()}
            </View>
          ) : (
            <FlatList
              style={styles.treeScroll}
              contentContainerStyle={styles.treeContent}
              data={gitListRows}
              keyExtractor={item => item.key}
              renderItem={renderGitRow}
              ListHeaderComponent={gitListHeader}
              ListFooterComponent={renderGitCommitDock}
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
