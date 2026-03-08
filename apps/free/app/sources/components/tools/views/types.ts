import type { Metadata } from '@/sync/storageTypes';
import type { Message, ToolCall } from '@/sync/typesMessage';

export type ToolViewProps = {
  tool: ToolCall;
  metadata: Metadata | null;
  messages: Message[];
  sessionId?: string;
};

export type ToolViewComponent = React.ComponentType<ToolViewProps>;
