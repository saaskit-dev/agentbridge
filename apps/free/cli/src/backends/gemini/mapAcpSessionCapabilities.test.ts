import { describe, expect, it } from 'vitest';
import type { NewSessionResponse, SessionUpdate } from '@agentclientprotocol/sdk';
import {
  applyCapabilitySelection,
  mapAcpSessionCapabilities,
  mergeAcpSessionCapabilities,
} from './mapAcpSessionCapabilities';

describe('mapAcpSessionCapabilities', () => {
  it('maps initial ACP snapshot into daemon session capabilities', () => {
    const snapshot: NewSessionResponse = {
      sessionId: 'acp-session',
      models: {
        availableModels: [
          { modelId: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', description: 'High quality' },
        ],
        currentModelId: 'gemini-2.5-pro',
      },
      modes: {
        availableModes: [{ id: 'code', name: 'Code', description: 'Default coding mode' }],
        currentModeId: 'code',
      },
      configOptions: [
        {
          id: 'model',
          name: 'Model',
          category: 'model',
          type: 'select',
          currentValue: 'gemini-2.5-pro',
          options: [{ value: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' }],
        },
      ],
    };

    const capabilities = mapAcpSessionCapabilities(snapshot);

    expect(capabilities.models?.current).toBe('gemini-2.5-pro');
    expect(capabilities.models?.available[0].name).toBe('Gemini 2.5 Pro');
    expect(capabilities.modes?.current).toBe('code');
    expect(capabilities.configOptions?.[0].options[0].label).toBe('Gemini 2.5 Pro');
  });
});

describe('mergeAcpSessionCapabilities', () => {
  it('merges command and config updates into the current snapshot', () => {
    const current = mapAcpSessionCapabilities({
      models: {
        availableModels: [{ modelId: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' }],
        currentModelId: 'gemini-2.5-pro',
      },
      modes: {
        availableModes: [{ id: 'code', name: 'Code' }],
        currentModeId: 'code',
      },
      configOptions: [
        {
          id: 'model',
          name: 'Model',
          category: 'model',
          type: 'select',
          currentValue: 'gemini-2.5-pro',
          options: [{ value: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' }],
        },
      ],
    });

    const commandUpdate: SessionUpdate = {
      sessionUpdate: 'available_commands_update',
      availableCommands: [{ name: '/plan', description: 'Create a plan' }],
    };
    const configUpdate: SessionUpdate = {
      sessionUpdate: 'config_option_update',
      configOptions: [
        {
          id: 'model',
          name: 'Model',
          category: 'model',
          type: 'select',
          currentValue: 'gemini-2.5-flash',
          options: [
            { value: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
            { value: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
          ],
        },
      ],
    };

    const withCommands = mergeAcpSessionCapabilities(current, commandUpdate);
    const withConfig = mergeAcpSessionCapabilities(withCommands, configUpdate);

    expect(withCommands.commands?.[0].id).toBe('/plan');
    expect(withConfig.models?.current).toBe('gemini-2.5-flash');
    expect(withConfig.configOptions?.[0].currentValue).toBe('gemini-2.5-flash');
  });
});

describe('applyCapabilitySelection', () => {
  it('updates current mode/model and related config option values', () => {
    const current = mapAcpSessionCapabilities({
      models: {
        availableModels: [{ modelId: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' }],
        currentModelId: 'gemini-2.5-pro',
      },
      modes: {
        availableModes: [{ id: 'code', name: 'Code' }],
        currentModeId: 'code',
      },
      configOptions: [
        {
          id: 'mode',
          name: 'Mode',
          category: 'mode',
          type: 'select',
          currentValue: 'code',
          options: [{ value: 'code', name: 'Code' }],
        },
      ],
    });

    const updated = applyCapabilitySelection(current, {
      modeId: 'architect',
      optionId: 'mode',
      value: 'architect',
    });

    expect(updated.modes?.current).toBe('architect');
    expect(updated.configOptions?.[0].currentValue).toBe('architect');
  });
});
