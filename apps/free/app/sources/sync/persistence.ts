import { kvStore } from './cachedKVStore';
import { LocalSettings, localSettingsDefaults, localSettingsParse } from './localSettings';
import { messageDB } from './messageDB';
import { Profile, profileDefaults, profileParse } from './profile';
import { Purchases, purchasesDefaults, purchasesParse } from './purchases';
import { coerceAgentType, type AppAgentFlavor } from './agentFlavor';
import { parseWorktreeBranchBinding, type WorktreeBranchBinding } from '@/utils/worktreeBranchBinding';
import { Settings, settingsDefaults, settingsParse, SettingsSchema } from './settings';
import { SessionCapabilitiesSchema, type PermissionMode } from './sessionCapabilities';
import {
  AgentStateSchema,
  MetadataSchema,
  type QueuedAttachment,
  type QueuedMessage,
  type Session,
} from './storageTypes';
import { Logger, toError } from '@saaskit-dev/agentbridge/telemetry';

const logger = new Logger('app/sync/persistence');

const NEW_SESSION_DRAFT_KEY = 'new-session-draft-v1';
const SESSION_CACHE_KEY = 'session-cache-v1';
const HANDLED_RECONNECT_TOKEN_KEY = 'handled-reconnect-token-v1';
const PENDING_RECONNECT_ACKS_KEY = 'pending-reconnect-acks-v1';
const REGISTERED_PUSH_TOKEN_KEY = 'registered-push-token-v1';

export type NewSessionAgentType = AppAgentFlavor;
export type NewSessionSessionType = 'simple' | 'worktree';

export interface NewSessionDraft {
  input: string;
  selectedMachineId: string | null;
  selectedPath: string | null;
  agentType: NewSessionAgentType;
  permissionMode: PermissionMode;
  sessionType: NewSessionSessionType;
  /** Optional: how the worktree session should bind to a Git branch (worktree session type only). */
  worktreeBranchBinding?: WorktreeBranchBinding;
  updatedAt: number;
}

export function loadSettings(): { settings: Settings; version: number | null } {
  const settings = kvStore.getString('settings');
  if (settings) {
    try {
      const parsed = JSON.parse(settings);
      return { settings: settingsParse(parsed.settings), version: parsed.version };
    } catch (e) {
      logger.error('Failed to parse settings', toError(e));
      return { settings: { ...settingsDefaults }, version: null };
    }
  }
  return { settings: { ...settingsDefaults }, version: null };
}

export function saveSettings(settings: Settings, version: number) {
  kvStore.set('settings', JSON.stringify({ settings, version }));
}

export function loadPendingSettings(): Partial<Settings> {
  const pending = kvStore.getString('pending-settings');
  if (pending) {
    try {
      const parsed = JSON.parse(pending);
      return SettingsSchema.partial().parse(parsed);
    } catch (e) {
      logger.error('Failed to parse pending settings', toError(e));
      return {};
    }
  }
  return {};
}

export function savePendingSettings(settings: Partial<Settings>) {
  kvStore.set('pending-settings', JSON.stringify(settings));
}

export function loadLocalSettings(): LocalSettings {
  const localSettings = kvStore.getString('local-settings');
  if (localSettings) {
    try {
      const parsed = JSON.parse(localSettings);
      const normalized = localSettingsParse(parsed);
      if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
        saveLocalSettings(normalized);
      }
      return normalized;
    } catch (e) {
      logger.error('Failed to parse local settings', toError(e));
      return { ...localSettingsDefaults };
    }
  }
  return { ...localSettingsDefaults };
}

export function saveLocalSettings(settings: LocalSettings) {
  kvStore.set('local-settings', JSON.stringify(settings));
}

