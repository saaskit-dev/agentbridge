import type { SessionConfigOption } from '@agentclientprotocol/sdk';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';
import { safeStringify } from '@saaskit-dev/agentbridge';
import { PushableAsyncIterable } from '@/utils/PushableAsyncIterable';
import { CHANGE_TITLE_INSTRUCTION } from '@/gemini/constants';
import type { AgentBackend as IAgentBackend, AgentMessage } from '@/agent';
import type { AgentBackend, AgentStartOpts, BackendExitInfo } from '@/daemon/sessions/AgentBackend';
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
import {
  getDefaultDiscoveredModelId,
  hasDiscoveredModel,
} from '@/backends/acp/modelSelection';
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
  protected apiSessionId: string | null = null;

  constructor(protected readonly logger: Logger) {}

  protected abstract createAcpBackend(opts: AgentStartOpts): IAgentBackend;
  protected abstract mapRawMessage(msg: AgentMessage): NormalizedMessage | null;

  protected getRequestedInitialModel(opts: AgentStartOpts): string | null {
    return opts.model ?? null;
  }

  protected buildPrompt(text: string): string {
    return this.isFirstMessage ? `${text}\n\n${CHANGE_TITLE_INSTRUCTION}` : text;
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
    this.apiSessionId = opts.session.sessionId;
    this.currentPermissionMode = opts.permissionMode ?? 'accept-edits';
    this.permissionHandler = new AcpPermissionHandler(
      opts.session,
      this.currentPermissionMode
    );
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

    backend.onMessage((msg: AgentMessage) => {
      if (process.env.APP_ENV === 'development') {
        this.logger.debug(`[${this.agentType}] raw message`, {
          apiSessionId: this.apiSessionId,
          acpSessionId: this.acpSessionId,
          raw: msg,
        });
      }
      const normalized = this.mapRawMessage(msg);
      if (normalized) {
        this.output.push(normalized);
      }
    });

    this.capabilityBackend.onSessionStarted?.((response) => {
      this.logger.info(`[${this.agentType}] ACP session started`, {
        apiSessionId: this.apiSessionId,
        sessionId: response.sessionId,
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

    this.capabilityBackend.onSessionUpdate?.((update) => {
      const protocolUpdate = update as typeof update & ProtocolCurrentModeUpdate;
      this.logger.info(`[${this.agentType}] ACP session update`, {
        apiSessionId: this.apiSessionId,
        acpSessionId: this.acpSessionId,
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
      apiSessionId: this.apiSessionId,
      cwd: opts.cwd,
      model: opts.model ?? null,
      mode: opts.mode ?? null,
      startingMode: opts.startingMode ?? null,
      permissionMode: this.currentPermissionMode,
      permissionHandlerAttached: this.permissionHandler != null,
    });
  }

  async sendMessage(text: string, permissionMode?: PermissionMode): Promise<void> {
    this.currentPermissionMode = permissionMode ?? this.currentPermissionMode;
    this.permissionHandler?.setPermissionMode(this.currentPermissionMode);
    if (!this.acpBackend) {
      this.logger.error(`[${this.agentType}] sendMessage called before start()`);
      return;
    }

    const prompt = this.buildPrompt(text);
    this.isFirstMessage = false;

    this.logger.info(`[${this.agentType}] sending message with permission context`, {
      apiSessionId: this.apiSessionId,
      acpSessionId: this.acpSessionId,
      permissionMode: this.currentPermissionMode,
      permissionHandlerAttached: this.permissionHandler != null,
      isFirstAcpPrompt: this.acpSessionId == null,
    });

    if (!this.acpSessionId) {
      this.logger.debug(`[${this.agentType}] creating session`, { preview: prompt.slice(0, 100) });
      const { sessionId } = await this.acpBackend.startSession();
      this.acpSessionId = sessionId;
      this.logger.info(`[${this.agentType}] session created`, {
        apiSessionId: this.apiSessionId,
        acpSessionId: sessionId,
        requestedInitialModel: this.initialModel,
        requestedInitialMode: this.initialMode,
      });
      await this.applyInitialModeIfNeeded(sessionId);
      await this.applyInitialModelIfNeeded(sessionId);
      await this.applyInitialConfigSelectionsIfNeeded(sessionId);
    }

    this.logger.debug(`[${this.agentType}] sending prompt`, {
      apiSessionId: this.apiSessionId,
      acpSessionId: this.acpSessionId,
      preview: text.slice(0, 100),
    });
    try {
      await this.acpBackend.sendPrompt(this.acpSessionId, prompt);
      await this.acpBackend.waitForResponseComplete?.();
    } catch (err) {
      this.exitInfo = { reason: `sendPrompt/waitForResponseComplete failed: ${safeStringify(err)}`, error: err instanceof Error ? err : undefined };
      throw err;
    }
    this.logger.debug(`[${this.agentType}] response complete`, {
      apiSessionId: this.apiSessionId,
      acpSessionId: this.acpSessionId,
    });
  }

  async abort(): Promise<void> {
    if (this.acpBackend && this.acpSessionId) {
      await this.acpBackend.cancel(this.acpSessionId).catch((err: unknown) =>
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
      apiSessionId: this.apiSessionId,
      acpSessionId: this.acpSessionId,
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
      sessionId: this.acpSessionId,
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
      sessionId: this.acpSessionId,
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
      sessionId: this.acpSessionId,
      commandId,
    });
    await this.acpBackend.sendPrompt(this.acpSessionId, commandId);
    await this.acpBackend.waitForResponseComplete?.();
  }

  protected publishCapabilities(capabilities: SessionCapabilities): void {
    this.logger.info(`[${this.agentType}] publishing capabilities`, {
      acpSessionId: this.acpSessionId,
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
      this.logger.warn(`[${this.agentType}] failed to apply initial mode, keeping discovered default`, {
        requestedMode,
        currentMode: this.capabilitiesSnapshot.modes?.current ?? null,
        error: safeStringify(error),
      });
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
      const response = await this.capabilityBackend.setSessionConfigOption(sessionId, optionId, value);
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

  private async applyModeSelection(
    sessionId: string,
    modeId: string
  ): Promise<void> {
    const modeOptionId = getModeConfigOptionId(this.capabilitiesSnapshot);

    if (modeOptionId && this.capabilityBackend?.setSessionConfigOption) {
      this.logger.info(`[${this.agentType}] applying mode via configOption`, {
        sessionId,
        modeId,
        modeOptionId,
      });
      await this.capabilityBackend.setSessionConfigOption(sessionId, modeOptionId, modeId);
    }

    if (this.capabilityBackend?.setSessionMode) {
      await this.capabilityBackend.setSessionMode(sessionId, modeId);
    }

    this.appliedModeSelection = modeId;

    if (this.capabilitiesSnapshot.modes) {
      this.publishOptimisticCapabilities({
        modeId,
        ...(modeOptionId ? { optionId: modeOptionId, value: modeId } : {}),
      });
    }
  }

  private async applyModelSelection(
    sessionId: string,
    modelId: string,
    modelOptionId: string | null
  ): Promise<void> {
    let configOptionsResponse: SessionConfigOption[] | null | undefined;

    if (modelOptionId && this.capabilityBackend?.setSessionConfigOption) {
      const response = await this.capabilityBackend.setSessionConfigOption(
        sessionId,
        modelOptionId,
        modelId
      );
      configOptionsResponse = response?.configOptions;
    } else if (this.capabilityBackend?.setSessionModel) {
      await this.capabilityBackend.setSessionModel(sessionId, modelId);
    }

    this.appliedModelSelection = modelId;

    if (configOptionsResponse) {
      this.publishCapabilities(
        mergeAcpSessionCapabilities(this.capabilitiesSnapshot, {
          sessionUpdate: 'config_option_update',
          configOptions: configOptionsResponse,
        })
      );
      return;
    }

    if (this.capabilitiesSnapshot.models) {
      this.publishOptimisticCapabilities({
        modelId,
        ...(modelOptionId ? { optionId: modelOptionId, value: modelId } : {}),
      });
    }
  }
}
