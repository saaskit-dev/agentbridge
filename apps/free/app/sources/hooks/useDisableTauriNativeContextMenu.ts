import React from 'react';
import { isTauriDesktop } from '@/utils/tauri';

export function useDisableTauriNativeContextMenu() {
  React.useEffect(() => {
    if (!isTauriDesktop()) {
      return;
    }
    // Custom desktop context menus already call preventDefault() locally.
    // Avoid a global window-level override so native copy/paste and spellcheck
    // continue to work in inputs and preview panes.
  }, []);
}