function parseCachedSession(raw: unknown): Session | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const session = raw as Record<string, unknown>;
  const id = typeof session.id === 'string' ? session.id : null;
  const status =
    session.status === 'active' ||
    session.status === 'offline' ||
    session.status === 'archived' ||
    session.status === 'deleted'
      ? session.status
      : null;

  if (!id || !status) {
    return null;
  }

  const metadataResult = MetadataSchema.nullable().safeParse(session.metadata ?? null);
  const agentStateResult = AgentStateSchema.nullable().safeParse(session.agentState ?? null);
  const capabilitiesResult = SessionCapabilitiesSchema.nullable().safeParse(
    session.capabilities ?? null
  );

  if (!metadataResult.success || !agentStateResult.success || !capabilitiesResult.success) {
    return null;
  }

  const parseQueuedAttachments = (value: unknown): QueuedAttachment[] | undefined => {
    if (!Array.isArray(value)) return undefined;
    const attachments: QueuedAttachment[] = [];
    for (const item of value) {
      if (!item || typeof item !== 'object') continue;
      const attachment = item as Record<string, unknown>;
      if (typeof attachment.id !== 'string' || typeof attachment.mimeType !== 'string') {
        continue;
      }
      const parsedAttachment: QueuedAttachment = {
        id: attachment.id,
        mimeType: attachment.mimeType,
      };
      if (typeof attachment.thumbhash === 'string') {
        parsedAttachment.thumbhash = attachment.thumbhash;
      }
      if (typeof attachment.filename === 'string') {
        parsedAttachment.filename = attachment.filename;
      }
      if (typeof attachment.localUri === 'string' || attachment.localUri === null) {
        parsedAttachment.localUri = attachment.localUri;
      }
      attachments.push(parsedAttachment);
    }
    return attachments;
  };

  const parseQueuedMessages = (value: unknown): QueuedMessage[] | undefined => {
    if (!Array.isArray(value)) return undefined;
    const messages: QueuedMessage[] = [];
    for (const item of value) {
      if (!item || typeof item !== 'object') continue;
      const message = item as Record<string, unknown>;
      if (
        typeof message.id !== 'string' ||
        typeof message.text !== 'string' ||
        typeof message.createdAt !== 'number' ||
        typeof message.updatedAt !== 'number'
      ) {
        continue;
      }
      const permissionMode =
        message.permissionMode === 'read-only' ||
        message.permissionMode === 'accept-edits' ||
        message.permissionMode === 'yolo'
          ? message.permissionMode
          : null;
      if (!permissionMode) {
        continue;
      }
      const parsedMessage: QueuedMessage = {
        id: message.id,
        text: message.text,
        createdAt: message.createdAt,
        updatedAt: message.updatedAt,
        permissionMode,
        model: typeof message.model === 'string' || message.model === null ? message.model : null,
        fallbackModel:
          typeof message.fallbackModel === 'string' || message.fallbackModel === null
            ? message.fallbackModel
            : null,
      };
      if (typeof message.displayText === 'string') {
        parsedMessage.displayText = message.displayText;
      }
      const attachments = parseQueuedAttachments(message.attachments);
      if (attachments) {
        parsedMessage.attachments = attachments;
      }
      messages.push(parsedMessage);
    }
    return messages;
  };

  const latestUsageRaw = session.latestUsage;
  const latestUsage =
    latestUsageRaw &&
    typeof latestUsageRaw === 'object' &&
    typeof (latestUsageRaw as Record<string, unknown>).inputTokens === 'number' &&
    typeof (latestUsageRaw as Record<string, unknown>).outputTokens === 'number' &&
    typeof (latestUsageRaw as Record<string, unknown>).cacheCreation === 'number' &&
    typeof (latestUsageRaw as Record<string, unknown>).cacheRead === 'number' &&
    typeof (latestUsageRaw as Record<string, unknown>).contextSize === 'number' &&
    typeof (latestUsageRaw as Record<string, unknown>).timestamp === 'number'
      ? {
          inputTokens: (latestUsageRaw as Record<string, number>).inputTokens,
          outputTokens: (latestUsageRaw as Record<string, number>).outputTokens,
          cacheCreation: (latestUsageRaw as Record<string, number>).cacheCreation,
          cacheRead: (latestUsageRaw as Record<string, number>).cacheRead,
          contextSize: (latestUsageRaw as Record<string, number>).contextSize,
          contextWindowSize:
            typeof (latestUsageRaw as Record<string, unknown>).contextWindowSize === 'number'
              ? (latestUsageRaw as Record<string, number>).contextWindowSize
              : undefined,
          timestamp: (latestUsageRaw as Record<string, number>).timestamp,
        }
      : null;

  return {
    id,
    seq: typeof session.seq === 'number' ? session.seq : 0,
    createdAt: typeof session.createdAt === 'number' ? session.createdAt : 0,
    updatedAt: typeof session.updatedAt === 'number' ? session.updatedAt : 0,
    status,
    activeAt: typeof session.activeAt === 'number' ? session.activeAt : 0,
    metadata: metadataResult.data,
    metadataVersion: typeof session.metadataVersion === 'number' ? session.metadataVersion : 0,
    agentState: agentStateResult.data,
    agentStateVersion:
      typeof session.agentStateVersion === 'number' ? session.agentStateVersion : 0,
    capabilities: capabilitiesResult.data,
    capabilitiesVersion:
      typeof session.capabilitiesVersion === 'number' ? session.capabilitiesVersion : 0,
    thinking: session.thinking === true,
    thinkingAt: typeof session.thinkingAt === 'number' ? session.thinkingAt : 0,
    presence:
      session.presence === 'online'
        ? 'online'
        : typeof session.presence === 'number'
          ? session.presence
          : typeof session.activeAt === 'number'
            ? session.activeAt
            : 0,
    todos: Array.isArray(session.todos) ? (session.todos as Session['todos']) : undefined,
    draft:
      typeof session.draft === 'string' || session.draft === null
        ? (session.draft as string | null)
        : null,
    queuedMessages: parseQueuedMessages(session.queuedMessages) ?? [],
    permissionMode:
      session.permissionMode === 'read-only' ||
      session.permissionMode === 'accept-edits' ||
      session.permissionMode === 'yolo'
        ? session.permissionMode
        : null,
    desiredAgentMode:
      typeof session.desiredAgentMode === 'string' || session.desiredAgentMode === null
        ? (session.desiredAgentMode as string | null)
        : null,
    modelMode:
      typeof session.modelMode === 'string' || session.modelMode === null
        ? (session.modelMode as string | null)
        : null,
    desiredConfigOptions:
      session.desiredConfigOptions &&
      typeof session.desiredConfigOptions === 'object' &&
      !Array.isArray(session.desiredConfigOptions)
        ? (session.desiredConfigOptions as Record<string, string>)
        : null,
    latestUsage,
  };
}

