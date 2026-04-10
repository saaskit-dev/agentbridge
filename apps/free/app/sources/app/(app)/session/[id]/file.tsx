import { Octicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import * as React from 'react';
import { View, ScrollView, ActivityIndicator, Platform, Pressable } from 'react-native';
import { ImagePreviewModal } from '@/components/ImagePreviewModal';
import { useUnistyles, StyleSheet } from 'react-native-unistyles';
import { FileIcon } from '@/components/FileIcon';
import { layout } from '@/components/layout';
import { MarkdownView } from '@/components/markdown/MarkdownView';
import { SimpleSyntaxHighlighter } from '@/components/SimpleSyntaxHighlighter';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { decodeBase64, looksLikeBinaryBytes } from '@/encryption/base64';
import { Modal } from '@/modal';
import { sessionReadFile, sessionBash } from '@/sync/ops';
import { storage } from '@/sync/storage';
import { t } from '@/text';
import { downloadBase64File } from '@/utils/fileDownload';
import {
  detectImageMimeType,
  getImageMimeType,
  getPathExtension,
  getPreviewKind,
  isDelimitedTablePath,
  isMarkdownPreviewPath,
  type PreviewKind,
} from '@/utils/filePreview';
import { decodeSessionFilePathFromRoute } from '@/utils/sessionFilePath';
import { Logger, toError } from '@saaskit-dev/agentbridge/telemetry';
const logger = new Logger('app/session/file');

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

const MAX_TEXT_PREVIEW_BYTES = 256 * 1024;
const MAX_IMAGE_PREVIEW_BYTES = 12 * 1024 * 1024;

interface FileErrorState {
  kind: FileErrorKind;
  message: string;
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

const MAX_TABLE_PREVIEW_ROWS = 100;

function TablePreview({ path, content }: { path: string; content: string }) {
  const { theme } = useUnistyles();
  const delimiter: ',' | '\t' = getPathExtension(path) === 'tsv' ? '\t' : ',';
  const rows = React.useMemo(() => parseDelimitedTable(content, delimiter), [content, delimiter]);
  const previewRows = rows.slice(0, MAX_TABLE_PREVIEW_ROWS);
  const columnCount = previewRows.reduce((max, row) => Math.max(max, row.length), 0);

  if (previewRows.length === 0 || columnCount === 0) {
    return (
      <Text
        style={{
          fontSize: 16,
          color: theme.colors.textSecondary,
          fontStyle: 'italic',
          ...Typography.default(),
        }}
      >
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

// Diff display component
const DiffDisplay: React.FC<{ diffContent: string }> = ({ diffContent }) => {
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

export default function FileScreen() {
  const { theme } = useUnistyles();
  const { id: sessionId } = useLocalSearchParams<{ id: string }>();
  const searchParams = useLocalSearchParams();
  const pathParam = searchParams.path;
  const pathString = Array.isArray(pathParam) ? pathParam[0] : pathParam;

  /**
   * Query may be encodeURIComponent(base64); older links used raw base64 only.
   */
  const normalizedBase64 =
    typeof pathString === 'string' && pathString.length > 0
      ? (() => {
          try {
            return decodeURIComponent(pathString);
          } catch {
            return pathString;
          }
        })()
      : '';

  // UTF-8 path from base64 bytes (compatible with legacy ASCII-only btoa paths)
  const filePath = normalizedBase64 ? decodeSessionFilePathFromRoute(normalizedBase64) : '';
  if (normalizedBase64 && !filePath) {
    logger.error('Failed to decode file path from route param');
  }

  const [fileContent, setFileContent] = React.useState<FileContent | null>(null);
  const [diffContent, setDiffContent] = React.useState<string | null>(null);
  const [displayMode, setDisplayMode] = React.useState<'file' | 'diff'>('file');
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<FileErrorState | null>(null);
  const [fileSizeBytes, setFileSizeBytes] = React.useState<number | null>(null);
  const [imagePreviewUri, setImagePreviewUri] = React.useState<string | null>(null);

  // Determine file language from extension
  const getFileLanguage = React.useCallback((path: string): string | null => {
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
  }, []);

  // Load file content
  React.useEffect(() => {
    let isCancelled = false;

    const loadFile = async () => {
      try {
        setIsLoading(true);
        setError(null);
        setFileContent(null);
        setDiffContent(null);
        setFileSizeBytes(null);

        // Get session metadata for git commands
        const session = storage.getState().sessions[sessionId!];
        const sessionPath = session?.metadata?.path;

        const previewKind = getPreviewKind(filePath);

        const readLimit =
          previewKind === 'image' ? MAX_IMAGE_PREVIEW_BYTES : MAX_TEXT_PREVIEW_BYTES;

        // Fetch git diff for the file (if in git repo)
        if (sessionPath && sessionId) {
          try {
            // Shell-escape: wrap in single quotes, escaping any embedded single quotes
            const escaped = filePath.replace(/'/g, "'\\''");
            const diffResponse = await sessionBash(sessionId, {
              // If someone is using a custom diff tool like
              // difftastic, the parser would break. So instead
              // force git to use the built in diff tool.
              command: `git diff --no-ext-diff '${escaped}'`,
              cwd: sessionPath,
              timeout: 5000,
            });

            if (!isCancelled && diffResponse.success && diffResponse.stdout.trim()) {
              setDiffContent(diffResponse.stdout);
            }
          } catch (diffError) {
            logger.debug('Could not fetch git diff:', diffError);
            // Continue with file loading even if diff fails
          }
        }

        const response = await sessionReadFile(sessionId, filePath, readLimit);

        if (!isCancelled) {
          // Empty files serialize as base64 `""`; do not treat falsy `content` as a failed read.
          if (response.success && typeof response.content === 'string') {
            if (typeof response.size === 'number') {
              setFileSizeBytes(response.size);
            }

            // Daemon returns raw file bytes as base64; decode to bytes first (whitespace-tolerant), then UTF-8 for display.
            let bytes: Uint8Array;
            try {
              bytes = decodeBase64(response.content);
            } catch (decodeError) {
              logger.error('base64 decode failed for file', toError(decodeError));
              setError({ kind: 'generic', message: t('files.failedToDecodeContent') });
              return;
            }

            const detectedImageMimeType = detectImageMimeType(filePath, bytes);

            if (detectedImageMimeType) {
              if (response.truncated) {
                setError({ kind: 'too-large', message: t('files.imageTooLargeToPreview') });
                return;
              }
              setFileContent({
                content: `data:${detectedImageMimeType};base64,${response.content}`,
                encoding: 'base64',
                isBinary: false,
                previewKind: 'image',
                mimeType: detectedImageMimeType,
                truncated: response.truncated,
              });
              return;
            }

            if (previewKind === 'binary' || looksLikeBinaryBytes(bytes)) {
              setFileContent({
                content: '',
                encoding: 'base64',
                isBinary: true,
                previewKind: 'binary',
              });
              return;
            }

            const decodedContent = new TextDecoder('utf-8', { fatal: false }).decode(bytes);

            setFileContent({
              content: decodedContent,
              encoding: 'utf8',
              isBinary: false,
              previewKind,
              truncated: response.truncated,
            });
          } else {
            setError(mapFileError(response.errorCode, response.error, response.fileType));
          }
        }
      } catch (error) {
        logger.error('Failed to load file:', toError(error));
        if (!isCancelled) {
          setError({ kind: 'generic', message: t('files.failedToLoadFile') });
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    };

    loadFile();

    return () => {
      isCancelled = true;
    };
  }, [sessionId, filePath]);

  // Show error modal if there's an error
  React.useEffect(() => {
    if (error) {
      Modal.alert(t('common.error'), error.message);
    }
  }, [error]);

  // Default to file view; user can switch to diff manually if available
  React.useEffect(() => {
    if (!diffContent && fileContent) {
      setDisplayMode('file');
    }
  }, [diffContent, fileContent]);

  const fileName = filePath.split('/').pop() || filePath;
  const language = getFileLanguage(filePath);
  const previewKind = fileContent?.previewKind ?? getPreviewKind(filePath);

  /** Copy the full file path to clipboard and show a brief toast. */
  const copyFilePath = React.useCallback(async () => {
    try {
      await Clipboard.setStringAsync(filePath);
      Modal.alert(t('common.success'), t('files.pathCopied'));
    } catch (e) {
      logger.error('Failed to copy path', toError(e));
    }
  }, [filePath]);

  /** Save the current file to the client device. */
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
    } catch (e) {
      logger.error('Failed to download file', toError(e));
      Modal.alert(t('common.error'), t('files.downloadError'));
    }
  }, [fileContent?.mimeType, filePath, fileName, sessionId, fileSizeBytes]);

  if (isLoading) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: theme.colors.surface,
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <ActivityIndicator size="small" color={theme.colors.textSecondary} />
        <Text
          style={{
            marginTop: 16,
            fontSize: 16,
            color: theme.colors.textSecondary,
            ...Typography.default(),
          }}
        >
          {t('files.loadingFile', { fileName })}
        </Text>
      </View>
    );
  }

  if (error) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: theme.colors.surface,
          justifyContent: 'center',
          alignItems: 'center',
          padding: 20,
        }}
      >
        <Text
          style={{
            fontSize: 18,
            fontWeight: 'bold',
            color: theme.colors.textDestructive,
            marginBottom: 8,
            ...Typography.default('semiBold'),
          }}
        >
          {t('common.error')}
        </Text>
        <Text
          style={{
            fontSize: 16,
            color: theme.colors.textSecondary,
            textAlign: 'center',
            ...Typography.default(),
          }}
        >
          {error.message}
        </Text>
      </View>
    );
  }

  if (fileContent?.isBinary) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: theme.colors.surface,
          justifyContent: 'center',
          alignItems: 'center',
          padding: 20,
        }}
      >
        <Text
          style={{
            fontSize: 18,
            fontWeight: 'bold',
            color: theme.colors.textSecondary,
            marginBottom: 8,
            ...Typography.default('semiBold'),
          }}
        >
          {t('files.binaryFile')}
        </Text>
        <Text
          style={{
            fontSize: 16,
            color: theme.colors.textSecondary,
            textAlign: 'center',
            ...Typography.default(),
          }}
        >
          {t('files.cannotDisplayBinary')}
        </Text>
        <Text
          style={{
            fontSize: 14,
            color: '#999',
            textAlign: 'center',
            marginTop: 8,
            ...Typography.default(),
          }}
        >
          {fileName}
        </Text>
      </View>
    );
  }

  return (
      <View style={[styles.container, { backgroundColor: theme.colors.surface }]}>
      {imagePreviewUri && (
        <ImagePreviewModal
          uri={imagePreviewUri}
          onClose={() => setImagePreviewUri(null)}
          onDownload={downloadFile}
        />
      )}
      {/* File path header — tap to copy path */}
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
          {fileSizeBytes != null && (
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
          )}
        </Pressable>
        <Pressable onPress={downloadFile} hitSlop={8} style={{ marginLeft: 12, padding: 4 }}>
          <Octicons name="download" size={20} color={theme.colors.textLink} />
        </Pressable>
      </View>

      {/* Toggle buttons for File/Diff view */}
      {diffContent && (
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
      )}

      {/* Content display */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16 }}
        showsVerticalScrollIndicator={true}
      >
        {displayMode === 'file' && fileContent?.truncated && (
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
            <Text
              style={{
                fontSize: 13,
                color: theme.colors.text,
                ...Typography.default(),
              }}
            >
              {t('files.largeFilePreviewTruncated')}
            </Text>
          </View>
        )}
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
            <MarkdownView
              markdown={fileContent.content}
              sessionId={sessionId}
              markdownFilePath={filePath}
            />
          ) : (
            <SimpleSyntaxHighlighter
              code={fileContent.content}
              language={language}
              selectable={true}
              showLineNumbers={true}
            />
          )
        ) : displayMode === 'file' && fileContent && !fileContent.content ? (
          <Text
            style={{
              fontSize: 16,
              color: theme.colors.textSecondary,
              fontStyle: 'italic',
              ...Typography.default(),
            }}
          >
            {t('files.fileEmpty')}
          </Text>
        ) : !diffContent && !fileContent?.content ? (
          <Text
            style={{
              fontSize: 16,
              color: theme.colors.textSecondary,
              fontStyle: 'italic',
              ...Typography.default(),
            }}
          >
            {t('files.noChanges')}
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create(theme => ({
  container: {
    flex: 1,
    maxWidth: layout.maxWidth,
    alignSelf: 'center',
    width: '100%',
  },
}));
