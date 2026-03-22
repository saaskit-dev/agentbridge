# RFC-003: Daemon-Owned Agent Architecture

- **Status**: Implemented ✅（Phase 1-6 全部完成，440/440 测试通过）
- **Created**: 2026-03-09
- **Implemented**: 2026-03-12
- **Author**: AgentBridge Team

## 背景与问题

### 当前架构的根本缺陷

手机远程控制是核心功能，但当前架构中 Claude 进程由 CLI 拥有：

```
Mobile → Server → WebSocket → CLI 进程 → Claude 子进程
```

CLI 是前台进程，没有守护。CLI crash → Claude 子进程一起死 → 手机端任务静默失败，
没有提示，没有恢复机会。

### 四个 agent 各自重复实现相同逻辑

`runClaude.ts` / `runCodex.ts` / `runGemini.ts` / `runOpenCode.ts` 各自实现了：

- Server session 创建
- 离线重连
- Free MCP server 启动
- 消息循环主体
- Cleanup / graceful shutdown
- Daemon 通知

新增 agent 必须复制全部样板代码，维护成本线性增长。

### 本地模式只有 Claude 有

Codex / Gemini / OpenCode 无法在终端交互使用，功能不对等。

---

## 目标架构

### 核心思想

> **Daemon 是产品核心，所有 UI 都是可替换的客户端。**

```
┌────────────────────────────────────────────────────────────┐
│                  Daemon（systemd / LaunchAgent 保活）        │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  AgentSession<TMode>（基类，共同基础设施）              │  │
│  │  ├── ApiClient + ApiSessionClient                    │  │
│  │  ├── MessageQueue2<TMode>                            │  │
│  │  ├── Free MCP Server                                │  │
│  │  ├── 离线重连（setupOfflineReconnection）             │  │
│  │  ├── Cleanup / graceful shutdown                    │  │
│  │  └── Daemon IPC 广播                                │  │
│  │                                                      │  │
│  │  AgentBackend（每个 agent 实现）                      │  │
│  │  ├── ClaudeBackend   (claudeLocalLauncher + Remote)  │  │
│  │  ├── CodexBackend    (CodexMcpClient)                │  │
│  │  ├── GeminiBackend   (createGeminiBackend)           │  │
│  │  └── OpenCodeBackend (createOpenCodeBackend)         │  │
│  └──────────────────────────────────────────────────────┘  │
│                        ↓ NormalizedMessage                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  IPCServer（Unix socket: ~/.free-dev/daemon.sock）    │  │
│  │  ├── attach/detach 客户端                             │  │
│  │  ├── 历史消息缓冲（环形，每 session 最近 500 条）      │  │
│  │  └── broadcast 到已 attach 的客户端                   │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────┬───────────────────┬───────────────────────────┘
             │ 本地 IPC          │ 经 Server 中转
    ┌────────▼────────┐  ┌───────▼──────────┐
    │   CLI / TUI     │  │   Mobile App     │
    │  CLIRenderer    │  │  MobileRenderer  │
    │  InputHandler   │  │                  │
    └─────────────────┘  └──────────────────┘
```

### 关键边界

| 层                    | 职责                                                   | 不负责             |
| --------------------- | ------------------------------------------------------ | ------------------ |
| **AgentBackend**      | 启动 agent、收发消息、翻译输出为 NormalizedMessage     | 显示、生命周期管理 |
| **AgentSession 基类** | 生命周期、server session、消息队列、离线重连、IPC 广播 | agent 具体协议     |
| **IPCServer**         | 把 NormalizedMessage 广播给已 attach 的客户端          | 渲染               |
| **CLIRenderer**       | 把 NormalizedMessage 渲染到终端，对所有 agent 通用     | agent 逻辑         |

---

## 现有代码关键接口（实现时以此为准）

> 本节是对现有代码的准确描述，所有代码示例均已核对。

### ApiClient

```typescript
// apps/free/cli/src/api/api.ts

// create 的参数名是 credential（单数）
static async create(credential: Credentials): Promise<ApiClient>

// 返回 ApiSessionClient | null，null 表示服务器不可达
async getOrCreateSession(opts: {
  tag: string;
  metadata: Metadata;
  state: AgentState;   // 注意是 AgentState，不是 SessionState
}): Promise<ApiSessionClient | null>
```

类型来源：

- `Credentials` — `apps/free/cli/src/persistence.ts`，包含 `machineId`, `secretKey`, `token` 等
- `Metadata` — `apps/free/cli/src/api/types.ts`
- `AgentState` — `apps/free/cli/src/api/types.ts`

### setupOfflineReconnection

```typescript
// apps/free/cli/src/utils/setupOfflineReconnection.ts
// 新代码统一用这个，不用 serverConnectionErrors.ts 中的底层函数

interface SetupOfflineReconnectionOptions {
  api: ApiClient;
  sessionTag: string;
  metadata: Metadata;
  state: AgentState; // 与 getOrCreateSession 一致，来自 apps/free/cli/src/api/types.ts
  response: ApiSessionClient | null; // getOrCreateSession() 的返回值，null 时进入离线模式
  onSessionSwap: (newSession: ApiSessionClient) => void; // 重连成功、session 切换时回调
}

interface SetupOfflineReconnectionResult {
  session: ApiSessionClient; // 在线时是真实 session，离线时是 offline stub
  reconnectionHandle: OfflineReconnectionHandle | null; // null 表示在线，不需要重连
  isOffline: boolean;
}

function setupOfflineReconnection(
  opts: SetupOfflineReconnectionOptions
): SetupOfflineReconnectionResult;
```

注意：这个函数封装了"在线/离线分支"，`initialize()` 中不需要自己判断 `response === null`，
直接把 `response` 传入，函数内部处理。

### startFreeServer

```typescript
// 文件路径需在 codebase 中确认，通常在 apps/free/cli/src/claude/utils/startFreeServer.ts

async function startFreeServer(client: ApiSessionClient): Promise<{
  url: string; // Free MCP server 的完整 URL，如 "http://localhost:PORT"
  toolNames: string[]; // 如 ['change_title']
  stop: () => void;
}>;
```

### MessageQueue2

```typescript
// apps/free/cli/src/utils/MessageQueue2.ts

class MessageQueue2<T> {
  constructor(modeHasher: (mode: T) => string);

  push(message: string, mode: T): void;
  pushImmediate(message: string, mode: T): void;
  pushIsolateAndClear(message: string, mode: T): void;
  reset(): void;
  close(): void;
  size(): number;

  // 正确的方法名是 waitForMessagesAndGetAsString，不是 waitForMessages
  async waitForMessagesAndGetAsString(abortSignal?: AbortSignal): Promise<{
    message: string;
    mode: T;
    isolate: boolean;
    hash: string;
  } | null>;
}
```

### PushableAsyncIterable

```typescript
// apps/free/cli/src/utils/PushableAsyncIterable.ts
// 只有 push 和 end，没有 pipeTo

class PushableAsyncIterable<T> implements AsyncIterable<T> {
  push(value: T): void; // 推入一条数据
  end(): void; // 结束流，消费者的 for await 循环退出

  [Symbol.asyncIterator](): AsyncIterator<T>;
}
```

### notifyDaemonSessionStarted

```typescript
// apps/free/cli/src/daemon/controlClient.ts
async function notifyDaemonSessionStarted(
  sessionId: string,
  metadata: Metadata
): Promise<{ error?: string } | any>;
// 向 daemon HTTP server POST /session-started
// Phase 4 完成后废弃此函数
```

### ApiSessionClient 上的关键方法

```typescript
// apps/free/cli/src/api/apiSession.ts

class ApiSessionClient {
  readonly sessionId: string;
  readonly rpcHandlerManager: RpcHandlerManager; // 注册 RPC handler 用这个，没有 onRpc() 方法

  // 注意：updateMetadata 不返回 Promise，是后台异步操作
  updateMetadata(handler: (metadata: Metadata) => Metadata): void;

  sendSessionDeath(): void; // 同步，不返回 Promise
  sendSessionProtocolMessage(envelope: SessionProtocolEnvelope): void;

  // Phase 3 新增：发送统一格式消息（替代各 agent 的 envelope mapper）
  // 内部将 NormalizedMessage 序列化加密后通过 WebSocket 发往 Server 存储
  // Server 端以新格式存储到 DB content 字段，App 无需二次 normalize
  sendNormalizedMessage(msg: NormalizedMessage): void;

  async flush(): Promise<void>; // 有内置 10s 超时
  async close(): Promise<void>;
}
```

**重要**：`registerKillSessionHandler` 的正确用法：

```typescript
// apps/free/cli/src/claude/registerKillSessionHandler.ts
// 注册的 RPC method 名是 'killSession'，不是 'kill'
function registerKillSessionHandler(
  rpcHandlerManager: RpcHandlerManager,
  killThisFree: () => Promise<void>
): void;
```

### 各 agent 的 Mode 类型

| Mode 类型      | 源文件                                                                                     | 用于          |
| -------------- | ------------------------------------------------------------------------------------------ | ------------- |
| `EnhancedMode` | `apps/free/cli/src/claude/sessionTypes.ts`                                                 | Claude、Codex |
| `GeminiMode`   | `apps/free/cli/src/gemini/types.ts`                                                        | Gemini        |
| `OpenCodeMode` | 定义在 `runOpenCode.ts` 内（`interface OpenCodeMode`），**迁移时需 export 并移至独立文件** | OpenCode      |

### claudeLocalLauncher / claudeRemoteLauncher

```typescript
// apps/free/cli/src/claude/claudeLocalLauncher.ts
export type LauncherResult = { type: 'switch' } | { type: 'exit'; code: number };

// 注意：接受的是 Session 对象（apps/free/cli/src/claude/session.ts 中定义），
// 不是 ApiSessionClient，也不是 opts 对象。
// Session 是对 ApiSessionClient 的包装，包含 sessionId、client（ApiSessionClient）、
// path（工作目录）、queue（MessageQueue2）等字段。
export async function claudeLocalLauncher(session: Session): Promise<LauncherResult>;

// apps/free/cli/src/claude/claudeRemoteLauncher.ts
export async function claudeRemoteLauncher(session: Session): Promise<'switch' | 'exit'>;
```

**重要**：两个 launcher 接受的是 `Session`（`apps/free/cli/src/claude/session.ts`），
不是 `ApiSessionClient`。`AgentStartOpts.session` 的类型和如何构造 `Session` 对象，
需在 Phase 3 实现 `ClaudeBackend` 时仔细梳理，可能需要对 launcher 做轻量包装。

### startHookServer（Claude 专属）

```typescript
// apps/free/cli/src/claude/utils/startHookServer.ts

// 实际签名需要一个回调参数
async function startHookServer(options: {
  onSessionHook: (sessionId: string, data: SessionHookData) => void;
}): Promise<{
  port: number;
  stop: () => void;
}>;

// hookSettings 文件路径由 generateHookSettingsFile(port) 生成，
// 通过环境变量传给 claude 进程，shutdown 时通过 cleanupHookSettingsFile(filepath) 清理。
// cleanupHookSettingsFile 来自 apps/free/cli/src/claude/utils/generateHookSettings.ts
```

---

## 核心类型定义

### NormalizedMessage

> **与 App 共用同一格式（已验证）**：
> `apps/free/app/sources/sync/typesRaw.ts` 中的 `NormalizedMessage` 已核对，
> daemon 输出直接使用该格式。好处：
>
> 1. Daemon backend 产出的消息可直接存 DB（`content` 字段），App 拉取后无需二次 normalize
> 2. 删除各 agent 的 `routeToServerSession()` + `mapXxxToSessionEnvelopes()`，只保留 `mapXxxRawToNormalized()`
> 3. 整个流水线统一：Backend 原始输出 → `mapXxxRawToNormalized` → NormalizedMessage → DB + IPC

```typescript
// apps/free/cli/src/daemon/sessions/types.ts（新建）
// 注意：NormalizedMessage 与 apps/free/app/sources/sync/typesRaw.ts 中定义的保持一致
// 后者是 source of truth，如有冲突以 App 定义为准

export type UsageData = {
  input_tokens: number;
  cache_creation_input_tokens?: number; // prompt cache 创建 token
  cache_read_input_tokens?: number; // prompt cache 命中 token
  output_tokens: number;
  service_tier?: string;
};

export type PermissionResult = {
  date: number;
  result: 'approved' | 'denied';
  mode?:
    | 'default'
    | 'acceptEdits'
    | 'bypassPermissions'
    | 'plan'
    | 'read-only'
    | 'safe-yolo'
    | 'yolo';
  allowedTools?: string[];
  decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort';
};

export type NormalizedAgentContent =
  | { type: 'text'; text: string; uuid: string; parentUUID: string | null }
  | { type: 'thinking'; thinking: string; uuid: string; parentUUID: string | null }
  | {
      type: 'tool-call';
      id: string;
      name: string;
      input: unknown;
      description: string | null;
      uuid: string;
      parentUUID: string | null;
    }
  | {
      type: 'tool-result';
      tool_use_id: string;
      content: unknown;
      is_error: boolean;
      uuid: string;
      parentUUID: string | null;
      permissions?: PermissionResult;
    }
  | { type: 'summary'; summary: string }
  | { type: 'sidechain'; uuid: string; prompt: string };

// AgentEvent — role:'event' 消息的 content 类型
// 基础类型与 App typesRaw.ts 一致，daemon 扩展了运维信号类型
// App 端 normalizeRawMessage() 对未知 type 返回 null，向前兼容
export type AgentEvent =
  // ── App 已有类型 ────────────────────────────────────
  | { type: 'switch'; mode: 'local' | 'remote' }
  | { type: 'message'; message: string }
  | { type: 'limit-reached'; endsAt: number }
  | { type: 'ready' }
  // ── Daemon 扩展（运维信号，同样存 DB） ───────────────
  // 存 DB 的好处：可重建 session 时间线、token 用量审计、错误可追溯
  // App 不渲染这些类型，但 Server 端可用于计费/分析查询
  | { type: 'status'; state: 'working' | 'idle' } // 每个 turn 首尾各一条
  | { type: 'token_count'; usage: UsageData } // 每个 turn 结束时一条
  | { type: 'error'; message: string; retryable: boolean }; // 错误审计

// NormalizedMessage — daemon 内部流转、IPC 传输、DB 存储的统一格式
// 与 apps/free/app/sources/sync/typesRaw.ts: NormalizedMessage 保持一致
export type NormalizedMessage = (
  | { role: 'user'; content: { type: 'text'; text: string } }
  | { role: 'agent'; content: NormalizedAgentContent[] }
  | { role: 'event'; content: AgentEvent }
) & {
  id: string; // cuid2，全局唯一消息 ID
  localId: string | null; // 客户端生成的临时 ID（离线场景），在线时为 null
  createdAt: number; // Unix timestamp（毫秒）
  isSidechain: boolean; // 是否来自子 agent（subagent）调用链
  meta?: MessageMeta; // 来自 apps/free/app/sources/sync/typesMessageMeta.ts
  usage?: UsageData; // 仅 assistant 消息有，包含 token 使用量
  traceId?: string; // RFC §19.3：跨层 trace 关联（App → Server → Daemon → Agent）
};

// StoredMessage — DB 存储包装（对应 Prisma SessionMessage 表）
// content 字段加密后存储，明文为 NormalizedMessage
export type StoredMessage = {
  id: string; // DB 主键（cuid2）
  sessionId: string;
  localId?: string; // 客户端 localId，用于离线同步去重
  seq: number; // 单调递增顺序号，用于拉取分页
  content: NormalizedMessage; // 取代旧的 RawRecord 格式，直接存 NormalizedMessage
  traceId?: string;
  createdAt: Date;
};

// 使用 string & {} 而非封闭 union：
// 1. 保持字符串字面量的自动补全（IDE 提示已知值）
// 2. 允许第三方或插件注册新 agent 而无需修改此文件
// 3. AgentSessionFactory.register() 运行时已做存在性检查，类型开放不影响安全性
// ⚠️ 新增 agent 无需修改此类型，但需在 daemon/run.ts 调用 AgentSessionFactory.register()
export type AgentType = 'claude' | 'codex' | 'gemini' | 'opencode' | (string & {});
```

