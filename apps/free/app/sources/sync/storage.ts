import React from 'react';
import { create } from 'zustand';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';
import { measurePerformance } from '@/dev/performanceMonitor';
import { sessionLogger } from './appTraceStore';
import { useShallow } from 'zustand/react/shallow';
import { DecryptedArtifact } from './artifactTypes';
import { FeedItem } from './feedTypes';
import { UserProfile, RelationshipUpdatedEvent } from './friendTypes';
import { LocalSettings, applyLocalSettings } from './localSettings';
import {
  loadSettings,
  loadLocalSettings,
  saveLocalSettings,
  saveSettings,
  loadPurchases,
  savePurchases,
  loadProfile,
  saveProfile,
  loadSessionDrafts,
  saveSessionDrafts,
  loadSessionPermissionModes,
  saveSessionPermissionModes,
  loadSessionDesiredAgentModes,
  saveSessionDesiredAgentModes,
  loadSessionDesiredConfigOptions,
  saveSessionDesiredConfigOptions,
  loadSessionModelModes,
  saveSessionModelModes,
  scheduleSaveCachedSessions,
} from './persistence';
import { Profile } from './profile';
import { projectManager } from './projectManager';
import { Purchases, customerInfoToPurchases } from './purchases';
import { createReducer, reducer, ReducerState } from './reducer/reducer';
import { compareCreatedDesc, compareUpdatedDesc } from './entitySort';
import { sortMessagesDesc } from './messageSort';
import { Session, Machine, GitStatus, QueuedMessage } from './storageTypes';
import { Message } from './typesMessage';
import { NormalizedMessage } from './typesRaw';
import { removePromotedQueuedMessages } from './syncQueue';
import { isMachineOnline } from '@/utils/machineUtils';
import { applySettings, Settings } from './settings';
import type { CustomerInfo } from './revenueCat/types';
import type { PermissionMode, SessionCapabilities } from './sessionCapabilities';

const logger = new Logger('app/sync/storage');

/**
 * Whether a tool name is treated as mutable for permission/session logic.
 * Lazy-loads the known-tools registry (see AGENTS.md: lazy require for cross-cutting UI).
 * Avoids a static storage → knownTools edge at module init, which can cause TDZ errors during startup.
 */
function resolveIsMutableTool(toolName: string): boolean {
  const { isMutableTool } = require('@/components/tools/knownTools') as typeof import('@/components/tools/knownTools');
  return isMutableTool(toolName);
}

// Callbacks registered by external modules to avoid circular dependencies
let _applySettingsCallback: ((delta: Partial<Settings>) => void) | null = null;
let _assumeUsersCallback: ((userIds: string[]) => Promise<void>) | null = null;
let _getRealtimeSessionInfo: (() => { sessionId: string | null; voiceSession: any }) | null = null;

export function registerApplySettingsCallback(cb: (delta: Partial<Settings>) => void) {
  _applySettingsCallback = cb;
}

export function registerAssumeUsersCallback(cb: (userIds: string[]) => Promise<void>) {
  _assumeUsersCallback = cb;
}

export function registerRealtimeSessionInfo(
  cb: () => { sessionId: string | null; voiceSession: any }
) {
  _getRealtimeSessionInfo = cb;
}

// Debounce timer for realtimeMode changes
let realtimeModeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
const REALTIME_MODE_DEBOUNCE_MS = 150;

/**
 * Centralized session online state resolver
 * Returns either "online" (string) or a timestamp (number) for last seen
 */
function resolveSessionOnlineState(session: {
  status: 'active' | 'offline' | 'archived' | 'deleted';
  activeAt: number;
}): 'online' | number {
  return session.status === 'active' ? 'online' : session.activeAt;
}

/**
 * Checks if a session should be shown in the active sessions group
 */
function isSessionActive(session: {
  status: 'active' | 'offline' | 'archived' | 'deleted';
}): boolean {
  return session.status === 'active';
}

function isSandboxEnabled(metadata: Session['metadata'] | null | undefined): boolean {
  const sandbox = metadata?.sandbox;
  return (
    !!sandbox && typeof sandbox === 'object' && (sandbox as { enabled?: unknown }).enabled === true
  );
}

// Known entitlement IDs
export type KnownEntitlements = 'pro';

interface SessionMessages {
  messages: Message[];
  messagesMap: Record<string, Message>;
  messageIndexMap: Record<string, number>;
  reducerState: ReducerState;
  isLoaded: boolean;
  lastLocalHydratedAt: number;
  hasOlderMessages: boolean;
  isLoadingOlder: boolean;
}

// Machine type is now imported from storageTypes - represents persisted machine data

// Unified list item type for SessionsList component
export type SessionListViewItem =
  | { type: 'header'; title: string }
  | { type: 'active-sessions'; sessions: Session[] }
  | { type: 'project-group'; displayPath: string; machine: Machine }
  | { type: 'session'; session: Session; variant?: 'default' | 'no-path' };

// Legacy type for backward compatibility - to be removed
export type SessionListItem = string | Session;

interface StorageState {
  settings: Settings;
  settingsVersion: number | null;
  localSettings: LocalSettings;
  purchases: Purchases;
  profile: Profile;
  sessions: Record<string, Session>;
  sessionsData: SessionListItem[] | null; // Legacy - to be removed
  sessionListViewData: SessionListViewItem[] | null;
  sessionMessages: Record<string, SessionMessages>;
  sessionGitStatus: Record<string, GitStatus | null>;
  machines: Record<string, Machine>;
  artifacts: Record<string, DecryptedArtifact>; // New artifacts storage
  friends: Record<string, UserProfile>; // All relationships (friends, pending, requested, etc.)
  users: Record<string, UserProfile | null>; // Global user cache, null = 404/failed fetch
  feedItems: FeedItem[]; // Simple list of feed items
  feedHead: string | null; // Newest cursor
  feedTail: string | null; // Oldest cursor
  feedHasMore: boolean;
  feedLoaded: boolean; // True after initial feed fetch
  friendsLoaded: boolean; // True after initial friends fetch
  realtimeStatus: 'disconnected' | 'connecting' | 'reconnecting' | 'connected' | 'error';
  realtimeMode: 'idle' | 'speaking';
  socketStatus: 'disconnected' | 'connecting' | 'connected' | 'error';
  socketLastConnectedAt: number | null;
  socketLastDisconnectedAt: number | null;
  sessionSendErrors: Record<string, { message: string; timestamp: number }>;
  setSessionSendError: (
    sessionId: string,
    error: { message: string; timestamp: number } | null
  ) => void;
  isDataReady: boolean;
  authError: string | null;
  setAuthError: (error: string | null) => void;
  nativeUpdateStatus: { available: boolean; updateUrl?: string } | null;
  applySessions: (
    sessions: (Omit<Session, 'presence'> & { presence?: 'online' | number })[]
  ) => void;
  applySessionEphemeralUpdates: (
    updates: Array<{
      id: string;
      status?: Session['status'];
      activeAt?: number;
      thinking?: boolean;
      thinkingAt?: number;
      latestUsage?: Session['latestUsage'];
    }>
  ) => boolean;
  applyMachines: (machines: Machine[], replace?: boolean) => void;
  applyLoaded: () => void;
  applyReady: () => void;
  applyMessages: (
    sessionId: string,
    messages: NormalizedMessage[]
  ) => { changed: string[]; hasReadyEvent: boolean; latestStatus?: 'working' | 'idle' };
  applyMessagesLoaded: (sessionId: string) => void;
  markSessionLocalHydrated: (sessionId: string, hydratedAt?: number) => void;
  setSessionOlderMessagesState: (
    sessionId: string,
    state: { hasOlderMessages?: boolean; isLoadingOlder?: boolean }
  ) => void;
  applySettings: (settings: Settings, version: number) => void;
  applySettingsLocal: (settings: Partial<Settings>) => void;
  applyLocalSettings: (settings: Partial<LocalSettings>) => void;
  applyPurchases: (customerInfo: CustomerInfo) => void;
  applyProfile: (profile: Profile) => void;
  applyGitStatus: (sessionId: string, status: GitStatus | null) => void;
  applyNativeUpdateStatus: (status: { available: boolean; updateUrl?: string } | null) => void;
  clearAllSessionMessages: () => void;
  dropSessionMessages: (sessionIds: string[]) => void;
  isMutableToolCall: (sessionId: string, callId: string) => boolean;
  setRealtimeStatus: (status: 'disconnected' | 'connecting' | 'reconnecting' | 'connected' | 'error') => void;
  setRealtimeMode: (mode: 'idle' | 'speaking', immediate?: boolean) => void;
  clearRealtimeModeDebounce: () => void;
  setSocketStatus: (status: 'disconnected' | 'connecting' | 'connected' | 'error') => void;
  getActiveSessions: () => Session[];
  updateSessionDraft: (sessionId: string, draft: string | null) => void;
  setSessionQueuedMessages: (sessionId: string, queuedMessages: QueuedMessage[]) => void;
  enqueueSessionQueuedMessage: (sessionId: string, queuedMessage: QueuedMessage) => void;
  updateSessionQueuedMessage: (sessionId: string, queuedMessage: QueuedMessage) => void;
  removeSessionQueuedMessage: (sessionId: string, queuedMessageId: string) => void;
  removeSessionQueuedMessages: (sessionId: string, queuedMessageIds: string[]) => void;
  updateSessionPermissionMode: (sessionId: string, mode: PermissionMode) => void;
  updateSessionDesiredAgentMode: (sessionId: string, mode: string | null) => void;
  updateSessionModelMode: (sessionId: string, mode: string | null) => void;
  updateSessionDesiredConfigOption: (
    sessionId: string,
    optionId: string,
    value: string | null
  ) => void;
  updateSessionCapabilities: (sessionId: string, capabilities: SessionCapabilities | null) => void;
  // Artifact methods
  applyArtifacts: (artifacts: DecryptedArtifact[]) => void;
  addArtifact: (artifact: DecryptedArtifact) => void;
  updateArtifact: (artifact: DecryptedArtifact) => void;
  deleteArtifact: (artifactId: string) => void;
  deleteSession: (sessionId: string) => void;
  // Project management methods
  getProjects: () => import('./projectManager').Project[];
  getProject: (projectId: string) => import('./projectManager').Project | null;
  getProjectForSession: (sessionId: string) => import('./projectManager').Project | null;
  getProjectSessions: (projectId: string) => string[];
  // Project git status methods
  getProjectGitStatus: (projectId: string) => import('./storageTypes').GitStatus | null;
  getSessionProjectGitStatus: (sessionId: string) => import('./storageTypes').GitStatus | null;
  updateSessionProjectGitStatus: (
    sessionId: string,
    status: import('./storageTypes').GitStatus | null
  ) => void;
  // Friend management methods
  applyFriends: (friends: UserProfile[]) => void;
  applyRelationshipUpdate: (event: RelationshipUpdatedEvent) => void;
  getFriend: (userId: string) => UserProfile | undefined;
  getAcceptedFriends: () => UserProfile[];
  // User cache methods
  applyUsers: (users: Record<string, UserProfile | null>) => void;
  getUser: (userId: string) => UserProfile | null | undefined;
  assumeUsers: (userIds: string[]) => Promise<void>;
  // Feed methods
  applyFeedItems: (items: FeedItem[]) => void;
  clearFeed: () => void;
}

