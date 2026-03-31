# RFC-006: ACP 能力发现与动态配置

> Historical note for the `headless-runtime` worktree:
> This RFC documents legacy and current implementation details. It is not the architecture
> source of truth for the refactor. Use `013-free-headless-runtime-architecture.md` first.

- **Status**: Implemented ✅（Phase 1-6 全部完成）
- **Created**: 2026-03-14
- **Implemented**: 2026-03-16

## 背景与问题

### Agent 已经在说了，我们没在听

ACP (Agent Client Protocol) 定义了完整的能力发现机制。Agent 在 `session/new` 响应中返回自身支持的模型、模式、配置项、命令等，并在运行时通过 `session/update` 推送变更。

两大 ACP agent 的实现现状：

| 能力                              | claude-agent-acp | codex-acp |
| --------------------------------- | :--------------: | :-------: |
| models（可用模型列表 + 当前模型） |        ✅        |    ✅     |
| modes（权限/审批模式）            |        ✅        |    ✅     |
| configOptions（统一配置项）       |        ✅        |    ✅     |
| commands（slash 命令发现）        |        ✅        |    ✅     |
| plan（任务计划推送）              |        ✅        |    ✅     |
| usage（token 用量 + 费用）        |        ✅        |    ✅     |

但 agentbridge 当前只消费了 ACP 的消息流（text/tool-call/tool-result），**所有能力元数据全部被丢弃**。

### 硬编码无法维护

App 端 `PermissionModeSelector.tsx` 维护了一个 15 项的 `ModelMode` 枚举，`new/index.tsx` 对每个 agent 硬编码 `validClaudeModes` / `validCodexModes` / `validGeminiModes` 列表。每次 agent 上游更新模型，我们必须同步修改 App 代码并发版。

### 目标

Agent 通过 ACP 协议（或等效方式）报告自身能力 → 能力数据穿透 `AgentBackend → AgentSession → IPC → Server DB → App`，App 动态渲染配置面板。**消灭所有硬编码的模型/模式列表。**

---

## ACP 能力模型概览

> 以下类型来源于 `@agentclientprotocol/sdk@^0.15`

### 会话创建时返回（一次性快照）

`session/new` 响应包含：

```typescript
{
  models?: SessionModelState;    // 可用模型 + 当前选中
  modes?: SessionModeState;      // 可用模式 + 当前选中
  configOptions?: SessionConfigOption[];  // 统一配置项（模型/模式/思考深度等）
}
```

### 运行时推送（增量更新）

通过 `session/update` notification 推送：

| sessionUpdate 类型          | 含义                    |
| --------------------------- | ----------------------- |
| `config_option_update`      | 某个配置项的值发生变化  |
| `current_mode_update`       | 当前模式切换            |
| `available_commands_update` | 可用 slash 命令列表变化 |
| `usage_update`              | token 用量更新          |
| `plan`                      | 任务计划更新            |

### 客户端可调用的设置方法

| RPC 方法                    | 作用           |
| --------------------------- | -------------- |
| `session/set_model`         | 切换模型       |
| `session/set_mode`          | 切换模式       |
| `session/set_config_option` | 修改任意配置项 |

---

## 设计

### 核心原则

1. **能力是状态，不是消息**。能力数据走独立通道，不混入 `NormalizedMessage` 消息流，不进 history ring buffer，不存 `SessionMessage` 表
2. **持久化到 session 表**。App 任何时候打开都能读到当前 session 的能力快照，不依赖 daemon 是否在线
3. **agentbridge 自有类型**。不直接暴露 ACP SDK 类型，定义 agentbridge 层面的 `SessionCapabilities`，ACP 和非 ACP agent 都映射到它

### 1. SessionCapabilities — 统一能力类型

