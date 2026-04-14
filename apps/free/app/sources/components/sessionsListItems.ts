import type { SessionListViewItem } from '@/sync/storage';
import type { Machine, Session } from '@/sync/storageTypes';
import { getSessionAvatarId, getSessionName, getSessionSubtitle } from '@/utils/sessionUtils';

export type SessionsListCardPosition = 'single' | 'first' | 'middle' | 'last';

export type SessionsListRenderItem =
  | { type: 'header'; title: string; key: string }
  | { type: 'active-sessions'; sessions: Session[]; key: string; selectedSessionId?: string }
  | { type: 'project-group'; displayPath: string; machine: Machine; key: string }
  | {
      type: 'session';
      session: Session;
      variant?: 'default' | 'no-path';
      key: string;
      selected: boolean;
      cardPosition: SessionsListCardPosition;
      sessionName: string;
      sessionSubtitle: string;
      avatarId: string;
    };

export function buildSessionsListItems(
  items: SessionListViewItem[],
  selectedSessionId?: string
): SessionsListRenderItem[] {
  return items.map((item, index) => {
    switch (item.type) {
      case 'header':
        return {
          ...item,
          key: `header-${item.title}-${index}`,
        };
      case 'active-sessions':
        return {
          ...item,
          key: 'active-sessions',
          selectedSessionId,
        };
      case 'project-group':
        return {
          ...item,
          key: `project-group-${item.machine.id}-${item.displayPath}-${index}`,
        };
      case 'session': {
        const prevItem = index > 0 ? items[index - 1] : null;
        const nextItem = index < items.length - 1 ? items[index + 1] : null;
        const isFirst = prevItem?.type === 'header';
        const isLast =
          nextItem?.type === 'header' || nextItem == null || nextItem?.type === 'active-sessions';
        const cardPosition: SessionsListCardPosition = isFirst
          ? isLast
            ? 'single'
            : 'first'
          : isLast
            ? 'last'
            : 'middle';

        return {
          ...item,
          key: `session-${item.session.id}`,
          selected: item.session.id === selectedSessionId,
          cardPosition,
          sessionName: getSessionName(item.session),
          sessionSubtitle: getSessionSubtitle(item.session),
          avatarId: getSessionAvatarId(item.session),
        };
      }
    }
  });
}
