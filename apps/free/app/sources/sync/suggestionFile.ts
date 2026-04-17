/**
 * Suggestion file search functionality using ripgrep for fast file discovery
 * Provides fuzzy search capabilities with in-memory caching for autocomplete suggestions
 */

import Fuse from 'fuse.js';
import { sessionRipgrep } from './ops';
import { AsyncLock } from '@/utils/lock';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';
import { sessionLogger } from '@/sync/appTraceStore';

const logger = new Logger('app/sync/suggestionFile');

export interface FileItem {
  fileName: string;
  filePath: string;
  fullPath: string;
  fileType: 'file' | 'folder';
}

interface SearchOptions {
  limit?: number;
  threshold?: number;
}

interface SessionCache {
  files: FileItem[];
  fuse: Fuse<FileItem> | null;
  lastRefresh: number;
  refreshLock: AsyncLock;
}

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase();
}

function stripDirectorySlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function stripFileExtension(value: string): string {
  const normalized = stripDirectorySlash(value);
  const lastDot = normalized.lastIndexOf('.');
  return lastDot > 0 ? normalized.slice(0, lastDot) : normalized;
}

function computeSearchPriority(item: FileItem, rawQuery: string, fuseScore: number): number {
  const query = normalizeSearchText(rawQuery);
  const fileName = normalizeSearchText(item.fileName);
  const fullPath = normalizeSearchText(item.fullPath);
  const normalizedFileName = stripDirectorySlash(fileName);
  const normalizedFullPath = stripDirectorySlash(fullPath);
  const baseName = stripFileExtension(normalizedFileName);
  const pathSegments = normalizedFullPath.split('/').filter(Boolean);
  const querySegments = query.split('/').filter(Boolean);

  let priority = fuseScore;

  if (normalizedFileName === query) priority -= 1000;
  if (baseName === query) priority -= 900;
  if (normalizedFullPath === query) priority -= 800;
  if (normalizedFileName.startsWith(query)) priority -= 300;
  if (baseName.startsWith(query)) priority -= 240;
  if (pathSegments.some(segment => segment === query)) priority -= 220;
  if (pathSegments.some(segment => stripFileExtension(segment) === query)) priority -= 200;
  if (pathSegments.some(segment => segment.startsWith(query))) priority -= 120;
  if (normalizedFullPath.includes(`/${query}`)) priority -= 80;

  if (querySegments.length > 1) {
    const joinedQuery = querySegments.join('/');
    if (normalizedFullPath.includes(joinedQuery)) priority -= 90;
    if (querySegments.every(segment => pathSegments.some(pathSegment => pathSegment.includes(segment)))) {
      priority -= 60;
    }
  }

  if (item.fileType === 'file') priority -= 5;
  priority += normalizedFullPath.length * 0.0001;

  return priority;
}

class FileSearchCache {
  private sessions = new Map<string, SessionCache>();
  private cacheTimeout = 5 * 60 * 1000; // 5 minutes

  private getOrCreateSessionCache(sessionId: string): SessionCache {
    let cache = this.sessions.get(sessionId);
    if (!cache) {
      cache = {
        files: [],
        fuse: null,
        lastRefresh: 0,
        refreshLock: new AsyncLock(),
      };
      this.sessions.set(sessionId, cache);
    }
    return cache;
  }

  private initializeFuse(cache: SessionCache) {
    if (cache.files.length === 0) {
      cache.fuse = null;
      return;
    }

    const fuseOptions = {
      keys: [
        { name: 'fileName', weight: 0.7 }, // Higher weight for file/directory name
        { name: 'fullPath', weight: 0.3 }, // Lower weight for full path
      ],
      threshold: 0.3,
      includeScore: true,
      shouldSort: true,
      minMatchCharLength: 1,
      ignoreLocation: true,
      useExtendedSearch: true,
      // Allow fuzzy matching on slashes for directories
      distance: 100,
    };

    cache.fuse = new Fuse(cache.files, fuseOptions);
  }

