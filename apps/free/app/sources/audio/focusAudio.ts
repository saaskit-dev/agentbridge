import * as React from 'react';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { Directory, File, Paths } from 'expo-file-system';
import type { AudioPlayer } from 'expo-audio';
import { Platform } from 'react-native';
import { AsyncLock } from '@/utils/lock';
import { getFocusAudioSound, type FocusAudioSound } from '@/audio/focusAudioCatalog';
import { Logger, toError } from '@saaskit-dev/agentbridge/telemetry';

const logger = new Logger('app/audio/focusAudio');

export interface FocusAudioConfig {
  enabled: boolean;
  sound: FocusAudioSound;
  volume: number;
  mixWithOthers: boolean;
}

interface FocusAudioState {
  cachedSounds: FocusAudioSound[];
  loadingSounds: FocusAudioSound[];
  failedSound: FocusAudioSound | null;
  error: string | null;
}

const lock = new AsyncLock();

let focusAudioPlayer: AudioPlayer | null = null;
let currentSound: FocusAudioSound | null = null;
let focusAudioDirectory: Directory | null = null;
let focusAudioState: FocusAudioState = {
  cachedSounds: [],
  loadingSounds: [],
  failedSound: null,
  error: null,
};

const focusAudioListeners = new Set<() => void>();
const inFlightDownloads = new Map<FocusAudioSound, Promise<string>>();

function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) {
    return 0.35;
  }
  return Math.max(0, Math.min(1, volume));
}

function getFocusAudioDirectory(): Directory | null {
  if (Platform.OS === 'web') {
    return null;
  }
  if (!focusAudioDirectory) {
    focusAudioDirectory = new Directory(Paths.document, 'focus-audio');
  }
  if (!focusAudioDirectory.exists) {
    focusAudioDirectory.create({ idempotent: true, intermediates: true });
  }
  return focusAudioDirectory;
}

function getFocusAudioFile(sound: FocusAudioSound): File | null {
  const directory = getFocusAudioDirectory();
  return directory ? new File(directory, `${sound}.wav`) : null;
}

function emitFocusAudioState() {
  focusAudioListeners.forEach(listener => listener());
}

function updateFocusAudioState(updater: (state: FocusAudioState) => FocusAudioState) {
  focusAudioState = updater(focusAudioState);
  emitFocusAudioState();
}

function addUniqueSound(list: FocusAudioSound[], sound: FocusAudioSound): FocusAudioSound[] {
  return list.includes(sound) ? list : [...list, sound];
}

function removeSound(list: FocusAudioSound[], sound: FocusAudioSound): FocusAudioSound[] {
  return list.filter(item => item !== sound);
}

function markSoundCached(sound: FocusAudioSound) {
  updateFocusAudioState(state => ({
    ...state,
    cachedSounds: addUniqueSound(state.cachedSounds, sound),
    loadingSounds: removeSound(state.loadingSounds, sound),
    failedSound: state.failedSound === sound ? null : state.failedSound,
    error: state.failedSound === sound ? null : state.error,
  }));
}

function markSoundLoading(sound: FocusAudioSound) {
  updateFocusAudioState(state => ({
    ...state,
    loadingSounds: addUniqueSound(state.loadingSounds, sound),
    failedSound: state.failedSound === sound ? null : state.failedSound,
    error: state.failedSound === sound ? null : state.error,
  }));
}

function markSoundFailed(sound: FocusAudioSound, error: unknown) {
  updateFocusAudioState(state => ({
    ...state,
    loadingSounds: removeSound(state.loadingSounds, sound),
    failedSound: sound,
    error: String(error),
  }));
}

function getRemoteFocusAudioUri(sound: FocusAudioSound): string {
  return getFocusAudioSound(sound).uri;
}

async function ensureFocusAudioSource(sound: FocusAudioSound): Promise<string> {
  if (Platform.OS === 'web') {
    return getRemoteFocusAudioUri(sound);
  }

  const target = getFocusAudioFile(sound);
  if (!target) {
    return getRemoteFocusAudioUri(sound);
  }
  if (target.exists) {
    markSoundCached(sound);
    return target.uri;
  }

  const existingDownload = inFlightDownloads.get(sound);
  if (existingDownload) {
    return existingDownload;
  }

  markSoundLoading(sound);
  const downloadPromise = File.downloadFileAsync(getRemoteFocusAudioUri(sound), target, {
    idempotent: true,
  })
    .then(file => {
      markSoundCached(sound);
      return file.uri;
    })
    .catch(error => {
      markSoundFailed(sound, error);
      throw error;
    })
    .finally(() => {
      inFlightDownloads.delete(sound);
    });

  inFlightDownloads.set(sound, downloadPromise);
  return downloadPromise;
}

async function stopInternal() {
  if (focusAudioPlayer) {
    try {
      focusAudioPlayer.pause();
    } catch (error) {
      logger.error('Failed to pause focus audio', toError(error));
    }
    try {
      focusAudioPlayer.remove();
    } catch (error) {
      logger.error('Failed to remove focus audio player', toError(error));
    }
  }
  focusAudioPlayer = null;
  currentSound = null;
}

export function getFocusAudioState(): FocusAudioState {
  return focusAudioState;
}

export function subscribeFocusAudioState(listener: () => void): () => void {
  focusAudioListeners.add(listener);
  return () => {
    focusAudioListeners.delete(listener);
  };
}

export function useFocusAudioState(): FocusAudioState {
  return React.useSyncExternalStore(subscribeFocusAudioState, getFocusAudioState);
}

export async function prepareFocusAudioSound(sound: FocusAudioSound): Promise<void> {
  await ensureFocusAudioSource(sound);
}

export async function syncFocusAudio(config: FocusAudioConfig): Promise<void> {
  await lock.inLock(async () => {
    if (!config.enabled) {
      await stopInternal();
      return;
    }

    const source = await ensureFocusAudioSource(config.sound);
    await setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: config.mixWithOthers ? 'mixWithOthers' : 'doNotMix',
    });

    if (!focusAudioPlayer) {
      focusAudioPlayer = createAudioPlayer({ uri: source }, { keepAudioSessionActive: true });
      currentSound = config.sound;
    } else if (currentSound !== config.sound) {
      focusAudioPlayer.replace({ uri: source });
      currentSound = config.sound;
    }

    focusAudioPlayer.loop = true;
    focusAudioPlayer.volume = clampVolume(config.volume);
    if (!focusAudioPlayer.playing) {
      focusAudioPlayer.play();
    }
  });
}

export async function stopFocusAudio(): Promise<void> {
  await lock.inLock(async () => {
    await stopInternal();
  });
}