// Helper function to build unified list view data from sessions and machines
function buildSessionListViewData(sessions: Record<string, Session>): SessionListViewItem[] {
  // Separate active and inactive sessions
  const activeSessions: Session[] = [];
  const inactiveSessions: Session[] = [];

  Object.values(sessions).forEach(session => {
    if (isSessionActive(session)) {
      activeSessions.push(session);
    } else {
      inactiveSessions.push(session);
    }
  });

  // Sort sessions by updated date (newest first)
  activeSessions.sort(compareUpdatedDesc);
  inactiveSessions.sort(compareUpdatedDesc);

  // Build unified list view data
  const listData: SessionListViewItem[] = [];

  // Add active sessions as a single item at the top (if any)
  if (activeSessions.length > 0) {
    listData.push({ type: 'active-sessions', sessions: activeSessions });
  }

  // Group inactive sessions by date
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);

  let currentDateGroup: Session[] = [];
  let currentDateString: string | null = null;

  for (const session of inactiveSessions) {
    const sessionDate = new Date(session.updatedAt);
    const dateString = sessionDate.toDateString();

    if (currentDateString !== dateString) {
      // Process previous group
      if (currentDateGroup.length > 0 && currentDateString) {
        const groupDate = new Date(currentDateString);
        const sessionDateOnly = new Date(
          groupDate.getFullYear(),
          groupDate.getMonth(),
          groupDate.getDate()
        );

        let headerTitle: string;
        if (sessionDateOnly.getTime() === today.getTime()) {
          headerTitle = 'Today';
        } else if (sessionDateOnly.getTime() === yesterday.getTime()) {
          headerTitle = 'Yesterday';
        } else {
          const diffTime = today.getTime() - sessionDateOnly.getTime();
          const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
          headerTitle = `${diffDays} days ago`;
        }

        listData.push({ type: 'header', title: headerTitle });
        currentDateGroup.forEach(sess => {
          listData.push({ type: 'session', session: sess });
        });
      }

      // Start new group
      currentDateString = dateString;
      currentDateGroup = [session];
    } else {
      currentDateGroup.push(session);
    }
  }

  // Process final group
  if (currentDateGroup.length > 0 && currentDateString) {
    const groupDate = new Date(currentDateString);
    const sessionDateOnly = new Date(
      groupDate.getFullYear(),
      groupDate.getMonth(),
      groupDate.getDate()
    );

    let headerTitle: string;
    if (sessionDateOnly.getTime() === today.getTime()) {
      headerTitle = 'Today';
    } else if (sessionDateOnly.getTime() === yesterday.getTime()) {
      headerTitle = 'Yesterday';
    } else {
      const diffTime = today.getTime() - sessionDateOnly.getTime();
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
      headerTitle = `${diffDays} days ago`;
    }

    listData.push({ type: 'header', title: headerTitle });
    currentDateGroup.forEach(sess => {
      listData.push({ type: 'session', session: sess });
    });
  }

  return listData;
}

function buildLegacySessionsData(sessions: Record<string, Session>): SessionListItem[] {
  const activeSessions: Session[] = [];
  const inactiveSessions: Session[] = [];

  Object.values(sessions).forEach(session => {
    if (isSessionActive(session)) {
      activeSessions.push(session);
    } else {
      inactiveSessions.push(session);
    }
  });

  activeSessions.sort(compareCreatedDesc);
  inactiveSessions.sort(compareCreatedDesc);

  const listData: SessionListItem[] = [];

  if (activeSessions.length > 0) {
    listData.push('online');
    listData.push(...activeSessions);
  }

  if (inactiveSessions.length > 0) {
    listData.push('offline');
    listData.push(...inactiveSessions);
  }

  return listData;
}

function patchLegacySessionsData(
  sessionsData: SessionListItem[] | null,
  updatedSessions: Map<string, Session>
): SessionListItem[] | null {
  if (!sessionsData || updatedSessions.size === 0) {
    return sessionsData;
  }

  let changed = false;
  const nextData = sessionsData.map(item => {
    if (typeof item === 'string') {
      return item;
    }
    const updated = updatedSessions.get(item.id);
    if (!updated) {
      return item;
    }
    changed = true;
    return updated;
  });

  return changed ? nextData : sessionsData;
}

function patchSessionListViewData(
  sessionListViewData: SessionListViewItem[] | null,
  updatedSessions: Map<string, Session>
): SessionListViewItem[] | null {
  if (!sessionListViewData || updatedSessions.size === 0) {
    return sessionListViewData;
  }

  let changed = false;
  const nextData = sessionListViewData.map(item => {
    if (item.type === 'active-sessions') {
      let groupChanged = false;
      const sessions = item.sessions.map(session => {
        const updated = updatedSessions.get(session.id);
        if (!updated) {
          return session;
        }
        groupChanged = true;
        return updated;
      });
      if (!groupChanged) {
        return item;
      }
      changed = true;
      return { ...item, sessions };
    }

    if (item.type === 'session') {
      const updated = updatedSessions.get(item.session.id);
      if (!updated) {
        return item;
      }
      changed = true;
      return { ...item, session: updated };
    }

    return item;
  });

  return changed ? nextData : sessionListViewData;
}

function hasMessageSortKeyChanged(previous: Message, next: Message): boolean {
  return previous.createdAt !== next.createdAt || previous.seq !== next.seq;
}

function findMessageInsertIndex(messages: Message[], message: Message): number {
  let low = 0;
  let high = messages.length;

  while (low < high) {
    const mid = (low + high) >> 1;
    const current = messages[mid];
    if (!current) {
      break;
    }
    if (sortMessagesDesc(message, current) < 0) {
      high = mid;
    } else {
      low = mid + 1;
    }
  }

  return low;
}

function mergeSortedMessages(
  existingMessages: Message[],
  existingMessagesMap: Record<string, Message>,
  existingMessageIndexMap: Record<string, number>,
  incomingMessages: Message[]
): {
  messages: Message[];
  messagesMap: Record<string, Message>;
  messageIndexMap: Record<string, number>;
} {
  if (incomingMessages.length === 0) {
    return {
      messages: existingMessages,
      messagesMap: existingMessagesMap,
      messageIndexMap: existingMessageIndexMap,
    };
  }

  const dedupedIncoming = new Map<string, Message>();
  for (const message of incomingMessages) {
    dedupedIncoming.set(message.id, message);
  }

  const mergedMessagesMap = { ...existingMessagesMap };
  const nextMessages = existingMessages.slice();
  const nextMessageIndexMap = { ...existingMessageIndexMap };

  const newMessages: Message[] = [];
  let requiresFullSort = false;

  for (const [messageId, nextMessage] of dedupedIncoming) {
    const previousMessage = existingMessagesMap[messageId];
    mergedMessagesMap[messageId] = nextMessage;

    if (!previousMessage) {
      newMessages.push(nextMessage);
      continue;
    }

    const existingIndex = nextMessageIndexMap[messageId];
    if (existingIndex === undefined || hasMessageSortKeyChanged(previousMessage, nextMessage)) {
      requiresFullSort = true;
      break;
    }

    nextMessages[existingIndex] = nextMessage;
  }

  if (requiresFullSort) {
    const sortedMessages = Object.values(mergedMessagesMap).sort(sortMessagesDesc);
    const sortedMessageIndexMap: Record<string, number> = {};
    sortedMessages.forEach((message, index) => {
      sortedMessageIndexMap[message.id] = index;
    });
    return {
      messages: sortedMessages,
      messagesMap: mergedMessagesMap,
      messageIndexMap: sortedMessageIndexMap,
    };
  }

  if (newMessages.length === 0) {
    return {
      messages: nextMessages,
      messagesMap: mergedMessagesMap,
      messageIndexMap: nextMessageIndexMap,
    };
  }

  newMessages.sort(sortMessagesDesc);
  for (const message of newMessages) {
    const insertIndex = findMessageInsertIndex(nextMessages, message);
    nextMessages.splice(insertIndex, 0, message);
  }

  nextMessages.forEach((message, index) => {
    nextMessageIndexMap[message.id] = index;
  });

  return {
    messages: nextMessages,
    messagesMap: mergedMessagesMap,
    messageIndexMap: nextMessageIndexMap,
  };
}

