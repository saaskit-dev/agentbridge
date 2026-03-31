# RFC-004: Agent 进程生命周期与 Daemon 重启恢复

> Historical note for the `headless-runtime` worktree:
> This RFC documents legacy and current implementation details. It is not the architecture
> source of truth for the refactor. Use `013-free-headless-runtime-architecture.md` first.

> Status: Implemented（当前方案）/ Deferred（Bridge 架构）
> Created: 2026-03-13
> Last Updated: 2026-03-26

---

## 1. 问题背景

ACP agent 进程（claude-acp, codex-acp, gemini, opencode, cursor）通过 **stdio pipe** 与 daemon 通信。Daemon 是父进程，pipe 的生命周期 = daemon 的生命周期。

**关键问题**：daemon 一旦重启（版本更新、crash、手动重启），所有 ACP agent 进程失去通信信道并退出，正在进行的对话中断。

---

## 2. 当前实现方案：优雅重启 + 持久化恢复

### 2.1 架构

```
App <-> Server <-> Daemon ─── (stdio pipe) ─── ACP Agent
                     │
                     daemon 父进程死 → pipe 断 → agent 进程退出
                     新 daemon 启动 → 读持久化文件 → loadSession() 恢复
```

### 2.2 持久化机制

每个活跃 session 在以下时机写入 `~/.free/daemon-sessions/<sessionId>.json`：
1. `initialize()` 完成后（首次全量快照）
2. `updateResumeId()` 被调用时（ACP session ID 更新）
3. daemon 收到 SIGTERM/SIGINT 时（确保最新状态落盘）

文件内容（`PersistedSession`）：
```typescript
{
  sessionId: string;
  agentType: AgentType;
  cwd: string;
  resumeSessionId?: string;   // ACP session ID，用于 loadSession()
  permissionMode?: PermissionMode;
  model?: string;
  mode?: string;
  startedBy: SessionInitiator;
  env?: Record<string, string>;
  createdAt: number;
  daemonInstanceId: string;   // 防 PID 复用的 daemon 实例 ID
  lastSeq?: number;           // 消息 seq 水位，避免重启后重拉全量
}
```

Session 正常结束（`shutdown()`）时删除文件；daemon 重启时文件保留，供新 daemon 恢复。

### 2.3 优雅重启流程（版本更新）

```
检测到新版本
  │
  ├─ 有 busy sessions（isWorking = true）？
  │    └─ 轮询等待当前 turn 完成（最多 5 分钟）
  │
  ├─ flush outbox（确保所有消息发到 server）
  │
  ├─ stopBackend()（停掉 agent 子进程，不删持久化文件）
  │
  ├─ spawn 新 daemon（detached: true）
  │
  └─ process.exit(0)

新 daemon 启动
  │
  └─ readAllPersistedSessions()
       │
       └─ 所有 ACP agent 均支持 loadSession（Cursor / Gemini / OpenCode / Codex / Claude 全部在
          initialize() 响应里上报 agentCapabilities.loadSession: true）
            └─ spawn 新 agent + loadSession(resumeSessionId) → 恢复对话上下文
```

### 2.4 Crash 恢复流程（非预期重启）

```
daemon crash / SIGKILL
  │
  └─ 持久化文件保留在磁盘
       agent 子进程也随父进程消失

新 daemon 启动（用户手动或 watchdog）
  │
  └─ 同上：读持久化 → loadSession(resumeSessionId) → 恢复对话上下文
```

Crash 场景下，当前 turn 正在生成的响应**不可避免地丢失**（pipe 已断）。
对话上下文（历史消息）通过 loadSession 完整恢复，用户重连后可继续对话。

### 2.5 Orphan Session 保活机制

当所有 CLI 客户端从某个 session 断开时（用户关闭终端），daemon 3 秒后自动 spawn 一个 headless CLI `--attach-session <id>` 维持连接，防止 daemon 因无客户端而自动退出。最多重试 3 次。

---

## 3. 现方案优缺点

### ✅ 优点

| 优点 | 说明 |
|------|------|
| **版本更新零感知** | 等 turn 完成 + flush outbox，用户看不到中断 |
| **实现简单** | 无独立进程、无 Unix socket、无 ring buffer，代码量小 |
| **crash 后可恢复上下文** | `loadSession()` 重建 agent，对话历史完整（Claude ACP 支持） |
| **持久化透明** | JSON 文件，`~/.free/daemon-sessions/` 可直接 inspect |
| **无额外依赖** | 无需 IPC 框架、无需 socket 管理 |

### ⚠️ 缺点

