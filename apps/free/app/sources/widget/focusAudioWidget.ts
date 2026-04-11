import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';
import { ExtensionStorage } from '@bacons/apple-targets';
import {
  getFocusAudioSound,
  isFocusAudioSound,
  type FocusAudioSound,
} from '@/audio/focusAudioCatalog';
import {
  applyLocalSettings,
  localSettingsDefaults,
  type LocalSettings,
} from '@/sync/localSettings';

export const FOCUS_AUDIO_WIDGET_KIND = 'FocusAudioWidget';
const FOCUS_AUDIO_WIDGET_STATE_KEY = 'focus-audio-widget-state';
const FOCUS_AUDIO_WIDGET_PRESET_IDS: FocusAudioSound[] = ['light-rain', 'waves', 'cafe'];
const FOCUS_AUDIO_WIDGET_ACTION_QUERY_KEY = 'focusAudioWidgetAction';
const FOCUS_AUDIO_WIDGET_SOUND_QUERY_KEY = 'focusAudioWidgetSound';

interface FocusAudioWidgetPreset {
  id: FocusAudioSound;
  label: string;
  uri: string;
}

export interface FocusAudioWidgetState {
  enabled: boolean;
  sound: FocusAudioSound;
  soundLabel: string;
  soundUri: string;
  volume: number;
  lastAudibleVolume: number;
  isMuted: boolean;
  mixWithOthers: boolean;
  presets: FocusAudioWidgetPreset[];
  updatedAt: number;
}

export type FocusAudioWidgetAction =
  | { type: 'toggle' }
  | { type: 'mute' }
  | { type: 'sound'; sound: FocusAudioSound };

function getFocusAudioWidgetAppGroup(): string | null {
  const bundleId = Constants.expoConfig?.ios?.bundleIdentifier;
  return bundleId ? `group.${bundleId}` : null;
}

function getExtensionStorage(): ExtensionStorage | null {
  if (Platform.OS !== 'ios') {
    return null;
  }

  const appGroup = getFocusAudioWidgetAppGroup();
  return appGroup ? new ExtensionStorage(appGroup) : null;
}

function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) {
    return localSettingsDefaults.focusAudioVolume;
  }
  return Math.max(0, Math.min(1, volume));
}

function clampLastAudibleVolume(volume: number): number {
  if (!Number.isFinite(volume)) {
    return localSettingsDefaults.focusAudioLastAudibleVolume;
  }
  return Math.max(0.05, Math.min(1, volume));
}

export function buildFocusAudioWidgetState(
  settings: Pick<
    LocalSettings,
    | 'focusAudioEnabled'
    | 'focusAudioSound'
    | 'focusAudioVolume'
    | 'focusAudioLastAudibleVolume'
    | 'focusAudioMixWithOthers'
  >
): FocusAudioWidgetState {
  return {
    enabled: settings.focusAudioEnabled,
    sound: settings.focusAudioSound,
    soundLabel: getFocusAudioSound(settings.focusAudioSound).label,
    soundUri: getFocusAudioSound(settings.focusAudioSound).uri,
    volume: clampVolume(settings.focusAudioVolume),
    lastAudibleVolume: clampLastAudibleVolume(settings.focusAudioLastAudibleVolume),
    isMuted: clampVolume(settings.focusAudioVolume) <= 0.001,
    mixWithOthers: settings.focusAudioMixWithOthers,
    presets: FOCUS_AUDIO_WIDGET_PRESET_IDS.map(id => ({
      id,
      label: getFocusAudioSound(id).label,
      uri: getFocusAudioSound(id).uri,
    })),
    updatedAt: Date.now(),
  };
}

export function buildFocusAudioWidgetActionURL(action: FocusAudioWidgetAction): string {
  const queryParams: Record<string, string> = {
    [FOCUS_AUDIO_WIDGET_ACTION_QUERY_KEY]: action.type,
  };

  if (action.type === 'sound') {
    queryParams[FOCUS_AUDIO_WIDGET_SOUND_QUERY_KEY] = action.sound;
  }

  return Linking.createURL('/', { queryParams });
}

export function parseFocusAudioWidgetActionURL(url: string): FocusAudioWidgetAction | null {
  const { queryParams } = Linking.parse(url);
  if (!queryParams) {
    return null;
  }

  const action = queryParams[FOCUS_AUDIO_WIDGET_ACTION_QUERY_KEY];

  if (action === 'toggle') {
    return { type: 'toggle' };
  }
  if (action === 'mute') {
    return { type: 'mute' };
  }
  if (action === 'sound') {
    const sound = queryParams[FOCUS_AUDIO_WIDGET_SOUND_QUERY_KEY];
    if (isFocusAudioSound(sound)) {
      return { type: 'sound', sound };
    }
  }

  return null;
}