**DB 存储格式迁移说明**：

旧格式：Server 存储的是 `RawRecord`（各 agent 原始输出），App 拉取后调用 `normalizeRawMessage()` 转换。

新格式：Daemon 输出已经是 `NormalizedMessage`，Server 直接存储。App 拉取后无需转换，直接渲染。

迁移策略：Phase 4 新启动的 session 使用新格式（通过 `sendNormalizedMessage()` 标识）；旧 session 历史记录保持旧格式，App 端兼容两种格式读取（通过字段存在性检测区分：新格式有 `role` 字段，旧格式有 `type: 'output'`）。

### AgentBackend 接口

```typescript
// apps/free/cli/src/daemon/sessions/AgentBackend.ts（新建）

export interface AgentStartOpts {
  cwd: string;
  env: Record<string, string>;
  mcpServerUrl: string; // startFreeServer() 返回的 url
  // claudeLocalLauncher/Remote 实际接受 Session（apps/free/cli/src/claude/session.ts），
  // 不是 ApiSessionClient。Phase 3 实现 ClaudeBackend 时需要处理这个差异。
  // 其他 agent 的 backend 不使用 session 字段。
  session: ApiSessionClient;
  resumeSessionId?: string;
  permissionMode?: PermissionMode;
  model?: string;
  // 影响 backend 启动行为：
  // - Claude: 决定使用 claudeLocalLauncher（local PTY 模式）还是 claudeRemoteLauncher（远程 SDK 模式）
  // - 其他 agent: backend 本身无 PTY 概念，此字段被忽略；
  //   "本地 vs 远程"由 CLIRenderer 是否 attach 决定（同一 backend，不同渲染）
  startingMode?: 'local' | 'remote';
}

export interface AgentBackend {
  readonly agentType: AgentType;

  start(opts: AgentStartOpts): Promise<void>;
  sendMessage(text: string): Promise<void>;
  abort(): Promise<void>;
  stop(): Promise<void>;

  // 用 PushableAsyncIterable 实现，stop() 后自动调用 end()
  readonly output: PushableAsyncIterable<NormalizedMessage>;

  // 可选：重连时由 AgentSession.onSessionSwap 回调，通知 backend 更新内部 session 引用
  // 不实现此方法的 backend（Codex/Gemini/OpenCode）不依赖 ApiSessionClient，无需处理
  onSessionChange?(newSession: ApiSessionClient): void;
}
```

### AgentSession 基类

```typescript
// apps/free/cli/src/daemon/sessions/AgentSession.ts（新建）

export interface AgentSessionOpts {
  credential: Credentials; // 注意单数，与 ApiClient.create() 一致
  // Credentials 只包含 token + encryption keys，machineId 单独传入（来自 readSettings().machineId）
  machineId: string;
  startedBy: 'user' | 'daemon' | 'mobile';
  cwd: string;
  resumeSessionId?: string;
  sessionTag?: string;
  env?: Record<string, string>;
  permissionMode?: PermissionMode; // 透传给 backend（AgentStartOpts.permissionMode）
  model?: string; // 透传给 backend（AgentStartOpts.model）

  // ── 依赖注入（避免 AgentSession → daemon/run.ts 循环依赖）──────────────
  // broadcast 由 daemon/run.ts 在实例化时注入，AgentSession 不静态 import daemonIPCServer
  // 签名与 IPCServer.broadcast() 一致
  broadcast: (sessionId: string, msg: IPCServerMessage) => void;
  // initialize() 完成前到达的消息会暂存此队列，initialize() 结束后 replay
  // 默认为 undefined（调用方不需要感知此细节，AgentSession 内部处理）
}

export abstract class AgentSession<TMode> {
  protected api!: ApiClient;
  protected session!: ApiSessionClient;
  protected messageQueue!: MessageQueue2<TMode>;
  // freeServer 在离线模式下不初始化，显式标注 undefined 避免假设
  protected freeServer: { url: string; toolNames: string[]; stop: () => void } | undefined;
  private reconnectionHandle: OfflineReconnectionHandle | null = null;
  private shouldExit = false;
  private pendingExit = false;
  private isShuttingDown = false; // 幂等保护，防止 shutdown 被并发或重复调用
  protected lastStatus: 'working' | 'idle' = 'idle';
  // pipeBackendOutput 的完成 Promise，shutdown() 等待 drain 后再关闭 session
  private outputPipeFinished: Promise<void> = Promise.resolve();
  // private：外部通过 sendInput() 公共方法访问，不暴露内部实现
  private backend!: AgentBackend;
  // initialize() 完成前到达的消息暂存于此，完成后 replay
  // 注意：暂存队列容量设上限（32 条），防止 initialize 卡死时内存泄漏
  private readonly PRE_INIT_QUEUE_LIMIT = 32;
  private preInitQueue: Array<{ text: string }> = [];

  constructor(protected readonly opts: AgentSessionOpts) {}

  // ── 子类必须实现 ─────────────────────────────────────────────────────────
  abstract createBackend(): AgentBackend;
  abstract createModeHasher(): (mode: TMode) => string;

  protected abstract buildMetadata(): Metadata;
  protected abstract buildInitialState(): AgentState; // AgentState，来自 api/types.ts

  // CLI 通过 IPC send_input 发来消息时使用的默认模式（不含 meta 元数据）
  abstract defaultMode(): TMode;
  // 从移动端 onUserMessage 收到的消息中提取 TMode
  // UserMessage 来自 apps/free/cli/src/api/types.ts，含 meta.permissionMode / meta.model 等字段
  protected abstract extractMode(message: UserMessage): TMode;

  // public getter：外部（spawnSession、SessionManager）需要访问 sessionId
  // initialize() 完成前调用会抛出异常
  get sessionId(): string {
    if (!this.session) throw new Error('AgentSession not initialized yet');
    return this.session.sessionId;
  }

  // CLI 通过 IPC send_input 发来的文本 → 推入消息队列
  // 不直接调用 backend.sendMessage()，保证经队列的顺序控制和 pendingExit 检查
  // initialize() 完成前暂存到 preInitQueue，完成后由 initialize() 末尾 replay，避免静默丢弃
  sendInput(text: string): void {
    if (!this.messageQueue) {
      // initialize() 尚未完成（网络慢等情况下窗口可能达数秒）
      if (this.preInitQueue.length < this.PRE_INIT_QUEUE_LIMIT) {
        this.preInitQueue.push({ text });
      } else {
        logger.warn('[AgentSession] preInitQueue full, dropping message', {
          cwd: this.opts.cwd,
        });
      }
      return;
    }
    this.messageQueue.push(text, this.defaultMode());
  }

  // IPCServer 的 abort 消息通过此公共方法转发，不直接访问 private backend（修正 19）
  abort(): Promise<void> {
    this.shouldExit = true;
    // 同时关闭外层队列，防止 waitForMessagesAndGetAsString 在 backend.abort() 完成前
    // 仍然 await 阻塞，导致 run() 循环无法退出
    this.messageQueue?.close();
    return this.backend?.abort() ?? Promise.resolve();
  }

  // ── 生命周期 ─────────────────────────────────────────────────────────────
  async initialize(): Promise<void> {
    this.api = await ApiClient.create(this.opts.credential);
    this.messageQueue = new MessageQueue2<TMode>(this.createModeHasher());

    const tag = this.opts.sessionTag ?? randomUUID();
    const metadata = this.buildMetadata();
    const state = this.buildInitialState();

    // getOrCreateSession 返回 ApiSessionClient | null
    const response = await this.api.getOrCreateSession({ tag, metadata, state });

    // setupOfflineReconnection 内部处理在线/离线分支
    // response 为 null 时自动进入离线模式（返回 offline stub session）
    const result = setupOfflineReconnection({
      api: this.api,
      sessionTag: tag,
      metadata,
      state,
      response,
      onSessionSwap: async newSession => {
        // 重连成功，热切换到新 session
        // ⚠️ 顺序关键（修正 21 修订版）：
        //   1. 先停旧 freeServer（防止端口泄漏）
        //   2. 用新 session 启动新 freeServer（await，期间 this.session 仍指向旧值）
        //   3. 新 freeServer 就绪后，再原子地切换 this.session + this.freeServer
        //   这样保证：在整个 await 期间，this.session 和 this.freeServer 始终配对，
        //   不会出现 this.session 已切换但 this.freeServer 还未就绪的窗口期
        //
        // ⚠️ 异常安全（修正 34）：整个回调包在 try-catch 中，
        //   若 startFreeServer 抛出（端口被占用、daemon 资源限制等），
        //   不会使 this.session / this.freeServer 处于部分更新的不一致状态。
        //   失败时保持旧 session 继续运行，记录错误等待下次重连尝试。
        try {
          this.freeServer?.stop();
          const newFreeServer = await startFreeServer(newSession);
          // 此处两行赋值在同一个同步事件循环 tick 内完成，JS 单线程保证原子性
          this.session = newSession;
          this.freeServer = newFreeServer;
          // 重新注册移动端消息处理（新 session 对象）
          newSession.onUserMessage(msg => {
            if (!this.messageQueue) return;
            const mode = this.extractMode(msg);
            this.messageQueue.push(msg.content.text, mode);
          });
          // 通知 backend session 已切换，使其内部持有的 session 引用同步更新
          this.backend?.onSessionChange?.(newSession);
          // Phase 4 完成后废弃：daemon 直接管理 session，无需 webhook 通知
          await notifyDaemonSessionStarted(newSession.sessionId, metadata);
        } catch (err) {
          logger.error('[AgentSession] onSessionSwap failed, retaining old session', {
            newSessionId: newSession.sessionId,
            error: String(err),
          });
          // 旧 session 和 freeServer 引用保持不变，等待下次重连触发新的 swap 尝试
        }
      },
    });

    this.session = result.session;
    this.reconnectionHandle = result.reconnectionHandle;

    if (!result.isOffline) {
      this.freeServer = await startFreeServer(this.session);
      await notifyDaemonSessionStarted(this.session.sessionId, metadata);
    }

    // 注册移动端消息处理（来自 Server → WebSocket → ApiSessionClient 的用户消息）
    // CLI 消息走 IPC → sendInput() → messageQueue，两条路径统一收敛到同一队列
    this.session.onUserMessage(msg => {
      if (!this.messageQueue) return;
      const mode = this.extractMode(msg);
      this.messageQueue.push(msg.content.text, mode);
    });

    // initialize() 完成：replay preInitQueue（initialize 期间到达的 CLI 消息）
    // replay 在 onUserMessage 注册之后、run() 开始之前，保证顺序正确
    for (const { text } of this.preInitQueue) {
      this.messageQueue.push(text, this.defaultMode());
    }
    this.preInitQueue = [];
  }

  async run(): Promise<void> {
    this.backend = this.createBackend();
    await this.backend.start(this.buildBackendStartOpts());

    // 注册 kill handler（通过 rpcHandlerManager，不是 onRpc）
    registerKillSessionHandler(this.session.rpcHandlerManager, async () => {
      this.shouldExit = true;
      await this.backend.abort();
    });

    // backend 输出路由：→ 服务器（手机端）+ → IPC（CLI/TUI）
    this.pipeBackendOutput();

    // 主消息循环；try-finally 保证无论何种退出路径都执行 shutdown
    try {
      while (!this.shouldExit) {
        const item = await this.messageQueue.waitForMessagesAndGetAsString();
        if (!item) break;

        // SIGTERM 时等当前 turn 结束（idle）再退出
        if (this.pendingExit && this.lastStatus === 'idle') break;

        await this.backend.sendMessage(item.message);
      }
    } finally {
      await this.shutdown('loop_ended');
    }
  }

  async shutdown(reason: string): Promise<void> {
    // 幂等保护：run() finally 与外部 sessionManager.stop() 可能并发调用
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    // 关闭消息队列，确保 waitForMessagesAndGetAsString 立即返回 null
    this.messageQueue?.close();

    if (this.backend) {
      await this.backend.stop();
      // 等待 output pipe drain 完毕，防止最后几条消息发往已关闭的 session
      // backend.stop() 调用 output.end()，for-await 会 drain 剩余消息后退出
      await this.outputPipeFinished;
    }

    if (this.session) {
      // updateMetadata 是后台异步，不阻塞
      this.session.updateMetadata(m => ({
        ...m,
        lifecycleState: 'archived',
        lifecycleStateSince: Date.now(),
        archivedBy: 'daemon',
        archiveReason: reason,
      }));

      this.session.sendSessionDeath();
      // flush 有内置 10s 超时，race 是额外保险
      await Promise.race([this.session.flush(), delay(5000)]);
      await this.session.close();
    }

    this.freeServer?.stop();
    this.reconnectionHandle?.cancel();
  }

  // daemon/run.ts 在接收到 SIGTERM 后遍历所有 session 调用此方法
  handleSigterm(): void {
    this.pendingExit = true;
  }
  // daemon/run.ts 在接收到 SIGINT 后遍历所有 session 调用此方法
  // 同时关闭队列，使 waitForMessagesAndGetAsString 立即返回 null 退出循环
  handleSigint(): void {
    this.shouldExit = true;
    this.messageQueue?.close();
  }

  // ── 内部工具 ─────────────────────────────────────────────────────────────
  private pipeBackendOutput(): void {
    // 将 Promise 保存到 outputPipeFinished，shutdown() 可 await 等待 drain 完成
    this.outputPipeFinished = (async () => {
      try {
        for await (const msg of this.backend.output) {
          // 运维信号更新内部状态（用于 pendingExit 逻辑）
          if (msg.role === 'event' && msg.content.type === 'status') {
            this.lastStatus = msg.content.state;
          }

          // 所有消息无条件全部存 DB + 广播 IPC，包括运维信号
          // 运维信号（status/token_count/error）存 DB 的好处：
          //   可重建 session 时间线、token 用量审计、错误可追溯
          // App 端对未知 AgentEvent type 返回 null，不渲染，向前兼容
          this.session.sendNormalizedMessage(msg);
          // 使用注入的 broadcast 回调而非直接引用 daemonIPCServer 单例
          // 避免 AgentSession.ts → daemon/run.ts 循环依赖
          this.opts.broadcast(this.session.sessionId, {
            type: 'agent_output',
            sessionId: this.session.sessionId,
            msg,
          });
        }
      } catch (err) {
        // 管道异常：记录日志并触发 shutdown，防止消息静默丢失
        logger.error('[AgentSession] output pipe broken, triggering shutdown', {
          sessionId: this.session?.sessionId,
          error: String(err),
        });
        this.shouldExit = true;
        // 通知消息循环退出（loop 已有 finally → shutdown，此处不重复调用）
        this.messageQueue?.close();
      }
    })();
  }

  // protected：ClaudeSession 需要 override 注入 hookServer port
  protected buildBackendStartOpts(): AgentStartOpts {
    return {
      cwd: this.opts.cwd,
      env: this.opts.env ?? {},
      // 离线模式下 freeServer 未初始化，传空字符串；backend 需容忍此值
      mcpServerUrl: this.freeServer?.url ?? '',
      session: this.session, // claude launcher 需要
      resumeSessionId: this.opts.resumeSessionId,
      permissionMode: this.opts.permissionMode,
      model: this.opts.model,
    };
  }
}
```