export function loadCachedSessions(): Session[] {
  const raw = kvStore.getString(SESSION_CACHE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as { sessions?: unknown[] } | unknown[];
    const sessions = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.sessions)
        ? parsed.sessions
        : [];
    return sessions
      .map(parseCachedSession)
      .filter((session): session is Session => session !== null);
  } catch (e) {
    logger.error('Failed to parse cached sessions', toError(e));
    return [];
  }
}

export function saveCachedSessions(sessions: Session[]) {
  kvStore.set(
    SESSION_CACHE_KEY,
    JSON.stringify({
      savedAt: Date.now(),
      sessions,
    })
  );
}

let cachedSessionsSaveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingCachedSessions: Session[] | null = null;

export function scheduleSaveCachedSessions(sessions: Session[], delayMs = 150) {
  pendingCachedSessions = sessions;
  if (cachedSessionsSaveTimer) {
    clearTimeout(cachedSessionsSaveTimer);
  }
  cachedSessionsSaveTimer = setTimeout(() => {
    cachedSessionsSaveTimer = null;
    if (!pendingCachedSessions) {
      return;
    }
    const nextSessions = pendingCachedSessions;
    pendingCachedSessions = null;
    saveCachedSessions(nextSessions);
  }, delayMs);
}

export function loadThemePreference(): 'light' | 'dark' | 'adaptive' {
  const localSettings = kvStore.getString('local-settings');
  if (localSettings) {
    try {
      const parsed = JSON.parse(localSettings);
      const settings = localSettingsParse(parsed);
      return settings.themePreference;
    } catch (e) {
      logger.error('Failed to parse local settings for theme preference', toError(e));
      return localSettingsDefaults.themePreference;
    }
  }
  return localSettingsDefaults.themePreference;
}

