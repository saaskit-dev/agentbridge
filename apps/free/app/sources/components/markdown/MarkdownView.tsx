import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import * as Linking from 'expo-linking';
import { Link } from 'expo-router';
import { useRouter } from 'expo-router';
import * as React from 'react';
import { Pressable, ScrollView, View, Platform } from 'react-native';
import { Gesture, GestureDetector, NativeViewGestureHandler } from 'react-native-gesture-handler';
import { StyleSheet } from 'react-native-unistyles';
import { ImagePreviewModal } from '../ImagePreviewModal';
import { SimpleSyntaxHighlighter } from '../SimpleSyntaxHighlighter';
import { Text } from '../StyledText';
import { MermaidRenderer } from './MermaidRenderer';
import { isLocalMarkdownImageSource, resolveLocalMarkdownImagePath } from './markdownImageSource';
import { MarkdownSpan, parseMarkdown } from './parseMarkdown';
import { Typography } from '@/constants/Typography';
import { Modal } from '@/modal';
import { sessionReadFile } from '@/sync/ops';
import { storeTempText } from '@/sync/persistence';
import { useLocalSetting } from '@/sync/storage';
import { t } from '@/text';
import {
  encodeSessionFilePathForRoute,
  resolveSessionMarkdownAssetPath,
  sanitizeMarkdownPathCandidate,
  stripMarkdownPathSuffixes,
} from '@/utils/sessionFilePath';
import { Logger, toError } from '@saaskit-dev/agentbridge/telemetry';
const logger = new Logger('app/components/markdown/MarkdownView');

/**
 * expo-router {@link Link} is for in-app routes and http(s); file/mailto/tel must use {@link Linking}.
 */