### AgentSessionFactory

```typescript
// apps/free/cli/src/daemon/sessions/AgentSessionFactory.ts（新建）

type AgentSessionConstructor = new (opts: AgentSessionOpts) => AgentSession<any>;

const registry = new Map<AgentType, AgentSessionConstructor>();

export const AgentSessionFactory = {
  register(agentType: AgentType, cls: AgentSessionConstructor): void {
    registry.set(agentType, cls);
  },

  create(agentType: AgentType, opts: AgentSessionOpts): AgentSession<any> {
    const Cls = registry.get(agentType);
    if (!Cls) throw new Error(`Unknown agentType: ${agentType}`);
    return new Cls(opts);
  },
};

// 注册（在 daemon/run.ts 启动时调用）
AgentSessionFactory.register('claude', ClaudeSession);
AgentSessionFactory.register('codex', CodexSession);
AgentSessionFactory.register('gemini', GeminiSession);
AgentSessionFactory.register('opencode', OpenCodeSession);
```

### SessionManager

```typescript
// apps/free/cli/src/daemon/sessions/SessionManager.ts（新建）
// 替代现有 daemon/run.ts 中的 pidToTrackedSession Map

export class SessionManager {
  private sessions = new Map<string, AgentSession<any>>();

  // onEvictHistory 注入：打破 SessionManager → daemonIPCServer 的静态 import 边
  // 与 AgentSession.opts.broadcast 使用同一模式，保持依赖注入一致性
  // daemon/run.ts 初始化时注入：new SessionManager((id) => daemonIPCServer.evictHistory(id))
  constructor(private readonly onEvictHistory: (sessionId: string) => void = () => {}) {}

  register(sessionId: string, session: AgentSession<any>): void {
    this.sessions.set(sessionId, session);
  }

  // 从 registry 中移除 session（session 已自行 shutdown，仅清理引用）
  unregister(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.onEvictHistory(sessionId); // 回调注入而非直接引用单例，避免循环依赖
  }

  get(sessionId: string): AgentSession<any> | undefined {
    return this.sessions.get(sessionId);
  }

  list(): AgentSession<any>[] {
    return [...this.sessions.values()];
  }

  async stop(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      await session.shutdown('remote_stop');
      this.unregister(sessionId); // shutdown 后统一走 unregister 清理
    }
  }

  // daemon 收到 SIGTERM 时调用
  handleSigterm(): void {
    for (const session of this.sessions.values()) session.handleSigterm();
  }

  // daemon 收到 SIGINT 时调用
  handleSigint(): void {
    for (const session of this.sessions.values()) session.handleSigint();
  }
}

// onEvictHistory 注入，打破 SessionManager → daemonIPCServer 循环依赖
// 具体实例化在 daemon/run.ts：new SessionManager((id) => daemonIPCServer.evictHistory(id))
export const sessionManager = new SessionManager(id => daemonIPCServer.evictHistory(id));
```

### Daemon IPC 协议

```typescript
// apps/free/cli/src/daemon/ipc/protocol.ts（新建）

export type IPCClientMessage =
  | { type: 'attach'; sessionId: string }
  | { type: 'detach'; sessionId: string }
  | { type: 'send_input'; sessionId: string; text: string }
  | { type: 'abort'; sessionId: string }
  | { type: 'list_sessions' }
  | { type: 'spawn_session'; opts: SpawnSessionOptions }
  // Claude PTY proxy：CLI stdin → daemon → claudeLocalLauncher 的 PTY 进程
  // data: base64 编码的二进制数据（PTY 原始字节），接收方 Buffer.from(data, 'base64') 解码
  | { type: 'pty_data'; sessionId: string; data: string }
  | { type: 'pty_resize'; sessionId: string; cols: number; rows: number };

export type IPCServerMessage =
  | { type: 'agent_output'; sessionId: string; msg: NormalizedMessage }
  | { type: 'session_state'; sessionId: string; state: SessionLifecycleState }
  | { type: 'session_list'; sessions: SessionSummary[] }
  | { type: 'spawn_result'; sessionId: string; success: boolean; error?: string }
  | { type: 'history'; sessionId: string; msgs: NormalizedMessage[] } // attach 时回放
  | { type: 'pty_data'; sessionId: string; data: string } // base64 编码的 PTY 原始字节
  | { type: 'pty_resize'; sessionId: string; cols: number; rows: number }
  | { type: 'error'; message: string };

export type SessionLifecycleState = 'initializing' | 'ready' | 'working' | 'idle' | 'archived';

export interface SessionSummary {
  sessionId: string;
  agentType: AgentType;
  cwd: string;
  state: SessionLifecycleState;
  startedAt: string;
  startedBy: 'user' | 'daemon' | 'mobile';
}
```

### IPCServer

```typescript
// apps/free/cli/src/daemon/ipc/IPCServer.ts（新建）

// HistoryRing：真正的环形缓冲，O(1) 写入，无 Array.shift() 的 O(n) 开销
// 适合高频流式输出场景（Claude 每个 token 一条消息）
class HistoryRing {
  private buf: NormalizedMessage[];
  private head = 0; // 下一次写入的槽位
  private count = 0; // 当前有效元素数

  constructor(private readonly capacity: number) {
    this.buf = new Array(capacity);
  }

  push(msg: NormalizedMessage): void {
    this.buf[this.head] = msg;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  // 返回从最旧到最新排序的所有元素（attach 时回放用）
  toArray(): NormalizedMessage[] {
    if (this.count < this.capacity) {
      return this.buf.slice(0, this.count);
    }
    // 缓冲区满：head 指向最旧的元素
    return [...this.buf.slice(this.head), ...this.buf.slice(0, this.head)];
  }

  clear(): void {
    this.head = 0;
    this.count = 0;
  }
}

export class IPCServer {
  private server!: net.Server;
  // sessionId → 已 attach 的 socket 集合
  private attachments = new Map<string, Set<net.Socket>>();
  // sessionId → 环形缓冲区（最近 500 条，单条约 1-5KB，总计约 0.5-2.5MB）
  // 使用 HistoryRing 替代 Array + shift()，避免 O(n) 开销
  private history = new Map<string, HistoryRing>();
  private readonly HISTORY_SIZE = 500;

  // 注入 SessionManager 和 spawnSession 回调，避免静态 import 造成循环依赖
  // spawnSession 定义在 daemon/run.ts，不在 IPCServer 内部 import，遵守 zero-cycles 规则
  constructor(
    private readonly sessionManager: SessionManager,
    private readonly onSpawnSession: (opts: SpawnSessionOptions) => Promise<SpawnSessionResult>
  ) {}

  async start(socketPath: string): Promise<void> {
    // 清理残留 socket 文件，防止 daemon crash 后重启报 EADDRINUSE
    try {
      fs.unlinkSync(socketPath);
    } catch {
      /* 不存在则忽略 */
    }

    this.server = net.createServer(socket => this.handleConnection(socket));
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(socketPath, resolve);
    });
    // socket 文件权限 0600，仅当前用户可访问
    fs.chmodSync(socketPath, 0o600);
  }

  // AgentSession.pipeBackendOutput() 调用此方法（通过注入的 broadcast 回调）
  broadcast(sessionId: string, msg: IPCServerMessage): void {
    // 写入环形历史缓冲（O(1)）
    if (msg.type === 'agent_output') {
      let ring = this.history.get(sessionId);
      if (!ring) {
        ring = new HistoryRing(this.HISTORY_SIZE);
        this.history.set(sessionId, ring);
      }
      ring.push(msg.msg);
    }
    // 广播给已 attach 的客户端，处理背压
    // socket.write() 返回 false 表示发送缓冲区已满，此时记录警告但不阻塞 broadcast
    // 理由：daemon 广播是 best-effort，CLI 重连后通过历史回放补全丢失消息
    // 若需要可靠投递，未来可在此处为每个 socket 维护一个 pendingQueue + drain 监听
    const sockets = this.attachments.get(sessionId) ?? new Set();
    const line = JSON.stringify(msg) + '\n';
    for (const socket of sockets) {
      const flushed = socket.write(line);
      if (!flushed) {
        // 发送缓冲区满：记录警告，消息不会丢失（TCP 层仍会缓冲），
        // 但持续满载时 Node.js 会累积内存，监控此日志用于容量规划
        logger.warn('[IPCServer] socket send buffer full, backpressure detected', {
          sessionId,
          msgType: msg.type,
        });
      }
    }
  }

  // session 结束时由 SessionManager.unregister() 调用，释放历史缓冲内存
  evictHistory(sessionId: string): void {
    this.history.delete(sessionId);
    this.attachments.delete(sessionId);
  }

  private handleConnection(socket: net.Socket): void {
    // crlfDelay: Infinity 防止跨 TCP 包的大消息被截断
    const reader = readline.createInterface({ input: socket, crlfDelay: Infinity });
    reader.on('line', line => {
      try {
        const msg: IPCClientMessage = JSON.parse(line);
        this.handleMessage(socket, msg);
      } catch (err) {
        logger.error('[IPCServer] malformed message', { error: String(err) });
        socket.write(JSON.stringify({ type: 'error', message: 'malformed message' }) + '\n');
      }
    });
    socket.on('close', () => this.cleanup(socket));
    socket.on('error', err => {
      logger.error('[IPCServer] socket error', { error: String(err) });
      this.cleanup(socket);
    });
  }

  private handleMessage(socket: net.Socket, msg: IPCClientMessage): void {
    switch (msg.type) {
      case 'attach': {
        const set = this.attachments.get(msg.sessionId) ?? new Set();
        set.add(socket);
        this.attachments.set(msg.sessionId, set);
        // 先发历史缓冲（attach 时回放）
        const history = this.history.get(msg.sessionId)?.toArray() ?? [];
        socket.write(
          JSON.stringify({
            type: 'history',
            sessionId: msg.sessionId,
            msgs: history,
          }) + '\n'
        );
        break;
      }
      case 'detach': {
        this.attachments.get(msg.sessionId)?.delete(socket);
        break;
      }
      case 'send_input': {
        // 通过 AgentSession 的公共方法 sendInput，不直接访问私有 backend
        const session = this.sessionManager.get(msg.sessionId);
        session?.sendInput(msg.text);
        break;
      }
      case 'spawn_session': {
        // 回调 daemon/run.ts 中的 spawnSession，不直接 import（避免循环依赖）
        this.onSpawnSession(msg.opts)
          .then(result => {
            socket.write(
              JSON.stringify({
                type: 'spawn_result',
                sessionId: result.type === 'success' ? result.sessionId : '',
                success: result.type === 'success',
                error: result.type === 'error' ? result.error : undefined,
              }) + '\n'
            );
          })
          .catch(err => {
            socket.write(
              JSON.stringify({
                type: 'spawn_result',
                sessionId: '',
                success: false,
                error: String(err),
              }) + '\n'
            );
          });
        break;
      }
      case 'abort': {
        // 通过 AgentSession 的公共方法 abort()，不直接访问 private backend（修正 19）
        const session = this.sessionManager.get(msg.sessionId);
        session?.abort().catch(err => {
          logger.error('[IPCServer] abort failed', {
            sessionId: msg.sessionId,
            error: String(err),
          });
        });
        break;
      }
      case 'list_sessions': {
        const sessions = this.sessionManager.list().map(s => s.toSummary());
        socket.write(JSON.stringify({ type: 'session_list', sessions }) + '\n');
        break;
      }
    }
  }

  private cleanup(socket: net.Socket): void {
    for (const set of this.attachments.values()) set.delete(socket);
  }

  stop(): void {
    this.server.close();
  }
}

// 注意：daemonIPCServer 必须在 sessionManager 和 spawnSession 初始化后创建
// daemon/run.ts 启动时：
//   export const daemonIPCServer = new IPCServer(sessionManager, spawnSession);
// 而非模块级别的单例（避免 sessionManager 尚未初始化）
```

