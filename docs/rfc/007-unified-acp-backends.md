# RFC-007: 统一 ACP Backend — claude-acp / codex-acp

- **Status**: Implemented ✅（Phase 1-4 全部完成）
- **Created**: 2026-03-14
- **Implemented**: 2026-03-16

## 背景与问题

### 当前四个 Backend 协议不统一

| Backend  | 协议      | daemon 层         | core 层工厂               |
| -------- | --------- | ----------------- | ------------------------- |
| Claude   | SDK / PTY | `ClaudeBackend`   | —                         |
| Codex    | MCP       | `CodexBackend`    | —                         |
| Gemini   | **ACP**   | `GeminiBackend`   | `createGeminiBackend()`   |
| OpenCode | **ACP**   | `OpenCodeBackend` | `createOpenCodeBackend()` |

Claude 和 Codex 不走 ACP，导致：

1. **RFC-005 能力发现无法统一**。Gemini / OpenCode 可以直接从 ACP session response 拿 `models` / `modes` / `configOptions`，但 Claude / Codex 需要在 Backend 内部硬编码能力快照——违背了能力发现的初衷
2. **两套消息映射维护成本**。Claude 有 `mapSDKMessageToNormalized`（SDK 格式），Codex 有 `CodexMcpClient`（MCP 格式），各自独立维护。而 ACP backend 共享 `AcpBackend` + 统一 mapper
3. **功能不对等**。ACP 支持的 `set_model` / `set_mode` / `set_config_option` / slash commands / plan 等能力，非 ACP backend 无法获得

### 好消息：core 层已经准备好了

`packages/core/src/implementations/agent/factories.ts` 已有：

| 工厂函数                   | 注册名       | 命令                        | Transport                        |
| -------------------------- | ------------ | --------------------------- | -------------------------------- |
| `createClaudeAcpBackend()` | `claude-acp` | `claude --experimental-acp` | `ClaudeAcpTransport`（10s init） |
| `createCodexBackend()`     | `codex-acp`  | `codex --experimental-acp`  | `CodexTransport`（30s init）     |

Transport handler 也已实现（`ClaudeAcpTransport` / `CodexTransport`，在 `packages/core/src/implementations/transport/default.ts`）。

**缺的只是 daemon 层的 Backend wrapper**——与 `GeminiBackend.ts` / `OpenCodeBackend.ts` 同构的 `ClaudeAcpBackend.ts` / `CodexAcpBackend.ts`。

---

## 目标

新增 `claude-acp` 和 `codex-acp` 两个 daemon 层 Backend，基于已有的 core 层 `AcpBackend`。实现后：

- **四个 ACP backend 共享同一套基础设施**（`AcpBackend` → `AgentMessage` → mapper → `NormalizedMessage`）
- **能力发现统一从 ACP session response 获取**（RFC-005 Phase 2 覆盖全部 agent，无需 Phase 5 的 "内部构建" 退化方案）
- **原有 `ClaudeBackend`（SDK/PTY）和 `CodexBackend`（MCP）保留**，作为非 ACP 后备；用户通过 `agent` 参数选择 `claude` vs `claude-acp`

---

## 设计

### 1. 目录结构

```
apps/free/cli/src/backends/
├── claude/                      # 已有，SDK/PTY 模式
│   ├── ClaudeBackend.ts
│   └── mapSDKMessageToNormalized.ts
├── claude-acp/                  # 新增
│   ├── ClaudeAcpBackend.ts
│   └── mapClaudeAcpRawToNormalized.ts
├── codex/                       # 已有，MCP 模式
│   ├── CodexBackend.ts
│   └── mapCodexRawToNormalized.ts
├── codex-acp/                   # 新增
│   ├── CodexAcpBackend.ts
│   └── mapCodexAcpRawToNormalized.ts
├── gemini/                      # 已有，ACP
│   ├── GeminiBackend.ts
│   └── mapGeminiRawToNormalized.ts
└── opencode/                    # 已有，ACP
    ├── OpenCodeBackend.ts
    └── mapOpenCodeRawToNormalized.ts
```

### 2. ClaudeAcpBackend — 与 GeminiBackend 同构