function shouldUseExpoRouterLink(url: string): boolean {
  const u = url.trim();
  if (/^https?:\/\//i.test(u)) return true;
  if (u.startsWith('/') && !u.startsWith('//')) return true;
  return false;
}

// Option type for callback
export type Option = {
  title: string;
};

function getImageMimeTypeFromPath(pathOrUrl: string): string | null {
  const cleanPath = pathOrUrl.split('?')[0]?.split('#')[0] ?? pathOrUrl;
  const ext = cleanPath.split('.').pop()?.toLowerCase();
  switch (ext) {
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

function isRemoteImageUri(source: string): boolean {
  return /^https?:\/\//i.test(source);
}

function isDataImageUri(source: string): boolean {
  return /^data:image\//i.test(source);
}

function isLocalMarkdownFileTarget(target: string): boolean {
  const trimmed = sanitizeMarkdownPathCandidate(target);
  if (!trimmed) return false;
  if (/^https?:\/\//i.test(trimmed)) return false;
  if (trimmed.startsWith('mailto:') || trimmed.startsWith('tel:')) return false;
  return (
    trimmed.startsWith('file://') ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('./') ||
    trimmed.startsWith('../') ||
    !/^[a-z][a-z0-9+.-]*:/i.test(trimmed)
  );
}

function resolveMarkdownFileTarget(target: string, assetContext?: MarkdownAssetContext): string | null {
  const trimmed = stripMarkdownPathSuffixes(target);
  if (!isLocalMarkdownFileTarget(trimmed)) return null;
  if (!assetContext?.markdownFilePath) return null;
  return resolveSessionMarkdownAssetPath(assetContext.markdownFilePath, trimmed);
}

export const MarkdownView = React.memo(
  (props: {
    markdown: string;
    onOptionPress?: (option: Option) => void;
    sessionId?: string;
    markdownFilePath?: string;
  }) => {
    const blocks = React.useMemo(() => parseMarkdown(props.markdown), [props.markdown]);

    // Prefer inline text selection across platforms when markdownCopyV2 is enabled.
    // The legacy fallback keeps the old native long-press selection screen only when the
    // experiment is turned off on mobile.
    const markdownCopyV2 = useLocalSetting('markdownCopyV2');
    const selectable = Platform.OS === 'web' || markdownCopyV2;
    const router = useRouter();

    const handleLongPress = React.useCallback(() => {
      try {
        const textId = storeTempText(props.markdown);
        router.push(`/text-selection?textId=${textId}`);
      } catch (error) {
        logger.error('Error storing text for selection:', toError(error));
        Modal.alert('Error', 'Failed to open text selection. Please try again.');
      }
    }, [props.markdown, router]);
    const renderContent = () => {
      return (
        <View style={{ width: '100%' }}>
          {blocks.map((block, index) => {
            if (block.type === 'text') {
              return (
                <RenderTextBlock
                  spans={block.content}
                  key={index}
                  first={index === 0}
                  last={index === blocks.length - 1}
                  selectable={selectable}
                  assetContext={props}
                />
              );
            } else if (block.type === 'header') {
              return (
                <RenderHeaderBlock
                  level={block.level}
                  spans={block.content}
                  key={index}
                  first={index === 0}
                  last={index === blocks.length - 1}
                  selectable={selectable}
                  assetContext={props}
                />
              );
            } else if (block.type === 'horizontal-rule') {
              return <View style={style.horizontalRule} key={index} />;
            } else if (block.type === 'list') {
              return (
                <RenderListBlock
                  items={block.items}
                  key={index}
                  first={index === 0}
                  last={index === blocks.length - 1}
                  selectable={selectable}
                  assetContext={props}
                />
              );
            } else if (block.type === 'numbered-list') {
              return (
                <RenderNumberedListBlock
                  items={block.items}
                  key={index}
                  first={index === 0}
                  last={index === blocks.length - 1}
                  selectable={selectable}
                  assetContext={props}
                />
              );
            } else if (block.type === 'code-block') {
              return (
                <RenderCodeBlock
                  content={block.content}
                  language={block.language}
                  key={index}
                  first={index === 0}
                  last={index === blocks.length - 1}
                  selectable={selectable}
                />
              );
            } else if (block.type === 'mermaid') {
              return <MermaidRenderer content={block.content} key={index} />;
            } else if (block.type === 'options') {
              return (
                <RenderOptionsBlock
                  items={block.items}
                  key={index}
                  first={index === 0}
                  last={index === blocks.length - 1}
                  selectable={selectable}
                  onOptionPress={props.onOptionPress}
                />
              );
            } else if (block.type === 'table') {
              return (
                <RenderTableBlock
                  headers={block.headers}
                  rows={block.rows}
                  key={index}
                  first={index === 0}
                  last={index === blocks.length - 1}
                />
              );
            } else if (block.type === 'blockquote') {
              return (
                <RenderBlockquoteBlock
                  spans={block.content}
                  key={index}
                  first={index === 0}
                  last={index === blocks.length - 1}
                  selectable={selectable}
                  assetContext={props}
                />
              );
            } else if (block.type === 'checklist') {
              return (
                <RenderChecklistBlock
                  items={block.items}
                  key={index}
                  first={index === 0}
                  last={index === blocks.length - 1}
                  selectable={selectable}
                  assetContext={props}
                />
              );
            } else if (block.type === 'image') {
              return (
                <RenderImageBlock
                  key={index}
                  source={block.source}
                  alt={block.alt}
                  first={index === 0}
                  last={index === blocks.length - 1}
                  sessionId={props.sessionId}
                  markdownFilePath={props.markdownFilePath}
                />
              );
            } else {
              return null;
            }
          })}
        </View>
      );
    };

    if (Platform.OS === 'web' || markdownCopyV2) {
      return renderContent();
    }

    // Use GestureDetector with LongPress gesture - it doesn't block pan gestures
    // so horizontal scrolling in code blocks and tables still works
    const longPressGesture = Gesture.LongPress()
      .minDuration(500)
      .onStart(() => {
        handleLongPress();
      })
      .runOnJS(true);

    return (
      <GestureDetector gesture={longPressGesture}>
        <View style={{ width: '100%' }}>{renderContent()}</View>
      </GestureDetector>
    );
  }
);

type MarkdownAssetContext = {
  sessionId?: string;
  markdownFilePath?: string;
};

function useResolvedMarkdownImage(source: string, assetContext?: MarkdownAssetContext) {
  const [resolvedUri, setResolvedUri] = React.useState<string | null>(null);
  const [loadFailed, setLoadFailed] = React.useState(false);
  const sanitizedSource = React.useMemo(() => sanitizeMarkdownPathCandidate(source), [source]);
  const localSourcePath = React.useMemo(
    () => resolveLocalMarkdownImagePath(source, assetContext?.markdownFilePath),
    [assetContext?.markdownFilePath, source]
  );

  React.useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoadFailed(false);

      if (isRemoteImageUri(source) || isDataImageUri(source)) {
        setResolvedUri(sanitizedSource);
        return;
      }

      if (sanitizedSource.startsWith('file://') && !assetContext?.sessionId) {
        setResolvedUri(sanitizedSource);
        return;
      }

      if (!assetContext?.sessionId || !localSourcePath) {
        setResolvedUri(null);
        setLoadFailed(true);
        return;
      }

      try {
        const response = await sessionReadFile(assetContext.sessionId, localSourcePath);
        if (cancelled) return;
        if (!response.success || typeof response.content !== 'string') {
          setResolvedUri(null);
          setLoadFailed(true);
          return;
        }

        const mimeType = getImageMimeTypeFromPath(localSourcePath) ?? 'application/octet-stream';
        setResolvedUri(`data:${mimeType};base64,${response.content}`);
      } catch (error) {
        if (!cancelled) {
          logger.debug('markdown image load failed', {
            source,
            resolvedPath: localSourcePath,
            error: String(error),
          });
          setResolvedUri(null);
          setLoadFailed(true);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [assetContext?.sessionId, localSourcePath, sanitizedSource, source]);

  return { resolvedUri, loadFailed, localSourcePath };
}

function RenderTextBlock(props: {
  spans: MarkdownSpan[];
  first: boolean;
  last: boolean;
  selectable: boolean;
  assetContext?: MarkdownAssetContext;
}) {
  const content = (
    <RenderInlineBlock
      spans={props.spans}
      selectable={props.selectable}
      containerStyle={[style.textBlock, props.first && style.first, props.last && style.last]}
      textStyle={style.text}
      assetContext={props.assetContext}
    />
  );
  // NativeViewGestureHandler is needed for text selection to work inside GestureHandlerRootView
  if (props.selectable && Platform.OS !== 'web') {
    return <NativeViewGestureHandler>{content}</NativeViewGestureHandler>;
  }
  return content;
}

function RenderImageBlock(props: {
  source: string;
  alt: string;
  first: boolean;
  last: boolean;
  sessionId?: string;
  markdownFilePath?: string;
}) {
  const [previewUri, setPreviewUri] = React.useState<string | null>(null);
  const { resolvedUri, loadFailed, localSourcePath } = useResolvedMarkdownImage(props.source, {
    sessionId: props.sessionId,
    markdownFilePath: props.markdownFilePath,
  });

  const containerStyle = [style.imageBlock, props.first && style.first, props.last && style.last];

  if (!resolvedUri) {
    return (
      <View style={containerStyle}>
        <View style={style.imagePlaceholder}>
          <Text style={style.imagePlaceholderText}>
            {loadFailed ? props.alt || props.source : t('common.loading')}
          </Text>
          {loadFailed && <Text style={style.imageSourceText}>{props.source}</Text>}
        </View>
      </View>
    );
  }

  return (
    <View style={containerStyle}>
      {previewUri && <ImagePreviewModal uri={previewUri} onClose={() => setPreviewUri(null)} />}
      <Pressable onPress={() => setPreviewUri(resolvedUri)} style={style.imageCard}>
        <Image source={{ uri: resolvedUri }} style={style.image} contentFit="contain" />
      </Pressable>
      {(props.alt || localSourcePath) && (
        <Text style={style.imageCaption}>{props.alt || localSourcePath}</Text>
      )}
    </View>
  );
}

function RenderHeaderBlock(props: {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  spans: MarkdownSpan[];
  first: boolean;
  last: boolean;
  selectable: boolean;
  assetContext?: MarkdownAssetContext;
}) {
  const s = (style as any)[`header${props.level}`];
  const headerStyle = [style.header, s, props.first && style.first, props.last && style.last];
  const content = (
    <RenderInlineBlock
      spans={props.spans}
      selectable={props.selectable}
      containerStyle={[style.textBlock, headerStyle]}
      textStyle={headerStyle}
      assetContext={props.assetContext}
    />
  );
  // NativeViewGestureHandler is needed for text selection to work inside GestureHandlerRootView
  if (props.selectable && Platform.OS !== 'web') {
    return <NativeViewGestureHandler>{content}</NativeViewGestureHandler>;
  }
  return content;
}

function RenderListBlock(props: {
  items: MarkdownSpan[][];
  first: boolean;
  last: boolean;
  selectable: boolean;
  assetContext?: MarkdownAssetContext;
}) {
  const listStyle = [style.text, style.list];
  const content = (
    <View style={{ flexDirection: 'column', marginBottom: 8, gap: 1 }}>
      {props.items.map((item, index) => (
        <View key={index} style={style.listRow}>
          <Text selectable={props.selectable} style={listStyle}>
            -{' '}
          </Text>
          <RenderInlineContent
            spans={item}
            selectable={props.selectable}
            textStyle={listStyle}
            assetContext={props.assetContext}
          />
        </View>
      ))}
    </View>
  );
  // NativeViewGestureHandler is needed for text selection to work inside GestureHandlerRootView
  if (props.selectable && Platform.OS !== 'web') {
    return <NativeViewGestureHandler>{content}</NativeViewGestureHandler>;
  }
  return content;
}

function RenderNumberedListBlock(props: {
  items: { number: number; spans: MarkdownSpan[] }[];
  first: boolean;
  last: boolean;
  selectable: boolean;
  assetContext?: MarkdownAssetContext;
}) {
  const listStyle = [style.text, style.list];
  const content = (
    <View style={{ flexDirection: 'column', marginBottom: 8, gap: 1 }}>
      {props.items.map((item, index) => (
        <View key={index} style={style.listRow}>
          <Text selectable={props.selectable} style={listStyle}>
            {item.number.toString()}.{' '}
          </Text>
          <RenderInlineContent
            spans={item.spans}
            selectable={props.selectable}
            textStyle={listStyle}
            assetContext={props.assetContext}
          />
        </View>
      ))}
    </View>
  );
  // NativeViewGestureHandler is needed for text selection to work inside GestureHandlerRootView
  if (props.selectable && Platform.OS !== 'web') {
    return <NativeViewGestureHandler>{content}</NativeViewGestureHandler>;
  }
  return content;
}

function RenderCodeBlock(props: {
  content: string;
  language: string | null;
  first: boolean;
  last: boolean;
  selectable: boolean;
}) {
  const [isHovered, setIsHovered] = React.useState(false);

  const copyCode = React.useCallback(async () => {
    try {
      await Clipboard.setStringAsync(props.content);
      Modal.alert(t('common.success'), t('markdown.codeCopied'), [
        { text: t('common.ok'), style: 'cancel' },
      ]);
    } catch (error) {
      logger.error('Failed to copy code:', toError(error));
      Modal.alert(t('common.error'), t('markdown.copyFailed'), [
        { text: t('common.ok'), style: 'cancel' },
      ]);
    }
  }, [props.content]);

  return (
    <View
      style={[style.codeBlock, props.first && style.first, props.last && style.last]}
      // @ts-ignore - Web only events
      onMouseEnter={() => setIsHovered(true)}
      // @ts-ignore - Web only events
      onMouseLeave={() => setIsHovered(false)}
    >
      {props.language && (
        <Text selectable={props.selectable} style={style.codeLanguage}>
          {props.language}
        </Text>
      )}
      <ScrollView
        style={{ flexGrow: 0, flexShrink: 0 }}
        horizontal={true}
        contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 16 }}
        showsHorizontalScrollIndicator={false}
      >
        <SimpleSyntaxHighlighter
          code={props.content}
          language={props.language}
          selectable={props.selectable}
        />
      </ScrollView>
      <View
        style={[style.copyButtonWrapper, isHovered && style.copyButtonWrapperVisible]}
        {...(Platform.OS === 'web' ? ({ className: 'copy-button-wrapper' } as any) : {})}
      >
        <Pressable style={style.copyButton} onPress={copyCode}>
          <Text style={style.copyButtonText}>{t('common.copy')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function RenderOptionsBlock(props: {
  items: string[];
  first: boolean;
  last: boolean;
  selectable: boolean;
  onOptionPress?: (option: Option) => void;
}) {
  return (
    <View style={[style.optionsContainer, props.first && style.first, props.last && style.last]}>
      {props.items.map((item, index) => {
        if (props.onOptionPress) {
          return (
            <Pressable
              key={index}
              style={({ pressed }) => [style.optionItem, pressed && style.optionItemPressed]}
              onPress={() => props.onOptionPress?.({ title: item })}
            >
              <Text selectable={props.selectable} style={style.optionText}>
                {item}
              </Text>
            </Pressable>
          );
        } else {
          return (
            <View key={index} style={style.optionItem}>
              <Text selectable={props.selectable} style={style.optionText}>
                {item}
              </Text>
            </View>
          );
        }
      })}
    </View>
  );
}

/** Renders a blockquote with a left accent border and inner spans. */
function RenderBlockquoteBlock(props: {
  spans: MarkdownSpan[];
  first: boolean;
  last: boolean;
  selectable: boolean;
  assetContext?: MarkdownAssetContext;
}) {
  const content = (
    <View style={[style.blockquote, props.first && style.first, props.last && style.last]}>
      <RenderInlineBlock
        spans={props.spans}
        selectable={props.selectable}
        containerStyle={style.textBlock}
        textStyle={[style.text, style.blockquoteText]}
        assetContext={props.assetContext}
      />
    </View>
  );
  if (props.selectable && Platform.OS !== 'web') {
    return <NativeViewGestureHandler>{content}</NativeViewGestureHandler>;
  }
  return content;
}

/** Renders a checklist with checkbox indicators before each item. */
function RenderChecklistBlock(props: {
  items: { checked: boolean; spans: MarkdownSpan[] }[];
  first: boolean;
  last: boolean;
  selectable: boolean;
  assetContext?: MarkdownAssetContext;
}) {
  const listStyle = [style.text, style.list];
  const content = (
    <View style={{ flexDirection: 'column', marginBottom: 8, gap: 1 }}>
      {props.items.map((item, index) => (
        <View key={index} style={style.listRow}>
          <Text selectable={props.selectable} style={listStyle}>
            {item.checked ? '\u2611 ' : '\u2610 '}
          </Text>
          <RenderInlineContent
            spans={item.spans}
            selectable={props.selectable}
            textStyle={listStyle}
            assetContext={props.assetContext}
          />
        </View>
      ))}
    </View>
  );
  if (props.selectable && Platform.OS !== 'web') {
    return <NativeViewGestureHandler>{content}</NativeViewGestureHandler>;
  }
  return content;
}

function RenderInlineBlock(props: {
  spans: MarkdownSpan[];
  selectable: boolean;
  containerStyle?: any;
  textStyle?: any;
  assetContext?: MarkdownAssetContext;
}) {
  return (
    <View style={props.containerStyle}>
      <RenderInlineContent
        spans={props.spans}
        selectable={props.selectable}
        textStyle={props.textStyle}
        assetContext={props.assetContext}
      />
    </View>
  );
}

function RenderInlineContent(props: {
  spans: MarkdownSpan[];
  selectable: boolean;
  textStyle?: any;
  assetContext?: MarkdownAssetContext;
}) {
  const router = useRouter();

  return (
    <View style={style.inlineContent}>
      {props.spans.map((span, index) => {
        if (span.type === 'image') {
          return (
            <InlineMarkdownImage
              key={index}
              source={span.source}
              alt={span.alt}
              assetContext={props.assetContext}
            />
          );
        }

        if (span.url) {
          const url = span.url;
          const localTarget = resolveMarkdownFileTarget(url, props.assetContext);
          if (localTarget && props.assetContext?.sessionId) {
            return (
              <Text
                key={index}
                selectable={props.selectable}
                style={[style.link, props.textStyle, span.styles.map(s => style[s])]}
                onPress={() => {
                  const encodedPath = encodeURIComponent(
                    encodeSessionFilePathForRoute(localTarget)
                  );
                  router.push(`/session/${props.assetContext?.sessionId}/file?path=${encodedPath}`);
                }}
              >
                {span.text}
              </Text>
            );
          }

          if (!shouldUseExpoRouterLink(url)) {
            return (
              <Text
                key={index}
                selectable={props.selectable}
                style={[style.link, props.textStyle, span.styles.map(s => style[s])]}
                onPress={() => {
                  void Linking.openURL(url).catch(err => {
                    logger.debug('markdown link open failed', { url, error: String(err) });
                  });
                }}
              >
                {span.text}
              </Text>
            );
          }
          return (
              <Link
                key={index}
                href={url as any}
                target="_blank"
                style={[style.link, props.textStyle, span.styles.map(s => style[s])]}
              >
                {span.text}
              </Link>
            );
        }

        return (
          <Text
            key={index}
            selectable={props.selectable}
            style={[props.textStyle, span.styles.map(s => style[s])]}
          >
            {span.text}
          </Text>
        );
      })}
    </View>
  );
}

function InlineMarkdownImage(props: {
  source: string;
  alt: string;
  assetContext?: MarkdownAssetContext;
}) {
  const [previewUri, setPreviewUri] = React.useState<string | null>(null);
  const { resolvedUri, loadFailed } = useResolvedMarkdownImage(props.source, props.assetContext);

  if (!resolvedUri) {
    return (
      <Text style={style.inlineImageFallback}>
        {loadFailed ? `[image: ${props.alt || props.source}]` : '[loading image]'}
      </Text>
    );
  }

  return (
    <View style={style.inlineImageWrapper}>
      {previewUri && <ImagePreviewModal uri={previewUri} onClose={() => setPreviewUri(null)} />}
      <Pressable onPress={() => setPreviewUri(resolvedUri)} style={style.inlineImageCard}>
        <Image source={{ uri: resolvedUri }} style={style.inlineImage} contentFit="cover" />
      </Pressable>
    </View>
  );
}

// Table rendering uses column-first layout to ensure consistent column widths.
// Each column is rendered as a vertical container with all its cells (header + data).
// This ensures that cells in the same column have the same width, determined by the widest content.
function RenderTableBlock(props: {
  headers: string[];
  rows: string[][];
  first: boolean;
  last: boolean;
}) {
  const columnCount = props.headers.length;
  const rowCount = props.rows.length;
  const isLastRow = (rowIndex: number) => rowIndex === rowCount - 1;

  return (
    <View style={[style.tableContainer, props.first && style.first, props.last && style.last]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={Platform.OS !== 'web'}
        nestedScrollEnabled={true}
        style={style.tableScrollView}
      >
        <View style={style.tableContent}>
          {/* Render each column as a vertical container */}
          {props.headers.map((header, colIndex) => (
            <View
              key={`column-${colIndex}`}
              style={[style.tableColumn, colIndex === columnCount - 1 && style.tableColumnLast]}
            >
              {/* Header cell for this column */}
              <View style={[style.tableCell, style.tableHeaderCell, style.tableCellFirst]}>
                <Text style={style.tableHeaderText}>{header}</Text>
              </View>
              {/* Data cells for this column */}
              {props.rows.map((row, rowIndex) => (
                <View
                  key={`cell-${rowIndex}-${colIndex}`}
                  style={[style.tableCell, isLastRow(rowIndex) && style.tableCellLast]}
                >
                  <Text style={style.tableCellText}>{row[colIndex] ?? ''}</Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const style = StyleSheet.create(theme => ({
  // Plain text

  text: {
    ...Typography.default(),
    fontSize: 16,
    lineHeight: 24, // Reduced from 28 to 24
    color: theme.colors.text,
    fontWeight: '400',
  },
  textBlock: {
    marginTop: 8,
    marginBottom: 8,
  },
  inlineContent: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 0,
    rowGap: 6,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },

  italic: {
    fontStyle: 'italic',
  },
  bold: {
    fontWeight: 'bold',
  },
  semibold: {
    fontWeight: '600',
  },
  code: {
    ...Typography.mono(),
    fontSize: 16,
    lineHeight: 21, // Reduced from 24 to 21
    backgroundColor: theme.colors.surfaceHighest,
    color: theme.colors.text,
  },
  strikethrough: {
    textDecorationLine: 'line-through',
  },
  link: {
    ...Typography.default(),
    color: theme.colors.textLink,
    fontWeight: '400',
  },

  // Headers

  header: {
    ...Typography.default('semiBold'),
    color: theme.colors.text,
  },
  header1: {
    fontSize: 16,
    lineHeight: 24, // Reduced from 36 to 24
    fontWeight: '900',
    marginTop: 16,
    marginBottom: 8,
  },
  header2: {
    fontSize: 20,
    lineHeight: 24, // Reduced from 36 to 32
    fontWeight: '600',
    marginTop: 16,
    marginBottom: 8,
  },
  header3: {
    fontSize: 16,
    lineHeight: 28, // Reduced from 32 to 28
    fontWeight: '600',
    marginTop: 16,
    marginBottom: 8,
  },
  header4: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '600',
    marginTop: 8,
    marginBottom: 8,
  },
  header5: {
    fontSize: 16,
    lineHeight: 24, // Reduced from 28 to 24
    fontWeight: '600',
  },
  header6: {
    fontSize: 16,
    lineHeight: 24, // Reduced from 28 to 24
    fontWeight: '600',
  },

  //
  // List
  //

  list: {
    ...Typography.default(),
    color: theme.colors.text,
    marginTop: 0,
    marginBottom: 0,
  },

  //
  // Blockquote
  //

  blockquote: {
    borderLeftWidth: 4,
    borderLeftColor: theme.colors.textSecondary + '4D',
    paddingLeft: 16,
    marginVertical: 8,
  },
  blockquoteText: {
    color: theme.colors.textSecondary,
    marginTop: 0,
    marginBottom: 0,
  },

  //
  // Common
  //

  first: {
    // marginTop: 0
  },
  last: {
    // marginBottom: 0
  },

  //
  // Code Block
  //

  codeBlock: {
    backgroundColor: theme.colors.surfaceHighest,
    borderRadius: 8,
    marginVertical: 8,
    position: 'relative',
    zIndex: 1,
  },
  copyButtonWrapper: {
    position: 'absolute',
    top: 8,
    right: 8,
    opacity: 0,
    zIndex: 10,
    elevation: 10,
    pointerEvents: 'none',
  },
  copyButtonWrapperVisible: {
    opacity: 1,
    pointerEvents: 'auto',
  },
  codeLanguage: {
    ...Typography.mono(),
    color: theme.colors.textSecondary,
    fontSize: 12,
    marginTop: 8,
    paddingHorizontal: 16,
    marginBottom: 0,
  },
  codeText: {
    ...Typography.mono(),
    color: theme.colors.text,
    fontSize: 14,
    lineHeight: 20,
  },
  horizontalRule: {
    height: 1,
    backgroundColor: theme.colors.divider,
    marginTop: 8,
    marginBottom: 8,
  },
  copyButtonContainer: {
    position: 'absolute',
    top: 8,
    right: 8,
    zIndex: 10,
    elevation: 10,
    opacity: 1,
  },
  copyButtonContainerHidden: {
    opacity: 0,
  },
  copyButton: {
    backgroundColor: theme.colors.surfaceHighest,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: theme.colors.divider,
    cursor: 'pointer',
  },
  copyButtonHidden: {
    display: 'none',
  },
  copyButtonCopied: {
    backgroundColor: theme.colors.success,
    borderColor: theme.colors.success,
    opacity: 1,
  },
  copyButtonText: {
    ...Typography.default(),
    color: theme.colors.text,
    fontSize: 12,
    lineHeight: 16,
  },

  //
  // Options Block
  //

  optionsContainer: {
    flexDirection: 'column',
    gap: 8,
    marginVertical: 8,
  },
  optionItem: {
    backgroundColor: theme.colors.surfaceHighest,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: theme.colors.divider,
  },
  optionItemPressed: {
    opacity: 0.7,
    backgroundColor: theme.colors.surfaceHigh,
  },
  optionText: {
    ...Typography.default(),
    fontSize: 16,
    lineHeight: 24,
    color: theme.colors.text,
  },

  //
  // Table
  //

  tableContainer: {
    marginVertical: 8,
    borderWidth: 1,
    borderColor: theme.colors.divider,
    borderRadius: 8,
    overflow: 'hidden',
    alignSelf: 'flex-start',
  },
  tableScrollView: {
    flexGrow: 0,
  },
  tableContent: {
    flexDirection: 'row',
  },
  tableColumn: {
    flexDirection: 'column',
    borderRightWidth: 1,
    borderRightColor: theme.colors.divider,
  },
  tableColumnLast: {
    borderRightWidth: 0,
  },
  tableCell: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.divider,
    alignItems: 'flex-start',
  },
  tableCellFirst: {
    borderTopWidth: 0,
  },
  tableCellLast: {
    borderBottomWidth: 0,
  },
  tableHeaderCell: {
    backgroundColor: theme.colors.surfaceHigh,
  },
  tableHeaderText: {
    ...Typography.default('semiBold'),
    color: theme.colors.text,
    fontSize: 16,
    lineHeight: 24,
  },
  tableCellText: {
    ...Typography.default(),
    color: theme.colors.text,
    fontSize: 16,
    lineHeight: 24,
  },
  imageBlock: {
    marginVertical: 8,
  },
  imageCard: {
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: theme.colors.divider,
    backgroundColor: theme.colors.surfaceHigh,
  },
  image: {
    width: '100%',
    minHeight: 220,
    maxHeight: 520,
    backgroundColor: theme.colors.surfaceHigh,
  },
  imageCaption: {
    ...Typography.default(),
    color: theme.colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 8,
  },
  imagePlaceholder: {
    minHeight: 120,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.divider,
    backgroundColor: theme.colors.surfaceHigh,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 20,
    gap: 8,
  },
  imagePlaceholderText: {
    ...Typography.default('semiBold'),
    color: theme.colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  imageSourceText: {
    ...Typography.mono(),
    color: theme.colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  inlineImageWrapper: {
    marginHorizontal: 4,
    marginVertical: 2,
  },
  inlineImageCard: {
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: theme.colors.divider,
    backgroundColor: theme.colors.surfaceHigh,
  },
  inlineImage: {
    width: 72,
    height: 72,
    backgroundColor: theme.colors.surfaceHigh,
  },
  inlineImageFallback: {
    ...Typography.default(),
    color: theme.colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
  },

  // Add global style for Web platform (Unistyles supports this via compiler plugin)
  ...(Platform.OS === 'web'
    ? {
        // Web-only CSS styles
        _____web_global_styles: {},
      }
    : {}),
}));
