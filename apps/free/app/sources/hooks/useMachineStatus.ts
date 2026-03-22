import * as React from 'react';
import { useAllMachines } from '@/sync/storage';
import { isMachineOnline } from '@/utils/machineUtils';

/**
 * Returns the count of online machines.
 * Used by MainView (phone header) and SidebarView (tablet header).
 */
export function useMachineStatus() {
  const machines = useAllMachines();

  const onlineCount = React.useMemo(() => machines.filter(isMachineOnline).length, [machines]);

  return { machines, onlineCount };
}