```typescript
// apps/free/cli/src/backends/claude-acp/ClaudeAcpBackend.ts（伪代码）

import { createClaudeAcpBackend } from '@saaskit-dev/agentbridge';
import type { AgentBackend, AgentStartOpts } from '@/daemon/sessions/AgentBackend';

export class ClaudeAcpBackend implements AgentBackend {
  readonly agentType = 'claude-acp' as const;
  readonly output = new PushableAsyncIterable<NormalizedMessage>();
  readonly capabilities = new PushableAsyncIterable<SessionCapabilities>();
  private acpBackend: IAgentBackend | null = null;
  private acpSessionId: string | null = null;

  async start(opts: AgentStartOpts): Promise<void> {
    this.acpBackend = createClaudeAcpBackend({
      cwd: opts.cwd,
      env: opts.env,
      mcpServers: /* wrap opts.mcpServerUrl if provided */,
    });

    // 消息映射：AgentMessage → NormalizedMessage
    this.acpBackend.onMessage((msg) => {
      const normalized = mapClaudeAcpRawToNormalized(msg);
      if (normalized) this.output.push(normalized);
    });

    // 能力发现：session response → SessionCapabilities
    // (RFC-005 §2 的实现点)
  }

  async sendMessage(text: string): Promise<void> {
    // 首次: startSession(prompt)
    // 后续: sendPrompt(sessionId, prompt)
    // 等待: waitForResponseComplete()
  }

  // setModel / setMode / setConfig → ACP RPC 调用
  async setModel(modelId: string): Promise<void> { /* session/set_model */ }
  async setMode(modeId: string): Promise<void> { /* session/set_mode */ }
  async setConfig(optionId: string, value: string): Promise<void> { /* session/set_config_option */ }

  async abort(): Promise<void> { /* acpBackend.cancel() */ }
  async stop(): Promise<void> { /* acpBackend.dispose(); output.end(); capabilities.end() */ }
}
```

`CodexAcpBackend` 结构完全相同，只替换 `createCodexBackend()` 和对应 mapper。

### 3. Mapper 复用策略

ACP 消息格式（`AgentMessage`）是统一的，各 agent 的差异主要在：

- tool call 的命名惯例不同
- thinking/reasoning 的表达方式不同
- 特殊 metadata 字段不同

考虑两种方案：

**方案 A：每个 agent 独立 mapper**（当前 Gemini / OpenCode 的做法）

- `mapClaudeAcpRawToNormalized.ts`
- `mapCodexAcpRawToNormalized.ts`
- 优点：agent 特殊逻辑互不影响
- 缺点：重复代码

**方案 B：共享基础 mapper + agent 特化层**

- `mapAcpRawToNormalized.ts`（共享）处理通用 ACP → NormalizedMessage
- 各 agent 只覆盖特殊字段
- 优点：DRY
- 缺点：共享代码容易因一个 agent 的需求影响其他 agent

**建议选 A**。四个 mapper 代码量不大，独立维护更安全。如果后续发现 80%+ 代码重复，再提取共享层。

### 4. AgentType 扩展

`types.ts` 已有 `AgentType = 'claude' | 'codex' | 'gemini' | 'opencode' | (string & {})`。

`claude-acp` 和 `codex-acp` 作为新值自动兼容（开放 string 类型），但应加入已知值列表以获得 IDE 提示：

```typescript
export type AgentType =
  | 'claude'
  | 'claude-acp'
  | 'codex'
  | 'codex-acp'
  | 'gemini'
  | 'opencode'
  | (string & {});
```

### 5. AgentSessionFactory 注册

```typescript
// daemon/sessions/AgentSessionFactory.ts

AgentSessionFactory.register('claude-acp', () => new ClaudeAcpBackend());
AgentSessionFactory.register('codex-acp', () => new CodexAcpBackend());
```

### 6. IPC / SpawnSessionOptions

`SpawnSessionOptions.agent` 已是 `AgentType`，直接支持 `'claude-acp'` / `'codex-acp'`。

CLI 侧：

```bash
free start --agent claude-acp    # 用 ACP 模式启动 Claude
free start --agent codex-acp     # 用 ACP 模式启动 Codex
free start --agent claude         # 保持原有 SDK/PTY 模式
free start --agent codex          # 保持原有 MCP 模式
```

