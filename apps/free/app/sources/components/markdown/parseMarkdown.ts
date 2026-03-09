import { parseMarkdownBlock } from './parseMarkdownBlock';

export type { MarkdownBlock, MarkdownSpan } from './markdownTypes';

export function parseMarkdown(markdown: string) {
  return parseMarkdownBlock(markdown);
}