### IPCClient（供 CLI 使用）

```typescript
// apps/free/cli/src/daemon/ipc/IPCClient.ts（新建）

export class IPCClient {
  private socket!: net.Socket;
  // Set 支持多个监听器注册同一类型，避免后注册覆盖前者（CLIRenderer 和 InputHandler 均可监听 session_state）
  private handlers = new Map<string, Set<(msg: IPCServerMessage) => void>>();
  private socketPath!: string;
  private reconnectTimer?: NodeJS.Timeout;
  private reconnectDelay = 500;
  private readonly MAX_RECONNECT_DELAY_MS = 10_000;
  private destroyed = false;
  // 重连窗口期缓存的 send_input 消息，重连成功后按序重发
  // 上限 16 条（约等于用户在重连期间输入的最大字符数），防止内存无限增长
  private readonly PENDING_SEND_INPUT_LIMIT = 16;
  private pendingSendInputs: Array<Extract<IPCClientMessage, { type: 'send_input' }>> = [];

  // CLIClient 在重连成功后需要重新 attach session，通过此回调通知
  onReconnect?: () => void;

  async connect(socketPath: string): Promise<void> {
    this.socketPath = socketPath;
    await this.doConnect();
  }

  private async doConnect(): Promise<void> {
    this.socket = net.createConnection(this.socketPath);
    await new Promise<void>((resolve, reject) => {
      this.socket.once('connect', resolve);
      this.socket.once('error', reject);
    });
    this.reconnectDelay = 500; // 连接成功，重置退避延迟

    const reader = readline.createInterface({ input: this.socket, crlfDelay: Infinity });
    reader.on('line', line => {
      try {
        const msg: IPCServerMessage = JSON.parse(line);
        this.handlers.get(msg.type)?.forEach(h => h(msg));
      } catch (err) {
        logger.error('[IPCClient] malformed message', { error: String(err) });
      }
    });
    this.socket.on('close', () => {
      if (!this.destroyed) this.scheduleReconnect();
    });
    this.socket.on('error', err => {
      // 错误由 close 事件触发重连，这里只记录日志
      logger.error('[IPCClient] socket error', { error: String(err) });
    });
  }

  private scheduleReconnect(): void {
    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.doConnect();
        // 重连成功：先通知 CLIClient 重新 attach（使 daemon 侧准备好接收消息）
        this.onReconnect?.();
        // 再重发缓冲的 send_input（attach 之后 daemon 才能路由到正确 session）
        const pending = this.pendingSendInputs.splice(0);
        for (const msg of pending) {
          this.socket.write(JSON.stringify(msg) + '\n');
        }
        if (pending.length > 0) {
          logger.debug('[IPCClient] resent buffered send_input after reconnect', {
            count: pending.length,
          });
        }
      } catch {
        // 指数退避，上限 10s
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.MAX_RECONNECT_DELAY_MS);
        this.scheduleReconnect();
      }
    }, this.reconnectDelay);
  }

  send(msg: IPCClientMessage): void {
    if (this.socket?.writable) {
      this.socket.write(JSON.stringify(msg) + '\n');
      return;
    }
    // socket 不可写（重连窗口期）：
    // - agent_output / session_state 类消息：无损，重连后 attach 回放历史缓冲即可恢复
    // - send_input：缓存到 pendingSendInputs，重连成功后在 doConnect() 末尾重发
    if (msg.type === 'send_input') {
      if (this.pendingSendInputs.length < this.PENDING_SEND_INPUT_LIMIT) {
        this.pendingSendInputs.push(msg);
        logger.warn(
          '[IPCClient] send_input buffered: daemon reconnecting, will resend on reconnect',
          {
            sessionId: msg.sessionId,
            buffered: this.pendingSendInputs.length,
          }
        );
      } else {
        // 超出上限（极端情况：daemon 长时间不可达）才丢弃，并明确通知用户
        logger.error('[IPCClient] send_input dropped: pending buffer full', {
          sessionId: msg.sessionId,
          limit: this.PENDING_SEND_INPUT_LIMIT,
        });
      }
    }
  }

  on(type: IPCServerMessage['type'], handler: (msg: IPCServerMessage) => void): void {
    const set = this.handlers.get(type) ?? new Set();
    set.add(handler);
    this.handlers.set(type, set);
  }

  off(type: IPCServerMessage['type'], handler: (msg: IPCServerMessage) => void): void {
    this.handlers.get(type)?.delete(handler);
  }

  disconnect(): void {
    this.destroyed = true;
    clearTimeout(this.reconnectTimer);
    this.pendingSendInputs = []; // 主动断开时清空缓冲，不再重发
    this.socket?.destroy();
  }
}
```

---

## 各 Agent 实现

### ClaudeSession（含 Hook Server）

```typescript
// apps/free/cli/src/daemon/sessions/ClaudeSession.ts（新建）

export class ClaudeSession extends AgentSession<EnhancedMode> {
  // EnhancedMode 来自 apps/free/cli/src/claude/sessionTypes.ts
  private hookServer?: { port: number; stop: () => void };

  createBackend(): AgentBackend {
    return new ClaudeBackend();
  }

  createModeHasher() {
    return (mode: EnhancedMode) =>
      JSON.stringify({
        permissionMode: mode.permissionMode,
        model: mode.model,
      });
  }

  // CLI send_input 没有 meta，使用启动时的默认模式
  defaultMode(): EnhancedMode {
    return {
      permissionMode: this.opts.permissionMode ?? 'default',
      model: this.opts.model,
    };
  }

  // 从移动端消息 meta 中提取完整 EnhancedMode（与现有 runClaude.ts 的 onUserMessage 逻辑一致）
  protected extractMode(message: UserMessage): EnhancedMode {
    const meta = message.meta;
    return {
      permissionMode: meta?.permissionMode ?? this.opts.permissionMode ?? 'default',
      model: meta?.model ?? this.opts.model,
      fallbackModel: meta?.fallbackModel,
      customSystemPrompt: meta?.customSystemPrompt,
      appendSystemPrompt: meta?.appendSystemPrompt,
      allowedTools: meta?.allowedTools,
      disallowedTools: meta?.disallowedTools,
    };
  }

  // Hook Server 是 Claude 专属，覆盖基类 initialize
  // startHookServer 需要 onSessionHook 回调（来自 startHookServer.ts）
  private hookSettingsFilePath?: string;

  async initialize(): Promise<void> {
    this.hookServer = await startHookServer({
      onSessionHook: (sessionId, data) => {
        // 处理 claude --resume 产生的新 sessionId
        logger.debug('[ClaudeSession] session hook', { sessionId });
      },
    });
    // generateHookSettingsFile 来自 apps/free/cli/src/claude/utils/generateHookSettings.ts
    this.hookSettingsFilePath = generateHookSettingsFile(this.hookServer.port);
    await super.initialize();
  }

  async shutdown(reason: string): Promise<void> {
    // try-finally 确保 hookServer 无论 super.shutdown() 是否抛异常都能清理
    try {
      await super.shutdown(reason);
    } finally {
      this.hookServer?.stop();
      // cleanupHookSettingsFile 需要传入文件路径（来自 generateHookSettings.ts）
      if (this.hookSettingsFilePath) cleanupHookSettingsFile(this.hookSettingsFilePath);
    }
  }

  // buildBackendStartOpts 注入 hookServer port（通过 env）
  protected buildBackendStartOpts(): AgentStartOpts {
    const base = super.buildBackendStartOpts();
    return {
      ...base,
      env: {
        ...base.env,
        FREE_HOOK_PORT: String(this.hookServer?.port ?? ''),
      },
    };
  }

  protected buildMetadata(): Metadata {
    return { agentType: 'claude', startedBy: this.opts.startedBy, cwd: this.opts.cwd };
  }
  protected buildInitialState(): AgentState {
    return {};
  }
}
```

### ClaudeBackend

```typescript
// apps/free/cli/src/backends/claude/ClaudeBackend.ts（新建）

// ── Claude 架构说明（阅读本类前必读）─────────────────────────────────────────
//
// Claude 与其他 agent 的根本区别：
//   其他 agent（Codex/Gemini/OpenCode）：
//     AgentSession.run() 外层循环 → backend.sendMessage() → 直接调用 SDK
//
//   Claude：
//     launcher 自身就是消息循环主体（claudeLocalLauncher/claudeRemoteLauncher 内部
//     有 while 循环消费 session.queue）。
//
// 因此 ClaudeBackend 使用"队列穿透"模式：
//   - ClaudeBackend 创建一个内部 messageQueue
//   - buildClaudeSession() 把这个 queue 注入到 Session 对象
//   - launcher 从 Session.queue 消费消息（launcher 自己的内部循环）
//   - AgentSession.run() 外层循环调用 backend.sendMessage()，
//     sendMessage() 把消息 push 到内部 queue
//
// 这意味着 Claude 有两层队列：
//   AgentSession.messageQueue（外层）→ backend.sendMessage() → ClaudeBackend.messageQueue（内层）→ launcher
//
// 这是必要的设计代价，原因：
//   1. launcher 的 API 接受 Session 对象而非直接接受文本，不能直接调用
//   2. 修改 launcher 接口会改动稳定代码，Phase 3 保持现有 launcher 不变
//   3. 外层循环统一了 CLI/Mobile 两条消息路径，保留它有益于后续的背压/优先级控制
//
// ⚠️ 注意：launcher 是独立的消息消费者，不受 AgentSession.run() 外层循环控制。
//    abort()/stop() 必须关闭内层 queue 而不是外层 queue，才能终止 launcher 循环。
// ─────────────────────────────────────────────────────────────────────────────

export class ClaudeBackend implements AgentBackend {
  readonly agentType = 'claude' as const;
  readonly output = new PushableAsyncIterable<NormalizedMessage>();
  // ⚠️ abortController 暂未接入 launcher（claudeLocalLauncher/Remote 无 AbortSignal 参数）
  // 目前 abort() 的实际效果是关闭内层 messageQueue，使 launcher 内部循环因 queue.close() 而退出
  // Phase 3 若需要更强的中止能力（立即杀死 claude 子进程），需在 launcher 侧增加 AbortSignal 支持
  private abortController = new AbortController();
  // Claude launcher 通过 Session.queue（MessageQueue2）接收消息
  // ClaudeBackend 持有同一个 queue 引用，sendMessage 直接 push 到队列
  // Phase 3 实现时需将此 queue 注入到构造的 Session 对象中
  private messageQueue!: MessageQueue2<EnhancedMode>;
  // 持有 Session 引用以支持 onSessionChange
  private claudeSession?: ReturnType<typeof buildClaudeSession>;
  private defaultMode!: EnhancedMode;

  async start(opts: AgentStartOpts): Promise<void> {
    this.defaultMode = {
      permissionMode: opts.permissionMode ?? 'default',
      model: opts.model,
    };
    // 内层 MessageQueue2：由 ClaudeBackend 创建，注入到 Session 对象
    // launcher 消费此 queue；外层 AgentSession.messageQueue 通过 sendMessage() 向此 queue 写入
    this.messageQueue = new MessageQueue2<EnhancedMode>(mode =>
      JSON.stringify({ permissionMode: mode.permissionMode, model: mode.model })
    );

    // fire-and-forget，加错误处理防止 unhandled rejection
    const run = opts.startingMode === 'local' ? this.runLocal(opts) : this.runRemote(opts);
    run.catch(err => {
      logger.error('[ClaudeBackend] launcher error', { error: String(err) });
      this.output.end();
    });
  }

  // claudeLocalLauncher 实际接受 Session（claude/session.ts），不是 ApiSessionClient
  // Phase 3 实现时需要从 opts 构造 Session 对象，将 this.messageQueue 注入其中
  private async runLocal(opts: AgentStartOpts): Promise<void> {
    // TODO Phase 3：构造 Session 对象，注入 this.messageQueue
    this.claudeSession = buildClaudeSession(opts, this.messageQueue); // 待实现的辅助函数
    const result = await claudeLocalLauncher(this.claudeSession);
    const id = createId();
    if (result.type === 'exit') {
      this.output.push({
        id,
        localId: null,
        createdAt: Date.now(),
        isSidechain: false,
        role: 'event',
        content: { type: 'message', message: 'session ended' },
      });
    } else {
      this.output.push({
        id,
        localId: null,
        createdAt: Date.now(),
        isSidechain: false,
        role: 'event',
        content: { type: 'switch', mode: 'remote' },
      });
    }
    this.output.end();
  }

  // claudeRemoteLauncher 实际接受 Session（claude/session.ts）
  private async runRemote(opts: AgentStartOpts): Promise<void> {
    // TODO Phase 3：构造 Session 对象，注入 this.messageQueue
    this.claudeSession = buildClaudeSession(opts, this.messageQueue); // 待实现的辅助函数
    const result = await claudeRemoteLauncher(this.claudeSession);
    const id = createId();
    if (result === 'exit') {
      this.output.push({
        id,
        localId: null,
        createdAt: Date.now(),
        isSidechain: false,
        role: 'event',
        content: { type: 'message', message: 'session ended' },
      });
    } else {
      this.output.push({
        id,
        localId: null,
        createdAt: Date.now(),
        isSidechain: false,
        role: 'event',
        content: { type: 'switch', mode: 'local' },
      });
    }
    this.output.end();
  }

  // 将用户输入 push 到内层 messageQueue，launcher 自身的消息循环会消费此队列
  async sendMessage(text: string): Promise<void> {
    this.messageQueue.push(text, this.defaultMode);
  }

  // 重连时更新 Session 内部持有的 ApiSessionClient
  // Phase 3 实现时，buildClaudeSession 需要返回可更新 client 的 Session 对象
  onSessionChange(newSession: ApiSessionClient): void {
    // Session 对象需要暴露 updateClient(newClient: ApiSessionClient) 方法
    // 或在构造时通过 getter/setter 持有 client 引用
    // 具体方案在 Phase 3 梳理 claude/session.ts 时确定
    this.claudeSession?.updateClient?.(newSession);
    logger.debug('[ClaudeBackend] session changed', { sessionId: newSession.sessionId });
  }

  async abort(): Promise<void> {
    // 关闭内层 queue → launcher 内部的 waitForMessagesAndGetAsString 返回 null → launcher 循环退出
    // abortController.abort() 信号目前未接入 launcher，保留供未来扩展
    this.abortController.abort();
    this.messageQueue?.close();
  }

  async stop(): Promise<void> {
    this.abortController.abort();
    this.messageQueue?.close();
    this.output.end();
  }
}
```