```typescript
// apps/free/cli/src/daemon/sessions/types.ts（新增）

export type ModelInfo = {
  id: string;
  name: string;
  description?: string;
};

export type ModeInfo = {
  id: string;
  name: string;
  description?: string;
};

export type ConfigOption = {
  id: string;
  name: string;
  description?: string;
  category: 'mode' | 'model' | 'thought_level' | (string & {});
  type: 'select';
  options: { value: string; label: string }[];
  currentValue: string;
};

export type AgentCommand = {
  id: string;
  name: string;
  description?: string;
};

export type SessionCapabilities = {
  models?: { available: ModelInfo[]; current: string };
  modes?: { available: ModeInfo[]; current: string };
  configOptions?: ConfigOption[];
  commands?: AgentCommand[];
};
```

**与 ACP 类型的映射关系：**

| ACP SDK 类型                       | agentbridge 类型             | 备注                           |
| ---------------------------------- | ---------------------------- | ------------------------------ |
| `SessionModelState`                | `SessionCapabilities.models` | `ModelId` → `string`           |
| `SessionModeState`                 | `SessionCapabilities.modes`  | `SessionModeId` → `string`     |
| `SessionConfigOption`              | `ConfigOption`               | `SessionConfigSelect` 展平     |
| `AvailableCommandsUpdate.commands` | `AgentCommand[]`             | `CommandInfo` → `AgentCommand` |

### 2. AgentBackend — 新增能力流

```typescript
// apps/free/cli/src/daemon/sessions/AgentBackend.ts（修改）

export interface AgentBackend {
  // ── 已有 ──
  readonly agentType: AgentType;
  start(opts: AgentStartOpts): Promise<void>;
  sendMessage(text: string, permissionMode?: PermissionMode): Promise<void>;
  abort(): Promise<void>;
  stop(): Promise<void>;
  readonly output: PushableAsyncIterable<NormalizedMessage>;
  onSessionChange?(newSession: ApiSessionClient): void;
  sendPtyInput?(data: string): void;
  resizePty?(cols: number, rows: number): void;

  // ── 新增：能力发现 ──

  /** 能力更新流。start() 后推送初始快照，运行时推送增量更新。 */
  readonly capabilities?: PushableAsyncIterable<SessionCapabilities>;

  /** 切换模型。仅支持能力发现的 backend 实现。 */
  setModel?(modelId: string): Promise<void>;

  /** 切换模式。 */
  setMode?(modeId: string): Promise<void>;

  /** 修改任意配置项。 */
  setConfig?(optionId: string, value: string): Promise<void>;

  /** 执行 slash 命令。 */
  runCommand?(commandId: string): Promise<void>;
}
```

**所有新增成员都是 optional**（与 `sendPtyInput?` / `resizePty?` 一致）。不支持能力发现的 backend 不实现即可。

### 3. 各 Backend 实现策略

#### GeminiBackend（ACP 原生）

当前 `GeminiBackend` 调用 `startSession()` 后丢弃了 response 中的 `models` / `modes` / `configOptions`。

改动：

- `start()` 中读取 session response 的能力字段，push 初始 `SessionCapabilities`
- 监听 `session/update` 中的 `config_option_update` / `current_mode_update` / `available_commands_update`，push 增量更新
- 实现 `setModel()` → ACP `session/set_model`
- 实现 `setMode()` → ACP `session/set_mode`
- 实现 `setConfig()` → ACP `session/set_config_option`

#### CodexBackend

当前走 MCP。两个路径：

- **短期**：如果继续走 MCP，在 Backend 内部构建 `SessionCapabilities`（Codex 的模型列表相对稳定）
- **长期**：迁移到 ACP 通道（Codex 有 codex-acp adapter），与 GeminiBackend 统一

#### ClaudeBackend

Claude 走 SDK 直接集成，不走 ACP。

- **短期**：`start()` 中根据 SDK 已知信息构建 `SessionCapabilities`（Claude 模型列表、权限模式列表）
- **长期**：可选择在 Claude 前套 claude-agent-acp adapter，走 ACP 统一通道

#### OpenCodeBackend

