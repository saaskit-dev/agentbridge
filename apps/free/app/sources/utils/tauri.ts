import { Platform } from 'react-native';

export function isTauriDesktop(): boolean {
  return (
    Platform.OS === 'web' &&
    typeof window !== 'undefined' &&
    (window as any).__TAURI_INTERNALS__ !== undefined
  );
}
