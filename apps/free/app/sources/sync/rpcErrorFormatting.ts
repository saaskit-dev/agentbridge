import { safeStringify } from '@saaskit-dev/agentbridge/common';

type RpcErrorResponse = {
  error?: string;
  details?: Record<string, unknown> | string;
};

function truncateDetailText(value: string, maxLength = 1_500): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}... [truncated]`;
}

function formatDetailValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  if (Array.isArray(value)) {
    return truncateDetailText(
      value
        .map(item => formatDetailValue(item))
        .filter(Boolean)
        .join(', ')
    );
  }

  if (typeof value === 'object') {
    try {
      const entries = Object.entries(value as Record<string, unknown>);
      return truncateDetailText(
        entries
          .map(([key, item]) => `${key}=${formatDetailValue(item)}`)
          .filter(entry => !entry.endsWith('='))
          .join(', ')
      );
    } catch {
      return truncateDetailText(safeStringify(value));
    }
  }

  return truncateDetailText(String(value));
}

export function formatRpcErrorMessage(
  error: string,
  details?: Record<string, unknown> | string
): string {
  if (!details) {
    return error;
  }

  const formattedDetails = formatDetailValue(details);
  if (!formattedDetails) {
    return error;
  }

  return error.includes(formattedDetails) ? error : `${error}\nDetails: ${formattedDetails}`;
}

export function getErrorMessageWithDetails(error: unknown): string {
  if (error instanceof Error && typeof error.message === 'string' && error.message.length > 0) {
    return error.message;
  }
  return safeStringify(error);
}

export function withFormattedRpcError<T extends RpcErrorResponse>(response: T): T {
  if (!response.error) {
    return response;
  }

  const formattedError = formatRpcErrorMessage(response.error, response.details);
  if (formattedError === response.error) {
    return response;
  }

  return {
    ...response,
    error: formattedError,
  };
}
