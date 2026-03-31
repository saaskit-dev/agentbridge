import { kvStore } from './cachedKVStore';
import { LocalSettings, localSettingsDefaults, localSettingsParse } from './localSettings';
import { messageDB } from './messageDB';
import { Profile, profileDefaults, profileParse } from './profile';
import { Purchases, purchasesDefaults, purchasesParse } from './purchases';
import { coerceAgentType, type AppAgentFlavor } from './agentFlavor';
import { parseWorktreeBranchBinding, type WorktreeBranchBinding } from '@/utils/worktreeBranchBinding';
import { Settings, settingsDefaults, settingsParse, SettingsSchema } from './settings';
import type { PermissionMode } from './sessionCapabilities';
import { Logger, toError } from '@saaskit-dev/agentbridge/telemetry';

const logger = new Logger('app/sync/persistence');

const NEW_SESSION_DRAFT_KEY = 'new-session-draft-v1';

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

export async function clearPersistence() {
  kvStore.clearAll();
  await messageDB.deleteAll();
}
