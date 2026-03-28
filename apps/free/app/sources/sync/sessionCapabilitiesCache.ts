import { kvGet, kvMutate } from './apiKv';
import { messageDB } from './messageDB';
import {
  AgentType,
  getCachedCapabilitySnapshot,
  SessionCapabilities,
  SessionCapabilitiesSchema,
} from './sessionCapabilities';
import type { AuthCredentials } from '@/auth/tokenStorage';
import { TokenStorage } from '@/auth/tokenStorage';
import { Logger, toError } from '@saaskit-dev/agentbridge/telemetry';

const logger = new Logger('app/sync/sessionCapabilitiesCache');
const REMOTE_KEY_PREFIX = 'caps';
const REMOTE_HYDRATE_FRESH_MS = 5 * 60 * 1000;
const persistChains = new Map<string, Promise<void>>();
const hydrateInflight = new Map<string, Promise<CachedCapabilitiesEnvelope | null>>();
const hydrateCheckedAt = new Map<string, number>();
const memoryEnvelopes = new Map<string, CachedCapabilitiesEnvelope>();

type CachedCapabilitiesEnvelope = {
  agentType?: AgentType;
  capabilities: SessionCapabilities;
  updatedAt: number;
  kvVersion?: number;
};

function getRemoteCacheKey(machineId: string, agentType: AgentType) {
  return `${REMOTE_KEY_PREFIX}:${machineId}:${agentType}`;
}

function getPersistChainKey(machineId: string, agentType: AgentType) {
  return `${machineId}:${agentType}`;
}

function isEnvelopeFresh(envelope: CachedCapabilitiesEnvelope | null | undefined, now = Date.now()) {
  if (!envelope) {
    return false;
  }
  return now - envelope.updatedAt < REMOTE_HYDRATE_FRESH_MS;
}

function serializeCapabilitiesSnapshot(
  capabilities: SessionCapabilities | null | undefined,
  agentType: AgentType
): string {
  const snapshot = getCachedCapabilitySnapshot(capabilities, agentType);
  return JSON.stringify({
    models: snapshot.models
      ? {
          current: snapshot.models.current,
          available: snapshot.models.available.map(model => ({
            id: model.id,
            name: model.name,
            description: model.description ?? null,
          })),
        }
      : null,
    modes: snapshot.modes
      ? {
          current: snapshot.modes.current,
          available: snapshot.modes.available.map(mode => ({
            id: mode.id,
            name: mode.name,
            description: mode.description ?? null,
          })),
        }
      : null,
    configOptions:
      snapshot.configOptions?.map(option => ({
        id: option.id,
        name: option.name,
        description: option.description ?? null,
        category: option.category,
        type: option.type,
        currentValue: option.currentValue,
        options: option.options.map(choice => ({
          value: choice.value,
          label: choice.label,
        })),
      })) ?? null,
    commands:
      snapshot.commands?.map(command => ({
        id: command.id,
        name: command.name,
        description: command.description ?? null,
      })) ?? null,
  });
}

function parseEnvelope(raw: string | null | undefined): CachedCapabilitiesEnvelope | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    const capabilities = getCachedCapabilitySnapshot(
      SessionCapabilitiesSchema.parse(parsed.capabilities),
      typeof parsed.agentType === 'string' ? parsed.agentType : undefined
    );
    return {
      agentType: typeof parsed.agentType === 'string' ? parsed.agentType : undefined,
      capabilities,
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
      kvVersion: typeof parsed.kvVersion === 'number' ? parsed.kvVersion : undefined,
    };
  } catch (error) {
    logger.error('Failed to parse capabilities cache', toError(error));
    return null;
  }
}

async function saveLocalEnvelope(
  machineId: string,
  agentType: AgentType,
  envelope: CachedCapabilitiesEnvelope
) {
  const cacheKey = getPersistChainKey(machineId, agentType);
  memoryEnvelopes.set(cacheKey, envelope);
  logger.debug('Capabilities cache saveLocalEnvelope memory', {
    machineId,
    agentType,
    updatedAt: envelope.updatedAt,
    kvVersion: envelope.kvVersion ?? null,
  });
  try {
    await messageDB.upsertCapabilities({
      machine_id: machineId,
      agent_type: agentType,
      capabilities: JSON.stringify(envelope.capabilities),
      updated_at: envelope.updatedAt,
      kv_version: envelope.kvVersion ?? null,
    });
    logger.debug('Capabilities cache saveLocalEnvelope sqlite', {
      machineId,
      agentType,
      updatedAt: envelope.updatedAt,
      kvVersion: envelope.kvVersion ?? null,
    });
  } catch (error) {
    logger.warn('Failed to persist capabilities cache to SQLite, using in-memory cache', {
      machineId,
      agentType,
      error: toError(error),
    });
  }
}

