import { Webhooks } from '@octokit/webhooks';
import type { EmitterWebhookEvent } from '@octokit/webhooks';
import { App } from 'octokit';
import { Logger } from '@agentbridge/core/telemetry';

const log = new Logger('modules/github');

let app: App | null = null;
let webhooks: Webhooks | null = null;

export async function initGithub() {
  if (
    process.env.GITHUB_APP_ID &&
    process.env.GITHUB_PRIVATE_KEY &&
    process.env.GITHUB_CLIENT_ID &&
    process.env.GITHUB_CLIENT_SECRET &&
    process.env.GITHUB_REDIRECT_URI &&
    process.env.GITHUB_WEBHOOK_SECRET
  ) {
    app = new App({
      appId: process.env.GITHUB_APP_ID,
      privateKey: process.env.GITHUB_PRIVATE_KEY,
      webhooks: {
        secret: process.env.GITHUB_WEBHOOK_SECRET,
      },
    });

    // Initialize standalone webhooks handler for type-safe event processing
    webhooks = new Webhooks({
      secret: process.env.GITHUB_WEBHOOK_SECRET,
    });

    // Register type-safe event handlers
    registerWebhookHandlers();
  }
}

function registerWebhookHandlers() {
  if (!webhooks) return;

  // Type-safe handlers for specific events
  webhooks.on('push', async ({ payload }: EmitterWebhookEvent<'push'>) => {
    log.info(`Push to ${payload.repository.full_name} by ${payload.pusher.name}`, { event: 'push' });
  });

  webhooks.on(
    'pull_request',
    async ({ payload }: EmitterWebhookEvent<'pull_request'>) => {
      log.info(`PR ${payload.action} on ${payload.repository.full_name}: #${payload.pull_request.number} - ${payload.pull_request.title}`, { event: 'pull_request' });
    }
  );

  webhooks.on('issues', async ({ payload }: EmitterWebhookEvent<'issues'>) => {
    log.info(`Issue ${payload.action} on ${payload.repository.full_name}: #${payload.issue.number} - ${payload.issue.title}`, { event: 'issues' });
  });

  webhooks.on(
    ['star.created', 'star.deleted'],
    async ({ payload }: EmitterWebhookEvent<'star.created' | 'star.deleted'>) => {
      const action = payload.action === 'created' ? 'starred' : 'unstarred';
      log.info(`Repository ${action}: ${payload.repository.full_name} by ${payload.sender.login}`, { event: 'star' });
    }
  );

  webhooks.on('repository', async ({ payload }: EmitterWebhookEvent<'repository'>) => {
    log.info(`Repository ${payload.action}: ${payload.repository.full_name}`, { event: 'repository' });
  });

  // Catch-all for unhandled events
  webhooks.onAny(async ({ id, name }: EmitterWebhookEvent) => {
    log.info(`Received webhook event: ${name as string}`, { event: name as string, id });
  });

  webhooks.onError((error: any) => {
    log.error(`Webhook handler error: ${error.event?.name}`, error);
  });
}

export function getWebhooks(): Webhooks | null {
  return webhooks;
}
