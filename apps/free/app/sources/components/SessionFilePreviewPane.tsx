import { Octicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import * as React from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { ImagePreviewModal } from '@/components/ImagePreviewModal';
import { FileIcon } from '@/components/FileIcon';
import { layout } from '@/components/layout';
import { MarkdownView } from '@/components/markdown/MarkdownView';
import { SimpleSyntaxHighlighter } from '@/components/SimpleSyntaxHighlighter';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { decodeBase64, looksLikeBinaryBytes } from '@/encryption/base64';
import { Modal } from '@/modal';
import { sessionBash, sessionReadFile } from '@/sync/ops';
import { storage } from '@/sync/storage';
import { t } from '@/text';
import { downloadBase64File } from '@/utils/fileDownload';
import {
  detectImageMimeType,
  getImageMimeType,
  getPathExtension,
  getPreviewKind,
  isMarkdownPreviewPath,
  type PreviewKind,
} from '@/utils/filePreview';
import { Logger, toError } from '@saaskit-dev/agentbridge/telemetry';

const logger = new Logger('app/components/SessionFilePreviewPane');

interface FileContent {
  content: string;
  encoding: 'utf8' | 'base64';
  isBinary: boolean;
  truncated?: boolean;
  previewKind: PreviewKind;
  mimeType?: string | null;
}

type FileErrorKind =
  | 'permission'
  | 'directory'
  | 'too-large'
  | 'special'
  | 'broken-symlink'
  | 'generic';

interface FileErrorState {
  kind: FileErrorKind;
  message: string;
}

type PreviewCacheEntry = {
  loadedAt: number;
  fileContent: FileContent | null;
  diffContent: string | null;
  fileSizeBytes: number | null;
  error: FileErrorState | null;
};

const previewCache = new Map<string, PreviewCacheEntry>();
const MAX_TEXT_PREVIEW_BYTES = 256 * 1024;
const MAX_IMAGE_PREVIEW_BYTES = 12 * 1024 * 1024;

function cacheKey(sessionId: string, filePath: string) {
  return `${sessionId}:${filePath}`;
}

function getCachedPreview(sessionId: string, filePath: string): PreviewCacheEntry | null {
  const entry = previewCache.get(cacheKey(sessionId, filePath));
  if (!entry) return null;
  if (Date.now() - entry.loadedAt > 5 * 60 * 1000) {
    previewCache.delete(cacheKey(sessionId, filePath));
    return null;
  }
  return entry;
}

function setCachedPreview(sessionId: string, filePath: string, entry: Omit<PreviewCacheEntry, 'loadedAt'>) {
  previewCache.set(cacheKey(sessionId, filePath), {
    loadedAt: Date.now(),
    ...entry,
  });
}

function mapFileError(
  errorCode: string | undefined,
  fallback: string | undefined,
  responseFileType?: 'file' | 'directory' | 'symlink' | 'other'
): FileErrorState {
  const code = (errorCode || '').toUpperCase();
  if (code === 'EACCES' || code === 'EPERM') {
    return { kind: 'permission', message: t('files.permissionDenied') };
  }
  if (code === 'EISDIR' || responseFileType === 'directory') {
    return { kind: 'directory', message: t('files.directoryCannotPreview') };
  }
  if (code === 'ENOENT') {
    return { kind: 'broken-symlink', message: t('files.brokenSymlink') };
  }
  if (code === 'ESPECIAL') {
    return { kind: 'special', message: t('files.specialFile') };
  }
  return { kind: 'generic', message: fallback || t('files.failedToReadFile') };
}

function parseDelimitedTable(input: string, delimiter: ',' | '\t'): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const next = input[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === delimiter && !inQuotes) {
      row.push(cell);
      cell = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    cell += char;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows.filter(cells => !(cells.length === 1 && cells[0] === ''));
}

function TablePreview({ path, content }: { path: string; content: string }) {
  const { theme } = useUnistyles();
  const delimiter: ',' | '\t' = getPathExtension(path) === 'tsv' ? '\t' : ',';
  const rows = React.useMemo(() => parseDelimitedTable(content, delimiter), [content, delimiter]);
  const previewRows = rows.slice(0, 100);
  const columnCount = previewRows.reduce((max, row) => Math.max(max, row.length), 0);

  if (previewRows.length === 0 || columnCount === 0) {
    return (
      <Text style={{ fontSize: 16, color: theme.colors.textSecondary, ...Typography.default() }}>
        {t('files.fileEmpty')}
      </Text>
    );
  }

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator>
      <View
        style={{
          borderWidth: 1,
          borderColor: theme.colors.divider,
          borderRadius: 12,
          overflow: 'hidden',
          minWidth: '100%',
        }}
      >
        {previewRows.map((row, rowIndex) => {
          const isHeader = rowIndex === 0;
          return (
            <View
              key={rowIndex}
              style={{
                flexDirection: 'row',
                backgroundColor: isHeader
                  ? theme.colors.surfaceHigh
                  : rowIndex % 2 === 0
                    ? theme.colors.surface
                    : theme.colors.input.background,
                borderTopWidth: rowIndex === 0 ? 0 : StyleSheet.hairlineWidth,
                borderTopColor: theme.colors.divider,
              }}
            >
              {Array.from({ length: columnCount }).map((_, columnIndex) => (
                <View
                  key={columnIndex}
                  style={{
                    width: 180,
                    minHeight: 44,
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    borderLeftWidth: columnIndex === 0 ? 0 : StyleSheet.hairlineWidth,
                    borderLeftColor: theme.colors.divider,
                    justifyContent: 'center',
                  }}
                >
                  <Text
                    style={{
                      fontSize: 13,
                      color: theme.colors.text,
                      ...(isHeader ? Typography.default('semiBold') : Typography.default()),
                    }}
                  >
                    {row[columnIndex] || ''}
                  </Text>
                </View>
              ))}
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

const DiffDisplay = ({ diffContent }: { diffContent: string }) => {
  const { theme } = useUnistyles();
  const lines = diffContent.split('\n');

  return (
    <View>
      {lines.map((line, index) => {
        const baseStyle = { ...Typography.mono(), fontSize: 14, lineHeight: 20 };
        let lineStyle: any = baseStyle;
        let backgroundColor = 'transparent';

        if (line.startsWith('+') && !line.startsWith('+++')) {
          lineStyle = { ...baseStyle, color: theme.colors.diff.addedText };
          backgroundColor = theme.colors.diff.addedBg;
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          lineStyle = { ...baseStyle, color: theme.colors.diff.removedText };
          backgroundColor = theme.colors.diff.removedBg;
        } else if (line.startsWith('@@')) {
          lineStyle = { ...baseStyle, color: theme.colors.diff.hunkHeaderText, fontWeight: '600' };
          backgroundColor = theme.colors.diff.hunkHeaderBg;
        } else if (line.startsWith('+++') || line.startsWith('---')) {
          lineStyle = { ...baseStyle, color: theme.colors.text, fontWeight: '600' };
        } else {
          lineStyle = { ...baseStyle, color: theme.colors.diff.contextText };
        }

        return (
          <View
            key={index}
            style={{
              backgroundColor,
              paddingHorizontal: 8,
              paddingVertical: 1,
              borderLeftWidth:
                line.startsWith('+') && !line.startsWith('+++')
                  ? 3
                  : line.startsWith('-') && !line.startsWith('---')
                    ? 3
                    : 0,
              borderLeftColor:
                line.startsWith('+') && !line.startsWith('+++')
                  ? theme.colors.diff.addedBorder
                  : theme.colors.diff.removedBorder,
            }}
          >
            <Text style={lineStyle}>{line || ' '}</Text>
          </View>
        );
      })}
    </View>
  );
};

function getFileLanguage(path: string): string | null {
  const ext = path.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'js':
    case 'jsx':
      return 'javascript';
    case 'ts':
    case 'tsx':
      return 'typescript';
    case 'py':
      return 'python';
    case 'html':
    case 'htm':
      return 'html';
    case 'css':
      return 'css';
    case 'json':
      return 'json';
    case 'md':
      return 'markdown';
    case 'xml':
      return 'xml';
    case 'yaml':
    case 'yml':
      return 'yaml';
    case 'sh':
    case 'bash':
      return 'bash';
    case 'sql':
      return 'sql';
    case 'go':
      return 'go';
    case 'rust':
    case 'rs':
      return 'rust';
    case 'java':
      return 'java';
    case 'c':
      return 'c';
    case 'cpp':
    case 'cc':
    case 'cxx':
      return 'cpp';
    case 'php':
      return 'php';
    case 'rb':
      return 'ruby';
    case 'swift':
      return 'swift';
    case 'kt':
      return 'kotlin';
    default:
      return null;
  }
}

export function SessionFilePreviewPane({
  sessionId,
  filePath,
}: {
  sessionId: string;
  filePath: string;
}) {
  const { theme } = useUnistyles();
  const [fileContent, setFileContent] = React.useState<FileContent | null>(null);
  const [diffContent, setDiffContent] = React.useState<string | null>(null);
  const [displayMode, setDisplayMode] = React.useState<'file' | 'diff'>('file');
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<FileErrorState | null>(null);
  const [fileSizeBytes, setFileSizeBytes] = React.useState<number | null>(null);
  const [imagePreviewUri, setImagePreviewUri] = React.useState<string | null>(null);

  React.useEffect(() => {
    let isCancelled = false;

    const cached = getCachedPreview(sessionId, filePath);
    if (cached) {
      setFileContent(cached.fileContent);
      setDiffContent(cached.diffContent);
      setFileSizeBytes(cached.fileSizeBytes);
      setError(cached.error);
      setIsLoading(false);
      return;
    }

    const loadFile = async () => {
      try {
        setIsLoading(true);
        setError(null);
        setFileContent(null);
        setDiffContent(null);
        setFileSizeBytes(null);

        const session = storage.getState().sessions[sessionId];
        const sessionPath = session?.metadata?.path;
        const previewKind = getPreviewKind(filePath);
        const readLimit =
          previewKind === 'image' ? MAX_IMAGE_PREVIEW_BYTES : MAX_TEXT_PREVIEW_BYTES;
        let nextDiffContent: string | null = null;

        if (sessionPath) {
          try {
            const escaped = filePath.replace(/'/g, "'\\''");
            const diffResponse = await sessionBash(sessionId, {
              command: `git diff --no-ext-diff '${escaped}'`,
              cwd: sessionPath,
              timeout: 5000,
            });

            if (!isCancelled && diffResponse.success && diffResponse.stdout.trim()) {
              nextDiffContent = diffResponse.stdout;
              setDiffContent(diffResponse.stdout);
            }
          } catch (diffError) {
            logger.debug('Could not fetch git diff', { error: String(diffError) });
          }
        }

        const response = await sessionReadFile(sessionId, filePath, readLimit);
        if (isCancelled) return;

        if (response.success && typeof response.content === 'string') {
          const nextSize = typeof response.size === 'number' ? response.size : null;
          if (nextSize !== null) {
            setFileSizeBytes(nextSize);
          }

          let bytes: Uint8Array;
          try {
            bytes = decodeBase64(response.content);
          } catch (decodeError) {
            logger.error('base64 decode failed for file', toError(decodeError));
            const nextError = { kind: 'generic' as const, message: t('files.failedToDecodeContent') };
            setError(nextError);
            setCachedPreview(sessionId, filePath, {
              fileContent: null,
              diffContent: nextDiffContent,
              fileSizeBytes: nextSize,
              error: nextError,
            });
            return;
          }

          const detectedImageMimeType = detectImageMimeType(filePath, bytes);
          let nextFileContent: FileContent;

          if (detectedImageMimeType) {
            if (response.truncated) {
              const nextError = { kind: 'too-large' as const, message: t('files.imageTooLargeToPreview') };
              setError(nextError);
              setCachedPreview(sessionId, filePath, {
                fileContent: null,
                diffContent: nextDiffContent,
                fileSizeBytes: nextSize,
                error: nextError,
              });
              return;
            }
            nextFileContent = {
              content: `data:${detectedImageMimeType};base64,${response.content}`,
              encoding: 'base64',
              isBinary: false,
              previewKind: 'image',
              mimeType: detectedImageMimeType,
              truncated: response.truncated,
            };
          } else if (previewKind === 'binary' || looksLikeBinaryBytes(bytes)) {
            nextFileContent = {
              content: '',
              encoding: 'base64',
              isBinary: true,
              previewKind: 'binary',
            };
          } else {
            const decodedContent = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
            nextFileContent = {
              content: decodedContent,
              encoding: 'utf8',
              isBinary: false,
              previewKind,
              truncated: response.truncated,
            };
          }

          setFileContent(nextFileContent);
          setCachedPreview(sessionId, filePath, {
            fileContent: nextFileContent,
            diffContent: nextDiffContent,
            fileSizeBytes: nextSize,
            error: null,
          });
        } else {
          const nextError = mapFileError(response.errorCode, response.error, response.fileType);
          setError(nextError);
          setCachedPreview(sessionId, filePath, {
            fileContent: null,
            diffContent: nextDiffContent,
            fileSizeBytes: null,
            error: nextError,
          });
        }
      } catch (loadError) {
        logger.error('Failed to load file', toError(loadError));
        if (!isCancelled) {
          setError({ kind: 'generic', message: t('files.failedToLoadFile') });
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadFile();
    return () => {
      isCancelled = true;
    };
  }, [filePath, sessionId]);

  React.useEffect(() => {
    if (!diffContent && fileContent) {
      setDisplayMode('file');
    }
  }, [diffContent, fileContent]);

  const fileName = filePath.split('/').pop() || filePath;
  const language = getFileLanguage(filePath);
  const previewKind = fileContent?.previewKind ?? getPreviewKind(filePath);

  const copyFilePath = React.useCallback(async () => {
    try {
      await Clipboard.setStringAsync(filePath);
      Modal.alert(t('common.success'), t('files.pathCopied'));
    } catch (error) {
      logger.error('Failed to copy path', toError(error));
    }
  }, [filePath]);

  const downloadFile = React.useCallback(async () => {
    try {
      const MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024;
      if (typeof fileSizeBytes === 'number' && fileSizeBytes > MAX_DOWNLOAD_BYTES) {
        Modal.alert(t('common.error'), t('files.fileTooLargeToDownload'));
        return;
      }
      const response = await sessionReadFile(sessionId, filePath);
      if (!response.success || typeof response.content !== 'string') {
        Modal.alert(t('common.error'), t('files.downloadError'));
        return;
      }
      const mimeType =
        fileContent?.mimeType ?? getImageMimeType(filePath) ?? 'application/octet-stream';
      await downloadBase64File(fileName, response.content, mimeType);
    } catch (error) {
      logger.error('Failed to download file', toError(error));
      Modal.alert(t('common.error'), t('files.downloadError'));
    }
  }, [fileContent?.mimeType, fileName, filePath, fileSizeBytes, sessionId]);

  if (isLoading) {
    return (
      <View style={componentStyles.loadingContainer}>
        <ActivityIndicator size="small" color={theme.colors.textSecondary} />
        <Text style={componentStyles.loadingText}>{t('files.loadingFile', { fileName })}</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={componentStyles.errorContainer}>
        <Text style={[componentStyles.errorTitle, { color: theme.colors.textDestructive }]}>
          {t('common.error')}
        </Text>
        <Text style={componentStyles.errorMessage}>{error.message}</Text>
      </View>
    );
  }

  if (fileContent?.isBinary) {
    return (
      <View style={componentStyles.errorContainer}>
        <Text style={componentStyles.errorTitle}>{t('files.binaryFile')}</Text>
        <Text style={componentStyles.errorMessage}>{t('files.cannotDisplayBinary')}</Text>
      </View>
    );
  }

  return (
    <View style={[componentStyles.container, { backgroundColor: theme.colors.surface }]}>
      {imagePreviewUri ? (
        <ImagePreviewModal
          uri={imagePreviewUri}
          onClose={() => setImagePreviewUri(null)}
          onDownload={downloadFile}
        />
      ) : null}

      <View
        style={{
          padding: 16,
          borderBottomWidth: Platform.select({ ios: 0.33, default: 1 }),
          borderBottomColor: theme.colors.divider,
          backgroundColor: theme.colors.surfaceHigh,
          flexDirection: 'row',
          alignItems: 'center',
        }}
      >
        <Pressable onPress={copyFilePath} style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <FileIcon fileName={fileName} size={20} />
            <Text
              style={{
                fontSize: 14,
                color: theme.colors.textSecondary,
                marginLeft: 8,
                flex: 1,
                ...Typography.mono(),
              }}
              numberOfLines={2}
            >
              {filePath}
            </Text>
          </View>
          {fileSizeBytes != null ? (
            <Text
              style={{
                fontSize: 12,
                color: theme.colors.textSecondary,
                marginTop: 4,
                marginLeft: 28,
                ...Typography.default(),
              }}
            >
              {t('files.fileSize', { bytes: fileSizeBytes })}
            </Text>
          ) : null}
        </Pressable>
        <Pressable onPress={downloadFile} hitSlop={8} style={{ marginLeft: 12, padding: 4 }}>
          <Octicons name="download" size={20} color={theme.colors.textLink} />
        </Pressable>
      </View>

      {diffContent ? (
        <View
          style={{
            flexDirection: 'row',
            paddingHorizontal: 16,
            paddingVertical: 12,
            borderBottomWidth: Platform.select({ ios: 0.33, default: 1 }),
            borderBottomColor: theme.colors.divider,
            backgroundColor: theme.colors.surface,
          }}
        >
          <Pressable
            onPress={() => setDisplayMode('diff')}
            style={{
              paddingHorizontal: 16,
              paddingVertical: 8,
              borderRadius: 8,
              backgroundColor:
                displayMode === 'diff' ? theme.colors.textLink : theme.colors.input.background,
              marginRight: 8,
            }}
          >
            <Text
              style={{
                fontSize: 14,
                fontWeight: '600',
                color: displayMode === 'diff' ? 'white' : theme.colors.textSecondary,
                ...Typography.default(),
              }}
            >
              {t('files.diff')}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => setDisplayMode('file')}
            style={{
              paddingHorizontal: 16,
              paddingVertical: 8,
              borderRadius: 8,
              backgroundColor:
                displayMode === 'file' ? theme.colors.textLink : theme.colors.input.background,
            }}
          >
            <Text
              style={{
                fontSize: 14,
                fontWeight: '600',
                color: displayMode === 'file' ? 'white' : theme.colors.textSecondary,
                ...Typography.default(),
              }}
            >
              {t('files.file')}
            </Text>
          </Pressable>
        </View>
      ) : null}

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
        {displayMode === 'file' && fileContent?.truncated ? (
          <View
            style={{
              marginBottom: 12,
              paddingHorizontal: 12,
              paddingVertical: 10,
              borderRadius: 10,
              backgroundColor: theme.colors.warning + '20',
              borderWidth: 1,
              borderColor: theme.colors.warning + '55',
            }}
          >
            <Text style={{ fontSize: 13, color: theme.colors.text, ...Typography.default() }}>
              {t('files.largeFilePreviewTruncated')}
            </Text>
          </View>
        ) : null}

        {displayMode === 'diff' && diffContent ? (
          <DiffDisplay diffContent={diffContent} />
        ) : displayMode === 'file' && fileContent?.content ? (
          previewKind === 'image' ? (
            <Pressable
              onPress={() => setImagePreviewUri(fileContent.content)}
              style={{
                alignSelf: 'stretch',
                backgroundColor: theme.colors.surfaceHigh,
                borderWidth: 1,
                borderColor: theme.colors.divider,
                borderRadius: 12,
                overflow: 'hidden',
              }}
            >
              <Image
                source={{ uri: fileContent.content }}
                style={{
                  width: '100%',
                  minHeight: 240,
                  maxHeight: 520,
                  backgroundColor: theme.colors.surfaceHigh,
                }}
                contentFit="contain"
              />
              <Text
                style={{
                  fontSize: 12,
                  color: theme.colors.textSecondary,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  textAlign: 'center',
                  ...Typography.default(),
                }}
              >
                {t('files.tapImageToZoom')}
              </Text>
            </Pressable>
          ) : previewKind === 'table' ? (
            <TablePreview path={filePath} content={fileContent.content} />
          ) : isMarkdownPreviewPath(filePath) ? (
            <MarkdownView markdown={fileContent.content} sessionId={sessionId} markdownFilePath={filePath} />
          ) : (
            <SimpleSyntaxHighlighter
              code={fileContent.content}
              language={language}
              selectable={true}
              showLineNumbers={true}
            />
          )
        ) : displayMode === 'file' && fileContent && !fileContent.content ? (
          <Text style={{ fontSize: 16, color: theme.colors.textSecondary, ...Typography.default() }}>
            {t('files.fileEmpty')}
          </Text>
        ) : (
          <Text style={{ fontSize: 16, color: theme.colors.textSecondary, ...Typography.default() }}>
            {t('files.noChanges')}
          </Text>
        )}
      </ScrollView>
    </View>
  );
}

const componentStyles = StyleSheet.create(theme => ({
  container: {
    flex: 1,
    maxWidth: layout.maxWidth,
    alignSelf: 'center',
    width: '100%',
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: theme.colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: theme.colors.textSecondary,
    ...Typography.default(),
  },
  errorContainer: {
    flex: 1,
    backgroundColor: theme.colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  errorTitle: {
    fontSize: 18,
    color: theme.colors.textSecondary,
    marginBottom: 8,
    ...Typography.default('semiBold'),
  },
  errorMessage: {
    fontSize: 16,
    color: theme.colors.textSecondary,
    textAlign: 'center',
    ...Typography.default(),
  },
}));
