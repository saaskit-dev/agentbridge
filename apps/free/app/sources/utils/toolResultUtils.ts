const BASH_RESULT_MAX_STDOUT_CHARS = 16_000;
const BASH_RESULT_MAX_STDERR_CHARS = 8_000;
const BASH_RESULT_MAX_STRING_CHARS = 16_000;

type BashPreviewMeta = {
  truncated: boolean;
  originalLength: number;
  displayedLength: number;
};

export type BashPreviewResult = {
  stdout?: string;
  stderr?: string;
  stdoutPreview?: BashPreviewMeta;
  stderrPreview?: BashPreviewMeta;
  outputPreview?: BashPreviewMeta;
  livePreview?: true;
};

function truncatePreview(value: string, maxChars: number): { text: string; meta: BashPreviewMeta } {
  if (value.length <= maxChars) {
    return {
      text: value,
      meta: {
        truncated: false,
        originalLength: value.length,
        displayedLength: value.length,
      },
    };
  }

  return {
    text: value.slice(0, maxChars) + '\n...[truncated for live UI]',
    meta: {
      truncated: true,
      originalLength: value.length,
      displayedLength: maxChars,
    },
  };
}

export function normalizeBashResultForLiveRendering(result: unknown): unknown {
  if (typeof result === 'string') {
    const preview = truncatePreview(result, BASH_RESULT_MAX_STRING_CHARS);
    return preview.meta.truncated
      ? {
          output: preview.text,
          outputPreview: preview.meta,
          livePreview: true as const,
        }
      : result;
  }

  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return result;
  }

  const record = result as Record<string, unknown>;
  const stdout = typeof record.stdout === 'string' ? record.stdout : undefined;
  const stderr = typeof record.stderr === 'string' ? record.stderr : undefined;
  if (stdout === undefined && stderr === undefined) {
    return result;
  }

  const normalized: Record<string, unknown> = { ...record };
  let changed = false;

  if (stdout !== undefined) {
    const preview = truncatePreview(stdout, BASH_RESULT_MAX_STDOUT_CHARS);
    normalized.stdout = preview.text;
    normalized.stdoutPreview = preview.meta;
    changed ||= preview.meta.truncated;
  }

  if (stderr !== undefined) {
    const preview = truncatePreview(stderr, BASH_RESULT_MAX_STDERR_CHARS);
    normalized.stderr = preview.text;
    normalized.stderrPreview = preview.meta;
    changed ||= preview.meta.truncated;
  }

  if (changed) {
    normalized.livePreview = true;
  }

  return changed ? normalized : result;
}

export function getBashPreviewNotice(result: unknown): string | null {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return null;
  }

  const record = result as Record<string, unknown>;
  const outputPreview = record.outputPreview as BashPreviewMeta | undefined;
  const stdoutPreview = record.stdoutPreview as BashPreviewMeta | undefined;
  const stderrPreview = record.stderrPreview as BashPreviewMeta | undefined;

  const notices: string[] = [];
  if (outputPreview?.truncated) {
    notices.push(`output ${outputPreview.displayedLength}/${outputPreview.originalLength} chars`);
  }
  if (stdoutPreview?.truncated) {
    notices.push(`stdout ${stdoutPreview.displayedLength}/${stdoutPreview.originalLength} chars`);
  }
  if (stderrPreview?.truncated) {
    notices.push(`stderr ${stderrPreview.displayedLength}/${stderrPreview.originalLength} chars`);
  }

  if (notices.length === 0) {
    return null;
  }

  return `Live view is showing a truncated preview: ${notices.join(', ')}.`;
}
