import * as z from 'zod';
import {
  DEFAULT_FOCUS_AUDIO_SOUND,
  isFocusAudioSound,
  LEGACY_FOCUS_AUDIO_SOUND_MAP,
  type FocusAudioSound,
} from '@/audio/focusAudioCatalog';

export const FocusAudioSoundSchema = z.preprocess(value => {
  if (typeof value === 'string' && value in LEGACY_FOCUS_AUDIO_SOUND_MAP) {
    return LEGACY_FOCUS_AUDIO_SOUND_MAP[value as keyof typeof LEGACY_FOCUS_AUDIO_SOUND_MAP];
  }
  return value;
}, z.custom<FocusAudioSound>(isFocusAudioSound));

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
  sidebarWidth: z
    .number()
    .min(0)
    .max(1200)
    .nullable()
    .describe('Preferred desktop sidebar width; values below threshold collapse the sidebar'),
  sidebarCollapsed: z
    .boolean()
    .describe('Whether the desktop sidebar is currently collapsed'),
  sessionFilesSidebarWidth: z
    .number()
    .min(0)
    .max(1200)
    .nullable()
    .describe('Preferred desktop file tree sidebar width'),
  sessionFilesSidebarCollapsed: z
    .boolean()
    .describe('Whether the desktop session file tree sidebar is collapsed'),
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
  backgroundReconnectPromptHandled: z
    .boolean()
    .describe('Whether the on-demand background reconnect prompt has already been handled'),
  focusAudioEnabled: z.boolean().describe('Enable audible focus audio playback'),
  focusAudioSound: FocusAudioSoundSchema.describe('Selected focus audio sound profile'),
  focusAudioVolume: z
    .number()
    .min(0)
    .max(1)
    .describe('Focus audio playback volume from 0.0 to 1.0'),
  focusAudioLastAudibleVolume: z
    .number()
    .min(0.05)
    .max(1)
    .describe('Last non-zero focus audio volume, used for one-tap unmute'),
  focusAudioMixWithOthers: z
    .boolean()
    .describe('Whether focus audio should mix with other app audio'),
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
  sidebarWidth: null,
  sidebarCollapsed: false,
  sessionFilesSidebarWidth: null,
  sessionFilesSidebarCollapsed: false,
  themePreference: 'adaptive',
  markdownCopyV2: true,
  acknowledgedCliVersions: {},
  backgroundReconnectPromptHandled: false,
  focusAudioEnabled: false,
  focusAudioSound: DEFAULT_FOCUS_AUDIO_SOUND,
  focusAudioVolume: 0.35,
  focusAudioLastAudibleVolume: 0.35,
  focusAudioMixWithOthers: true,
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
