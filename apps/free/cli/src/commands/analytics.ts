/**
 * Analytics/telemetry management commands
 *
 * Allows users to control whether anonymous usage data is sent to help improve Free.
 */

import chalk from 'chalk';
import { isAnalyticsEnabled, setAnalyticsEnabled } from '@/api/analyticsHeaderSync';

export async function handleAnalyticsCommand(args: string[]): Promise<void> {
  const subcommand = args[0];

  if (!subcommand || subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    showAnalyticsHelp();
    return;
  }

  switch (subcommand) {
    case 'on':
    case 'enable':
      await handleAnalyticsEnable();
      break;
    case 'off':
    case 'disable':
      await handleAnalyticsDisable();
      break;
    case 'status':
      await handleAnalyticsStatus();
      break;
    default:
      console.error(chalk.red(`Unknown analytics subcommand: ${subcommand}`));
      showAnalyticsHelp();
      process.exit(1);
  }
}

function showAnalyticsHelp(): void {
  console.log(`
${chalk.bold('free analytics')} - Analytics/telemetry settings

${chalk.bold('Usage:')}
  free analytics on       Enable anonymous usage data collection
  free analytics off      Disable anonymous usage data collection
  free analytics status   Show current analytics setting
  free analytics help     Show this help message

${chalk.bold('About:')}
  When enabled, Free collects anonymous usage data to help improve the product.
  This includes error reports and performance metrics.
  No personal data or code content is ever sent.

${chalk.gray('Data is sent securely and cannot be traced back to you.')}
`);
}

async function handleAnalyticsEnable(): Promise<void> {
  const current = await isAnalyticsEnabled();
  if (current) {
    console.log(chalk.green('✓ Analytics is already enabled'));
    return;
  }

  await setAnalyticsEnabled(true);
  console.log(chalk.green('✓ Analytics enabled'));
  console.log(chalk.gray('  Thank you for helping improve Free!'));
}

async function handleAnalyticsDisable(): Promise<void> {
  const current = await isAnalyticsEnabled();
  if (!current) {
    console.log(chalk.green('✓ Analytics is already disabled'));
    return;
  }

  await setAnalyticsEnabled(false);
  console.log(chalk.green('✓ Analytics disabled'));
  console.log(chalk.gray('  No usage data will be sent.'));
  console.log(chalk.gray('  If you change your mind, run "free analytics on"'));
}

async function handleAnalyticsStatus(): Promise<void> {
  const enabled = await isAnalyticsEnabled();

  console.log(chalk.bold('\nAnalytics Status\n'));

  if (enabled) {
    console.log(chalk.green('✓ Analytics enabled'));
    console.log(chalk.gray('  Anonymous usage data is being collected to help improve Free.'));
  } else {
    console.log(chalk.yellow('✗ Analytics disabled'));
    console.log(chalk.gray('  No usage data is being sent.'));
    console.log(chalk.gray('  Run "free analytics on" to enable.'));
  }

  console.log(chalk.gray('\n  Note: Local log files are always written for debugging purposes.'));
  console.log(chalk.gray(`  Log location: ~/.free/logs/`));
}
