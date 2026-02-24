import { describe, it, expect } from 'vitest';
import type {
  ToolPermission,
  ToolCall,
  AgentEvent,
  MessageMeta,
  BaseMessage,
  UserTextMessage,
  AgentTextMessage,
  ToolCallMessage,
  AgentEventMessage,
  Message,
  TodoItem,
  UsageData,
} from '../message';
import {
  isUserTextMessage,
  isAgentTextMessage,
  isToolCallMessage,
  isAgentEventMessage,
} from '../message';

describe('message types', () => {
  describe('ToolPermission', () => {
    it('accepts valid tool permission', () => {
      const permission: ToolPermission = {
        id: 'perm-123',
        status: 'approved',
        date: Date.now(),
        mode: 'accept-edits',
        allowedTools: ['Read', 'Write'],
        decision: 'approved_for_session',
      };

      expect(permission.status).toBe('approved');
      expect(permission.allowedTools).toContain('Read');
    });
  });

  describe('ToolCall', () => {
    it('accepts valid tool call', () => {
      const toolCall: ToolCall = {
        name: 'Bash',
        state: 'completed',
        input: { command: 'ls -la' },
        createdAt: Date.now() - 1000,
        startedAt: Date.now() - 500,
        completedAt: Date.now(),
        description: 'List files',
        result: 'file1.txt\nfile2.txt',
      };

      expect(toolCall.name).toBe('Bash');
      expect(toolCall.state).toBe('completed');
    });

    it('accepts tool call with permission', () => {
      const toolCall: ToolCall = {
        name: 'Write',
        state: 'running',
        input: { file_path: '/test.txt', content: 'Hello' },
        createdAt: Date.now(),
        startedAt: Date.now(),
        completedAt: null,
        description: 'Write to file',
        result: null,
        permission: {
          id: 'perm-456',
          status: 'pending',
        },
      };

      expect(toolCall.permission?.status).toBe('pending');
    });
  });

  describe('AgentEvent', () => {
    it('accepts switch event', () => {
      const event: AgentEvent = { type: 'switch', mode: 'local' };
      expect(event.type).toBe('switch');
    });

    it('accepts message event', () => {
      const event: AgentEvent = { type: 'message', message: 'Hello' };
      expect(event.type).toBe('message');
    });

    it('accepts limit-reached event', () => {
      const event: AgentEvent = { type: 'limit-reached', endsAt: Date.now() + 60000 };
      expect(event.type).toBe('limit-reached');
    });

    it('accepts ready event', () => {
      const event: AgentEvent = { type: 'ready' };
      expect(event.type).toBe('ready');
    });
  });

  describe('Message types', () => {
    const baseMessage: BaseMessage = {
      id: 'msg-123',
      localId: null,
      createdAt: Date.now(),
    };

    it('accepts UserTextMessage', () => {
      const msg: UserTextMessage = {
        ...baseMessage,
        kind: 'user-text',
        text: 'Hello, agent!',
        displayText: 'Hello, agent!',
      };

      expect(msg.kind).toBe('user-text');
      expect(msg.text).toBe('Hello, agent!');
    });

    it('accepts AgentTextMessage', () => {
      const msg: AgentTextMessage = {
        ...baseMessage,
        kind: 'agent-text',
        text: 'Hello, user!',
        isThinking: false,
      };

      expect(msg.kind).toBe('agent-text');
      expect(msg.isThinking).toBe(false);
    });

    it('accepts AgentTextMessage with thinking', () => {
      const msg: AgentTextMessage = {
        ...baseMessage,
        kind: 'agent-text',
        text: 'Let me think about this...',
        isThinking: true,
      };

      expect(msg.isThinking).toBe(true);
    });

    it('accepts ToolCallMessage', () => {
      const msg: ToolCallMessage = {
        ...baseMessage,
        kind: 'tool-call',
        tool: {
          name: 'Read',
          state: 'completed',
          input: { file_path: '/test.txt' },
          createdAt: Date.now(),
          startedAt: Date.now(),
          completedAt: Date.now(),
          description: 'Read file',
          result: 'file contents',
        },
        children: [],
      };

      expect(msg.kind).toBe('tool-call');
      expect(msg.tool.name).toBe('Read');
    });

    it('accepts AgentEventMessage', () => {
      const msg: AgentEventMessage = {
        ...baseMessage,
        kind: 'agent-event',
        event: { type: 'switch', mode: 'remote' },
      };

      expect(msg.kind).toBe('agent-event');
      expect(msg.event.type).toBe('switch');
    });
  });

  describe('Type guards', () => {
    const createUserMessage = (): Message => ({
      id: 'msg-1',
      localId: null,
      createdAt: Date.now(),
      kind: 'user-text',
      text: 'Hello',
    });

    const createAgentMessage = (): Message => ({
      id: 'msg-2',
      localId: null,
      createdAt: Date.now(),
      kind: 'agent-text',
      text: 'Hi there',
    });

    const createToolCallMessage = (): Message => ({
      id: 'msg-3',
      localId: null,
      createdAt: Date.now(),
      kind: 'tool-call',
      tool: {
        name: 'Bash',
        state: 'completed',
        input: {},
        createdAt: Date.now(),
        startedAt: null,
        completedAt: null,
        description: null,
        result: null,
      },
      children: [],
    });

    const createEventMessage = (): Message => ({
      id: 'msg-4',
      localId: null,
      createdAt: Date.now(),
      kind: 'agent-event',
      event: { type: 'ready' },
    });

    it('isUserTextMessage correctly identifies user messages', () => {
      expect(isUserTextMessage(createUserMessage())).toBe(true);
      expect(isUserTextMessage(createAgentMessage())).toBe(false);
      expect(isUserTextMessage(createToolCallMessage())).toBe(false);
      expect(isUserTextMessage(createEventMessage())).toBe(false);
    });

    it('isAgentTextMessage correctly identifies agent messages', () => {
      expect(isAgentTextMessage(createUserMessage())).toBe(false);
      expect(isAgentTextMessage(createAgentMessage())).toBe(true);
      expect(isAgentTextMessage(createToolCallMessage())).toBe(false);
      expect(isAgentTextMessage(createEventMessage())).toBe(false);
    });

    it('isToolCallMessage correctly identifies tool call messages', () => {
      expect(isToolCallMessage(createUserMessage())).toBe(false);
      expect(isToolCallMessage(createAgentMessage())).toBe(false);
      expect(isToolCallMessage(createToolCallMessage())).toBe(true);
      expect(isToolCallMessage(createEventMessage())).toBe(false);
    });

    it('isAgentEventMessage correctly identifies event messages', () => {
      expect(isAgentEventMessage(createUserMessage())).toBe(false);
      expect(isAgentEventMessage(createAgentMessage())).toBe(false);
      expect(isAgentEventMessage(createToolCallMessage())).toBe(false);
      expect(isAgentEventMessage(createEventMessage())).toBe(true);
    });
  });

  describe('TodoItem', () => {
    it('accepts valid todo item', () => {
      const todo: TodoItem = {
        id: 'todo-1',
        content: 'Implement feature X',
        status: 'in_progress',
        priority: 'high',
      };

      expect(todo.status).toBe('in_progress');
      expect(todo.priority).toBe('high');
    });
  });

  describe('UsageData', () => {
    it('accepts valid usage data', () => {
      const usage: UsageData = {
        inputTokens: 1000,
        outputTokens: 500,
        cacheCreation: 100,
        cacheRead: 200,
        contextSize: 128000,
      };

      expect(usage.inputTokens).toBe(1000);
      expect(usage.outputTokens).toBe(500);
    });
  });
});
