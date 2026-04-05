/**
 * Encode/decode absolute file paths passed in session file routes.
 * Uses UTF-8 under base64 so non-ASCII path segments (e.g. CJK) work; ASCII paths stay compatible.
 */

/**
 * POSIX dirname for absolute paths used by the daemon (macOS/Linux).
 */
export function dirnamePosix(p: string): string {
  const s = p.replace(/\/+$/, '');
  if (s === '' || s === '/') return '/';
  const lastSlash = s.lastIndexOf('/');
  if (lastSlash === -1) return '.';
  if (lastSlash === 0) return '/';
  return s.slice(0, lastSlash);
}

/**
 * Normalize a POSIX path by collapsing duplicate slashes and resolving `.` / `..`.
 */
export function normalizePosixPath(path: string): string {
  const isAbsolute = path.startsWith('/');
  const parts = path.split('/');
  const stack: string[] = [];

  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (stack.length > 0 && stack[stack.length - 1] !== '..') {
        stack.pop();
      } else if (!isAbsolute) {
        stack.push('..');
      }
      continue;
    }
    stack.push(part);
  }

  if (isAbsolute) return `/${stack.join('/')}` || '/';
  return stack.join('/') || '.';
}

/**
 * Trim common LLM-added wrappers around paths/URLs, e.g. quotes, angle brackets, trailing punctuation.
 */
export function sanitizeMarkdownPathCandidate(input: string): string {
  let s = input.trim();
  if (!s) return '';

  s = s.replace(/^['"`<(\[]+/, '');
  s = s.replace(/[>)}\]"'`,.;:!?]+$/, '');

  const fileUrlPrefix = 'file://';
  if (s.startsWith(fileUrlPrefix)) {
    const rest = s.slice(fileUrlPrefix.length).replace(/^\/+/, '/');
    return `${fileUrlPrefix}${rest}`;
  }

  return s;
}

/**
 * Remove URL query/hash parts before resolving a local filesystem target.
 */
export function stripMarkdownPathSuffixes(input: string): string {
  const s = sanitizeMarkdownPathCandidate(input);
  const hashIndex = s.indexOf('#');
  const queryIndex = s.indexOf('?');
  const cutIndex =
    hashIndex === -1 ? queryIndex : queryIndex === -1 ? hashIndex : Math.min(hashIndex, queryIndex);
  return cutIndex === -1 ? s : s.slice(0, cutIndex);
}

/**
 * Resolve a Markdown-relative asset path against the current session file path.
 */
export function resolveSessionMarkdownAssetPath(markdownFilePath: string, assetPath: string): string {
  const trimmed = stripMarkdownPathSuffixes(assetPath);
  if (!trimmed) return '';

  const fileUrlPrefix = 'file://';
  if (trimmed.startsWith(fileUrlPrefix)) {
    return normalizePosixPath(trimmed.slice(fileUrlPrefix.length));
  }
  if (trimmed.startsWith('/')) {
    return normalizePosixPath(trimmed);
  }

  const baseDir = dirnamePosix(markdownFilePath);
  return normalizePosixPath(`${baseDir}/${trimmed}`);
}

/**
 * Base64 (standard) of UTF-8 path bytes — safe for query string `path=` param.
 */
export function encodeSessionFilePathForRoute(absolutePath: string): string {
  const bytes = new TextEncoder().encode(absolutePath);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

/**
 * Decode path from `encodeSessionFilePathForRoute`; also accepts legacy ASCII-only btoa paths.
 */
export function decodeSessionFilePathFromRoute(encoded: string): string {
  if (!encoded) return '';
  try {
    const binary = atob(encoded);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      out[i] = binary.charCodeAt(i);
    }
    return new TextDecoder('utf-8', { fatal: false }).decode(out);
  } catch {
    return '';
  }
}

/**
 * Parent directory for "Up" in browse UI, only if still inside session cwd (daemon sandbox).
 */
export function parentPathWithinSessionRoot(currentPath: string, rootPath: string): string | null {
  const c = currentPath.replace(/\/+$/, '');
  const r = rootPath.replace(/\/+$/, '');
  if (c === r) return null;
  if (!c.startsWith(r + '/')) return null;
  const parent = dirnamePosix(c);
  if (parent === c) return null;
  if (parent.length < r.length) return null;
  if (parent !== r && !parent.startsWith(r + '/')) return null;
  return parent;
}

/** Alias for older call sites; same as {@link parentPathWithinSessionRoot}. */
export const parentPathWithinRoot = parentPathWithinSessionRoot;