export const storage = create<StorageState>()((set, get) => {
  const { settings, version } = loadSettings();
  const localSettings = loadLocalSettings();
  const purchases = loadPurchases();
  const profile = loadProfile();
  const sessionDrafts = loadSessionDrafts();
  const sessionPermissionModes = loadSessionPermissionModes();
  const sessionDesiredAgentModes = loadSessionDesiredAgentModes();
  const sessionDesiredConfigOptions = loadSessionDesiredConfigOptions();
  const sessionModelModes = loadSessionModelModes();
  return {
    settings,
    settingsVersion: version,
    localSettings,
    purchases,
    profile,
    sessions: {},
    machines: {},
    artifacts: {}, // Initialize artifacts
    friends: {}, // Initialize relationships cache
    users: {}, // Initialize global user cache
    feedItems: [], // Initialize feed items list
    feedHead: null,
    feedTail: null,
    feedHasMore: false,
    feedLoaded: false, // Initialize as false
    friendsLoaded: false, // Initialize as false
    sessionsData: null, // Legacy - to be removed
    sessionListViewData: null,
    sessionMessages: {},
    sessionGitStatus: {},
    realtimeStatus: 'disconnected',
    realtimeMode: 'idle',
    socketStatus: 'disconnected',
    socketLastConnectedAt: null,
    socketLastDisconnectedAt: null,
    sessionSendErrors: {},
    isDataReady: false,
    authError: null,
    setAuthError: (error: string | null) =>
      set(() => ({ authError: error })),
    nativeUpdateStatus: null,
    isMutableToolCall: (sessionId: string, callId: string) => {
      const sessionMessages = get().sessionMessages[sessionId];
      if (!sessionMessages) {
        return true;
      }
      const toolCall = sessionMessages.reducerState.toolIdToMessageId.get(callId);
      if (!toolCall) {
        return true;
      }
      const toolCallMessage = sessionMessages.messagesMap[toolCall];
      if (!toolCallMessage || toolCallMessage.kind !== 'tool-call') {
        return true;
      }
      return toolCallMessage.tool?.name ? resolveIsMutableTool(toolCallMessage.tool?.name) : true;
    },
    getActiveSessions: () => {
      const state = get();
      return Object.values(state.sessions).filter(s => s.status === 'active');
    },
    applySessions: (sessions: (Omit<Session, 'presence'> & { presence?: 'online' | number })[]) =>
      set(state => {
        let shouldRefreshProjects = Object.keys(state.sessions).length === 0;
        // Load drafts and permission modes if sessions are empty (initial load)
        const savedDrafts = Object.keys(state.sessions).length === 0 ? sessionDrafts : {};
        const savedPermissionModes =
          Object.keys(state.sessions).length === 0 ? sessionPermissionModes : {};
        const savedDesiredAgentModes =
          Object.keys(state.sessions).length === 0 ? sessionDesiredAgentModes : {};
        const savedDesiredConfigOptions =
          Object.keys(state.sessions).length === 0 ? sessionDesiredConfigOptions : {};
        const savedModelModes = Object.keys(state.sessions).length === 0 ? sessionModelModes : {};

        // Merge new sessions with existing ones
        const mergedSessions: Record<string, Session> = { ...state.sessions };

        // Update sessions with calculated presence using centralized resolver
        sessions.forEach(session => {
          // Use centralized resolver for consistent state management
          const presence = resolveSessionOnlineState(session);
          const previousSession = state.sessions[session.id];

          // Preserve existing draft and permission mode if they exist, or load from saved data
          const existingDraft = previousSession?.draft;
          const existingQueuedMessages = previousSession?.queuedMessages;
          const savedDraft = savedDrafts[session.id];
          const existingPermissionMode = previousSession?.permissionMode;
          const savedPermissionMode = savedPermissionModes[session.id];
          const existingDesiredAgentMode = previousSession?.desiredAgentMode;
          const savedDesiredAgentMode = savedDesiredAgentModes[session.id];
          const existingDesiredConfigOptions = previousSession?.desiredConfigOptions;
          const savedDesiredConfigOption = savedDesiredConfigOptions[session.id];
          const existingModelMode = previousSession?.modelMode;
          const savedModelMode = savedModelModes[session.id];
          const existingLatestUsage = previousSession?.latestUsage;
          const fallbackPermissionMode: PermissionMode = isSandboxEnabled(session.metadata)
            ? 'yolo'
            : 'accept-edits';
          const resolvedPermissionMode: PermissionMode =
            existingPermissionMode ||
            savedPermissionMode ||
            session.permissionMode ||
            fallbackPermissionMode;

          mergedSessions[session.id] = {
            ...session,
            presence,
            draft: existingDraft || savedDraft || session.draft || null,
            queuedMessages: existingQueuedMessages || session.queuedMessages || [],
            permissionMode: resolvedPermissionMode,
            desiredAgentMode: existingDesiredAgentMode || savedDesiredAgentMode || null,
            desiredConfigOptions: existingDesiredConfigOptions || savedDesiredConfigOption || null,
            modelMode: existingModelMode || savedModelMode || session.modelMode || null,
            latestUsage: session.latestUsage || existingLatestUsage,
          };

          if (
            !shouldRefreshProjects &&
            (!previousSession ||
              previousSession.metadata?.machineId !== session.metadata?.machineId ||
              previousSession.metadata?.path !== session.metadata?.path)
          ) {
            shouldRefreshProjects = true;
          }
        });

        const listData = buildLegacySessionsData(mergedSessions);

        // Process AgentState updates for sessions that already have messages loaded
        const updatedSessionMessages = { ...state.sessionMessages };

        sessions.forEach(session => {
          const oldSession = state.sessions[session.id];
          const newSession = mergedSessions[session.id];

          // Check if sessionMessages exists AND agentStateVersion is newer
          const existingSessionMessages = updatedSessionMessages[session.id];
          if (
            existingSessionMessages &&
            newSession.agentState &&
            (!oldSession || newSession.agentStateVersion > (oldSession.agentStateVersion || 0))
          ) {
            // Check for NEW permission requests before processing
            const realtimeInfo = _getRealtimeSessionInfo?.() ?? {
              sessionId: null,
              voiceSession: null,
            };
            const currentRealtimeSessionId = realtimeInfo.sessionId;
            const voiceSession = realtimeInfo.voiceSession;

            // logger.debug('[REALTIME DEBUG] Permission check:', {
            //     currentRealtimeSessionId,
            //     sessionId: session.id,
            //     match: currentRealtimeSessionId === session.id,
            //     hasVoiceSession: !!voiceSession,
            //     oldRequests: Object.keys(oldSession?.agentState?.requests || {}),
            //     newRequests: Object.keys(newSession.agentState?.requests || {})
            // });

            if (currentRealtimeSessionId === session.id && voiceSession) {
              const oldRequests = oldSession?.agentState?.requests || {};
              const newRequests = newSession.agentState?.requests || {};

              // Find NEW permission requests only
              for (const [requestId, request] of Object.entries(newRequests)) {
                if (!oldRequests[requestId]) {
                  // This is a NEW permission request
                  const toolName = request.tool;
                  // logger.debug('[REALTIME DEBUG] Sending permission notification for:', toolName);
                  voiceSession.sendTextMessage(
                    `The agent is requesting permission to use the ${toolName} tool`
                  );
                }
              }
            }

            // Process new AgentState through reducer
            const reducerResult = reducer(
              existingSessionMessages.reducerState,
              [],
              newSession.agentState
            );
            const processedMessages = reducerResult.messages;

            // Always update the session messages, even if no new messages were created
            // This ensures the reducer state is updated with the new AgentState
            const {
              messages: messagesArray,
              messagesMap: mergedMessagesMap,
              messageIndexMap: mergedMessageIndexMap,
            } = mergeSortedMessages(
              existingSessionMessages.messages,
              existingSessionMessages.messagesMap,
              existingSessionMessages.messageIndexMap,
              processedMessages
            );

            updatedSessionMessages[session.id] = {
              messages: messagesArray,
              messagesMap: mergedMessagesMap,
              messageIndexMap: mergedMessageIndexMap,
              reducerState: existingSessionMessages.reducerState, // The reducer modifies state in-place, so this has the updates
              isLoaded: existingSessionMessages.isLoaded,
              lastLocalHydratedAt: existingSessionMessages.lastLocalHydratedAt,
              hasOlderMessages: existingSessionMessages.hasOlderMessages,
              isLoadingOlder: existingSessionMessages.isLoadingOlder,
            };

            // IMPORTANT: Copy latestUsage from reducerState to Session for immediate availability
            if (existingSessionMessages.reducerState.latestUsage) {
              mergedSessions[session.id] = {
                ...mergedSessions[session.id],
                latestUsage: { ...existingSessionMessages.reducerState.latestUsage },
              };
            }
          }
        });

        // Build new unified list view data
        const sessionListViewData = buildSessionListViewData(mergedSessions);

        // Update project manager with current sessions and machines
        const machineMetadataMap = new Map<string, any>();
        Object.values(state.machines).forEach(machine => {
          if (machine.metadata) {
            machineMetadataMap.set(machine.id, machine.metadata);
          }
        });
        if (shouldRefreshProjects) {
          projectManager.updateSessions(Object.values(mergedSessions), machineMetadataMap);
        }

        return {
          ...state,
          sessions: mergedSessions,
          sessionsData: listData, // Legacy - to be removed
          sessionListViewData,
          sessionMessages: updatedSessionMessages,
        };
      }),
    applySessionEphemeralUpdates: (
      updates: Array<{
        id: string;
        status?: Session['status'];
        activeAt?: number;
        thinking?: boolean;
        thinkingAt?: number;
        latestUsage?: Session['latestUsage'];
      }>
    ) => {
      let activeMembershipChanged = false;

      set(state => {
        if (updates.length === 0) {
          return state;
        }

        const nextSessions: Record<string, Session> = { ...state.sessions };
        const changedSessions = new Map<string, Session>();

        for (const update of updates) {
          const session = state.sessions[update.id];
          if (!session) {
            continue;
          }

          const nextStatus = update.status ?? session.status;
          const nextActiveAt = update.activeAt ?? session.activeAt;
          const nextPresence = resolveSessionOnlineState({
            status: nextStatus,
            activeAt: nextActiveAt,
          });
          const nextThinking = update.thinking ?? session.thinking;
          const nextThinkingAt = update.thinkingAt ?? session.thinkingAt;
          const nextLatestUsage =
            update.latestUsage === undefined ? session.latestUsage : update.latestUsage;

          if (
            nextStatus === session.status &&
            nextActiveAt === session.activeAt &&
            nextPresence === session.presence &&
            nextThinking === session.thinking &&
            nextThinkingAt === session.thinkingAt &&
            nextLatestUsage === session.latestUsage
          ) {
            continue;
          }

          if (nextStatus !== session.status) {
            activeMembershipChanged = true;
          }

          const nextSession: Session = {
            ...session,
            status: nextStatus,
            activeAt: nextActiveAt,
            presence: nextPresence,
            thinking: nextThinking,
            thinkingAt: nextThinkingAt,
            latestUsage: nextLatestUsage,
          };

          nextSessions[session.id] = nextSession;
          changedSessions.set(session.id, nextSession);
        }

        if (changedSessions.size === 0) {
          return state;
        }

        return {
          ...state,
          sessions: nextSessions,
          sessionsData: activeMembershipChanged
            ? buildLegacySessionsData(nextSessions)
            : patchLegacySessionsData(state.sessionsData, changedSessions),
          sessionListViewData: activeMembershipChanged
            ? buildSessionListViewData(nextSessions)
            : patchSessionListViewData(state.sessionListViewData, changedSessions),
        };
      });

      return activeMembershipChanged;
    },
    applyLoaded: () =>
      set(state => {
        const result = {
          ...state,
          sessionsData: [],
        };
        return result;
      }),
    applyReady: () =>
      set(state => ({
        ...state,
        isDataReady: true,
      })),
    applyMessages: (sessionId: string, messages: NormalizedMessage[]) => {
      const log = sessionLogger(logger, sessionId);
      log.debug('applyMessages', { messageCount: messages.length });
      const changed = new Set<string>();
      let hasReadyEvent = false;
      let latestStatus: 'working' | 'idle' | undefined;
      set(state => {
        // Resolve session messages state
        const existingSession = state.sessionMessages[sessionId] || {
          messages: [],
          messagesMap: {},
          messageIndexMap: {},
          reducerState: createReducer(),
          isLoaded: false,
          lastLocalHydratedAt: 0,
          hasOlderMessages: false,
          isLoadingOlder: false,
        };

        // Get the session's agentState if available
        const session = state.sessions[sessionId];
        const agentState = session?.agentState;

        // Messages are already normalized, no need to process them again
        const normalizedMessages = messages;

        // Run reducer with agentState
        const reducerResult = measurePerformance('sync:storage.applyMessages.reducer', () =>
          reducer(existingSession.reducerState, normalizedMessages, agentState)
        );
        const processedMessages = reducerResult.messages;
        for (const message of processedMessages) {
          changed.add(message.id);
        }
        if (reducerResult.hasReadyEvent) {
          hasReadyEvent = true;
        }
        if (reducerResult.latestStatus) {
          latestStatus = reducerResult.latestStatus;
        }

        const hasProcessedMessages = processedMessages.length > 0;
        const {
          messages: messagesArray,
          messagesMap: mergedMessagesMap,
          messageIndexMap: mergedMessageIndexMap,
        } = hasProcessedMessages
          ? measurePerformance('sync:storage.applyMessages.mergeSortedMessages', () =>
              mergeSortedMessages(
                existingSession.messages,
                existingSession.messagesMap,
                existingSession.messageIndexMap,
                processedMessages
              )
            )
          : {
              messages: existingSession.messages,
              messagesMap: existingSession.messagesMap,
              messageIndexMap: existingSession.messageIndexMap,
            };

        // Update session with todos and latestUsage
        // IMPORTANT: We extract latestUsage from the mutable reducerState and copy it to the Session object
        // This ensures latestUsage is available immediately on load, even before messages are fully loaded
        let updatedSessions = state.sessions;
        const needsUpdate =
          (reducerResult.todos !== undefined || existingSession.reducerState.latestUsage) &&
          session;

        if (needsUpdate) {
          updatedSessions = {
            ...state.sessions,
            [sessionId]: {
              ...session,
              ...(reducerResult.todos !== undefined && { todos: reducerResult.todos }),
              // Copy latestUsage from reducerState to make it immediately available
              latestUsage: existingSession.reducerState.latestUsage
                ? {
                    ...existingSession.reducerState.latestUsage,
                  }
                : session.latestUsage,
            },
          };
        }

        return {
          ...state,
          sessions: updatedSessions,
          sessionMessages: {
            ...state.sessionMessages,
            [sessionId]: {
              ...existingSession,
              messages: messagesArray,
              messagesMap: mergedMessagesMap,
              messageIndexMap: mergedMessageIndexMap,
              reducerState: existingSession.reducerState, // Explicitly include the mutated reducer state
              isLoaded: true,
              lastLocalHydratedAt: existingSession.lastLocalHydratedAt,
            },
          },
        };
      });

      log.debug('applyMessages done', {
        changedCount: changed.size,
        hasReadyEvent,
        latestStatus,
      });
      return { changed: Array.from(changed), hasReadyEvent, latestStatus };
    },
    applyMessagesLoaded: (sessionId: string) =>
      set(state => {
        const existingSession = state.sessionMessages[sessionId];
        let result: StorageState;

        if (!existingSession) {
          // First time loading - check for AgentState
          const session = state.sessions[sessionId];
          const agentState = session?.agentState;

          // Create new reducer state
          const reducerState = createReducer();

          // Process AgentState if it exists
          let messages: Message[] = [];
          const messagesMap: Record<string, Message> = {};
          const messageIndexMap: Record<string, number> = {};

          if (agentState) {
            // Process AgentState through reducer to get initial permission messages
            const reducerResult = reducer(reducerState, [], agentState);
            const processedMessages = reducerResult.messages;

            processedMessages.forEach(message => {
              messagesMap[message.id] = message;
            });

            messages = Object.values(messagesMap).sort(sortMessagesDesc);
            messages.forEach((message, index) => {
              messageIndexMap[message.id] = index;
            });
          }

          // Extract latestUsage from reducerState if available and update session
          let updatedSessions = state.sessions;
          if (session && reducerState.latestUsage) {
            updatedSessions = {
              ...state.sessions,
              [sessionId]: {
                ...session,
                latestUsage: { ...reducerState.latestUsage },
              },
            };
          }

          result = {
            ...state,
            sessions: updatedSessions,
            sessionMessages: {
              ...state.sessionMessages,
              [sessionId]: {
                reducerState,
                messages,
                messagesMap,
                messageIndexMap,
                isLoaded: true,
                lastLocalHydratedAt: 0,
                hasOlderMessages: false,
                isLoadingOlder: false,
              } satisfies SessionMessages,
            },
          };
        } else {
          result = {
            ...state,
            sessionMessages: {
              ...state.sessionMessages,
              [sessionId]: {
                ...existingSession,
                isLoaded: true,
              } satisfies SessionMessages,
            },
          };
        }

        return result;
      }),
    markSessionLocalHydrated: (sessionId: string, hydratedAt = Date.now()) =>
      set(state => {
        const existingSession = state.sessionMessages[sessionId];
        if (!existingSession) {
          return state;
        }

        return {
          ...state,
          sessionMessages: {
            ...state.sessionMessages,
            [sessionId]: {
              ...existingSession,
              lastLocalHydratedAt: hydratedAt,
            } satisfies SessionMessages,
          },
        };
      }),
    setSessionOlderMessagesState: (
      sessionId: string,
      update: { hasOlderMessages?: boolean; isLoadingOlder?: boolean }
    ) =>
      set(state => {
        const existing = state.sessionMessages[sessionId];
        if (!existing) return state;
        return {
          ...state,
          sessionMessages: {
            ...state.sessionMessages,
            [sessionId]: {
              ...existing,
              ...(update.hasOlderMessages !== undefined
                ? { hasOlderMessages: update.hasOlderMessages }
                : {}),
              ...(update.isLoadingOlder !== undefined
                ? { isLoadingOlder: update.isLoadingOlder }
                : {}),
            },
          },
        };
      }),
    applySettingsLocal: (settings: Partial<Settings>) =>
      set(state => {
        saveSettings(applySettings(state.settings, settings), state.settingsVersion ?? 0);
        return {
          ...state,
          settings: applySettings(state.settings, settings),
        };
      }),
    applySettings: (settings: Settings, version: number) =>
      set(state => {
        if (state.settingsVersion === null || state.settingsVersion < version) {
          saveSettings(settings, version);
          return {
            ...state,
            settings,
            settingsVersion: version,
          };
        } else {
          return state;
        }
      }),
    applyLocalSettings: (delta: Partial<LocalSettings>) =>
      set(state => {
        const updatedLocalSettings = applyLocalSettings(state.localSettings, delta);
        saveLocalSettings(updatedLocalSettings);
        return {
          ...state,
          localSettings: updatedLocalSettings,
        };
      }),
    applyPurchases: (customerInfo: CustomerInfo) =>
      set(state => {
        // Transform CustomerInfo to our Purchases format
        const purchases = customerInfoToPurchases(customerInfo);

        // Always save and update - no need for version checks
        savePurchases(purchases);
        return {
          ...state,
          purchases,
        };
      }),
    applyProfile: (profile: Profile) =>
      set(state => {
        // Always save and update profile
        saveProfile(profile);
        return {
          ...state,
          profile,
        };
      }),
    applyGitStatus: (sessionId: string, status: GitStatus | null) =>
      set(state => {
        // Update project git status as well
        projectManager.updateSessionProjectGitStatus(sessionId, status);

        return {
          ...state,
          sessionGitStatus: {
            ...state.sessionGitStatus,
            [sessionId]: status,
          },
        };
      }),
    applyNativeUpdateStatus: (status: { available: boolean; updateUrl?: string } | null) =>
      set(state => ({
        ...state,
        nativeUpdateStatus: status,
      })),
    clearAllSessionMessages: () =>
      set(state => ({
        ...state,
        sessionMessages: {},
      })),
    dropSessionMessages: (sessionIds: string[]) =>
      set(state => {
        if (sessionIds.length === 0) {
          return state;
        }

        let changed = false;
        const nextSessionMessages = { ...state.sessionMessages };
        for (const sessionId of sessionIds) {
          if (!(sessionId in nextSessionMessages)) {
            continue;
          }
          delete nextSessionMessages[sessionId];
          changed = true;
        }

        if (!changed) {
          return state;
        }

        return {
          ...state,
          sessionMessages: nextSessionMessages,
        };
      }),
    setRealtimeStatus: (status: 'disconnected' | 'connecting' | 'reconnecting' | 'connected' | 'error') =>
      set(state => ({
        ...state,
        realtimeStatus: status,
      })),
    setRealtimeMode: (mode: 'idle' | 'speaking', immediate?: boolean) => {
      if (immediate) {
        // Clear any pending debounce and set immediately
        if (realtimeModeDebounceTimer) {
          clearTimeout(realtimeModeDebounceTimer);
          realtimeModeDebounceTimer = null;
        }
        set(state => ({ ...state, realtimeMode: mode }));
      } else {
        // Debounce mode changes to avoid flickering
        if (realtimeModeDebounceTimer) {
          clearTimeout(realtimeModeDebounceTimer);
        }
        realtimeModeDebounceTimer = setTimeout(() => {
          realtimeModeDebounceTimer = null;
          set(state => ({ ...state, realtimeMode: mode }));
        }, REALTIME_MODE_DEBOUNCE_MS);
      }
    },
    clearRealtimeModeDebounce: () => {
      if (realtimeModeDebounceTimer) {
        clearTimeout(realtimeModeDebounceTimer);
        realtimeModeDebounceTimer = null;
      }
    },
    setSocketStatus: (status: 'disconnected' | 'connecting' | 'connected' | 'error') =>
      set(state => {
        const now = Date.now();
        const updates: Partial<StorageState> = {
          socketStatus: status,
        };

        // Update timestamp based on status
        if (status === 'connected') {
          updates.socketLastConnectedAt = now;
        } else if (status === 'disconnected' || status === 'error') {
          updates.socketLastDisconnectedAt = now;
        }

        return {
          ...state,
          ...updates,
        };
      }),
    setSessionSendError: (
      sessionId: string,
      error: { message: string; timestamp: number } | null
    ) =>
      set(state => {
        const next = { ...state.sessionSendErrors };
        if (error) {
          next[sessionId] = error;
        } else {
          delete next[sessionId];
        }
        return { ...state, sessionSendErrors: next };
      }),
    updateSessionDraft: (sessionId: string, draft: string | null) =>
      set(state => {
        const session = state.sessions[sessionId];
        if (!session) return state;

        // Don't store empty strings, convert to null
        const normalizedDraft = draft?.trim() ? draft : null;
        if (session.draft === normalizedDraft) {
          return state;
        }

        if (normalizedDraft) {
          sessionDrafts[sessionId] = normalizedDraft;
        } else {
          delete sessionDrafts[sessionId];
        }
        saveSessionDrafts(sessionDrafts);

        const updatedSessions = {
          ...state.sessions,
          [sessionId]: {
            ...session,
            draft: normalizedDraft,
          },
        };
        const changedSessions = new Map<string, Session>([[sessionId, updatedSessions[sessionId]!]]);

        return {
          ...state,
          sessions: updatedSessions,
          sessionsData: patchLegacySessionsData(state.sessionsData, changedSessions),
          sessionListViewData: patchSessionListViewData(state.sessionListViewData, changedSessions),
        };
      }),
    setSessionQueuedMessages: (sessionId: string, queuedMessages: QueuedMessage[]) =>
      set(state => {
        const session = state.sessions[sessionId];
        if (!session) return state;

        const updatedSessions = {
          ...state.sessions,
          [sessionId]: {
            ...session,
            queuedMessages,
          },
        };
        const changedSessions = new Map<string, Session>([[sessionId, updatedSessions[sessionId]!]]);
        scheduleSaveCachedSessions(
          Object.values(updatedSessions).filter(current => current.status !== 'deleted')
        );

        return {
          ...state,
          sessions: updatedSessions,
          sessionsData: patchLegacySessionsData(state.sessionsData, changedSessions),
          sessionListViewData: patchSessionListViewData(state.sessionListViewData, changedSessions),
        };
      }),
    enqueueSessionQueuedMessage: (sessionId: string, queuedMessage: QueuedMessage) =>
      set(state => {
        const session = state.sessions[sessionId];
        if (!session) return state;
        const nextQueuedMessages = [...(session.queuedMessages ?? []), queuedMessage];
        const updatedSessions = {
          ...state.sessions,
          [sessionId]: {
            ...session,
            queuedMessages: nextQueuedMessages,
          },
        };
        const changedSessions = new Map<string, Session>([[sessionId, updatedSessions[sessionId]!]]);
        scheduleSaveCachedSessions(
          Object.values(updatedSessions).filter(current => current.status !== 'deleted')
        );
        return {
          ...state,
          sessions: updatedSessions,
          sessionsData: patchLegacySessionsData(state.sessionsData, changedSessions),
          sessionListViewData: patchSessionListViewData(state.sessionListViewData, changedSessions),
        };
      }),
    updateSessionQueuedMessage: (sessionId: string, queuedMessage: QueuedMessage) =>
      set(state => {
        const session = state.sessions[sessionId];
        if (!session) return state;
        const nextQueuedMessages = (session.queuedMessages ?? []).map(message =>
          message.id === queuedMessage.id ? queuedMessage : message
        );
        const updatedSessions = {
          ...state.sessions,
          [sessionId]: {
            ...session,
            queuedMessages: nextQueuedMessages,
          },
        };
        const changedSessions = new Map<string, Session>([[sessionId, updatedSessions[sessionId]!]]);
        scheduleSaveCachedSessions(
          Object.values(updatedSessions).filter(current => current.status !== 'deleted')
        );
        return {
          ...state,
          sessions: updatedSessions,
          sessionsData: patchLegacySessionsData(state.sessionsData, changedSessions),
          sessionListViewData: patchSessionListViewData(state.sessionListViewData, changedSessions),
        };
      }),
    removeSessionQueuedMessage: (sessionId: string, queuedMessageId: string) =>
      set(state => {
        const session = state.sessions[sessionId];
        if (!session) return state;
        const nextQueuedMessages = (session.queuedMessages ?? []).filter(
          message => message.id !== queuedMessageId
        );
        const updatedSessions = {
          ...state.sessions,
          [sessionId]: {
            ...session,
            queuedMessages: nextQueuedMessages,
          },
        };
        const changedSessions = new Map<string, Session>([[sessionId, updatedSessions[sessionId]!]]);
        scheduleSaveCachedSessions(
          Object.values(updatedSessions).filter(current => current.status !== 'deleted')
        );
        return {
          ...state,
          sessions: updatedSessions,
          sessionsData: patchLegacySessionsData(state.sessionsData, changedSessions),
          sessionListViewData: patchSessionListViewData(state.sessionListViewData, changedSessions),
        };
      }),
    removeSessionQueuedMessages: (sessionId: string, queuedMessageIds: string[]) =>
      set(state => {
        const session = state.sessions[sessionId];
        if (!session || queuedMessageIds.length === 0) return state;
        const nextQueuedMessages = removePromotedQueuedMessages(
          session.queuedMessages ?? [],
          queuedMessageIds
        );
        const updatedSessions = {
          ...state.sessions,
          [sessionId]: {
            ...session,
            queuedMessages: nextQueuedMessages,
          },
        };
        const changedSessions = new Map<string, Session>([[sessionId, updatedSessions[sessionId]!]]);
        scheduleSaveCachedSessions(
          Object.values(updatedSessions).filter(current => current.status !== 'deleted')
        );
        return {
          ...state,
          sessions: updatedSessions,
          sessionsData: patchLegacySessionsData(state.sessionsData, changedSessions),
          sessionListViewData: patchSessionListViewData(state.sessionListViewData, changedSessions),
        };
      }),
    updateSessionPermissionMode: (sessionId: string, mode: PermissionMode) =>
      set(state => {
        const session = state.sessions[sessionId];
        if (!session) return state;

        // Update the session with the new permission mode
        const updatedSessions = {
          ...state.sessions,
          [sessionId]: {
            ...session,
            permissionMode: mode,
          },
        };

        // Collect all permission modes for persistence
        const allModes: Record<string, PermissionMode> = {};
        Object.entries(updatedSessions).forEach(([id, sess]) => {
          if (sess.permissionMode) {
            allModes[id] = sess.permissionMode;
          }
        });

        // Persist permission modes (only non-default values to save space)
        saveSessionPermissionModes(allModes);

        // No need to rebuild sessionListViewData since permission mode doesn't affect the list display
        return {
          ...state,
          sessions: updatedSessions,
        };
      }),
    updateSessionDesiredAgentMode: (sessionId: string, mode: string | null) =>
      set(state => {
        const session = state.sessions[sessionId];
        if (!session) return state;

        const updatedSessions = {
          ...state.sessions,
          [sessionId]: {
            ...session,
            desiredAgentMode: mode,
          },
        };

        const allModes: Record<string, string> = {};
        Object.entries(updatedSessions).forEach(([id, sess]) => {
          if (sess.desiredAgentMode) {
            allModes[id] = sess.desiredAgentMode;
          }
        });
        saveSessionDesiredAgentModes(allModes);

        return {
          ...state,
          sessions: updatedSessions,
        };
      }),
    updateSessionModelMode: (sessionId: string, mode: string | null) =>
      set(state => {
        const session = state.sessions[sessionId];
        if (!session) return state;

        // Update the session with the new model mode
        const updatedSessions = {
          ...state.sessions,
          [sessionId]: {
            ...session,
            modelMode: mode,
          },
        };

        const allModes: Record<string, string> = {};
        Object.entries(updatedSessions).forEach(([id, sess]) => {
          if (sess.modelMode) {
            allModes[id] = sess.modelMode;
          }
        });
        saveSessionModelModes(allModes);

        // No need to rebuild sessionListViewData since model mode doesn't affect the list display
        return {
          ...state,
          sessions: updatedSessions,
        };
      }),
    updateSessionDesiredConfigOption: (sessionId: string, optionId: string, value: string | null) =>
      set(state => {
        const session = state.sessions[sessionId];
        if (!session) return state;

        const nextDesiredConfigOptions = { ...(session.desiredConfigOptions ?? {}) };
        if (value === null) {
          delete nextDesiredConfigOptions[optionId];
        } else {
          nextDesiredConfigOptions[optionId] = value;
        }

        const updatedSessions = {
          ...state.sessions,
          [sessionId]: {
            ...session,
            desiredConfigOptions:
              Object.keys(nextDesiredConfigOptions).length > 0 ? nextDesiredConfigOptions : null,
          },
        };

        const allOptions: Record<string, Record<string, string>> = {};
        Object.entries(updatedSessions).forEach(([id, sess]) => {
          if (sess.desiredConfigOptions && Object.keys(sess.desiredConfigOptions).length > 0) {
            allOptions[id] = sess.desiredConfigOptions;
          }
        });
        saveSessionDesiredConfigOptions(allOptions);

        return {
          ...state,
          sessions: updatedSessions,
        };
      }),
    updateSessionCapabilities: (sessionId: string, capabilities: SessionCapabilities | null) =>
      set(state => {
        const session = state.sessions[sessionId];
        if (!session) return state;

        return {
          ...state,
          sessions: {
            ...state.sessions,
            [sessionId]: {
              ...session,
              capabilities,
            },
          },
        };
      }),
    // Project management methods
    getProjects: () => projectManager.getProjects(),
    getProject: (projectId: string) => projectManager.getProject(projectId),
    getProjectForSession: (sessionId: string) => projectManager.getProjectForSession(sessionId),
    getProjectSessions: (projectId: string) => projectManager.getProjectSessions(projectId),
    // Project git status methods
    getProjectGitStatus: (projectId: string) => projectManager.getProjectGitStatus(projectId),
    getSessionProjectGitStatus: (sessionId: string) =>
      projectManager.getSessionProjectGitStatus(sessionId),
    updateSessionProjectGitStatus: (sessionId: string, status: GitStatus | null) => {
      projectManager.updateSessionProjectGitStatus(sessionId, status);
      // Trigger a state update to notify hooks
      set(state => ({ ...state }));
    },
    applyMachines: (machines: Machine[], replace: boolean = false) =>
      set(state => {
        // Either replace all machines or merge updates
        let mergedMachines: Record<string, Machine>;

        if (replace) {
          // Replace entire machine state (used by fetchMachines)
          mergedMachines = {};
          machines.forEach(machine => {
            mergedMachines[machine.id] = machine;
          });
        } else {
          // Merge individual updates (used by update-machine)
          mergedMachines = { ...state.machines };
          machines.forEach(machine => {
            mergedMachines[machine.id] = machine;
          });
        }

        // Rebuild sessionListViewData to reflect machine changes
        const sessionListViewData = buildSessionListViewData(state.sessions);

        return {
          ...state,
          machines: mergedMachines,
          sessionListViewData,
        };
      }),
    // Artifact methods
    applyArtifacts: (artifacts: DecryptedArtifact[]) =>
      set(state => {
        logger.debug(`applyArtifacts: applying ${artifacts.length} artifacts`);
        const mergedArtifacts = { ...state.artifacts };
        artifacts.forEach(artifact => {
          mergedArtifacts[artifact.id] = artifact;
        });
        logger.debug(`applyArtifacts: total after merge: ${Object.keys(mergedArtifacts).length}`);

        return {
          ...state,
          artifacts: mergedArtifacts,
        };
      }),
    addArtifact: (artifact: DecryptedArtifact) =>
      set(state => {
        const updatedArtifacts = {
          ...state.artifacts,
          [artifact.id]: artifact,
        };

        return {
          ...state,
          artifacts: updatedArtifacts,
        };
      }),
    updateArtifact: (artifact: DecryptedArtifact) =>
      set(state => {
        const updatedArtifacts = {
          ...state.artifacts,
          [artifact.id]: artifact,
        };

        return {
          ...state,
          artifacts: updatedArtifacts,
        };
      }),
    deleteArtifact: (artifactId: string) =>
      set(state => {
        const { [artifactId]: _, ...remainingArtifacts } = state.artifacts;

        return {
          ...state,
          artifacts: remainingArtifacts,
        };
      }),
    deleteSession: (sessionId: string) =>
      set(state => {
        const log = sessionLogger(logger, sessionId);
        const messageCount = state.sessionMessages[sessionId]?.messages.length ?? 0;
        const hasGitStatus = !!state.sessionGitStatus[sessionId];
        log.debug('deleteSession', { messageCount, hasGitStatus });

        // Remove session from sessions
        const { [sessionId]: deletedSession, ...remainingSessions } = state.sessions;

        // Remove session messages if they exist
        const { [sessionId]: deletedMessages, ...remainingSessionMessages } = state.sessionMessages;

        // Remove session git status if it exists
        const { [sessionId]: deletedGitStatus, ...remainingGitStatus } = state.sessionGitStatus;

        // Clear drafts and permission modes from persistent storage
        delete sessionDrafts[sessionId];
        saveSessionDrafts(sessionDrafts);

        const modes = loadSessionPermissionModes();
        delete modes[sessionId];
        saveSessionPermissionModes(modes);

        const desiredAgentModes = loadSessionDesiredAgentModes();
        delete desiredAgentModes[sessionId];
        saveSessionDesiredAgentModes(desiredAgentModes);

        const desiredConfigOptions = loadSessionDesiredConfigOptions();
        delete desiredConfigOptions[sessionId];
        saveSessionDesiredConfigOptions(desiredConfigOptions);

        const modelModes = loadSessionModelModes();
        delete modelModes[sessionId];
        saveSessionModelModes(modelModes);

        // Rebuild sessionListViewData without the deleted session
        const sessionListViewData = buildSessionListViewData(remainingSessions);

        log.debug('deleteSession done', {
          remainingSessions: Object.keys(remainingSessions).length,
        });

        return {
          ...state,
          sessions: remainingSessions,
          sessionMessages: remainingSessionMessages,
          sessionGitStatus: remainingGitStatus,
          sessionListViewData,
        };
      }),
    // Friend management methods
    applyFriends: (friends: UserProfile[]) =>
      set(state => {
        const mergedFriends = { ...state.friends };
        friends.forEach(friend => {
          mergedFriends[friend.id] = friend;
        });
        return {
          ...state,
          friends: mergedFriends,
          friendsLoaded: true, // Mark as loaded after first fetch
        };
      }),
    applyRelationshipUpdate: (event: RelationshipUpdatedEvent) =>
      set(state => {
        const { fromUserId, toUserId, status, action, fromUser, toUser } = event;
        const currentUserId = state.profile.id;

        // Update friends cache
        const updatedFriends = { ...state.friends };

        // Determine which user profile to update based on perspective
        const otherUserId = fromUserId === currentUserId ? toUserId : fromUserId;
        const otherUser = fromUserId === currentUserId ? toUser : fromUser;

        if (action === 'deleted' || status === 'none') {
          // Remove from friends if deleted or status is none
          delete updatedFriends[otherUserId];
        } else if (otherUser) {
          // Update or add the user profile with current status
          updatedFriends[otherUserId] = otherUser;
        }

        return {
          ...state,
          friends: updatedFriends,
        };
      }),
    getFriend: (userId: string) => {
      return get().friends[userId];
    },
    getAcceptedFriends: () => {
      const friends = get().friends;
      return Object.values(friends).filter(friend => friend.status === 'friend');
    },
    // User cache methods
    applyUsers: (users: Record<string, UserProfile | null>) =>
      set(state => ({
        ...state,
        users: { ...state.users, ...users },
      })),
    getUser: (userId: string) => {
      return get().users[userId]; // Returns UserProfile | null | undefined
    },
    assumeUsers: async (userIds: string[]) => {
      return _assumeUsersCallback?.(userIds);
    },
    // Feed methods
    applyFeedItems: (items: FeedItem[]) =>
      set(state => {
        // Always mark feed as loaded even if empty
        if (items.length === 0) {
          return {
            ...state,
            feedLoaded: true, // Mark as loaded even when empty
          };
        }

        // Create a map of existing items for quick lookup
        const existingMap = new Map<string, FeedItem>();
        state.feedItems.forEach(item => {
          existingMap.set(item.id, item);
        });

        // Process new items
        const updatedItems = [...state.feedItems];
        let head = state.feedHead;
        let tail = state.feedTail;

        items.forEach(newItem => {
          // Remove items with same repeatKey if it exists
          if (newItem.repeatKey) {
            const indexToRemove = updatedItems.findIndex(
              item => item.repeatKey === newItem.repeatKey
            );
            if (indexToRemove !== -1) {
              updatedItems.splice(indexToRemove, 1);
            }
          }

          // Add new item if it doesn't exist
          if (!existingMap.has(newItem.id)) {
            updatedItems.push(newItem);
          }

          // Update head/tail cursors
          if (!head || newItem.counter > parseInt(head.substring(2), 10)) {
            head = newItem.cursor;
          }
          if (!tail || newItem.counter < parseInt(tail.substring(2), 10)) {
            tail = newItem.cursor;
          }
        });

        // Sort by counter (desc - newest first)
        updatedItems.sort((a, b) => b.counter - a.counter);

        return {
          ...state,
          feedItems: updatedItems,
          feedHead: head,
          feedTail: tail,
          feedLoaded: true, // Mark as loaded after first fetch
        };
      }),
    clearFeed: () =>
      set(state => ({
        ...state,
        feedItems: [],
        feedHead: null,
        feedTail: null,
        feedHasMore: false,
        feedLoaded: false, // Reset loading flag
        friendsLoaded: false, // Reset loading flag
      })),
  };
});

