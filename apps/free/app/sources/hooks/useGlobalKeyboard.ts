import { useEffect } from 'react';
import { Platform } from 'react-native';

type GlobalKeyboardHandlers = {
  onCommandPalette: () => void;
  onNewSession?: () => void;
  onSettings?: () => void;
};

export function useGlobalKeyboard(handlersOrCallback: GlobalKeyboardHandlers | (() => void)) {
  useEffect(() => {
    if (Platform.OS !== 'web') {
      return;
    }

    const handlers: GlobalKeyboardHandlers =
      typeof handlersOrCallback === 'function'
        ? { onCommandPalette: handlersOrCallback }
        : handlersOrCallback;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Check for CMD+K (Mac) or Ctrl+K (Windows/Linux)
      const isModifierPressed = e.metaKey || e.ctrlKey;

      if (isModifierPressed && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        e.stopPropagation();
        handlers.onCommandPalette();
        return;
      }

      if (isModifierPressed && e.key.toLowerCase() === 'n' && handlers.onNewSession) {
        e.preventDefault();
        e.stopPropagation();
        handlers.onNewSession();
        return;
      }

      if (isModifierPressed && e.key === ',' && handlers.onSettings) {
        e.preventDefault();
        e.stopPropagation();
        handlers.onSettings();
      }
    };

    // Add event listener
    window.addEventListener('keydown', handleKeyDown);

    // Cleanup
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handlersOrCallback]);
}