App 侧：agent 选择器新增 `claude-acp` / `codex-acp` 选项（或在 UI 上表现为同一个 agent 的 "ACP 模式" 开关）。

### 7. 与 RFC-005 的关系

本 RFC 实现后，RFC-005 的分阶段实施简化为：

| Phase   | 原 RFC-005                            | 本 RFC 后                         |
| ------- | ------------------------------------- | --------------------------------- |
| Phase 2 | 仅 GeminiBackend 能力发现             | **四个 ACP backend 统一能力发现** |
| Phase 5 | Claude/Codex 内部构建能力（退化方案） | **删除，不再需要**                |

所有 ACP backend 共享同一套能力发现逻辑：

1. `start()` 中从 ACP session response 提取 `models` / `modes` / `configOptions` → push `SessionCapabilities`
2. 监听 `session/update` 的 `config_option_update` / `current_mode_update` / `available_commands_update` → push 增量更新
3. `setModel()` / `setMode()` / `setConfig()` → ACP RPC 调用

这套逻辑可以提取到 `AcpBackendMixin` 或直接在各 Backend 中重复（代码量很小）。

---

## 前提条件

- `claude --experimental-acp` 可用（claude-agent-acp adapter 已发布）
- `codex --experimental-acp` 可用（codex-acp adapter 已发布）
- 如果上述命令尚未随官方 CLI 分发，需确认安装方式（npm global / 独立二进制）

---

## 原有 Backend 的处置

| Backend                    | 处置                    | 原因                                                                          |
| -------------------------- | ----------------------- | ----------------------------------------------------------------------------- |
| `ClaudeBackend`（SDK/PTY） | **保留**                | local PTY 模式是核心交互体验，ACP 不支持 PTY；SDK 模式作为 ACP 不可用时的后备 |
| `CodexBackend`（MCP）      | **保留但标记为 legacy** | 当 `codex --experimental-acp` 稳定后可废弃                                    |

长期目标：当 ACP 覆盖所有场景后（包括 Claude local PTY 的替代方案，见 RFC-004 OpenTUI），原有非 ACP backend 可逐步移除。

---

## 分阶段实施

### Phase 1：ClaudeAcpBackend

- `backends/claude-acp/ClaudeAcpBackend.ts` — 复制 `GeminiBackend.ts` 结构，使用 `createClaudeAcpBackend()`
- `backends/claude-acp/mapClaudeAcpRawToNormalized.ts` — ACP AgentMessage → NormalizedMessage
- `AgentSessionFactory.register('claude-acp', ...)`
- `AgentType` 加入 `'claude-acp'`
- 测试：`ClaudeAcpBackend.test.ts` + `mapClaudeAcpRawToNormalized.test.ts`

### Phase 2：CodexAcpBackend

- `backends/codex-acp/CodexAcpBackend.ts` — 同上模式，使用 `createCodexBackend()`
- `backends/codex-acp/mapCodexAcpRawToNormalized.ts`
- `AgentSessionFactory.register('codex-acp', ...)`
- `AgentType` 加入 `'codex-acp'`
- 测试

### Phase 3：能力发现统一实现

- 四个 ACP backend 统一实现 `capabilities` 流 + `setModel` / `setMode` / `setConfig`
- 与 RFC-005 Phase 2 合并执行
- 验证：所有 ACP backend 在 `start()` 后推送 `SessionCapabilities`

### Phase 4：App agent 选择器

- agent 选择 UI 支持 `claude-acp` / `codex-acp`
- 或：在已有 agent 选项上增加 "协议模式" 切换（ACP vs legacy）

---

## 优先级

**高** — 本 RFC 是 RFC-005 能力发现统一的前提。没有统一 ACP backend，能力发现就必须维护两套路径（ACP 读取 vs 内部硬编码）。

---

## 实现归档（2026-03-16）

### 分阶段完成状态

