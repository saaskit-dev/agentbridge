import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { desktopSessionTabsStore, resetDesktopSessionTabsForTests } from './useDesktopSessionTabs';

describe('useDesktopSessionTabs', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-13T00:00:00.000Z'));
    resetDesktopSessionTabsForTests();
  });

  afterEach(() => {
    resetDesktopSessionTabsForTests();
    vi.useRealTimers();
  });

  it('does not recreate a closed tab when only the title sync runs again', () => {
    const store = desktopSessionTabsStore.getState();

    store.openTab({ id: 'session-1', title: 'First title' });
    store.closeTab('session-1');
    store.updateTabTitle('session-1', 'Renamed');

    expect(desktopSessionTabsStore.getState().tabs).toEqual([]);
  });

  it('reopens a closed tab when the session is explicitly opened again', () => {
    const store = desktopSessionTabsStore.getState();

    store.openTab({ id: 'session-1', title: 'First title' });
    store.closeTab('session-1');
    store.openTab({ id: 'session-1', title: 'Reopened title' });

    expect(desktopSessionTabsStore.getState().tabs).toEqual([
      { id: 'session-1', title: 'Reopened title' },
    ]);
  });

  it('updates the title of an existing tab without changing tab count', () => {
    const store = desktopSessionTabsStore.getState();

    store.openTab({ id: 'session-1', title: 'Old title' });
    store.updateTabTitle('session-1', 'New title');

    expect(desktopSessionTabsStore.getState().tabs).toEqual([
      { id: 'session-1', title: 'New title' },
    ]);
  });

  it('closes other tabs while preserving the target tab', () => {
    const store = desktopSessionTabsStore.getState();

    store.openTab({ id: 'session-1', title: 'One' });
    store.openTab({ id: 'session-2', title: 'Two' });
    store.openTab({ id: 'session-3', title: 'Three' });
    store.closeOtherTabs('session-2');

    expect(desktopSessionTabsStore.getState().tabs).toEqual([{ id: 'session-2', title: 'Two' }]);
  });

  it('closes all tabs', () => {
    const store = desktopSessionTabsStore.getState();

    store.openTab({ id: 'session-1', title: 'One' });
    store.openTab({ id: 'session-2', title: 'Two' });
    store.closeAllTabs();

    expect(desktopSessionTabsStore.getState().tabs).toEqual([]);
  });
});
