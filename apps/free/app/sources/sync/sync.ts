import Constants from 'expo-constants';
import { randomUUID } from 'expo-crypto';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import NetInfo from '@react-native-community/netinfo';
import { registerPushToken as registerPushTokenApi } from './apiPush';
import { Platform, AppState, Linking, type AppStateStatus } from 'react-native';
import { isRunningOnMac } from '@/utils/platform';
import { NormalizedMessage, normalizeRawMessage, RawRecord } from './typesRaw';
import {
  applySettings,
  Settings,
  settingsDefaults,
  settingsParse,
  SUPPORTED_SCHEMA_VERSION,
} from './settings';
import { Profile, profileParse } from './profile';
import {
  loadPendingSettings,
  savePendingSettings,
  loadPendingOutbox,
  savePendingOutbox,
  scheduleSaveCachedSessions,
  loadHandledReconnectToken,
  saveHandledReconnectToken,
  loadPendingReconnectAcks,
  savePendingReconnectAcks,
  loadRegisteredPushToken,
  saveRegisteredPushToken,
} from './persistence';
import { parseToken } from '@/utils/parseToken';
import { RevenueCat, LogLevel, PaywallResult } from './revenueCat';
import { getServerUrl } from './serverConfig';
import { config } from '@/config';
import {
  Logger,
  continueTrace,
  safeStringify,
  toError,
  type TraceContext,
} from '@saaskit-dev/agentbridge/telemetry';
import { gitStatusSync } from './gitStatusSync';
import { projectManager } from './projectManager';
import { Message } from './typesMessage';
import { EncryptionCache } from './encryption/encryptionCache';
import { systemPrompt } from './prompt/systemPrompt';
import { fetchArtifact, fetchArtifacts, createArtifact, updateArtifact } from './apiArtifacts';
import {
  DecryptedArtifact,
  Artifact,
  ArtifactCreateRequest,
  ArtifactUpdateRequest,
} from './artifactTypes';
import { ArtifactEncryption } from './encryption/artifactEncryption';
import { getFriendsList, getUserProfile } from './apiFriends';
import { fetchFeed } from './apiFeed';
import type { ApiEphemeralActivityUpdate } from './apiTypes';
import { ApiEphemeralUpdateSchema, ApiMessage, ApiUpdateContainerSchema } from './apiTypes';
import { FeedItem } from './feedTypes';
import { UserProfile } from './friendTypes';
import { ActivityUpdateAccumulator } from './reducer/activityUpdateAccumulator';
import { registerGetMachineEncryption } from './ops';
import { persistCachedCapabilities } from './sessionCapabilitiesCache';
import { storage, registerApplySettingsCallback, registerAssumeUsersCallback } from './storage';
import { Session, Machine, QueuedAttachment, QueuedMessage } from './storageTypes';
import { AuthCredentials } from '@/auth/tokenStorage';
import { decodeBase64, encodeBase64 } from '@/encryption/base64';
import { apiSocket } from '@/sync/apiSocket';
import { setSessionTrace, clearSessionTrace, sessionLogger } from '@/sync/appTraceStore';
import { Encryption } from '@/sync/encryption/encryption';
import { InvalidateSync } from '@/utils/sync';
import { isTauriDesktop } from '@/utils/tauri';
import type { PermissionMode } from './sessionCapabilities';
import { messageDB } from './messageDB';
import { serializeCachedContent } from './cacheContent';
import { mergeQueuedMessagesForPromotion } from './syncQueue';

const logger = new Logger('app/sync');

const BACKGROUND_NOTIFICATION_TASK = 'ws-reconnect-background';
type PushRegistrationResult =
  | 'granted'
  | 'denied'
  | 'settings-required'
  | 'unsupported'
  | 'skipped';

let lastHandledReconnectToken: string | null = null;

let _enqueueReconnectTokenAck: ((token: string) => void) | null = null;

function getLastHandledReconnectToken(): string | null {
  if (lastHandledReconnectToken === null) {
    lastHandledReconnectToken = loadHandledReconnectToken();
  }
  return lastHandledReconnectToken;
}

function persistReconnectAckToken(reconnectToken: string) {
  const pendingAcks = loadPendingReconnectAcks();
  if (!pendingAcks.includes(reconnectToken)) {
    savePendingReconnectAcks([...pendingAcks, reconnectToken]);
  }
}

async function handleReconnectPushNotification(
  data: Record<string, unknown> | null | undefined
): Promise<void> {
  if (!data || data.type !== 'ws-reconnect') return;

  const reconnectToken = data.reconnectToken as string | undefined;
  if (!reconnectToken) return;

  if (reconnectToken === getLastHandledReconnectToken()) {
    logger.debug('[sync] ws-reconnect push ignored: duplicate token');
    return;
  }
  lastHandledReconnectToken = reconnectToken;
  saveHandledReconnectToken(reconnectToken);

  if (_enqueueReconnectTokenAck) {
    _enqueueReconnectTokenAck(reconnectToken);
  } else {
    persistReconnectAckToken(reconnectToken);
  }

  logger.info('[sync] silent push ws-reconnect received, resuming socket');
  if (apiSocket.getStatus() !== 'connected' && apiSocket.getStatus() !== 'connecting') {
    apiSocket.resume();
  }
}

if (typeof TaskManager !== 'undefined') {
  TaskManager.defineTask(
    BACKGROUND_NOTIFICATION_TASK,
    async ({
      data,
      error,
    }: TaskManager.TaskManagerTaskBody<{ notification?: Notifications.Notification }>) => {
      if (error) {
        logger.error('[sync] background notification task error', { error: String(error) });
        return;
      }
      await handleReconnectPushNotification(
        (data?.notification?.request?.content?.data as Record<string, unknown> | undefined) ?? null
      );
    }
  );
}

/**
 * Get voice hooks via lazy require to avoid static cross-layer init coupling.
 */
function getVoiceHooks(): typeof import('@/realtime/hooks/voiceHooks').voiceHooks {
  return require('@/realtime/hooks/voiceHooks').voiceHooks;
}

function isSandboxEnabled(metadata: Session['metadata'] | null | undefined): boolean {
  const sandbox = metadata?.sandbox;
  return (
    !!sandbox && typeof sandbox === 'object' && (sandbox as { enabled?: unknown }).enabled === true
  );
}

/**
 * Minimal wire trace — mirrors packages/core WireTrace without adding a Node.js dependency.
 * Must stay in sync with packages/core/src/telemetry/types.ts WireTrace.
 */
type WireTrace = { tid: string; ses?: string; mid?: string };

function makeWireTrace(sessionId: string): WireTrace {
  return { tid: randomUUID(), ses: sessionId };
}

function resolveSentFrom(): string {
  if (Platform.OS === 'web') {
    return 'web';
  }
  if (Platform.OS === 'android') {
    return 'android';
  }
  if (Platform.OS === 'ios') {
    return isRunningOnMac() ? 'mac' : 'ios';
  }
  return 'web';
}

type OutboxMessage = {
  id: string;
  content: string;
  _trace?: WireTrace;
};

type SendMessageResult =
  | { ok: true; queued: boolean }
  | { ok: false; reason: 'server_disconnected' | 'daemon_offline' };

class Sync {
  private static readonly BACKGROUND_SEND_TIMEOUT_MS = 30_000;
  private static readonly DESKTOP_RESUME_COOLDOWN_MS = 4000;
  private static readonly DESKTOP_REFRESH_INVALIDATION_COOLDOWN_MS = 12_000;
  private static readonly MAX_INACTIVE_SESSION_MESSAGE_CACHES = 2;
  encryption!: Encryption;
  private shouldPromptBackgroundReconnectOnResume = false;
  private backgroundReconnectPromptInFlight = false;
  accountId!: string;
  anonId!: string;
  private credentials!: AuthCredentials;
  public encryptionCache = new EncryptionCache();
  private sessionsSync: InvalidateSync;
  private messagesSync = new Map<string, InvalidateSync>();
  private sendSync = new Map<string, InvalidateSync>();
  private sendAbortControllers = new Map<string, AbortController>();
  private sessionLastSeq = new Map<string, number>();
  private pendingOutbox = new Map<string, OutboxMessage[]>();
  private sessionMessageQueue = new Map<string, NormalizedMessage[]>();
  private sessionQueueProcessing = new Set<string>();
  private sessionBatchTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Serializes handleUpdate calls so seq continuity checks see consistent state. */
  private _updateQueue = Promise.resolve();
  private sessionDataKeys = new Map<string, Uint8Array>(); // Store session data encryption keys internally
  private machineDataKeys = new Map<string, Uint8Array>(); // Store machine data encryption keys internally
  private artifactDataKeys = new Map<string, Uint8Array>(); // Store artifact data encryption keys internally
  private settingsSync: InvalidateSync;
  private profileSync: InvalidateSync;
  purchasesSync: InvalidateSync;
  private machinesSync: InvalidateSync;
  private pushTokenSync: InvalidateSync;
  private nativeUpdateSync: InvalidateSync;
  private artifactsSync: InvalidateSync;
  private friendsSync: InvalidateSync;
  private friendRequestsSync: InvalidateSync;
  private feedSync: InvalidateSync;
  private activityAccumulator: ActivityUpdateAccumulator;
  private pendingSettings: Partial<Settings> = loadPendingSettings();
  private appState: AppStateStatus = AppState.currentState;
  private backgroundSendTimeout: ReturnType<typeof setTimeout> | null = null;
  private backgroundSendNotificationId: string | null = null;
  private backgroundSendStartedAt: number | null = null;
  private pendingReconnectAcks = loadPendingReconnectAcks();
  private reconnectAckFlushPromise: Promise<void> | null = null;
  private lastRegisteredPushToken = loadRegisteredPushToken();
  private lastKnownConnectivity: boolean | null = null;
  private desktopWindowFocused = true;
  private desktopWindowVisible = true;
  private lastForegroundRefreshAt = 0;
  private lastResumeAttemptAt = 0;
  revenueCatInitialized = false;

  // Ephemeral update subscribers for streaming text support.
  // Index subscriptions by session/message to avoid broadcasting every token to every message row.
  private ephemeralGlobalCallbacks: Set<(update: unknown) => void> = new Set();
  private ephemeralSessionCallbacks = new Map<string, Set<(update: unknown) => void>>();
  private ephemeralMessageCallbacks = new Map<string, Set<(update: unknown) => void>>();
  private ephemeralSessionMessageCallbacks = new Map<
    string,
    Map<string, Set<(update: unknown) => void>>
  >();

  // Generic locking mechanism

  // Generic locking mechanism
  private recalculationLockCount = 0;
  private lastRecalculationTime = 0;

  constructor() {
    // messageDB.init() is handled by initKVStores() in _layout.tsx before sync starts.
    this.sessionsSync = new InvalidateSync(this.fetchSessions);
    this.settingsSync = new InvalidateSync(this.syncSettings);
    this.profileSync = new InvalidateSync(this.fetchProfile);
    this.purchasesSync = new InvalidateSync(this.syncPurchases);
    this.machinesSync = new InvalidateSync(this.fetchMachines);
    this.nativeUpdateSync = new InvalidateSync(this.fetchNativeUpdate);
    this.artifactsSync = new InvalidateSync(this.fetchArtifactsList);
    this.friendsSync = new InvalidateSync(this.fetchFriends);
    this.friendRequestsSync = new InvalidateSync(this.fetchFriendRequests);
    this.feedSync = new InvalidateSync(this.fetchFeed);

    const registerPushToken = async () => {
      if (__DEV__) {
        return;
      }
      try {
        await this.registerPushToken();
      } catch (error) {
        logger.debug('[sync] Automatic push token registration failed', {
          error: safeStringify(error),
        });
      }
    };
    this.pushTokenSync = new InvalidateSync(registerPushToken);
    this.activityAccumulator = new ActivityUpdateAccumulator(
      this.flushActivityUpdates.bind(this),
      2000
    );
    apiSocket.setReconnectMode(this.isReconnectForegroundActive() ? 'foreground' : 'background');

    // Listen for app state changes to refresh purchases
    AppState.addEventListener('change', nextAppState => {
      this.appState = nextAppState;
      if (nextAppState === 'active') {
        this.handleForegroundActivation('app-state-active');
      } else {
        this.shouldPromptBackgroundReconnectOnResume =
          this.hasPendingOutboxMessages() || storage.getState().getActiveSessions().length > 0;
        this.updateReconnectModeFromActivity('app-state-inactive');
        logger.debug(`📱 App state changed to: ${nextAppState}`);
        this.maybeStartBackgroundSendWatchdog();
      }
    });

    if (isTauriDesktop() && typeof window !== 'undefined' && typeof document !== 'undefined') {
      this.desktopWindowFocused = document.hasFocus();
      this.desktopWindowVisible = document.visibilityState !== 'hidden';

      window.addEventListener('focus', () => {
        this.desktopWindowFocused = true;
        this.handleForegroundActivation('desktop-window-focus');
      });
      window.addEventListener('blur', () => {
        this.desktopWindowFocused = false;
        this.updateReconnectModeFromActivity('desktop-window-blur');
      });
      document.addEventListener('visibilitychange', () => {
        this.desktopWindowVisible = document.visibilityState !== 'hidden';
        if (this.desktopWindowVisible) {
          this.handleForegroundActivation('desktop-visibility-visible');
        } else {
          this.updateReconnectModeFromActivity('desktop-visibility-hidden');
        }
      });
      window.addEventListener('online', () => {
        logger.info('[sync] Browser connectivity restored', {
          appState: this.appState,
          socketStatus: apiSocket.getStatus(),
        });
        void this.flushReconnectAckQueue();
        this.pushTokenSync.invalidate();
        this.maybeResumeSocket('desktop-online');
      });
    }

    if (Platform.OS !== 'web') {
      Notifications.addNotificationReceivedListener(notification => {
        handleReconnectPushNotification(
          notification.request.content.data as Record<string, unknown> | undefined
        );
      });
      if (
        'addPushTokenListener' in Notifications &&
        typeof Notifications.addPushTokenListener === 'function'
      ) {
        Notifications.addPushTokenListener(({ data }) => {
          void this.handlePushTokenRotation(data);
        });
      }
      void Notifications.registerTaskAsync(BACKGROUND_NOTIFICATION_TASK).catch(err => {
        logger.debug('[sync] registerTaskAsync failed', { error: String(err) });
      });
      NetInfo.addEventListener(state => {
        const isReachable = state.isConnected === true && state.isInternetReachable !== false;
        const didRestore = this.lastKnownConnectivity === false && isReachable;
        this.lastKnownConnectivity = isReachable;
        if (!didRestore) {
          return;
        }

        logger.info('[sync] Network connectivity restored', {
          appState: this.appState,
          socketStatus: apiSocket.getStatus(),
        });
        void this.flushReconnectAckQueue();
        this.pushTokenSync.invalidate();
        this.maybeResumeSocket('native-network-restored');
      });
    }
  }

  private isReconnectForegroundActive(): boolean {
    if (isTauriDesktop()) {
      return this.appState === 'active';
    }
    return this.appState === 'active';
  }

  private isDesktopForegroundVisible(): boolean {
    if (isTauriDesktop()) {
      return this.appState === 'active' && this.desktopWindowFocused && this.desktopWindowVisible;
    }
    return this.appState === 'active';
  }

  private updateReconnectModeFromActivity(reason: string) {
    const mode = this.isReconnectForegroundActive() ? 'foreground' : 'background';
    logger.debug('[sync] update reconnect mode from activity', {
      reason,
      mode,
      appState: this.appState,
      desktopWindowFocused: this.desktopWindowFocused,
      desktopWindowVisible: this.desktopWindowVisible,
    });
    apiSocket.setReconnectMode(mode);
  }

  private maybeResumeSocket(reason: string) {
    if (!this.isReconnectForegroundActive()) {
      logger.debug('[sync] skip socket resume: app not effectively active', {
        reason,
        appState: this.appState,
        desktopWindowFocused: this.desktopWindowFocused,
        desktopWindowVisible: this.desktopWindowVisible,
      });
      return;
    }

    const socketStatus = apiSocket.getStatus();
    if (socketStatus === 'connected' || socketStatus === 'connecting') {
      apiSocket.refreshReconnectAuth();
      return;
    }

    const now = Date.now();
    if (now - this.lastResumeAttemptAt < Sync.DESKTOP_RESUME_COOLDOWN_MS) {
      logger.debug('[sync] skip socket resume: cooldown active', {
        reason,
        socketStatus,
        lastResumeAttemptAgo: now - this.lastResumeAttemptAt,
      });
      return;
    }

    this.lastResumeAttemptAt = now;
    logger.info('[sync] resuming socket connection', {
      reason,
      socketStatus,
      appState: this.appState,
      desktopWindowFocused: this.desktopWindowFocused,
      desktopWindowVisible: this.desktopWindowVisible,
    });
    apiSocket.resume();
  }

  private handleForegroundActivation(reason: string) {
    this.updateReconnectModeFromActivity(reason);

    const shouldPromptBackgroundReconnect =
      this.shouldPromptBackgroundReconnectOnResume &&
      apiSocket.getStatus() !== 'connected' &&
      apiSocket.getStatus() !== 'connecting';
    this.shouldPromptBackgroundReconnectOnResume = false;

    const shouldFailAfterResume =
      this.backgroundSendStartedAt !== null &&
      this.hasPendingOutboxMessages() &&
      Date.now() - this.backgroundSendStartedAt >= Sync.BACKGROUND_SEND_TIMEOUT_MS;
    void this.cancelBackgroundSendTimeoutNotification();
    this.clearBackgroundSendWatchdog();
    if (shouldFailAfterResume) {
      void this.notifyMessageSendFailed();
      for (const controller of this.sendAbortControllers.values()) {
        controller.abort();
      }
      this.sendAbortControllers.clear();
    }

    logger.debug('📱 App became active', {
      reason,
      appState: this.appState,
      desktopWindowFocused: this.desktopWindowFocused,
      desktopWindowVisible: this.desktopWindowVisible,
    });

    this.maybeResumeSocket(reason);
    void this.maybePromptForBackgroundReconnect(shouldPromptBackgroundReconnect);

    for (const sessionId of this.pendingOutbox.keys()) {
      this.getSendSync(sessionId).invalidate();
    }

    if (!this.isDesktopForegroundVisible()) {
      logger.debug('[sync] skip foreground invalidation: desktop window not visible', {
        reason,
        appState: this.appState,
        desktopWindowFocused: this.desktopWindowFocused,
        desktopWindowVisible: this.desktopWindowVisible,
      });
      return;
    }

    const now = Date.now();
    if (now - this.lastForegroundRefreshAt < Sync.DESKTOP_REFRESH_INVALIDATION_COOLDOWN_MS) {
      logger.debug('[sync] skip foreground invalidation: cooldown active', {
        reason,
        lastForegroundRefreshAgo: now - this.lastForegroundRefreshAt,
      });
      return;
    }

    this.lastForegroundRefreshAt = now;
    this.purchasesSync.invalidate();
    this.profileSync.invalidate();
    this.machinesSync.invalidate();
    this.pushTokenSync.invalidate();
    void this.flushReconnectAckQueue();
    this.sessionsSync.invalidate();
    this.nativeUpdateSync.invalidate();
    logger.debug('📱 App became active: Invalidating artifacts sync', { reason });
    this.artifactsSync.invalidate();
    this.friendsSync.invalidate();
    this.friendRequestsSync.invalidate();
    this.feedSync.invalidate();
  }

