import { create } from 'zustand';

type DesktopSessionTab = {
  id: string;
  title: string;
};

type DesktopSessionTabsState = {
  tabs: DesktopSessionTab[];
  openTab: (tab: DesktopSessionTab) => void;
  updateTabTitle: (id: string, title: string) => void;
  closeTab: (id: string) => void;
  closeOtherTabs: (id: string) => void;
  closeAllTabs: () => void;
  suppressUntil: Record<string, number>;
};

const pruneSuppressedTabs = (suppressUntil: Record<string, number>) =>
  Object.fromEntries(Object.entries(suppressUntil).filter(([, until]) => until > Date.now()));

const initialState = {
  tabs: [],
  suppressUntil: {},
};

const buildSuppressEntries = (ids: string[]) =>
  Object.fromEntries(ids.map(id => [id, Date.now() + 1500]));

export const desktopSessionTabsStore = create<DesktopSessionTabsState>(set => ({
  ...initialState,
  openTab: tab =>
    set(state => {
      const suppressUntil = state.suppressUntil[tab.id] ?? 0;
      const nextSuppressUntil = pruneSuppressedTabs(state.suppressUntil);
      const existing = state.tabs.find(item => item.id === tab.id);

      if (existing) {
        if (existing.title === tab.title) {
          return {
            tabs: state.tabs,
            suppressUntil: nextSuppressUntil,
          };
        }
        return {
          tabs: state.tabs.map(item => (item.id === tab.id ? { ...item, title: tab.title } : item)),
          suppressUntil: nextSuppressUntil,
        };
      }

      if (suppressUntil > Date.now()) {
        return {
          tabs: [...state.tabs, tab],
          suppressUntil: Object.fromEntries(
            Object.entries(nextSuppressUntil).filter(([id]) => id !== tab.id)
          ),
        };
      }

      return {
        tabs: [...state.tabs, tab],
        suppressUntil: nextSuppressUntil,
      };
    }),
  updateTabTitle: (id, title) =>
    set(state => {
      const existing = state.tabs.find(tab => tab.id === id);
      if (!existing) {
        return state;
      }
      if (existing.title === title) {
        return {
          tabs: state.tabs,
          suppressUntil: pruneSuppressedTabs(state.suppressUntil),
        };
      }
      return {
        tabs: state.tabs.map(tab => (tab.id === id ? { ...tab, title } : tab)),
        suppressUntil: pruneSuppressedTabs(state.suppressUntil),
      };
    }),
  closeTab: id =>
    set(state => ({
      tabs: state.tabs.filter(tab => tab.id !== id),
      suppressUntil: {
        ...pruneSuppressedTabs(state.suppressUntil),
        [id]: Date.now() + 1500,
      },
    })),
  closeOtherTabs: id =>
    set(state => {
      const nextTabs = state.tabs.filter(tab => tab.id === id);
      const removedIds = state.tabs.filter(tab => tab.id !== id).map(tab => tab.id);
      return {
        tabs: nextTabs,
        suppressUntil: {
          ...pruneSuppressedTabs(state.suppressUntil),
          ...buildSuppressEntries(removedIds),
        },
      };
    }),
  closeAllTabs: () =>
    set(state => ({
      tabs: [],
      suppressUntil: {
        ...pruneSuppressedTabs(state.suppressUntil),
        ...buildSuppressEntries(state.tabs.map(tab => tab.id)),
      },
    })),
}));

export function useDesktopSessionTabs() {
  return desktopSessionTabsStore();
}

export function useDesktopSessionTabsState<T>(selector: (state: DesktopSessionTabsState) => T) {
  return desktopSessionTabsStore(selector);
}

export function resetDesktopSessionTabsForTests() {
  desktopSessionTabsStore.setState(initialState);
}
