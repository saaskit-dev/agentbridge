import type { Option } from './MarkdownView';

export function buildMarkdownViewProps(
  markdown: string,
  sessionId?: string,
  onOptionPress?: (option: Option) => void
) {
  return {
    markdown,
    sessionId,
    onOptionPress,
  };
}