  async create(credentials: AuthCredentials, encryption: Encryption) {
    this.credentials = credentials;
    this.encryption = encryption;
    this.anonId = encryption.anonId;
    this.accountId = parseToken(credentials.token);
    lastHandledReconnectToken = loadHandledReconnectToken();
    this.pendingReconnectAcks = loadPendingReconnectAcks();
    this.lastRegisteredPushToken = loadRegisteredPushToken();
    logger.info('[sync] create', { accountId: this.accountId });
    _enqueueReconnectTokenAck = (reconnectToken: string) => {
      this.enqueueReconnectAck(reconnectToken);
    };
    await this.#init();

    // Await settings sync to have fresh settings
    await this.settingsSync.awaitQueue();

    // Await profile sync to have fresh profile
    await this.profileSync.awaitQueue();

    // Await purchases sync to have fresh purchases
    await this.purchasesSync.awaitQueue();
  }

  async restore(credentials: AuthCredentials, encryption: Encryption) {
    // NOTE: No awaiting anything here, we're restoring from a disk (ie app restarted)
    // Purchases sync is invalidated in #init() and will complete asynchronously
    this.credentials = credentials;
    this.encryption = encryption;
    this.anonId = encryption.anonId;
    this.accountId = parseToken(credentials.token);
    lastHandledReconnectToken = loadHandledReconnectToken();
    this.pendingReconnectAcks = loadPendingReconnectAcks();
    this.lastRegisteredPushToken = loadRegisteredPushToken();
    logger.info('[sync] restore', { accountId: this.accountId });
    _enqueueReconnectTokenAck = (reconnectToken: string) => {
      this.enqueueReconnectAck(reconnectToken);
    };
    await this.#init();
  }

  async #init() {
    // Restore any outbox messages persisted before the app was killed
    const persistedOutbox = loadPendingOutbox();
    for (const [sessionId, messages] of Object.entries(persistedOutbox)) {
      if (messages.length > 0) {
        this.pendingOutbox.set(sessionId, messages);
        this.getSendSync(sessionId).invalidate();
      }
    }

    // Subscribe to updates
    this.subscribeToUpdates();

    // Invalidate sync
    logger.debug('🔄 #init: Invalidating all syncs');
    this.sessionsSync.invalidate();
    this.settingsSync.invalidate();
    this.profileSync.invalidate();
    this.purchasesSync.invalidate();
    this.machinesSync.invalidate();
    this.pushTokenSync.invalidate();
    void this.flushReconnectAckQueue();
    this.nativeUpdateSync.invalidate();
    this.friendsSync.invalidate();
    this.friendRequestsSync.invalidate();
    this.artifactsSync.invalidate();
    this.feedSync.invalidate();
    logger.debug('🔄 #init: All syncs invalidated, including artifacts');

