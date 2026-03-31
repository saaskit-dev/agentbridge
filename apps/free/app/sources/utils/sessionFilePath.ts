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
