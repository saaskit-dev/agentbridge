import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { projectPath } from '@/projectPath';
import { createFreeMcpServerConfig } from './createFreeMcpServerConfig';

describe('createFreeMcpServerConfig', () => {
  it('points ACP backends at the built MCP bridge entrypoint', () => {
    const config = createFreeMcpServerConfig('http://127.0.0.1:3005/mcp');
    const bridgeEntry = join(projectPath(), 'dist', 'mcp-bridge.mjs');

    expect(existsSync(bridgeEntry)).toBe(true);
    expect(config.command).toBe(process.execPath);
    expect(config.args).toEqual([bridgeEntry, '--url', 'http://127.0.0.1:3005/mcp']);
  });
});