| Phase                     | 状态 | 说明                                                         |
| ------------------------- | ---- | ------------------------------------------------------------ |
| Phase 1: ClaudeAcpBackend | ✅   | `backends/claude-acp/ClaudeAcpBackend.ts` + mapper + tests   |
| Phase 2: CodexAcpBackend  | ✅   | `backends/codex-acp/CodexAcpBackend.ts` + mapper + tests     |
| Phase 3: 能力发现统一     | ✅   | `DiscoveredAcpBackendBase` 共享基类，与 RFC-005 Phase 2 合并 |
| Phase 4: App agent 选择器 | ✅   | `agentFlavor.ts` 支持 `claude-acp` / `codex-acp`             |

### 与原始设计的偏差

1. **Mapper 策略选了 B 而非 A**：原设计建议 "方案 A — 每个 agent 独立 mapper"，实际四个 ACP backend 共享 `DiscoveredAcpBackendBase` 基类（方案 B），通过继承分离 agent 特化逻辑。原因是能力发现、权限处理、deferred application 等逻辑高度共通（551 行基类代码），独立维护会产生大量重复
2. **多了共享 ACP 基础设施目录**：原设计按 agent 分目录（`claude-acp/`、`codex-acp/`），实际新增了 `backends/acp/` 共享目录，包含 `DiscoveredAcpBackendBase.ts`、`AcpPermissionHandler.ts`、`createFreeMcpServerConfig.ts`、`modelSelection.ts`、`mapAcpSessionCapabilities.ts`
3. **AgentType 扩展方式一致**：`(string & {})` 开放联合类型，`AgentSessionFactory.register()` 运行时注册，与设计完全一致
4. **未建立 `claude-acp` / `codex-acp` 独立 agent 类型**：原设计期望 `--agent claude` 保留 SDK/PTY 模式、`--agent claude-acp` 使用 ACP 模式，用户可选。实际决策更简洁——`claude` 直接变为 ACP-only（`ClaudeBackend` 继承 `DiscoveredAcpBackendBase`），原 PTY/SDK 模式独立为 `claude-native` agent 类型（`ClaudeNativeBackend`，不继承 ACP 基类）。`codex` 同理变为 ACP-only。不存在 `claude-acp` / `codex-acp` AgentType 值。**原因**：双轨模式增加用户选择负担且无实际收益——ACP 协议已完全覆盖能力发现和运行时控制，PTY/SDK 仅在需要本地终端交互时有价值（通过 `claude-native` 提供）
5. **新增 Cursor backend**（RFC 后追加）：`CursorBackend` 同样继承 `DiscoveredAcpBackendBase`，注册为 `'cursor'` agent 类型

### 实现文件

> 注：原设计的 `claude-acp/` 和 `codex-acp/` 独立目录未创建。Claude 和 Codex 复用了已有的 `claude/` 和 `codex/` 目录，Backend 直接改为继承 `DiscoveredAcpBackendBase`。

| 文件                                                         | 用途                                  |
| ------------------------------------------------------------ | ------------------------------------- |
| `cli/src/backends/claude/ClaudeBackend.ts`                   | Claude ACP backend（继承共享基类）    |
| `cli/src/backends/claude/mapClaudeRawToNormalized.ts`        | Claude 消息映射                       |
| `cli/src/backends/codex/CodexBackend.ts`                     | Codex ACP backend（继承共享基类）     |
| `cli/src/backends/codex/mapCodexRawToNormalized.ts`          | Codex 消息映射                        |
| `cli/src/backends/claude-native/ClaudeNativeBackend.ts`      | Claude PTY/SDK 模式（不走 ACP）       |
| `cli/src/backends/cursor/CursorBackend.ts`                   | Cursor ACP backend（继承共享基类）    |
| `cli/src/backends/acp/DiscoveredAcpBackendBase.ts`           | 共享基类（551 行）                    |
| `cli/src/backends/acp/AcpPermissionHandler.ts`               | ACP 权限处理                          |
| `cli/src/backends/acp/createFreeMcpServerConfig.ts`          | MCP server 配置                       |
| `cli/src/backends/acp/modelSelection.ts`                     | 模型选择逻辑                          |
| `cli/src/backends/acp/mapAcpSessionCapabilities.ts`          | ACP → agentbridge 能力映射            |
| `packages/core/src/implementations/agent/factories.ts`       | Core 层工厂注册                       |