    // Wait for both sessions and machines to load, then mark as ready.
    // Mark ready even on failure — the app should not stay stuck on loading screen.
    Promise.all([this.sessionsSync.awaitQueue(), this.machinesSync.awaitQueue()])
      .then(() => {
        storage.getState().applyReady();
      })
      .catch(error => {
        logger.error('Failed to load initial data:', toError(error));
        storage.getState().applyReady();
      });
  }

  onSessionVisible = async (sessionId: string) => {
    const log = sessionLogger(logger, sessionId);
    log.debug('[sync] onSessionVisible');
    this.pruneInactiveSessionMessageCache(sessionId);

    // Load cached messages from local SQLite first.
    // If the session has a populated local cache, hydrate the full cached history
    // before switching the UI into the loaded state so the first render reflects
    // the complete local session, not just a recent tail.
    if (!storage.getState().sessionMessages[sessionId]) {
      try {
        const cachedSeq = this.sessionLastSeq.get(sessionId) ?? (await messageDB.getLastSeq(sessionId));
        if (cachedSeq > 0) {
          if (!this.sessionLastSeq.has(sessionId)) {
            this.setSessionLastSeq(sessionId, cachedSeq);
          }
          const cachedHydration = await this.loadCachedSessionMessages(sessionId, cachedSeq);
          if (cachedHydration.messages.length > 0) {
            const hydratedAt = Date.now();
            this.applyMessages(sessionId, cachedHydration.messages);
            storage.getState().applyMessagesLoaded(sessionId);
            storage.getState().markSessionLocalHydrated(sessionId, hydratedAt);
            this.sessionOldestSeq.set(sessionId, cachedHydration.oldestSeq);
            storage.getState().setSessionOlderMessagesState(sessionId, {
              hasOlderMessages: cachedHydration.hasOlderMessages,
            });
            log.debug('[sync] hydrated SQLite cache', {
              count: cachedHydration.messages.length,
              batchCount: cachedHydration.batchCount,
              lastSeq: cachedSeq,
              oldestSeq: cachedHydration.oldestSeq,
              hasOlderMessages: cachedHydration.hasOlderMessages,
            });
          } else {
            log.warn('[sync] SQLite cache inconsistent, resetting local watermark', {
              cachedSeq,
            });
            this.deleteSessionLastSeq(sessionId);
            await messageDB.deleteSession(sessionId).catch(error => {
              log.debug('[sync] failed to clear inconsistent SQLite cache', {
                error: safeStringify(error),
              });
            });
          }
        }
      } catch (error) {
        log.debug('[sync] SQLite cache read failed, will fetch from server', {
          error: safeStringify(error),
        });
      }
    }

    // Always fetch from server to get latest (incremental if we have cached lastSeq)
    this.getMessagesSync(sessionId).invalidate();

    // Also invalidate git status sync for this session
    gitStatusSync.getSync(sessionId).invalidate();

    // Notify voice assistant about session visibility
    const session = storage.getState().sessions[sessionId];
    if (session) {
      getVoiceHooks().onSessionFocus(sessionId, session.metadata || undefined);
    }
  };

  private getLocalCacheHydrateBatchSize() {
    if (isTauriDesktop()) {
      return 1000;
    }
    if (Platform.OS === 'web') {
      return 500;
    }
    return 250;
  }

  private normalizeCachedMessages(rows: Array<{
    id: string;
    seq: number;
    content: string;
    trace_id: string | null;
    created_at: number;
  }>): NormalizedMessage[] {
    const normalized: NormalizedMessage[] = [];
    for (const row of rows) {
      try {
        const raw = JSON.parse(row.content);
        const message = normalizeRawMessage(row.id, row.created_at, raw);
        if (!message) {
          continue;
        }
        if (row.seq) {
          message.seq = row.seq;
        }
        if (!message.traceId && row.trace_id) {
          message.traceId = row.trace_id;
        }
        normalized.push(message);
      } catch {
        // Skip corrupt cache rows and continue hydrating the rest of the session.
      }
    }
    return normalized;
  }

  private async loadCachedSessionMessages(
    sessionId: string,
    cachedSeq: number
  ): Promise<{
    messages: NormalizedMessage[];
    oldestSeq: number;
    hasOlderMessages: boolean;
    batchCount: number;
  }> {
    const batchSize = this.getLocalCacheHydrateBatchSize();
    let beforeSeq = cachedSeq + 1;
    let oldestSeq = cachedSeq;
    let batchCount = 0;
    const chronologicalBatches: NormalizedMessage[][] = [];

    while (beforeSeq > 0) {
      const rows = await messageDB.getMessages(sessionId, {
        limit: batchSize,
        beforeSeq,
      });
      if (rows.length === 0) {
        break;
      }

      batchCount += 1;
      oldestSeq = Math.min(oldestSeq, ...rows.map(row => row.seq));

      const normalizedBatch = this.normalizeCachedMessages(rows);
      if (normalizedBatch.length > 0) {
        // beforeSeq queries return DESC order. Reverse each page so the reducer
        // receives ASC messages when we stitch pages back together.
        normalizedBatch.reverse();
        chronologicalBatches.push(normalizedBatch);
      }

      if (rows.length < batchSize || oldestSeq <= 1) {
        break;
      }
      beforeSeq = oldestSeq;
    }

    const messages: NormalizedMessage[] = [];
    for (let index = chronologicalBatches.length - 1; index >= 0; index -= 1) {
      messages.push(...chronologicalBatches[index]!);
    }

    return {
      messages,
      oldestSeq,
      hasOlderMessages: oldestSeq > 1,
      batchCount,
    };
  }

  private pruneInactiveSessionMessageCache(visibleSessionId: string) {
    const state = storage.getState();
    const keepSessionIds = new Set<string>([visibleSessionId]);

    Object.entries(state.sessions).forEach(([sessionId, session]) => {
      if (session.status === 'active') {
        keepSessionIds.add(sessionId);
      }
    });
    this.pendingOutbox.forEach((_messages, sessionId) => keepSessionIds.add(sessionId));
    this.sessionMessageQueue.forEach((_messages, sessionId) => keepSessionIds.add(sessionId));
    this.sessionQueueProcessing.forEach(sessionId => keepSessionIds.add(sessionId));

    const inactiveLoadedEntries = Object.entries(state.sessionMessages).filter(([sessionId, sessionMessages]) => {
      if (keepSessionIds.has(sessionId)) {
        return false;
      }
      if (!sessionMessages.isLoaded) {
        return false;
      }
      return state.sessions[sessionId]?.status !== 'active';
    });

    if (inactiveLoadedEntries.length <= Sync.MAX_INACTIVE_SESSION_MESSAGE_CACHES) {
      return;
    }

    inactiveLoadedEntries
      .sort(
        ([leftId], [rightId]) =>
          (state.sessions[rightId]?.updatedAt ?? 0) - (state.sessions[leftId]?.updatedAt ?? 0)
      )
      .slice(0, Sync.MAX_INACTIVE_SESSION_MESSAGE_CACHES)
      .forEach(([sessionId]) => keepSessionIds.add(sessionId));

    const evictedSessionIds = inactiveLoadedEntries
      .map(([sessionId]) => sessionId)
      .filter(sessionId => !keepSessionIds.has(sessionId));

    if (evictedSessionIds.length === 0) {
      return;
    }

    storage.getState().dropSessionMessages(evictedSessionIds);
    logger.debug('[sync] evicted inactive session message caches', {
      visibleSessionId,
      evictedCount: evictedSessionIds.length,
    });
  }

  private getMessagesSync(sessionId: string): InvalidateSync {
    let sync = this.messagesSync.get(sessionId);
    if (!sync) {
      sync = new InvalidateSync(() => this.fetchMessages(sessionId));
      this.messagesSync.set(sessionId, sync);
    }
    return sync;
  }

  private outboxPersistTimer: ReturnType<typeof setTimeout> | null = null;
  /** Debounced persist of pendingOutbox (50ms). Call cancelOutboxPersist() to flush immediately. */
  private persistOutbox() {
    if (this.outboxPersistTimer) return;
    this.outboxPersistTimer = setTimeout(() => {
      this.outboxPersistTimer = null;
      const obj: Record<string, Array<{ id: string; content: string; _trace?: WireTrace }>> = {};
      for (const [sid, msgs] of this.pendingOutbox) {
        if (msgs.length > 0) obj[sid] = msgs;
      }
      savePendingOutbox(obj);
    }, 50);
  }

  private getSendSync(sessionId: string): InvalidateSync {
    let sync = this.sendSync.get(sessionId);
    if (!sync) {
      sync = new InvalidateSync(() => this.flushPendingSessionMessages(sessionId));
      this.sendSync.set(sessionId, sync);
    }
    return sync;
  }

  private readonly BATCH_WINDOW_MS = 50;
  private readonly MESSAGE_APPLY_CHUNK_SIZE = 200;
  private static readonly FETCH_MESSAGES_PAGE_SIZE = 250;

  private setSessionLastSeq(sessionId: string, seq: number) {
    this.sessionLastSeq.set(sessionId, seq);
    apiSocket.refreshReconnectAuth();
  }

  private deleteSessionLastSeq(sessionId: string) {
    this.sessionLastSeq.delete(sessionId);
    apiSocket.refreshReconnectAuth();
  }

  private clearSessionLastSeqs() {
    this.sessionLastSeq.clear();
    apiSocket.refreshReconnectAuth();
  }

  private enqueueMessages(sessionId: string, messages: NormalizedMessage[]) {
    if (messages.length === 0) {
      return;
    }

    const log = sessionLogger(logger, sessionId);
    log.debug('enqueueMessages', { count: messages.length });

    let queue = this.sessionMessageQueue.get(sessionId);
    if (!queue) {
      queue = [];
      this.sessionMessageQueue.set(sessionId, queue);
    }
    queue.push(...messages);

    if (this.sessionQueueProcessing.has(sessionId)) {
      return;
    }

    const existingTimer = this.sessionBatchTimers.get(sessionId);
    if (existingTimer) {
      return;
    }

    this.sessionBatchTimers.set(
      sessionId,
      setTimeout(() => {
        this.sessionBatchTimers.delete(sessionId);
        this.processMessageQueue(sessionId);
      }, this.BATCH_WINDOW_MS)
    );
  }

  private processMessageQueue(sessionId: string, flush = false) {
    const log = sessionLogger(logger, sessionId);
    if (this.sessionQueueProcessing.has(sessionId)) {
      return;
    }
    this.sessionQueueProcessing.add(sessionId);
    try {
      while (true) {
        const pending = this.sessionMessageQueue.get(sessionId);
        if (!pending || pending.length === 0) {
          break;
        }
        const batchSize = flush ? pending.length : Math.min(pending.length, this.MESSAGE_APPLY_CHUNK_SIZE);
        const batch = pending.splice(0, batchSize);
        log.debug('enqueueMessages: processing batch', { batchSize: batch.length });
        this.applyMessages(sessionId, batch);

        if (!flush && pending.length > 0) {
          this.sessionBatchTimers.set(
            sessionId,
            setTimeout(() => {
              this.sessionBatchTimers.delete(sessionId);
              this.processMessageQueue(sessionId);
            }, 0)
          );
          return;
        }
      }
    } finally {
      this.sessionQueueProcessing.delete(sessionId);
    }
  }

  /**
   * Cancel the pending batch timer and immediately process all queued messages.
   * Called before applyMessagesLoaded() to avoid a race where the "loaded" marker
   * creates an empty session entry before cached messages have been applied.
   */
  private flushMessageQueue(sessionId: string) {
    const timer = this.sessionBatchTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.sessionBatchTimers.delete(sessionId);
    }
    const pending = this.sessionMessageQueue.get(sessionId);
    if (pending && pending.length > 0) {
      this.processMessageQueue(sessionId, true);
    }
  }

  private hasPendingOutboxMessages() {
    if (this.sendAbortControllers.size > 0) {
      return true;
    }
    for (const messages of this.pendingOutbox.values()) {
      if (messages.length > 0) {
        return true;
      }
    }
    return false;
  }

  private isSessionReadyForQueuedFlush(session: Session | null | undefined): session is Session {
    return !!session && session.presence === 'online' && session.thinking !== true;
  }

  private createQueuedMessage(
    session: Session,
    text: string,
    displayText?: string,
    attachments?: QueuedAttachment[]
  ): QueuedMessage {
    const flavor = session.metadata?.flavor;
    const sandboxEnabled = isSandboxEnabled(session.metadata);
    const permissionMode: PermissionMode =
      session.permissionMode || (sandboxEnabled ? 'yolo' : 'accept-edits');
    const isGemini = flavor === 'gemini';
    const isOpenCode = flavor === 'opencode';
    const modelMode =
      session.modelMode || (isGemini ? 'gemini-2.5-pro' : isOpenCode ? 'default' : 'default');
    const model = isGemini && !session.capabilities && modelMode !== 'default' ? modelMode : null;
    const now = Date.now();

    return {
      id: randomUUID(),
      text,
      ...(displayText ? { displayText } : {}),
      createdAt: now,
      updatedAt: now,
      permissionMode,
      model,
      fallbackModel: null,
      ...(attachments?.length ? { attachments } : {}),
    };
  }

  private async stageQueuedMessagesForSend(
    sessionId: string,
    queuedMessages: QueuedMessage[]
  ): Promise<boolean> {
    if (queuedMessages.length === 0) {
      return true;
    }

    const session = storage.getState().sessions[sessionId];
    if (!session) {
      return false;
    }

    const encryption = this.encryption.getSessionEncryption(sessionId);
    if (!encryption) {
      return false;
    }

    const sentFrom = resolveSentFrom();
    const mergedMessage = mergeQueuedMessagesForPromotion(queuedMessages);
    if (!mergedMessage) {
      return true;
    }

    const trace = makeWireTrace(sessionId);
    setSessionTrace(sessionId, trace);

    const content: RawRecord = {
      role: 'user',
      content: {
        type: 'text',
        text: mergedMessage.text,
        ...(mergedMessage.attachments?.length
          ? {
              attachments: mergedMessage.attachments.map(
                ({ id, mimeType, thumbhash, filename }) => ({
                  id,
                  mimeType,
                  ...(thumbhash ? { thumbhash } : {}),
                  ...(filename ? { filename } : {}),
                })
              ),
            }
          : {}),
      },
      traceId: trace.tid,
      meta: {
        sentFrom,
        permissionMode: mergedMessage.permissionMode,
        model: mergedMessage.model,
        fallbackModel: mergedMessage.fallbackModel,
        appendSystemPrompt: systemPrompt,
      },
    };

    const encryptedRawRecord = await encryption.encryptRawRecord(content);
    const normalizedMessage = normalizeRawMessage(mergedMessage.id, mergedMessage.promotedAt, content);
    if (normalizedMessage) {
      this.enqueueMessages(sessionId, [normalizedMessage]);
    }

    const pending = this.pendingOutbox.get(sessionId) ?? [];
    pending.push({
      id: mergedMessage.id,
      content: encryptedRawRecord,
      _trace: trace,
    });
    this.pendingOutbox.set(sessionId, pending);
    this.persistOutbox();

    const currentSession = storage.getState().sessions[sessionId];
    if (currentSession) {
      this.applySessions([
        {
          ...currentSession,
          thinking: true,
          thinkingAt: Date.now(),
        },
      ]);
    }

    this.maybeStartBackgroundSendWatchdog();
    return true;
  }

  private async promoteQueuedMessagesToOutbox(sessionId: string): Promise<void> {
    const session = storage.getState().sessions[sessionId];
    const queuedMessagesSnapshot = [...(session?.queuedMessages ?? [])];

    if (queuedMessagesSnapshot.length === 0 || !this.isSessionReadyForQueuedFlush(session)) {
      return;
    }

    if (apiSocket.getStatus() !== 'connected') {
      return;
    }

    const staged = await this.stageQueuedMessagesForSend(sessionId, queuedMessagesSnapshot);
    if (!staged) {
      return;
    }

    storage
      .getState()
      .removeSessionQueuedMessages(
        sessionId,
        queuedMessagesSnapshot.map(message => message.id)
      );
  }

  private async flushPendingSessionMessages(sessionId: string): Promise<void> {
    await this.promoteQueuedMessagesToOutbox(sessionId);
    await this.flushOutbox(sessionId);
  }

  private maybeStartBackgroundSendWatchdog() {
    if (Platform.OS === 'web' || this.appState === 'active') {
      return;
    }
    if (!this.hasPendingOutboxMessages() || this.backgroundSendTimeout) {
      return;
    }

    logger.debug('📨 Pending messages detected in background. Starting 30s send watchdog.');
    this.backgroundSendStartedAt = Date.now();
    this.backgroundSendTimeout = setTimeout(() => {
      this.backgroundSendTimeout = null;
      void this.handleBackgroundSendTimeout();
    }, Sync.BACKGROUND_SEND_TIMEOUT_MS);
    void this.scheduleBackgroundSendTimeoutNotification();
  }

  private clearBackgroundSendWatchdog() {
    if (this.backgroundSendTimeout) {
      clearTimeout(this.backgroundSendTimeout);
      this.backgroundSendTimeout = null;
    }
    this.backgroundSendStartedAt = null;
  }

  private async scheduleBackgroundSendTimeoutNotification() {
    if (Platform.OS === 'web' || this.backgroundSendNotificationId) {
      return;
    }
    try {
      this.backgroundSendNotificationId = await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Message not sent',
          body: 'A message is still sending in the background. It will fail in 30 seconds if not delivered.',
          sound: true,
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds: Math.ceil(Sync.BACKGROUND_SEND_TIMEOUT_MS / 1000),
        },
      });
    } catch (error) {
      logger.debug(`Failed to schedule background send timeout notification: ${error}`);
    }
  }

  private async cancelBackgroundSendTimeoutNotification() {
    if (!this.backgroundSendNotificationId) {
      return;
    }
    try {
      await Notifications.cancelScheduledNotificationAsync(this.backgroundSendNotificationId);
    } catch (error) {
      logger.debug(`Failed to cancel background send timeout notification: ${error}`);
    } finally {
      this.backgroundSendNotificationId = null;
    }
  }

  private async notifyMessageSendFailed() {
    if (Platform.OS === 'web') {
      return;
    }
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Message failed',
          body: 'A message failed to send while the app was in background. Open Free and retry.',
          sound: true,
        },
        trigger: null,
      });
    } catch (error) {
      logger.debug(`Failed to schedule message failure notification: ${error}`);
    }
  }

  private async handleBackgroundSendTimeout() {
    if (!this.hasPendingOutboxMessages()) {
      await this.cancelBackgroundSendTimeoutNotification();
      this.backgroundSendStartedAt = null;
      return;
    }

    await this.cancelBackgroundSendTimeoutNotification();
    await this.notifyMessageSendFailed();
    // Abort in-flight requests but keep messages in outbox for retry on foreground resume.
    for (const controller of this.sendAbortControllers.values()) {
      controller.abort();
    }
    this.sendAbortControllers.clear();
    this.backgroundSendStartedAt = null;
  }

  async sendMessage(
    sessionId: string,
    text: string,
    displayText?: string,
    opts?: {
      skipPresenceCheck?: boolean;
      attachments?: QueuedAttachment[];
    }
  ): Promise<SendMessageResult> {
    const log = sessionLogger(logger, sessionId);
    // Pre-check: server socket must be connected
    if (apiSocket.getStatus() !== 'connected') {
      log.info('[App] sendMessage blocked: server socket not connected', {
        socketStatus: apiSocket.getStatus(),
      });
      return { ok: false, reason: 'server_disconnected' };
    }

    // Get session data from storage
    const session = storage.getState().sessions[sessionId];
    if (!session) {
      log.error('Session not found in storage');
      return { ok: false, reason: 'server_disconnected' };
    }

    // Pre-check: daemon must be online (presence kept alive by keepAlive every 2s)
    // Skip for newly created sessions where keepAlive hasn't arrived yet.
    if (!opts?.skipPresenceCheck && session.presence !== 'online') {
      log.info('[App] sendMessage blocked: daemon not online', {
        presence: session.presence,
      });
      return { ok: false, reason: 'daemon_offline' };
    }

    const queuedMessage = this.createQueuedMessage(session, text, displayText, opts?.attachments);
    const existingQueuedMessages = session.queuedMessages ?? [];
    const shouldQueueLocally = session.thinking === true || existingQueuedMessages.length > 0;

    if (shouldQueueLocally) {
      storage.getState().enqueueSessionQueuedMessage(sessionId, queuedMessage);
      log.info('[App] queued local pending message', {
        userId: this.accountId,
        id: queuedMessage.id,
        preview: text.slice(0, 100),
        queueDepth: (storage.getState().sessions[sessionId]?.queuedMessages ?? []).length,
      });
      return { ok: true, queued: true };
    }

    log.info('[App] sending message', {
      userId: this.accountId,
      id: queuedMessage.id,
      preview: text.slice(0, 100),
    });

    const staged = await this.stageQueuedMessagesForSend(sessionId, [queuedMessage]);
    if (!staged) {
      log.error('Session encryption not found');
      return { ok: false, reason: 'server_disconnected' };
    }

    this.getSendSync(sessionId).invalidate();
    return { ok: true, queued: false };
  }

  /** Manually retry sending pending messages for a session. */
  retrySend(sessionId: string) {
    if (!this.pendingOutbox.has(sessionId) || this.pendingOutbox.get(sessionId)!.length === 0) {
      return;
    }
    storage.getState().setSessionSendError(sessionId, null);
    this.getSendSync(sessionId).invalidate();
  }

  /** Discard all pending outbox messages for a session. */
  discardPendingMessages(sessionId: string) {
    // Abort any in-flight request
    const controller = this.sendAbortControllers.get(sessionId);
    if (controller) {
      controller.abort();
      this.sendAbortControllers.delete(sessionId);
    }
    this.pendingOutbox.delete(sessionId);
    this.persistOutbox();
    storage.getState().setSessionSendError(sessionId, null);
    // NOTE: We intentionally do NOT reset session.thinking here.
    // The agent may still be processing a previously-sent message.
    // Server activity updates will self-correct any orphaned optimistic
    // thinking state within seconds.
  }

  applySettings = (delta: Partial<Settings>) => {
    storage.getState().applySettingsLocal(delta);

    // Save pending settings
    this.pendingSettings = { ...this.pendingSettings, ...delta };
    savePendingSettings(this.pendingSettings);

    // Invalidate settings sync
    this.settingsSync.invalidate();
  };

  refreshPurchases = () => {
    this.purchasesSync.invalidate();
  };

  refreshProfile = async () => {
    await this.profileSync.invalidateAndAwait();
  };

  purchaseProduct = async (productId: string): Promise<{ success: boolean; error?: string }> => {
    try {
      // Ensure RevenueCat is initialized (may be async on first load)
      if (!this.revenueCatInitialized) {
        await this.purchasesSync.invalidateAndAwait();
      }
      if (!this.revenueCatInitialized) {
        return { success: false, error: 'RevenueCat not initialized' };
      }

      // Fetch the product
      const products = await RevenueCat.getProducts([productId]);
      if (products.length === 0) {
        return { success: false, error: `Product '${productId}' not found` };
      }

      // Purchase the product
      const product = products[0];
      const { customerInfo } = await RevenueCat.purchaseStoreProduct(product);

      // Update local purchases data
      storage.getState().applyPurchases(customerInfo);

      return { success: true };
    } catch (error: any) {
      // Check if user cancelled
      if (error.userCancelled) {
        return { success: false, error: 'Purchase cancelled' };
      }

      // Return the error message
      return { success: false, error: error.message || 'Purchase failed' };
    }
  };

  getOfferings = async (): Promise<{ success: boolean; offerings?: any; error?: string }> => {
    try {
      // Check if RevenueCat is initialized
      if (!this.revenueCatInitialized) {
        return { success: false, error: 'RevenueCat not initialized' };
      }

      // Fetch offerings
      const offerings = await RevenueCat.getOfferings();

      // Return the offerings data
      return {
        success: true,
        offerings: {
          current: offerings.current,
          all: offerings.all,
        },
      };
    } catch (error: any) {
      return { success: false, error: error.message || 'Failed to fetch offerings' };
    }
  };

  presentPaywall = async (): Promise<{ success: boolean; purchased?: boolean; error?: string }> => {
    try {
      // Ensure RevenueCat is initialized (may be async on first load)
      if (!this.revenueCatInitialized) {
        await this.purchasesSync.invalidateAndAwait();
      }
      if (!this.revenueCatInitialized) {
        const error = 'RevenueCat not initialized';
        return { success: false, error };
      }

      // Present the paywall
      const result = await RevenueCat.presentPaywall();

      // Handle the result
      switch (result) {
        case PaywallResult.PURCHASED:
          // Refresh customer info after purchase
          await this.syncPurchases();
          return { success: true, purchased: true };
        case PaywallResult.RESTORED:
          // Refresh customer info after restore
          await this.syncPurchases();
          return { success: true, purchased: true };
        case PaywallResult.CANCELLED:
          return { success: true, purchased: false };
        case PaywallResult.NOT_PRESENTED:
          return { success: false, error: 'Paywall not available on this platform' };
        case PaywallResult.ERROR:
        default:
          const errorMsg = 'Failed to present paywall';
          return { success: false, error: errorMsg };
      }
    } catch (error: any) {
      const errorMessage = error.message || 'Failed to present paywall';
      return { success: false, error: errorMessage };
    }
  };

  async assumeUsers(userIds: string[]): Promise<void> {
    if (!this.credentials || userIds.length === 0) return;

    const state = storage.getState();
    // Filter out users we already have in cache (including null for 404s)
    const missingIds = userIds.filter(id => !(id in state.users));

    if (missingIds.length === 0) return;

    logger.debug(`👤 Fetching ${missingIds.length} missing users...`);

    // Fetch missing users in parallel
    const results = await Promise.all(
      missingIds.map(async id => {
        try {
          const profile = await getUserProfile(this.credentials!, id);
          return { id, profile }; // profile is null if 404
        } catch (error) {
          logger.error(`Failed to fetch user ${id}:`, toError(error));
          return { id, profile: null }; // Treat errors as 404
        }
      })
    );

    // Convert to Record<string, UserProfile | null>
    const usersMap: Record<string, UserProfile | null> = {};
    results.forEach(({ id, profile }) => {
      usersMap[id] = profile;
    });

    storage.getState().applyUsers(usersMap);
    logger.debug(
      `👤 Applied ${results.length} users to cache (${results.filter(r => r.profile).length} found, ${results.filter(r => !r.profile).length} not found)`
    );
  }

  /**
   * Subscribe to ephemeral updates (text_delta, text_complete, etc.)
   * Returns unsubscribe function.
   */
  onEphemeralUpdate(
    callback: (update: unknown) => void,
    options?: { sessionId?: string; messageId?: string }
  ): () => void {
    const sessionId = options?.sessionId;
    const messageId = options?.messageId;

    if (!sessionId && !messageId) {
      this.ephemeralGlobalCallbacks.add(callback);
      return () => {
        this.ephemeralGlobalCallbacks.delete(callback);
      };
    }

    if (sessionId && messageId) {
      let sessionMap = this.ephemeralSessionMessageCallbacks.get(sessionId);
      if (!sessionMap) {
        sessionMap = new Map();
        this.ephemeralSessionMessageCallbacks.set(sessionId, sessionMap);
      }
      let callbacks = sessionMap.get(messageId);
      if (!callbacks) {
        callbacks = new Set();
        sessionMap.set(messageId, callbacks);
      }
      callbacks.add(callback);
      return () => {
        callbacks.delete(callback);
        if (callbacks.size === 0) {
          sessionMap.delete(messageId);
        }
        if (sessionMap.size === 0) {
          this.ephemeralSessionMessageCallbacks.delete(sessionId);
        }
      };
    }

    if (sessionId) {
      let callbacks = this.ephemeralSessionCallbacks.get(sessionId);
      if (!callbacks) {
        callbacks = new Set();
        this.ephemeralSessionCallbacks.set(sessionId, callbacks);
      }
      callbacks.add(callback);
      return () => {
        callbacks.delete(callback);
        if (callbacks.size === 0) {
          this.ephemeralSessionCallbacks.delete(sessionId);
        }
      };
    }

    let callbacks = this.ephemeralMessageCallbacks.get(messageId!);
    if (!callbacks) {
      callbacks = new Set();
      this.ephemeralMessageCallbacks.set(messageId!, callbacks);
    }
    callbacks.add(callback);
    return () => {
      callbacks.delete(callback);
      if (callbacks.size === 0) {
        this.ephemeralMessageCallbacks.delete(messageId!);
      }
    };
  }

  //
  // Private
  //

  /** Wire-format session row from GET /v1/sessions or GET /v1/sessions/:id. */
  private mergeSessionsFromApiRows = async (
    sessions: Array<{
      id: string;
      tag?: string | null;
      seq: number;
      metadata: string;
      metadataVersion: number;
      agentState: string | null;
      agentStateVersion: number;
      capabilities?: string | null;
      capabilitiesVersion?: number;
      dataEncryptionKey: string | null;
      status: 'active' | 'offline' | 'archived' | 'deleted';
      activeAt: number;
      createdAt: number;
      updatedAt: number;
      lastMessage?: ApiMessage | null;
    }>
  ): Promise<void> => {
    // Initialize all session encryptions first
    const sessionKeys = new Map<string, Uint8Array | null>();
    for (const session of sessions) {
      if (session.dataEncryptionKey) {
        const decrypted = await this.encryption.decryptEncryptionKey(session.dataEncryptionKey);
        if (!decrypted) {
          logger.error(`Failed to decrypt data encryption key for session ${session.id}`);
          continue;
        }
        sessionKeys.set(session.id, decrypted);
      } else {
        sessionKeys.set(session.id, null);
      }
    }
    await this.encryption.initializeSessions(sessionKeys);

    // Decrypt sessions
    const decryptedSessions: (Omit<Session, 'presence'> & { presence?: 'online' | number })[] = [];
    for (const session of sessions) {
      // Get session encryption (should always exist after initialization)
      const sessionEncryption = this.encryption.getSessionEncryption(session.id);
      if (!sessionEncryption) {
        logger.error(`Session encryption not found for ${session.id} - this should never happen`);
        continue;
      }

      // Decrypt metadata using session-specific encryption
      const metadata = await sessionEncryption.decryptMetadata(
        session.metadataVersion,
        session.metadata
      );

      // Decrypt agent state using session-specific encryption
      const agentState = await sessionEncryption.decryptAgentState(
        session.agentStateVersion,
        session.agentState
      );
      const capabilities = await sessionEncryption.decryptCapabilities(
        session.capabilitiesVersion ?? 0,
        session.capabilities
      );

      // Put it all together
      // Preserve the current thinking state for existing sessions to avoid a
      // seq-gap race: fetchSessions can be triggered while an agent is working
      // (e.g. a missing seq forces a slow-path refetch), and hard-coding
      // thinking:false here would clear a valid thinking:true state set by a
      // task_started message. For new sessions (not yet in local storage) the
      // thinking state defaults to false as before.
      const existingSession = storage.getState().sessions[session.id];
      const processedSession = {
        ...session,
        thinking: existingSession?.thinking ?? false,
        thinkingAt: 0,
        metadata,
        agentState,
        capabilities,
        capabilitiesVersion: session.capabilitiesVersion ?? 0,
      };
      decryptedSessions.push(processedSession);
    }

    // Apply to storage
    this.applySessions(decryptedSessions);
  };

  /**
   * Loads one session by id when it is missing from the first page of GET /v1/sessions
   * (e.g. user has >150 sessions). Initializes encryption and merges into storage.
   */
  private hydrateSessionFromServerById = async (sessionId: string): Promise<boolean> => {
    if (!this.credentials) {
      return false;
    }
    const API_ENDPOINT = getServerUrl();
    const response = await fetch(`${API_ENDPOINT}/v1/sessions/${encodeURIComponent(sessionId)}`, {
      headers: {
        Authorization: `Bearer ${this.credentials.token}`,
        'Content-Type': 'application/json',
      },
    });
    if (response.status === 404) {
      logger.debug('[sync] hydrateSessionFromServerById: not found', { sessionId });
      return false;
    }
    if (!response.ok) {
      logger.warn('[sync] hydrateSessionFromServerById: request failed', {
        sessionId,
        status: response.status,
      });
      return false;
    }
    const data = await response.json();
    const session = data.session as
      | {
          id: string;
          seq: number;
          metadata: string;
          metadataVersion: number;
          agentState: string | null;
          agentStateVersion: number;
          capabilities?: string | null;
          capabilitiesVersion?: number;
          dataEncryptionKey: string | null;
          status: 'active' | 'offline' | 'archived' | 'deleted';
          activeAt: number;
          createdAt: number;
          updatedAt: number;
          lastMessage?: ApiMessage | null;
        }
      | undefined;
    if (!session || session.id !== sessionId) {
      logger.warn('[sync] hydrateSessionFromServerById: invalid response', { sessionId });
      return false;
    }
    await this.mergeSessionsFromApiRows([session]);
    return !!this.encryption.getSessionEncryption(sessionId);
  };

  /**
   * Structured telemetry when session encryption is missing after sync — helps NR distinguish
   * list truncation (>150), missing row, and cross-session races.
   */
  /**
   * Accepts root `Logger` or trace-scoped loggers from `withContext` (NR correlation).
   */
  private logEncryptionGapDiagnostics(
    log: Pick<Logger, 'error'>,
    sessionId: string,
    stage: 'after_list_sync' | 'final_failure'
  ): void {
    const sessions = storage.getState().sessions;
    const keys = Object.keys(sessions);
    log.error('Session encryption gap', undefined, {
      sessionId,
      stage,
      localSessionCount: keys.length,
      hasLocalSessionRow: !!sessions[sessionId],
      listPageLikelyTruncated: keys.length >= 150,
    });
  }

  private fetchSessions = async () => {
    if (!this.credentials) return;

    const API_ENDPOINT = getServerUrl();
    const response = await fetch(`${API_ENDPOINT}/v1/sessions`, {
      headers: {
        Authorization: `Bearer ${this.credentials.token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch sessions: ${response.status}`);
    }

    const data = await response.json();
    logger.debug('[sync] fetchSessions: got sessions', {
      count: Array.isArray(data.sessions) ? data.sessions.length : 0,
    });
    const sessions = data.sessions as Array<{
      id: string;
      tag: string | null;
      seq: number;
      metadata: string;
      metadataVersion: number;
      agentState: string | null;
      agentStateVersion: number;
      capabilities?: string | null;
      capabilitiesVersion?: number;
      dataEncryptionKey: string | null;
      status: 'active' | 'offline' | 'archived' | 'deleted';
      activeAt: number;
      createdAt: number;
      updatedAt: number;
      lastMessage: ApiMessage | null;
    }>;

    await this.mergeSessionsFromApiRows(sessions);

    // Reconcile deletions: the server returns all non-deleted sessions (up to 150).
    // When the count is under the limit, we have the full picture — any local session
    // absent from the response was hard-deleted on the server while the client was
    // offline and must be purged locally.
    if (sessions.length < 150) {
      const fetchedIds = new Set(sessions.map(s => s.id));
      for (const sessionId of Object.keys(storage.getState().sessions)) {
        if (!fetchedIds.has(sessionId)) {
          sessionLogger(logger, sessionId).info(
            '[sync] purging session absent from server response (deleted while offline)'
          );
          this.purgeSession(sessionId);
        }
      }
    }

    void Promise.allSettled(
      sessions.map(s => {
        const session = storage.getState().sessions[s.id];
        if (!session) {
          return Promise.resolve();
        }
        return persistCachedCapabilities({
          machineId: session.metadata?.machineId,
          agentType:
            session.metadata?.flavor === 'claude' ||
            session.metadata?.flavor === 'codex' ||
            session.metadata?.flavor === 'gemini' ||
            session.metadata?.flavor === 'opencode'
              ? session.metadata.flavor
              : null,
          capabilities: session.capabilities,
          updatedAt: session.updatedAt,
          persistRemote: false,
        });
      })
    );
    logger.debug(`📥 fetchSessions completed - processed ${sessions.length} sessions`);
  };

  public refreshMachines = async () => {
    return this.fetchMachines();
  };

  public refreshSessions = async () => {
    return this.sessionsSync.invalidateAndAwait();
  };

  public getCredentials() {
    return this.credentials;
  }

  // Artifact methods
  public fetchArtifactsList = async (): Promise<void> => {
    logger.debug('📦 fetchArtifactsList: Starting artifact sync');
    if (!this.credentials) {
      logger.debug('📦 fetchArtifactsList: No credentials, skipping');
      return;
    }

    try {
      logger.debug('📦 fetchArtifactsList: Fetching artifacts from server');
      const artifacts = await fetchArtifacts(this.credentials);
      logger.debug(`📦 fetchArtifactsList: Received ${artifacts.length} artifacts from server`);
      const decryptedArtifacts: DecryptedArtifact[] = [];

      for (const artifact of artifacts) {
        try {
          // Decrypt the data encryption key
          const decryptedKey = await this.encryption.decryptEncryptionKey(
            artifact.dataEncryptionKey
          );
          if (!decryptedKey) {
            logger.error(`Failed to decrypt key for artifact ${artifact.id}`);
            continue;
          }

          // Store the decrypted key in memory
          this.artifactDataKeys.set(artifact.id, decryptedKey);

          // Create artifact encryption instance
          const artifactEncryption = new ArtifactEncryption(decryptedKey);

          // Decrypt header
          const header = await artifactEncryption.decryptHeader(artifact.header);

          decryptedArtifacts.push({
            id: artifact.id,
            title: header?.title || null,
            sessions: header?.sessions, // Include sessions from header
            draft: header?.draft, // Include draft flag from header
            body: undefined, // Body not loaded in list
            headerVersion: artifact.headerVersion,
            bodyVersion: artifact.bodyVersion,
            seq: artifact.seq,
            createdAt: artifact.createdAt,
            updatedAt: artifact.updatedAt,
            isDecrypted: !!header,
          });
        } catch (err) {
          logger.error(`Failed to decrypt artifact ${artifact.id}:`, toError(err));
          // Add with decryption failed flag
          decryptedArtifacts.push({
            id: artifact.id,
            title: null,
            body: undefined,
            headerVersion: artifact.headerVersion,
            seq: artifact.seq,
            createdAt: artifact.createdAt,
            updatedAt: artifact.updatedAt,
            isDecrypted: false,
          });
        }
      }

      logger.debug(
        `📦 fetchArtifactsList: Successfully decrypted ${decryptedArtifacts.length} artifacts`
      );
      storage.getState().applyArtifacts(decryptedArtifacts);
      logger.debug('📦 fetchArtifactsList: Artifacts applied to storage');
    } catch (error) {
      logger.debug(`📦 fetchArtifactsList: Error fetching artifacts: ${error}`);
      logger.error('Failed to fetch artifacts:', toError(error));
      throw error;
    }
  };

  public async fetchArtifactWithBody(artifactId: string): Promise<DecryptedArtifact | null> {
    if (!this.credentials) return null;

    try {
      const artifact = await fetchArtifact(this.credentials, artifactId);

      // Decrypt the data encryption key
      const decryptedKey = await this.encryption.decryptEncryptionKey(artifact.dataEncryptionKey);
      if (!decryptedKey) {
        logger.error(`Failed to decrypt key for artifact ${artifactId}`);
        return null;
      }

      // Store the decrypted key in memory
      this.artifactDataKeys.set(artifact.id, decryptedKey);

      // Create artifact encryption instance
      const artifactEncryption = new ArtifactEncryption(decryptedKey);

      // Decrypt header and body
      const header = await artifactEncryption.decryptHeader(artifact.header);
      const body = artifact.body ? await artifactEncryption.decryptBody(artifact.body) : null;

      return {
        id: artifact.id,
        title: header?.title || null,
        sessions: header?.sessions, // Include sessions from header
        draft: header?.draft, // Include draft flag from header
        body: body?.body || null,
        headerVersion: artifact.headerVersion,
        bodyVersion: artifact.bodyVersion,
        seq: artifact.seq,
        createdAt: artifact.createdAt,
        updatedAt: artifact.updatedAt,
        isDecrypted: !!header,
      };
    } catch (error) {
      logger.error(`Failed to fetch artifact ${artifactId}:`, toError(error));
      return null;
    }
  }

  public async createArtifact(
    title: string | null,
    body: string | null,
    sessions?: string[],
    draft?: boolean
  ): Promise<string> {
    if (!this.credentials) {
      throw new Error('Not authenticated');
    }

    try {
      // Generate unique artifact ID
      const artifactId = this.encryption.generateId();

      // Generate data encryption key
      const dataEncryptionKey = ArtifactEncryption.generateDataEncryptionKey();

      // Store the decrypted key in memory
      this.artifactDataKeys.set(artifactId, dataEncryptionKey);

      // Encrypt the data encryption key with user's key
      const encryptedKey = await this.encryption.encryptEncryptionKey(dataEncryptionKey);

      // Create artifact encryption instance
      const artifactEncryption = new ArtifactEncryption(dataEncryptionKey);

      // Encrypt header and body
      const encryptedHeader = await artifactEncryption.encryptHeader({ title, sessions, draft });
      const encryptedBody = await artifactEncryption.encryptBody({ body });

      // Create the request
      const request: ArtifactCreateRequest = {
        id: artifactId,
        header: encryptedHeader,
        body: encryptedBody,
        dataEncryptionKey: encodeBase64(encryptedKey, 'base64'),
      };

      // Send to server
      const artifact = await createArtifact(this.credentials, request);

      // Add to local storage
      const decryptedArtifact: DecryptedArtifact = {
        id: artifact.id,
        title,
        sessions,
        draft,
        body,
        headerVersion: artifact.headerVersion,
        bodyVersion: artifact.bodyVersion,
        seq: artifact.seq,
        createdAt: artifact.createdAt,
        updatedAt: artifact.updatedAt,
        isDecrypted: true,
      };

      storage.getState().addArtifact(decryptedArtifact);

      return artifactId;
    } catch (error) {
      logger.error('Failed to create artifact:', toError(error));
      throw error;
    }
  }

  public async updateArtifact(
    artifactId: string,
    title: string | null,
    body: string | null,
    sessions?: string[],
    draft?: boolean
  ): Promise<void> {
    if (!this.credentials) {
      throw new Error('Not authenticated');
    }

    try {
      // Get current artifact to get versions and encryption key
      const currentArtifact = storage.getState().artifacts[artifactId];
      if (!currentArtifact) {
        throw new Error('Artifact not found');
      }

      // Get the data encryption key from memory or fetch it
      let dataEncryptionKey = this.artifactDataKeys.get(artifactId);

      // Fetch full artifact if we don't have version info or encryption key
      let headerVersion = currentArtifact.headerVersion;
      let bodyVersion = currentArtifact.bodyVersion;

      if (headerVersion === undefined || bodyVersion === undefined || !dataEncryptionKey) {
        const fullArtifact = await fetchArtifact(this.credentials, artifactId);
        headerVersion = fullArtifact.headerVersion;
        bodyVersion = fullArtifact.bodyVersion;

        // Decrypt and store the data encryption key if we don't have it
        if (!dataEncryptionKey) {
          const decryptedKey = await this.encryption.decryptEncryptionKey(
            fullArtifact.dataEncryptionKey
          );
          if (!decryptedKey) {
            throw new Error('Failed to decrypt encryption key');
          }
          this.artifactDataKeys.set(artifactId, decryptedKey);
          dataEncryptionKey = decryptedKey;
        }
      }

      // Create artifact encryption instance
      const artifactEncryption = new ArtifactEncryption(dataEncryptionKey);

      // Prepare update request
      const updateRequest: ArtifactUpdateRequest = {};

      // Check if header needs updating (title, sessions, or draft changed)
      if (
        title !== currentArtifact.title ||
        JSON.stringify(sessions) !== JSON.stringify(currentArtifact.sessions) ||
        draft !== currentArtifact.draft
      ) {
        const encryptedHeader = await artifactEncryption.encryptHeader({
          title,
          sessions,
          draft,
        });
        updateRequest.header = encryptedHeader;
        updateRequest.expectedHeaderVersion = headerVersion;
      }

      // Only update body if it changed
      if (body !== currentArtifact.body) {
        const encryptedBody = await artifactEncryption.encryptBody({ body });
        updateRequest.body = encryptedBody;
        updateRequest.expectedBodyVersion = bodyVersion;
      }

      // Skip if no changes
      if (Object.keys(updateRequest).length === 0) {
        return;
      }

      // Send update to server
      const response = await updateArtifact(this.credentials, artifactId, updateRequest);

      if (!response.success) {
        // Handle version mismatch
        if (response.error === 'version-mismatch') {
          throw new Error('Artifact was modified by another client. Please refresh and try again.');
        }
        throw new Error('Failed to update artifact');
      }

      // Update local storage
      const updatedArtifact: DecryptedArtifact = {
        ...currentArtifact,
        title,
        sessions,
        draft,
        body,
        headerVersion:
          response.headerVersion !== undefined ? response.headerVersion : headerVersion,
        bodyVersion: response.bodyVersion !== undefined ? response.bodyVersion : bodyVersion,
        updatedAt: Date.now(),
      };

      storage.getState().updateArtifact(updatedArtifact);
    } catch (error) {
      logger.error('Failed to update artifact:', toError(error));
      throw error;
    }
  }

  private fetchMachines = async () => {
    if (!this.credentials) return;

    logger.debug('📊 Sync: Fetching machines...');
    const API_ENDPOINT = getServerUrl();
    const response = await fetch(`${API_ENDPOINT}/v1/machines`, {
      headers: {
        Authorization: `Bearer ${this.credentials.token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      logger.error(`Failed to fetch machines: ${response.status}`);
      return;
    }

    const data = await response.json();
    logger.debug(`📊 Sync: Fetched ${Array.isArray(data) ? data.length : 0} machines from server`);
    const machines = data as Array<{
      id: string;
      metadata: string;
      metadataVersion: number;
      daemonState?: string | null;
      daemonStateVersion?: number;
      dataEncryptionKey?: string | null; // Add support for per-machine encryption keys
      seq: number;
      active: boolean;
      activeAt: number; // Changed from lastActiveAt
      createdAt: number;
      updatedAt: number;
    }>;

    // First, collect and decrypt encryption keys for all machines
    const machineKeysMap = new Map<string, Uint8Array | null>();
    for (const machine of machines) {
      if (machine.dataEncryptionKey) {
        const decryptedKey = await this.encryption.decryptEncryptionKey(machine.dataEncryptionKey);
        if (!decryptedKey) {
          logger.error(`Failed to decrypt data encryption key for machine ${machine.id}`);
          continue;
        }
        machineKeysMap.set(machine.id, decryptedKey);
        this.machineDataKeys.set(machine.id, decryptedKey);
      } else {
        machineKeysMap.set(machine.id, null);
      }
    }

    // Initialize machine encryptions
    await this.encryption.initializeMachines(machineKeysMap);

    // Process all machines first, then update state once
    const decryptedMachines: Machine[] = [];

    for (const machine of machines) {
      // Get machine-specific encryption (might exist from previous initialization)
      const machineEncryption = this.encryption.getMachineEncryption(machine.id);
      if (!machineEncryption) {
        logger.error(`Machine encryption not found for ${machine.id} - this should never happen`);
        continue;
      }

      try {
        // Use machine-specific encryption (which handles fallback internally)
        const metadata = machine.metadata
          ? await machineEncryption.decryptMetadata(machine.metadataVersion, machine.metadata)
          : null;

        const daemonState = machine.daemonState
          ? await machineEncryption.decryptDaemonState(
              machine.daemonStateVersion || 0,
              machine.daemonState
            )
          : null;

        decryptedMachines.push({
          id: machine.id,
          seq: machine.seq,
          createdAt: machine.createdAt,
          updatedAt: machine.updatedAt,
          active: machine.active,
          activeAt: machine.activeAt,
          metadata,
          metadataVersion: machine.metadataVersion,
          daemonState,
          daemonStateVersion: machine.daemonStateVersion || 0,
        });
      } catch (error) {
        logger.error(`Failed to decrypt machine ${machine.id}:`, toError(error));
        // Still add the machine with null metadata
        decryptedMachines.push({
          id: machine.id,
          seq: machine.seq,
          createdAt: machine.createdAt,
          updatedAt: machine.updatedAt,
          active: machine.active,
          activeAt: machine.activeAt,
          metadata: null,
          metadataVersion: machine.metadataVersion,
          daemonState: null,
          daemonStateVersion: 0,
        });
      }
    }

    // Replace entire machine state with fetched machines
    storage.getState().applyMachines(decryptedMachines, true);
    logger.debug(`🖥️ fetchMachines completed - processed ${decryptedMachines.length} machines`);
  };

  private fetchFriends = async () => {
    if (!this.credentials) return;

    try {
      logger.debug('👥 Fetching friends list...');
      const friendsList = await getFriendsList(this.credentials);
      storage.getState().applyFriends(friendsList);
      logger.debug(`👥 fetchFriends completed - processed ${friendsList.length} friends`);
    } catch (error) {
      logger.error('Failed to fetch friends:', toError(error));
      // Silently handle error - UI will show appropriate state
    }
  };

  private fetchFriendRequests = async () => {
    // Friend requests are now included in the friends list with status='pending'
    // This method is kept for backward compatibility but does nothing
    logger.debug('👥 fetchFriendRequests called - now handled by fetchFriends');
  };

  private fetchFeed = async () => {
    if (!this.credentials) return;

    try {
      logger.debug('📰 Fetching feed...');
      const state = storage.getState();
      const existingItems = state.feedItems;
      const head = state.feedHead;

      // Load feed items - if we have a head, load newer items
      const allItems: FeedItem[] = [];
      let hasMore = true;
      let cursor = head ? { after: head } : undefined;
      let loadedCount = 0;
      const maxItems = 500;

      // Keep loading until we reach known items or hit max limit
      while (hasMore && loadedCount < maxItems) {
        const response = await fetchFeed(this.credentials, {
          limit: 100,
          ...cursor,
        });

        // Check if we reached known items
        const foundKnown = response.items.some(item =>
          existingItems.some(existing => existing.id === item.id)
        );

        allItems.push(...response.items);
        loadedCount += response.items.length;
        hasMore = response.hasMore && !foundKnown;

        // Update cursor for next page
        if (response.items.length > 0) {
          const lastItem = response.items[response.items.length - 1];
          cursor = { after: lastItem.cursor };
        }
      }

      // If this is initial load (no head), also load older items
      if (!head && allItems.length < 100) {
        const response = await fetchFeed(this.credentials, {
          limit: 100,
        });
        allItems.push(...response.items);
      }

      // Collect user IDs from friend-related feed items
      const userIds = new Set<string>();
      allItems.forEach(item => {
        if (
          item.body &&
          (item.body.kind === 'friend_request' || item.body.kind === 'friend_accepted')
        ) {
          userIds.add(item.body.uid);
        }
      });

      // Fetch missing users
      if (userIds.size > 0) {
        await this.assumeUsers(Array.from(userIds));
      }

      // Filter out items where user is not found (404)
      const users = storage.getState().users;
      const compatibleItems = allItems.filter(item => {
        // Keep text items
        if (item.body.kind === 'text') return true;

        // For friend-related items, check if user exists and is not null (404)
        if (item.body.kind === 'friend_request' || item.body.kind === 'friend_accepted') {
          const userProfile = users[item.body.uid];
          // Keep item only if user exists and is not null
          return userProfile !== null && userProfile !== undefined;
        }

        return true;
      });

      // Apply only compatible items to storage
      storage.getState().applyFeedItems(compatibleItems);
      logger.debug(
        `📰 fetchFeed completed - loaded ${compatibleItems.length} compatible items (${allItems.length - compatibleItems.length} filtered)`
      );
    } catch (error) {
      logger.error('Failed to fetch feed:', toError(error));
    }
  };

  private syncSettings = async () => {
    if (!this.credentials) return;

    const API_ENDPOINT = getServerUrl();
    const maxRetries = 3;
    let retryCount = 0;

    // Apply pending settings
    if (Object.keys(this.pendingSettings).length > 0) {
      while (retryCount < maxRetries) {
        const version = storage.getState().settingsVersion;
        const settings = applySettings(storage.getState().settings, this.pendingSettings);
        const response = await fetch(`${API_ENDPOINT}/v1/account/settings`, {
          method: 'POST',
          body: JSON.stringify({
            settings: await this.encryption.encryptRaw(settings),
            expectedVersion: version ?? 0,
          }),
          headers: {
            Authorization: `Bearer ${this.credentials.token}`,
            'Content-Type': 'application/json',
          },
        });
        const data = (await response.json()) as
          | {
              success: false;
              error: string;
              currentVersion: number;
              currentSettings: string | null;
            }
          | {
              success: true;
            };
        if (data.success) {
          this.pendingSettings = {};
          savePendingSettings({});
          break;
        }
        if (data.error === 'version-mismatch') {
          // Parse server settings
          const serverSettings = data.currentSettings
            ? settingsParse(await this.encryption.decryptRaw(data.currentSettings))
            : { ...settingsDefaults };

          // Merge: server base + our pending changes (our changes win)
          const mergedSettings = applySettings(serverSettings, this.pendingSettings);

          // Update local storage with merged result at server's version
          storage.getState().applySettings(mergedSettings, data.currentVersion);

          // Log and retry
          logger.debug('settings version-mismatch, retrying', {
            serverVersion: data.currentVersion,
            retry: retryCount + 1,
            pendingKeys: Object.keys(this.pendingSettings),
          });
          retryCount++;
          continue;
        } else {
          throw new Error(`Failed to sync settings: ${data.error}`);
        }
      }
    }

    // If exhausted retries, throw to trigger outer backoff delay
    if (retryCount >= maxRetries) {
      throw new Error(`Settings sync failed after ${maxRetries} retries due to version conflicts`);
    }

    // Run request
    const response = await fetch(`${API_ENDPOINT}/v1/account/settings`, {
      headers: {
        Authorization: `Bearer ${this.credentials.token}`,
        'Content-Type': 'application/json',
      },
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch settings: ${response.status}`);
    }
    const data = (await response.json()) as {
      settings: string | null;
      settingsVersion: number;
    };

    // Parse response
    let parsedSettings: Settings;
    if (data.settings) {
      parsedSettings = settingsParse(await this.encryption.decryptRaw(data.settings));
    } else {
      parsedSettings = { ...settingsDefaults };
    }

    // Log
    logger.debug(
      'settings',
      JSON.stringify({
        settings: parsedSettings,
        version: data.settingsVersion,
      })
    );

    // Apply settings to storage
    storage.getState().applySettings(parsedSettings, data.settingsVersion);
  };

  private fetchProfile = async () => {
    if (!this.credentials) return;

    const API_ENDPOINT = getServerUrl();
    const response = await fetch(`${API_ENDPOINT}/v1/account/profile`, {
      headers: {
        Authorization: `Bearer ${this.credentials.token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch profile: ${response.status}`);
    }

    const data = await response.json();
    const parsedProfile = profileParse(data);

    // Log profile data for debugging
    logger.debug(
      'profile',
      JSON.stringify({
        id: parsedProfile.id,
        timestamp: parsedProfile.timestamp,
        firstName: parsedProfile.firstName,
        lastName: parsedProfile.lastName,
        hasAvatar: !!parsedProfile.avatar,
        hasGitHub: !!parsedProfile.github,
      })
    );

    // Apply profile to storage
    storage.getState().applyProfile(parsedProfile);
  };

  private fetchNativeUpdate = async () => {
    try {
      // Skip in development
      if ((Platform.OS !== 'android' && Platform.OS !== 'ios') || !Constants.expoConfig?.version) {
        return;
      }
      if (Platform.OS === 'ios' && !Constants.expoConfig?.ios?.bundleIdentifier) {
        return;
      }
      if (Platform.OS === 'android' && !Constants.expoConfig?.android?.package) {
        return;
      }

      const serverUrl = getServerUrl();

      // Get platform and app identifiers
      const platform = Platform.OS;
      const version = Constants.expoConfig?.version!;
      const appId =
        Platform.OS === 'ios'
          ? Constants.expoConfig?.ios?.bundleIdentifier!
          : Constants.expoConfig?.android?.package!;

      const response = await fetch(`${serverUrl}/v1/version`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          platform,
          version,
          app_id: appId,
        }),
      });

      if (!response.ok) {
        logger.debug(`[fetchNativeUpdate] Request failed: ${response.status}`);
        return;
      }

      const data = await response.json();
      logger.debug('[fetchNativeUpdate] Data:', data);

      // Apply update status to storage
      if (data.update_required && data.update_url) {
        storage.getState().applyNativeUpdateStatus({
          available: true,
          updateUrl: data.update_url,
        });
      } else {
        storage.getState().applyNativeUpdateStatus({
          available: false,
        });
      }
    } catch (error) {
      logger.debug('[fetchNativeUpdate] Error:', error);
      storage.getState().applyNativeUpdateStatus(null);
    }
  };

  private syncPurchases = async () => {
    try {
      // Initialize RevenueCat if not already done
      if (!this.revenueCatInitialized) {
        // Get the appropriate API key based on platform
        let apiKey: string | undefined;

        if (Platform.OS === 'ios') {
          apiKey = config.revenueCatAppleKey;
        } else if (Platform.OS === 'android') {
          apiKey = config.revenueCatGoogleKey;
        } else if (Platform.OS === 'web') {
          apiKey = config.revenueCatStripeKey;
        }

        if (!apiKey || apiKey.includes('_here')) {
          logger.debug(
            `[RevenueCat] Skipping init: ${!apiKey ? 'no API key' : 'placeholder key'} for platform ${Platform.OS}`
          );
          return;
        }

        // Configure RevenueCat
        if (__DEV__) {
          RevenueCat.setLogLevel(LogLevel.DEBUG);
        }

        // Initialize with the public ID as user ID
        RevenueCat.configure({
          apiKey,
          appUserID: this.accountId, // In server this is a CUID, which we can assume is globaly unique even between servers
          useAmazon: false,
        });

        this.revenueCatInitialized = true;
        logger.debug('RevenueCat initialized successfully');
      }

      // Sync purchases
      await RevenueCat.syncPurchases();

      // Fetch customer info
      const customerInfo = await RevenueCat.getCustomerInfo();

      // Apply to storage (storage handles the transformation)
      storage.getState().applyPurchases(customerInfo);
    } catch (error) {
      logger.warn('Failed to sync purchases', { error: safeStringify(error) });
      // Don't throw - purchases are optional
    }
  };

  /** Server accepts at most 100 messages per batch. */
  private static readonly FLUSH_BATCH_SIZE = 100;

  private flushOutbox = async (sessionId: string) => {
    const log = sessionLogger(logger, sessionId);
    const pending = this.pendingOutbox.get(sessionId);
    if (!pending || pending.length === 0) {
      if (!this.hasPendingOutboxMessages()) {
        this.clearBackgroundSendWatchdog();
        await this.cancelBackgroundSendTimeoutNotification();
        this.backgroundSendStartedAt = null;
      }
      return;
    }

    // Socket.IO v4.8+ rejects emitWithAck() immediately when disconnected.
    // Don't attempt to flush — onReconnected() will re-invalidate sendSync for all sessions.
    if (apiSocket.getStatus() !== 'connected') {
      return;
    }

    // Drain in batches via WebSocket emitWithAck (RFC-010).
    while (pending.length > 0) {
      const batch = pending.slice(0, Sync.FLUSH_BATCH_SIZE);
      log.debug('flushOutbox: sending batch', {
        batchSize: batch.length,
        total: pending.length,
      });
      try {
        const ack = await apiSocket.emitWithAck<{
          ok: boolean;
          messages?: Array<{ id: string; seq: number }>;
          error?: string;
        }>('send-messages', {
          sessionId,
          messages: batch.map(message => ({
            id: message.id,
            content: message.content,
            ...(message._trace ? { _trace: message._trace } : {}),
          })),
        });

        if (!ack.ok) {
          throw new Error(`Failed to send messages for ${sessionId}: ${ack.error}`);
        }

        log.debug('flushOutbox: batch sent successfully', {
          batchSize: batch.length,
          remaining: pending.length - batch.length,
        });
        pending.splice(0, batch.length);
        this.persistOutbox();
        if (Array.isArray(ack.messages) && ack.messages.length > 0) {
          const currentLastSeq = this.sessionLastSeq.get(sessionId) ?? 0;
          let maxSeq = currentLastSeq;
          for (const message of ack.messages) {
            if (message.seq > maxSeq) {
              maxSeq = message.seq;
            }
          }
          if (maxSeq > currentLastSeq) {
            // Check if new messages are consecutive with current position.
            // If there's a gap, DON'T advance sessionLastSeq — trigger a fetch
            // so fetchMessages fills the gap and advances properly.
            const newMsgs = ack.messages.filter(m => m.seq > currentLastSeq);
            const minNewSeq =
              newMsgs.length > 0 ? Math.min(...newMsgs.map(m => m.seq)) : currentLastSeq + 1;
            if (minNewSeq <= currentLastSeq + 1) {
              this.setSessionLastSeq(sessionId, maxSeq);
            } else {
              log.info('flushOutbox: seq gap detected, triggering fetch to fill', {
                currentLastSeq,
                minNewSeq,
                maxSeq,
              });
              this.getMessagesSync(sessionId).invalidate();
            }
          }
        }
      } catch (error) {
        log.error('flushOutbox: failed to send batch', toError(error), {
          batchSize: batch.length,
        });
        storage.getState().setSessionSendError(sessionId, {
          message: 'Message failed to send. Will retry automatically.',
          timestamp: Date.now(),
        });
        this.maybeStartBackgroundSendWatchdog();
        throw error;
      }
    }

    // All messages sent successfully — clear any previous error
    storage.getState().setSessionSendError(sessionId, null);
    this.pendingOutbox.delete(sessionId);
    this.persistOutbox();
    if (!this.hasPendingOutboxMessages()) {
      this.clearBackgroundSendWatchdog();
      await this.cancelBackgroundSendTimeoutNotification();
      this.backgroundSendStartedAt = null;
    } else if (this.appState !== 'active') {
      this.maybeStartBackgroundSendWatchdog();
    }
  };

  /** Maximum pages to fetch in a single paginated run (safety cap). */
  private static readonly MAX_FETCH_PAGES = 40;

  private fetchMessages = async (sessionId: string) => {
    const log = sessionLogger(logger, sessionId);
    log.debug('fetchMessages starting');

    let encryption = this.encryption.getSessionEncryption(sessionId);
    if (!encryption) {
      await this.hydrateSessionFromServerById(sessionId);
      encryption = this.encryption.getSessionEncryption(sessionId);
    }
    if (!encryption) {
      log.debug('fetchMessages: Session encryption not ready, will retry');
      throw new Error(`Session encryption not ready for ${sessionId}`);
    }

    const startAfterSeq = this.sessionLastSeq.get(sessionId) ?? 0;
    let afterSeq = startAfterSeq;
    let hasMore = true;
    let totalNormalized = 0;
    let pageCount = 0;
    let minSeqSeen: number | undefined;

    while (hasMore && pageCount < Sync.MAX_FETCH_PAGES) {
      pageCount++;
      const ack = await apiSocket.emitWithAck<{
        ok: boolean;
        messages?: ApiMessage[];
        hasMore?: boolean;
        error?: string;
      }>('fetch-messages', {
        sessionId,
        after_seq: afterSeq,
        limit: Sync.FETCH_MESSAGES_PAGE_SIZE,
      });

      if (!ack.ok) {
        throw new Error(`Failed to fetch messages for ${sessionId}: ${ack.error}`);
      }

      const messages = Array.isArray(ack.messages) ? ack.messages : [];

      let maxSeq = afterSeq;
      for (const message of messages) {
        if (message.seq > maxSeq) {
          maxSeq = message.seq;
        }
      }

      if (startAfterSeq === 0 && messages.length > 0) {
        const pageMin = Math.min(...messages.map(m => m.seq));
        if (minSeqSeen === undefined || pageMin < minSeqSeen) {
          minSeqSeen = pageMin;
        }
      }

      const decryptedMessages = await encryption.decryptMessages(messages);
      const normalizedMessages: NormalizedMessage[] = [];
      // Track the original index so SQLite cache writes use the correct seq/content.
      const normalizedOriginalIndices: number[] = [];
      for (let i = 0; i < decryptedMessages.length; i++) {
        const decrypted = decryptedMessages[i];
        if (!decrypted) {
          continue;
        }
        const normalized = normalizeRawMessage(
          decrypted.id,
          decrypted.createdAt,
          decrypted.content
        );
        if (normalized) {
          if (!normalized.traceId && decrypted.traceId) normalized.traceId = decrypted.traceId;
          const msgSeq = messages[i]?.seq;
          if (msgSeq) normalized.seq = msgSeq;
          normalizedMessages.push(normalized);
          normalizedOriginalIndices.push(i);
        }
      }

      if (normalizedMessages.length > 0) {
        totalNormalized += normalizedMessages.length;
        this.enqueueMessages(sessionId, normalizedMessages);

        // Write to local SQLite cache (fire-and-forget, don't block rendering)
        const cacheEntries = normalizedMessages.map((n, idx) => {
          const origIdx = normalizedOriginalIndices[idx];
          return {
            id: n.id,
            session_id: sessionId,
            seq: messages[origIdx]?.seq ?? 0,
            content: serializeCachedContent(decryptedMessages[origIdx]?.content),
            trace_id: n.traceId ?? decryptedMessages[origIdx]?.traceId ?? null,
            role: n.role ?? 'agent',
            created_at: n.createdAt ?? Date.now(),
            updated_at: Date.now(),
          };
        });
        messageDB
          .upsertMessagesAndSeq(sessionId, cacheEntries, maxSeq)
          .catch(e => log.debug('[sync] messageDB upsertAndSeq failed', { error: String(e) }));
      } else {
        messageDB
          .updateLastSeq(sessionId, maxSeq)
          .catch(e => log.debug('[sync] messageDB updateLastSeq failed', { error: String(e) }));
      }

      this.setSessionLastSeq(sessionId, maxSeq);
      hasMore = !!ack.hasMore;
      if (hasMore && maxSeq === afterSeq) {
        log.debug('fetchMessages: pagination stalled, stopping to avoid infinite loop');
        break;
      }
      afterSeq = maxSeq;
    }

    if (hasMore && pageCount >= Sync.MAX_FETCH_PAGES) {
      log.info('fetchMessages: hit page cap, scheduling continuation', {
        maxPages: Sync.MAX_FETCH_PAGES,
        afterSeq,
      });
      // Schedule another fetch round to continue loading remaining messages.
      // InvalidateSync._invalidatedDouble chains rounds until hasMore === false.
      this.getMessagesSync(sessionId).invalidate();
    }

    if (startAfterSeq === 0 && minSeqSeen !== undefined) {
      if (!this.sessionOldestSeq.has(sessionId)) {
        this.sessionOldestSeq.set(sessionId, minSeqSeen);
      }
      const existingOlderState = storage.getState().sessionMessages[sessionId];
      if (existingOlderState && !existingOlderState.hasOlderMessages && minSeqSeen > 1) {
        storage.getState().setSessionOlderMessagesState(sessionId, { hasOlderMessages: true });
      }
    }

    // Flush any pending batched messages (from cache or earlier pages) before
    // marking the session as loaded. Without this, applyMessagesLoaded may create
    // an empty session entry (messages=[]) when the batch timer hasn't fired yet,
    // causing ChatList to unmount and remount — losing scroll position on web.
    this.flushMessageQueue(sessionId);

    storage.getState().applyMessagesLoaded(sessionId);

    // Reconcile hasOlderMessages with sessionOldestSeq.
    // This fixes a race where onSessionVisible sets hasOlderMessages before
    // the session state exists (no-op), and fetchMessages with startAfterSeq > 0
    // skips the minSeqSeen block. After applyMessagesLoaded the state is guaranteed
    // to exist, so we can safely set it here.
    const oldestSeq = this.sessionOldestSeq.get(sessionId);
    if (oldestSeq != null && oldestSeq > 1) {
      const sm = storage.getState().sessionMessages[sessionId];
      if (sm && !sm.hasOlderMessages) {
        storage.getState().setSessionOlderMessagesState(sessionId, { hasOlderMessages: true });
      }
    }

    log.debug('fetchMessages completed', { totalNormalized, pageCount });
  };

  /** Tracks the minimum seq loaded per session — used as cursor for "load older" */
  private sessionOldestSeq = new Map<string, number>();

  /**
   * Pull-to-refresh: re-fetch latest messages from server for the given session.
   * Returns a promise that resolves when the fetch completes.
   */
  async refreshMessages(sessionId: string): Promise<void> {
    await this.getMessagesSync(sessionId).invalidateAndAwait();
  }

  /**
   * Load older messages for a session (triggered by scroll-up in ChatList).
   */
  async loadOlderMessages(sessionId: string) {
    const sessionMessages = storage.getState().sessionMessages[sessionId];
    if (!sessionMessages || sessionMessages.isLoadingOlder || !sessionMessages.hasOlderMessages)
      return;

    const log = sessionLogger(logger, sessionId);
    const beforeSeq = this.sessionOldestSeq.get(sessionId);
    if (beforeSeq == null || beforeSeq <= 1) {
      storage.getState().setSessionOlderMessagesState(sessionId, { hasOlderMessages: false });
      return;
    }

    storage.getState().setSessionOlderMessagesState(sessionId, { isLoadingOlder: true });
    try {
      // --- SQLite cache-first: serve older messages from local cache when available ---
      const sqliteCached = await messageDB.getMessages(sessionId, {
        limit: 50,
        beforeSeq,
      });
      if (sqliteCached.length > 0) {
        const normalizedFromCache: NormalizedMessage[] = [];
        for (const msg of sqliteCached) {
          let content: any;
          try {
            content = JSON.parse(msg.content);
          } catch {
            continue;
          }
          const n = normalizeRawMessage(msg.id, msg.created_at, content);
          if (n) {
            n.seq = msg.seq;
            if (!n.traceId && msg.trace_id) n.traceId = msg.trace_id;
            normalizedFromCache.push(n);
          }
        }
        if (normalizedFromCache.length > 0) {
          this.enqueueMessages(sessionId, normalizedFromCache);
        }
        const minSeq = Math.min(...sqliteCached.map(m => m.seq));
        this.sessionOldestSeq.set(sessionId, minSeq);
        storage.getState().setSessionOlderMessagesState(sessionId, {
          hasOlderMessages: minSeq > 1,
          isLoadingOlder: false,
        });
        return;
      }
      // ---------------------------------------------------------------------------

      const encryption = this.encryption.getSessionEncryption(sessionId);
      if (!encryption) {
        storage.getState().setSessionOlderMessagesState(sessionId, { isLoadingOlder: false });
        return;
      }

      const ack = await apiSocket.emitWithAck<{
        ok: boolean;
        messages?: ApiMessage[];
        hasOlderMessages?: boolean;
        error?: string;
      }>('fetch-messages', {
        sessionId,
        before_seq: beforeSeq,
        limit: 1000,
      });

      if (!ack.ok || !Array.isArray(ack.messages) || ack.messages.length === 0) {
        storage.getState().setSessionOlderMessagesState(sessionId, {
          hasOlderMessages: false,
          isLoadingOlder: false,
        });
        return;
      }

      // Update oldest seq cursor
      const minSeq = Math.min(...ack.messages.map(m => m.seq));
      this.sessionOldestSeq.set(sessionId, minSeq);

      const decryptedMessages = await encryption.decryptMessages(ack.messages);
      const normalizedMessages: NormalizedMessage[] = [];
      for (let i = 0; i < decryptedMessages.length; i++) {
        const decrypted = decryptedMessages[i];
        if (!decrypted) continue;
        const n = normalizeRawMessage(decrypted.id, decrypted.createdAt, decrypted.content);
        if (n) {
          if (!n.traceId && decrypted.traceId) n.traceId = decrypted.traceId;
          const msgSeq = ack.messages![i]?.seq;
          if (msgSeq) n.seq = msgSeq;
          normalizedMessages.push(n);
        }
      }

      if (normalizedMessages.length > 0) {
        this.enqueueMessages(sessionId, normalizedMessages);
        // Cache to SQLite
        const cacheEntries = normalizedMessages.map((n, i) => ({
          id: n.id,
          session_id: sessionId,
          seq: ack.messages![i]?.seq ?? 0,
          content: serializeCachedContent(decryptedMessages[i]?.content),
          trace_id: n.traceId ?? decryptedMessages[i]?.traceId ?? null,
          role: n.role ?? 'agent',
          created_at: n.createdAt ?? Date.now(),
          updated_at: Date.now(),
        }));
        messageDB
          .upsertMessages(sessionId, cacheEntries)
          .catch(e => log.debug('[sync] messageDB upsert failed', { error: String(e) }));
      }

      storage.getState().setSessionOlderMessagesState(sessionId, {
        hasOlderMessages: ack.hasOlderMessages !== false,
        isLoadingOlder: false,
      });
    } catch (error) {
      log.error('[sync] loadOlderMessages failed', undefined, {
        error: safeStringify(error),
      });
      storage.getState().setSessionOlderMessagesState(sessionId, { isLoadingOlder: false });
    }
  }

  /**
   * Clear the local SQLite message cache, in-memory seq tracking, Zustand
   * store messages, and messagesSync instances so the next onSessionVisible()
   * re-fetches everything from the server.
   */
  async clearMessageCache(): Promise<void> {
    await messageDB.deleteAll();
    this.clearSessionLastSeqs();
    this.sessionOldestSeq.clear();

    // Flush any pending message batch timers
    for (const timer of this.sessionBatchTimers.values()) {
      clearTimeout(timer);
    }
    this.sessionMessageQueue.clear();
    this.sessionBatchTimers.clear();

    // Stop in-flight fetches, then drop instances so fresh ones are created
    for (const sync of this.messagesSync.values()) {
      sync.stop();
    }
    this.messagesSync.clear();

    // Stop in-flight sends and clear pending outbox
    for (const sync of this.sendSync.values()) {
      sync.stop();
    }
    this.sendSync.clear();
    this.pendingOutbox.clear();

    // Clear in-memory Zustand store so UI doesn't show stale messages
    storage.getState().clearAllSessionMessages();

    logger.info('[sync] message cache cleared');
  }

  /**
   * Clear the local cache for a single session: SQLite messages/sync,
   * in-memory seq tracking, encryption cache, batch timers, messagesSync,
   * send state, and Zustand messages — so the next visit re-fetches from server.
   */
  async clearSessionCache(sessionId: string): Promise<void> {
    const log = sessionLogger(logger, sessionId);
    // SQLite: messages + session_sync rows
    await messageDB.deleteSession(sessionId);

    // Seq tracking
    this.deleteSessionLastSeq(sessionId);
    this.sessionOldestSeq.delete(sessionId);

    // Flush pending message batch timer
    const batchTimer = this.sessionBatchTimers.get(sessionId);
    if (batchTimer) {
      clearTimeout(batchTimer);
      this.sessionBatchTimers.delete(sessionId);
    }
    this.sessionMessageQueue.delete(sessionId);
    this.sessionQueueProcessing.delete(sessionId);

    // Stop in-flight message fetch
    const msgSync = this.messagesSync.get(sessionId);
    if (msgSync) {
      msgSync.stop();
      this.messagesSync.delete(sessionId);
    }

    // Stop in-flight send and clear pending outbox
    const sSync = this.sendSync.get(sessionId);
    if (sSync) {
      sSync.stop();
      this.sendSync.delete(sessionId);
    }
    this.pendingOutbox.delete(sessionId);
    this.persistOutbox();

    // Encryption cache (decrypted agentState/metadata/capabilities)
    this.encryption.clearSessionDecryptionCache(sessionId);

    // Wire trace
    clearSessionTrace(sessionId);

    // Git status cache
    gitStatusSync.clearForSession(sessionId);

    // Zustand: remove this session's messages entirely so the reducer
    // starts fresh (processedIds is cleared). applyMessages / applyMessagesLoaded
    // will recreate the entry from scratch.
    storage.getState().dropSessionMessages([sessionId]);

    log.info('[sync] session cache cleared');

    // Re-trigger fetch so the session reloads from server immediately.
    // onSessionVisible won't be called again because SessionView is already mounted.
    this.onSessionVisible(sessionId);
  }

  private enqueueReconnectAck(reconnectToken: string) {
    if (!this.pendingReconnectAcks.includes(reconnectToken)) {
      this.pendingReconnectAcks = [...this.pendingReconnectAcks, reconnectToken];
      savePendingReconnectAcks(this.pendingReconnectAcks);
    }
    void this.flushReconnectAckQueue();
  }

  private postReconnectAck = async (reconnectToken: string) => {
    if (!this.credentials) {
      throw new Error('Missing credentials for reconnect ack');
    }

    const response = await fetch(`${getServerUrl()}/v1/push-reconnect-ack`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.credentials.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ reconnectToken }),
    });
    if (!response.ok) {
      throw new Error(`push-reconnect-ack failed: ${response.status}`);
    }
  };

  private flushReconnectAckQueue = async () => {
    if (this.reconnectAckFlushPromise) {
      return this.reconnectAckFlushPromise;
    }

    this.reconnectAckFlushPromise = (async () => {
      while (this.pendingReconnectAcks.length > 0) {
        const reconnectToken = this.pendingReconnectAcks[0];
        try {
          await this.postReconnectAck(reconnectToken);
          this.pendingReconnectAcks = this.pendingReconnectAcks.slice(1);
          savePendingReconnectAcks(this.pendingReconnectAcks);
        } catch (err) {
          logger.debug('[sync] push-reconnect-ack failed', { error: String(err), reconnectToken });
          break;
        }
      }
    })().finally(() => {
      this.reconnectAckFlushPromise = null;
    });

    return this.reconnectAckFlushPromise;
  };

  private registerPushToken = async ({
    requestPermission = false,
    forceRefresh = false,
    source = 'sync',
    tokenOverride,
  }: {
    requestPermission?: boolean;
    forceRefresh?: boolean;
    source?: string;
    tokenOverride?: string;
  } = {}): Promise<PushRegistrationResult> => {
    logger.debug('[sync] registerPushToken', { requestPermission, forceRefresh, source });
    if (Platform.OS === 'web') {
      return 'unsupported';
    }

    const existingPermission = await Notifications.getPermissionsAsync();
    let finalPermission = existingPermission;

    if (existingPermission.status !== 'granted') {
      if (!requestPermission) {
        logger.debug('[sync] Skipping push token registration without notification permission', {
          status: existingPermission.status,
          source,
        });
        return 'skipped';
      }
      if (existingPermission.canAskAgain === false) {
        logger.info('[sync] Notification permission requires opening system settings');
        return 'settings-required';
      }
      finalPermission = await Notifications.requestPermissionsAsync();
    }

    if (finalPermission.status !== 'granted') {
      logger.info('[sync] Notification permission denied', { source });
      return 'denied';
    }

    const projectId =
      Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;
    if (!projectId) {
      logger.warn('[sync] Missing Expo projectId while registering push token');
      return 'unsupported';
    }

    const pushToken =
      tokenOverride ?? (await Notifications.getExpoPushTokenAsync({ projectId })).data ?? null;
    if (!pushToken) {
      logger.warn('[sync] Expo push token unavailable', { source });
      return 'unsupported';
    }

    if (!forceRefresh && pushToken === this.lastRegisteredPushToken) {
      logger.debug('[sync] Push token unchanged; skipping server registration', { source });
      return 'granted';
    }

    try {
      await registerPushTokenApi(this.credentials, pushToken);
      this.lastRegisteredPushToken = pushToken;
      saveRegisteredPushToken(pushToken);
      logger.info('[sync] Push token registered successfully', { source });
      return 'granted';
    } catch (error) {
      logger.debug('[sync] Failed to register push token', {
        source,
        error: safeStringify(error),
      });
      throw error;
    }
  };

  private handlePushTokenRotation = async (pushToken: string) => {
    if (!pushToken || !this.credentials) {
      return;
    }

    logger.info('[sync] Push token rotated; refreshing server registration');
    try {
      await this.registerPushToken({
        requestPermission: false,
        forceRefresh: true,
        source: 'rotation',
        tokenOverride: pushToken,
      });
    } catch (error) {
      logger.debug('[sync] Failed to refresh rotated push token', {
        error: safeStringify(error),
      });
    }
  };

  async enableBackgroundReconnectNotifications(): Promise<PushRegistrationResult> {
    return this.registerPushToken({
      requestPermission: true,
      forceRefresh: true,
      source: 'settings',
    });
  }

  private maybePromptForBackgroundReconnect = async (shouldPrompt: boolean): Promise<void> => {
    if (
      !shouldPrompt ||
      Platform.OS === 'web' ||
      this.backgroundReconnectPromptInFlight ||
      storage.getState().localSettings.backgroundReconnectPromptHandled
    ) {
      return;
    }

    const permissions = await Notifications.getPermissionsAsync();
    if (permissions.status === 'granted' || this.appState !== 'active') {
      return;
    }

    this.backgroundReconnectPromptInFlight = true;
    try {
      const { Modal } = require('@/modal') as typeof import('@/modal');
      const { t } = require('@/text') as typeof import('@/text');

      if (permissions.canAskAgain === false) {
        const openSettings = await Modal.confirm(
          t('backgroundReconnect.blockedTitle'),
          t('backgroundReconnect.blockedMessage'),
          {
            cancelText: t('common.cancel'),
            confirmText: t('agentInput.speechInput.permissionOpenSettings'),
          }
        );

        storage.getState().applyLocalSettings({ backgroundReconnectPromptHandled: true });
        if (openSettings) {
          await Linking.openSettings();
        }
        return;
      }

      const shouldEnable = await Modal.confirm(
        t('backgroundReconnect.promptTitle'),
        t('backgroundReconnect.promptMessage'),
        {
          cancelText: t('common.cancel'),
          confirmText: t('common.continue'),
        }
      );

      storage.getState().applyLocalSettings({ backgroundReconnectPromptHandled: true });
      if (!shouldEnable) {
        return;
      }

      const result = await this.enableBackgroundReconnectNotifications();
      if (result === 'settings-required') {
        const openSettings = await Modal.confirm(
          t('backgroundReconnect.blockedTitle'),
          t('backgroundReconnect.blockedMessage'),
          {
            cancelText: t('common.cancel'),
            confirmText: t('agentInput.speechInput.permissionOpenSettings'),
          }
        );
        if (openSettings) {
          await Linking.openSettings();
        }
      }
    } catch (error) {
      logger.debug('[sync] Failed to show background reconnect prompt', {
        error: safeStringify(error),
      });
    } finally {
      this.backgroundReconnectPromptInFlight = false;
    }
  };

  /**
   * RFC-010 §3.3: Returns { sessionId: lastSeq } for all sessions with known
   * watermarks. The server uses this on reconnection to replay missed messages.
   */
  private getActiveSessionLastSeqs = (): Record<string, number> => {
    const seqs: Record<string, number> = {};
    for (const [sessionId, seq] of this.sessionLastSeq) {
      if (seq > 0) seqs[sessionId] = seq;
    }
    return seqs;
  };

  /**
   * RFC-010 §3.3: Handle 'replay' events from server after reconnection.
   * Messages are in the same format as fetch-messages responses (encrypted).
   */
  private handleReplay = async (data: unknown) => {
    const sessionId = (data as Record<string, unknown>)?.sessionId as string | undefined;
    try {
      const { messages, hasMore } = data as {
        messages: ApiMessage[];
        hasMore: boolean;
      };
      if (!sessionId || !Array.isArray(messages) || messages.length === 0) return;

      const log = sessionLogger(logger, sessionId);
      const encryption = this.encryption.getSessionEncryption(sessionId);
      if (!encryption) {
        log.debug('[sync] replay: no encryption for session, deferring to fetchMessages');
        this.getMessagesSync(sessionId).invalidate();
        return;
      }

      const decryptedMessages = await encryption.decryptMessages(messages);
      const normalizedMessages: NormalizedMessage[] = [];
      const normalizedOriginalIndices: number[] = [];
      for (let i = 0; i < decryptedMessages.length; i++) {
        const decrypted = decryptedMessages[i];
        if (!decrypted) continue;
        const normalized = normalizeRawMessage(
          decrypted.id,
          decrypted.createdAt,
          decrypted.content
        );
        if (normalized) {
          if (!normalized.traceId && decrypted.traceId) normalized.traceId = decrypted.traceId;
          const msgSeq = messages[i]?.seq;
          if (msgSeq) normalized.seq = msgSeq;
          normalizedMessages.push(normalized);
          normalizedOriginalIndices.push(i);
        }
      }

      if (normalizedMessages.length > 0) {
        this.enqueueMessages(sessionId, normalizedMessages);

        let maxSeq = this.sessionLastSeq.get(sessionId) ?? 0;
        const cacheEntries = normalizedMessages.map((n, idx) => {
          const origIdx = normalizedOriginalIndices[idx];
          const seq = messages[origIdx]?.seq ?? 0;
          if (seq > maxSeq) maxSeq = seq;
          return {
            id: n.id,
            session_id: sessionId,
            seq,
            content: serializeCachedContent(decryptedMessages[origIdx]?.content),
            trace_id: n.traceId ?? decryptedMessages[origIdx]?.traceId ?? null,
            role: n.role ?? 'agent',
            created_at: n.createdAt ?? Date.now(),
            updated_at: Date.now(),
          };
        });
        messageDB
          .upsertMessagesAndSeq(sessionId, cacheEntries, maxSeq)
          .catch(e => log.debug('[sync] replay messageDB upsert failed', { error: String(e) }));

        this.setSessionLastSeq(sessionId, maxSeq);
      }

      // If server indicated more messages remain, fall back to paginated fetch
      if (hasMore) {
        this.getMessagesSync(sessionId).invalidate();
      }

      log.info('[sync] replay: processed missed messages', {
        count: normalizedMessages.length,
        hasMore,
      });
    } catch (e) {
      const errLog = sessionId ? sessionLogger(logger, sessionId) : logger;
      errLog.error('[sync] replay handler failed', toError(e));
    }
  };

  private subscribeToUpdates = () => {
    // Subscribe to message updates
    apiSocket.onMessage('update', this.handleUpdate.bind(this));
    apiSocket.onMessage('ephemeral', this.handleEphemeralUpdate.bind(this));
    // RFC-010 §3.3: Handle replayed messages after reconnection
    apiSocket.onMessage('replay', this.handleReplay);

    // RFC-010 §3.3: Provide lastSeqs to apiSocket for reconnection handshake
    apiSocket.setLastSeqsProvider(this.getActiveSessionLastSeqs);

    // Subscribe to connection state changes
    apiSocket.onReconnected(() => {
      logger.debug('🔌 Socket reconnected');
      apiSocket.refreshReconnectAuth();
      this.sessionsSync.invalidate();
      this.machinesSync.invalidate();
      logger.debug('🔌 Socket reconnected: Invalidating artifacts sync');
      this.artifactsSync.invalidate();
      this.friendsSync.invalidate();
      this.friendRequestsSync.invalidate();
      this.feedSync.invalidate();
      for (const [sessionId] of this.sessionLastSeq) {
        gitStatusSync.invalidate(sessionId);
      }
      for (const sync of this.sendSync.values()) {
        sync.invalidate();
      }
    });
  };

  /** Serialized entry point — ensures updates are processed in arrival order. */
  private handleUpdate = (update: unknown) => {
    this._updateQueue = this._updateQueue
      .then(() => this._handleUpdateImpl(update))
      .catch(e => logger.error('handleUpdate failed', toError(e)));
  };

  private _handleUpdateImpl = async (update: unknown) => {
    // RFC §9.1 Step 8: extract _trace from incoming server update before Zod strips it
    const rawWireTrace =
      update && typeof update === 'object' ? (update as Record<string, unknown>)._trace : undefined;
    let traceCtx: TraceContext | undefined;
    if (rawWireTrace && typeof (rawWireTrace as any).tid === 'string') {
      const wt = rawWireTrace as WireTrace;
      traceCtx = continueTrace({ traceId: wt.tid, sessionId: wt.ses, machineId: wt.mid });
      // RFC §7.1: keep session trace fresh so subsequent RPC calls carry the correct trace
      if (wt.ses)
        setSessionTrace(wt.ses, {
          tid: traceCtx.traceId,
          ses: traceCtx.sessionId,
          mid: traceCtx.machineId,
        });
    }
    const log = traceCtx ? logger.withContext(traceCtx) : logger;

    const validatedUpdate = ApiUpdateContainerSchema.safeParse(update);
    if (!validatedUpdate.success) {
      log.warn('Invalid update received from server');
      return;
    }
    const updateData = validatedUpdate.data;
    log.debug('Update received', { type: updateData.body.t });

    if (updateData.body.t === 'new-message') {
      const sessionId = updateData.body.sid;

      /**
       * Session keys come from `fetchSessions` → `initializeSessions`. A `new-message` push can
       * be processed before that finishes (e.g. `new-session` only called `invalidate()` without
       * awaiting, or message ordering). Wait for session sync once, then fall back to message refetch.
       */
      let encryption = this.encryption.getSessionEncryption(sessionId);
      if (!encryption) {
        log.warn('Session encryption not ready for new-message, awaiting session sync', {
          sessionId,
        });
        await this.sessionsSync.invalidateAndAwait();
        encryption = this.encryption.getSessionEncryption(sessionId);
      }
      if (!encryption) {
        this.logEncryptionGapDiagnostics(log, sessionId, 'after_list_sync');
        await this.hydrateSessionFromServerById(sessionId);
        encryption = this.encryption.getSessionEncryption(sessionId);
      }
      if (!encryption) {
        this.logEncryptionGapDiagnostics(log, sessionId, 'final_failure');
        this.getMessagesSync(sessionId).invalidate();
        return;
      }

      // Decrypt message
      let lastMessage: NormalizedMessage | null = null;
      if (updateData.body.message) {
        const decrypted = await encryption.decryptMessage(updateData.body.message);
        if (decrypted) {
          lastMessage = normalizeRawMessage(decrypted.id, decrypted.createdAt, decrypted.content);
          // Propagate traceId from server DB only when the normalized message
          // doesn't already carry an embedded per-turn traceId. The embedded
          // traceId is stable within a turn, while the DB traceId can change
          // due to setCurrentTurnTrace races when new user messages arrive.
          if (lastMessage && !lastMessage.traceId && decrypted.traceId) {
            lastMessage.traceId = decrypted.traceId;
          }
          if (lastMessage && updateData.body.message.seq) {
            lastMessage.seq = updateData.body.message.seq;
          }

          // Check for task lifecycle events to update thinking state
          // This ensures UI updates even if volatile activity updates are lost
          const rawContent = decrypted.content as {
            role?: string;
            content?: {
              type?: string;
              state?: string;
              data?: {
                type?: string;
                ev?: { t?: string };
              };
            };
          } | null;
          const role = rawContent?.role;
          const contentType = rawContent?.content?.type;
          const dataType = rawContent?.content?.data?.type;
          const sessionEventType = rawContent?.content?.data?.ev?.t;

          // Debug logging to trace lifecycle events
          if (
            dataType === 'task_complete' ||
            dataType === 'turn_aborted' ||
            dataType === 'task_started' ||
            sessionEventType === 'turn-start' ||
            sessionEventType === 'turn-end' ||
            (role === 'event' && contentType === 'status')
          ) {
            log.debug(
              `🔄 [Sync] Lifecycle event detected: role=${role}, contentType=${contentType}, dataType=${dataType}, sessionEventType=${sessionEventType}`
            );
          }

          // Agent event: { role: 'event', content: { type: 'status', state: 'idle' } }
          //
          // IMPORTANT: ACP emits idle after a short inactivity window (500ms by default),
          // not necessarily when the full turn has authoritatively ended. Treating that
          // transient idle as task completion causes the app to flash "idle" during long
          // turns that pause briefly between chunks/tool activity.
          const isAgentEventWorking =
            role === 'event' &&
            contentType === 'status' &&
            rawContent?.content?.state === 'working';

          const isTaskComplete =
            (contentType === 'acp' &&
              (dataType === 'task_complete' || dataType === 'turn_aborted')) ||
            (contentType === 'session' && sessionEventType === 'turn-end');

          const isTaskStarted =
            (contentType === 'acp' && dataType === 'task_started') ||
            (contentType === 'session' && sessionEventType === 'turn-start') ||
            isAgentEventWorking;

          if (isTaskComplete || isTaskStarted) {
            log.debug(
              `🔄 [Sync] Updating thinking state: isTaskComplete=${isTaskComplete}, isTaskStarted=${isTaskStarted}`
            );
          }

          // Update session
          const session = storage.getState().sessions[sessionId];
          if (session) {
            this.applySessions([
              {
                ...session,
                updatedAt: updateData.createdAt,
                seq: updateData.seq,
                // Update thinking state based on task lifecycle events.
                // Also record thinkingAt so flushActivityUpdates can detect
                // stale keepAlive(thinking:true) updates that arrive after
                // task_complete has already cleared thinking.
                ...(isTaskComplete ? { thinking: false, thinkingAt: updateData.createdAt } : {}),
                ...(isTaskStarted ? { thinking: true, thinkingAt: updateData.createdAt } : {}),
              },
            ]);
            if (isTaskComplete) {
              this.getSendSync(sessionId).invalidate();
            }
          } else {
            // Local session list missing this id; wait for list + keys before continuing.
            await this.sessionsSync.invalidateAndAwait();
          }

          // Fast-path only on consecutive seq values, otherwise fetch from server.
          const currentLastSeq = this.sessionLastSeq.get(sessionId);
          const incomingSeq = updateData.body.message.seq;
          if (lastMessage && currentLastSeq !== undefined && incomingSeq === currentLastSeq + 1) {
            log.debug('🔄 Sync: Applying message (fast path)', {
              messageId: lastMessage.id,
              role: lastMessage.role,
              contentType:
                lastMessage.role === 'agent'
                  ? lastMessage.content[0]?.type
                  : lastMessage.content.type,
            });
            this.enqueueMessages(sessionId, [lastMessage]);
            this.setSessionLastSeq(sessionId, incomingSeq);

            // Cache fast-path message to SQLite so restarts don't create gaps.
            // Gaps cause toolCallSeenSinceLastText state loss → thinking blocks
            // fail to merge on reload.
            messageDB
              .upsertMessagesAndSeq(
                sessionId,
                [
                  {
                    id: lastMessage.id,
                    session_id: sessionId,
                    seq: incomingSeq,
                    content: serializeCachedContent(decrypted.content),
                    trace_id: lastMessage.traceId ?? decrypted.traceId ?? null,
                    role: lastMessage.role ?? 'agent',
                    created_at: lastMessage.createdAt ?? Date.now(),
                    updated_at: Date.now(),
                  },
                ],
                incomingSeq
              )
              .catch(e =>
                log.debug('[sync] fast-path cache failed', {
                  error: String(e),
                })
              );

            let hasMutableTool = false;
            if (
              lastMessage.role === 'agent' &&
              lastMessage.content[0] &&
              lastMessage.content[0].type === 'tool-result'
            ) {
              hasMutableTool = storage
                .getState()
                .isMutableToolCall(sessionId, lastMessage.content[0].tool_use_id);
            }
            if (hasMutableTool) {
              gitStatusSync.invalidate(sessionId);
            }
          } else {
            this.getMessagesSync(sessionId).invalidate();
          }
        }
      }
    } else if (updateData.body.t === 'new-session') {
      log.debug('New session update received');
      /** Must await so a following `new-message` in the queue sees initialized session encryption. */
      await this.sessionsSync.invalidateAndAwait();
    } else if (updateData.body.t === 'delete-session') {
      log.debug('Delete session update received');
      const sessionId = updateData.body.sid;
      this.purgeSession(sessionId);
      log.debug('Session deleted from local storage');
    } else if (updateData.body.t === 'update-session') {
      let session = storage.getState().sessions[updateData.body.id];
      if (session) {
        let sessionEncryption = this.encryption.getSessionEncryption(updateData.body.id);
        if (!sessionEncryption) {
          log.warn('Session encryption not ready for update-session, awaiting session sync', {
            sessionId: updateData.body.id,
          });
          await this.sessionsSync.invalidateAndAwait();
          sessionEncryption = this.encryption.getSessionEncryption(updateData.body.id);
          session = storage.getState().sessions[updateData.body.id] ?? session;
        }
        if (!sessionEncryption) {
          this.logEncryptionGapDiagnostics(log, updateData.body.id, 'after_list_sync');
          await this.hydrateSessionFromServerById(updateData.body.id);
          sessionEncryption = this.encryption.getSessionEncryption(updateData.body.id);
          session = storage.getState().sessions[updateData.body.id] ?? session;
        }
        if (!sessionEncryption) {
          this.logEncryptionGapDiagnostics(log, updateData.body.id, 'final_failure');
          log.error('Session encryption not found for update-session after refresh and hydrate');
          return;
        }

        const agentState =
          updateData.body.agentState && sessionEncryption
            ? await sessionEncryption.decryptAgentState(
                updateData.body.agentState.version,
                updateData.body.agentState.value
              )
            : session.agentState;
        const metadata =
          updateData.body.metadata && sessionEncryption
            ? await sessionEncryption.decryptMetadata(
                updateData.body.metadata.version,
                updateData.body.metadata.value
              )
            : session.metadata;
        const capabilities =
          updateData.body.capabilities && sessionEncryption
            ? await sessionEncryption.decryptCapabilities(
                updateData.body.capabilities.version,
                updateData.body.capabilities.value
              )
            : session.capabilities;

        this.applySessions([
          {
            ...session,
            status: updateData.body.status ?? session.status,
            activeAt: updateData.body.activeAt ?? session.activeAt,
            agentState,
            agentStateVersion: updateData.body.agentState
              ? updateData.body.agentState.version
              : session.agentStateVersion,
            metadata,
            metadataVersion: updateData.body.metadata
              ? updateData.body.metadata.version
              : session.metadataVersion,
            capabilities,
            capabilitiesVersion: updateData.body.capabilities
              ? updateData.body.capabilities.version
              : session.capabilitiesVersion,
            updatedAt: updateData.createdAt,
            seq: updateData.seq,
          },
        ]);
        // Only persist capabilities when the server sent a newer capabilities version.
        // Some update-session events include capabilities unchanged alongside message/activity
        // updates; writing those through to KV on every event creates redundant traffic.
        if (
          updateData.body.capabilities &&
          updateData.body.capabilities.version !== session.capabilitiesVersion
        ) {
          log.debug('update-session capabilities changed, persisting cache', {
            sessionId: updateData.body.id,
            machineId: metadata?.machineId,
            agentType: metadata?.flavor,
            previousVersion: session.capabilitiesVersion,
            nextVersion: updateData.body.capabilities.version,
          });
          void persistCachedCapabilities({
            machineId: metadata?.machineId,
            agentType:
              metadata?.flavor === 'claude' ||
              metadata?.flavor === 'codex' ||
              metadata?.flavor === 'gemini' ||
              metadata?.flavor === 'opencode'
                ? metadata.flavor
                : null,
            capabilities,
            credentials: this.credentials,
            updatedAt: updateData.createdAt,
          });
        } else if (updateData.body.capabilities) {
          log.debug('update-session capabilities unchanged, skipping cache persist', {
            sessionId: updateData.body.id,
            machineId: metadata?.machineId,
            agentType: metadata?.flavor,
            version: updateData.body.capabilities.version,
          });
        }

        // Invalidate git status when agent state changes (files may have been modified)
        if (updateData.body.agentState) {
          gitStatusSync.invalidate(updateData.body.id);

          // Re-fetch messages when control returns to mobile (local -> remote mode switch)
          // This catches up on any messages that were exchanged while desktop had control
          const wasControlledByUser = session.agentState?.controlledByUser;
          const isNowControlledByUser = agentState?.controlledByUser;
          if (!wasControlledByUser && isNowControlledByUser) {
            log.debug(
              `🔄 Control returned to mobile for session ${updateData.body.id}, re-fetching messages`
            );
            this.onSessionVisible(updateData.body.id);
          }
        }
      }
    } else if (updateData.body.t === 'update-account') {
      const accountUpdate = updateData.body;
      const currentProfile = storage.getState().profile;

      // Build updated profile with new data
      const updatedProfile: Profile = {
        ...currentProfile,
        firstName:
          accountUpdate.firstName !== undefined
            ? accountUpdate.firstName
            : currentProfile.firstName,
        lastName:
          accountUpdate.lastName !== undefined ? accountUpdate.lastName : currentProfile.lastName,
        avatar: accountUpdate.avatar !== undefined ? accountUpdate.avatar : currentProfile.avatar,
        github: accountUpdate.github !== undefined ? accountUpdate.github : currentProfile.github,
        timestamp: updateData.createdAt, // Update timestamp to latest
      };

      // Apply the updated profile to storage
      storage.getState().applyProfile(updatedProfile);

      // Handle settings updates (new for profile sync)
      if (accountUpdate.settings?.value) {
        try {
          const decryptedSettings = await this.encryption.decryptRaw(accountUpdate.settings.value);
          const parsedSettings = settingsParse(decryptedSettings);

          // Version compatibility check
          const settingsSchemaVersion = parsedSettings.schemaVersion ?? 1;
          if (settingsSchemaVersion > SUPPORTED_SCHEMA_VERSION) {
            logger.warn(
              `Received settings schema v${settingsSchemaVersion}, ` +
                `we support v${SUPPORTED_SCHEMA_VERSION}. Update app for full functionality.`
            );
          }

          storage.getState().applySettings(parsedSettings, accountUpdate.settings.version);
          logger.debug(
            `Settings synced from server (schema v${settingsSchemaVersion}, version ${accountUpdate.settings.version})`
          );
        } catch (error) {
          logger.error('Failed to process settings update:', toError(error));
          // Don't crash on settings sync errors, just log
        }
      }
    } else if (updateData.body.t === 'update-machine') {
      const machineUpdate = updateData.body;
      const machineId = machineUpdate.machineId; // Changed from .id to .machineId
      const machine = storage.getState().machines[machineId];

      // Create or update machine with all required fields
      const updatedMachine: Machine = {
        id: machineId,
        seq: updateData.seq,
        createdAt: machine?.createdAt ?? updateData.createdAt,
        updatedAt: updateData.createdAt,
        active: machineUpdate.active ?? true,
        activeAt: machineUpdate.activeAt ?? updateData.createdAt,
        metadata: machine?.metadata ?? null,
        metadataVersion: machine?.metadataVersion ?? 0,
        daemonState: machine?.daemonState ?? null,
        daemonStateVersion: machine?.daemonStateVersion ?? 0,
      };

      // Get machine-specific encryption (might not exist if machine wasn't initialized)
      const machineEncryption = this.encryption.getMachineEncryption(machineId);
      if (!machineEncryption) {
        logger.error(`Machine encryption not found for ${machineId} - cannot decrypt updates`);
        return;
      }

      // If metadata is provided, decrypt and update it
      const metadataUpdate = machineUpdate.metadata;
      if (metadataUpdate) {
        try {
          const metadata = await machineEncryption.decryptMetadata(
            metadataUpdate.version,
            metadataUpdate.value
          );
          updatedMachine.metadata = metadata;
          updatedMachine.metadataVersion = metadataUpdate.version;
        } catch (error) {
          logger.error(`Failed to decrypt machine metadata for ${machineId}:`, toError(error));
        }
      }

      // If daemonState is provided, decrypt and update it
      const daemonStateUpdate = machineUpdate.daemonState;
      if (daemonStateUpdate) {
        try {
          const daemonState = await machineEncryption.decryptDaemonState(
            daemonStateUpdate.version,
            daemonStateUpdate.value
          );
          updatedMachine.daemonState = daemonState;
          updatedMachine.daemonStateVersion = daemonStateUpdate.version;
        } catch (error) {
          logger.error(`Failed to decrypt machine daemonState for ${machineId}:`, toError(error));
        }
      }

      // Update storage using applyMachines which rebuilds sessionListViewData
      storage.getState().applyMachines([updatedMachine]);
    } else if (updateData.body.t === 'relationship-updated') {
      logger.debug('Received relationship-updated update');
      const relationshipUpdate = updateData.body;

      // Apply the relationship update to storage
      storage.getState().applyRelationshipUpdate({
        fromUserId: relationshipUpdate.fromUserId,
        toUserId: relationshipUpdate.toUserId,
        status: relationshipUpdate.status,
        action: relationshipUpdate.action,
        fromUser: relationshipUpdate.fromUser,
        toUser: relationshipUpdate.toUser,
        timestamp: relationshipUpdate.timestamp,
      });

      // Invalidate friends data to refresh with latest changes
      this.friendsSync.invalidate();
      this.friendRequestsSync.invalidate();
      this.feedSync.invalidate();
    } else if (updateData.body.t === 'new-artifact') {
      logger.debug('Received new-artifact update');
      const artifactUpdate = updateData.body;
      const artifactId = artifactUpdate.artifactId;

      try {
        const decryptedKey = await this.encryption.decryptEncryptionKey(
          artifactUpdate.dataEncryptionKey
        );
        if (!decryptedKey) {
          logger.error(`Failed to decrypt key for new artifact ${artifactId}`);
          return;
        }

        // Store the decrypted key in memory
        this.artifactDataKeys.set(artifactId, decryptedKey);

        // Create artifact encryption instance
        const artifactEncryption = new ArtifactEncryption(decryptedKey);

        // Decrypt header
        const header = await artifactEncryption.decryptHeader(artifactUpdate.header);

        // Decrypt body if provided
        let decryptedBody: string | null | undefined = undefined;
        if (artifactUpdate.body && artifactUpdate.bodyVersion !== undefined) {
          const body = await artifactEncryption.decryptBody(artifactUpdate.body);
          decryptedBody = body?.body || null;
        }

        // Add to storage
        const decryptedArtifact: DecryptedArtifact = {
          id: artifactId,
          title: header?.title || null,
          body: decryptedBody,
          headerVersion: artifactUpdate.headerVersion,
          bodyVersion: artifactUpdate.bodyVersion,
          seq: artifactUpdate.seq,
          createdAt: artifactUpdate.createdAt,
          updatedAt: artifactUpdate.updatedAt,
          isDecrypted: !!header,
        };

        storage.getState().addArtifact(decryptedArtifact);
        logger.debug(`Added new artifact ${artifactId} to storage`);
      } catch (error) {
        logger.error(`Failed to process new artifact ${artifactId}:`, toError(error));
      }
    } else if (updateData.body.t === 'update-artifact') {
      logger.debug('Received update-artifact update');
      const artifactUpdate = updateData.body;
      const artifactId = artifactUpdate.artifactId;

      const existingArtifact = storage.getState().artifacts[artifactId];
      if (!existingArtifact) {
        logger.error(`Artifact ${artifactId} not found in storage`);
        // Fetch all artifacts to sync
        this.artifactsSync.invalidate();
        return;
      }

      try {
        // Get the data encryption key from memory
        const dataEncryptionKey = this.artifactDataKeys.get(artifactId);
        if (!dataEncryptionKey) {
          logger.error(`Encryption key not found for artifact ${artifactId}, fetching artifacts`);
          this.artifactsSync.invalidate();
          return;
        }

        // Create artifact encryption instance
        const artifactEncryption = new ArtifactEncryption(dataEncryptionKey);

        // Update artifact with new data
        const updatedArtifact: DecryptedArtifact = {
          ...existingArtifact,
          seq: updateData.seq,
          updatedAt: updateData.createdAt,
        };

        // Decrypt and update header if provided
        if (artifactUpdate.header) {
          const header = await artifactEncryption.decryptHeader(artifactUpdate.header.value);
          updatedArtifact.title = header?.title || null;
          updatedArtifact.sessions = header?.sessions;
          updatedArtifact.draft = header?.draft;
          updatedArtifact.headerVersion = artifactUpdate.header.version;
        }

        // Decrypt and update body if provided
        if (artifactUpdate.body) {
          const body = await artifactEncryption.decryptBody(artifactUpdate.body.value);
          updatedArtifact.body = body?.body || null;
          updatedArtifact.bodyVersion = artifactUpdate.body.version;
        }

        storage.getState().updateArtifact(updatedArtifact);
        logger.debug(`Updated artifact ${artifactId} in storage`);
      } catch (error) {
        logger.error(`Failed to process artifact update ${artifactId}:`, toError(error));
      }
    } else if (updateData.body.t === 'delete-artifact') {
      logger.debug('Received delete-artifact update');
      const artifactUpdate = updateData.body;
      const artifactId = artifactUpdate.artifactId;

      // Remove from storage
      storage.getState().deleteArtifact(artifactId);

      // Remove encryption key from memory
      this.artifactDataKeys.delete(artifactId);
    } else if (updateData.body.t === 'new-feed-post') {
      logger.debug('Received new-feed-post update');
      const feedUpdate = updateData.body;

      // Convert to FeedItem with counter from cursor
      const feedItem: FeedItem = {
        id: feedUpdate.id,
        body: feedUpdate.body,
        cursor: feedUpdate.cursor,
        createdAt: feedUpdate.createdAt,
        repeatKey: feedUpdate.repeatKey,
        counter: parseInt(feedUpdate.cursor.substring(2), 10),
      };

      // Check if we need to fetch user for friend-related items
      if (
        feedItem.body &&
        (feedItem.body.kind === 'friend_request' || feedItem.body.kind === 'friend_accepted')
      ) {
        await this.assumeUsers([feedItem.body.uid]);

        // Check if user fetch failed (404) - don't store item if user not found
        const users = storage.getState().users;
        const userProfile = users[feedItem.body.uid];
        if (userProfile === null || userProfile === undefined) {
          // User was not found or 404, don't store this item
          logger.debug(`Skipping feed item ${feedItem.id} - user ${feedItem.body.uid} not found`);
          return;
        }
      }

      // Apply to storage (will handle repeatKey replacement)
      storage.getState().applyFeedItems([feedItem]);
    }
  };

  private flushActivityUpdates = (updates: Map<string, ApiEphemeralActivityUpdate>) => {
    // logger.debug(`🔄 Flushing activity updates for ${updates.size} sessions - acquiring lock`);

    const sessions: Session[] = [];

    for (const [sessionId, update] of updates) {
      const session = storage.getState().sessions[sessionId];
      if (session) {
        // Guard against stale keepAlive(thinking:true) updates.
        //
        // When task_started / task_complete fire in handleSessionUpdate they record
        // thinkingAt = updateData.createdAt (server timestamp). Any keepAlive whose
        // activeAt (CLI timestamp) is OLDER than that transition timestamp is stale
        // and must not overwrite the authoritative thinking state set by the queue.
        //
        // This allows keepAlive to provide the fast "thinking started" signal on new
        // turns (fresh activeAt > previous thinkingAt) while blocking the race-condition
        // where a keepAlive(true) sent just before task_complete arrives late and resets
        // thinking back to true (Bug 3). keepAlive interval is 2 s; NTP skew between
        // CLI and server is typically < 100 ms, so the comparison is safe in practice.
        const shouldUpdateThinking = update.activeAt > (session.thinkingAt ?? 0);
        sessions.push({
          ...session,
          // Translate ephemeral boolean into status; never downgrade archived/deleted from keepAlive
          status:
            session.status === 'archived' || session.status === 'deleted'
              ? session.status
              : update.active
                ? 'active'
                : 'offline',
          activeAt: update.activeAt,
          ...(shouldUpdateThinking
            ? { thinking: update.thinking, thinkingAt: update.activeAt }
            : {}),
        });
      }
    }

    if (sessions.length > 0) {
      // logger.debug('flushing activity updates ' + sessions.length);
      this.applySessionEphemeralUpdates(
        sessions.map(session => ({
          id: session.id,
          status: session.status,
          activeAt: session.activeAt,
          thinking: session.thinking,
          thinkingAt: session.thinkingAt,
        }))
      );
      // logger.debug(`🔄 Activity updates flushed - updated ${sessions.length} sessions`);
    }
  };

  private handleEphemeralUpdate = (update: unknown) => {
    const validatedUpdate = ApiEphemeralUpdateSchema.safeParse(update);
    if (!validatedUpdate.success) {
      logger.debug('Invalid ephemeral update received:', validatedUpdate.error);
      logger.error('Invalid ephemeral update received:', undefined, { update });
      return;
    } else {
      // logger.debug('Ephemeral update received:', update);
    }
    const updateData = validatedUpdate.data;

    // Process activity updates through smart debounce accumulator
    if (updateData.type === 'activity') {
      // logger.debug('adding activity update ' + updateData.id);
      this.activityAccumulator.addUpdate(updateData);
    }

    // Handle batched activity updates (server aggregates multiple session heartbeats into one)
    if (updateData.type === 'batch-activity') {
      this.activityAccumulator.addUpdates(
        updateData.activities.map(activity => ({
          type: 'activity',
          ...activity,
        }))
      );
      return;
    }

    // Handle machine activity updates
    if (updateData.type === 'machine-activity') {
      // Update machine's active status and lastActiveAt
      const machine = storage.getState().machines[updateData.id];
      if (machine) {
        const updatedMachine: Machine = {
          ...machine,
          active: updateData.active,
          activeAt: updateData.activeAt,
        };
        storage.getState().applyMachines([updatedMachine]);
      }
    }

    if (updateData.type === 'usage') {
      const session = storage.getState().sessions[updateData.id];
      if (session) {
        const latestUsage = {
          inputTokens: updateData.tokens.input,
          outputTokens: updateData.tokens.output,
          cacheCreation: updateData.tokens.cache_creation,
          cacheRead: updateData.tokens.cache_read,
          contextSize:
            updateData.tokens.context_used ??
            updateData.tokens.input +
              updateData.tokens.cache_creation +
              updateData.tokens.cache_read,
          contextWindowSize: updateData.tokens.context_window,
          timestamp: updateData.timestamp,
        };

        this.applySessionEphemeralUpdates([{ id: session.id, latestUsage }]);
      }
    }

    // daemon-status ephemeral updates are deprecated, machine status is handled via machine-activity

    // Notify only matching subscribers (for streaming text, etc.) instead of broadcasting to every message.
    this.notifyEphemeralSubscribers(updateData);
  };

  private notifyEphemeralSubscribers(updateData: unknown) {
    const callbacks = new Set<(update: unknown) => void>();
    this.ephemeralGlobalCallbacks.forEach(callback => callbacks.add(callback));

    if (updateData && typeof updateData === 'object') {
      const updateSessionId =
        'sessionId' in updateData && typeof updateData.sessionId === 'string'
          ? updateData.sessionId
          : null;
      const updateMessageId =
        'messageId' in updateData && typeof updateData.messageId === 'string'
          ? updateData.messageId
          : null;

      if (updateSessionId) {
        this.ephemeralSessionCallbacks.get(updateSessionId)?.forEach(callback => callbacks.add(callback));
        if (updateMessageId) {
          this.ephemeralSessionMessageCallbacks
            .get(updateSessionId)
            ?.get(updateMessageId)
            ?.forEach(callback => callbacks.add(callback));
        }
      }

      if (updateMessageId) {
        this.ephemeralMessageCallbacks.get(updateMessageId)?.forEach(callback => callbacks.add(callback));
      }
    }

    callbacks.forEach(callback => {
      try {
        callback(updateData);
      } catch (error) {
        logger.error('Error in ephemeral update callback:', toError(error));
      }
    });
  }

  //
  // Apply store
  //

  private applyMessages = (sessionId: string, messages: NormalizedMessage[]) => {
    const result = storage.getState().applyMessages(sessionId, messages);
    if (result.latestStatus) {
      const session = storage.getState().sessions[sessionId];
      if (session) {
        // Keep "working" as a fast-path signal, but do not clear thinking on "idle":
        // ACP idle is inactivity-based and can briefly fire before the authoritative
        // turn-end/task_complete lifecycle event arrives.
        if (result.latestStatus === 'working') {
          this.applySessionEphemeralUpdates([
            {
              id: session.id,
              thinking: true,
              thinkingAt: Date.now(),
            },
          ]);
        }
      }
    }
    const m: Message[] = [];
    for (const messageId of result.changed) {
      const message = storage.getState().sessionMessages[sessionId].messagesMap[messageId];
      if (message) {
        m.push(message);
      }
    }
    if (m.length > 0) {
      getVoiceHooks().onMessages(sessionId, m);
    }
    if (result.hasReadyEvent) {
      getVoiceHooks().onReady(sessionId);
      this.getSendSync(sessionId).invalidate();
    }
  };

  /**
   * Purge a session from all local state: storage, encryption, sync maps, caches.
   * Mirrors the delete-session WS handler — call this whenever a session must be
   * removed regardless of whether a WS event was received.
   */
  private purgeSession(sessionId: string): void {
    const log = sessionLogger(logger, sessionId);
    storage.getState().deleteSession(sessionId);
    this.encryption.removeSessionEncryption(sessionId);
    this.sessionDataKeys.delete(sessionId);
    projectManager.removeSession(sessionId);
    gitStatusSync.clearForSession(sessionId);
    this.messagesSync.get(sessionId)?.stop();
    this.messagesSync.delete(sessionId);
    this.sendSync.get(sessionId)?.stop();
    this.sendSync.delete(sessionId);
    this.pendingOutbox.delete(sessionId);
    this.persistOutbox();
    this.deleteSessionLastSeq(sessionId);
    this.sessionOldestSeq.delete(sessionId);
    this.sessionMessageQueue.delete(sessionId);
    this.sessionQueueProcessing.delete(sessionId);
    const batchTimer = this.sessionBatchTimers.get(sessionId);
    if (batchTimer) {
      clearTimeout(batchTimer);
      this.sessionBatchTimers.delete(sessionId);
    }
    clearSessionTrace(sessionId);
    messageDB
      .deleteSession(sessionId)
      .catch(e => log.debug('[sync] messageDB deleteSession failed', { error: String(e) }));
  }

  private applySessions = (
    sessions: (Omit<Session, 'presence'> & {
      presence?: 'online' | number;
    })[]
  ) => {
    const active = storage.getState().getActiveSessions();
    storage.getState().applySessions(sessions);
    scheduleSaveCachedSessions(
      Object.values(storage.getState().sessions).filter(session => session.status !== 'deleted')
    );
    const newActive = storage.getState().getActiveSessions();
    this.applySessionDiff(active, newActive);
    for (const session of sessions) {
      const queued = storage.getState().sessions[session.id]?.queuedMessages ?? [];
      if (queued.length > 0) {
        this.getSendSync(session.id).invalidate();
      }
    }
  };

  private applySessionEphemeralUpdates = (
    updates: Array<{
      id: string;
      status?: Session['status'];
      activeAt?: number;
      thinking?: boolean;
      thinkingAt?: number;
      latestUsage?: Session['latestUsage'];
    }>
  ) => {
    if (updates.length === 0) {
      return;
    }

    const active = storage.getState().getActiveSessions();
    const activeMembershipChanged = storage.getState().applySessionEphemeralUpdates(updates);
    if (activeMembershipChanged) {
      const newActive = storage.getState().getActiveSessions();
      this.applySessionDiff(active, newActive);
    }
  };

  private applySessionDiff = (active: Session[], newActive: Session[]) => {
    const wasActive = new Set(active.map(s => s.id));
    const isActive = new Set(newActive.map(s => s.id));
    for (const s of active) {
      if (!isActive.has(s.id)) {
        sessionLogger(logger, s.id).info('session offline');
        getVoiceHooks().onSessionOffline(s.id, s.metadata ?? undefined);
      }
    }
    for (const s of newActive) {
      if (!wasActive.has(s.id)) {
        sessionLogger(logger, s.id).info('session online');
        getVoiceHooks().onSessionOnline(s.id, s.metadata ?? undefined);
      }
    }
  };
}

