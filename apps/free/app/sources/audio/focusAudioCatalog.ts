export const FOCUS_AUDIO_CATEGORIES = [
  { id: 'noise', label: 'Noise' },
  { id: 'rain', label: 'Rain' },
  { id: 'nature', label: 'Nature' },
  { id: 'places', label: 'Places' },
] as const;

export const FOCUS_AUDIO_CATALOG = [
  {
    id: 'white-noise',
    label: 'White Noise',
    category: 'noise',
    uri: 'https://white-noises.com/sounds/noise/white-noise.wav',
  },
  {
    id: 'pink-noise',
    label: 'Pink Noise',
    category: 'noise',
    uri: 'https://white-noises.com/sounds/noise/pink-noise.wav',
  },
  {
    id: 'brown-noise',
    label: 'Brown Noise',
    category: 'noise',
    uri: 'https://white-noises.com/sounds/noise/brown-noise.wav',
  },
  {
    id: 'light-rain',
    label: 'Light Rain',
    category: 'rain',
    uri: 'https://white-noises.com/sounds/rain/light-rain.wav',
  },
  {
    id: 'waves',
    label: 'Waves',
    category: 'nature',
    uri: 'https://white-noises.com/sounds/nature/waves.wav',
  },
  {
    id: 'campfire',
    label: 'Campfire',
    category: 'nature',
    uri: 'https://white-noises.com/sounds/nature/campfire.wav',
  },
  {
    id: 'cafe',
    label: 'Cafe',
    category: 'places',
    uri: 'https://white-noises.com/sounds/places/cafe.wav',
  },
  {
    id: 'library',
    label: 'Library',
    category: 'places',
    uri: 'https://white-noises.com/sounds/places/library.wav',
  },
] as const;

export type FocusAudioCategory = (typeof FOCUS_AUDIO_CATEGORIES)[number]['id'];
export type FocusAudioSound = (typeof FOCUS_AUDIO_CATALOG)[number]['id'];

export const DEFAULT_FOCUS_AUDIO_SOUND: FocusAudioSound = 'brown-noise';

export const LEGACY_FOCUS_AUDIO_SOUND_MAP = {
  white: 'white-noise',
  pink: 'pink-noise',
  brown: 'brown-noise',
} as const;

const FOCUS_AUDIO_SOUND_ID_SET = new Set<string>(FOCUS_AUDIO_CATALOG.map(sound => sound.id));

export function isFocusAudioSound(value: unknown): value is FocusAudioSound {
  return typeof value === 'string' && FOCUS_AUDIO_SOUND_ID_SET.has(value);
}

export function getFocusAudioSound(sound: FocusAudioSound) {
  return FOCUS_AUDIO_CATALOG.find(item => item.id === sound)!;
}