> **Phase 3 关键任务**：实现 `buildClaudeSession(opts, queue)` 辅助函数，
> 将 `ApiSessionClient` 和外部 `MessageQueue2` 组装为 `claude/session.ts` 中的 `Session` 对象。
> launcher 内部已通过 `session.queue` 消费消息，只需确保注入同一个 queue 实例即可。
> `buildClaudeSession` 返回的对象需支持 `updateClient(newSession)` 方法供 `onSessionChange` 调用。
> 详细梳理 `claude/session.ts` 的构造方式是 Phase 3 的首要任务。

### CodexSession / CodexBackend（示例）

```typescript
// apps/free/cli/src/daemon/sessions/CodexSession.ts（新建）

export class CodexSession extends AgentSession<EnhancedMode> {
  // EnhancedMode 来自 apps/free/cli/src/claude/sessionTypes.ts（Claude 和 Codex 共用）
  createBackend(): AgentBackend {
    return new CodexBackend();
  }
  createModeHasher() {
    return (mode: EnhancedMode) => `${mode.permissionMode}:${mode.model ?? ''}`;
  }
  defaultMode(): EnhancedMode {
    return {
      permissionMode: this.opts.permissionMode ?? 'default',
      model: this.opts.model,
    };
  }
  protected extractMode(message: UserMessage): EnhancedMode {
    return {
      permissionMode: message.meta?.permissionMode ?? this.opts.permissionMode ?? 'default',
      model: message.meta?.model ?? this.opts.model,
    };
  }
  protected buildMetadata(): Metadata {
    return { agentType: 'codex', startedBy: this.opts.startedBy, cwd: this.opts.cwd };
  }
  protected buildInitialState(): AgentState {
    return {};
  }
}

// apps/free/cli/src/backends/codex/CodexBackend.ts（新建）

export class CodexBackend implements AgentBackend {
  readonly agentType = 'codex' as const;
  readonly output = new PushableAsyncIterable<NormalizedMessage>();
  private client!: CodexMcpClient;
  private sessionCreated = false;
  private startOpts!: AgentStartOpts; // sendMessage 需要访问 cwd，显式声明避免运行时 undefined

  async start(opts: AgentStartOpts): Promise<void> {
    this.startOpts = opts;
    this.client = new CodexMcpClient(resolveSandboxConfig(opts));
    await this.client.connect();
    this.client.onMessage(raw => {
      // 将现有 mapCodexMcpMessageToSessionEnvelopes 的逻辑转为映射到 NormalizedMessage
      const normalized = mapCodexRawToNormalized(raw);
      if (normalized) this.output.push(normalized);
    });
  }

  async sendMessage(text: string): Promise<void> {
    if (!this.sessionCreated) {
      await this.client.startSession({ cwd: this.startOpts.cwd }, { prompt: text });
      this.sessionCreated = true;
    } else {
      await this.client.continueSession(text);
    }
  }

  async abort(): Promise<void> {
    await this.client.abort();
  }
  async stop(): Promise<void> {
    await this.client.close();
    this.output.end();
  }
}
```

GeminiSession / GeminiBackend 和 OpenCodeSession / OpenCodeBackend 结构完全相同，
分别包装 `createGeminiBackend` 和 `createOpenCodeBackend`，不重新实现协议。

### 消息映射函数

每个 backend 需要实现一个 `mapXxxRawToNormalized` 函数，
将 agent 原始输出映射为统一的 `NormalizedMessage`（App 兼容格式）。

**这是每个 agent 唯一需要实现的映射函数**。

旧的 `mapXxxToSessionEnvelopes` 在 Phase 4 完成后可以删除，因为：

- 旧机制：各 agent 维护各自的 envelope mapper → `sendSessionProtocolMessage()` → Server 存 RawRecord
- 新机制：各 agent 只需 `mapXxxRawToNormalized()` → 统一 `NormalizedMessage` → `sendNormalizedMessage()` → Server 直接存 NormalizedMessage

```typescript
// 示例：apps/free/cli/src/backends/codex/mapCodexRawToNormalized.ts

import { createId } from '@paralleldrive/cuid2';

export function mapCodexRawToNormalized(raw: CodexMcpMessage): NormalizedMessage | null {
  const id = createId();
  const createdAt = Date.now();

  if (raw.type === 'message') {
    return {
      id,
      localId: null,
      createdAt,
      isSidechain: false,
      role: 'agent',
      content: [{ type: 'text', text: raw.message, uuid: id, parentUUID: null }],
    };
  }
  if (raw.type === 'tool-call') {
    return {
      id,
      localId: null,
      createdAt,
      isSidechain: false,
      role: 'agent',
      content: [
        {
          type: 'tool-call',
          id: raw.callId,
          name: raw.name,
          input: raw.input,
          description: null,
          uuid: raw.id,
          parentUUID: null,
        },
      ],
    };
  }
  if (raw.type === 'tool-call-result') {
    return {
      id,
      localId: null,
      createdAt,
      isSidechain: false,
      role: 'agent',
      content: [
        {
          type: 'tool-result',
          tool_use_id: raw.callId,
          content: raw.output,
          is_error: false,
          uuid: raw.id,
          parentUUID: null,
        },
      ],
    };
  }
  return null;
}
```

参考实现：现有 `runCodex.ts` 中 `client.onMessage()` 的处理逻辑，
以及 `runOpenCode.ts` 中各消息类型的处理——这些代码即是映射逻辑的来源，
迁移时直接将其提取为独立函数并调整输出格式即可。

**`id` 字段生成规则**：

- 每条消息在 daemon 侧生成一个 cuid2 作为 `id`
- `localId` 为 null（daemon 侧不使用离线 localId）
- `uuid`（content block 级别）可以复用 agent 原始消息中已有的 ID 字段（如 `callId`、`id`）

---

## 文件结构变更

### 新增文件

```
apps/free/cli/src/
│
├── daemon/
│   ├── run.ts                         (现有，Phase 4 修改 spawnSession)
│   ├── controlServer.ts               (现有，Phase 4 后废弃 /session-started)
│   ├── controlClient.ts               (现有，Phase 4 后标记 notifyDaemonSessionStarted 废弃)
│   │
│   ├── sessions/                      ← 新建
│   │   ├── types.ts                   ← NormalizedMessage、AgentType 等
│   │   ├── AgentBackend.ts            ← AgentBackend 接口、AgentStartOpts
│   │   ├── AgentSession.ts            ← 基类
│   │   ├── SessionManager.ts          ← SessionManager 类和 sessionManager 单例
│   │   ├── AgentSessionFactory.ts     ← 工厂注册和创建
│   │   ├── ClaudeSession.ts
│   │   ├── CodexSession.ts
│   │   ├── GeminiSession.ts
│   │   └── OpenCodeSession.ts
│   │
│   └── ipc/                           ← 新建
│       ├── protocol.ts                ← IPCClientMessage / IPCServerMessage
│       ├── IPCServer.ts               ← Unix socket 服务端 + 广播 + 历史缓冲
│       └── IPCClient.ts               ← CLI/TUI 使用的客户端
│
├── backends/                          ← 新建
│   ├── claude/
│   │   └── ClaudeBackend.ts           ← 包装 claudeLocalLauncher + claudeRemoteLauncher
│   ├── codex/
│   │   └── CodexBackend.ts            ← 包装 CodexMcpClient
│   ├── gemini/
│   │   └── GeminiBackend.ts           ← 包装 createGeminiBackend
│   └── opencode/
│       └── OpenCodeBackend.ts         ← 包装 createOpenCodeBackend
│
└── client/                            ← 新建
    ├── CLIClient.ts                   ← CLI 主入口（替代 runXxx 调用）
    ├── CLIRenderer.ts                 ← NormalizedMessage → terminal，所有 agent 通用
    └── InputHandler.ts               ← stdin → IPC send_input
```

### 废弃文件（Phase 4 全部完成后删除）

```
apps/free/cli/src/
├── claude/runClaude.ts
├── codex/runCodex.ts
├── gemini/runGemini.ts
└── opencode/runOpenCode.ts
```

---

## 本地模式

所有 agent 必须支持本地模式（终端交互）。

| Agent    | 本地模式实现                                                               | 注意事项         |
| -------- | -------------------------------------------------------------------------- | ---------------- |
| Claude   | `ClaudeBackend` 调用 `claudeLocalLauncher`，PTY 输出经 IPC `pty_data` 转发 | PTY proxy 见下   |
| Codex    | `CodexBackend` 本身 headless，CLIRenderer 用 Ink `CodexDisplay`            | backend 不需修改 |
| Gemini   | `GeminiBackend` 本身 headless，CLIRenderer 用 Ink `GeminiDisplay`          | backend 不需修改 |
| OpenCode | `OpenCodeBackend` 本身 headless，CLIRenderer 用 Ink `OpenCodeDisplay`      | backend 不需修改 |

**Claude PTY proxy**：

```typescript
// CLIRenderer 中，收到 pty_data 时解码 base64 后写 stdout
// daemon 侧 ClaudeBackend 将 PTY 原始 Buffer 以 base64 编码后放入 msg.data，
// 这里还原为 Buffer 写入，保留所有控制字节（颜色、光标移动等）
ipcClient.on('pty_data', msg => {
  process.stdout.write(Buffer.from(msg.data, 'base64'));
});

// InputHandler 在 raw mode 下，把 keypress 转为 pty_data 发给 daemon
// ⚠️ PTY 是二进制流，必须用 base64 编码：chunk.toString() 默认 UTF-8，
// 会损坏非 UTF-8 字节序列（箭头键 ESC[A、功能键、Ctrl 序列等）
process.stdin.setRawMode(true);
process.stdin.on('data', chunk => {
  ipcClient.send({ type: 'pty_data', sessionId, data: chunk.toString('base64') });
});
```

**CLIRenderer 核心实现**：

```typescript
// apps/free/cli/src/client/CLIRenderer.ts（新建）

export class CLIRenderer {
  // 通用渲染：对所有 agent 生效（按 role 分发，与 App NormalizedMessage 格式对齐）
  render(msg: NormalizedMessage): void {
    if (msg.role === 'user') {
      // 用户输入回显（可选）
      process.stdout.write(`\n> ${msg.content.text}\n`);
    } else if (msg.role === 'agent') {
      for (const block of msg.content) {
        if (block.type === 'text') {
          process.stdout.write(block.text);
        } else if (block.type === 'thinking') {
          // 可通过 --no-thinking 参数关闭；TUI 可单独折叠显示
        } else if (block.type === 'tool-call') {
          process.stdout.write(`\n[${block.name}] ${JSON.stringify(block.input)}\n`);
        } else if (block.type === 'tool-result') {
          if (block.is_error) process.stderr.write(`[error] ${JSON.stringify(block.content)}\n`);
          else process.stdout.write(String(block.content));
        }
      }
    } else if (msg.role === 'event') {
      this.handleAgentEvent(msg.content);
    }
  }

  private handleAgentEvent(event: AgentEvent): void {
    switch (event.type) {
      case 'ready':
        // agent idle，可更新状态栏
        break;
      case 'switch':
        process.stdout.write(`\n[mode: ${event.mode}]\n`);
        break;
      case 'limit-reached':
        process.stderr.write(`\n[rate limited until ${new Date(event.endsAt).toISOString()}]\n`);
        break;
      case 'message':
        process.stdout.write(`\n[${event.message}]\n`);
        break;
    }
  }

  // attach 时先处理历史回放
  onHistory(msgs: NormalizedMessage[]): void {
    for (const msg of msgs) this.render(msg);
  }
}
```

---

## 迁移步骤

每个阶段独立可验证，不推倒重来。

### Phase 1：定义接口和类型（零风险）

1. 新建以下文件（只有类型定义，无运行时代码）：
   - `daemon/sessions/types.ts`
   - `daemon/sessions/AgentBackend.ts`
   - `daemon/ipc/protocol.ts`

2. 在 `AgentBackend.ts` 中定义 `AgentSessionOpts`（确认 `credential` 单数命名）

**验收**：`pnpm tsc --noEmit` 通过，无运行时变更。

---

### Phase 2：抽取 AgentSession 基类

从四个 `runXxx.ts` 提取公共逻辑到基类。

**提取清单**：

