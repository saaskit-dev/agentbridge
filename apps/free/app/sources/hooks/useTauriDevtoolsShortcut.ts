import { useEffect } from 'react';
import { openTauriDevtools } from '@/utils/tauriDevtools';
import { isTauriDesktop } from '@/utils/tauri';

export function useTauriDevtoolsShortcut() {
  useEffect(() => {
    if (!isTauriDesktop()) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      const isF12 = event.key === 'F12';
      const isMacInspectorShortcut =
        event.metaKey && event.altKey && event.key.toLowerCase() === 'i';

      if (!isF12 && !isMacInspectorShortcut) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      void openTauriDevtools();
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, []);
}