与 Codex 类似，短期内部构建，长期迁移 ACP。

### 4. AgentSession — 消费能力流

`AgentSession` 基类已有 `pipeBackendOutput()` 消费 `backend.output`。新增平行的 `pipeBackendCapabilities()`：

```typescript
// AgentSession 基类（伪代码）

private async pipeBackendCapabilities(): Promise<void> {
  if (!this.backend.capabilities) return;

  for await (const caps of this.backend.capabilities) {
    // 1. 广播给已 attach 的本地 CLI 客户端
    this.broadcast({ type: 'capabilities', sessionId: this.sessionId, capabilities: caps });

    // 2. 持久化到 Server DB
    this.session.updateCapabilities(caps);
  }
}
```

`pipeBackendCapabilities()` 与 `pipeBackendOutput()` 在 `start()` 中并行启动。

### 5. IPC 协议扩展

```typescript
// apps/free/cli/src/daemon/ipc/protocol.ts（修改）

// ── Server → Client（新增）──
export type IPCServerMessage =
  | /* ...已有类型... */
  | { type: 'capabilities'; sessionId: string; capabilities: SessionCapabilities };

// ── Client → Server（新增）──
export type IPCClientMessage =
  | /* ...已有类型... */
  | { type: 'set_model'; sessionId: string; modelId: string }
  | { type: 'set_mode'; sessionId: string; modeId: string }
  | { type: 'set_config'; sessionId: string; optionId: string; value: string }
  | { type: 'run_command'; sessionId: string; commandId: string };
```

`IPCServer` 收到 `set_model` 等消息时，路由到对应 `AgentSession`，调用 `backend.setModel()` 等。

### 6. Server 持久化

#### Schema 变更

```prisma
model Session {
  // ...已有字段...
  capabilities          String?   // 加密的 JSON，SessionCapabilities
  capabilitiesVersion   Int       @default(0)
}
```

与 `metadata` / `agentState` 一致的模式：加密存储 + 乐观并发版本号。

#### 新增 Socket 事件

`sessionUpdateHandler.ts` 新增 `update-capabilities` 事件：

```typescript
socket.on('update-capabilities', async (data, callback) => {
  // data: { sid, capabilities (encrypted string), expectedVersion }
  // 逻辑与 update-metadata / update-state 完全一致：
  // 1. findUnique session
  // 2. 版本检查
  // 3. updateMany with version bump
  // 4. eventRouter.emitUpdate 广播给 App
  // 5. callback({ result: 'success', version })
});
```

#### ApiSessionClient 新增方法

```typescript
// apps/free/cli/src/api/apiSession.ts（新增）

updateCapabilities(capabilities: SessionCapabilities): void {
  const encrypted = encryptToWireString(JSON.stringify(capabilities), this.encryptionKey);
  this.socket.emit('update-capabilities', {
    sid: this.sessionId,
    capabilities: encrypted,
    expectedVersion: this.capabilitiesVersion,
    _trace: getWireTrace(),
  });
  this.capabilitiesVersion++;
}
```

### 7. App 端消费

#### 数据获取

App 通过两个路径获取能力：

1. **初始加载**：`GET /v1/sessions/:id` 返回 `capabilities` 字段（加密 JSON），App 解密得到 `SessionCapabilities`
2. **实时更新**：监听 `eventRouter` 广播的 session update（与 metadata/agentState 更新一致的推送机制）

#### 状态管理

```typescript
// App 端（伪代码）

function useSessionCapabilities(sessionId: string): SessionCapabilities | null {
  // 从 sync 层获取 session 的 capabilities 字段
  // 实时监听 socket 更新
}
```

#### UI 渲染

**替换前**（硬编码）：

```typescript
export type ModelMode = 'default' | 'adaptiveUsage' | 'sonnet' | 'opus' | ...;
const validClaudeModes: ModelMode[] = ['default', 'adaptiveUsage', 'sonnet', 'opus'];
```

**替换后**（动态）：