| 逻辑                           | 来源                  | 基类中的位置                      |
| ------------------------------ | --------------------- | --------------------------------- |
| `ApiClient.create()`           | 所有 runXxx           | `initialize()`                    |
| `api.getOrCreateSession()`     | 所有 runXxx           | `initialize()`                    |
| `setupOfflineReconnection()`   | codex/gemini/opencode | `initialize()`                    |
| `startFreeServer()`            | 所有 runXxx           | `initialize()`                    |
| `notifyDaemonSessionStarted()` | 所有 runXxx           | `initialize()`                    |
| `registerKillSessionHandler()` | claude/codex          | `run()`（用 `rpcHandlerManager`） |
| SIGTERM → pendingExit          | 所有 runXxx           | `handleSigterm()`                 |
| SIGINT → shouldExit            | 所有 runXxx           | `handleSigint()`                  |
| flush + close + stop           | 所有 runXxx           | `shutdown()`                      |

**注意**：

- runClaude 目前用 `startOfflineReconnection`（底层），Phase 2 统一改为
  `setupOfflineReconnection`（高层封装）
- Hook Server 不进基类，在 `ClaudeSession.initialize()` / `shutdown()` 中 override

**验收**：四个 `runXxx.ts` 各自代码量减少 60%+，现有测试通过，行为不变。

---

### Phase 3：实现各 AgentBackend

对每个 agent 新建 `backends/xxx/XxxBackend.ts`，实现 `AgentBackend` 接口。

**包装策略（重要）**：

- **不重新实现 agent 协议**，而是包装现有代码
- `ClaudeBackend`：包装 `claudeLocalLauncher` + `claudeRemoteLauncher`
  - 两个 launcher 实际接受 `Session`（`claude/session.ts`），不是 `ApiSessionClient`
  - Phase 3 需要梳理如何从 `AgentStartOpts.session`（ApiSessionClient）构造 `Session` 对象
  - launcher 目前通过 session 内部的 messageQueue 接收消息
  - 需要评估是否要对 launcher 做轻量包装以支持外部 `sendMessage()`，
    或保持现有机制（优先保持现有机制）
- `CodexBackend`：包装 `CodexMcpClient`
- `GeminiBackend`：包装 `createGeminiBackend()`
- `OpenCodeBackend`：包装 `createOpenCodeBackend()`

**同步新建消息映射函数**：

每个 backend 新建 `mapXxxRawToNormalized(raw) → NormalizedMessage | null`（**唯一需要实现的映射函数**），
参考现有 `runXxx.ts` 中 `client.onMessage()` / `backend.onMessage()` 的处理逻辑。
输出格式必须与 App 的 `NormalizedMessage`（`typesRaw.ts`）兼容。

**同步在 ApiSessionClient 新增 `sendNormalizedMessage()`**：

在 `apps/free/cli/src/api/apiSession.ts` 中新增：

```typescript
// 序列化为 JSON → 加密 → 通过 WebSocket 以新消息类型 'normalized_message' 发往 Server
// Server 端需在 Phase 3 同步支持此消息类型，直接以 NormalizedMessage 格式存 DB
sendNormalizedMessage(msg: NormalizedMessage): void
```

**验收**：各 backend 单元测试通过，输出符合 `NormalizedMessage`；`sendNormalizedMessage` 端到端测试通过。

---

### Phase 4：进程所有权转移到 Daemon

这是改动量最大的阶段，建议用 feature flag `DAEMON_OWN_SESSIONS=1` 灰度。

**4.1 实现 IPCServer 和 SessionManager**

- 实现 `daemon/ipc/IPCServer.ts`（见上方代码）
- 实现 `daemon/sessions/SessionManager.ts`（见上方代码）
- 在 `daemon/run.ts` 启动时初始化：
  ```typescript
  // configuration.daemonSocketPath 需新增到 Configuration 类：
  // this.daemonSocketPath = join(this.freeHomeDir, 'daemon.sock');
  // 文件：apps/free/cli/src/configuration.ts
  //
  // spawnSession 传入 IPCServer，使 IPC spawn_session 消息可触发会话创建（无循环依赖）
  export const daemonIPCServer = new IPCServer(sessionManager, spawnSession);
  await daemonIPCServer.start(configuration.daemonSocketPath);
  AgentSessionFactory.register('claude', ClaudeSession);
  // ... 注册其他 agent
  ```

**循环依赖预防**（遵守 CLAUDE.md 的 zero-cycles 规则）：

涉及三条潜在循环边，均通过注入打断：

1. **IPCServer → SessionManager**：`IPCServer` 构造时注入 `SessionManager`，不静态 import 单例
2. **AgentSession → daemonIPCServer**：`AgentSessionOpts.broadcast` 回调注入；`pipeBackendOutput` 调用 `this.opts.broadcast()`，不 import `daemonIPCServer`（修正 28）
3. **IPCServer → spawnSession**：`IPCServer` 构造时注入 `onSpawnSession` 回调（修正 18）

```typescript
// daemon/run.ts 启动时按顺序初始化：
// ⚠️ 顺序关键：sessionManager 依赖 daemonIPCServer.evictHistory，
// 因此先声明 daemonIPCServer（var 提升），再创建 sessionManager（回调中闭包捕获）
// 实际上 JS 声明提升确保顺序正确，但建议将 daemonIPCServer 的 let 改为 const 并在 run() 入口初始化
export const sessionManager = new SessionManager(id => daemonIPCServer.evictHistory(id));
export const daemonIPCServer = new IPCServer(sessionManager, spawnSession);
// AgentSession 实例化时注入 broadcast 回调（见 spawnSession 实现）
// 三者均从 daemon/run.ts 导出，其他模块从此处导入，不在各自文件中创建单例
```

`daemonIPCServer` 不在 `IPCServer.ts` 文件内声明（避免 IPCServer → sessionManager 的静态 import 边），
而是在 `daemon/run.ts` 中实例化后统一导出。

完成后运行 `npx madge --circular --extensions ts,tsx apps/free/cli/src/` 验证。

**4.2 修改 daemon/run.ts 的信号处理**

```typescript
// daemon/run.ts 中现有的信号处理（已有）
process.on('SIGTERM', () => {
  requestShutdown('os-signal');
});

// 修改 requestShutdown，加入 session 通知
const requestShutdown = async (reason: string) => {
  sessionManager.handleSigterm(); // 新增
  // ... 现有逻辑
};
```

**4.3 修改 daemon/run.ts 的 spawnSession()**

```typescript
// 替代现有的"spawn CLI 子进程 + 等待 webhook"机制

const spawnSession = async (options: SpawnSessionOptions): Promise<SpawnSessionResult> => {
  const agentType = options.agent ?? 'claude';

  const agentSession = AgentSessionFactory.create(agentType, {
    credential: await loadDaemonCredential(options), // 见下方说明
    startedBy: options.startedBy ?? 'daemon',
    cwd: options.directory,
    resumeSessionId: options.resumeClaudeSessionId,
    sessionTag: options.sessionTag,
    env: options.environmentVariables,
    // 注入 broadcast 回调，打破 AgentSession → daemonIPCServer 循环依赖
    // AgentSession 只持有此函数引用，不 import daemon/run.ts
    broadcast: (sessionId, msg) => daemonIPCServer.broadcast(sessionId, msg),
  });

  // initialize 可能抛异常（Auth 失败、网络错误等），需要捕获
  try {
    await agentSession.initialize();
  } catch (err) {
    logger.error('[daemon] AgentSession init failed', { error: String(err) });
    return { type: 'error', error: String(err) };
  }

  // sessionId 在 initialize() 完成后才可访问
  const sessionId = agentSession.sessionId;
  sessionManager.register(sessionId, agentSession);

  // 后台异步运行，不阻塞 spawnSession 返回
  agentSession
    .run()
    .catch(err => {
      logger.error('[daemon] AgentSession crashed', { sessionId, error: String(err) });
      // crash 时主动广播 archived 状态，避免已 attach 的 CLI 永远挂起等待输出（修正 20）
      daemonIPCServer.broadcast(sessionId, {
        type: 'session_state',
        sessionId,
        state: 'archived',
      });
    })
    .finally(() => {
      // run() 内部 finally 已调用 shutdown，这里只需清理 registry 引用
      sessionManager.unregister(sessionId);
    });

  return { type: 'success', sessionId };
};
```

**关于 credentials 获取（loadDaemonCredential 实现思路）**：

daemon 已有环境变量构建逻辑（`daemon/run.ts` 第 360-438 行），包括从 settings
的 profiles 加载 auth token。新建 `loadDaemonCredential(options: SpawnSessionOptions)`
函数，伪代码如下：

```typescript
async function loadDaemonCredential(options: SpawnSessionOptions): Promise<Credentials> {
  // 1. 优先从 options.environmentVariables 获取（手机端传入）
  const token = options.environmentVariables?.ANTHROPIC_AUTH_TOKEN ?? options.token;
  // 2. fallback 到 settings 中 activeProfile 的 token
  const settings = await readSettings();
  const profile = settings.profiles.find(p => p.id === settings.activeProfileId);
  return {
    machineId: settings.machineId!,
    secretKey: await readSecretKey(),
    token: token ?? profile?.token ?? '',
  };
}
```

**4.4 修改 CLI 入口（index.ts）**

用户运行 `free` 时：

1. 确保 daemon 运行（现有逻辑保留）
2. 通过 IPC `spawn_session` 请求 daemon 创建 session
3. 通过 IPC `attach` 订阅输出流
4. `CLIRenderer.onHistory()` 处理历史回放
5. `CLIRenderer.render()` 处理实时输出
6. `InputHandler` 读取 stdin，通过 IPC `send_input` 转发

**4.5 废弃 webhook 机制**

Phase 4 完成后：

- `controlServer.ts` 的 `/session-started` 端点标记废弃，30 天后删除
- `notifyDaemonSessionStarted()` 标记 `@deprecated`（Phase 4 内 spawnSession 仍在使用）

**验收**：

- `kill -9 <cli_pid>` 后，daemon 中 agent 继续运行
- 重新运行 `free`，`attach` 后收到历史消息，看到实时输出
- 手机端任务不受 CLI crash 影响
- `pnpm test` 全部通过

---

### Phase 5：CLIRenderer 完善 + 本地模式

1. **CLIRenderer 完整实现**：处理全部 `NormalizedMessage` 类型（见上方代码）

2. **Claude PTY proxy**：
   - `IPCServer` 支持 `pty_data` / `pty_resize` 消息
   - `ClaudeBackend` 把 PTY 原始字节流通过 `daemonIPCServer.broadcast()` 发出
   - `CLIRenderer` 收到 `pty_data` 直接写 stdout

3. **Codex / Gemini / OpenCode 本地模式**：
   - backend 本身 headless，无需修改
   - `CLIRenderer` 根据 `agentType` 选择渲染方式（Ink 组件 or 纯文本）

4. **attach / reattach 验证**：
   - CLI 断开重连，收到历史缓冲 500 条，状态正确恢复
   - 多个终端同时 attach 同一 session，输出同步

**验收**：全部四个 agent 可在终端本地交互，CLI 断开不中断 agent。

---

## 添加新 Agent

迁移完成后，新增 agent 只需：

```typescript
// 1. 定义 mode 类型
interface NewAgentMode {
  model: string;
}

// 2. 实现 backend（只关心协议）
export class NewAgentBackend implements AgentBackend {
  readonly agentType = 'newagent' as const;
  readonly output = new PushableAsyncIterable<NormalizedMessage>();

  async start(opts: AgentStartOpts): Promise<void> {
    /* 启动 SDK/MCP/ACP */
  }
  async sendMessage(text: string): Promise<void> {
    /* 发消息 */
  }
  async abort(): Promise<void> {
    /* 中止 */
  }
  async stop(): Promise<void> {
    this.output.end();
  }
}

// 3. 实现 session（约 15 行）
export class NewAgentSession extends AgentSession<NewAgentMode> {
  createBackend() {
    return new NewAgentBackend();
  }
  createModeHasher() {
    return (m: NewAgentMode) => m.model;
  }
  protected buildMetadata(): Metadata {
    return { agentType: 'newagent', startedBy: this.opts.startedBy, cwd: this.opts.cwd };
  }
  protected buildInitialState(): AgentState {
    return {};
  }
}

// 4. 更新 AgentType 联合类型（daemon/sessions/types.ts）
// export type AgentType = 'claude' | 'codex' | 'gemini' | 'opencode' | 'newagent';
// ⚠️ 每次新增 agent 必须同步更新此类型，否则 AgentSessionFactory.create() 会抛出 Unknown agentType

// 5. 注册（daemon/run.ts 启动时）
AgentSessionFactory.register('newagent', NewAgentSession);

// 6. index.ts 加几行入口
// 完成：session 创建、离线重连、消息循环、cleanup、IPC 广播、DB 存储全部自动继承
// 不需要实现 routeToServerSession 或任何 envelope mapper
```

---

## 关键设计决策

### 为什么用继承而不是组合？

`runXxx.ts` 的各部分高度耦合（离线重连需要持有 session，cleanup 需要持有
freeServer），组合方案会产生大量 wiring 代码。基类持有共享状态，子类通过
protected 访问，更直接。

### NormalizedMessage 为什么与 App 共用同一格式？

验证后的结论：daemon 使用与 `apps/free/app/sources/sync/typesRaw.ts` 相同的
`NormalizedMessage` 格式（role:'user' | role:'agent' | role:'event'，含 id/localId/createdAt 等存储字段）。

好处：

1. **零二次转换**：Server 存储 NormalizedMessage，App 拉取后直接渲染，不需要 `normalizeRawMessage()`
2. **减少代码**：删除所有 `mapXxxToSessionEnvelopes`，只保留 `mapXxxRawToNormalized`
3. **统一流水线**：整个系统有唯一的"消息格式"，从 daemon 到 App 端对端一致

为什么不放 `packages/core`：
类型定义在 `apps/free/cli/src/daemon/sessions/types.ts` 和 App 中各自独立定义，
但内容保持同步。避免跨 app/package 的依赖复杂性，App 端以其定义为 source of truth。

