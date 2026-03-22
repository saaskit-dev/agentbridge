import type { ImageSourcePropType } from 'react-native';
import type { DisplayAgentFlavor, SessionFlavor } from '@/sync/agentFlavor';
import { normalizeAgentFlavor } from '@/sync/agentFlavor';

/**
 * Bundled 1× PNG sources per displayable agent flavor (Metro also resolves @2x / @3x siblings).
 * Brand provenance is documented on `AgentFlavorIcon`.
 */
export const AGENT_FLAVOR_ICONS: Record<DisplayAgentFlavor, ImageSourcePropType> = {
  claude: require('@/assets/images/icon-claude.png'),
  codex: require('@/assets/images/icon-gpt.png'),
  gemini: require('@/assets/images/icon-gemini.png'),
  opencode: require('@/assets/images/icon-opencode.png'),
  cursor: require('@/assets/images/icon-cursor.png'),
};

/**
 * Returns the raster icon source for a session / agent flavor (unknown values map like `normalizeAgentFlavor`).
 */
export function getAgentFlavorIconSource(
  flavor: SessionFlavor | null | undefined
): ImageSourcePropType {
  const key = normalizeAgentFlavor(flavor ?? 'claude');
  return AGENT_FLAVOR_ICONS[key];
}

/**
 * Whether this flavor's icon is a monochrome silhouette that needs tinting to match the theme.
 * Icons: codex (GPT knot), cursor (cube), opencode (terminal) are black-on-transparent.
 */
export function isMonochromeFlavor(flavor: DisplayAgentFlavor): boolean {
  return flavor === 'codex' || flavor === 'cursor' || flavor === 'opencode';
}

/**
 * Diameter of the circular badge behind the overlay icon in `Avatar` (fraction of avatar size).
 */
export function getAgentFlavorBadgeContainerSize(avatarSize: number): number {
  return Math.round(avatarSize * 0.35);
}

/**
 * Raster size inside the avatar flavor badge — matches existing Avatar proportions.
 */
export function getAgentFlavorBadgeIconSize(
  avatarSize: number,
  flavor: DisplayAgentFlavor
): number {
  if (flavor === 'claude') {
    return Math.round(avatarSize * 0.28);
  }
  if (flavor === 'gemini') {
    return Math.round(avatarSize * 0.35);
  }
  // Monochrome silhouettes (codex, cursor, opencode) use a slightly smaller size
  return Math.round(avatarSize * 0.25);
}
