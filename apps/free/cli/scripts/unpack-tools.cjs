#!/usr/bin/env node

/**
 * Unpacks platform-specific binaries from compressed archives
 * This script extracts the necessary tools for the current platform
 *
 * If archives are not present locally, it downloads them from GitHub Releases
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const https = require('https');
const http = require('http');
const tar = require('tar');
const os = require('os');

// GitHub Release URL for tool archives
const GITHUB_RELEASE_URL = 'https://github.com/saaskit-dev/agentbridge/releases/download/tools';
const DOWNLOAD_MAX_ATTEMPTS = 4;
const DOWNLOAD_RETRY_BASE_DELAY_MS = 1500;

// List of required archives for each platform
const ARCHIVES = {
  'arm64-darwin': ['difftastic-arm64-darwin.tar.gz', 'ripgrep-arm64-darwin.tar.gz'],
  'x64-darwin': ['difftastic-x64-darwin.tar.gz', 'ripgrep-x64-darwin.tar.gz'],
  'arm64-linux': ['difftastic-arm64-linux.tar.gz', 'ripgrep-arm64-linux.tar.gz'],
  'x64-linux': ['difftastic-x64-linux.tar.gz', 'ripgrep-x64-linux.tar.gz'],
  'x64-win32': ['difftastic-x64-win32.tar.gz', 'ripgrep-x64-win32.tar.gz'],
  'arm64-win32': ['difftastic-arm64-win32.tar.gz', 'ripgrep-arm64-win32.tar.gz'],
};

/**
 * Get the platform-specific directory name
 */
function getPlatformDir() {
    const platform = os.platform();
    const arch = os.arch();

    if (platform === 'darwin') {
        if (arch === 'arm64') return 'arm64-darwin';
        if (arch === 'x64') return 'x64-darwin';
    } else if (platform === 'linux') {
        if (arch === 'arm64') return 'arm64-linux';
        if (arch === 'x64') return 'x64-linux';
    } else if (platform === 'win32') {
        if (arch === 'x64') return 'x64-win32';
        if (arch === 'arm64') return 'arm64-win32';
    }

    throw new Error(`Unsupported platform: ${arch}-${platform}`);
}

/**
 * Get the root tools directory
 */
function getToolsDir() {
    // Handle both direct execution and require() calls
    const scriptDir = __dirname;
    return path.resolve(scriptDir, '..', 'tools');
}

/**
 * Check if tools are already unpacked for current platform
 */
function areToolsUnpacked(toolsDir) {
    const unpackedPath = path.join(toolsDir, 'unpacked');

    if (!fs.existsSync(unpackedPath)) {
        return false;
    }

    // Check for expected binaries
    const isWin = os.platform() === 'win32';
    const difftBinary = isWin ? 'difft.exe' : 'difft';
    const rgBinary = isWin ? 'rg.exe' : 'rg';

    const expectedFiles = [
        path.join(unpackedPath, difftBinary),
        path.join(unpackedPath, rgBinary),
        path.join(unpackedPath, 'ripgrep.node')
    ];

    return expectedFiles.every(file => fs.existsSync(file));
}

/**
 * Download a file from URL to destination path
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function cleanupPartialDownload(destPath) {
    if (fs.existsSync(destPath)) {
        try {
            fs.unlinkSync(destPath);
        } catch {
            // Ignore cleanup failures; the next write attempt will surface any real issue.
        }
    }
}

function isRetryableStatus(statusCode) {
    return statusCode === 408 || statusCode === 425 || statusCode === 429 || statusCode >= 500;
}

function formatAttempt(attempt, maxAttempts) {
    return `(attempt ${attempt}/${maxAttempts})`;
}

function downloadFile(url, destPath, redirectCount = 0) {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : http;
        const MAX_REDIRECTS = 5;

        // Ensure directory exists
        const dir = path.dirname(destPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        const file = fs.createWriteStream(destPath);

        protocol.get(url, (response) => {
            if (response.statusCode === 302 || response.statusCode === 301) {
                // Follow redirect
                file.close();
                cleanupPartialDownload(destPath);
                if (redirectCount >= MAX_REDIRECTS) {
                    reject(new Error(`Failed to download ${url}: too many redirects`));
                    return;
                }
                downloadFile(response.headers.location, destPath, redirectCount + 1)
                    .then(resolve)
                    .catch(reject);
                return;
            }

            if (response.statusCode !== 200) {
                file.close();
                cleanupPartialDownload(destPath);
                const error = new Error(`Failed to download ${url}: HTTP ${response.statusCode}`);
                error.retryable = isRetryableStatus(response.statusCode);
                reject(error);
                return;
            }

            response.pipe(file);
            file.on('finish', () => {
                file.close();
                resolve();
            });

            file.on('error', (err) => {
                file.close();
                cleanupPartialDownload(destPath);
                reject(err);
            });
        }).on('error', (err) => {
            file.close();
            cleanupPartialDownload(destPath);
            reject(err);
        });
    });
}

async function downloadFileWithRetry(url, destPath) {
    let lastError = null;

    for (let attempt = 1; attempt <= DOWNLOAD_MAX_ATTEMPTS; attempt += 1) {
        try {
            await downloadFile(url, destPath);
            return;
        } catch (err) {
            lastError = err;
            const retryable = err?.retryable === true;
            const shouldRetry = retryable && attempt < DOWNLOAD_MAX_ATTEMPTS;

            if (!shouldRetry) {
                throw err;
            }

            const delayMs = DOWNLOAD_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
            console.warn(
                `  Retryable download failure ${formatAttempt(attempt, DOWNLOAD_MAX_ATTEMPTS)}: ${err.message}`
            );
            console.warn(`  Waiting ${delayMs}ms before retrying...`);
            await sleep(delayMs);
        }
    }

    throw lastError;
}

/**
 * Unpack a tar.gz archive to a destination directory
 */
