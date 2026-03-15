import { MMKV } from 'react-native-mmkv';
import { kvGet, kvMutate } from './apiKv';
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
const mmkv = new MMKV();
const LOCAL_KEY_PREFIX = 'session-capabilities-cache-v2';
const REMOTE_KEY_PREFIX = 'caps';
const persistChains = new Map<string, Promise<void>>();

type CachedCapabilitiesEnvelope = {
  agentType?: AgentType;
  capabilities: SessionCapabilities;
  updatedAt: number;
  kvVersion?: number;
};

function getLocalCacheKey(machineId: string, agentType: AgentType) {
  return `${LOCAL_KEY_PREFIX}:${machineId}:${agentType}`;
}

function getRemoteCacheKey(machineId: string, agentType: AgentType) {
  return `${REMOTE_KEY_PREFIX}:${machineId}:${agentType}`;
}

function getPersistChainKey(machineId: string, agentType: AgentType) {
  return `${machineId}:${agentType}`;
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

function saveLocalEnvelope(machineId: string, agentType: AgentType, envelope: CachedCapabilitiesEnvelope) {
  mmkv.set(getLocalCacheKey(machineId, agentType), JSON.stringify(envelope));
}

function loadLocalEnvelope(machineId: string, agentType: AgentType): CachedCapabilitiesEnvelope | null {
  return parseEnvelope(mmkv.getString(getLocalCacheKey(machineId, agentType)));
}

export function loadCachedCapabilities(machineId: string | null | undefined, agentType: AgentType) {
  if (!machineId) {
    return null;
  }
  return loadLocalEnvelope(machineId, agentType)?.capabilities ?? null;
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

  const remote = await fetchRemoteEnvelope(machineId, agentType, credentials);
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
    throw new Error(
      `Failed to persist capabilities cache after retry: remote version ${retry.errors[0]?.version ?? 'unknown'}`
    );
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

  const local = loadLocalEnvelope(machineId, agentType);
  const credentials = await TokenStorage.getCredentials();
  if (!credentials) {
    return local?.capabilities ?? null;
  }

  try {
    const remote = await fetchRemoteEnvelope(machineId, agentType, credentials);
    if (remote) {
      saveLocalEnvelope(machineId, agentType, remote);
      return remote.capabilities;
    }
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
}) {
  const { machineId, agentType, capabilities, credentials, updatedAt = Date.now() } = params;
  if (!machineId || !agentType || !capabilities) {
    return;
  }
  const chainKey = getPersistChainKey(machineId, agentType);
  const previous = persistChains.get(chainKey) ?? Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(async () => {
      const snapshot = getCachedCapabilitySnapshot(capabilities, agentType);
      const local = loadLocalEnvelope(machineId, agentType);

      // Skip remote write if capabilities haven't changed
      const localJson = local ? JSON.stringify(local.capabilities) : null;
      const nextJson = JSON.stringify(snapshot);
      if (localJson === nextJson) {
        return;
      }

      const nextEnvelope: CachedCapabilitiesEnvelope = {
        agentType,
        capabilities: snapshot,
        updatedAt,
        kvVersion: local?.kvVersion,
      };
      saveLocalEnvelope(machineId, agentType, nextEnvelope);

      const auth = credentials ?? (await TokenStorage.getCredentials());
      if (!auth) {
        return;
      }

      try {
        const savedEnvelope = await saveRemoteEnvelope(
          auth,
          machineId,
          agentType,
          nextEnvelope
        );
        saveLocalEnvelope(machineId, agentType, savedEnvelope);
      } catch (error) {
        logger.error('Failed to persist capabilities cache', toError(error), {
          machineId,
          agentType,
        });
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
