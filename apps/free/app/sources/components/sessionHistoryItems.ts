import type { Session } from '@/sync/storageTypes';
import { t } from '@/text';
import { getSessionAvatarId, getSessionName, getSessionSubtitle } from '@/utils/sessionUtils';

export type SessionHistoryItem =
  | {
      type: 'date-header';
      date: string;
      key: string;
    }
  | {
      type: 'session';
      key: string;
      session: Session;
      sessionName: string;
      sessionSubtitle: string;
      avatarId: string;
      cardPosition: 'single' | 'first' | 'middle' | 'last';
    };

function formatDateHeader(date: Date): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const sessionDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (sessionDate.getTime() === today.getTime()) {
    return t('sessionHistory.today');
  }
  if (sessionDate.getTime() === yesterday.getTime()) {
    return t('sessionHistory.yesterday');
  }

  const diffTime = today.getTime() - sessionDate.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  return t('sessionHistory.daysAgo', { count: diffDays });
}

export function buildSessionHistoryItems(sessions: Session[]): SessionHistoryItem[] {
  const items: SessionHistoryItem[] = [];
  let currentDateString: string | null = null;
  let currentGroup: Session[] = [];

  const pushGroup = () => {
    if (currentGroup.length === 0 || !currentDateString) {
      return;
    }

    items.push({
      type: 'date-header',
      date: formatDateHeader(new Date(currentDateString)),
      key: `date-${currentDateString}`,
    });

    currentGroup.forEach((session, index) => {
      const isFirst = index === 0;
      const isLast = index === currentGroup.length - 1;
      const cardPosition =
        currentGroup.length === 1 ? 'single' : isFirst ? 'first' : isLast ? 'last' : 'middle';

      items.push({
        type: 'session',
        key: `session-${session.id}`,
        session,
        sessionName: getSessionName(session),
        sessionSubtitle: getSessionSubtitle(session),
        avatarId: getSessionAvatarId(session),
        cardPosition,
      });
    });
  };

  for (const session of sessions) {
    const sessionDate = new Date(session.updatedAt);
    const dateString = sessionDate.toDateString();

    if (currentDateString !== dateString) {
      pushGroup();
      currentDateString = dateString;
      currentGroup = [session];
      continue;
    }

    currentGroup.push(session);
  }

  pushGroup();
  return items;
}