async function unpackArchive(archivePath, destDir) {
    return new Promise((resolve, reject) => {
        // Ensure destination directory exists
        if (!fs.existsSync(destDir)) {
            fs.mkdirSync(destDir, { recursive: true });
        }

        // Create read stream and extract
        fs.createReadStream(archivePath)
            .pipe(zlib.createGunzip())
            .pipe(tar.extract({
                cwd: destDir,
                preserveMode: true,
                preserveOwner: false
            }))
            .on('finish', () => {
                // Set executable permissions for Unix systems
                if (os.platform() !== 'win32') {
                    const files = fs.readdirSync(destDir);
                    files.forEach(file => {
                        const filePath = path.join(destDir, file);
                        const stats = fs.statSync(filePath);
                        if (stats.isFile() && !file.endsWith('.node')) {
                            // Make binary files executable
                            fs.chmodSync(filePath, 0o755);
                        }
                    });
                }
                resolve();
            })
            .on('error', reject);
    });
}

/**
 * Download archives for current platform if not present
 */
async function ensureArchives(platformDir, archivesDir) {
    const requiredArchives = ARCHIVES[platformDir];
    if (!requiredArchives) {
        throw new Error(`No archives configured for platform: ${platformDir}`);
    }

    // Create archives directory if needed
    if (!fs.existsSync(archivesDir)) {
        fs.mkdirSync(archivesDir, { recursive: true });
    }

    for (const archive of requiredArchives) {
        const archivePath = path.join(archivesDir, archive);

        if (fs.existsSync(archivePath)) {
            console.log(`  ✓ ${archive} already exists`);
            continue;
        }

        console.log(`  Downloading ${archive}...`);
        const url = `${GITHUB_RELEASE_URL}/${archive}`;

        try {
            await downloadFileWithRetry(url, archivePath);
            console.log(`  ✓ Downloaded ${archive}`);
        } catch (err) {
            throw new Error(`Failed to download ${archive}: ${err.message}`);
        }
    }
}

/**
 * Main unpacking function
 */
async function unpackTools() {
    try {
        const platformDir = getPlatformDir();
        const toolsDir = getToolsDir();
        const archivesDir = path.join(toolsDir, 'archives');
        const unpackedPath = path.join(toolsDir, 'unpacked');

        // Check if already unpacked
        if (areToolsUnpacked(toolsDir)) {
            console.log(`Tools already unpacked for ${platformDir}`);
            return { success: true, alreadyUnpacked: true };
        }

        console.log(`Setting up tools for ${platformDir}...`);

        // Ensure archives are available (download if needed)
        await ensureArchives(platformDir, archivesDir);

        // Create unpacked directory
        if (!fs.existsSync(unpackedPath)) {
            fs.mkdirSync(unpackedPath, { recursive: true });
        }

        // Unpack difftastic
        const difftasticArchive = path.join(archivesDir, `difftastic-${platformDir}.tar.gz`);
        if (!fs.existsSync(difftasticArchive)) {
            throw new Error(`Archive not found: ${difftasticArchive}`);
        }
        console.log('  Unpacking difftastic...');
        await unpackArchive(difftasticArchive, unpackedPath);

        // Unpack ripgrep
        const ripgrepArchive = path.join(archivesDir, `ripgrep-${platformDir}.tar.gz`);
        if (!fs.existsSync(ripgrepArchive)) {
            throw new Error(`Archive not found: ${ripgrepArchive}`);
        }
        console.log('  Unpacking ripgrep...');
        await unpackArchive(ripgrepArchive, unpackedPath);

        console.log(`Tools ready at ${unpackedPath}`);
        return { success: true, alreadyUnpacked: false };

    } catch (error) {
        console.error('Failed to setup tools:', error.message);
        throw error;
    }
}

// Export for use as module
module.exports = { unpackTools, getPlatformDir, getToolsDir };

/**
 * Fix node-pty spawn-helper executable permission.
 * pnpm strips +x from prebuilt binaries on install, causing posix_spawnp to fail.
 */
function fixNodePtyPermissions() {
    if (os.platform() === 'win32') return;
    const arch = os.arch();
    const platform = os.platform();
    const helperPath = path.resolve(
        __dirname, '..', '..', '..', '..', // apps/free/cli/scripts → repo root
        'node_modules', '.pnpm', 'node-pty@1.1.0', 'node_modules', 'node-pty',
        'prebuilds', `${platform}-${arch}`, 'spawn-helper'
    );
    if (fs.existsSync(helperPath)) {
        try {
            fs.chmodSync(helperPath, 0o755);
        } catch {
            // Ignore — may not have permission or path may change
        }
    }
}

// Run if executed directly
if (require.main === module) {
    unpackTools()
        .then(result => {
            fixNodePtyPermissions();
            process.exit(0);
        })
        .catch(error => {
            console.error('Error:', error);
            process.exit(1);
        });
}