async function loadLocalEnvelope(
  machineId: string,
  agentType: AgentType
): Promise<CachedCapabilitiesEnvelope | null> {
  const cacheKey = getPersistChainKey(machineId, agentType);
  const memory = memoryEnvelopes.get(cacheKey);
  if (memory) {
    logger.debug('Capabilities cache loadLocalEnvelope memory hit', {
      machineId,
      agentType,
      updatedAt: memory.updatedAt,
      kvVersion: memory.kvVersion ?? null,
    });
    return memory;
  }

  try {
    const row = await messageDB.getCapabilities(machineId, agentType);
    if (!row) {
      logger.debug('Capabilities cache loadLocalEnvelope miss', { machineId, agentType });
      return null;
    }
    const capabilities = getCachedCapabilitySnapshot(
      SessionCapabilitiesSchema.parse(JSON.parse(row.capabilities)),
      agentType
    );
    const envelope = {
      agentType,
      capabilities,
      updatedAt: row.updated_at,
      kvVersion: row.kv_version ?? undefined,
    };
    memoryEnvelopes.set(cacheKey, envelope);
    logger.debug('Capabilities cache loadLocalEnvelope sqlite hit', {
      machineId,
      agentType,
      updatedAt: row.updated_at,
      kvVersion: row.kv_version ?? null,
    });
    return envelope;
  } catch (error) {
    logger.error('Failed to read capabilities from SQLite', toError(error), { machineId, agentType });
    return memory ?? null;
  }
}

export async function loadCachedCapabilities(
  machineId: string | null | undefined,
  agentType: AgentType
): Promise<SessionCapabilities | null> {
  if (!machineId) {
    return null;
  }
  const envelope = await loadLocalEnvelope(machineId, agentType);
  return envelope?.capabilities ?? null;
}

async function fetchRemoteEnvelope(
  machineId: string,
  agentType: AgentType,
  credentials: AuthCredentials
): Promise<CachedCapabilitiesEnvelope | null> {
  const item = await kvGet(credentials, getRemoteCacheKey(machineId, agentType));
  if (!item?.value) {
    return null;
  }

  const envelope = parseEnvelope(item.value);
  if (!envelope) {
    return null;
  }

  return {
    ...envelope,
    kvVersion: item.version,
  };
}

async function hydrateRemoteEnvelope(
  machineId: string,
  agentType: AgentType,
  credentials: AuthCredentials
): Promise<CachedCapabilitiesEnvelope | null> {
  const key = getPersistChainKey(machineId, agentType);
  const inflight = hydrateInflight.get(key);
  if (inflight) {
    return inflight;
  }

  const request = fetchRemoteEnvelope(machineId, agentType, credentials).finally(() => {
    hydrateCheckedAt.set(key, Date.now());
    if (hydrateInflight.get(key) === request) {
      hydrateInflight.delete(key);
    }
  });
  hydrateInflight.set(key, request);
  return request;
}

async function saveRemoteEnvelope(
  credentials: AuthCredentials,
  machineId: string,
  agentType: AgentType,
  envelope: CachedCapabilitiesEnvelope
): Promise<CachedCapabilitiesEnvelope> {
  const remoteKey = getRemoteCacheKey(machineId, agentType);
  const initialVersion = envelope.kvVersion ?? -1;
  const serialized = JSON.stringify(envelope);

  const firstAttempt = await kvMutate(credentials, [
    {
      key: remoteKey,
      value: serialized,
      version: initialVersion,
    },
  ]);

  if (firstAttempt.success) {
    return {
      ...envelope,
      kvVersion: firstAttempt.results[0]?.version,
    };
  }

  const conflict = firstAttempt.errors[0];
  logger.info('Capabilities cache version conflict, reconciling with remote', {
    machineId,
    agentType,
    attemptedVersion: initialVersion,
    remoteVersion: conflict?.version,
  });

  // Use the value returned inline in the conflict error — avoids an extra GET round-trip
  // and reduces the race window before our retry write.
  const remoteFromConflict = conflict?.value ? parseEnvelope(conflict.value) : null;
  const remote: CachedCapabilitiesEnvelope | null = remoteFromConflict
    ? { ...remoteFromConflict, kvVersion: conflict.version }
    : await fetchRemoteEnvelope(machineId, agentType, credentials);

  if (remote && remote.updatedAt >= envelope.updatedAt) {
    return remote;
  }

  const retryVersion = remote?.kvVersion ?? conflict?.version ?? -1;
  const retryEnvelope: CachedCapabilitiesEnvelope = {
    ...envelope,
    kvVersion: retryVersion,
  };
  const retrySerialized = JSON.stringify(retryEnvelope);
  const retry = await kvMutate(credentials, [
    {
      key: remoteKey,
      value: retrySerialized,
      version: retryVersion,
    },
  ]);

  if (!retry.success) {
    const latestRemoteVersion = retry.errors[0]?.version;
    const err = new Error(
      `Failed to persist capabilities cache after retry: remote version ${latestRemoteVersion ?? 'unknown'}`
    ) as Error & { latestRemoteVersion?: number };
    err.latestRemoteVersion = latestRemoteVersion;
    throw err;
  }

  return {
    ...retryEnvelope,
    kvVersion: retry.results[0]?.version,
  };
}

