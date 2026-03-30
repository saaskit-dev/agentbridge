import * as z from 'zod';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';

const logger = new Logger('app/sync/settings');

//
// Settings Schema
//

// Current schema version for backward compatibility
export const SUPPORTED_SCHEMA_VERSION = 2;

export const SettingsSchema = z.object({
  // Schema version for compatibility detection
  schemaVersion: z
    .number()
    .default(SUPPORTED_SCHEMA_VERSION)
    .describe('Settings schema version for compatibility checks'),

  viewInline: z.boolean().describe('Whether to view inline tool calls'),
  inferenceOpenAIKey: z.string().nullish().describe('OpenAI API key for inference'),
  expandTodos: z.boolean().describe('Whether to expand todo lists'),
  showLineNumbers: z.boolean().describe('Whether to show line numbers in diffs'),
  showLineNumbersInToolViews: z
    .boolean()
    .describe('Whether to show line numbers in tool view diffs'),
  wrapLinesInDiffs: z.boolean().describe('Whether to wrap long lines in diff views'),
  experiments: z.boolean().describe('Whether to enable experimental features'),
  alwaysShowContextSize: z.boolean().describe('Always show context size in agent input'),
  agentInputEnterToSend: z
    .boolean()
    .describe('Whether pressing Enter submits/sends in the agent input (web)'),
  avatarStyle: z.string().describe('Avatar display style'),
  showFlavorIcons: z.boolean().describe('Whether to show AI provider icons in avatars'),
  compactSessionView: z.boolean().describe('Whether to use compact view for active sessions'),
  hideInactiveSessions: z.boolean().describe('Hide inactive sessions in the main list'),
  reviewPromptAnswered: z.boolean().describe('Whether the review prompt has been answered'),
  reviewPromptLikedApp: z.boolean().nullish().describe('Whether user liked the app when asked'),
  preferredLanguage: z
    .string()
    .nullable()
    .describe('Preferred UI language (null for auto-detect from device locale)'),
  recentMachinePaths: z
    .array(
      z.object({
        machineId: z.string(),
        path: z.string(),
      })
    )
    .describe('Last 10 machine-path combinations, ordered by most recent first'),
  lastUsedAgent: z.string().nullable().describe('Last selected agent type for new sessions'),
  lastUsedPermissionMode: z
    .string()
    .nullable()
    .describe('Last selected permission mode for new sessions'),
  lastUsedModelMode: z.string().nullable().describe('Last selected model mode for new sessions'),
  lastUsedAgentMode: z.string().nullable().describe('Last selected agent mode for new sessions'),
  // Favorite directories for quick path selection
  favoriteDirectories: z
    .array(z.string())
    .describe('User-defined favorite directories for quick access in path selection'),
  // Favorite machines for quick machine selection
  favoriteMachines: z
    .array(z.string())
    .describe('User-defined favorite machines (machine IDs) for quick access in machine selection'),
  // Dismissed CLI warning banners (supports both per-machine and global dismissal)
  dismissedCLIWarnings: z
    .object({
      perMachine: z
        .record(
          z.string(),
          z.object({
            claude: z.boolean().optional(),
            codex: z.boolean().optional(),
            gemini: z.boolean().optional(),
            opencode: z.boolean().optional(),
          })
        )
        .default({}),
      global: z
        .object({
          claude: z.boolean().optional(),
          codex: z.boolean().optional(),
          gemini: z.boolean().optional(),
          opencode: z.boolean().optional(),
        })
        .default({}),
    })
    .default({ perMachine: {}, global: {} })
    .describe(
      'Tracks which CLI installation warnings user has dismissed (per-machine or globally)'
    ),
  // Analytics/telemetry opt-out (synced across devices)
  analyticsEnabled: z.boolean().describe('Allow sharing anonymous usage data (synced with CLI)'),
});

//
// NOTE: Settings must be a flat object with no to minimal nesting, one field == one setting,
// you can name them with a prefix if you want to group them, but don't nest them.
// You can nest if value is a single value (like image with url and width and height)
// Settings are always merged with defaults and field by field.
//
// This structure must be forward and backward compatible. Meaning that some versions of the app
// could be missing some fields or have a new fields. Everything must be preserved and client must
// only touch the fields it knows about.
//

