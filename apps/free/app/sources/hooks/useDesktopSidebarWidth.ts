import React from 'react';
import { useWindowDimensions } from 'react-native';
import { useLocalSettingMutable } from '@/sync/storage';
import { isTauriDesktop } from '@/utils/tauri';
import { getDefaultSidebarWidth } from '@/utils/sidebarSizing';

export function useDesktopSidebarWidth(): {
  width: number;
  setWidth: (width: number) => void;
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
  defaultWidth: number;
} {
  const { width: windowWidth } = useWindowDimensions();
  const [storedWidth, setStoredWidth] = useLocalSettingMutable('sidebarWidth');
  const [storedCollapsed, setStoredCollapsed] = useLocalSettingMutable('sidebarCollapsed');
  const defaultWidth = React.useMemo(() => getDefaultSidebarWidth(windowWidth), [windowWidth]);

  const width = React.useMemo(() => {
    if (!isTauriDesktop()) {
      return defaultWidth;
    }

    return storedWidth ?? defaultWidth;
  }, [defaultWidth, storedWidth, windowWidth]);

  const collapsed = isTauriDesktop() ? storedCollapsed : false;

  return {
    width,
    setWidth: setStoredWidth,
    collapsed,
    setCollapsed: setStoredCollapsed,
    defaultWidth,
  };
}
