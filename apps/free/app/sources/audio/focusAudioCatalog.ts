export const FOCUS_AUDIO_CATEGORIES = [
  { id: 'rain', label: 'Rain' },
  { id: 'nature', label: 'Nature' },
  { id: 'places', label: 'Places' },
] as const;

export const FOCUS_AUDIO_CATALOG = [
  {
    id: 'light-rain',
    label: 'Light Rain',
    category: 'rain',
    uri: 'https://white-noises.com/sounds/rain/light-rain.mp3',
  },
  {
    id: 'waves',
    label: 'Waves',
    category: 'nature',
    uri: 'https://white-noises.com/sounds/nature/waves.mp3',
  },
  {
    id: 'campfire',
    label: 'Campfire',
    category: 'nature',
    uri: 'https://white-noises.com/sounds/nature/campfire.mp3',
  },
  {
    id: 'cafe',
    label: 'Cafe',
    category: 'places',
    uri: 'https://white-noises.com/sounds/places/cafe.mp3',
  },
  {
    id: 'library',
    label: 'Library',
    category: 'places',
    uri: 'https://white-noises.com/sounds/places/library.mp3',
  },
] as const;

export type FocusAudioCategory = (typeof FOCUS_AUDIO_CATEGORIES)[number]['id'];
export type FocusAudioSound = (typeof FOCUS_AUDIO_CATALOG)[number]['id'];

export const DEFAULT_FOCUS_AUDIO_SOUND: FocusAudioSound = 'light-rain';

export const LEGACY_FOCUS_AUDIO_SOUND_MAP = {
  white: DEFAULT_FOCUS_AUDIO_SOUND,
  pink: DEFAULT_FOCUS_AUDIO_SOUND,
  brown: DEFAULT_FOCUS_AUDIO_SOUND,
  'white-noise': DEFAULT_FOCUS_AUDIO_SOUND,
  'pink-noise': DEFAULT_FOCUS_AUDIO_SOUND,
  'brown-noise': DEFAULT_FOCUS_AUDIO_SOUND,
} as const;

const FOCUS_AUDIO_SOUND_ID_SET = new Set<string>(FOCUS_AUDIO_CATALOG.map(sound => sound.id));

export function isFocusAudioSound(value: unknown): value is FocusAudioSound {
  return typeof value === 'string' && FOCUS_AUDIO_SOUND_ID_SET.has(value);
}

export function getFocusAudioSound(sound: FocusAudioSound) {
  return FOCUS_AUDIO_CATALOG.find(item => item.id === sound)!;
}
