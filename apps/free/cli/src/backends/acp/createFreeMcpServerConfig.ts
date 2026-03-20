import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { configuration } from '@/configuration';
import { projectPath } from '@/projectPath';

export interface FreeMcpServerConfig {
  command: string;
  args: string[];
}

export function createFreeMcpServerConfig(serverUrl: string): FreeMcpServerConfig {
  // Use the dev bridge entry when running in development so the child process
  // inherits APP_ENV=development and FREE_HOME_DIR automatically.
  const bridgeFile = configuration.variant === 'development' ? 'mcp-bridge-dev.mjs' : 'mcp-bridge.mjs';
  const bridgeEntry = join(projectPath(), 'dist', bridgeFile);

  if (!existsSync(bridgeEntry)) {
    throw new Error(`Free MCP bridge not found at ${bridgeEntry}. Build the CLI before starting ACP agents.`);
  }

  return {
    command: process.execPath,
    args: [bridgeEntry, '--url', serverUrl],
  };
}