export async function hydrateCachedCapabilities(
  machineId: string | null | undefined,
  agentType: AgentType
): Promise<SessionCapabilities | null> {
  if (!machineId) {
    return null;
  }

  const local = await loadLocalEnvelope(machineId, agentType);
  if (isEnvelopeFresh(local)) {
    logger.debug('Capabilities cache hydrate skipped: fresh local envelope', {
      machineId,
      agentType,
      updatedAt: local?.updatedAt,
      kvVersion: local?.kvVersion ?? null,
    });
    return local?.capabilities ?? null;
  }
  const chainKey = getPersistChainKey(machineId, agentType);
  const lastCheckedAt = hydrateCheckedAt.get(chainKey);
  if (lastCheckedAt && Date.now() - lastCheckedAt < REMOTE_HYDRATE_FRESH_MS) {
    logger.debug('Capabilities cache hydrate skipped: recent remote check', {
      machineId,
      agentType,
      lastCheckedAt,
    });
    return local?.capabilities ?? null;
  }
  const credentials = await TokenStorage.getCredentials();
  if (!credentials) {
    return local?.capabilities ?? null;
  }

  try {
    const remote = await hydrateRemoteEnvelope(machineId, agentType, credentials);
    if (remote) {
      logger.debug('Capabilities cache hydrate remote hit', {
        machineId,
        agentType,
        updatedAt: remote.updatedAt,
        kvVersion: remote.kvVersion ?? null,
      });
      await saveLocalEnvelope(machineId, agentType, remote);
      return remote.capabilities;
    }
    logger.debug('Capabilities cache hydrate remote miss', { machineId, agentType });
  } catch (error) {
    logger.error('Failed to hydrate capabilities cache', toError(error), { machineId, agentType });
  }

  return local?.capabilities ?? null;
}

export async function persistCachedCapabilities(params: {
  machineId: string | null | undefined;
  agentType: AgentType | null | undefined;
  capabilities: SessionCapabilities | null | undefined;
  credentials?: AuthCredentials | null;
  updatedAt?: number;
  persistRemote?: boolean;
}) {
  const {
    machineId,
    agentType,
    capabilities,
    credentials,
    updatedAt = Date.now(),
    persistRemote = true,
  } = params;
  if (!machineId || !agentType || !capabilities) {
    return;
  }
  const chainKey = getPersistChainKey(machineId, agentType);
  const previous = persistChains.get(chainKey) ?? Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(async () => {
      const snapshot = getCachedCapabilitySnapshot(capabilities, agentType);
      const local = await loadLocalEnvelope(machineId, agentType);

      // Skip remote write if capabilities haven't changed
      const localJson = local ? serializeCapabilitiesSnapshot(local.capabilities, agentType) : null;
      const nextJson = serializeCapabilitiesSnapshot(snapshot, agentType);
      if (localJson === nextJson) {
        logger.debug('Capabilities cache persist skipped: unchanged snapshot', {
          machineId,
          agentType,
          localUpdatedAt: local?.updatedAt,
          localKvVersion: local?.kvVersion ?? null,
          persistRemote,
        });
        return;
      }

      const nextEnvelope: CachedCapabilitiesEnvelope = {
        agentType,
        capabilities: snapshot,
        updatedAt,
        kvVersion: local?.kvVersion,
      };
      await saveLocalEnvelope(machineId, agentType, nextEnvelope);

      if (!persistRemote) {
        logger.debug('Capabilities cache persist skipped: local-only', {
          machineId,
          agentType,
          updatedAt,
          kvVersion: nextEnvelope.kvVersion ?? null,
        });
        return;
      }

      const auth = credentials ?? (await TokenStorage.getCredentials());
      if (!auth) {
        return;
      }

      try {
        logger.debug('Capabilities cache persist remote write', {
          machineId,
          agentType,
          updatedAt,
          kvVersion: nextEnvelope.kvVersion ?? null,
        });
        const savedEnvelope = await saveRemoteEnvelope(auth, machineId, agentType, nextEnvelope);
        await saveLocalEnvelope(machineId, agentType, savedEnvelope);
      } catch (error) {
        logger.error('Failed to persist capabilities cache', toError(error), {
          machineId,
          agentType,
        });
        // Update local kvVersion to the latest remote version we observed, so
        // the next call doesn't start from a stale version and fight again.
        const latestRemoteVersion = (error as { latestRemoteVersion?: number }).latestRemoteVersion;
        if (typeof latestRemoteVersion === 'number') {
          const stale = await loadLocalEnvelope(machineId, agentType);
          if (stale) {
            await saveLocalEnvelope(machineId, agentType, { ...stale, kvVersion: latestRemoteVersion });
          }
        }
      }
    })
    .finally(() => {
      if (persistChains.get(chainKey) === next) {
        persistChains.delete(chainKey);
      }
    });

  persistChains.set(chainKey, next);
  await next;
}
