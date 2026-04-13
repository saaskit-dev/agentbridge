import * as React from 'react';
import { Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { isDesktopPlatform } from '@/utils/platform';

function shortcutLabel(label: string): string {
  if (Platform.OS === 'web') return label;
  return label.replace(/Cmd\//g, '').replace(/Ctrl\+/g, '');
}

export default function KeyboardShortcutsScreen() {
  const isDesktop = isDesktopPlatform();

  return (
    <ItemList style={{ paddingTop: 0 }}>
      <ItemGroup
        title="Keyboard Shortcuts"
        footer={
          isDesktop
            ? 'Desktop shortcuts work on web and desktop-class builds. Inside text inputs, typing keeps priority unless the shortcut is explicitly global.'
            : 'Shortcuts are mainly intended for web and desktop-class builds.'
        }
      >
        <Item
          title="Open Command Palette"
          subtitle="Open the searchable action launcher from anywhere."
          detail={shortcutLabel('Cmd/Ctrl+K')}
          icon={<Ionicons name="search-outline" size={22} color="#007AFF" />}
          showChevron={false}
        />
        <Item
          title="New Session"
          subtitle="Start a new chat session."
          detail={shortcutLabel('Cmd/Ctrl+N')}
          icon={<Ionicons name="add-circle-outline" size={22} color="#34C759" />}
          showChevron={false}
        />
        <Item
          title="Open Settings"
          subtitle="Jump straight to the settings screen."
          detail={shortcutLabel('Cmd/Ctrl+,')}
          icon={<Ionicons name="settings-outline" size={22} color="#5856D6" />}
          showChevron={false}
        />
      </ItemGroup>

      <ItemGroup title="Session">
        <Item
          title="Toggle Main Sidebar"
          subtitle="Collapse or expand the left sidebar."
          detail={shortcutLabel('Cmd/Ctrl+B')}
          icon={<Ionicons name="browsers-outline" size={22} color="#007AFF" />}
          showChevron={false}
        />
        <Item
          title="Toggle Files Sidebar"
          subtitle="Collapse or expand the right files panel."
          detail={shortcutLabel('Cmd/Ctrl+Shift+F')}
          icon={<Ionicons name="folder-open-outline" size={22} color="#FF9500" />}
          showChevron={false}
        />
        <Item
          title="Jump To Recent User Message"
          subtitle="Move focus to the latest user prompt in the current session."
          detail={shortcutLabel('Cmd/Ctrl+Shift+R')}
          icon={<Ionicons name="return-up-back-outline" size={22} color="#AF52DE" />}
          showChevron={false}
        />
      </ItemGroup>

      <ItemGroup title="Path Picker">
        <Item
          title="Move Selection"
          subtitle="Navigate recent paths and folders."
          detail="↑ / ↓"
          icon={<Ionicons name="swap-vertical-outline" size={22} color="#007AFF" />}
          showChevron={false}
        />
        <Item
          title="Open Highlighted Folder"
          subtitle="Enter the currently highlighted row."
          detail="Enter"
          icon={<Ionicons name="arrow-forward-circle-outline" size={22} color="#34C759" />}
          showChevron={false}
        />
        <Item
          title="Confirm Current Path"
          subtitle="Save the currently typed path without leaving the keyboard."
          detail={shortcutLabel('Cmd/Ctrl+Enter')}
          icon={<Ionicons name="checkmark-circle-outline" size={22} color="#34C759" />}
          showChevron={false}
        />
        <Item
          title="Focus Path Input"
          subtitle="Jump cursor back to the path field."
          detail={shortcutLabel('Cmd/Ctrl+L')}
          icon={<Ionicons name="create-outline" size={22} color="#5856D6" />}
          showChevron={false}
        />
        <Item
          title="Go To Parent Directory"
          subtitle="Browse one level up."
          detail={shortcutLabel('Alt+↑')}
          icon={<Ionicons name="return-up-back-outline" size={22} color="#FF9500" />}
          showChevron={false}
        />
        <Item
          title="Back"
          subtitle="Close the picker and return."
          detail="Esc"
          icon={<Ionicons name="close-circle-outline" size={22} color="#FF3B30" />}
          showChevron={false}
        />
      </ItemGroup>
    </ItemList>
  );
}