```typescript
const caps = useSessionCapabilities(sessionId);
// caps.models?.available → 渲染模型选择器
// caps.modes?.available → 渲染模式选择器
// caps.configOptions → 渲染通用配置面板
// caps.commands → 渲染命令面板 / slash 提示
```

#### 反向操作（用户在 App 上切换配置）

```
App UI（用户选了 opus）
  → socket emit 'set-model' { sid, modelId: 'opus' }
  → Server 转发给 daemon（通过现有 RPC 通道）
  → AgentSession → backend.setModel('opus')
  → Backend → ACP session/set_model 或 SDK API
  → Agent 确认 → capabilities 更新走正向链路回到 App
```

---

## 数据流总览

### 正向：能力从 Agent 到 App

```
Agent (ACP session/new response + session/update notifications)
  │
  ▼
Backend.capabilities stream
  │  push SessionCapabilities
  ▼
AgentSession.pipeBackendCapabilities()
  ├──▶ IPCServer broadcast { type: 'capabilities' }  →  CLI
  └──▶ apiSession.updateCapabilities()
         │
         ▼
       Server socket 'update-capabilities'
         ├──▶ DB: Session.capabilities = encrypted JSON
         └──▶ eventRouter.emitUpdate → App socket
                                         │
                                         ▼
                                    App: useSessionCapabilities()
                                         │
                                         ▼
                                    动态 UI 渲染
```

### 反向：用户操作从 App 到 Agent

```
App UI (set model / set mode / set config)
  │
  ▼
Server socket → RPC to daemon
  │
  ▼
IPCServer → AgentSession
  │
  ▼
backend.setModel() / setMode() / setConfig()
  │
  ▼
Agent (ACP session/set_model 等)
  │
  ▼
Agent 确认 → 新的 capabilities 推送（走正向链路）
```

---

## Session 创建前的能力获取

用户在 App 的"新建 session"页面需要选择模型，但此时 session 尚未创建、Backend 未启动。

**方案：缓存上一次 session 的能力快照**

- 每个 `(machineId, agentType)` 组合缓存最近一次 session 返回的 `SessionCapabilities`
- 存储位置：`UserKVStore`（已有），key = `caps:{machineId}:{agentType}`
- App 新建 session 时读取缓存作为默认值
- Session 创建后 agent 推送真实能力，UI 刷新

这避免了"为了拿能力列表而创建临时 session"的复杂度。首次使用某 agent 时没有缓存，可 fallback 到一个最小默认值（仅包含 agent 的默认模型）。

---

## 加密

能力数据与 `metadata` / `agentState` 一样走端到端加密。

- Daemon 侧：`encryptToWireString(JSON.stringify(caps), session.encryptionKey)`
- Server 侧：存储加密密文，不解密
- App 侧：解密后使用

这与现有的 session 数据加密模式完全一致，不引入新的加密路径。

---

## 与现有 NormalizedMessage 的关系

|                          | NormalizedMessage               | SessionCapabilities                   |
| ------------------------ | ------------------------------- | ------------------------------------- |
| 语义                     | 事件流（append-only）           | 状态快照（last-writer-wins）          |
| 存储                     | `SessionMessage` 表（每条一行） | `Session.capabilities` 列（单值覆盖） |
| IPC 消息                 | `agent_output` / `history`      | `capabilities`                        |
| App 消费                 | 渲染消息列表                    | 渲染配置面板                          |
| history ring buffer      | ✅ 进入                         | ❌ 不进入                             |
| Server 广播给其他 App 端 | 作为新消息推送                  | 作为 session 元数据更新推送           |

---

## 分阶段实施

### Phase 1：类型定义 + Backend 接口 ✅

- 定义 `SessionCapabilities` 及相关类型 → `daemon/sessions/capabilities.ts`
- 扩展 `AgentBackend` 接口（`capabilities` 流 + `setModel` / `setMode` / `setConfig` / `runCommand`） → `daemon/sessions/AgentBackend.ts`
- 扩展 `IPCClientMessage` / `IPCServerMessage` → `daemon/ipc/protocol.ts`

