import * as React from 'react';
import { CommandSuggestion, FileMentionSuggestion } from '@/components/AgentInputSuggestionView';
import { searchCommands, CommandItem } from '@/sync/suggestionCommands';
import { searchFiles, FileItem } from '@/sync/suggestionFile';
import { Logger, toError } from '@saaskit-dev/agentbridge/telemetry';
const logger = new Logger('app/components/autocomplete/suggestions');

export async function getCommandSuggestions(
  sessionId: string,
  query: string
): Promise<
  {
    key: string;
    text: string;
    component: React.ComponentType;
  }[]
> {
  // Remove the "/" prefix for searching
  const searchTerm = query.slice(1);

  try {
    // Use the command search cache with fuzzy matching
    const commands = await searchCommands(sessionId, searchTerm, { limit: 5 });
    const seen = new Set<string>();

    // Convert CommandItem to suggestion format
    return commands
      .filter((cmd: CommandItem) => {
        const key = `cmd-${cmd.command}`;
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      })
      .map((cmd: CommandItem) => ({
        key: `cmd-${cmd.command}`,
        text: `/${cmd.command}`,
        component: () =>
          React.createElement(CommandSuggestion, {
            command: cmd.command,
            description: cmd.description,
          }),
      }));
  } catch (error) {
    logger.error('Error fetching command suggestions:', toError(error));
    // Return empty array on error
    return [];
  }
}

export async function getFileMentionSuggestions(
  sessionId: string,
  query: string
): Promise<
  {
    key: string;
    text: string;
    component: React.ComponentType;
  }[]
> {
  // Remove the "@" prefix for searching
  const searchTerm = query.slice(1);

  try {
    // Use the file search cache with fuzzy matching
    const files = await searchFiles(sessionId, searchTerm, { limit: 5 });
    const seen = new Set<string>();

    // Convert FileItem to suggestion format
    return files
      .filter((file: FileItem) => {
        const key = `file-${file.fullPath}`;
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      })
      .map((file: FileItem) => ({
        key: `file-${file.fullPath}`,
        text: `@${file.fullPath}`, // Full path in the mention
        component: () =>
          React.createElement(FileMentionSuggestion, {
            fileName: file.fileName,
            filePath: file.filePath,
            fileType: file.fileType,
          }),
      }));
  } catch (error) {
    logger.error('Error fetching file suggestions:', toError(error));
    // Return empty array on error
    return [];
  }
}

export async function getSuggestions(
  sessionId: string,
  query: string
): Promise<
  {
    key: string;
    text: string;
    component: React.ComponentType;
  }[]
> {
  logger.debug('💡 getSuggestions called with query:', JSON.stringify(query));

  if (!query || query.length === 0) {
    logger.debug('💡 getSuggestions: Empty query, returning empty array');
    return [];
  }

  // Check if it's a command (starts with /)
  if (query.startsWith('/')) {
    logger.debug('💡 getSuggestions: Command detected');
    const result = await getCommandSuggestions(sessionId, query);
    logger.debug(
      '💡 getSuggestions: Command suggestions:',
      JSON.stringify(
        result.map(r => ({
          key: r.key,
          text: r.text,
          component: '[Function]',
        })),
        null,
        2
      )
    );
    return result;
  }

  // Check if it's a file mention (starts with @)
  if (query.startsWith('@')) {
    logger.debug('💡 getSuggestions: File mention detected');
    const result = await getFileMentionSuggestions(sessionId, query);
    logger.debug(
      '💡 getSuggestions: File suggestions:',
      JSON.stringify(
        result.map(r => ({
          key: r.key,
          text: r.text,
          component: '[Function]',
        })),
        null,
        2
      )
    );
    return result;
  }

  // No suggestions for other queries
  logger.debug('💡 getSuggestions: No matching prefix, returning empty array');
  return [];
}
