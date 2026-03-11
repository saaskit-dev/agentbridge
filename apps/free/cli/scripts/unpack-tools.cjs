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
function downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : http;

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
                fs.unlinkSync(destPath);
                downloadFile(response.headers.location, destPath).then(resolve).catch(reject);
                return;
            }

            if (response.statusCode !== 200) {
                file.close();
                fs.unlinkSync(destPath);
                reject(new Error(`Failed to download ${url}: HTTP ${response.statusCode}`));
                return;
            }

            response.pipe(file);
            file.on('finish', () => {
                file.close();
                resolve();
            });
        }).on('error', (err) => {
            file.close();
            if (fs.existsSync(destPath)) {
                fs.unlinkSync(destPath);
            }
            reject(err);
        });
    });
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
            await downloadFile(url, archivePath);
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

// Run if executed directly
if (require.main === module) {
    unpackTools()
        .then(result => {
            process.exit(0);
        })
        .catch(error => {
            console.error('Error:', error);
            process.exit(1);
        });
}