### Phase 2：GeminiBackend 能力发现（ACP 原生） ✅

- **实际实现**：四个 ACP backend 统一共享 `DiscoveredAcpBackendBase`（551 行），而非仅 GeminiBackend
- `onSessionStarted()` 从 ACP session response 提取 `models` / `modes` / `configOptions` → push `SessionCapabilities`
- `onSessionUpdate()` 监听运行时增量更新（`config_option_update` / `current_mode_update` / `available_commands_update`）
- `setModel()` / `setMode()` / `setConfig()` / `runCommand()` 全部实现，支持 deferred application（agent 未启动时暂存）

### Phase 3：Server 持久化 ✅

- Prisma migration `add_session_capabilities`：`Session` 表新增 `capabilities: String?` + `capabilitiesVersion: Int`
- `sessionUpdateHandler.ts` 新增 `update-capabilities` 事件处理（含版本冲突 re-fetch 逻辑）
- `ApiSessionClient.updateCapabilities()` 实现
- Session REST API 返回 `capabilities` 字段

### Phase 4：App 动态渲染 ✅

- `sessionCapabilities.ts` — 能力预设 + 工具函数（`usesDiscoveredCapabilitiesOnly()`、`getLatestCapabilitiesForAgent()`）
- `sessionCapabilitiesCache.ts` — 两级缓存（MMKV 本地 + 远程 KV store），支持版本冲突协调
- `agentFlavor.ts` — agent 类型映射（`isAcpAgent()`、`getCapabilityPresetFlavor()`）
- 能力缓存替代了原来的 `UserKVStore` 简单 key 方案

### Phase 5：Claude / Codex / OpenCode Backend ✅

- ~~ClaudeBackend 内部构建 `SessionCapabilities`~~
- ~~CodexBackend 内部构建 `SessionCapabilities`（或迁移 ACP）~~
- **实际方案**：通过 RFC-006 统一 ACP Backend，`ClaudeAcpBackend` / `CodexAcpBackend` 全部走 ACP 能力发现，无需 "内部构建" 退化方案

### Phase 6：命令发现 ✅

- `AgentCommand` 在 `SessionCapabilities.commands` 中传递 ✅
- App 端命令面板 / slash 提示联动 ✅
- `runCommand()` 反向链路 ✅

---

## 优先级

**中高** — 消除硬编码模型列表是近期痛点，Phase 1-4 应优先推进。Phase 5-6 可后续迭代。

## 前置条件

- RFC-003（Daemon-Owned Agent Architecture）已完成 ✅
- `sendNormalizedMessage()` 管道已就绪 ✅
- `update-metadata` / `update-state` 乐观并发模式可直接复用 ✅

---

## 附录：ACP 生态能力实测（2026-03-14）

> 以下数据基于实际安装 agent 并通过 ACP stdio 发送 `initialize` + `session/new` 获取的真实响应，
> 以及 claude-agent-acp / codex-acp 源码逐行审计。非推测。

### 测试方法

- 编写 ACP probe 脚本（`/tmp/probe-single.mjs`），向 agent 发送 JSON-RPC `initialize` 和 `session/new`，捕获原始响应
- Claude ACP adapter（`@zed-industries/claude-agent-acp@0.21.0`）和 Codex ACP adapter（`@zed-industries/codex-acp@0.10.0`）为源码审计
- Kimi / Qwen 的 `session/new` 因需认证未获得响应，仅有 `initialize` 数据
- Cursor 因打包方式特殊（非标准 bin 入口）未能实测

### 测试环境

