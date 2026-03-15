import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { projectPath } from '@/projectPath';

export interface FreeMcpServerConfig {
  command: string;
  args: string[];
}

export function createFreeMcpServerConfig(serverUrl: string): FreeMcpServerConfig {
  const bridgeEntry = join(projectPath(), 'dist', 'mcp-bridge.mjs');

  if (!existsSync(bridgeEntry)) {
    throw new Error(`Free MCP bridge not found at ${bridgeEntry}. Build the CLI before starting ACP agents.`);
  }

  return {
    command: process.execPath,
    args: [bridgeEntry, '--url', serverUrl],
  };
}
