import type {
  NewSessionResponse,
  SessionConfigOption,
  SessionConfigSelectGroup,
  SessionConfigSelectOption,
  SessionUpdate,
} from '@agentclientprotocol/sdk';
import type { ConfigOption, SessionCapabilities } from '@/daemon/sessions/capabilities';

type CapabilitySnapshotSource = Pick<NewSessionResponse, 'models' | 'modes' | 'configOptions'>;
type ProtocolCurrentModeUpdate = SessionUpdate & {
  sessionUpdate: 'current_mode_update';
  modeId?: string;
};

function isSelectGroup(
  option: SessionConfigSelectOption | SessionConfigSelectGroup
): option is SessionConfigSelectGroup {
  return 'group' in option;
}

function isSelectConfigOption(
  option: SessionConfigOption
): option is Extract<SessionConfigOption, { type: 'select' }> {
  return option.type === 'select';
}

function flattenConfigOptions(
  options: SessionConfigOption[] | null | undefined
): ConfigOption[] | undefined {
  if (!options?.length) {
    return undefined;
  }

  const selectOptions = options.filter(isSelectConfigOption);
  if (!selectOptions.length) {
    return undefined;
  }

  return selectOptions.map(option => ({
    id: option.id,
    name: option.name,
    ...(option.description ? { description: option.description } : {}),
    category: (option.category ?? 'model') as ConfigOption['category'],
    type: 'select',
    options: option.options.flatMap(
      (entry: SessionConfigSelectOption | SessionConfigSelectGroup) =>
        isSelectGroup(entry)
          ? entry.options.map(groupOption => ({
              value: groupOption.value,
              label: `${entry.name} / ${groupOption.name}`,
            }))
          : [
              {
                value: entry.value,
                label: entry.name,
              },
            ]
    ),
    currentValue: option.currentValue,
  }));
}

function inferCurrentValue(
  configOptions: ConfigOption[] | undefined,
  category: ConfigOption['category']
): string | undefined {
  return configOptions?.find(option => option.category === category)?.currentValue;
}

export function getModeConfigOptionId(
  capabilities: SessionCapabilities | null | undefined
): string | null {
  return capabilities?.configOptions?.find(option => option.category === 'mode')?.id ?? null;
}

export function getModelConfigOptionId(
  capabilities: SessionCapabilities | null | undefined
): string | null {
  return capabilities?.configOptions?.find(option => option.category === 'model')?.id ?? null;
}

export function mapAcpSessionCapabilities(source: CapabilitySnapshotSource): SessionCapabilities {
  const configOptions = flattenConfigOptions(source.configOptions);
  const currentModel = inferCurrentValue(configOptions, 'model');
  const currentMode = inferCurrentValue(configOptions, 'mode');

  return {
    ...(source.models
      ? {
          models: {
            available: source.models.availableModels.map(model => ({
              id: model.modelId,
              name: model.name,
              ...(model.description ? { description: model.description } : {}),
            })),
            current: currentModel ?? source.models.currentModelId,
          },
        }
      : {}),
    ...(source.modes
      ? {
          modes: {
            available: source.modes.availableModes.map(mode => ({
              id: mode.id,
              name: mode.name,
              ...(mode.description ? { description: mode.description } : {}),
            })),
            current: currentMode ?? source.modes.currentModeId,
          },
        }
      : {}),
    ...(configOptions ? { configOptions } : {}),
  };
}

/**
 * Session update types that actually modify capabilities (models/modes/commands/configOptions).
 * Must stay in sync with the switch cases in mergeAcpSessionCapabilities below.
 */
export const CAPABILITY_UPDATE_TYPES: ReadonlySet<string> = new Set([
  'available_commands_update',
  'current_mode_update',
  'config_option_update',
]);

export function mergeAcpSessionCapabilities(
  current: SessionCapabilities,
  update: SessionUpdate
): SessionCapabilities {
  switch (update.sessionUpdate) {
    case 'available_commands_update': {
      const dedupedCommands = new Map<string, { id: string; name: string; description?: string }>();
      for (const command of update.availableCommands) {
        dedupedCommands.set(command.name, {
          id: command.name,
          name: command.name,
          ...(command.description ? { description: command.description } : {}),
        });
      }
      return {
        ...current,
        commands: Array.from(dedupedCommands.values()),
      };
    }

    case 'current_mode_update': {
      const modeId = (update as ProtocolCurrentModeUpdate).modeId;
      if (!modeId) {
        return current;
      }

      const next: SessionCapabilities = { ...current };
      if (next.modes) {
        next.modes = {
          ...next.modes,
          current: modeId,
        };
      }
      const modeOptionId = getModeConfigOptionId(next);
      if (modeOptionId && next.configOptions) {
        next.configOptions = next.configOptions.map(option =>
          option.id === modeOptionId ? { ...option, currentValue: modeId } : option
        );
      }
      return next;
    }

    case 'config_option_update': {
      const configOptions = flattenConfigOptions(update.configOptions);
      const next: SessionCapabilities = {
        ...current,
        ...(configOptions ? { configOptions } : {}),
      };
      const currentModel = inferCurrentValue(configOptions, 'model');
      const currentMode = inferCurrentValue(configOptions, 'mode');

      if (next.models && currentModel) {
        next.models = {
          ...next.models,
          current: currentModel,
        };
      }
      if (next.modes && currentMode) {
        next.modes = {
          ...next.modes,
          current: currentMode,
        };
      }
      return next;
    }

    default:
      return current;
  }
}

export function applyCapabilitySelection(
  current: SessionCapabilities,
  selection: { modelId?: string; modeId?: string; optionId?: string; value?: string }
): SessionCapabilities {
  const next: SessionCapabilities = { ...current };

  if (selection.modelId && next.models) {
    next.models = { ...next.models, current: selection.modelId };
  }

  if (selection.modeId && next.modes) {
    next.modes = { ...next.modes, current: selection.modeId };
  }

  if (!selection.optionId || !selection.value || !next.configOptions) {
    return next;
  }

  next.configOptions = next.configOptions.map(option => {
    if (option.id !== selection.optionId) {
      return option;
    }
    return { ...option, currentValue: selection.value! };
  });

  const updatedOption = next.configOptions.find(option => option.id === selection.optionId);
  if (updatedOption?.category === 'model' && next.models) {
    next.models = { ...next.models, current: selection.value };
  }
  if (updatedOption?.category === 'mode' && next.modes) {
    next.modes = { ...next.modes, current: selection.value };
  }

  return next;
}