export function useSessions() {
  return storage(useShallow(state => (state.isDataReady ? state.sessionsData : null)));
}

export function useSession(id: string): Session | null {
  return storage(useShallow(state => state.sessions[id] ?? null));
}

export function useSessionCapabilities(id: string) {
  return storage(useShallow(state => state.sessions[id]?.capabilities ?? null));
}

const emptyArray: unknown[] = [];
const emptyMachines: Machine[] = [];
const emptySessionsList: Session[] = [];
const messageIdsCache = new WeakMap<Message[], string[]>();
let cachedMachinesSource: Record<string, Machine> | null = null;
let cachedAllMachines: Machine[] = emptyMachines;
let cachedMachineCount = 0;
let cachedSessionsSource: Record<string, Session> | null = null;
let cachedAllSessions: Session[] = emptySessionsList;
let cachedActiveSessionCount = 0;
const recentSessionsCache = new Map<number, { source: Session[]; value: Session[] }>();

function getCachedMessageIds(messages: Message[]): string[] {
  const cachedIds = messageIdsCache.get(messages);
  if (cachedIds) {
    return cachedIds;
  }
  const nextIds = messages.map(message => message.id);
  messageIdsCache.set(messages, nextIds);
  return nextIds;
}

function selectAllMachines(state: StorageState): Machine[] {
  if (!state.isDataReady) {
    return emptyMachines;
  }
  if (state.machines === cachedMachinesSource) {
    return cachedAllMachines;
  }

  cachedMachinesSource = state.machines;
  cachedAllMachines = Object.values(state.machines).sort(compareCreatedDesc).filter(machine => machine.active);
  cachedMachineCount = cachedAllMachines.length;
  return cachedAllMachines;
}

