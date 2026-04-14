export type PreviewKind = 'text' | 'image' | 'table' | 'binary';

export function getPathExtension(path: string): string | null {
  const cleanPath = path.split('?')[0]?.split('#')[0] ?? path;
  const fileName = cleanPath.split('/').pop() ?? cleanPath;
  if (!fileName) return null;
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex < 0 || dotIndex === fileName.length - 1) {
    return null;
  }
  const ext = fileName.slice(dotIndex + 1).toLowerCase();
  return ext || null;
}

export function isMarkdownPreviewPath(path: string): boolean {
  const ext = getPathExtension(path);
  return ext === 'md' || ext === 'mdx' || ext === 'markdown';
}

export function isDelimitedTablePath(path: string): boolean {
  const ext = getPathExtension(path);
  return ext === 'csv' || ext === 'tsv';
}

export function getImageMimeType(path: string): string | null {
  switch (getPathExtension(path)) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'bmp':
      return 'image/bmp';
    case 'svg':
      return 'image/svg+xml';
    case 'ico':
      return 'image/x-icon';
    case 'heic':
      return 'image/heic';
    case 'heif':
      return 'image/heif';
    case 'avif':
      return 'image/avif';
    default:
      return null;
  }
}

export function isOpaqueBinaryFile(path: string): boolean {
  const ext = getPathExtension(path);
  const binaryExtensions = [
    'mp4',
    'avi',
    'mov',
    'wmv',
    'flv',
    'webm',
    'mp3',
    'wav',
    'flac',
    'aac',
    'ogg',
    'pdf',
    'doc',
    'docx',
    'xls',
    'xlsx',
    'ppt',
    'pptx',
    'zip',
    'tar',
    'gz',
    'rar',
    '7z',
    'exe',
    'dmg',
    'deb',
    'rpm',
    'woff',
    'woff2',
    'ttf',
    'otf',
    'db',
    'sqlite',
    'sqlite3',
  ];
  return ext ? binaryExtensions.includes(ext) : false;
}

export function getPreviewKind(path: string): PreviewKind {
  if (getImageMimeType(path)) return 'image';
  if (isDelimitedTablePath(path)) return 'table';
  return isOpaqueBinaryFile(path) ? 'binary' : 'text';
}

export function detectImageMimeType(path: string, bytes: Uint8Array): string | null {
  const byPath = getImageMimeType(path);
  if (byPath) return byPath;
  if (bytes.length >= 8 && matchesBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'image/png';
  }
  if (bytes.length >= 3 && matchesBytes(bytes, [0xff, 0xd8, 0xff])) {
    return 'image/jpeg';
  }
  if (bytes.length >= 6) {
    const ascii6 = bytesToAscii(bytes.slice(0, 6));
    if (ascii6 === 'GIF87a' || ascii6 === 'GIF89a') return 'image/gif';
  }
  if (
    bytes.length >= 12 &&
    bytesToAscii(bytes.slice(0, 4)) === 'RIFF' &&
    bytesToAscii(bytes.slice(8, 12)) === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return 'image/bmp';
  }
  if (bytes.length >= 4 && matchesBytes(bytes, [0x00, 0x00, 0x01, 0x00])) {
    return 'image/x-icon';
  }
  if (bytes.length >= 12 && bytesToAscii(bytes.slice(4, 8)) === 'ftyp') {
    const brand = bytesToAscii(bytes.slice(8, 12));
    if (brand === 'avif') return 'image/avif';
    if (brand === 'heic' || brand === 'heix' || brand === 'hevc' || brand === 'hevx') {
      return 'image/heic';
    }
    if (brand === 'mif1' || brand === 'msf1') return 'image/heif';
  }

  const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(0, 512)).trimStart();
  if ((head.startsWith('<svg') || head.startsWith('<?xml')) && /<svg[\s>]/i.test(head)) {
    return 'image/svg+xml';
  }

  return null;
}

function matchesBytes(bytes: Uint8Array, expected: number[]): boolean {
  return expected.every((value, index) => bytes[index] === value);
}

function bytesToAscii(bytes: Uint8Array): string {
  return String.fromCharCode(...bytes);
}
