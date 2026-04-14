import { Slot } from 'expo-router';
import { Drawer } from 'expo-router/drawer';
import * as React from 'react';
import { Platform, Pressable, View, useWindowDimensions, type ViewStyle } from 'react-native';
import { SidebarView } from './SidebarView';
import { useAuth } from '@/auth/AuthContext';
import { useDesktopSidebarWidth } from '@/hooks/useDesktopSidebarWidth';
import { useIsTablet } from '@/utils/responsive';
import {
  SIDEBAR_COLLAPSED_WIDTH,
  SIDEBAR_HIDE_THRESHOLD,
  SIDEBAR_MIN_WIDTH,
  clampSidebarWidth,
  resolveSidebarWidth,
} from '@/utils/sidebarSizing';

function setResizeCursor(active: boolean) {
  if (typeof document === 'undefined') {
    return;
  }

  document.body.style.cursor = active ? 'col-resize' : '';
  document.body.style.userSelect = active ? 'none' : '';
}

export const SidebarNavigator = React.memo(() => {
  const auth = useAuth();
  const isTablet = useIsTablet();
  const showPermanentDrawer = auth.isAuthenticated && isTablet;
  const { width: windowWidth } = useWindowDimensions();
  const {
    width: preferredSidebarWidth,
    setWidth: setPreferredSidebarWidth,
    collapsed,
    setCollapsed,
    defaultWidth,
  } = useDesktopSidebarWidth();
  const canResize = Platform.OS === 'web' && showPermanentDrawer;
  const [isDragging, setIsDragging] = React.useState(false);
  const [isHovering, setIsHovering] = React.useState(false);

  const drawerWidth = React.useMemo(() => {
    if (!showPermanentDrawer) return 280;
    return resolveSidebarWidth(collapsed ? 0 : preferredSidebarWidth, windowWidth);
  }, [windowWidth, showPermanentDrawer, preferredSidebarWidth, collapsed]);

  const startResize = React.useCallback(
    (startClientX: number) => {
      if (!canResize || typeof window === 'undefined') {
        return;
      }

      const handleMove = (event: MouseEvent) => {
        const nextWidth = event.clientX;
        if (nextWidth < SIDEBAR_HIDE_THRESHOLD) {
          setCollapsed(true);
          return;
        }

        const maxVisibleWidth = Math.max(SIDEBAR_MIN_WIDTH, window.innerWidth - 160);
        setCollapsed(false);
        setPreferredSidebarWidth(Math.min(clampSidebarWidth(nextWidth), maxVisibleWidth));
      };

      const handleUp = (event: MouseEvent) => {
        handleMove(event);
        setIsDragging(false);
        setResizeCursor(false);
        window.removeEventListener('mousemove', handleMove);
        window.removeEventListener('mouseup', handleUp);
      };

      setIsDragging(true);
      setResizeCursor(true);
      window.addEventListener('mousemove', handleMove);
      window.addEventListener('mouseup', handleUp);
      handleMove({ clientX: startClientX } as MouseEvent);
    },
    [canResize, setCollapsed, setPreferredSidebarWidth]
  );

  const drawerNavigationOptions = React.useMemo(() => {
    if (!showPermanentDrawer) {
      // When drawer is hidden, use minimal configuration
      return {
        lazy: false,
        headerShown: false,
        drawerType: 'front' as const,
        swipeEnabled: false,
        drawerStyle: {
          width: 0,
          display: 'none' as const,
        },
      };
    }

    // When drawer is permanent
    return {
      lazy: false,
      headerShown: false,
      drawerType: 'permanent' as const,
      drawerStyle: {
        backgroundColor: 'white',
        borderRightWidth: 0,
        width: drawerWidth,
      },
      swipeEnabled: false,
      drawerActiveTintColor: 'transparent',
      drawerInactiveTintColor: 'transparent',
      drawerItemStyle: { display: 'none' as const },
      drawerLabelStyle: { display: 'none' as const },
    };
  }, [showPermanentDrawer, drawerWidth]);

  const drawerContent = React.useCallback(() => {
    if (!showPermanentDrawer) {
      return null;
    }

    const resizeHandleStyle: ViewStyle = {
      position: 'absolute',
      top: 0,
      right: 0,
      width: collapsed ? SIDEBAR_COLLAPSED_WIDTH : 12,
      height: '100%',
      backgroundColor:
        collapsed || isDragging || isHovering ? 'rgba(0, 0, 0, 0.08)' : 'transparent',
      borderLeftWidth: !collapsed && (isDragging || isHovering) ? 1 : 0,
      borderLeftColor: 'rgba(0, 0, 0, 0.12)',
      borderRightWidth: collapsed ? 1 : 0,
      borderRightColor: 'rgba(0, 0, 0, 0.08)',
    };

    return (
      <View style={{ flex: 1, position: 'relative', overflow: 'visible' }}>
        {!collapsed ? <SidebarView /> : null}
        {canResize ? (
          <Pressable
            onPress={() => {
              if (collapsed) {
                setCollapsed(false);
                setPreferredSidebarWidth(defaultWidth);
              }
            }}
            // @ts-ignore React Native Web mouse event typing
            onMouseDown={(event: any) => {
              startResize(event.clientX ?? event.nativeEvent?.clientX ?? drawerWidth);
            }}
            onHoverIn={() => setIsHovering(true)}
            onHoverOut={() => setIsHovering(false)}
            // @ts-ignore React Native Web event typing
            onDoubleClick={() => {
              const nextCollapsed = !collapsed;
              setCollapsed(nextCollapsed);
              if (!nextCollapsed) {
                setPreferredSidebarWidth(defaultWidth);
              }
            }}
            style={[resizeHandleStyle, { cursor: 'col-resize' } as any]}
          />
        ) : null}
      </View>
    );
  }, [
    canResize,
    collapsed,
    defaultWidth,
    drawerWidth,
    isDragging,
    isHovering,
    setCollapsed,
    setPreferredSidebarWidth,
    showPermanentDrawer,
    startResize,
  ]);

  return (
    <Drawer
      screenOptions={drawerNavigationOptions}
      drawerContent={showPermanentDrawer ? drawerContent : undefined}
    />
  );
});