// Global singleton instance
export const sync = new Sync();

// Register callbacks to break circular dependencies
registerApplySettingsCallback(delta => sync.applySettings(delta));
registerAssumeUsersCallback(userIds => sync.assumeUsers(userIds));
registerGetMachineEncryption(machineId => sync.encryption.getMachineEncryption(machineId));

//
// Init sequence
//

let isInitialized = false;
export async function syncCreate(credentials: AuthCredentials) {
  if (isInitialized) {
    logger.warn('Sync already initialized: ignoring');
    return;
  }
  isInitialized = true;
  await syncInit(credentials, false);
}

export async function syncRestore(credentials: AuthCredentials) {
  if (isInitialized) {
    logger.warn('Sync already initialized: ignoring');
    return;
  }
  isInitialized = true;
  await syncInit(credentials, true);
}

async function syncInit(credentials: AuthCredentials, restore: boolean) {
  // Initialize sync engine
  const secretKey = decodeBase64(credentials.secret, 'base64url');
  if (secretKey.length !== 32) {
    throw new Error(`Invalid secret key length: ${secretKey.length}, expected 32`);
  }
  const encryption = await Encryption.create(secretKey);
  if (!encryption) {
    throw new Error('Failed to initialize encryption — invalid credentials');
  }

  // Initialize socket connection
  const API_ENDPOINT = getServerUrl();
  logger.debug('[sync] syncInit', { serverUrl: API_ENDPOINT });
  apiSocket.initialize({ endpoint: API_ENDPOINT, token: credentials.token }, encryption);

  // Wire socket status to storage
  apiSocket.onStatusChange(status => {
    storage.getState().setSocketStatus(status);
  });

  // Auth errors: stop retrying and notify UI so user can re-login
  apiSocket.onAuthError(message => {
    logger.error('[syncInit] Auth error from server, forcing re-login', { message });
    storage.getState().setAuthError(message);
    // Auto-logout after a short delay to let the UI show the error
    setTimeout(() => {
      const { getCurrentAuth } = require('@/auth/AuthContext');
      const auth = getCurrentAuth();
      if (auth) {
        auth.logout();
      }
    }, 3000);
  });

  // Initialize sessions engine
  if (restore) {
    await sync.restore(credentials, encryption);
  } else {
    await sync.create(credentials, encryption);
  }
}