function selectMachineCount(state: StorageState): number {
  if (!state.isDataReady) {
    return 0;
  }
  if (state.machines !== cachedMachinesSource) {
    selectAllMachines(state);
  }
  return cachedMachineCount;
}

function ensureSessionSelectorCache(state: StorageState) {
  if (state.sessions === cachedSessionsSource) {
    return;
  }

  cachedSessionsSource = state.sessions;
  const allSessions = Object.values(state.sessions);
  cachedActiveSessionCount = 0;
  for (const session of allSessions) {
    if (session.status === 'active') {
      cachedActiveSessionCount += 1;
    }
  }
  cachedAllSessions = allSessions.sort(compareUpdatedDesc);
}

function selectActiveSessionCount(state: StorageState): number {
  ensureSessionSelectorCache(state);
  return cachedActiveSessionCount;
}

function selectAllSessions(state: StorageState): Session[] {
  if (!state.isDataReady) {
    return emptySessionsList;
  }
  ensureSessionSelectorCache(state);
  return cachedAllSessions;
}

function selectRecentSessions(state: StorageState, limit: number): Session[] {
  if (!state.isDataReady || limit <= 0) {
    return emptySessionsList;
  }

  const allSessions = selectAllSessions(state);
  const nextLength = Math.min(limit, allSessions.length);
  const cached = recentSessionsCache.get(limit);
  if (cached) {
    if (cached.source === allSessions) {
      return cached.value;
    }
    if (cached.value.length === nextLength) {
      let matchesPrefix = true;
      for (let index = 0; index < nextLength; index += 1) {
        if (cached.value[index] !== allSessions[index]) {
          matchesPrefix = false;
          break;
        }
      }
      if (matchesPrefix) {
        recentSessionsCache.set(limit, { source: allSessions, value: cached.value });
        return cached.value;
      }
    }
  }

  const nextSessions = allSessions.slice(0, limit);
  recentSessionsCache.set(limit, { source: allSessions, value: nextSessions });
  return nextSessions;
}

