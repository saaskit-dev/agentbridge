#!/usr/bin/env node
/**
 * Dev variant MCP STDIO Bridge entry point
 *
 * Auto-injects APP_ENV=development and FREE_HOME_DIR=~/.free-dev
 * so `free-mcp-dev` can coexist with the production `free-mcp` command.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

process.env.APP_ENV = 'development';
process.env.FREE_HOME_DIR = process.env.FREE_HOME_DIR || join(homedir(), '.free-dev');

await import('./mcp-bridge.js');
