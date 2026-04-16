import * as React from 'react';
import { SessionListViewItem, useSessionListViewData, useSetting } from '@/sync/storage';

export function useVisibleSessionListViewData(selectedMachineId?: string | null): SessionListViewItem[] | null {
  const data = useSessionListViewData();
  const hideInactiveSessions = useSetting('hideInactiveSessions');

  return React.useMemo(() => {
    if (!data) {
      return data;
    }

    const baseData = hideInactiveSessions
      ? (() => {
          const filtered: SessionListViewItem[] = [];
          let hiddenPendingProjectGroup: SessionListViewItem | null = null;

          for (const item of data) {
            if (item.type === 'project-group') {
              hiddenPendingProjectGroup = item;
              continue;
            }

            if (item.type === 'session') {
              if (item.session.status === 'active') {
                if (hiddenPendingProjectGroup) {
                  filtered.push(hiddenPendingProjectGroup);
                  hiddenPendingProjectGroup = null;
                }
                filtered.push(item);
              }
              continue;
            }

            hiddenPendingProjectGroup = null;

            if (item.type === 'active-sessions') {
              filtered.push(item);
            }
          }

          return filtered;
        })()
      : data;

    if (!selectedMachineId) {
      return baseData;
    }

    const machineFiltered: SessionListViewItem[] = [];
    let pendingProjectGroup: SessionListViewItem | null = null;

    for (const item of baseData) {
      if (item.type === 'project-group') {
        pendingProjectGroup = item;
        continue;
      }

      if (item.type === 'session') {
        if (item.session.metadata?.machineId === selectedMachineId) {
          if (pendingProjectGroup) {
            machineFiltered.push(pendingProjectGroup);
            pendingProjectGroup = null;
          }
          machineFiltered.push(item);
        }
        continue;
      }

      pendingProjectGroup = null;

      if (item.type === 'active-sessions') {
        const sessions = item.sessions.filter(
          session => session.metadata?.machineId === selectedMachineId
        );
        if (sessions.length > 0) {
          machineFiltered.push({ ...item, sessions });
        }
        continue;
      }

      machineFiltered.push(item);
    }

    return machineFiltered;
  }, [data, hideInactiveSessions, selectedMachineId]);
}
