import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Text, Pressable, Platform } from 'react-native';
import { hapticsLight } from './haptics';
import { Typography } from '@/constants/Typography';
import type { PermissionMode } from '@/sync/sessionCapabilities';

export type { PermissionMode } from '@/sync/sessionCapabilities';

export type ModelMode =
  | string
  | null;

interface PermissionModeSelectorProps {
  mode: PermissionMode;
  onModeChange: (mode: PermissionMode) => void;
  disabled?: boolean;
}

const modeConfig: Record<PermissionMode, { label: string; icon: string; description: string }> = {
  'read-only': {
    label: 'Read Only',
    icon: 'eye',
    description: 'No writes allowed',
  },
  'accept-edits': {
    label: 'Accept Edits',
    icon: 'create',
    description: 'Auto-approve file edits',
  },
  yolo: {
    label: 'YOLO',
    icon: 'flash',
    description: 'Skip all permissions',
  },
};

const modeOrder: PermissionMode[] = ['read-only', 'accept-edits', 'yolo'];

export const PermissionModeSelector: React.FC<PermissionModeSelectorProps> = ({
  mode,
  onModeChange,
  disabled = false,
}) => {
  const currentConfig = modeConfig[mode];

  const handleTap = () => {
    hapticsLight();
    const currentIndex = modeOrder.indexOf(mode);
    const nextIndex = (currentIndex + 1) % modeOrder.length;
    onModeChange(modeOrder[nextIndex]);
  };

  return (
    <Pressable
      onPress={handleTap}
      disabled={disabled}
      hitSlop={{ top: 5, bottom: 10, left: 0, right: 0 }}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        // backgroundColor: Platform.select({
        //     ios: '#F2F2F7',
        //     android: '#E0E0E0',
        //     default: '#F2F2F7'
        // }),
        borderRadius: Platform.select({ default: 16, android: 20 }),
        paddingHorizontal: 12,
        paddingVertical: 6,
        width: 120,
        justifyContent: 'center',
        height: 32,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Ionicons name={'hammer-outline'} size={16} color={'black'} style={{ marginRight: 4 }} />
      {/* <Text style={{
                fontSize: 13,
                color: '#000',
                fontWeight: '600',
                ...Typography.default('semiBold')
            }}>
                {currentConfig.label}
            </Text> */}
    </Pressable>
  );
};