> ⚠️ **类型漂移风险**：两份类型手工同步是长期隐患。App 更新字段后 CLI 不更新，
> 编译不会报错，只会在运行时出现数据丢失或格式错误。
>
> **缓解措施（Phase 1 验收前必须完成）**：
>
> 在 CI 中新增 `scripts/check-normalized-message-sync.ts` 脚本，比较两份类型结构：
>
> ```typescript
> // scripts/check-normalized-message-sync.ts
> // 用 typescript-json-schema 或 zod 生成两份 schema，逐字段 deep-equal 比对
> // 任何字段不一致时 exit(1) 阻断 CI
> import { execSync } from 'child_process';
> // 对比 apps/free/app/sources/sync/typesRaw.ts 与
> //      apps/free/cli/src/daemon/sessions/types.ts 中的 NormalizedMessage
> // 如果两者结构不一致，CI 失败并输出 diff
> ```
>
> 这是在不迁移到 `packages/core` 的前提下保证类型一致性的最低要求。
> 后续迁移到 `packages/core` 是更根本的解法，但需要评估 App 侧的 bundler 影响。

### 为什么 IPC 用 Unix socket 而不是 HTTP？

低延迟、天然 streaming、不占用网络端口、与 daemon control server（Fastify HTTP）不冲突。

### 现有 webhook 机制何时废弃？

Phase 4 完成后，spawnSession 改为直接实例化 AgentSession，不再需要等待 CLI 子进程
的 webhook 回调。`/session-started` 端点和 `notifyDaemonSessionStarted` 在 Phase 4
验收通过后标记废弃，30 天观察期后删除。

---

## 风险与缓解

| 风险                                                                                 | 影响   | 缓解                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude launcher 接受 `Session` 而非 `ApiSessionClient`，Phase 3 需要构造包装         | 高     | Phase 3 实现 `buildClaudeSession(opts, queue)` 辅助函数；launcher 内部通过注入的 queue 接收消息，`sendMessage` 直接 push 到同一 queue                                                                                     |
| Daemon 进程内 agent crash 影响稳定性                                                 | 中     | `AgentSession.run()` 用 try-finally 包裹，crash 只影响自身 session；`pipeBackendOutput` 有独立错误处理                                                                                                                    |
| Phase 4 迁移期间新旧 spawn 路径并存                                                  | 复杂度 | feature flag `DAEMON_OWN_SESSIONS=1`，单 agent 灰度切换                                                                                                                                                                   |
| PTY proxy 延迟或乱码                                                                 | 低     | Phase 5 单独迭代，Phase 4 先用纯文本模式                                                                                                                                                                                  |
| Unix socket 权限（多用户环境）                                                       | 低     | socket 文件权限 0600                                                                                                                                                                                                      |
| Unix socket 残留文件导致 daemon 无法重启                                             | 中     | `IPCServer.start()` 绑定前先 `unlinkSync` 清理旧文件                                                                                                                                                                      |
| `configuration.daemonSocketPath` 不存在                                              | 中     | Phase 4.1 在 `configuration.ts` 中添加：`join(this.freeHomeDir, 'daemon.sock')`                                                                                                                                           |
| 循环依赖（AgentSession → daemonIPCServer 单例，daemon/run.ts 导入链形成环）          | 高     | `AgentSessionOpts` 新增 `broadcast` 回调字段；`spawnSession` 实例化时注入 `(id, msg) => daemonIPCServer.broadcast(id, msg)`；`pipeBackendOutput` 调用 `this.opts.broadcast()`，不直接 import `daemonIPCServer`（修正 28） |
| `sendInput()` 在 initialize() 完成前静默丢弃消息                                     | 中     | 新增 `preInitQueue` 暂存（上限 32 条）；`initialize()` 末尾 replay；超出上限时打 warn（修正 29）                                                                                                                          |
| History buffer 使用 `Array.shift()` O(n) 开销                                        | 中     | 新增 `HistoryRing` 环形缓冲类（指针游标，O(1) 写入）；`attach` 回放调用 `ring.toArray()`（修正 30）                                                                                                                       |
| IPC broadcast 忽略背压，verbose agent 下 socket 缓冲区可能满                         | 中     | `socket.write()` 返回值检查；缓冲区满时记录 warn 日志；消息不丢失（TCP 层缓冲），日志用于容量规划；未来可加 per-socket pendingQueue + drain 监听（修正 31）                                                               |
| `onSessionSwap` 中 `this.session` 在 freeServer 未就绪时已更新（与修正 21 注释矛盾） | 中     | 先 `await startFreeServer(newSession)` 得到 `newFreeServer`，再同一 tick 内原子赋值；整个回调包在 try-catch 中，startFreeServer 失败时保留旧 session 不修改任何引用（修正 21 + 修正 34）                                  |
| `ClaudeBackend.abort()` 的 abortController 未接入 launcher，abort 信号实际无效       | 中     | 代码注释明确说明：目前 abort 效果依赖关闭内层 messageQueue；Phase 3 若需更强中止能力需在 launcher 侧增加 AbortSignal 支持（修正 32）                                                                                      |
| `ClaudeBackend.onSessionChange` 为空实现，重连后 launcher 持旧 session 引用          | 中     | `buildClaudeSession` 返回对象需支持 `updateClient?(newSession)` 方法；`onSessionChange` 调用 `this.claudeSession?.updateClient?.(newSession)`（修正 33）                                                                  |
| `OpenCodeMode` 未导出，无法跨文件使用                                                | 中     | Phase 2 迁移时将其移至 `opencode/types.ts` 并 export                                                                                                                                                                      |
| 历史缓冲内存随 session 数量累积                                                      | 中     | `SessionManager.unregister()` 通过注入的 `onEvictHistory` 回调调用 `daemonIPCServer.evictHistory()`；SessionManager 不直接引用 daemonIPCServer 单例（修正 34b）                                                           |
| 重连时 backend 持有旧 session 引用                                                   | 中     | `AgentBackend` 接口新增可选 `onSessionChange?(newSession)` 方法；`onSessionSwap` 回调中调用                                                                                                                               |
| `pipeBackendOutput` 异常静默吞掉导致消息丢失                                         | 高     | 加 try-catch，捕获后设置 `shouldExit`、关闭 messageQueue，由 run() finally 执行 shutdown                                                                                                                                  |
| `pipeBackendOutput` drain 期间 session 被 close                                      | 高     | `outputPipeFinished` Promise 跟踪 drain，`shutdown()` await 后再 close（修正 16）                                                                                                                                         |
| `sendInput()` 绕过队列导致 SIGTERM 失效 + 消息乱序                                   | 高     | 改为 `messageQueue.push()`，两条输入路径统一（修正 14）                                                                                                                                                                   |
| 移动端消息未注册 `onUserMessage` 被静默丢弃                                          | 高     | `initialize()` 中注册回调，`onSessionSwap` 时重新注册（修正 15）                                                                                                                                                          |
| IPCClient 断线后 CLI 完全失联                                                        | 中     | 指数退避重连 + `onReconnect` 触发重新 attach（修正 17）                                                                                                                                                                   |
| `spawn_session` IPC 处理产生循环依赖                                                 | 中     | 构造注入 `onSpawnSession` 回调（修正 18）                                                                                                                                                                                 |
| `onSessionSwap` 与 `pipeBackendOutput` 并发竞态                                      | 中     | 见修正 21 修订版（上方）                                                                                                                                                                                                  |
| Agent crash 时已 attach 的 CLI 永远挂起                                              | 高     | `spawnSession` 的 `.catch()` 广播 `session_state: 'archived'`，CLI 收到后退出等待（修正 20）                                                                                                                              |
| `IPCServer.abort` 绕过封装访问 private backend                                       | 高     | `AgentSession` 暴露 public `abort()` 方法，IPCServer 改为 `session?.abort()`（修正 19）                                                                                                                                   |
| `abort()` 只关闭 backend 内层队列，外层 messageQueue 仍阻塞                          | 高     | `abort()` 同时调用 `this.messageQueue?.close()`，确保外层 run() 循环立即退出（修正 22）                                                                                                                                   |
| `onSessionSwap` 覆盖 freeServer 引用导致旧端口泄漏                                   | 中     | 赋值前先调用 `this.freeServer?.stop()`（修正 23）                                                                                                                                                                         |
| `IPCClientMessage` 缺少 `pty_data` / `pty_resize` 定义                               | 中     | 已补充至 `IPCClientMessage` 类型；`IPCServer.handleMessage` Phase 5 同步处理这两个分支（修正 24）                                                                                                                         |
| `IPCClient.on()` 后注册的 handler 覆盖前者                                           | 低     | 改为 `Map<type, Set<handler>>`，新增 `off()` 方法；派发时 `forEach` 调用所有监听器（修正 25）                                                                                                                             |
| `CodexBackend.startOpts` 未声明字段，sendMessage 时 undefined crash                  | 高     | 声明 `private startOpts!: AgentStartOpts`，在 `start()` 首行赋值（修正 26）                                                                                                                                               |
| 重连窗口期 `send_input` 静默丢失，用户无感知                                         | 低     | `IPCClient` 新增 `pendingSendInputs` 缓冲（上限 16 条）；重连成功后 `onReconnect` 触发 attach，随即重发缓冲消息；超出上限时记录 error（修正 27，已升级为实现）                                                            |

---

## 设计修正摘要（相对初版 RFC）

以下为经审查后的关键修正，实现时以本节为准：

### 修正 1：`AgentSession.run()` 用 try-finally 保证 shutdown

```typescript
try {
  while (!this.shouldExit) { ... }
} finally {
  await this.shutdown('loop_ended');
}
```

### 修正 2：`shutdown()` 加幂等保护

```typescript
if (this.isShuttingDown) return;
this.isShuttingDown = true;
this.messageQueue?.close(); // 使 waitForMessagesAndGetAsString 立即返回 null
```

### 修正 3：`pipeBackendOutput()` 加 try-catch

```typescript
try {
  for await (const msg of this.backend.output) { ... }
} catch (err) {
  logger.error('[AgentSession] output pipe broken', { ... });
  this.shouldExit = true;
  this.messageQueue?.close();  // 触发 run() 退出，由 finally 执行 shutdown
}
```

### 修正 4：离线模式 freeServer null 检查

```typescript
// 字段类型改为 | undefined，buildBackendStartOpts 使用可选链
mcpServerUrl: this.freeServer?.url ?? '',
```

### 修正 5：`backend` 改为 private，暴露 `sendInput()` 公共方法

```typescript
private backend!: AgentBackend;

sendInput(text: string): void {
  this.backend?.sendMessage(text).catch(err => logger.error(...));
}
```

IPCServer 的 `send_input` 处理改为 `session?.sendInput(msg.text)`。

### 修正 6：`SessionManager` 加 `unregister()` 方法 + 注入 `onEvictHistory`（见修正 35）

```typescript
// onEvictHistory 注入，打破 SessionManager → daemonIPCServer 循环依赖
constructor(private readonly onEvictHistory: (sessionId: string) => void = () => {}) {}

unregister(sessionId: string): void {
  this.sessions.delete(sessionId);
  this.onEvictHistory(sessionId);  // 不直接引用 daemonIPCServer 单例
}
```

`spawnSession` 的 crash handler 改为 `.finally(() => sessionManager.unregister(sessionId))`。

### 修正 7：`IPCServer` 启动前清理残留 socket 文件

```typescript
try {
  fs.unlinkSync(socketPath);
} catch {}
```

### 修正 8：`IPCServer` 改为构造注入 `SessionManager` 和 `spawnSession`

`daemonIPCServer` 不在 `IPCServer.ts` 内创建，在 `daemon/run.ts` 中：

```typescript
export const sessionManager = new SessionManager();
export const daemonIPCServer = new IPCServer(sessionManager, spawnSession);
```

`spawnSession` 通过回调注入而非直接 import，避免 `IPCServer → daemon/run.ts` 的循环依赖边。

### 修正 9：`AgentBackend` 接口加可选 `onSessionChange?`

重连时 `AgentSession` 通知 backend 更新内部 session 引用，避免消息发向旧 session。

### 修正 10：`AgentSessionOpts` 补充 `permissionMode` 和 `model`

`buildBackendStartOpts()` 透传到 `AgentStartOpts`，backend 可正确配置 model 和权限模式。

### 修正 11：`handleSigint()` 同步关闭 messageQueue

```typescript
handleSigint(): void {
  this.shouldExit = true;
  this.messageQueue?.close();  // 使消息循环立即退出，不等下一条消息
}
```

### 修正 12：`ClaudeSession.shutdown()` 用 try-finally 清理 hookServer

```typescript
try {
  await super.shutdown(reason);
} finally {
  this.hookServer?.stop();
  if (this.hookSettingsFilePath) cleanupHookSettingsFile(this.hookSettingsFilePath);
}
```

### 修正 13：`IPCServer` 加 `evictHistory()` 方法 + 连接错误处理

session 结束时释放历史缓冲；socket 错误事件有对应处理防止 unhandled。

### 修正 14：`sendInput()` 改为推入 messageQueue，不直连 backend

原实现直接调用 `backend.sendMessage()`，绕过消息队列，导致：

1. 消息不经过 `pendingExit` 检查，SIGTERM 优雅退出失效
2. `AgentSession.run()` 主循环的 `messageQueue` 永远没有消息，形同死循环
3. 移动端消息（`onUserMessage`）和 CLI 消息走不同路径，顺序无保障

修正：`sendInput()` 改为 `this.messageQueue.push(text, this.defaultMode())`，
与移动端 `onUserMessage` 回调统一收敛到同一队列。

```typescript
sendInput(text: string): void {
  if (!this.messageQueue) return;
  this.messageQueue.push(text, this.defaultMode());
}
```

### 修正 15：`AgentSession` 注册 `session.onUserMessage()` 处理移动端消息

原代码只定义了 CLI 入口 `sendInput()`，未注册 `onUserMessage` 回调，
导致移动端通过 Server → WebSocket 发来的用户消息被完全丢弃。

修正：在 `initialize()` 完成（获得 `this.session`）后注册回调：

```typescript
this.session.onUserMessage(msg => {
  if (!this.messageQueue) return;
  const mode = this.extractMode(msg);
  this.messageQueue.push(msg.content.text, mode);
});
```

