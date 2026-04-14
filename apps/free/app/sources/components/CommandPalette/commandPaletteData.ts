import { Command, CommandCategory } from './types';

export interface CommandPaletteData {
  categories: CommandCategory[];
  allCommands: Command[];
}

function categoryId(title: string): string {
  return title.toLowerCase().replace(/\s+/g, '-');
}

function buildGroupedCategories(commands: Command[], fallbackCategory: string): CommandCategory[] {
  const grouped = new Map<string, Command[]>();

  for (const command of commands) {
    const title = command.category || fallbackCategory;
    const existing = grouped.get(title);
    if (existing) {
      existing.push(command);
      continue;
    }
    grouped.set(title, [command]);
  }

  return Array.from(grouped, ([title, categoryCommands]) => ({
    id: categoryId(title),
    title,
    commands: categoryCommands,
  }));
}

export function buildCommandPaletteData(commands: Command[], searchQuery: string): CommandPaletteData {
  const normalizedQuery = searchQuery.trim().toLowerCase();
  if (!normalizedQuery) {
    return {
      categories: buildGroupedCategories(commands, 'General'),
      allCommands: commands,
    };
  }

  const filteredCommands: Command[] = [];
  for (const command of commands) {
    const titleMatch = command.title.toLowerCase().includes(normalizedQuery);
    const subtitleMatch = command.subtitle?.toLowerCase().includes(normalizedQuery) ?? false;
    if (titleMatch || subtitleMatch) {
      filteredCommands.push(command);
    }
  }

  if (filteredCommands.length === 0) {
    return {
      categories: [],
      allCommands: [],
    };
  }

  return {
    categories: buildGroupedCategories(filteredCommands, 'Results'),
    allCommands: filteredCommands,
  };
}
