import * as z from 'zod';

//
// Schema
//

export const LocalSettingsSchema = z.object({
  // Developer settings (device-specific)
  devModeEnabled: z.boolean().describe('Enable developer menu in settings'),
  showDebugIds: z.boolean().describe('Show diagnostic IDs (session ID, agent ID, etc.) in UI'),
  debugIdsInitializedForDevMode: z
    .boolean()
    .describe('Tracks whether Show Debug IDs has been auto-initialized for developer mode'),
  // Note: analyticsEnabled moved to sync'd Settings for cross-device sync with CLI
  commandPaletteEnabled: z.boolean().describe('Enable CMD+K command palette (web only)'),
  themePreference: z
    .enum(['light', 'dark', 'adaptive'])
    .describe('Theme preference: light, dark, or adaptive (follows system)'),
  markdownCopyV2: z
    .boolean()
    .describe('Replace native paragraph selection with long-press modal for full markdown copy'),
  // CLI version acknowledgments - keyed by machineId
  acknowledgedCliVersions: z
    .record(z.string(), z.string())
    .describe('Acknowledged CLI versions per machine'),
});

//
// NOTE: Local settings are device-specific and should NOT be synced.
// These are preferences that make sense to be different on each device.
//

const LocalSettingsSchemaPartial = LocalSettingsSchema.passthrough().partial();

export type LocalSettings = z.infer<typeof LocalSettingsSchema>;

//
// Defaults
//

export const localSettingsDefaults: LocalSettings = {
  devModeEnabled: __DEV__,
  showDebugIds: false,
  debugIdsInitializedForDevMode: false,
  commandPaletteEnabled: false,
  themePreference: 'adaptive',
  markdownCopyV2: true,
  acknowledgedCliVersions: {},
};
Object.freeze(localSettingsDefaults);

//
// Parsing
//

export function localSettingsParse(settings: unknown): LocalSettings {
  const parsed = LocalSettingsSchemaPartial.safeParse(settings);
  if (!parsed.success) {
    return { ...localSettingsDefaults };
  }

  const merged = { ...localSettingsDefaults, ...parsed.data };

  if (merged.devModeEnabled && !merged.debugIdsInitializedForDevMode) {
    return {
      ...merged,
      showDebugIds: true,
      debugIdsInitializedForDevMode: true,
    };
  }

  return merged;
}

//
// Applying changes
//

export function applyLocalSettings(
  settings: LocalSettings,
  delta: Partial<LocalSettings>
): LocalSettings {
  return { ...localSettingsDefaults, ...settings, ...delta };
}
