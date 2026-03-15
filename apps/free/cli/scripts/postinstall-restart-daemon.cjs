#!/usr/bin/env node

/**
 * Post-install hook: restart the daemon if one was running.
 *
 * This runs after `npm install -g @saaskit-dev/free` or after the build step
 * in install.sh. It ensures the daemon picks up the new binary immediately
 * instead of waiting up to 60s for the heartbeat to detect the version change.
 *
 * Strategy:
 * 1. Read daemon.state.json to find the running daemon's PID
 * 2. Send SIGTERM to gracefully stop it
 * 3. The LaunchAgent/systemd KeepAlive will automatically restart with the new binary
 *
 * If no daemon is running, this is a no-op.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Determine FREE_HOME_DIR (same logic as configuration.ts)
function getFreeHomeDir() {
  if (process.env.FREE_HOME_DIR) {
    return process.env.FREE_HOME_DIR.replace(/^~/, os.homedir());
  }
  return path.join(os.homedir(), '.free');
}

function tryRestartDaemon() {
  const freeHomeDir = getFreeHomeDir();
  const stateFile = path.join(freeHomeDir, 'daemon.state.json');

  if (!fs.existsSync(stateFile)) {
    // No daemon running — nothing to do
    return;
  }

  let state;
  try {
    state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
  } catch {
    return;
  }

  if (!state || !state.pid) {
    return;
  }

  // Check if daemon process is still alive
  try {
    process.kill(state.pid, 0); // existence check
  } catch {
    // Process not running — stale state file, nothing to restart
    return;
  }

  // Send SIGTERM for graceful shutdown
  // The system service manager (LaunchAgent/systemd) will auto-restart it
  // with the newly installed binary
  try {
    console.log(`[postinstall] Restarting daemon (pid ${state.pid})...`);
    process.kill(state.pid, 'SIGTERM');
    console.log('[postinstall] Daemon will restart automatically via system service');
  } catch (err) {
    // EPERM or other errors — not critical, daemon heartbeat will catch up
    console.log(`[postinstall] Could not signal daemon: ${err.message}`);
  }
}

try {
  tryRestartDaemon();
} catch {
  // Never fail the install because of daemon restart issues
}
