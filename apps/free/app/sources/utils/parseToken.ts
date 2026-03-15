import { decodeBase64 } from '@/encryption/base64';
import { decodeUTF8, encodeUTF8 } from '@/encryption/text';
import { safeStringify } from '@saaskit-dev/agentbridge/common';
import { toError } from '@saaskit-dev/agentbridge/telemetry';

export function parseToken(token: string) {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw new Error(
      'Invalid token format: expected "header.payload.signature" with non-empty parts'
    );
  }
  const [header, payload, signature] = parts;

  try {
    const sub = JSON.parse(decodeUTF8(decodeBase64(payload))).sub;
    if (typeof sub !== 'string') {
      throw new Error('Invalid token: missing or invalid sub claim');
    }
    return sub;
  } catch (error) {
    const err = toError(error);
    if (err.message.includes('Invalid token')) {
      throw err; // Re-throw our validation errors
    }
    throw new Error(
      `Invalid token: failed to decode payload - ${safeStringify(error)}`
    );
  }
}