export function loadPurchases(): Purchases {
  const purchases = kvStore.getString('purchases');
  if (purchases) {
    try {
      const parsed = JSON.parse(purchases);
      return purchasesParse(parsed);
    } catch (e) {
      logger.error('Failed to parse purchases', toError(e));
      return { ...purchasesDefaults };
    }
  }
  return { ...purchasesDefaults };
}

export function savePurchases(purchases: Purchases) {
  kvStore.set('purchases', JSON.stringify(purchases));
}

export function loadSessionDrafts(): Record<string, string> {
  const drafts = kvStore.getString('session-drafts');
  if (drafts) {
    try {
      return JSON.parse(drafts);
    } catch (e) {
      logger.error('Failed to parse session drafts', toError(e));
      return {};
    }
  }
  return {};
}

export function saveSessionDrafts(drafts: Record<string, string>) {
  kvStore.set('session-drafts', JSON.stringify(drafts));
}

export function loadNewSessionDraft(): NewSessionDraft | null {
  const raw = kvStore.getString(NEW_SESSION_DRAFT_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const input = typeof parsed.input === 'string' ? parsed.input : '';
    const selectedMachineId =
      typeof parsed.selectedMachineId === 'string' ? parsed.selectedMachineId : null;
    const selectedPath = typeof parsed.selectedPath === 'string' ? parsed.selectedPath : null;
    const agentType: NewSessionAgentType = coerceAgentType(parsed.agentType);
    const permissionMode: PermissionMode =
      typeof parsed.permissionMode === 'string'
        ? (parsed.permissionMode as PermissionMode)
        : 'accept-edits';
    const sessionType: NewSessionSessionType =
      parsed.sessionType === 'worktree' ? 'worktree' : 'simple';
    const updatedAt = typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now();
    const worktreeBranchBinding = parseWorktreeBranchBinding(parsed.worktreeBranchBinding);

    return {
      input,
      selectedMachineId,
      selectedPath,
      agentType,
      permissionMode,
      sessionType,
      worktreeBranchBinding:
        parsed.worktreeBranchBinding !== undefined ? worktreeBranchBinding : undefined,
      updatedAt,
    };
  } catch (e) {
    logger.error('Failed to parse new session draft', toError(e));
    return null;
  }
}

export function saveNewSessionDraft(draft: NewSessionDraft) {
  kvStore.set(NEW_SESSION_DRAFT_KEY, JSON.stringify(draft));
}

export function clearNewSessionDraft() {
  kvStore.delete(NEW_SESSION_DRAFT_KEY);
}

export function loadSessionPermissionModes(): Record<string, PermissionMode> {
  const modes = kvStore.getString('session-permission-modes');
  if (modes) {
    try {
      return JSON.parse(modes);
    } catch (e) {
      logger.error('Failed to parse session permission modes', toError(e));
      return {};
    }
  }
  return {};
}

export function saveSessionPermissionModes(modes: Record<string, PermissionMode>) {
  kvStore.set('session-permission-modes', JSON.stringify(modes));
}

export function loadSessionDesiredAgentModes(): Record<string, string> {
  const modes = kvStore.getString('session-desired-agent-modes');
  if (modes) {
    try {
      return JSON.parse(modes);
    } catch (e) {
      logger.error('Failed to parse session desired agent modes', toError(e));
      return {};
    }
  }
  return {};
}

export function saveSessionDesiredAgentModes(modes: Record<string, string>) {
  kvStore.set('session-desired-agent-modes', JSON.stringify(modes));
}

