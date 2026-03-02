/**
 * Free Server Logger
 * 
 * Design decisions:
 * - All logs go to file ONLY (no stdout) to avoid polluting daemon output
 * - JSON format for easy parsing and analysis
 * - Log file: ~/.free/logs/server-<timestamp>.log
 * - Daemon process shares same log file via daemonLogPath
 */

import pino from 'pino';
import { mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// Log directory - same as CLI for consolidation
function getLogsDir(): string {
    const freeHomeDir = process.env.FREE_HOME_DIR
        ? process.env.FREE_HOME_DIR.replace(/^~/, homedir())
        : join(homedir(), '.free');
    return join(freeHomeDir, 'logs');
}

// Create log filename with timestamp
function createLogFilename(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hour = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    const sec = String(now.getSeconds()).padStart(2, '0');
    return `server-${year}-${month}-${day}-${hour}-${min}-${sec}.log`;
}

// Ensure log directory exists
const logsDir = getLogsDir();
try {
    if (!existsSync(logsDir)) {
        mkdirSync(logsDir, { recursive: true });
    }
} catch (error) {
    // Fallback to current directory if home dir is not writable
    console.error('Failed to create logs directory:', error);
}

// Log file path - single file for this server instance
const logFilePath = join(logsDir, createLogFilename());

// Create pino logger with JSON output to file
// Note: We use pino.destination for file output (synchronous by default)
const destination = pino.destination(logFilePath);

export const logger = pino(
    {
        level: process.env.LOG_LEVEL || 'debug',
        // JSON format - no pino-pretty
        formatters: {
            level: (label) => ({ level: label }),
            bindings: () => ({}), // Remove pid and hostname
        },
        timestamp: pino.stdTimeFunctions.isoTime,
    },
    destination
);

// Log the file path on startup (only once)
let loggedFilePath = false;
function ensureLoggedFilePath() {
    if (!loggedFilePath) {
        loggedFilePath = true;
        // Use console directly for this one-time message
        process.stderr.write(`[SERVER] Logs: ${logFilePath}\n`);
    }
}

/**
 * Log info level message
 * 
 * Usage:
 *   log({ module: 'auth' }, 'User authenticated: %s', userId);
 *   log('Simple message');
 */
export function log(srcOrMsg: any, ...args: any[]): void {
    ensureLoggedFilePath();
    
    if (typeof srcOrMsg === 'string') {
        // Simple case: log('message', ...args)
        logger.info({}, srcOrMsg, ...args);
    } else if (srcOrMsg && typeof srcOrMsg === 'object') {
        // Object case: log({ module: 'auth' }, 'message', ...args)
        const { level, ...metadata } = srcOrMsg;
        const logLevel = level || 'info';
        const msg = args[0] || '';
        const msgArgs = args.slice(1);
        
        // Use the appropriate log level
        switch (logLevel) {
            case 'debug':
                logger.debug(metadata, msg, ...msgArgs);
                break;
            case 'warn':
                logger.warn(metadata, msg, ...msgArgs);
                break;
            case 'error':
                logger.error(metadata, msg, ...msgArgs);
                break;
            default:
                logger.info(metadata, msg, ...msgArgs);
        }
    } else {
        logger.info({}, String(srcOrMsg), ...args);
    }
}

export function warn(srcOrMsg: any, ...args: any[]): void {
    ensureLoggedFilePath();
    
    if (typeof srcOrMsg === 'string') {
        logger.warn({}, srcOrMsg, ...args);
    } else if (srcOrMsg && typeof srcOrMsg === 'object') {
        const msg = args[0] || '';
        const msgArgs = args.slice(1);
        logger.warn(srcOrMsg, msg, ...msgArgs);
    } else {
        logger.warn({}, String(srcOrMsg), ...args);
    }
}

export function error(srcOrMsg: any, ...args: any[]): void {
    ensureLoggedFilePath();
    
    if (typeof srcOrMsg === 'string') {
        logger.error({}, srcOrMsg, ...args);
    } else if (srcOrMsg && typeof srcOrMsg === 'object') {
        const msg = args[0] || '';
        const msgArgs = args.slice(1);
        logger.error(srcOrMsg, msg, ...msgArgs);
    } else {
        logger.error({}, String(srcOrMsg), ...args);
    }
}

export function debug(srcOrMsg: any, ...args: any[]): void {
    ensureLoggedFilePath();
    
    if (typeof srcOrMsg === 'string') {
        logger.debug({}, srcOrMsg, ...args);
    } else if (srcOrMsg && typeof srcOrMsg === 'object') {
        const msg = args[0] || '';
        const msgArgs = args.slice(1);
        logger.debug(srcOrMsg, msg, ...msgArgs);
    } else {
        logger.debug({}, String(srcOrMsg), ...args);
    }
}

// Export log file path for external access
export function getLogFilePath(): string {
    return logFilePath;
}

// Optional: file-only logger for remote logs from CLI/mobile
// This is separate from the main server log
export const fileConsolidatedLogger = process.env.DANGEROUSLY_LOG_TO_SERVER_FOR_AI_AUTO_DEBUGGING
    ? pino({
            level: 'debug',
            formatters: {
                level: (label) => ({ level: label }),
                bindings: () => ({}),
            },
            timestamp: pino.stdTimeFunctions.isoTime,
        },
        pino.destination(join(logsDir, 'consolidated.log'))
    )
    : undefined;