export function useSessionMessages(sessionId: string): {
  messages: Message[];
  isLoaded: boolean;
  hasOlderMessages: boolean;
  isLoadingOlder: boolean;
} {
  return storage(
    useShallow(state => {
      const session = state.sessionMessages[sessionId];
      return {
        messages: session?.messages ?? emptyArray,
        isLoaded: session?.isLoaded ?? false,
        hasOlderMessages: session?.hasOlderMessages ?? false,
        isLoadingOlder: session?.isLoadingOlder ?? false,
      };
    })
  );
}

export function useSessionMessageStats(sessionId: string): { count: number; isLoaded: boolean } {
  return storage(
    useShallow(state => {
      const session = state.sessionMessages[sessionId];
      return {
        count: session?.messages.length ?? 0,
        isLoaded: session?.isLoaded ?? false,
      };
    })
  );
}

export function useSessionMessageListState(sessionId: string): {
  isLoaded: boolean;
  hasOlderMessages: boolean;
  isLoadingOlder: boolean;
} {
  return storage(
    useShallow(state => {
      const session = state.sessionMessages[sessionId];
      return {
        isLoaded: session?.isLoaded ?? false,
        hasOlderMessages: session?.hasOlderMessages ?? false,
        isLoadingOlder: session?.isLoadingOlder ?? false,
      };
    })
  );
}

