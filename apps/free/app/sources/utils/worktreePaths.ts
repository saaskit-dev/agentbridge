export function normalizeWorktreePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '');
}

export function getWorktreeProjectName(basePath: string): string {
  const segments = normalizeWorktreePath(basePath)
    .split('/')
    .filter(Boolean);
  return segments.at(-1) || 'project';
}

export function getWorktreeStorageRoot(basePath: string, homeDir: string): string {
  const normalizedHome = normalizeWorktreePath(homeDir);
  const projectName = getWorktreeProjectName(basePath);
  return `${normalizedHome}/free-worktree/${projectName}`;
}
