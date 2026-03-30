import { describe, expect, it } from 'vitest';
import type { NewSessionResponse, SessionUpdate } from '@agentclientprotocol/sdk';
import {
  applyCapabilitySelection,
  getModeConfigOptionId,
  mapAcpSessionCapabilities,
  mergeAcpSessionCapabilities,
} from './mapAcpSessionCapabilities';

describe('mapAcpSessionCapabilities', () => {
  it('maps initial discovery snapshot into daemon capabilities', () => {
    const snapshot: NewSessionResponse = {
      sessionId: 'acp-session',
      models: {
        availableModels: [
          {
            modelId: 'claude-sonnet-4-5',
            name: 'Claude Sonnet 4.5',
            description: 'Balanced model',
          },
        ],
        currentModelId: 'claude-sonnet-4-5',
      },
      modes: {
        availableModes: [{ id: 'default', name: 'Default', description: 'Standard coding mode' }],
        currentModeId: 'default',
      },
      configOptions: [
        {
          id: 'model',
          name: 'Model',
          category: 'model',
          type: 'select',
          currentValue: 'claude-opus-4-1',
          options: [
            { value: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5' },
            { value: 'claude-opus-4-1', name: 'Claude Opus 4.1' },
          ],
        },
        {
          id: 'mode',
          name: 'Mode',
          category: 'mode',
          type: 'select',
          currentValue: 'plan',
          options: [
            {
              group: 'workflow',
              name: 'Workflow',
              options: [
                { value: 'plan', name: 'Plan' },
                { value: 'default', name: 'Default' },
              ],
            },
          ],
        },
      ],
    };

    const capabilities = mapAcpSessionCapabilities(snapshot);

    expect(capabilities.models?.current).toBe('claude-opus-4-1');
    expect(capabilities.models?.available[0]).toEqual({
      id: 'claude-sonnet-4-5',
      name: 'Claude Sonnet 4.5',
      description: 'Balanced model',
    });
    expect(capabilities.modes?.current).toBe('plan');
    expect(capabilities.configOptions?.[1].options).toEqual([
      { value: 'plan', label: 'Workflow / Plan' },
      { value: 'default', label: 'Workflow / Default' },
    ]);
  });

  it('returns an empty capability object when discovery is empty', () => {
    const capabilities = mapAcpSessionCapabilities({
      sessionId: 'empty-session',
    } as NewSessionResponse);

    expect(capabilities).toEqual({});
  });
});

describe('mergeAcpSessionCapabilities', () => {
  it('merges command, mode, and config updates into the current snapshot', () => {
    const current = mapAcpSessionCapabilities({
      sessionId: 'merge-session',
      models: {
        availableModels: [{ modelId: 'gpt-5', name: 'GPT-5' }],
        currentModelId: 'gpt-5',
      },
      modes: {
        availableModes: [{ id: 'default', name: 'Default' }],
        currentModeId: 'default',
      },
      configOptions: [
        {
          id: 'model',
          name: 'Model',
          category: 'model',
          type: 'select',
          currentValue: 'gpt-5',
          options: [{ value: 'gpt-5', name: 'GPT-5' }],
        },
        {
          id: 'mode',
          name: 'Mode',
          category: 'mode',
          type: 'select',
          currentValue: 'default',
          options: [
            { value: 'default', name: 'Default' },
            { value: 'plan', name: 'Plan' },
          ],
        },
      ],
    } as NewSessionResponse);

    const commandUpdate: SessionUpdate = {
      sessionUpdate: 'available_commands_update',
      availableCommands: [
        { name: '/plan', description: 'Create a plan' },
        { name: '/review', description: 'Review current work' },
      ],
    };
    const modeUpdate = {
      sessionUpdate: 'current_mode_update',
      currentModeId: 'plan',
    } as unknown as SessionUpdate;
    const configUpdate: SessionUpdate = {
      sessionUpdate: 'config_option_update',
      configOptions: [
        {
          id: 'model',
          name: 'Model',
          category: 'model',
          type: 'select',
          currentValue: 'gpt-5-mini',
          options: [
            { value: 'gpt-5', name: 'GPT-5' },
            { value: 'gpt-5-mini', name: 'GPT-5 Mini' },
          ],
        },
        {
          id: 'mode',
          name: 'Mode',
          category: 'mode',
          type: 'select',
          currentValue: 'plan',
          options: [{ value: 'plan', name: 'Plan' }],
        },
      ],
    };

    const withCommands = mergeAcpSessionCapabilities(current, commandUpdate);
    const withMode = mergeAcpSessionCapabilities(withCommands, modeUpdate);
    const withConfig = mergeAcpSessionCapabilities(withMode, configUpdate);

    expect(withCommands.commands).toEqual([
      { id: '/plan', name: '/plan', description: 'Create a plan' },
      { id: '/review', name: '/review', description: 'Review current work' },
    ]);
    expect(withMode.modes?.current).toBe('plan');
    expect(withMode.configOptions?.[1].currentValue).toBe('plan');
    expect(withConfig.models?.current).toBe('gpt-5-mini');
    expect(withConfig.configOptions?.[1].currentValue).toBe('plan');
  });

  it('ignores unsupported updates without mutating the current snapshot', () => {
    const current = {
      commands: [{ id: '/plan', name: '/plan' }],
    };

    const updated = mergeAcpSessionCapabilities(current, {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'hello' },
    } as SessionUpdate);

    expect(updated).toEqual(current);
  });

  it('accepts legacy modeId current_mode_update payloads for backward compatibility', () => {
    const current = {
      modes: {
        available: [{ id: 'default', name: 'Default' }],
        current: 'default',
      },
      configOptions: [
        {
          id: 'mode',
          name: 'Mode',
          category: 'mode' as const,
          type: 'select' as const,
          currentValue: 'default',
          options: [
            { value: 'default', label: 'Default' },
            { value: 'plan', label: 'Plan' },
          ],
        },
      ],
    };

    const updated = mergeAcpSessionCapabilities(current, {
      sessionUpdate: 'current_mode_update',
      modeId: 'plan',
    } as unknown as SessionUpdate);

    expect(updated.modes?.current).toBe('plan');
    expect(updated.configOptions?.[0].currentValue).toBe('plan');
  });
});

