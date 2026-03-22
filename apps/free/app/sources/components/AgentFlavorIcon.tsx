import { Image } from 'expo-image';
import * as React from 'react';
import type { ImageStyle, StyleProp } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import type { SessionFlavor } from '@/sync/agentFlavor';
import { normalizeAgentFlavor } from '@/sync/agentFlavor';
import { getAgentFlavorIconSource } from '@/sync/agentIcons';

export interface AgentFlavorIconProps {
  /** Raw session / agent flavor string; normalized the same way as `Avatar`. */
  flavor: SessionFlavor | null | undefined;
  /** Width and height of the raster icon (logical px). */
  size?: number;
  style?: StyleProp<ImageStyle>;
  contentFit?: 'contain' | 'cover' | 'fill' | 'scale-down' | 'none';
  /**
   * Tint override: `undefined` = Codex uses theme text (matches `Avatar`), `null` = never tint.
   */
  tintColor?: string | null;
}

/**
 * Single place to render an agent / provider badge as the shared PNG set (`AGENT_FLAVOR_ICONS`).
 *
 * Sources: OpenCode `https://opencode.ai/apple-touch-icon-v3.png` (see opencode.ai/brand);
 * Cursor `https://www.cursor.com/assets/images/logo.svg` rasterized in-repo; others unchanged.
 */
export const AgentFlavorIcon = React.memo(function AgentFlavorIcon({
  flavor,
  size = 20,
  style,
  contentFit = 'contain',
  tintColor,
}: AgentFlavorIconProps) {
  const { theme } = useUnistyles();
  const effectiveFlavor = normalizeAgentFlavor(flavor);
  const source = getAgentFlavorIconSource(flavor);

  const resolvedTint =
    tintColor !== undefined
      ? (tintColor ?? undefined)
      : effectiveFlavor === 'codex'
        ? theme.colors.text
        : undefined;

  return (
    <Image
      source={source}
      style={[{ width: size, height: size }, style]}
      contentFit={contentFit}
      tintColor={resolvedTint}
    />
  );
});