| Agent          | 版本                                        | 数据来源              |
| -------------- | ------------------------------------------- | --------------------- |
| Claude ACP     | `@zed-industries/claude-agent-acp@0.21.0`   | 源码审计              |
| Codex ACP      | `@zed-industries/codex-acp@0.10.0`          | 源码审计              |
| Gemini CLI     | `0.33.1` (`gemini --experimental-acp`)      | 实测                  |
| OpenCode       | `1.2.26` (`opencode acp`)                   | 实测                  |
| GitHub Copilot | `1.0.4` (`npx @github/copilot --acp`)       | 实测                  |
| Kimi CLI       | `1.22.0` (`kimi acp`)                       | 实测（仅 initialize） |
| Qwen Code      | `0.12.3` (`npx @qwen-code/qwen-code --acp`) | 实测（仅 initialize） |
| Cursor         | `0.1.0`                                     | 未能实测              |

### A. initialize 能力声明

| 字段                       | Claude | Codex | Gemini | OpenCode | Copilot | Kimi | Qwen |
| -------------------------- | :----: | :---: | :----: | :------: | :-----: | :--: | :--: |
| **loadSession**            |   ✅   |  ✅   |   ✅   |    ✅    |   ✅    |  ✅  |  ✅  |
| **prompt.image**           |   ✅   |  ✅   |   ✅   |    ✅    |   ✅    |  ✅  |  ✅  |
| **prompt.audio**           |   —    |   —   |   ✅   |    —     |   ❌    |  ❌  |  ✅  |
| **prompt.embeddedContext** |   ✅   |  ✅   |   ✅   |    ✅    |   ✅    |  ✅  |  ✅  |
| **mcp.http**               |   ✅   |  ✅   |   ✅   |    ✅    |    —    |  ✅  |  —   |
| **mcp.sse**                |   ✅   |  ❌   |   ✅   |    ✅    |    —    |  ❌  |  —   |
| **sessionCaps.list**       |   ✅   |  ✅   |   —    |    ✅    |   ✅    |  ✅  |  ✅  |
| **sessionCaps.fork**       |   ✅   |   —   |   —    |    ✅    |    —    |  —   |  —   |
| **sessionCaps.resume**     |   ✅   |   —   |   —    |    ✅    |    —    |  ✅  |  ✅  |
| **sessionCaps.close**      |   ✅   |  ✅   |   —    |    —     |    —    |  —   |  —   |

### B. session/new 响应

| 字段              |    Claude     |          Codex          | Gemini | OpenCode |            Copilot             |  Kimi  |  Qwen  |
| ----------------- | :-----------: | :---------------------: | :----: | :------: | :----------------------------: | :----: | :----: |
| **models**        |      ✅       |           ✅            | ✅ 7个 | ✅ 100+  |            ✅ 17个             | 需认证 | 需认证 |
| **modes**         |    ✅ 5个     |           ✅            | ✅ 4个 |  ✅ 4个  |             ✅ 3个             | 需认证 | 需认证 |
| **configOptions** | ✅ mode+model | ✅ mode+model+reasoning | **❌** |  **❌**  | ✅ mode+model+reasoning_effort | 需认证 | 需认证 |

Gemini session/new 实际响应（节选）：

```json
{
  "modes": {
    "availableModes": [
      { "id": "default", "name": "Default", "description": "Prompts for approval" },
      { "id": "autoEdit", "name": "Auto Edit", "description": "Auto-approves edit tools" },
      { "id": "yolo", "name": "YOLO", "description": "Auto-approves all tools" },
      { "id": "plan", "name": "Plan", "description": "Read-only mode" }
    ],
    "currentModeId": "default"
  },
  "models": {
    "availableModels": [
      { "modelId": "auto-gemini-3", "name": "Auto (Gemini 3)" },
      { "modelId": "gemini-3-pro-preview", "name": "gemini-3-pro-preview" },
      { "modelId": "gemini-2.5-pro", "name": "gemini-2.5-pro" },
      ...
    ],
    "currentModelId": "auto-gemini-3"
  }
  // 注意：没有 configOptions 字段
}
```

Copilot session/new 实际响应（节选）：