describe('ACP mode helpers', () => {
  it('returns the mode config option id', () => {
    const capabilities = {
      configOptions: [
        {
          id: 'workflow_mode',
          name: 'Mode',
          category: 'mode' as const,
          type: 'select' as const,
          currentValue: 'default',
          options: [{ value: 'default', label: 'Default' }],
        },
      ],
    };

    expect(getModeConfigOptionId(capabilities)).toBe('workflow_mode');
  });
});

describe('applyCapabilitySelection', () => {
  it('applies selected model, mode, and config values consistently', () => {
    const current = {
      models: {
        available: [{ id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5' }],
        current: 'claude-sonnet-4-5',
      },
      modes: {
        available: [{ id: 'default', name: 'Default' }],
        current: 'default',
      },
      configOptions: [
        {
          id: 'model',
          name: 'Model',
          category: 'model' as const,
          type: 'select' as const,
          currentValue: 'claude-sonnet-4-5',
          options: [{ value: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' }],
        },
        {
          id: 'mode',
          name: 'Mode',
          category: 'mode' as const,
          type: 'select' as const,
          currentValue: 'default',
          options: [{ value: 'default', label: 'Default' }],
        },
      ],
    };

    const updated = applyCapabilitySelection(current, {
      modelId: 'claude-opus-4-1',
      modeId: 'plan',
      optionId: 'mode',
      value: 'plan',
    });

    expect(updated.models?.current).toBe('claude-opus-4-1');
    expect(updated.modes?.current).toBe('plan');
    expect(updated.configOptions?.[1].currentValue).toBe('plan');
  });
});
