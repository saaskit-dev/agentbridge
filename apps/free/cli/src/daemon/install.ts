import chalk from 'chalk';
import { Logger } from '@agentbridge/core/telemetry';
const logger = new Logger('daemon/install');

// Platform-specific imports
let macInstall: typeof import('./mac/installUser') | null = null;
let linuxInstall: typeof import('./linux/installUser') | null = null;

// Dynamic imports for platform-specific modules
async function getPlatformInstaller() {
  if (process.platform === 'darwin') {
    if (!macInstall) {
      macInstall = await import('./mac/installUser');
    }
    return macInstall;
  } else if (process.platform === 'linux') {
    if (!linuxInstall) {
      linuxInstall = await import('./linux/installUser');
    }
    return linuxInstall;
  }
  return null;
}

export async function install(): Promise<void> {
  const installer = await getPlatformInstaller();

  if (!installer) {
    throw new Error(
      `Daemon installation is not supported on ${process.platform}. Supported platforms: macOS, Linux`
    );
  }

  console.log(chalk.blue('Installing Free daemon as user service...'));
  console.log(chalk.gray('This will enable:'));
  console.log(chalk.gray('  • Auto-start when you log in'));
  console.log(chalk.gray('  • Auto-restart if the daemon crashes'));
  console.log('');

  await installer.installUserAgent();

  console.log(chalk.green('\n✓ Daemon installed successfully!'));
}

export async function uninstall(): Promise<void> {
  const installer = await getPlatformInstaller();

  if (!installer) {
    throw new Error(
      `Daemon uninstallation is not supported on ${process.platform}. Supported platforms: macOS, Linux`
    );
  }

  await installer.uninstallUserAgent();
}

export async function isInstalled(): Promise<boolean> {
  const installer = await getPlatformInstaller();

  if (!installer) {
    return false;
  }

  return installer.isUserAgentInstalled();
}