  private async ensureCacheValid(sessionId: string): Promise<void> {
    const cache = this.getOrCreateSessionCache(sessionId);
    const now = Date.now();

    // Check if cache needs refresh
    if (now - cache.lastRefresh <= this.cacheTimeout && cache.files.length > 0) {
      return; // Cache is still valid
    }

    // Use lock to prevent concurrent refreshes for this session
    await cache.refreshLock.inLock(async () => {
      // Double-check after acquiring lock
      const currentTime = Date.now();
      if (currentTime - cache.lastRefresh < 1000) {
        // Skip if refreshed within last second
        return;
      }

      const log = sessionLogger(logger, sessionId);
      log.debug('FileSearchCache: Refreshing file cache');

      const response = await sessionRipgrep(
        sessionId,
        ['--files', '--follow', '--hidden', '--no-ignore', '--glob', '!.git'],
        undefined
      );

      if (!response.success || !response.stdout) {
        log.error(
          'FileSearchCache: Failed to fetch files',
          response.error ? new Error(response.error) : undefined
        );
        log.debug('FileSearchCache: Ripgrep fetch failed', {
          success: response.success,
          exitCode: response.exitCode,
          error: response.error,
          stdoutLength: response.stdout?.length ?? 0,
          stderrLength: response.stderr?.length ?? 0,
        });
        return;
      }

      if (response.truncated || response.stdoutTruncated || response.stderrTruncated) {
        log.warn('FileSearchCache: Using truncated ripgrep file list', {
          exitCode: response.exitCode,
          stdoutLength: response.stdout.length,
          stderrLength: response.stderr?.length ?? 0,
          stdoutTruncated: response.stdoutTruncated,
          stderrTruncated: response.stderrTruncated,
        });
      }

      // Parse the output into file items
      const lastCompleteLineBreak = response.stdout.lastIndexOf('\n');
      const safeStdout =
        response.stdoutTruncated && !response.stdout.endsWith('\n') && lastCompleteLineBreak >= 0
          ? response.stdout.slice(0, lastCompleteLineBreak)
          : response.stdout;
      const filePaths = safeStdout.split('\n').filter(path => path.trim().length > 0);

      // Clear existing files
      cache.files = [];

      // Add all files
      filePaths.forEach(path => {
        const parts = path.split('/');
        const fileName = parts[parts.length - 1] || path;
        const filePath = parts.slice(0, -1).join('/') || '';

        cache.files.push({
          fileName,
          filePath: filePath ? filePath + '/' : '',
          fullPath: path,
          fileType: 'file' as const,
        });
      });

      // Add unique directories with trailing slash
      const directories = new Set<string>();
      filePaths.forEach(path => {
        const parts = path.split('/');
        for (let i = 1; i <= parts.length - 1; i++) {
          const dirPath = parts.slice(0, i).join('/');
          if (dirPath) {
            directories.add(dirPath);
          }
        }
      });

      directories.forEach(dirPath => {
        const parts = dirPath.split('/');
        const dirName = parts[parts.length - 1] + '/'; // Add trailing slash to directory name
        const parentPath = parts.slice(0, -1).join('/');

        cache.files.push({
          fileName: dirName,
          filePath: parentPath ? parentPath + '/' : '',
          fullPath: dirPath + '/', // Add trailing slash to full path
          fileType: 'folder',
        });
      });

      cache.lastRefresh = Date.now();
      this.initializeFuse(cache);

      logger.debug(
        `FileSearchCache: Cached ${cache.files.length} files and directories for session ${sessionId}`
      );
    });
  }

  async search(sessionId: string, query: string, options: SearchOptions = {}): Promise<FileItem[]> {
    await this.ensureCacheValid(sessionId);
    const cache = this.getOrCreateSessionCache(sessionId);

    if (!cache.fuse || cache.files.length === 0) {
      return [];
    }

    const { limit = 10, threshold = 0.3 } = options;

    // If query is empty, return most recently modified files
    if (!query || query.trim().length === 0) {
      return cache.files.slice(0, limit);
    }

    // Perform fuzzy search
    const searchOptions = {
      limit,
      threshold,
    };

    const deduped = new Map<string, { item: FileItem; priority: number }>();

    const results = cache.fuse.search(query, searchOptions);
    for (const result of results) {
      const priority = computeSearchPriority(result.item, query, result.score ?? 1);
      const existing = deduped.get(result.item.fullPath);
      if (!existing || priority < existing.priority) {
        deduped.set(result.item.fullPath, { item: result.item, priority });
      }
    }

    return [...deduped.values()]
      .sort((a, b) => a.priority - b.priority)
      .slice(0, limit)
      .map(result => result.item);
  }

  getAllFiles(sessionId: string): FileItem[] {
    const cache = this.sessions.get(sessionId);
    return cache ? [...cache.files] : [];
  }

  clearCache(sessionId?: string): void {
    if (sessionId) {
      this.sessions.delete(sessionId);
    } else {
      this.sessions.clear();
    }
  }
}

// Export singleton instance
export const fileSearchCache = new FileSearchCache();

// Main export: search files with fuzzy matching
export async function searchFiles(
  sessionId: string,
  query: string,
  options: SearchOptions = {}
): Promise<FileItem[]> {
  return fileSearchCache.search(sessionId, query, options);
}

export function invalidateSessionFileSearchCache(sessionId: string): void {
  fileSearchCache.clearCache(sessionId);
}
