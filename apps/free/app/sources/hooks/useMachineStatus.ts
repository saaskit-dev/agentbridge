import * as React from 'react';
import { useMachineCount } from '@/sync/storage';

/**
 * Returns the count of online machines.
 * Used by MainView (phone header) and SidebarView (tablet header).
 */
export function useMachineStatus() {
  const machineCount = useMachineCount();
  const onlineCount = machineCount;
  return React.useMemo(
    () => ({
      machineCount,
      onlineCount,
    }),
    [machineCount, onlineCount]
  );
}
