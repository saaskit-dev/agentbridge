#!/usr/bin/env node

/**
 * Post-install hook: restart the daemon if one was running.
 *
 * This runs after `npm install -g @saaskit-dev/free` or after the build step
 * in install.sh. It ensures the daemon picks up the new binary immediately
 * instead of waiting up to 60s for the heartbeat to detect the version change.
 *
 * Strategy:
 * 1. Read daemon.state.json to confirm a daemon is currently running
 * 2. Restart the managed service directly via launchctl/systemctl when possible
 * 3. Fall back to SIGTERM only for unmanaged daemons
 *
 * If no daemon is running, this is a no-op.
 */

const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Determine FREE_HOME_DIR (same logic as configuration.ts)
function getFreeHomeDir() {
  if (process.env.FREE_HOME_DIR) {
    return process.env.FREE_HOME_DIR.replace(/^~/, os.homedir());
  }
  return path.join(os.homedir(), '.free');
}

function getVariant() {
  if (process.env.APP_ENV === 'development') {
    return 'development';
  }

  const freeHomeDir = process.env.FREE_HOME_DIR?.replace(/^~/, os.homedir());
  if (freeHomeDir && /(^|\/)\.free-dev(\/|$)/.test(freeHomeDir)) {
    return 'development';
  }

  return 'production';
}

function getServiceConfig() {
  const variant = getVariant();
  const variantSuffix = variant === 'development' ? '-dev' : '';
  const daemonServiceLabel = `app.saaskit.free.daemon${variantSuffix}`;
  const daemonSystemdServiceName = `free-daemon${variantSuffix}`;

  return {
    daemonServiceLabel,
    daemonPlistFile: path.join(
      os.homedir(),
      'Library',
      'LaunchAgents',
      `${daemonServiceLabel}.plist`
    ),
    daemonSystemdServiceName,
    daemonSystemdFile: path.join(
      os.homedir(),
      '.config',
      'systemd',
      'user',
      `${daemonSystemdServiceName}.service`
    ),
  };
}

function isLaunchAgentLoaded(daemonServiceLabel) {
  if (typeof process.getuid !== 'function') {
    return false;
  }

  try {
    execFileSync('launchctl', ['print', `gui/${process.getuid()}/${daemonServiceLabel}`], {
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

function restartViaLaunchAgent(serviceConfig) {
  if (process.platform !== 'darwin') {
    return false;
  }

  if (!fs.existsSync(serviceConfig.daemonPlistFile)) {
    return false;
  }

  if (!isLaunchAgentLoaded(serviceConfig.daemonServiceLabel)) {
    return false;
  }

  const launchTarget = `gui/${process.getuid()}/${serviceConfig.daemonServiceLabel}`;

  try {
    console.log(
      `[postinstall] Restarting LaunchAgent ${serviceConfig.daemonServiceLabel} via launchctl kickstart...`
    );
    execFileSync('launchctl', ['kickstart', '-k', launchTarget], { stdio: 'pipe' });
    console.log('[postinstall] Daemon restarted via LaunchAgent');
    return true;
  } catch (err) {
    console.log(`[postinstall] Could not restart LaunchAgent: ${err.message}`);
    return false;
  }
}

function isSystemdUserServiceActive(daemonSystemdServiceName) {
  try {
    execFileSync('systemctl', ['--user', 'is-active', '--quiet', daemonSystemdServiceName], {
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

function restartViaSystemd(serviceConfig) {
  if (process.platform !== 'linux') {
    return false;
  }

  if (!fs.existsSync(serviceConfig.daemonSystemdFile)) {
    return false;
  }

  if (!isSystemdUserServiceActive(serviceConfig.daemonSystemdServiceName)) {
    return false;
  }

  try {
    console.log(
      `[postinstall] Restarting systemd user service ${serviceConfig.daemonSystemdServiceName}...`
    );
    execFileSync('systemctl', ['--user', 'restart', serviceConfig.daemonSystemdServiceName], {
      stdio: 'pipe',
    });
    console.log('[postinstall] Daemon restarted via systemd');
    return true;
  } catch (err) {
    console.log(`[postinstall] Could not restart systemd service: ${err.message}`);
    return false;
  }
}

function waitForProcessExit(pid, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }

    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  }

  try {
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
}

function startUnmanagedDaemon() {
  const variant = getVariant();
  const cliEntrypoint = path.join(__dirname, '..', 'dist', 'cli.mjs');
  const child = spawn(
    process.execPath,
    [
      '--no-warnings',
      '--no-deprecation',
      cliEntrypoint,
      '--variant',
      variant,
      'daemon',
      'start-sync',
    ],
    {
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        APP_ENV: variant === 'development' ? 'development' : 'production',
      },
    }
  );
  child.unref();
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

  const serviceConfig = getServiceConfig();
  if (restartViaLaunchAgent(serviceConfig) || restartViaSystemd(serviceConfig)) {
    return;
  }

  // Fallback for manually started daemons or machines without a configured service manager.
  try {
    console.log(`[postinstall] Signaling daemon (pid ${state.pid})...`);
    process.kill(state.pid, 'SIGTERM');
    const exited = waitForProcessExit(state.pid);
    if (!exited) {
      console.log('[postinstall] Daemon did not exit after SIGTERM; skipping unmanaged restart');
      return;
    }
    startUnmanagedDaemon();
    console.log('[postinstall] Daemon restarted directly (unmanaged fallback)');
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
