import { Ionicons } from '@expo/vector-icons';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import type { PermissionMode } from '@/components/PermissionModeSelector';
import { useSettingMutable } from '@/sync/storage';
import { t } from '@/text';

const permissionModeOptions: {
  mode: PermissionMode;
  label: string;
  description: string;
  icon: string;
}[] = [
  {
    mode: 'yolo',
    label: 'YOLO',
    description: 'Skip all permissions automatically',
    icon: 'rocket',
  },
  {
    mode: 'safe-yolo',
    label: 'Safe YOLO',
    description: 'Skip most permissions, ask for critical ones',
    icon: 'shield',
  },
  {
    mode: 'bypassPermissions',
    label: 'Bypass Permissions',
    description: 'Skip all permission checks',
    icon: 'flash',
  },
  {
    mode: 'acceptEdits',
    label: 'Accept Edits',
    description: 'Auto-approve file edits',
    icon: 'create',
  },
  {
    mode: 'default',
    label: 'Default',
    description: 'Ask for permissions as needed',
    icon: 'shield-checkmark',
  },
  { mode: 'plan', label: 'Plan', description: 'Plan before executing', icon: 'list' },
  {
    mode: 'read-only',
    label: 'Read-only',
    description: 'No file modifications allowed',
    icon: 'eye',
  },
];

export default function PermissionModeSettingsScreen() {
  const [defaultPermissionMode, setDefaultPermissionMode] =
    useSettingMutable('defaultPermissionMode');

  return (
    <ItemList style={{ paddingTop: 0 }}>
      <ItemGroup
        title={t('settingsFeatures.defaultPermissionMode')}
        footer={t('settingsFeatures.defaultPermissionModeSubtitle')}
      >
        {permissionModeOptions.map(option => (
          <Item
            key={option.mode}
            title={option.label}
            subtitle={option.description}
            icon={<Ionicons name={option.icon as any} size={29} color="#007AFF" />}
            onPress={() => setDefaultPermissionMode(option.mode)}
            showChevron={false}
            rightElement={
              defaultPermissionMode === option.mode ? (
                <Ionicons name="checkmark" size={24} color="#007AFF" />
              ) : undefined
            }
          />
        ))}
      </ItemGroup>
    </ItemList>
  );
}
