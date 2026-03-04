import React from 'react';
import { ItemList } from '@/components/ItemList';
import { UsagePanel } from '@/components/usage/UsagePanel';

export default function UsageSettingsScreen() {
  return (
    <ItemList style={{ paddingTop: 0 }}>
      <UsagePanel />
    </ItemList>
  );
}
