import React from 'react';
import { useWindowDimensions } from 'react-native';
import { useLocalSettingMutable } from '@/sync/storage';
import { isTauriDesktop } from '@/utils/tauri';

const DEFAULT_FILES_SIDEBAR_WIDTH = 320;

export function useDesktopSessionFilesSidebar(): {
  width: number;
  setWidth: (width: number) => void;
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
  defaultWidth: number;
} {
  const { width: windowWidth } = useWindowDimensions();
  const [storedWidth, setStoredWidth] = useLocalSettingMutable('sessionFilesSidebarWidth');
  const [storedCollapsed, setStoredCollapsed] = useLocalSettingMutable(
    'sessionFilesSidebarCollapsed'
  );

  const defaultWidth = React.useMemo(() => {
    return Math.min(Math.max(Math.floor(windowWidth * 0.26), 280), 380);
  }, [windowWidth]);

  const width = React.useMemo(() => {
    if (!isTauriDesktop()) {
      return DEFAULT_FILES_SIDEBAR_WIDTH;
    }

    return storedWidth ?? defaultWidth;
  }, [defaultWidth, storedWidth]);

  return {
    width,
    setWidth: setStoredWidth,
    collapsed: isTauriDesktop() ? (storedCollapsed ?? true) : false,
    setCollapsed: setStoredCollapsed,
    defaultWidth,
  };
}
