import { create } from 'zustand';

type DesktopSessionTab = {
  id: string;
  title: string;
};

type DesktopSessionTabsState = {
  tabs: DesktopSessionTab[];
  upsertTab: (tab: DesktopSessionTab) => void;
  closeTab: (id: string) => void;
  suppressUntil: Record<string, number>;
};

const useDesktopSessionTabsStore = create<DesktopSessionTabsState>(set => ({
  tabs: [],
  suppressUntil: {},
  upsertTab: tab =>
    set(state => {
      const suppressUntil = state.suppressUntil[tab.id] ?? 0;
      if (suppressUntil > Date.now()) {
        return state;
      }

      const existing = state.tabs.find(item => item.id === tab.id);
      if (!existing) {
        return {
          tabs: [...state.tabs, tab],
          suppressUntil: Object.fromEntries(
            Object.entries(state.suppressUntil).filter(([, until]) => until > Date.now())
          ),
        };
      }
      return {
        tabs: state.tabs.map(item => (item.id === tab.id ? { ...item, title: tab.title } : item)),
        suppressUntil: Object.fromEntries(
          Object.entries(state.suppressUntil).filter(([, until]) => until > Date.now())
        ),
      };
    }),
  closeTab: id =>
    set(state => ({
      tabs: state.tabs.filter(tab => tab.id !== id),
      suppressUntil: {
        ...Object.fromEntries(
          Object.entries(state.suppressUntil).filter(([, until]) => until > Date.now())
        ),
        [id]: Date.now() + 1500,
      },
    })),
}));

export function useDesktopSessionTabs() {
  return useDesktopSessionTabsStore();
}
