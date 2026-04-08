import { z } from 'zod';
import { compareUpdatedDesc } from './entitySort';
import {
  getCapabilityPresetFlavor,
  isAcpAgent,
  isAgentFlavorMatch,
  type AppAgentFlavor,
} from './agentFlavor';

export type PermissionMode = 'read-only' | 'accept-edits' | 'yolo';

export const ModelInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
});

export const ModeInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
});

export const ConfigOptionChoiceSchema = z.object({
  value: z.string(),
  label: z.string(),
});

export const ConfigOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  category: z.string(),
  type: z.literal('select'),
  options: z.array(ConfigOptionChoiceSchema),
  currentValue: z.string(),
});

export const AgentCommandSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
});

export const SessionCapabilitiesSchema = z.object({
  models: z
    .object({
      available: z.array(ModelInfoSchema),
      current: z.string(),
    })
    .optional(),
  modes: z
    .object({
      available: z.array(ModeInfoSchema),
      current: z.string(),
    })
    .optional(),
  configOptions: z.array(ConfigOptionSchema).optional(),
  commands: z.array(AgentCommandSchema).optional(),
});

export type ModelInfo = z.infer<typeof ModelInfoSchema>;
export type ModeInfo = z.infer<typeof ModeInfoSchema>;
export type ConfigOptionChoice = z.infer<typeof ConfigOptionChoiceSchema>;
export type ConfigOption = z.infer<typeof ConfigOptionSchema>;
export type AgentCommand = z.infer<typeof AgentCommandSchema>;
export type SessionCapabilities = z.infer<typeof SessionCapabilitiesSchema>;
export type AgentType = AppAgentFlavor;
export type CapabilityCategory = keyof Pick<
  SessionCapabilities,
  'models' | 'modes' | 'configOptions' | 'commands'
>;

