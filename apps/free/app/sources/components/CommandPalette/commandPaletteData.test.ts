import { describe, expect, it } from 'vitest';
import { buildCommandPaletteData } from './commandPaletteData';
import type { Command } from './types';

function createCommand(id: string, title: string, category?: string, subtitle?: string): Command {
  return {
    id,
    title,
    category,
    subtitle,
    action: () => {},
  };
}

describe('commandPaletteData', () => {
  it('groups commands once and preserves input order when query is empty', () => {
    const commands = [
      createCommand('1', 'New Session', 'Sessions'),
      createCommand('2', 'Settings', 'Navigation'),
      createCommand('3', 'Recent Alpha', 'Recent Sessions'),
      createCommand('4', 'Recent Beta', 'Recent Sessions'),
    ];

    const result = buildCommandPaletteData(commands, '   ');

    expect(result.allCommands).toBe(commands);
    expect(result.categories).toEqual([
      {
        id: 'sessions',
        title: 'Sessions',
        commands: [commands[0]],
      },
      {
        id: 'navigation',
        title: 'Navigation',
        commands: [commands[1]],
      },
      {
        id: 'recent-sessions',
        title: 'Recent Sessions',
        commands: [commands[2], commands[3]],
      },
    ]);
  });

  it('filters and groups matching commands without changing ordering semantics', () => {
    const commands = [
      createCommand('1', 'Open Settings', 'Navigation'),
      createCommand('2', 'Search Sessions', 'Sessions', 'Filter history'),
      createCommand('3', 'Sync Status', 'System'),
    ];

    const result = buildCommandPaletteData(commands, 'se');

    expect(result.allCommands.map(command => command.id)).toEqual(['1', '2']);
    expect(result.categories).toEqual([
      {
        id: 'navigation',
        title: 'Navigation',
        commands: [commands[0]],
      },
      {
        id: 'sessions',
        title: 'Sessions',
        commands: [commands[1]],
      },
    ]);
  });
});
