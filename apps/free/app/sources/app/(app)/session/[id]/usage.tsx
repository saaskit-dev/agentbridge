import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { ItemList } from '@/components/ItemList';
import { UsagePanel } from '@/components/usage/UsagePanel';
import type { UsageGroupDimension } from '@/sync/apiUsage';

type BreakdownDimension = Exclude<UsageGroupDimension, 'none'>;

function isBreakdownDimension(value: string | undefined): value is BreakdownDimension {
  return value === 'agent' || value === 'model' || value === 'startedBy';
}

export default function SessionUsageScreen() {
  const params = useLocalSearchParams<{
    id?: string | string[];
    dimension?: string | string[];
    value?: string | string[];
  }>();

  const sessionId = Array.isArray(params.id) ? params.id[0] : params.id;
  const dimensionParam = Array.isArray(params.dimension) ? params.dimension[0] : params.dimension;
  const selectedValue = Array.isArray(params.value) ? params.value[0] : params.value;

  return (
    <ItemList style={{ paddingTop: 0 }}>
      <UsagePanel
        sessionId={sessionId}
        lockSession
        initialBreakdownDimension={isBreakdownDimension(dimensionParam) ? dimensionParam : 'agent'}
        initialSelectedBreakdownValue={selectedValue ?? null}
      />
    </ItemList>
  );
}
