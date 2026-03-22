import type { ReactNode } from 'react';

export interface Command {
  id: string;
  title: string;
  subtitle?: string;
  icon?: string;
  /** When set, overrides `icon` (use for non-Ionicons content such as agent rasters). */
  iconElement?: ReactNode;
  shortcut?: string;
  category?: string;
  action: () => void | Promise<void>;
}

export interface CommandCategory {
  id: string;
  title: string;
  commands: Command[];
}
