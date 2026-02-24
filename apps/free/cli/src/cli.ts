#!/usr/bin/env node
/**
 * CLI entry point for free command
 *
 * Self-handling Node flags to suppress warnings, then imports the main CLI
 */

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Check if we're already running with the flags
const hasNoWarnings = process.execArgv.includes('--no-warnings');
const hasNoDeprecation = process.execArgv.includes('--no-deprecation');

if (!hasNoWarnings || !hasNoDeprecation) {
	// Re-exec with the correct flags
	try {
		execFileSync(process.execPath, [
			'--no-warnings',
			'--no-deprecation',
			join(dirname(fileURLToPath(import.meta.url)), 'cli.mjs'),
			...process.argv.slice(2)
		], {
			stdio: 'inherit',
			env: process.env
		});
	} catch (error: any) {
		process.exit(error.status || 1);
	}
} else {
	// We're running with the flags, import the actual CLI
	await import('./index.js');
}
