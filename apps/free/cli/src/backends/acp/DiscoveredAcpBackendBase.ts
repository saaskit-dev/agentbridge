import { basename } from 'node:path';
import type { SessionConfigOption } from '@agentclientprotocol/sdk';
import type { PromptContentBlock } from '@saaskit-dev/agentbridge';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';
import { safeStringify } from '@saaskit-dev/agentbridge';
import { setAcpSessionId } from '@/telemetry';
import { PushableAsyncIterable } from '@/utils/PushableAsyncIterable';
import { CHANGE_TITLE_INSTRUCTION } from '@/gemini/constants';
import type { AgentBackend as IAgentBackend, AgentMessage } from '@/agent';
import type { AgentBackend, AgentStartOpts, BackendExitInfo, LocalAttachment } from '@/daemon/sessions/AgentBackend';
import type { SessionCapabilities } from '@/daemon/sessions/capabilities';
import type { AgentType, NormalizedMessage } from '@/daemon/sessions/types';
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

type ProtocolCurrentModeUpdate = {
  sessionUpdate: 'current_mode_update';
  modeId?: string;
};

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
  protected appliedModeSelection: string | null = null;
  protected appliedModelSelection: string | null = null;
  protected desiredConfigSelections = new Map<string, string>();
  protected permissionHandler: AcpPermissionHandler | null = null;
  protected currentPermissionMode: PermissionMode = 'accept-edits';
  private resumeSessionId: string | null = null;
  private startCwd: string = '';
  private startMcpServerUrl: string = '';
  private onSessionIdResolved: ((id: string) => void) | null = null;

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
    this.currentPermissionMode = opts.permissionMode ?? 'accept-edits';
    this.permissionHandler = new AcpPermissionHandler(opts.session, this.currentPermissionMode);

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
    this.capabilitiesSnapshot = {};
    this.publishedCapabilitiesSnapshot = {};
    this.isFirstMessage = true;
    this.desiredConfigSelections.clear();
    this.resumeSessionId = opts.resumeSessionId ?? null;
    this.startCwd = opts.cwd;
    this.startMcpServerUrl = opts.mcpServerUrl;
    this.onSessionIdResolved = opts.onSessionIdResolved ?? null;

    backend.onMessage((msg: AgentMessage) => {
      if (process.env.APP_ENV === 'development') {
        this.logger.debug(`[${this.agentType}] raw message`, { raw: msg });
      }
      const normalized = this.mapRawMessage(msg);
      if (normalized) {
        this.output.push(normalized);
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
          update.sessionUpdate === 'current_mode_update' ? protocolUpdate.modeId : undefined,
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
      permissionMode: this.currentPermissionMode,
      permissionHandlerAttached: this.permissionHandler != null,
    });
  }

  async sendMessage(text: string, permissionMode?: PermissionMode, attachments?: LocalAttachment[]): Promise<void> {
    this.currentPermissionMode = permissionMode ?? this.currentPermissionMode;
    this.permissionHandler?.setPermissionMode(this.currentPermissionMode);
    if (!this.acpBackend) {
      this.logger.error(`[${this.agentType}] sendMessage called before start()`);
      return;
    }

    const prompt = this.buildPrompt(text, attachments);
    this.isFirstMessage = false;

    this.logger.info(`[${this.agentType}] sending message with permission context`, {
      permissionMode: this.currentPermissionMode,
      permissionHandlerAttached: this.permissionHandler != null,
      isFirstAcpPrompt: this.acpSessionId == null,
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
      if (resumed) {
        // Skip title injection on a resumed session — it already has a title.
        this.isFirstMessage = false;
      } else {
        await this.applyInitialModeIfNeeded(sessionId);
        await this.applyInitialModelIfNeeded(sessionId);
        await this.applyInitialConfigSelectionsIfNeeded(sessionId);
      }
    }

    this.logger.debug(`[${this.agentType}] sending prompt`, {
      preview: text.slice(0, 100),
      attachmentCount: attachments?.length ?? 0,
      blockCount: prompt.length,
    });
    try {
      await this.acpBackend.sendPrompt(this.acpSessionId, prompt);
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
    this.logger.debug(`[${this.agentType}] response complete`);
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
      try {
        const { sessionId } = await this.capabilityBackend.loadSession!(
          this.resumeSessionId,
          this.startCwd,
          this.buildMcpServersArray()
        );
        this.onSessionIdResolved?.(sessionId);
        return { sessionId, resumed: true };
      } catch (err) {
        this.logger.warn(`[${this.agentType}] loadSession failed, keeping fresh session`, {

          resumeSessionId: this.resumeSessionId,
          freshSessionId,
          error: safeStringify(err),
        });
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
    return [{ name: 'free', command: config.command, args: config.args }];
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

    if (!this.capabilityBackend) {
      return;
    }

    if (!this.acpSessionId) {
      this.logger.info(`[${this.agentType}] deferred mode selection until ACP session creation`, {
        modeId,
      });
      if (this.capabilitiesSnapshot.modes) {
        this.publishOptimisticCapabilities({ modeId });
      }
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

  async runCommand(commandId: string): Promise<void> {
    if (!this.acpBackend || !this.acpSessionId) {
      return;
    }

    this.logger.debug(`[${this.agentType}] running command`, {
      commandId,
    });
    await this.acpBackend.sendPrompt(this.acpSessionId, [{ type: 'text', text: commandId }]);
    await this.acpBackend.waitForResponseComplete?.();
  }

  protected publishCapabilities(capabilities: SessionCapabilities): void {
    this.logger.info(`[${this.agentType}] publishing capabilities`, {
      requestedInitialModel: this.initialModel,
      requestedInitialMode: this.initialMode,
      appliedModelSelection: this.appliedModelSelection,
      appliedModeSelection: this.appliedModeSelection,
      discoveredModelCurrent: capabilities.models?.current ?? null,
      discoveredModeCurrent: capabilities.modes?.current ?? null,
    });
    this.capabilitiesSnapshot = capabilities;
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
    this.logger.info(`[${this.agentType}] evaluating initial mode`, {
      sessionId,
      requestedMode,
      discoveredCurrentMode: this.capabilitiesSnapshot.modes?.current ?? null,
      availableModes: availableModes.map(mode => mode.id),
    });
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
