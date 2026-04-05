import type { MarkdownSpan } from './markdownTypes';

interface ParsedToken {
  span: MarkdownSpan;
  nextIndex: number;
}

function findClosingDelimiter(input: string, startIndex: number, delimiter: string): number {
  return input.indexOf(delimiter, startIndex);
}

function parseBracketedText(input: string, startIndex: number): { text: string; nextIndex: number } | null {
  if (input[startIndex] !== '[') return null;
  let i = startIndex + 1;
  let text = '';

  while (i < input.length) {
    const char = input[i];
    if (char === '\\' && i + 1 < input.length) {
      text += input[i + 1];
      i += 2;
      continue;
    }
    if (char === ']') {
      return { text, nextIndex: i + 1 };
    }
    text += char;
    i += 1;
  }

  return null;
}

function parseParenDestination(
  input: string,
  startIndex: number
): { destination: string; nextIndex: number } | null {
  let i = startIndex;
  while (i < input.length && /\s/.test(input[i] || '')) i += 1;
  if (input[i] !== '(') return null;

  i += 1;
  let depth = 1;
  let destination = '';

  while (i < input.length) {
    const char = input[i];
    if (char === '\\' && i + 1 < input.length) {
      destination += char + input[i + 1];
      i += 2;
      continue;
    }
    if (char === '(') {
      depth += 1;
      destination += char;
      i += 1;
      continue;
    }
    if (char === ')') {
      depth -= 1;
      if (depth === 0) {
        return { destination: destination.trim(), nextIndex: i + 1 };
      }
      destination += char;
      i += 1;
      continue;
    }
    destination += char;
    i += 1;
  }

  return null;
}

function parseImageToken(input: string, startIndex: number): ParsedToken | null {
  if (!input.startsWith('![', startIndex)) return null;
  const alt = parseBracketedText(input, startIndex + 1);
  if (!alt) return null;
  const destination = parseParenDestination(input, alt.nextIndex);

  if (!destination) {
    return {
      span: { type: 'text', styles: [], text: `![${alt.text}]`, url: null },
      nextIndex: alt.nextIndex,
    };
  }

  return {
    span: { type: 'image', alt: alt.text, source: destination.destination },
    nextIndex: destination.nextIndex,
  };
}

function parseLinkToken(input: string, startIndex: number): ParsedToken | null {
  if (input[startIndex] !== '[') return null;
  const label = parseBracketedText(input, startIndex);
  if (!label) return null;
  const destination = parseParenDestination(input, label.nextIndex);

  if (!destination) {
    return {
      span: { type: 'text', styles: [], text: `[${label.text}]`, url: null },
      nextIndex: label.nextIndex,
    };
  }

  return {
    span: { type: 'text', styles: [], text: label.text, url: destination.destination },
    nextIndex: destination.nextIndex,
  };
}

function parseDelimitedTextToken(
  input: string,
  startIndex: number,
  delimiter: string,
  styles: ('italic' | 'bold' | 'semibold' | 'code' | 'strikethrough')[],
  header: boolean
): ParsedToken | null {
  if (!input.startsWith(delimiter, startIndex)) return null;
  const endIndex = findClosingDelimiter(input, startIndex + delimiter.length, delimiter);
  const content =
    endIndex === -1
      ? input.slice(startIndex + delimiter.length)
      : input.slice(startIndex + delimiter.length, endIndex);
  const nextIndex = endIndex === -1 ? input.length : endIndex + delimiter.length;

  return {
    span: {
      type: 'text',
      styles: header ? [] : styles,
      text: content,
      url: null,
    },
    nextIndex,
  };
}

function parseInlineCodeToken(input: string, startIndex: number): ParsedToken | null {
  if (input[startIndex] !== '`') return null;
  const endIndex = findClosingDelimiter(input, startIndex + 1, '`');
  const content = endIndex === -1 ? input.slice(startIndex + 1) : input.slice(startIndex + 1, endIndex);
  return {
    span: { type: 'text', styles: ['code'], text: content, url: null },
    nextIndex: endIndex === -1 ? input.length : endIndex + 1,
  };
}

export function parseMarkdownSpans(markdown: string, header: boolean) {
  const spans: MarkdownSpan[] = [];
  let plainText = '';

  const pushPlainText = () => {
    if (!plainText) return;
    spans.push({ type: 'text', styles: [], text: plainText, url: null });
    plainText = '';
  };

  let index = 0;
  while (index < markdown.length) {
    const token =
      parseImageToken(markdown, index) ||
      parseLinkToken(markdown, index) ||
      parseDelimitedTextToken(markdown, index, '**', ['bold'], header) ||
      parseDelimitedTextToken(markdown, index, '~~', ['strikethrough'], header) ||
      parseDelimitedTextToken(markdown, index, '*', ['italic'], header) ||
      parseInlineCodeToken(markdown, index);

    if (!token) {
      plainText += markdown[index];
      index += 1;
      continue;
    }

    pushPlainText();
    spans.push(token.span);
    index = token.nextIndex;
  }

  pushPlainText();
  return spans;
}