```json
{
  "modes": { "availableModes": [...], "currentModeId": "...#agent" },
  "models": { "availableModels": [...], "currentModelId": "claude-sonnet-4.6" },
  "configOptions": [
    { "type": "select", "id": "mode", "category": "mode", "currentValue": "...#agent", "options": [...] },
    { "type": "select", "id": "model", "category": "model", "currentValue": "claude-sonnet-4.6", "options": [...] },
    { "type": "select", "id": "reasoning_effort", "category": "thought_level", "currentValue": "medium", "options": [
      { "value": "low", "name": "low" },
      { "value": "medium", "name": "medium" },
      { "value": "high", "name": "high" }
    ]}
  ]
}
```

### C. session/update 通知类型（源码/文档验证）

| 通知类型                  | Claude | Codex | Gemini | OpenCode | Copilot | Kimi | Qwen |
| ------------------------- | :----: | :---: | :----: | :------: | :-----: | :--: | :--: |
| agent_message_chunk       |   ✅   |  ✅   |   ✅   |    ✅    |   ✅    |  ✅  |  ✅  |
| agent_thought_chunk       |   ✅   |  ✅   |   ?    |    ?     |    ?    |  ✅  |  ?   |
| tool_call                 |   ✅   |  ✅   |   ✅   |    ✅    |   ✅    |  ✅  |  ✅  |
| tool_call_update          |   ✅   |  ✅   |   ✅   |    ✅    |    ?    |  ✅  |  ✅  |
| plan                      |   ✅   |  ✅   |   ❌   |    ✅    |    ?    |  ✅  | 部分 |
| available_commands_update |   ✅   |  ✅   |   ✅   |    ✅    |    ?    |  ✅  | 部分 |
| current_mode_update       |   ✅   |  ❌   |   ❌   |    ✅    |    ?    |  ?   |  ?   |
| config_option_update      |   ✅   |  ✅   |   ❌   |    ?     |    ?    |  ?   |  ?   |
| session_info_update       |   ❌   |  ✅   |   ?    |    ?     |    ?    |  ?   |  ?   |
| usage_update              |   ✅   |  ✅   |   ❌   |    ?     |    ?    |  ?   |  ✅  |

### D. 设置方法

| 方法                      | Claude | Codex | Gemini | OpenCode | Copilot | Kimi |  Qwen  |
| ------------------------- | :----: | :---: | :----: | :------: | :-----: | :--: | :----: |
| session/set_model         |   ✅   |  ✅   |  ✅\*  |    ✅    |    ?    |  ?   |   ?    |
| session/set_mode          |   ✅   |  ✅   |   ✅   |    ✅    |    ?    |  ?   | 不生效 |
| session/set_config_option |   ✅   |  ✅   |   ❌   |    ?     |    ?    |  ?   |   ?    |

\* Gemini 的 set*model 带 `unstable*` 前缀

### E. Session 生命周期

| 方法               | Claude | Codex | Gemini | OpenCode | Copilot | Kimi |     Qwen     |
| ------------------ | :----: | :---: | :----: | :------: | :-----: | :--: | :----------: |
| session/list       |   ✅   |  ✅   |   ❌   |    ✅    |    ?    |  ✅  | 格式曾有问题 |
| session/load       |   ✅   |  ✅   |   ✅   |    ✅    |   ✅    |  ✅  |      ?       |
| session/fork       |   ✅   |  ❌   |   ❌   |    ✅    |    ?    |  ?   |      —       |
| session/resume     |   ✅   |  ❌   |   ❌   |    ?     |    ?    |  ?   |      —       |
| session/close      |   ✅   |  ✅   |   ❌   |    ?     |    ?    |  ?   |      —       |
| session/cancel     |   ✅   |  ✅   |   ✅   |    ✅    |   ✅    |  ✅  |      ?       |
| request_permission |   ✅   |  ✅   |   ✅   |    ✅    |   ✅    |  ✅  |      ✅      |

### F. 实现完整度排名