同时在 `onSessionSwap` 中对新 session 重新注册（重连场景）。

新增抽象方法：

- `abstract defaultMode(): TMode` — CLI 输入无 meta 时使用的默认模式
- `protected abstract extractMode(message: UserMessage): TMode` — 从移动端消息 meta 提取模式

### 修正 16：`pipeBackendOutput()` 改为保存 Promise，`shutdown()` 等待 drain

原代码 `pipeBackendOutput()` 是 fire-and-forget，`shutdown()` 在 `backend.stop()` 后
直接调用 `session.close()`，此时 for-await 循环可能仍在 drain 剩余消息，
导致消息发往已关闭的 session。

修正：

```typescript
// pipeBackendOutput() 保存 Promise
this.outputPipeFinished = (async () => { for await (const msg of ...) { ... } })();

// shutdown() 中 await drain
await this.backend.stop();      // 触发 output.end()
await this.outputPipeFinished;  // 等 for-await 退出，所有消息已发出
await this.session.flush();
await this.session.close();
```

### 修正 17：`IPCClient` 加指数退避重连

原实现无重连逻辑，daemon 重启或 socket 暂时不可用会导致 CLI 完全失联。

修正：连接断开后自动以 500ms 起步、最大 10s 指数退避重连；
重连成功后触发 `onReconnect` 回调，由 `CLIClient` 重新 attach session（历史缓冲自动恢复）。

### 修正 18：`IPCServer` `spawn_session` 通过注入回调处理

原代码 `handleMessage` 中 `spawn_session` 未实现，且如直接 import `daemon/run.ts`
会产生循环依赖（`IPCServer` → `daemon/run.ts` → `IPCServer`）。

修正：`IPCServer` 构造时注入 `onSpawnSession` 回调函数，
`handleMessage` 通过回调触发 session 创建，无静态 import 依赖。

### 修正 19：`AgentSession` 暴露 public `abort()` 方法

原代码 `IPCServer.handleMessage` 的 `abort` case 直接访问 `session?.backend?.abort()`，
违反"backend 是 private"的约定（修正 5），形成文档内部矛盾。

修正：在 `AgentSession` 基类新增：

```typescript
abort(): Promise<void> {
  this.shouldExit = true;
  return this.backend?.abort() ?? Promise.resolve();
}
```

`IPCServer` 改为 `session?.abort()`，完全不感知 backend 内部实现。

### 修正 20：`spawnSession` crash 时广播 `session_state: 'archived'`

原代码 crash 时只 log，已 attach 的 CLI 会永远挂起等待输出，无任何错误提示。

修正：在 `.catch()` 中主动广播：

```typescript
agentSession
  .run()
  .catch(err => {
    logger.error('[daemon] AgentSession crashed', { sessionId, error: String(err) });
    daemonIPCServer.broadcast(sessionId, {
      type: 'session_state',
      sessionId,
      state: 'archived',
    });
  })
  .finally(() => sessionManager.unregister(sessionId));
```

`CLIClient` 收到 `session_state: 'archived'` 后退出 attach 等待，向用户显示错误。

### 修正 21：`onSessionSwap` 先完成新 session 初始化再切换引用，消除并发竞态

`this.session` 赋值与 `pipeBackendOutput` for-await 循环并发执行时，pipe 可能用旧
session（已 close）发送最后几条消息。利用 JavaScript 单线程事件循环，将
`this.session` 的赋值放在所有 `await` 之后、回调末尾，确保在同一 microtask 内完成：

```typescript
onSessionSwap: async (newSession) => {
  try {
    // 先完成所有异步初始化（freeServer、onUserMessage 注册），再切换 session 引用
    this.freeServer?.stop();
    const newFreeServer = await startFreeServer(newSession);
    newSession.onUserMessage((msg) => { ... });
    this.backend?.onSessionChange?.(newSession);
    // 最后一步：原子切换，此时 pipeBackendOutput 的下一次循环迭代才会用新 session
    this.session = newSession;
    this.freeServer = newFreeServer;
    await notifyDaemonSessionStarted(newSession.sessionId, metadata);
  } catch (err) {
    logger.error('[AgentSession] onSessionSwap failed, retaining old session', { error: String(err) });
    // 旧 session 保持不变，等待下次重连
  }
},
```

### 修正 34：`onSessionSwap` 加 try-catch，异常时保留旧 session

`startFreeServer(newSession)` 可能抛出（端口被占用、资源限制等），未捕获时
会导致 `this.session` 和 `this.freeServer` 处于部分更新的不一致状态，
后续 `pipeBackendOutput` 会用错误的 session 发消息。

修正：整个回调体包在 try-catch 中，所有 `await` 在 catch 内部，
异常时 `this.session` / `this.freeServer` 保持旧值不变，
记录 error 日志等待下次重连触发新的 swap 尝试。（见修正 21 的最终代码）

### 修正 35：`SessionManager` 改为注入 `onEvictHistory` 回调

原代码 `SessionManager.unregister()` 直接引用 `daemonIPCServer` 单例：

```typescript
// ❌ 错误：SessionManager.ts → daemon/run.ts 的静态 import 边，形成循环
daemonIPCServer.evictHistory(sessionId);
```

这与 RFC 其他地方（AgentSession 注入 broadcast，IPCServer 注入 spawnSession）
使用的依赖注入模式矛盾，且产生 `SessionManager.ts → daemon/run.ts → SessionManager.ts` 循环依赖。

修正：`SessionManager` 构造函数新增 `onEvictHistory` 可选回调参数：

```typescript
constructor(private readonly onEvictHistory: (sessionId: string) => void = () => {}) {}

unregister(sessionId: string): void {
  this.sessions.delete(sessionId);
  this.onEvictHistory(sessionId);  // 回调注入，不直接引用 daemonIPCServer
}
```

`daemon/run.ts` 初始化时注入：

```typescript
export const sessionManager = new SessionManager(id => daemonIPCServer.evictHistory(id));
```

### 修正 36：PTY 数据改用 base64 编码

`InputHandler` 原代码 `chunk.toString()` 使用 UTF-8，会损坏 PTY 控制序列：
箭头键（`ESC[A`）、功能键、Ctrl 组合键中的非 UTF-8 字节序列会被替换为替换字符。

修正：发送端 `chunk.toString('base64')`，接收端 `Buffer.from(msg.data, 'base64')`：

```typescript
// InputHandler（发送端）
process.stdin.on('data', chunk => {
  ipcClient.send({ type: 'pty_data', sessionId, data: chunk.toString('base64') });
});

// CLIRenderer（接收端）
ipcClient.on('pty_data', msg => {
  process.stdout.write(Buffer.from(msg.data, 'base64'));
});
```

`IPCClientMessage` 和 `IPCServerMessage` 的 `pty_data.data` 字段注释补充说明 base64 编码约定。

### 修正 37：`IPCClient` 重连窗口期 send_input 实现缓冲重发

原设计将 send_input 丢弃标注为"设计限制"，仅 warn 日志，用户无感知。
对于正在 Claude 里输入的用户，重连期间输入内容静默丢失是明确的 bug。

修正：`IPCClient` 新增 `pendingSendInputs` 缓冲（上限 16 条），
重连成功后先触发 `onReconnect`（重新 attach），再按序重发缓冲的 send_input：

```typescript
private pendingSendInputs: Array<Extract<IPCClientMessage, { type: 'send_input' }>> = [];

// send() 中：socket 不可写时缓冲
if (msg.type === 'send_input') {
  if (this.pendingSendInputs.length < this.PENDING_SEND_INPUT_LIMIT) {
    this.pendingSendInputs.push(msg);
  }
}

// scheduleReconnect() 成功后：先 attach，再重发
this.onReconnect?.();
const pending = this.pendingSendInputs.splice(0);
for (const msg of pending) { this.socket.write(JSON.stringify(msg) + '\n'); }
```

`disconnect()` 时清空缓冲，不重发。

### 修正 38：`AgentType` 改为开放字符串类型

原封闭 union `'claude' | 'codex' | 'gemini' | 'opencode'` 在新增 agent 时需要修改类型文件，
但 `AgentSessionFactory` 已支持运行时动态注册，类型层面的封闭性没有保护意义。

修正：

```typescript
export type AgentType = 'claude' | 'codex' | 'gemini' | 'opencode' | (string & {});
```

`string & {}` 保留 IDE 对已知字面量的自动补全，同时允许任意字符串值通过类型检查。
新增 agent 只需 `AgentSessionFactory.register('newagent', NewAgentSession)` 而无需修改 `types.ts`。

---

## 实现归档（2026-03-16）

### 完成状态

Phase 1-6 全部完成，440/440 测试通过，零循环依赖（madge 验证），零 TS 错误。

### 实现目录结构

```
apps/free/cli/src/
├── daemon/
│   ├── sessions/
│   │   ├── AgentSession.ts          基类（990 行）
│   │   ├── AgentBackend.ts          接口定义（93 行）
│   │   ├── AgentSessionFactory.ts   注册工厂（59 行）
│   │   ├── SessionManager.ts        session 注册表（81 行）
│   │   ├── types.ts                 NormalizedMessage, AgentType, AgentEvent（178 行）
│   │   ├── capabilities.ts          SessionCapabilities 类型
│   │   ├── sessionPersistence.ts    崩溃恢复持久化
│   │   ├── ClaudeSession.ts         Claude（local/remote 双模式）
│   │   ├── ClaudeAcpSession.ts      Claude ACP
│   │   ├── CodexSession.ts          Codex
│   │   ├── CodexAcpSession.ts       Codex ACP
│   │   ├── GeminiSession.ts         Gemini
│   │   └── OpenCodeSession.ts       OpenCode
│   ├── ipc/
│   │   ├── IPCServer.ts             Unix socket + HistoryRing（500 条）
│   │   ├── IPCClient.ts             指数退避重连
│   │   └── protocol.ts              IPC 消息类型定义
│   └── run.ts                       Daemon 主进程 + 6 个 agent 注册
│
├── backends/
│   ├── acp/                         共享 ACP 基础设施
│   │   ├── DiscoveredAcpBackendBase.ts   551 行共享基类
│   │   ├── AcpPermissionHandler.ts
│   │   ├── createFreeMcpServerConfig.ts
│   │   ├── modelSelection.ts
│   │   └── mapAcpSessionCapabilities.ts
│   ├── claude/ClaudeBackend.ts      SDK/PTY 双模式
│   ├── claude-acp/ClaudeAcpBackend.ts
│   ├── codex/CodexBackend.ts        MCP 模式
│   ├── codex-acp/CodexAcpBackend.ts
│   ├── gemini/GeminiBackend.ts      ACP
│   └── opencode/OpenCodeBackend.ts  ACP
│
└── client/
    ├── CLIClient.ts                 IPC 客户端，统一入口 runWithDaemonIPC()
    ├── CLIRenderer.ts               agent 无关的终端渲染器
    └── InputHandler.ts              stdin 捕获 + IPC 分发
```

### 已注册的 Agent 类型（6 个）

```typescript
// daemon/run.ts
AgentSessionFactory.register('claude', ClaudeSession);
AgentSessionFactory.register('claude-acp', ClaudeAcpSession);
AgentSessionFactory.register('codex', CodexSession);
AgentSessionFactory.register('codex-acp', CodexAcpSession);
AgentSessionFactory.register('gemini', GeminiSession);
AgentSessionFactory.register('opencode', OpenCodeSession);
```

### IPC 协议消息类型

**Client → Daemon**：`attach` | `detach` | `send_input` | `abort` | `set_model` | `set_mode` | `set_config` | `run_command` | `list_sessions` | `spawn_session` | `pty_data` | `pty_resize` | `switch_mode` | `attach_session`

**Daemon → Client**：`agent_output` | `capabilities` | `session_state` | `session_list` | `spawn_result` | `history` | `pty_data` | `pty_resize` | `error` | `mode_switch`

### 已删除的旧文件

- `src/claude/runClaude.ts` — 被 `ClaudeSession` + `ClaudeBackend` 替代
- `src/codex/runCodex.ts` — 被 `CodexSession` + `CodexBackend` 替代
- `src/gemini/runGemini.ts` — 被 `GeminiSession` + `GeminiBackend` 替代
- `src/opencode/runOpenCode.ts` — 被 `OpenCodeSession` + `OpenCodeBackend` 替代
- `src/agent/acp/AcpBackend.ts` — 被 `DiscoveredAcpBackendBase` 替代
- `src/agent/acp/createAcpBackend.ts` — 被 `backends/acp/` 目录替代

### 与原始设计的偏差

1. **AgentType 扩展**：RFC 原文只定义 `'claude' | 'codex' | 'gemini' | 'opencode'`，实际扩展为 6 个值（增加 `'claude-acp'` / `'codex-acp'`），通过 RFC-006 统一 ACP Backend 引入
2. **AgentBackend 接口扩展**：RFC 设计仅有 `start` / `sendMessage` / `abort` / `stop` / `output` / `onSessionChange`，实际增加了 `capabilities?` 流 + `setModel?` / `setMode?` / `setConfig?` / `runCommand?` + `sendPtyInput?` / `resizePty?`（通过 RFC-005 和 Claude local 模式需求引入）
3. **IPC 消息类型扩展**：RFC 仅设计 `agent_output` / `session_state` / `history` 等基础消息，实际增加了 `capabilities` / `set_model` / `set_mode` / `set_config` / `run_command` / `mode_switch` / `attach_session` 等消息类型
4. **共享 ACP 基础设施**：RFC 设计每个 backend 独立，实际通过 `DiscoveredAcpBackendBase`（551 行）提取共享逻辑，四个 ACP backend 继承同一基类
5. **崩溃恢复**：RFC 未详细设计持久化机制，实际通过 `sessionPersistence.ts` 实现 daemon 重启后 session 恢复（持久化到 `~/.free-dev/sessions/` 目录）
6. **AgentSession 基类规模**：RFC 设计为轻量基类，实际 990 行——包含完整的生命周期管理、离线重连、Free MCP server 启动、消息队列、IPC 广播、capability 管道等