export function useSessionLocalHydratedAt(sessionId: string): number {
  return storage(state => state.sessionMessages[sessionId]?.lastLocalHydratedAt ?? 0);
}

export function useMessage(sessionId: string, messageId: string): Message | null {
  return storage(
    useShallow(state => {
      const session = state.sessionMessages[sessionId];
      return session?.messagesMap[messageId] ?? null;
    })
  );
}

const emptyIds: string[] = [];

export function useSessionMessageIds(sessionId: string): string[] {
  return storage(
    useShallow(state => {
      const session = state.sessionMessages[sessionId];
      return session?.messages ? getCachedMessageIds(session.messages) : emptyIds;
    })
  );
}

export function useSessionUsage(sessionId: string) {
  return storage(
    useShallow(state => {
      const session = state.sessionMessages[sessionId];
      return session?.reducerState?.latestUsage ?? null;
    })
  );
}

export function useSessionActiveToolCallCount(sessionId: string): number {
  return storage(state => state.sessionMessages[sessionId]?.reducerState?.activeToolCallCount ?? 0);
}

export function useSessionThinking(sessionId: string): boolean {
  return storage(state => state.sessions[sessionId]?.thinking ?? false);
}

export function useSessionControlledByUser(sessionId: string): boolean {
  return storage(state => state.sessions[sessionId]?.agentState?.controlledByUser ?? false);
}

