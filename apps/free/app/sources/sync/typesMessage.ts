import { MessageMeta } from './typesMessageMeta';
import { AgentEvent } from './typesRaw';

export type ToolCall = {
  name: string;
  state: 'running' | 'completed' | 'error';
  input: any;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  description: string | null;
  result?: any;
  permission?: {
    id: string;
    status: 'pending' | 'approved' | 'denied' | 'canceled';
    reason?: string;
    mode?: string;
    allowedTools?: string[];
    decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort';
    date?: number;
  };
};

// Flattened message types - each message represents a single block
export type UserTextMessage = {
  kind: 'user-text';
  id: string;
  seq?: number;
  createdAt: number;
  text: string;
  displayText?: string; // Optional text to display in UI instead of actual text
  attachments?: Array<{ id: string; mimeType: string; thumbhash?: string; filename?: string }>;
  meta?: MessageMeta;
  traceId?: string;
};

export type ModeSwitchMessage = {
  kind: 'agent-event';
  id: string;
  seq?: number;
  createdAt: number;
  event: AgentEvent;
  meta?: MessageMeta;
};

export type AgentTextMessage = {
  kind: 'agent-text';
  id: string;
  seq?: number;
  sourceId?: string | null;
  sourceIds?: string[];
  createdAt: number;
  text: string;
  isThinking?: boolean;
  meta?: MessageMeta;
  traceId?: string;
};

export type ToolCallMessage = {
  kind: 'tool-call';
  id: string;
  seq?: number;
  createdAt: number;
  tool: ToolCall;
  children: Message[];
  meta?: MessageMeta;
  traceId?: string;
};

export type Message = UserTextMessage | AgentTextMessage | ToolCallMessage | ModeSwitchMessage;