const SettingsSchemaPartial = SettingsSchema.partial();

export type Settings = z.infer<typeof SettingsSchema>;

//
// Defaults
//

export const settingsDefaults: Settings = {
  schemaVersion: SUPPORTED_SCHEMA_VERSION,
  viewInline: true,
  inferenceOpenAIKey: null,
  expandTodos: true,
  showLineNumbers: true,
  showLineNumbersInToolViews: true,
  wrapLinesInDiffs: true,
  experiments: true,
  alwaysShowContextSize: true,
  agentInputEnterToSend: true,
  avatarStyle: 'gradient',
  showFlavorIcons: true,
  compactSessionView: false,
  hideInactiveSessions: true,
  reviewPromptAnswered: false,
  reviewPromptLikedApp: null,
  preferredLanguage: 'zh-Hans',
  recentMachinePaths: [],
  lastUsedAgent: null,
  lastUsedPermissionMode: null,
  lastUsedModelMode: null,
  lastUsedAgentMode: null,
  // Default favorite directories (real common directories on Unix-like systems)
  favoriteDirectories: ['~/Desktop', '~/Documents'],
  // Favorite machines (empty by default)
  favoriteMachines: [],
  // Dismissed CLI warnings (empty by default)
  dismissedCLIWarnings: { perMachine: {}, global: {} },
  // Analytics enabled by default
  analyticsEnabled: true,
};
Object.freeze(settingsDefaults);

//
// Resolving
//

export function settingsParse(settings: unknown): Settings {
  // Handle null/undefined/invalid inputs
  if (!settings || typeof settings !== 'object') {
    return { ...settingsDefaults };
  }

  const parsed = SettingsSchemaPartial.safeParse(settings);
  if (!parsed.success) {
    // For invalid settings, preserve unknown fields but use defaults for known fields
    const unknownFields = { ...(settings as any) };
    // Remove all known schema fields from unknownFields
    const knownFields = Object.keys(SettingsSchema.shape);
    knownFields.forEach(key => delete unknownFields[key]);
    return { ...settingsDefaults, ...unknownFields };
  }

  // Migration: Convert old 'zh' language code to 'zh-Hans'
  if (parsed.data.preferredLanguage === 'zh') {
    logger.debug('[Settings Migration] Converting language code from "zh" to "zh-Hans"');
    parsed.data.preferredLanguage = 'zh-Hans';
  }

  // Migration: Convert legacy permission modes to unified 3-mode scheme
  const migratePermissionMode = (
    mode: string | null | undefined
  ): 'read-only' | 'accept-edits' | 'yolo' | undefined => {
    if (!mode) return undefined;
    const legacyMap: Record<string, 'read-only' | 'accept-edits' | 'yolo'> = {
      default: 'accept-edits',
      acceptEdits: 'accept-edits',
      bypassPermissions: 'yolo',
      plan: 'accept-edits',
      'safe-yolo': 'accept-edits',
      'read-only': 'read-only',
      yolo: 'yolo',
      'accept-edits': 'accept-edits',
    };
    return legacyMap[mode];
  };
  if (parsed.data.lastUsedPermissionMode) {
    const migrated = migratePermissionMode(parsed.data.lastUsedPermissionMode);
    if (migrated) parsed.data.lastUsedPermissionMode = migrated;
    else parsed.data.lastUsedPermissionMode = null;
  }

  // Merge defaults, parsed settings, and preserve unknown fields
  const unknownFields = { ...(settings as any) };
  // Remove known fields from unknownFields to preserve only the unknown ones
  Object.keys(parsed.data).forEach(key => delete unknownFields[key]);

  return { ...settingsDefaults, ...parsed.data, ...unknownFields };
}

//
// Applying changes
// NOTE: May be something more sophisticated here around defaults and merging, but for now this is fine.
//

export function applySettings(settings: Settings, delta: Partial<Settings>): Settings {
  // Original behavior: start with settings, apply delta, fill in missing with defaults
  const result = { ...settings, ...delta };

  // Fill in any missing fields with defaults
  Object.keys(settingsDefaults).forEach(key => {
    if (!(key in result)) {
      (result as any)[key] = (settingsDefaults as any)[key];
    }
  });

  return result;
}
