/**
 * Normalizes agent-injected ACP resource lines into standard Markdown links so
 * {@link parseMarkdownSpans} can parse them as a single `[label](url)` span.
 *
 * Example input:
 *   [ACP resource_link] 1127c3e....png (file:///Users/dev/.free/attachments/1127c3e....png)
 * Output:
 *   [1127c3e....png](file:///Users/dev/.free/attachments/1127c3e....png)
 */
export function normalizeAcpResourceLinks(markdown: string): string {
  let s = markdown.replace(
    /\[ACP resource_link\]\s+([^\s(]+)\s+\((file:\/\/[^)]+)\)/g,
    '[$1]($2)'
  );
  s = normalizeLooseLocalFileReferences(s);
  return s;
}

/**
 * Convert common HTML tags found in Markdown files into their Markdown
 * equivalents so the existing parser can render them.
 *
 * This is intentionally a best-effort transform — we handle the tags that
 * appear most often in real-world `.md` files (READMEs, changelogs, docs)
 * and silently strip any remaining unknown tags while preserving their inner text.
 */
export function normalizeHtmlInMarkdown(markdown: string): string {
  let s = markdown;

  // --- Self-closing / void tags ---
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<hr\s*\/?>/gi, '\n---\n');

  // --- Block-level paired tags (processed first so inner inline tags survive) ---

  // Headings: <h1>…</h1> → # …
  for (let i = 1; i <= 6; i++) {
    const re = new RegExp(`<h${i}[^>]*>(.*?)<\\/h${i}>`, 'gis');
    const prefix = '#'.repeat(i);
    s = s.replace(re, (_, inner) => `\n${prefix} ${inner.trim()}\n`);
  }

  // Paragraphs
  s = s.replace(/<p[^>]*>(.*?)<\/p>/gis, (_, inner) => `\n${inner.trim()}\n`);

  // Blockquote
  s = s.replace(/<blockquote[^>]*>(.*?)<\/blockquote>/gis, (_, inner: string) => {
    const lines = inner.trim().split('\n');
    return '\n' + lines.map((l: string) => `> ${l.trim()}`).join('\n') + '\n';
  });

  // Lists: <ul>/<ol> with <li>
  s = s.replace(/<ul[^>]*>(.*?)<\/ul>/gis, (_, inner: string) => {
    const items = [...inner.matchAll(/<li[^>]*>(.*?)<\/li>/gis)];
    return '\n' + items.map(m => `- ${m[1].trim()}`).join('\n') + '\n';
  });
  s = s.replace(/<ol[^>]*>(.*?)<\/ol>/gis, (_, inner: string) => {
    const items = [...inner.matchAll(/<li[^>]*>(.*?)<\/li>/gis)];
    return '\n' + items.map((m, i) => `${i + 1}. ${m[1].trim()}`).join('\n') + '\n';
  });

  // <pre><code>…</code></pre> → fenced code block
  s = s.replace(/<pre[^>]*>\s*<code[^>]*>(.*?)<\/code>\s*<\/pre>/gis, (_, inner) => {
    return '\n```\n' + decodeHtmlEntities(inner) + '\n```\n';
  });

  // <details><summary>title</summary>body</details> → bold title + body
  s = s.replace(
    /<details[^>]*>\s*<summary[^>]*>(.*?)<\/summary>(.*?)<\/details>/gis,
    (_, summary, body) => `\n**${summary.trim()}**\n${body.trim()}\n`
  );

  // --- Inline paired tags ---
  s = s.replace(/<(b|strong)[^>]*>(.*?)<\/\1>/gis, '**$2**');
  s = s.replace(/<(i|em)[^>]*>(.*?)<\/\1>/gis, '*$2*');
  s = s.replace(/<code[^>]*>(.*?)<\/code>/gis, '`$1`');
  s = s.replace(/<(del|s|strike)[^>]*>(.*?)<\/\1>/gis, '~~$2~~');
  s = s.replace(/<(sup)[^>]*>(.*?)<\/sup>/gis, '^($2)');
  s = s.replace(/<(sub)[^>]*>(.*?)<\/sub>/gis, '_($2)');
  s = s.replace(/<mark[^>]*>(.*?)<\/mark>/gis, '**$1**');
  s = s.replace(/<u[^>]*>(.*?)<\/u>/gis, '$1');

  // Links: <a href="url">text</a>
  s = s.replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gis, '[$2]($1)');

  // Images: <img src="url" alt="text" /> — self-closing or paired
  s = s.replace(/<img\s+[^>]*src=["']([^"']+)["'][^>]*\/?>/gis, (match, src) => {
    const altMatch = match.match(/alt=["']([^"']*?)["']/i);
    const alt = altMatch ? altMatch[1] : '';
    return `![${alt}](${src})`;
  });

  // --- Strip remaining unknown HTML tags, keep inner text ---
  s = s.replace(/<\/?\w[^>]*>/g, '');

  // --- Decode common HTML entities ---
  s = decodeHtmlEntities(s);

  // Collapse 3+ consecutive blank lines into 2
  s = s.replace(/\n{3,}/g, '\n\n');

  return s;
}

/** Decode the most common HTML entities (exhaustive decode is overkill for Markdown). */
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ');
}

function normalizeLooseLocalFileReferences(markdown: string): string {
  const lines = markdown.split('\n');
  const out: string[] = [];
  let inFence = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^```/.test(trimmed)) {
      inFence = !inFence;
      out.push(line);
      continue;
    }

    if (inFence || /^(?: {4}|\t)/.test(line)) {
      out.push(line);
      continue;
    }

    if (!trimmed) {
      out.push(line);
      continue;
    }

    const directFileUrl = trimmed.match(/^<?(file:\/\/[^\s>]+)>?$/i);
    if (directFileUrl) {
      const target = stripWrappingPunctuation(directFileUrl[1]);
      out.push(isImagePath(target) ? `![](${target})` : `[${basename(target)}](${target})`);
      continue;
    }

    const directPath = trimmed.match(
      /^(?:['"`<([])?((?:\/|\.{1,2}\/|~\/|[A-Za-z0-9_.-]+\/)[^\s'"`)>]+?\.[A-Za-z0-9]+)(?:[>"'`)\]])?$/
    );
    if (directPath) {
      const target = stripWrappingPunctuation(
        directPath[1] ? `${directPath[1]}${directPath[2]}` : directPath[2]
      );
      out.push(isImagePath(target) ? `![](${target})` : `[${basename(target)}](${target})`);
      continue;
    }

    out.push(line);
  }

  return out.join('\n');
}

function stripWrappingPunctuation(input: string): string {
  return input.trim().replace(/^['"`<(\[]+/, '').replace(/[>)}\]"'`,.;:!?]+$/, '');
}

function basename(pathOrUrl: string): string {
  const clean = pathOrUrl.split('/').filter(Boolean);
  return clean[clean.length - 1] || pathOrUrl;
}

function isImagePath(pathOrUrl: string): boolean {
  const clean = pathOrUrl.split('?')[0]?.split('#')[0] ?? pathOrUrl;
  return /\.(png|jpe?g|gif|webp|bmp|svg|ico|heic|heif|avif)$/i.test(clean);
}