| 排名 | Agent          | 已确认能力 | 接入方式    | 备注                                           |
| :--: | -------------- | :--------: | ----------- | ---------------------------------------------- |
|  1   | **Claude ACP** |   23/24    | Zed adapter | 仅缺 session_info_update                       |
|  2   | **Codex ACP**  |   21/24    | Zed adapter | 缺 fork/resume/current_mode_update             |
|  3   | **OpenCode**   |   ~18/24   | 原生        | session 管理最丰富（含 fork/duplicate/export） |
|  4   | **Copilot**    |   ~15/24   | 原生        | configOptions 最完整（含 reasoning_effort）    |
|  5   | **Kimi**       |   ~14/24   | 原生        | 底层 Wire 协议比 ACP 更丰富                    |
|  6   | **Gemini**     |   ~12/24   | 原生        | "参考实现"但缺 configOptions/usage/plan/list   |
|  7   | **Qwen**       |   ~8/24    | 原生        | 协议兼容性问题最多                             |

### G. 对设计的影响

1. **configOptions 不是共识**。实测 5 个有 session/new 响应的 agent 中，仅 Copilot（原生）和 Claude/Codex（Zed adapter）返回了 `configOptions`。Gemini 和 OpenCode 不返回。`SessionCapabilities` 必须同时兼容"只有 modes+models"和"有 configOptions"两种模式

2. **`sessionCapabilities.list` 已成主流**。7 个 agent 中 6 个声明支持（仅 Gemini 不声明）

3. **`fork` 仍是小众能力**。仅 Claude adapter 和 OpenCode 支持

4. **Gemini 作为"参考实现"并不领先**。缺 configOptions、usage_update、plan、session/list 等重要能力

5. **所有 agent 都声明 `loadSession: true`**。这是最强共识

---

## 实现归档（2026-03-16）

### 实现文件

| 文件                                                 | 用途                                            |
| ---------------------------------------------------- | ----------------------------------------------- |
| `cli/src/daemon/sessions/capabilities.ts`            | `SessionCapabilities` 类型定义                  |
| `cli/src/daemon/sessions/AgentBackend.ts`            | 接口扩展（capabilities stream + set\* 方法）    |
| `cli/src/backends/acp/DiscoveredAcpBackendBase.ts`   | 551 行共享基类，四个 ACP backend 的能力发现核心 |
| `cli/src/backends/acp/mapAcpSessionCapabilities.ts`  | ACP → agentbridge 能力类型映射                  |
| `server/prisma/migrations/add_session_capabilities/` | DB migration                                    |
| `server/src/app/api/socket/sessionUpdateHandler.ts`  | `update-capabilities` 事件处理（L219-316）      |
| `app/sources/sync/sessionCapabilities.ts`            | 能力预设 + 工具函数                             |
| `app/sources/sync/sessionCapabilitiesCache.ts`       | 两级缓存（MMKV + remote KV）                    |
| `app/sources/sync/agentFlavor.ts`                    | agent 类型 → 能力预设映射                       |

### 与原始设计的偏差

1. **共享基类 vs 独立实现**：原设计 Phase 2 仅 GeminiBackend 实现能力发现，Phase 5 其他 backend "内部构建"。实际通过 RFC-006 统一 ACP Backend 后，`DiscoveredAcpBackendBase` 成为四个 ACP backend 的共享基类，Phase 5 的退化方案完全不需要
2. **缓存策略升级**：原设计用 `UserKVStore` 简单 key-value 缓存，实际实现了两级缓存（MMKV 本地 + remote KV store），支持版本冲突协调和 cross-device 同步
3. **能力预设兜底**：新增 `sessionCapabilities.ts` 中的预设（Claude/Codex/Gemini/OpenCode），在缓存未命中时提供合理默认值
4. **`runCommand()` 路径**：原设计未细化，实际在 `DiscoveredAcpBackendBase` 中实现了 deferred application 模式（agent 未启动时暂存命令）
