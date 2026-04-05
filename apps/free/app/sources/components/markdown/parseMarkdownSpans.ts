import type { MarkdownSpan } from './markdownTypes';

// Order matters: images must come before links so `![alt](src)` does not get parsed as plain `!` + link.
const pattern =
  /(!\[([^\]]*)\]\s*(?:\(([^)]+)\))?)|(\*\*(.*?)(?:\*\*|$))|(\*(.*?)(?:\*|$))|(\[([^\]]+)\]\s*(?:\(([^)]+)\))?)|(`(.*?)(?:`|$))|(~~(.*?)(?:~~|$))/g;

export function parseMarkdownSpans(markdown: string, header: boolean) {
  const spans: MarkdownSpan[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(markdown)) !== null) {
    // Capture the text between the end of the last match and the start of this match as plain text
    const plainText = markdown.slice(lastIndex, match.index);
    if (plainText) {
      spans.push({ type: 'text', styles: [], text: plainText, url: null });
    }

    if (match[1]) {
      // Inline image
      if (match[3]) {
        spans.push({ type: 'image', alt: match[2] ?? '', source: match[3] });
      } else {
        spans.push({ type: 'text', styles: [], text: `![${match[2] ?? ''}]`, url: null });
      }
    } else if (match[4]) {
      // Bold
      if (header) {
        spans.push({ type: 'text', styles: [], text: match[5], url: null });
      } else {
        spans.push({ type: 'text', styles: ['bold'], text: match[5], url: null });
      }
    } else if (match[6]) {
      // Italic
      if (header) {
        spans.push({ type: 'text', styles: [], text: match[7], url: null });
      } else {
        spans.push({ type: 'text', styles: ['italic'], text: match[7], url: null });
      }
    } else if (match[8]) {
      // Link - handle incomplete links (no URL part)
      if (match[10]) {
        spans.push({ type: 'text', styles: [], text: match[9], url: match[10] });
      } else {
        // If no URL part, treat as plain text with brackets
        spans.push({ type: 'text', styles: [], text: `[${match[9]}]`, url: null });
      }
    } else if (match[11]) {
      // Inline code
      spans.push({ type: 'text', styles: ['code'], text: match[12], url: null });
    } else if (match[13]) {
      // Strikethrough
      spans.push({ type: 'text', styles: ['strikethrough'], text: match[14], url: null });
    }

    lastIndex = pattern.lastIndex;
  }

  // If there's any text remaining after the last match, treat it as plain
  if (lastIndex < markdown.length) {
    spans.push({ type: 'text', styles: [], text: markdown.slice(lastIndex), url: null });
  }

  return spans;
}
