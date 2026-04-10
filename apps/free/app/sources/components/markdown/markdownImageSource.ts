import { resolveSessionMarkdownAssetPath, sanitizeMarkdownPathCandidate } from '@/utils/sessionFilePath';

function isRemoteImageUri(source: string): boolean {
  return /^https?:\/\//i.test(source);
}

function isDataImageUri(source: string): boolean {
  return /^data:image\//i.test(source);
}

export function isLocalMarkdownImageSource(source: string): boolean {
  const trimmed = sanitizeMarkdownPathCandidate(source);
  if (!trimmed) return false;
  if (isRemoteImageUri(trimmed) || isDataImageUri(trimmed)) return false;
  return (
    trimmed.startsWith('file://') ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('./') ||
    trimmed.startsWith('../') ||
    !/^[a-z][a-z0-9+.-]*:/i.test(trimmed)
  );
}

export function resolveLocalMarkdownImagePath(
  source: string,
  markdownFilePath?: string
): string | null {
  const sanitizedSource = sanitizeMarkdownPathCandidate(source);
  if (!isLocalMarkdownImageSource(source)) return null;
  if (sanitizedSource.startsWith('~/')) return null;
  if (sanitizedSource.startsWith('file://') || sanitizedSource.startsWith('/')) {
    return resolveSessionMarkdownAssetPath(markdownFilePath ?? '/', source);
  }
  if (!markdownFilePath) return null;
  return resolveSessionMarkdownAssetPath(markdownFilePath, source);
}
