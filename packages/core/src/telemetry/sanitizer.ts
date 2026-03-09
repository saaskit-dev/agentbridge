import type { LogEntry } from './types.js'

const DEFAULT_SENSITIVE_KEYS = new Set([
  'token', 'key', 'secret', 'password', 'credential', 'authorization',
  'cookie', 'encryptionkey', 'privatekey', 'accesskey',
  // User content (end-to-end encrypted, must never appear in logs) — RFC §6.1
  'content', 'text', 'message', 'body', 'draft', 'prompt',
  // Encryption artifacts
  'c', 'nonce', 'ciphertext',
])

const MAX_STRING_LENGTH = 500
const MAX_DEPTH = 5
const MAX_ARRAY_ELEMENTS = 20
const REDACTED = '[REDACTED]'

export class Sanitizer {
  private readonly sensitiveKeys: Set<string>
  private readonly maxStringLength: number

  constructor(opts?: {
    extraSensitiveKeys?: string[]
    maxStringLength?: number
  }) {
    this.sensitiveKeys = new Set(DEFAULT_SENSITIVE_KEYS)
    if (opts?.extraSensitiveKeys) {
      for (const k of opts.extraSensitiveKeys) {
        this.sensitiveKeys.add(k.toLowerCase())
      }
    }
    this.maxStringLength = opts?.maxStringLength ?? MAX_STRING_LENGTH
  }

  process(entry: LogEntry): LogEntry {
    const result = { ...entry }

    if (result.data) {
      result.data = this.redactObject(result.data, 0)
    }

    if (result.error) {
      result.error = {
        ...result.error,
        message: this.redactString(result.error.message),
      }
    }

    return result
  }

  private redactObject(obj: Record<string, unknown>, depth: number): Record<string, unknown> {
    if (depth >= MAX_DEPTH) return { _: '[DEEP_OBJECT]' }

    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
      if (this.isSensitiveKey(key)) {
        result[key] = REDACTED
        continue
      }
      result[key] = this.redactValue(value, depth)
    }
    return result
  }

  private redactValue(value: unknown, depth: number): unknown {
    if (value === null || value === undefined) return value
    if (typeof value === 'string') return this.truncateString(value)
    if (typeof value === 'number' || typeof value === 'boolean') return value

    if (value instanceof Uint8Array || (typeof Buffer !== 'undefined' && Buffer.isBuffer(value))) {
      return `[BINARY ${(value as Uint8Array).byteLength}]`
    }

    if (Array.isArray(value)) {
      const truncated = value.slice(0, MAX_ARRAY_ELEMENTS).map(v => this.redactValue(v, depth + 1))
      if (value.length > MAX_ARRAY_ELEMENTS) {
        truncated.push(`[...${value.length - MAX_ARRAY_ELEMENTS} more]`)
      }
      return truncated
    }

    if (typeof value === 'object') {
      return this.redactObject(value as Record<string, unknown>, depth + 1)
    }

    return String(value)
  }

  private isSensitiveKey(key: string): boolean {
    const lower = key.toLowerCase()
    for (const sensitive of this.sensitiveKeys) {
      // Single-character keys (e.g. 'c' for encrypted payload field) must match exactly,
      // otherwise any key containing that letter would be over-redacted (RFC §6.1).
      if (sensitive.length === 1 ? lower === sensitive : lower.includes(sensitive)) return true
    }
    return false
  }

  private truncateString(str: string): string {
    if (str.length <= this.maxStringLength) return str
    return str.slice(0, this.maxStringLength) + '...[truncated]'
  }

  private redactString(str: string): string {
    // RFC §6.2: Redact key=value / key: value patterns in error messages where
    // the key name is a known sensitive term (e.g. "token=abc123" → "token=[REDACTED]").
    // This catches error messages like "Auth failed: token=xyz" without requiring
    // the value to appear as an object key.
    const redacted = str.replace(
      /\b(token|key|secret|password|credential|authorization|cookie)\s*[=:]\s*["']?(\S+?)["']?(?=[,;\s]|$)/gi,
      (_, keyName: string) => `${keyName}=[REDACTED]`
    )
    return this.truncateString(redacted)
  }
}