| 缺点 | 影响 |
|------|------|
| **Crash 当前 turn 响应丢失** | 正在流式输出的消息无法暂存，新 daemon 起来后该 turn 数据丢失 |
| **Crash 当前 turn 内容丢失** | 所有 agent 均支持 loadSession，对话上下文可恢复，但 crash 时正在流式输出的那段内容无法挽救 |
| **loadSession 有冷启动延迟** | agent 重建需要数秒，用户感知到短暂等待 |
| **5 分钟超时是硬上限** | 极长的 turn（大量工具调用）可能被强制中断 |
| **Orphan spawn 最多 3 次** | 极端情况下 headless CLI 连续 crash 会放弃保活 |

---

## 4. 何时需要升级到 Bridge 架构

**Bridge 架构**（原 RFC-004 设计草案）通过独立的 Bridge 进程持有 agent stdio，daemon 通过 Unix socket 连接，可实现 crash 零丢失和对所有 agent 的无缝 re-attach。

以下任一条件触发时，应考虑升级：

### 升级决策框架

`loadSession` 是 ACP 协议标准能力，**所有 ACP agent（Cursor / Gemini / OpenCode / Codex / Claude）均在 `initialize()` 响应里上报 `agentCapabilities.loadSession: true`**。因此 crash 后对话上下文可完整恢复，当前方案对所有 agent 同等有效。

**当前方案已经足够的条件：**
- 所有 ACP agent 均支持 loadSession，crash 后对话上下文完整恢复
- 版本更新时优雅重启（等 turn 完成 + flush outbox）覆盖了绝大多数中断场景
- 唯一损失：crash 发生时**当前 turn 正在输出的内容**丢失（通常几行到几十行）

**应该升级 Bridge 的信号——出现任一时评估：**
- 生产 crash 频率上升，当前 turn 丢失成为用户明显痛点
- 出现需要持续数小时的后台 agent 任务（用户不在线时 agent 继续跑）
- 产品上需要"进程级会话持久化"语义（类 tmux，重启终端 agent 还在继续工作）

---

## 5. Bridge 架构草案（备用设计）

> 以下为设计草案，供未来实现参考。未实现。

### 5.1 核心思路

```
App <-> Server <-> Daemon ──(Unix socket)── Bridge ──(stdio)── ACP Agent
                     │                        │
                     daemon 死                Bridge 继续持有 agent
                     新 daemon 启动            等待重连
                     connect socket ─────────→ re-attach + replay ring buffer
```

Bridge 进程关键属性：
- `detached: true`，独立进程组
- 固定 socket 路径：`~/.free/bridges/<sessionId>.sock`
- 维护 ring buffer（上限 10000 条），daemon 离线期间消息暂存

### 5.2 需要新增的组件

| 组件 | 说明 |
|------|------|
| `daemon/bridge/AgentSocketBridge.ts` | Bridge 进程主逻辑（状态机 + socket 服务 + ring buffer）|
| `daemon/bridge/protocol.ts` | Bridge 协议类型定义 |
| `daemon/bridge/BridgeProcessManager.ts` | Bridge 进程启动/发现/清理 |
| `daemon/bridge/BridgeConnection.ts` | Daemon 侧 socket 连接封装 |
| `daemon/bridge/BridgePermissionProxy.ts` | Bridge 侧权限请求转发代理 |
| `backends/acp/AgentBridgeBackend.ts` | 实现 AgentBackend 接口，取代直接持有 ACP stdio |

### 5.3 权限审批转发

Bridge 进程无 `ApiSessionClient`，权限链路变为：
```
ACP Agent → BridgePermissionProxy → socket → Daemon → ApiSessionClient → Server → App
```

### 5.4 实现工作量估算

约 2–3 周（6 个新文件 + 9 个改动文件），设计文档完整，无需重新设计。

---

## 6. 当前状态总结

| 场景 | 当前方案结果 | Bridge 方案结果 |
|------|------------|----------------|
| 版本更新 | ✅ 等 turn 完成，用户无感知 | ✅ 相同，且 agent 进程存活 |
| 计划重启（手动 stop） | ✅ flush + loadSession 恢复 | ✅ re-attach，更快 |
| Daemon crash（Claude ACP）| ⚠️ 当前 turn 丢失，loadSession 恢复上下文 | ✅ ring buffer replay，零丢失 |
| Daemon crash（任意 ACP agent）| ⚠️ 当前 turn 输出丢失；loadSession 恢复对话上下文 | ✅ ring buffer replay，零丢失 |
| 实现复杂度 | ✅ 低 | ❌ 高（独立进程、Unix socket、ring buffer） |
