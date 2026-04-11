import { Platform } from 'react-native';
import type { FocusAudioConfig } from '@/audio/focusAudio';
import type { FocusAudioWidgetState } from '@/widget/focusAudioWidget';

type FocusAudioNativeModuleType = {
  sync(config: {
    enabled: boolean;
    soundUri: string;
    volume: number;
    mixWithOthers: boolean;
  }): Promise<void>;
  stop(): Promise<void>;
  syncFromSharedState(): Promise<boolean>;
};

const nativeModule =
  Platform.OS === 'ios'
    ? ((globalThis as typeof globalThis & {
        expo?: { modules?: Record<string, FocusAudioNativeModuleType | undefined> };
      }).expo?.modules?.FocusAudioNative ?? null)
    : null;

export function isFocusAudioNativeAvailable(): boolean {
  return !!nativeModule;
}

export async function syncFocusAudioNative(
  config: FocusAudioConfig,
  widgetState: FocusAudioWidgetState
): Promise<boolean> {
  if (!nativeModule) {
    return false;
  }

  await nativeModule.sync({
    enabled: config.enabled,
    soundUri: widgetState.soundUri,
    volume: config.volume,
    mixWithOthers: config.mixWithOthers,
  });
  return true;
}

export async function stopFocusAudioNative(): Promise<boolean> {
  if (!nativeModule) {
    return false;
  }

  await nativeModule.stop();
  return true;
}

export async function syncFocusAudioNativeFromSharedState(): Promise<boolean> {
  if (!nativeModule) {
    return false;
  }

  return await nativeModule.syncFromSharedState();
}
