import { parseMarkdownBlock } from './parseMarkdownBlock';
import { normalizeAcpResourceLinks, normalizeHtmlInMarkdown } from './normalizeMarkdown';

export type { MarkdownBlock, MarkdownSpan } from './markdownTypes';

const MAX_PARSE_CACHE_ENTRIES = 24;
const parseMarkdownCache = new Map<string, ReturnType<typeof parseMarkdownBlock>>();

export function parseMarkdown(markdown: string) {
  const cached = parseMarkdownCache.get(markdown);
  if (cached) {
    return cached;
  }

  const parsed = parseMarkdownBlock(normalizeHtmlInMarkdown(normalizeAcpResourceLinks(markdown)));
  parseMarkdownCache.set(markdown, parsed);
  if (parseMarkdownCache.size > MAX_PARSE_CACHE_ENTRIES) {
    const oldestKey = parseMarkdownCache.keys().next().value;
    if (oldestKey !== undefined) {
      parseMarkdownCache.delete(oldestKey);
    }
  }
  return parsed;
}