export function applyFocusAudioWidgetAction(
  localSettings: LocalSettings,
  action: FocusAudioWidgetAction
): LocalSettings {
  switch (action.type) {
    case 'toggle': {
      if (localSettings.focusAudioEnabled) {
        return applyLocalSettings(localSettings, {
          focusAudioEnabled: false,
        });
      }

      return applyLocalSettings(localSettings, {
        focusAudioEnabled: true,
        focusAudioVolume: Math.max(localSettings.focusAudioLastAudibleVolume, 0.05),
      });
    }
    case 'mute': {
      const isMuted = localSettings.focusAudioVolume <= 0.001;
      const restoredVolume = Math.max(localSettings.focusAudioLastAudibleVolume, 0.05);
      return applyLocalSettings(localSettings, {
        focusAudioEnabled: true,
        focusAudioVolume: isMuted ? restoredVolume : 0,
        focusAudioLastAudibleVolume: restoredVolume,
      });
    }
    case 'sound': {
      const restoredVolume =
        localSettings.focusAudioVolume <= 0.001
          ? Math.max(localSettings.focusAudioLastAudibleVolume, 0.05)
          : localSettings.focusAudioVolume;

      return applyLocalSettings(localSettings, {
        focusAudioEnabled: true,
        focusAudioSound: action.sound,
        focusAudioVolume: restoredVolume,
        focusAudioLastAudibleVolume: Math.max(localSettings.focusAudioLastAudibleVolume, 0.05),
      });
    }
  }
}

export function syncFocusAudioWidgetState(localSettings: LocalSettings): void {
  const storage = getExtensionStorage();
  if (!storage) {
    return;
  }

  storage.set(FOCUS_AUDIO_WIDGET_STATE_KEY, JSON.stringify(buildFocusAudioWidgetState(localSettings)));
  ExtensionStorage.reloadWidget(FOCUS_AUDIO_WIDGET_KIND);
}

export function readFocusAudioWidgetState(): FocusAudioWidgetState | null {
  const storage = getExtensionStorage();
  if (!storage) {
    return null;
  }

  const raw = storage.get(FOCUS_AUDIO_WIDGET_STATE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<FocusAudioWidgetState>;
    if (!parsed || !isFocusAudioSound(parsed.sound)) {
      return null;
    }

    return {
      enabled: parsed.enabled === true,
      sound: parsed.sound,
      soundLabel:
        typeof parsed.soundLabel === 'string'
          ? parsed.soundLabel
          : getFocusAudioSound(parsed.sound).label,
      soundUri:
        typeof parsed.soundUri === 'string'
          ? parsed.soundUri
          : getFocusAudioSound(parsed.sound).uri,
      volume: clampVolume(parsed.volume ?? localSettingsDefaults.focusAudioVolume),
      lastAudibleVolume: clampLastAudibleVolume(
        parsed.lastAudibleVolume ?? localSettingsDefaults.focusAudioLastAudibleVolume
      ),
      isMuted:
        typeof parsed.isMuted === 'boolean'
          ? parsed.isMuted
          : clampVolume(parsed.volume ?? localSettingsDefaults.focusAudioVolume) <= 0.001,
      mixWithOthers:
        typeof parsed.mixWithOthers === 'boolean'
          ? parsed.mixWithOthers
          : localSettingsDefaults.focusAudioMixWithOthers,
      presets: Array.isArray(parsed.presets)
        ? parsed.presets
            .filter(
              (item): item is FocusAudioWidgetPreset =>
              !!item && isFocusAudioSound(item.id) && typeof item.label === 'string'
            )
            .slice(0, 3)
        : FOCUS_AUDIO_WIDGET_PRESET_IDS.map(id => ({
            id,
            label: getFocusAudioSound(id).label,
            uri: getFocusAudioSound(id).uri,
          })),
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
    };
  } catch {
    return null;
  }
}

export function mergeFocusAudioWidgetState(
  localSettings: LocalSettings
): { nextLocalSettings: LocalSettings; changed: boolean } {
  const widgetState = readFocusAudioWidgetState();
  if (!widgetState) {
    return { nextLocalSettings: localSettings, changed: false };
  }

  const delta: Partial<LocalSettings> = {
    focusAudioEnabled: widgetState.enabled,
    focusAudioSound: widgetState.sound,
    focusAudioVolume: widgetState.volume,
    focusAudioLastAudibleVolume: widgetState.lastAudibleVolume,
    focusAudioMixWithOthers: widgetState.mixWithOthers,
  };

  const nextLocalSettings = applyLocalSettings(localSettings, delta);
  const changed =
    nextLocalSettings.focusAudioEnabled !== localSettings.focusAudioEnabled ||
    nextLocalSettings.focusAudioSound !== localSettings.focusAudioSound ||
    nextLocalSettings.focusAudioVolume !== localSettings.focusAudioVolume ||
    nextLocalSettings.focusAudioLastAudibleVolume !== localSettings.focusAudioLastAudibleVolume ||
    nextLocalSettings.focusAudioMixWithOthers !== localSettings.focusAudioMixWithOthers;

  return { nextLocalSettings, changed };
}