export function useSettings(): Settings {
  return storage(useShallow(state => state.settings));
}

export function useSettingMutable<K extends keyof Settings>(
  name: K
): [Settings[K], (value: Settings[K]) => void] {
  const setValue = React.useCallback(
    (value: Settings[K]) => {
      _applySettingsCallback?.({ [name]: value });
    },
    [name]
  );
  const value = useSetting(name);
  return [value, setValue];
}

export function useSetting<K extends keyof Settings>(name: K): Settings[K] {
  return storage(useShallow(state => state.settings[name]));
}

export function useLocalSettings(): LocalSettings {
  return storage(useShallow(state => state.localSettings));
}

export function useAllMachines(): Machine[] {
  return storage(selectAllMachines);
}

export function useMachineCount(): number {
  return storage(selectMachineCount);
}

export function useMachine(machineId: string): Machine | null {
  return storage(useShallow(state => state.machines[machineId] ?? null));
}

export function useSessionRecoveryFailed(
  machineId: string | null | undefined,
  sessionId: string
): boolean {
  return storage(state => {
    const failures = state.machines[machineId ?? '']?.daemonState?.failedRecoveries as
      | Array<{ sessionId: string }>
      | undefined;
    if (!failures) {
      return false;
    }
    return failures.some(failure => failure.sessionId === sessionId);
  });
}

export function useSessionListViewData(): SessionListViewItem[] | null {
  return storage(state => (state.isDataReady ? state.sessionListViewData : null));
}

export function useActiveSessionCount(): number {
  return storage(selectActiveSessionCount);
}

export function useAllSessions(): Session[] {
  return storage(selectAllSessions);
}

export function useRecentSessions(limit: number): Session[] {
  const selector = React.useMemo(
    () => (state: StorageState) => selectRecentSessions(state, limit),
    [limit]
  );
  return storage(selector);
}

export function useLocalSettingMutable<K extends keyof LocalSettings>(
  name: K
): [LocalSettings[K], (value: LocalSettings[K]) => void] {
  const setValue = React.useCallback(
    (value: LocalSettings[K]) => {
      storage.getState().applyLocalSettings({ [name]: value });
    },
    [name]
  );
  const value = useLocalSetting(name);
  return [value, setValue];
}

// Project management hooks
export function useProjects() {
  return storage(useShallow(state => state.getProjects()));
}

export function useProject(projectId: string | null) {
  return storage(useShallow(state => (projectId ? state.getProject(projectId) : null)));
}

export function useProjectForSession(sessionId: string | null) {
  return storage(useShallow(state => (sessionId ? state.getProjectForSession(sessionId) : null)));
}

export function useProjectSessions(projectId: string | null) {
  return storage(useShallow(state => (projectId ? state.getProjectSessions(projectId) : [])));
}

export function useProjectGitStatus(projectId: string | null) {
  return storage(useShallow(state => (projectId ? state.getProjectGitStatus(projectId) : null)));
}

export function useSessionProjectGitStatus(sessionId: string | null) {
  return storage(
    useShallow(state => (sessionId ? state.getSessionProjectGitStatus(sessionId) : null))
  );
}

export function useLocalSetting<K extends keyof LocalSettings>(name: K): LocalSettings[K] {
  return storage(useShallow(state => state.localSettings[name]));
}

export function useAcknowledgedCliVersion(machineId: string | null | undefined): string | undefined {
  return storage(state => (machineId ? state.localSettings.acknowledgedCliVersions[machineId] : undefined));
}

// Artifact hooks
export function useArtifacts(): DecryptedArtifact[] {
  return storage(
    useShallow(state => {
      if (!state.isDataReady) return [];
      // Filter out draft artifacts from the main list
      return Object.values(state.artifacts)
        .filter(artifact => !artifact.draft)
        .sort(compareUpdatedDesc);
    })
  );
}

export function useAllArtifacts(): DecryptedArtifact[] {
  return storage(
    useShallow(state => {
      if (!state.isDataReady) return [];
      // Return all artifacts including drafts
      return Object.values(state.artifacts).sort(compareUpdatedDesc);
    })
  );
}

export function useDraftArtifacts(): DecryptedArtifact[] {
  return storage(
    useShallow(state => {
      if (!state.isDataReady) return [];
      // Return only draft artifacts
      return Object.values(state.artifacts)
        .filter(artifact => artifact.draft === true)
        .sort(compareUpdatedDesc);
    })
  );
}

export function useArtifact(artifactId: string): DecryptedArtifact | null {
  return storage(useShallow(state => state.artifacts[artifactId] ?? null));
}

export function useArtifactsCount(): number {
  return storage(
    useShallow(state => {
      // Count only non-draft artifacts
      return Object.values(state.artifacts).filter(a => !a.draft).length;
    })
  );
}

export function useEntitlement(id: KnownEntitlements): boolean {
  return storage(useShallow(state => state.purchases.entitlements[id] ?? false));
}

export function useRealtimeStatus(): 'disconnected' | 'connecting' | 'reconnecting' | 'connected' | 'error' {
  return storage(useShallow(state => state.realtimeStatus));
}

export function useRealtimeMode(): 'idle' | 'speaking' {
  return storage(useShallow(state => state.realtimeMode));
}

export function useSocketStatus() {
  return storage(
    useShallow(state => ({
      status: state.socketStatus,
      lastConnectedAt: state.socketLastConnectedAt,
      lastDisconnectedAt: state.socketLastDisconnectedAt,
      authError: state.authError,
    }))
  );
}

export function useSessionGitStatus(sessionId: string): GitStatus | null {
  return storage(useShallow(state => state.sessionGitStatus[sessionId] ?? null));
}

export function useIsDataReady(): boolean {
  return storage(useShallow(state => state.isDataReady));
}

export function useProfile() {
  return storage(useShallow(state => state.profile));
}

export function useFriends() {
  return storage(useShallow(state => state.friends));
}

export function useFriendRequests() {
  return storage(
    useShallow(state => {
      // Filter friends to get pending requests (where status is 'pending')
      return Object.values(state.friends).filter(friend => friend.status === 'pending');
    })
  );
}

export function useAcceptedFriends() {
  return storage(
    useShallow(state => {
      return Object.values(state.friends).filter(friend => friend.status === 'friend');
    })
  );
}

export function useFeedItems() {
  return storage(useShallow(state => state.feedItems));
}
export function useFeedLoaded() {
  return storage(state => state.feedLoaded);
}
export function useFriendsLoaded() {
  return storage(state => state.friendsLoaded);
}

export function useFriend(userId: string | undefined) {
  return storage(useShallow(state => (userId ? state.friends[userId] : undefined)));
}

export function useUser(userId: string | undefined) {
  return storage(useShallow(state => (userId ? state.users[userId] : undefined)));
}

export function useRequestedFriends() {
  return storage(
    useShallow(state => {
      // Filter friends to get sent requests (where status is 'requested')
      return Object.values(state.friends).filter(friend => friend.status === 'requested');
    })
  );
}

export function useSessionSendError(sessionId: string) {
  return storage(state => state.sessionSendErrors[sessionId] ?? null);
}

export function useSessionQueuedMessages(sessionId: string): QueuedMessage[] {
  return storage(
    useShallow(state => (state.sessions[sessionId]?.queuedMessages ?? emptyArray) as QueuedMessage[])
  );
}
