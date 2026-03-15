import { describe, expect, it } from 'vitest';
import {
  HANDLED_SESSION_UPDATE_TYPES,
  shouldLogUnhandledSessionUpdate,
  type SessionUpdate,
} from './sessionUpdateHandlers';

describe('ACP session update coverage', () => {
  it('treats capability-related ACP updates as handled', () => {
    expect(HANDLED_SESSION_UPDATE_TYPES).toEqual(
      expect.arrayContaining([
        'available_commands_update',
        'current_mode_update',
        'config_option_update',
      ])
    );

    expect(
      shouldLogUnhandledSessionUpdate({
        sessionUpdate: 'available_commands_update',
        availableCommands: [{ name: '/plan' }],
      } as SessionUpdate)
    ).toBe(false);
    expect(
      shouldLogUnhandledSessionUpdate({
        sessionUpdate: 'current_mode_update',
        modeId: 'plan',
      } as SessionUpdate)
    ).toBe(false);
    expect(
      shouldLogUnhandledSessionUpdate({
        sessionUpdate: 'config_option_update',
        configOptions: [],
      } as SessionUpdate)
    ).toBe(false);
  });

  it('continues suppressing unhandled logs for legacy auxiliary payloads', () => {
    expect(
      shouldLogUnhandledSessionUpdate({
        sessionUpdate: 'legacy_message_chunk',
        messageChunk: { textDelta: 'hello' },
      } as SessionUpdate)
    ).toBe(false);
    expect(
      shouldLogUnhandledSessionUpdate({
        sessionUpdate: 'plan_update',
        plan: { steps: [] },
      } as SessionUpdate)
    ).toBe(false);
    expect(
      shouldLogUnhandledSessionUpdate({
        sessionUpdate: 'thinking_update',
        thinking: { text: 'reasoning' },
      } as SessionUpdate)
    ).toBe(false);
  });

  it('still logs truly unknown session updates', () => {
    expect(
      shouldLogUnhandledSessionUpdate({
        sessionUpdate: 'brand_new_update_type',
      } as SessionUpdate)
    ).toBe(true);
  });
});
