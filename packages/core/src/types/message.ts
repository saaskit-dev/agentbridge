import type { PermissionMode } from './session';

/** Message metadata */
export interface MessageMeta {
  sentFrom?: string;
  permissionMode?: PermissionMode;
  model?: string | null;
  fallbackModel?: string | null;
  customSystemPrompt?: string | null;
  appendSystemPrompt?: string | null;
  allowedTools?: string[] | null;
  disallowedTools?: string[] | null;
}

/** Reference to an image attachment stored on the daemon's local disk */
export interface AttachmentRef {
  /** cuid — used to locate the file on the Daemon */
  id: string;
  mimeType: string;
  /** Base64-encoded thumbhash for placeholder rendering in history */
  thumbhash?: string;
  filename?: string;
}

/** User message content */
export interface UserMessage {
  role: 'user';
  content: {
    type: 'text';
    text: string;
    /** Optional image attachments; omitted for text-only messages (backward compatible) */
    attachments?: AttachmentRef[];
  };
  localKey?: string;
  meta?: MessageMeta;
}

/** Agent message content */
export interface AgentMessageContent {
  role: 'agent';
  content: {
    type: 'output';
    data: unknown;
  };
  meta?: MessageMeta;
}

/** Message content union */
export type MessageContent = UserMessage | AgentMessageContent;

/** Encrypted message content */
export interface SessionMessageContent {
  c: string; // Base64 encoded encrypted content
  t: 'encrypted';
}

/** Session message from API */
export interface SessionMessage {
  id: string;
  seq: number;
  content: SessionMessageContent;
  createdAt: number;
  updatedAt: number;
}

/** Message role type */
export type MessageRole = 'user' | 'agent';
