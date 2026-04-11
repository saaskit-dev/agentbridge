import { Dimensions, Platform } from 'react-native';
import { isDesktopPlatform, isRunningOnMac } from '@/utils/platform';
import { getDeviceType } from '@/utils/responsive';

function isWebRuntime(): boolean {
  return Platform.OS === 'web';
}

// Calculate max width based on device type
function getMaxWidth(): number {
  const deviceType = getDeviceType();

  // For phones, use the max dimension (width or height)
  if (deviceType === 'phone' && !isWebRuntime()) {
    const { width, height } = Dimensions.get('window');
    return Math.max(width, height);
  }

  if (isDesktopPlatform()) {
    return Number.POSITIVE_INFINITY;
  }

  // For tablets and web, use 800px
  return 800;
}

// Calculate max width based on device type
function getMaxLayoutWidth(): number {
  const deviceType = getDeviceType();

  // For phones, use the max dimension (width or height)
  if (deviceType === 'phone' && !isWebRuntime()) {
    const { width, height } = Dimensions.get('window');
    return Math.max(width, height);
  }

  if (isRunningOnMac()) {
    return 1400;
  }

  // For tablets and web, use 800px
  return 800;
}

export const layout = {
  maxWidth: getMaxLayoutWidth(),
  headerMaxWidth: getMaxWidth(),
};

// On web, update layout values when the window resizes so that inline style
// references (not StyleSheet captures) pick up the new value on next render.
if (isWebRuntime()) {
  Dimensions.addEventListener('change', () => {
    layout.maxWidth = getMaxLayoutWidth();
    layout.headerMaxWidth = getMaxWidth();
  });
}
