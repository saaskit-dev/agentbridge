export const SIDEBAR_MIN_WIDTH = 240;
export const SIDEBAR_MAX_WIDTH = 520;
export const SIDEBAR_HIDE_THRESHOLD = 180;
export const SIDEBAR_COLLAPSED_WIDTH = 14;

export function getDefaultSidebarWidth(windowWidth: number): number {
  return Math.min(Math.max(Math.floor(windowWidth * 0.3), 250), 360);
}

export function clampSidebarWidth(width: number): number {
  return Math.min(Math.max(Math.round(width), SIDEBAR_MIN_WIDTH), SIDEBAR_MAX_WIDTH);
}

export function isSidebarCollapsed(preferredWidth: number): boolean {
  return preferredWidth < SIDEBAR_HIDE_THRESHOLD;
}

export function resolveSidebarWidth(preferredWidth: number, windowWidth: number): number {
  if (isSidebarCollapsed(preferredWidth)) {
    return SIDEBAR_COLLAPSED_WIDTH;
  }

  return Math.min(clampSidebarWidth(preferredWidth), Math.max(SIDEBAR_MIN_WIDTH, windowWidth - 160));
}
