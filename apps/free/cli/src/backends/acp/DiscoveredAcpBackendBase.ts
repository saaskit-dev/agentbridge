import { basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { SessionConfigOption } from '@agentclientprotocol/sdk';
import type { PromptContentBlock } from '@saaskit-dev/agentbridge';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';
import { safeStringify } from '@saaskit-dev/agentbridge';
import { setAcpSessionId } from '@/telemetry';
import { PushableAsyncIterable } from '@/utils/PushableAsyncIterable';
import { CHANGE_TITLE_INSTRUCTION } from '@/gemini/constants';
import type { AgentBackend as IAgentBackend, AgentMessage } from '@/agent';
import {
  AgentBackend,
  AgentStartOpts,
  BackendExitInfo,
  LocalAttachment,
  SessionResumeError,
} from '@/daemon/sessions/AgentBackend';
import type { SessionCapabilities } from '@/daemon/sessions/capabilities';
import type { AgentType, NormalizedMessage } from '@/daemon/sessions/types';
import { createNormalizedEvent } from '@/daemon/sessions/types';
import type { CapabilityAwareAcpBackend } from '@/backends/acp/types';
import type { PermissionMode } from '@/api/types';
import type { ApiSessionClient } from '@/api/apiSession';
import {
  applyCapabilitySelection,
  getModeConfigOptionId,
  getModelConfigOptionId,
  mapAcpSessionCapabilities,
  mergeAcpSessionCapabilities,
} from '@/backends/acp/mapAcpSessionCapabilities';
import { createFreeMcpServerConfig } from '@/backends/acp/createFreeMcpServerConfig';
import { getDefaultDiscoveredModelId, hasDiscoveredModel } from '@/backends/acp/modelSelection';
import { AcpPermissionHandler } from '@/backends/acp/AcpPermissionHandler';
import { getAgentModeForPermission } from '@/backends/acp/permissionModeMapping';

type ProtocolCurrentModeUpdate = {
  sessionUpdate: 'current_mode_update';
  currentModeId?: string;
  modeId?: string;
};

function getCurrentModeUpdateId(update: ProtocolCurrentModeUpdate): string | null {
  return update.currentModeId ?? update.modeId ?? null;
}

export abstract class DiscoveredAcpBackendBase implements AgentBackend {
  abstract readonly agentType: AgentType;
  readonly output = new PushableAsyncIterable<NormalizedMessage>();
  readonly capabilities = new PushableAsyncIterable<SessionCapabilities>();
  exitInfo?: BackendExitInfo;

  protected acpBackend: IAgentBackend | null = null;
  protected capabilityBackend: CapabilityAwareAcpBackend | null = null;
  protected acpSessionId: string | null = null;
  protected initialModel: string | null = null;
  protected initialMode: string | null = null;
  protected isFirstMessage = true;
  protected capabilitiesSnapshot: SessionCapabilities = {};
  protected publishedCapabilitiesSnapshot: SessionCapabilities = {};
  private lastPublishedCapabilitiesJson: string | null = null;
  protected appliedModeSelection: string | null = null;
  protected appliedModelSelection: string | null = null;
  protected desiredConfigSelections = new Map<string, string>();
  protected permissionHandler: AcpPermissionHandler | null = null;
  protected requestedPermissionMode: PermissionMode = 'accept-edits';
  private resumeSessionId: string | null = null;
  private requireResumeSuccess = false;
  private startCwd: string = '';
  private startMcpServerUrl: string = '';
  private onSessionIdResolved: ((id: string) => void) | null = null;

  /** Last native mode applied due to permission mode change (avoid redundant setSessionMode calls) */
  private lastAppliedPermissionNativeMode: string | null = null;
  /** True when the current agent mode was explicitly set by the user via the mode picker */
  private modeSetByUser = false;

  /**
   * Per-turn trace ID for ACP backends.
   *
   * ACP backends (Codex, Gemini, OpenCode, etc.) don't natively produce traceIds.
   * Without traceId, the App reducer cannot distinguish turn boundaries and merges
   * text from different turns into a single block, breaking the interleaving of
   * text and tool-call cards.
   *
   * A new traceId is generated at the start of each sendMessage() call (= one turn).
   * All NormalizedMessages emitted during that turn share the same traceId, allowing
   * the reducer to correctly separate text blocks across turns.
   */
  private currentTurnTraceId: string = randomUUID();
  /**
   * True while loadSession() is in progress. ACP backends (OpenCode) emit historical
   * session messages as notifications during loadSession — these must be suppressed so
   * they are not forwarded to the server as new messages, which would cause the full
   * conversation history to appear again after every resume.
   */
  private isLoadingSession = false;
  /** True when at least one model-output was emitted during the current turn. */
  private hadModelOutputThisTurn = false;
  /**
   * Buffered `status: idle` message waiting to be flushed after `ready`.
   * ACP backends emit `status: idle` before `ready` (because idle triggers
   * waitForResponseComplete, and ready is pushed afterwards). Buffering idle
   * ensures AgentSession sees `ready` first and doesn't synthesize a duplicate.
   */
  private pendingIdleMessage: NormalizedMessage | null = null;

  constructor(protected readonly logger: Logger) {}

  protected abstract createAcpBackend(opts: AgentStartOpts): IAgentBackend;
  protected abstract mapRawMessage(msg: AgentMessage): NormalizedMessage | null;

  protected getRequestedInitialModel(opts: AgentStartOpts): string | null {
    return opts.model ?? null;
  }

  protected buildPrompt(text: string, attachments?: LocalAttachment[]): PromptContentBlock[] {
    const blocks: PromptContentBlock[] = [];

    // Image attachments first (most models process images before text)
    for (const att of attachments ?? []) {
      blocks.push({
        type: 'resource_link',
        uri: `file://${att.localPath}`,
        mimeType: att.mimeType,
        name: basename(att.localPath),
      });
    }

    const finalText = this.isFirstMessage ? `${text}\n\n${CHANGE_TITLE_INSTRUCTION}` : text;
    blocks.push({ type: 'text', text: finalText });
    return blocks;
  }

  protected buildFreeMcpServers(opts: AgentStartOpts) {
    if (!opts.mcpServerUrl) {
      return undefined;
    }

    return {
      free: createFreeMcpServerConfig(opts.mcpServerUrl),
    };
  }

  async start(opts: AgentStartOpts): Promise<void> {
    this.requestedPermissionMode = opts.permissionMode ?? 'accept-edits';
    this.permissionHandler = new AcpPermissionHandler(
      opts.session,
      this.agentType,
      () => this.capabilitiesSnapshot.modes?.current ?? null,
      this.requestedPermissionMode
    );

    // Clear any stale pending requests from server state (recovery scenario).
    // This ensures the new permissionHandler's empty pendingRequests Map
    // is consistent with the server's agentState.requests.
    opts.session.updateAgentState(currentState => ({
      ...currentState,
      requests: {}, // Clear pending, preserve completedRequests
    }));

    const backend = this.createAcpBackend(opts);

    this.acpBackend = backend;
    this.capabilityBackend = backend as CapabilityAwareAcpBackend;
    this.initialModel = this.getRequestedInitialModel(opts);
    this.initialMode = opts.mode ?? null;
    this.appliedModelSelection = null;
    this.appliedModeSelection = null;
    this.lastAppliedPermissionNativeMode = null;
    this.modeSetByUser = false;
    this.capabilitiesSnapshot = {};
    this.publishedCapabilitiesSnapshot = {};
    this.isFirstMessage = true;
    this.desiredConfigSelections.clear();
    this.resumeSessionId = opts.resumeSessionId ?? null;
    this.requireResumeSuccess = opts.requireResumeSuccess === true;
    this.startCwd = opts.cwd;
    this.startMcpServerUrl = opts.mcpServerUrl;
    this.onSessionIdResolved = opts.onSessionIdResolved ?? null;

    backend.onMessage((msg: AgentMessage) => {
      // Suppress messages while loadSession() is in progress. ACP backends replay
      // historical messages as notifications during session load — forwarding them
      // would cause the entire conversation history to re-appear in the App.
      if (this.isLoadingSession) return;

      if (msg.type === 'model-output') {
        this.hadModelOutputThisTurn = true;
      }

      if (process.env.APP_ENV === 'development') {
        this.logger.debug(`[${this.agentType}] raw message`, { raw: msg });
      }
      const normalized = this.mapRawMessage(msg);
      if (normalized) {
        // Inject per-turn traceId so the App reducer can distinguish turn boundaries.
        if (!normalized.traceId) {
          normalized.traceId = this.currentTurnTraceId;
        }
        // Buffer status:idle — it must be emitted AFTER ready so AgentSession's
        // synthesis guard (emittedReadyThisTurn check) fires on the real ready
        // event and doesn't produce a duplicate synthetic one.
        if (
          normalized.role === 'event' &&
          (normalized.content as any).type === 'status' &&
          (normalized.content as any).state === 'idle'
        ) {
          this.pendingIdleMessage = normalized;
        } else {
          this.output.push(normalized);
        }
      }

      // When the child process exits, the ACP backend emits status:'stopped'.
      // End the output stream so pipeBackendOutput terminates and AgentSession
      // can detect the crash and restart the backend.
      if (msg.type === 'status' && msg.status === 'stopped') {
        this.logger.warn(`[${this.agentType}] backend process stopped, ending output stream`, {
          detail: msg.detail,
        });
        this.exitInfo = {
          reason: msg.detail ?? 'process stopped',
        };
        if (!this.output.done) {
          this.output.end();
        }
        if (!this.capabilities.done) {
          this.capabilities.end();
        }
      }
    });

    this.capabilityBackend.onSessionStarted?.(response => {
      this.logger.info(`[${this.agentType}] ACP session started`, {
        requestedInitialModel: this.initialModel,
        requestedInitialMode: this.initialMode,
        discoveredModelCurrent: response.models?.currentModelId ?? null,
        discoveredModelCount: response.models?.availableModels.length ?? 0,
        discoveredModeCurrent: response.modes?.currentModeId ?? null,
        discoveredModeCount: response.modes?.availableModes.length ?? 0,
        configOptionCount: response.configOptions?.length ?? 0,
      });
      this.publishCapabilities(mapAcpSessionCapabilities(response));
    });

    this.capabilityBackend.onSessionUpdate?.(update => {
      const protocolUpdate = update as typeof update & ProtocolCurrentModeUpdate;
      this.logger.info(`[${this.agentType}] ACP session update`, {
        sessionUpdate: update.sessionUpdate ?? null,
        currentModeId:
          update.sessionUpdate === 'current_mode_update'
            ? getCurrentModeUpdateId(protocolUpdate)
            : undefined,
        configOptionCount:
          'configOptions' in update && Array.isArray(update.configOptions)
            ? update.configOptions.length
            : undefined,
        commandCount:
          'availableCommands' in update && Array.isArray(update.availableCommands)
            ? update.availableCommands.length
            : undefined,
      });
      this.publishCapabilities(mergeAcpSessionCapabilities(this.capabilitiesSnapshot, update));
    });

    this.logger.info(`[${this.agentType}] backend started`, {
      cwd: opts.cwd,
      model: opts.model ?? null,
      mode: opts.mode ?? null,
      startingMode: opts.startingMode ?? null,
      permissionMode: this.requestedPermissionMode,
      permissionHandlerAttached: this.permissionHandler != null,
    });
  }

  async sendMessage(
    text: string,
    permissionMode?: PermissionMode,
    attachments?: LocalAttachment[]
  ): Promise<void> {
    // New turn → new traceId. All messages emitted during this turn share this ID,
    // enabling the App reducer to correctly separate text blocks across turns.
    this.currentTurnTraceId = randomUUID();
    this.hadModelOutputThisTurn = false;

    const newPermissionMode = permissionMode ?? this.requestedPermissionMode;
    // When the App explicitly sends a new permission mode, it takes precedence over
    // user-driven agent mode selection — clear the flag so forward mapping can apply.
    if (permissionMode && permissionMode !== this.requestedPermissionMode) {
      this.modeSetByUser = false;
    }
    this.requestedPermissionMode = newPermissionMode;
    this.permissionHandler?.setRequestedPermissionMode(this.requestedPermissionMode);

    // Forward mapping: sync permission mode → agent native mode.
    // Awaited so the agent switches mode before receiving the prompt.
    // Errors are caught — the handler safety net ensures correct behavior regardless.
    if (this.acpSessionId && !this.modeSetByUser) {
      try {
        await this.applyPermissionModeToAgent(this.requestedPermissionMode);
      } catch (err) {
        this.logger.warn(`[${this.agentType}] permission mode forward mapping failed`, {
          error: safeStringify(err),
        });
      }
    }

    if (!this.acpBackend) {
      this.logger.error(`[${this.agentType}] sendMessage called before start()`);
      return;
    }

    if (this.resumeSessionId && !this.acpSessionId) {
      this.isFirstMessage = false;
    }

    const prompt = this.buildPrompt(text, attachments);
    this.isFirstMessage = false;

    this.logger.info(`[${this.agentType}] sending message with permission context`, {
      permissionMode: this.requestedPermissionMode,
      permissionHandlerAttached: this.permissionHandler != null,
      isFirstAcpPrompt: this.acpSessionId == null,
      turnTraceId: this.currentTurnTraceId,
    });

    if (!this.acpSessionId) {
      const { sessionId, resumed } = await this.resolveAcpSession();
      this.acpSessionId = sessionId;
      setAcpSessionId(sessionId);
      this.logger.info(`[${this.agentType}] session ${resumed ? 'resumed' : 'created'}`, {
        resumed,
        requestedInitialModel: this.initialModel,
        requestedInitialMode: this.initialMode,
      });
      await this.applyInitialModeIfNeeded(sessionId);
      await this.applyInitialModelIfNeeded(sessionId);
      await this.applyInitialConfigSelectionsIfNeeded(sessionId);
    }

    this.logger.debug(`[${this.agentType}] sending prompt`, {
      preview: text.slice(0, 100),
      attachmentCount: attachments?.length ?? 0,
      blockCount: prompt.length,
    });
    try {
      // Inject W3C traceparent into ACP _meta for cross-tool trace interop.
      // Format: 00-{traceId32hex}-{parentId16hex}-{flags}
      // parent-id must be a freshly generated random 8-byte (16 hex char) value per W3C spec.
      const traceIdHex = this.currentTurnTraceId.replace(/-/g, '');
      const parentIdHex = randomUUID().replace(/-/g, '').substring(0, 16);
      const traceparent = `00-${traceIdHex}-${parentIdHex}-01`;

      await this.acpBackend.sendPrompt(this.acpSessionId, prompt, {
        _meta: { traceparent },
      });
      await this.acpBackend.waitForResponseComplete?.();
    } catch (err) {
      // Response complete timeout means the agent went silent — a cancel was
      // already sent, the child process may still be alive.  Don't set exitInfo
      // so AgentSession doesn't treat it as a crash.
      const isTimeout = err instanceof Error && err.message.includes('timed out');
      if (!isTimeout) {
        this.exitInfo = {
          reason: `sendPrompt/waitForResponseComplete failed: ${safeStringify(err)}`,
          error: err instanceof Error ? err : undefined,
        };
      }
      throw err;
    }
    const stopReason = this.acpBackend.getLastStopReason?.() ?? undefined;
    this.logger.debug(`[${this.agentType}] response complete`, { stopReason });
    if (!this.hadModelOutputThisTurn) {
      this.logger.warn(`[${this.agentType}] response complete with no model-output emitted`, {
        stopReason,
        turnTraceId: this.currentTurnTraceId,
      });
    }
    // Push ready FIRST so AgentSession sees it before status:idle (which was buffered
    // in onMessage). This prevents AgentSession from emitting a duplicate synthetic ready.
    this.output.push(createNormalizedEvent({ type: 'ready', stopReason }));
    // Now flush the buffered idle so downstream consumers see the correct ordering.
    if (this.pendingIdleMessage) {
      this.output.push(this.pendingIdleMessage);
      this.pendingIdleMessage = null;
    }
  }

  /**
   * Resolve the ACP session ID: resume an existing session if the backend supports it,
   * otherwise start a new one. Calls onSessionIdResolved so AgentSession can persist the ID.
   *
   * Always calls startSession() first to initialize the connection and discover agent
   * capabilities. Then, if a resumeSessionId is available and the agent supports loadSession,
   * attempts to replace the session with the resumed one.
   */
  private async resolveAcpSession(): Promise<{ sessionId: string; resumed: boolean }> {
    // Step 1: Always startSession to initialize the connection, spawn the agent process,
    // and discover capabilities (agentCapabilities is null until initialize completes).
    const { sessionId: freshSessionId } = await this.acpBackend!.startSession();

    // Step 2: If we have a resumeSessionId and the agent supports loadSession,
    // attempt to load the previous session (replacing the fresh one).
    if (this.resumeSessionId && this.capabilityBackend?.supportsLoadSession?.()) {
      this.logger.info(`[${this.agentType}] attempting session resume via loadSession`, {
        resumeSessionId: this.resumeSessionId,
        freshSessionId,
      });
      this.isLoadingSession = true;
      try {
        const { sessionId } = await this.capabilityBackend.loadSession!(
          this.resumeSessionId,
          this.startCwd,
          this.buildMcpServersArray()
        );
        this.onSessionIdResolved?.(sessionId);
        return { sessionId, resumed: true };
      } catch (err) {
        this.logger.warn(`[${this.agentType}] loadSession failed`, {
          resumeSessionId: this.resumeSessionId,
          freshSessionId,
          error: safeStringify(err),
        });
        if (this.requireResumeSuccess) {
          throw new SessionResumeError(
            this.agentType,
            this.resumeSessionId,
            err instanceof Error ? err.message : safeStringify(err)
          );
        }
      } finally {
        this.isLoadingSession = false;
      }
    }

    // Fall through: use the fresh session from startSession()
    this.onSessionIdResolved?.(freshSessionId);
    return { sessionId: freshSessionId, resumed: false };
  }

  /** Convert the MCP server URL into the array format expected by loadSession. */
  private buildMcpServersArray():
    | Array<{ name: string; command: string; args?: string[]; env?: Record<string, string> }>
    | undefined {
    if (!this.startMcpServerUrl) return undefined;
    const config = createFreeMcpServerConfig(this.startMcpServerUrl);
    if ('command' in config) {
      return [{ name: 'free', command: config.command, args: config.args }];
    }
    return undefined;
  }

  async resolveSession(): Promise<string> {
    if (this.acpSessionId) {
      return this.acpSessionId;
    }
    const { sessionId } = await this.resolveAcpSession();
    this.acpSessionId = sessionId;
    setAcpSessionId(sessionId);
    return sessionId;
  }

  async abort(): Promise<void> {
    if (this.acpBackend && this.acpSessionId) {
      await this.acpBackend
        .cancel(this.acpSessionId)
        .catch((err: unknown) =>
          this.logger.warn(`[${this.agentType}] cancel error`, { error: safeStringify(err) })
        );
    }
  }

  async stop(): Promise<void> {
    await this.abort();
    this.permissionHandler?.reset();
    await this.acpBackend?.dispose().catch((err: unknown) => {
      this.logger.warn(`[${this.agentType}] dispose error`, { error: safeStringify(err) });
      this.exitInfo = { reason: `dispose error: ${safeStringify(err)}` };
    });
    if (!this.exitInfo) {
      this.exitInfo = { reason: 'stopped gracefully' };
    }
    this.logger.info(`[${this.agentType}] backend stopped`, {
      reason: this.exitInfo.reason,
    });
    if (!this.capabilities.done) {
      this.capabilities.end();
    }
    if (!this.output.done) {
      this.output.end();
    }
  }

  onSessionChange(newSession: ApiSessionClient): void {
    this.permissionHandler?.updateSession(newSession);
  }

  getCurrentModel(): string | null {
    return (
      this.publishedCapabilitiesSnapshot.models?.current ??
      this.capabilitiesSnapshot.models?.current ??
      this.appliedModelSelection ??
      this.initialModel ??
      null
    );
  }

  async setModel(modelId: string): Promise<void> {
    this.initialModel = modelId;
    this.appliedModelSelection = modelId;

    if (!this.capabilityBackend) {
      return;
    }

    const modelOptionId = getModelConfigOptionId(this.capabilitiesSnapshot);

    if (!this.acpSessionId) {
      this.logger.info(`[${this.agentType}] deferred model selection until ACP session creation`, {
        modelId,
        modelOptionId,
      });
      if (this.capabilitiesSnapshot.models) {
        this.publishOptimisticCapabilities({
          modelId,
          ...(modelOptionId ? { optionId: modelOptionId, value: modelId } : {}),
        });
      }
      return;
    }

    this.logger.info(`[${this.agentType}] applying runtime model selection`, {
      modelId,
      modelOptionId,
    });
    await this.applyModelSelection(this.acpSessionId, modelId, modelOptionId);
  }

  async setMode(modeId: string): Promise<void> {
    this.initialMode = modeId;
    this.appliedModeSelection = modeId;
    // User explicitly selected this mode via the mode picker — don't override with permission mapping
    this.modeSetByUser = true;

    if (!this.capabilityBackend) {
      return;
    }

    if (!this.acpSessionId) {
      this.logger.info(`[${this.agentType}] deferred mode selection until ACP session creation`, {
        modeId,
      });
      return;
    }

    this.logger.info(`[${this.agentType}] applying runtime mode selection`, {
      modeId,
    });
    await this.applyModeSelection(this.acpSessionId, modeId);
  }

  async setConfig(optionId: string, value: string): Promise<void> {
    this.desiredConfigSelections.set(optionId, value);

    if (!this.capabilityBackend) {
      return;
    }

    if (!this.acpSessionId) {
      this.logger.info(`[${this.agentType}] deferred config selection until ACP session creation`, {
        optionId,
        value,
      });
      this.publishCapabilities(
        applyCapabilitySelection(this.capabilitiesSnapshot, {
          optionId,
          value,
        })
      );
      return;
    }

    // If this config option is the model selector, route through setModel so that
    // setSessionModel (the actual runtime model switch) is also called, not just
    // setSessionConfigOption (which only updates the UI config state).
    const modelOptionId = getModelConfigOptionId(this.capabilitiesSnapshot);
    if (optionId === modelOptionId) {
      await this.setModel(value);
      return;
    }

    const response = await this.capabilityBackend.setSessionConfigOption?.(
      this.acpSessionId,
      optionId,
      value
    );
    if (response?.configOptions) {
      this.publishCapabilities(
        mergeAcpSessionCapabilities(this.capabilitiesSnapshot, {
          sessionUpdate: 'config_option_update',
          configOptions: response.configOptions,
        })
      );
      return;
    }
    this.publishOptimisticCapabilities({
      optionId,
      value,
    });
  }

  protected getPermissionHandler(): AcpPermissionHandler | null {
    return this.permissionHandler;
  }

  /**
   * Forward mapping: sync our permission mode to the agent's native mode.
   * Only applies when the mode wasn't explicitly set by the user via the mode picker.
   */
  private async applyPermissionModeToAgent(permissionMode: PermissionMode): Promise<void> {
    const availableModes = (this.capabilitiesSnapshot.modes?.available ?? []).map(m => m.id);
    const targetMode = getAgentModeForPermission(this.agentType, permissionMode, availableModes);

    if (!targetMode || targetMode === this.lastAppliedPermissionNativeMode) {
      return;
    }

    // Don't apply if the agent is already in this mode
    if (targetMode === this.capabilitiesSnapshot.modes?.current) {
      this.lastAppliedPermissionNativeMode = targetMode;
      return;
    }

    this.logger.info(`[${this.agentType}] forward-mapping permission mode to agent mode`, {
      permissionMode,
      targetMode,
      previousNativeMode: this.lastAppliedPermissionNativeMode,
    });

    try {
      await this.applyModeSelection(this.acpSessionId!, targetMode);
      this.lastAppliedPermissionNativeMode = targetMode;
    } catch (err) {
      this.logger.warn(`[${this.agentType}] failed to apply permission-mapped agent mode`, {
        targetMode,
        error: safeStringify(err),
      });
    }
  }

  async runCommand(commandId: string): Promise<void> {
    if (!this.acpBackend || !this.acpSessionId) {
      return;
    }

    // ACP spec: slash commands are sent as prompts with a `/` prefix
    const slashCommand = commandId.startsWith('/') ? commandId : `/${commandId}`;
    this.logger.debug(`[${this.agentType}] running command`, {
      commandId,
      slashCommand,
    });
    await this.acpBackend.sendPrompt(this.acpSessionId, [{ type: 'text', text: slashCommand }]);
    await this.acpBackend.waitForResponseComplete?.();
  }

  protected publishCapabilities(capabilities: SessionCapabilities): void {
    this.capabilitiesSnapshot = capabilities;

    // Deduplicate: skip publishing when the snapshot hasn't changed.
    // The ACP protocol fires sessionUpdate events frequently (per-message, per-chunk),
    // but most carry identical capability data.
    const serialized = JSON.stringify(capabilities);
    if (serialized === this.lastPublishedCapabilitiesJson) {
      return;
    }
    this.lastPublishedCapabilitiesJson = serialized;

    this.logger.info(`[${this.agentType}] publishing capabilities`, {
      requestedInitialModel: this.initialModel,
      requestedInitialMode: this.initialMode,
      appliedModelSelection: this.appliedModelSelection,
      appliedModeSelection: this.appliedModeSelection,
      discoveredModelCurrent: capabilities.models?.current ?? null,
      discoveredModeCurrent: capabilities.modes?.current ?? null,
    });
    this.publishedCapabilitiesSnapshot = capabilities;
    this.capabilities.push(capabilities);
  }

  protected publishOptimisticCapabilities(selection: {
    modelId?: string;
    modeId?: string;
    optionId?: string;
    value?: string;
  }): void {
    this.publishCapabilities(applyCapabilitySelection(this.capabilitiesSnapshot, selection));
  }

  private async applyInitialModeIfNeeded(sessionId: string): Promise<void> {
    if (!this.initialMode) {
      this.logger.debug(`[${this.agentType}] no initial mode requested`);
      return;
    }

    const requestedMode = this.initialMode;
    const availableModes = this.capabilitiesSnapshot.modes?.available ?? [];
    const currentMode = this.capabilitiesSnapshot.modes?.current ?? null;
    this.logger.info(`[${this.agentType}] evaluating initial mode`, {
      sessionId,
      requestedMode,
      discoveredCurrentMode: currentMode,
      availableModes: availableModes.map(mode => mode.id),
    });

    // Skip if already in the requested mode — avoids "Switching to X (recommended)..."
    // text messages being emitted as agent output on every resume.
    if (currentMode === requestedMode) {
      this.logger.debug(`[${this.agentType}] initial mode already active, skipping`, {
        sessionId,
        requestedMode,
      });
      this.appliedModeSelection = requestedMode;
      return;
    }

    if (availableModes.length > 0 && !availableModes.some(mode => mode.id === requestedMode)) {
      this.logger.warn(`[${this.agentType}] initial mode unavailable, keeping discovered default`, {
        requestedMode,
        currentMode: this.capabilitiesSnapshot.modes?.current ?? null,
      });
      this.initialMode = this.capabilitiesSnapshot.modes?.current ?? null;
      this.appliedModeSelection = this.initialMode;
      return;
    }

    try {
      this.logger.info(`[${this.agentType}] applying initial mode`, {
        sessionId,
        requestedMode,
      });
      await this.applyModeSelection(sessionId, requestedMode);
      this.appliedModeSelection = requestedMode;
      this.modeSetByUser = true;
    } catch (error) {
      this.logger.warn(
        `[${this.agentType}] failed to apply initial mode, keeping discovered default`,
        {
          requestedMode,
          currentMode: this.capabilitiesSnapshot.modes?.current ?? null,
          error: safeStringify(error),
        }
      );
      this.initialMode = this.capabilitiesSnapshot.modes?.current ?? null;
      this.appliedModeSelection = this.initialMode;
    }
  }

  private async applyInitialModelIfNeeded(sessionId: string): Promise<void> {
    if (!this.initialModel || this.initialModel === 'default') {
      this.logger.debug(`[${this.agentType}] no initial model override requested`, {
        requestedModel: this.initialModel ?? null,
      });
      return;
    }

    const requestedModel = this.initialModel;
    const fallbackModelId = getDefaultDiscoveredModelId(this.capabilitiesSnapshot);

    if (
      this.capabilitiesSnapshot.models &&
      !hasDiscoveredModel(this.capabilitiesSnapshot, requestedModel)
    ) {
      if (fallbackModelId) {
        this.publishCapabilities(
          applyCapabilitySelection(this.capabilitiesSnapshot, { modelId: fallbackModelId })
        );
      }
      this.initialModel = fallbackModelId;
      this.appliedModelSelection = fallbackModelId;
      return;
    }

    try {
      const modelOptionId = getModelConfigOptionId(this.capabilitiesSnapshot);
      this.logger.info(`[${this.agentType}] applying initial model`, {
        sessionId,
        requestedModel,
        fallbackModelId,
        modelOptionId,
      });
      await this.applyModelSelection(sessionId, requestedModel, modelOptionId);
    } catch (error) {
      this.logger.warn(`[${this.agentType}] initial model unavailable, falling back`, {
        requestedModel,
        fallbackModelId,
        error: safeStringify(error),
      });
      if (fallbackModelId) {
        this.publishOptimisticCapabilities({ modelId: fallbackModelId });
      }
      this.initialModel = fallbackModelId;
      this.appliedModelSelection = fallbackModelId;
    }
  }

  private async applyInitialConfigSelectionsIfNeeded(sessionId: string): Promise<void> {
    if (!this.desiredConfigSelections.size || !this.capabilityBackend?.setSessionConfigOption) {
      return;
    }

    for (const [optionId, value] of this.desiredConfigSelections.entries()) {
      this.logger.info(`[${this.agentType}] applying initial config selection`, {
        sessionId,
        optionId,
        value,
      });
      const response = await this.capabilityBackend.setSessionConfigOption(
        sessionId,
        optionId,
        value
      );
      if (response?.configOptions) {
        this.publishCapabilities(
          mergeAcpSessionCapabilities(this.capabilitiesSnapshot, {
            sessionUpdate: 'config_option_update',
            configOptions: response.configOptions,
          })
        );
      } else {
        this.publishOptimisticCapabilities({
          optionId,
          value,
        });
      }
    }
  }

  private async applyModeSelection(sessionId: string, modeId: string): Promise<void> {
    const modeOptionId = getModeConfigOptionId(this.capabilitiesSnapshot);

    // Try set_mode first — the direct ACP API for switching mode.
    // If it succeeds, update UI optimistically and skip set_config_option entirely.
    // If it fails, fall back to set_config_option with the mode config option ID.
    if (this.capabilityBackend?.setSessionMode) {
      try {
        await this.capabilityBackend.setSessionMode(sessionId, modeId);
        this.appliedModeSelection = modeId;
        if (this.capabilitiesSnapshot.modes) {
          this.publishOptimisticCapabilities({
            modeId,
            ...(modeOptionId ? { optionId: modeOptionId, value: modeId } : {}),
          });
        }
        return;
      } catch (err) {
        this.logger.debug(
          `[${this.agentType}] setSessionMode failed, falling back to setSessionConfigOption`,
          {
            modeId,
            error: String(err),
          }
        );
      }
    }

    if (modeOptionId && this.capabilityBackend?.setSessionConfigOption) {
      await this.capabilityBackend.setSessionConfigOption(sessionId, modeOptionId, modeId);
      this.appliedModeSelection = modeId;
      if (this.capabilitiesSnapshot.modes) {
        this.publishOptimisticCapabilities({
          modeId,
          optionId: modeOptionId,
          value: modeId,
        });
      }
      return;
    }

    this.logger.warn(
      `[${this.agentType}] mode selection not applied: set_mode unavailable and no mode config option`,
      {
        sessionId,
        modeId,
      }
    );
  }

  private async applyModelSelection(
    sessionId: string,
    modelId: string,
    modelOptionId: string | null
  ): Promise<void> {
    // Try set_model (unstable) first — it's the direct API for switching the runtime model.
    // If it succeeds, update UI optimistically and skip set_config_option entirely.
    // If it fails for any reason (not supported by this connection, account restriction, etc.),
    // fall back to set_config_option, which is the stable ACP RPC that also switches the model.
    if (this.capabilityBackend?.setSessionModel) {
      try {
        await this.capabilityBackend.setSessionModel(sessionId, modelId);
        this.appliedModelSelection = modelId;
        if (this.capabilitiesSnapshot.models) {
          this.publishOptimisticCapabilities({
            modelId,
            ...(modelOptionId ? { optionId: modelOptionId, value: modelId } : {}),
          });
        }
        return;
      } catch (err) {
        this.logger.debug(
          `[${this.agentType}] setSessionModel failed, falling back to setSessionConfigOption`,
          {
            modelId,
            error: String(err),
          }
        );
      }
    }

    // Fallback: set_config_option with the model config option ID.
    // This is the stable ACP RPC; it both switches the model and returns updated config options.
    if (modelOptionId && this.capabilityBackend?.setSessionConfigOption) {
      const response = await this.capabilityBackend.setSessionConfigOption(
        sessionId,
        modelOptionId,
        modelId
      );
      this.appliedModelSelection = modelId;
      if (response?.configOptions) {
        this.publishCapabilities(
          mergeAcpSessionCapabilities(this.capabilitiesSnapshot, {
            sessionUpdate: 'config_option_update',
            configOptions: response.configOptions,
          })
        );
        return;
      }
      if (this.capabilitiesSnapshot.models) {
        this.publishOptimisticCapabilities({
          modelId,
          optionId: modelOptionId,
          value: modelId,
        });
      }
      return;
    }

    this.logger.warn(
      `[${this.agentType}] model selection not applied: set_model unavailable and no model config option`,
      {
        sessionId,
        modelId,
      }
    );
  }
}