export function loadSessionModelModes(): Record<string, string> {
  const modes = kvStore.getString('session-model-modes');
  if (modes) {
    try {
      return JSON.parse(modes);
    } catch (e) {
      logger.error('Failed to parse session model modes', toError(e));
      return {};
    }
  }
  return {};
}

export function saveSessionModelModes(modes: Record<string, string>) {
  kvStore.set('session-model-modes', JSON.stringify(modes));
}

export function loadSessionDesiredConfigOptions(): Record<string, Record<string, string>> {
  const options = kvStore.getString('session-desired-config-options');
  if (options) {
    try {
      return JSON.parse(options);
    } catch (e) {
      logger.error('Failed to parse session desired config options', toError(e));
      return {};
    }
  }
  return {};
}

export function saveSessionDesiredConfigOptions(options: Record<string, Record<string, string>>) {
  kvStore.set('session-desired-config-options', JSON.stringify(options));
}

export function loadProfile(): Profile {
  const profile = kvStore.getString('profile');
  if (profile) {
    try {
      const parsed = JSON.parse(profile);
      return profileParse(parsed);
    } catch (e) {
      logger.error('Failed to parse profile', toError(e));
      return { ...profileDefaults };
    }
  }
  return { ...profileDefaults };
}

export function saveProfile(profile: Profile) {
  kvStore.set('profile', JSON.stringify(profile));
}

// Simple temporary text storage for passing large strings between screens
export function storeTempText(content: string): string {
  const id = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  kvStore.set(`temp_text_${id}`, content);
  return id;
}

export function retrieveTempText(id: string): string | null {
  const content = kvStore.getString(`temp_text_${id}`);
  if (content) {
    // Auto-delete after retrieval
    kvStore.delete(`temp_text_${id}`);
    return content;
  }
  return null;
}

// ── Outbox persistence ──────────────────────────────────────────────

type PersistedOutboxMessage = {
  id: string;
  content: string;
  _trace?: { tid: string; ses?: string; mid?: string };
};

const OUTBOX_KEY = 'pending-outbox-v1';

export function loadPendingOutbox(): Record<string, PersistedOutboxMessage[]> {
  const raw = kvStore.getString(OUTBOX_KEY);
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch (e) {
      logger.error('Failed to parse pending outbox', toError(e));
      return {};
    }
  }
  return {};
}

export function savePendingOutbox(outbox: Record<string, PersistedOutboxMessage[]>) {
  kvStore.set(OUTBOX_KEY, JSON.stringify(outbox));
}

export function clearPendingOutbox() {
  kvStore.delete(OUTBOX_KEY);
}

export function loadHandledReconnectToken(): string | null {
  return kvStore.getString(HANDLED_RECONNECT_TOKEN_KEY) ?? null;
}

export function saveHandledReconnectToken(token: string | null) {
  if (!token) {
    kvStore.delete(HANDLED_RECONNECT_TOKEN_KEY);
    return;
  }
  kvStore.set(HANDLED_RECONNECT_TOKEN_KEY, token);
}

export function loadPendingReconnectAcks(): string[] {
  const raw = kvStore.getString(PENDING_RECONNECT_ACKS_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
  } catch (e) {
    logger.error('Failed to parse pending reconnect acks', toError(e));
    return [];
  }
}

export function savePendingReconnectAcks(tokens: string[]) {
  if (tokens.length === 0) {
    kvStore.delete(PENDING_RECONNECT_ACKS_KEY);
    return;
  }
  kvStore.set(PENDING_RECONNECT_ACKS_KEY, JSON.stringify(tokens));
}

export function loadRegisteredPushToken(): string | null {
  return kvStore.getString(REGISTERED_PUSH_TOKEN_KEY) ?? null;
}

export function saveRegisteredPushToken(token: string | null) {
  if (!token) {
    kvStore.delete(REGISTERED_PUSH_TOKEN_KEY);
    return;
  }
  kvStore.set(REGISTERED_PUSH_TOKEN_KEY, token);
}

export async function clearPersistence() {
  kvStore.clearAll();
  await messageDB.deleteAll();
}
