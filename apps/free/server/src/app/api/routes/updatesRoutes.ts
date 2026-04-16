import { type Fastify } from '../types';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';
import { getUpdatesGatewayConfig } from '@/app/updates/config';
import { proxyExpoUpdates } from '@/app/updates/proxy';
import { readLatestDesktopRelease, readLatestOtaRelease } from '@/app/updates/releaseStore';

const logger = new Logger('app/api/routes/updatesRoutes');

async function handleUpdatesRequest(request: any, reply: any) {
  const config = getUpdatesGatewayConfig();
  if (config.mode === 'self-hosted') {
    const platform = String(request.headers['expo-platform'] || request.query.platform || '').toLowerCase();
    const runtimeVersion = String(request.headers['expo-runtime-version'] || request.query.runtimeVersion || '');
    const channel = String(request.headers['expo-channel-name'] || request.query.channel || 'production');

    if ((platform !== 'ios' && platform !== 'android') || !runtimeVersion) {
      return reply.code(400).send({ error: 'invalid_updates_request' });
    }

    const latest = await readLatestOtaRelease(channel, platform as 'ios' | 'android', runtimeVersion);
    const manifestEntry = latest?.platforms.find(item => item.platform === platform)?.manifest;
    if (!manifestEntry) {
      reply.header('expo-protocol-version', '1');
      reply.header('expo-sfv-version', '0');
      reply.header('expo-manifest-filters', 'channel="production"');
      reply.header('expo-server-defined-headers', `expo-channel-name="${channel}"`);
      return reply.code(204).send();
    }

    reply.header('expo-protocol-version', '1');
    reply.header('expo-sfv-version', '0');
    reply.header('expo-manifest-filters', `channel="${channel}"`);
    reply.header('expo-server-defined-headers', `expo-channel-name="${channel}"`);
    reply.header('cache-control', 'private, max-age=0');
    reply.header('content-type', 'application/expo+json');
    return reply.send(manifestEntry);
  }

  if (!config.enabled) {
    return reply.code(404).send({ error: 'updates_gateway_disabled' });
  }

  try {
    const body =
      request.method === 'GET' || request.method === 'HEAD'
        ? undefined
        : Buffer.isBuffer(request.body)
          ? request.body
          : request.body
            ? Buffer.from(typeof request.body === 'string' ? request.body : JSON.stringify(request.body))
            : undefined;

    const response = await proxyExpoUpdates({
      method: request.method,
      headers: request.headers,
      body,
    });

    for (const [key, value] of Object.entries(response.headers)) {
      reply.header(key, value);
    }
    reply.code(response.status);
    return reply.send(response.body);
  } catch (error) {
    logger.error('Failed to proxy Expo update request', { error: String(error) });
    return reply.code(502).send({ error: 'updates_upstream_unavailable' });
  }
}

async function handleDesktopUpdatesRequest(request: any, reply: any) {
  const channel = String(request.query.channel || 'stable');
  const latest = await readLatestDesktopRelease(channel);
  if (!latest) {
    return reply.code(404).send({ error: 'desktop_update_not_found' });
  }

  try {
    const response = await fetch(latest.latestJsonUrl, {
      headers: {
        accept: 'application/json',
      },
    });

    if (!response.ok) {
      logger.error('Failed to fetch desktop updater manifest', {
        channel,
        status: response.status,
        latestJsonUrl: latest.latestJsonUrl,
      });
      return reply.code(502).send({ error: 'desktop_update_unavailable' });
    }

    reply.header('cache-control', 'private, max-age=0');
    reply.header('content-type', 'application/json');
    return reply.send(await response.text());
  } catch (error) {
    logger.error('Failed to proxy desktop updater manifest', {
      channel,
      error: String(error),
      latestJsonUrl: latest.latestJsonUrl,
    });
    return reply.code(502).send({ error: 'desktop_update_unavailable' });
  }
}

export function updatesRoutes(app: Fastify) {
  app.get('/updates', handleUpdatesRequest);
  app.post('/updates', handleUpdatesRequest);
  app.get('/updates/desktop/latest.json', handleDesktopUpdatesRequest);
}