const capabilityPresets: Record<'claude' | 'codex' | 'gemini' | 'opencode' | 'cursor', SessionCapabilities> =
  {
    claude: {
      models: {
        available: [
          { id: 'default', name: 'Default', description: 'Balanced performance' },
          {
            id: 'adaptiveUsage',
            name: 'Adaptive Usage',
            description: 'Automatically choose model',
          },
          { id: 'sonnet', name: 'Sonnet', description: 'Fast and efficient' },
          { id: 'opus', name: 'Opus', description: 'Most capable model' },
        ],
        current: 'default',
      },
    },
    codex: {
      models: {
        available: [{ id: 'default', name: 'Default', description: 'Use CLI default model' }],
        current: 'default',
      },
    },
    gemini: {
      models: {
        available: [
          { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', description: 'Most capable' },
          { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', description: 'Fast and efficient' },
          {
            id: 'gemini-2.5-flash-lite',
            name: 'Gemini 2.5 Flash Lite',
            description: 'Fastest',
          },
        ],
        current: 'gemini-2.5-pro',
      },
    },
    opencode: {
      models: {
        available: [{ id: 'default', name: 'Default', description: 'Use provider default model' }],
        current: 'default',
      },
    },
    cursor: {
      models: {
        available: [
          { id: 'default[]', name: 'Auto', description: 'Automatically select best model' },
          { id: 'claude-sonnet-4-6[thinking=true,context=200k,effort=medium]', name: 'Sonnet 4.6' },
          {
            id: 'claude-opus-4-6[thinking=true,context=200k,effort=high,fast=false]',
            name: 'Opus 4.6',
          },
          { id: 'gpt-5.4[reasoning=medium,context=272k,fast=false]', name: 'GPT-5.4' },
        ],
        current: 'default[]',
      },
      modes: {
        available: [
          { id: 'agent', name: 'Agent', description: 'Full agent capabilities with tool access' },
          { id: 'plan', name: 'Plan', description: 'Read-only mode for planning' },
          { id: 'ask', name: 'Ask', description: 'Q&A mode - no edits or command execution' },
        ],
        current: 'agent',
      },
    },
  };

export function getAgentCapabilityPreset(agentType: AgentType): SessionCapabilities {
  const presetFlavor = getCapabilityPresetFlavor(agentType);
  return presetFlavor ? capabilityPresets[presetFlavor] : {};
}

export function usesDiscoveredCapabilitiesOnly(agentType: AgentType): boolean {
  return isAcpAgent(agentType);
}

export function getCapabilityCachePolicy(
  agentType: AgentType
): Record<CapabilityCategory, boolean> {
  if (usesDiscoveredCapabilitiesOnly(agentType)) {
    return {
      models: true,
      modes: true,
      configOptions: true,
      commands: false,
    };
  }

  return {
    models: true,
    modes: true,
    configOptions: true,
    commands: true,
  };
}

export function getCachedCapabilitySnapshot(
  capabilities: SessionCapabilities | null | undefined,
  agentType?: AgentType | null
): SessionCapabilities {
  if (!capabilities) {
    return {};
  }

  const policy = getCapabilityCachePolicy(agentType ?? 'claude');

  return {
    ...(policy.models && capabilities.models ? { models: capabilities.models } : {}),
    ...(policy.modes && capabilities.modes ? { modes: capabilities.modes } : {}),
    ...(policy.configOptions && capabilities.configOptions
      ? { configOptions: capabilities.configOptions }
      : {}),
    ...(policy.commands && capabilities.commands ? { commands: capabilities.commands } : {}),
  };
}

export function getDefaultDiscoveredModelId(
  capabilities: SessionCapabilities | null | undefined
): string | null {
  const models = capabilities?.models?.available ?? [];
  if (!models.length) {
    return null;
  }

  if (
    capabilities?.models?.current &&
    models.some(model => model.id === capabilities.models?.current)
  ) {
    return capabilities.models.current;
  }

  return models[0]?.id ?? null;
}

export function getCurrentDiscoveredModeId(
  capabilities: SessionCapabilities | null | undefined
): string | null {
  const modes = capabilities?.modes?.available ?? [];
  if (!modes.length) {
    return null;
  }

  if (capabilities?.modes?.current && modes.some(mode => mode.id === capabilities.modes?.current)) {
    return capabilities.modes.current;
  }

  return modes[0]?.id ?? null;
}

export function getDisplayCapabilities(params: {
  capabilities: SessionCapabilities | null | undefined;
  desiredConfigOptions?: Record<string, string> | null;
}): SessionCapabilities | null | undefined {
  const { capabilities, desiredConfigOptions } = params;
  if (!capabilities) {
    return capabilities;
  }

  let didChange = false;
  let next = capabilities;

  if (
    next.configOptions?.length &&
    desiredConfigOptions &&
    Object.keys(desiredConfigOptions).length > 0
  ) {
    let didConfigChange = false;
    const configOptions = next.configOptions.map(option => {
      const desiredValue = desiredConfigOptions[option.id];
      if (!desiredValue || option.currentValue === desiredValue) {
        return option;
      }
      didConfigChange = true;
      return {
        ...option,
        currentValue: desiredValue,
      };
    });

    if (didConfigChange) {
      next = {
        ...next,
        configOptions,
      };
      didChange = true;
    }
  }

  return didChange ? next : capabilities;
}

export function getLatestCapabilitiesForAgent(
  sessions: Array<any> | null | undefined,
  machineId: string | null | undefined,
  agentType: AgentType
): SessionCapabilities | null {
  if (!sessions?.length || !machineId) {
    return null;
  }

  const matchingSessions = sessions
    .filter((session): session is any => !!session && typeof session !== 'string')
    .filter(
      session =>
        session.metadata?.machineId === machineId &&
        isAgentFlavorMatch(agentType, session.metadata?.flavor) &&
        session.capabilities
    )
    .sort(compareUpdatedDesc);

  const latestCapabilities = matchingSessions[0]?.capabilities;
  if (!latestCapabilities) {
    return null;
  }

  return getCachedCapabilitySnapshot(latestCapabilities, agentType);
}

export function resolveDraftCapabilities(params: {
  agentType: AgentType;
  cachedCapabilities?: SessionCapabilities | null;
  latestCapabilities?: SessionCapabilities | null;
}): SessionCapabilities {
  const { agentType, cachedCapabilities, latestCapabilities } = params;

  if (cachedCapabilities) {
    return cachedCapabilities;
  }

  if (latestCapabilities) {
    return latestCapabilities;
  }

  if (usesDiscoveredCapabilitiesOnly(agentType)) {
    return {};
  }

  return getAgentCapabilityPreset(agentType);
}

export function getVisibleConfigOptions(capabilities: SessionCapabilities | null | undefined) {
  return (capabilities?.configOptions ?? []).filter(
    option => option.category !== 'model' && option.category !== 'mode'
  );
}

export function getConfigOptionByCategory(
  capabilities: SessionCapabilities | null | undefined,
  category: string
): ConfigOption | undefined {
  return capabilities?.configOptions?.find(option => option.category === category);
}

export function findConfigOption(
  capabilities: SessionCapabilities | null | undefined,
  optionId: string
): ConfigOption | undefined {
  return capabilities?.configOptions?.find(option => option.id === optionId);
}
