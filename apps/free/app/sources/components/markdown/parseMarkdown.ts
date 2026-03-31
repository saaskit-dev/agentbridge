import { parseMarkdownBlock } from './parseMarkdownBlock';
import { normalizeAcpResourceLinks, normalizeHtmlInMarkdown } from './normalizeMarkdown';

export type { MarkdownBlock, MarkdownSpan } from './markdownTypes';

export function parseMarkdown(markdown: string) {
  return parseMarkdownBlock(normalizeHtmlInMarkdown(normalizeAcpResourceLinks(markdown)));
}
