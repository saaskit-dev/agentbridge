# RFC-002: 消息全链路 E2E 集成测试

> Historical note for the `headless-runtime` worktree:
> This RFC documents legacy and current implementation details. It is not the architecture
> source of truth for the refactor. Use `013-free-headless-runtime-architecture.md` first.

- **Status**: Implemented ✅
- **Created**: 2026-03-08
- **Implemented**: 2026-03-14
- **Author**: AgentBridge Team

---

## 1. 目标

验证一条消息从 App 发出，经过 Server 广播、CLI/Daemon 内部各组件处理、Claude API 生成回复、回复经 Server 转发回 App 的**完整真实链路**，包括：

- 每一跳的消息正确传递
- `traceId` 从头到尾贯通不丢失
- 收到**完整全部**的 Claude 回复消息（不是第一条，是整轮结束）
- Session 归档后 App 正确收到 delete 通知

---

## 2. 架构角色说明

### 2.1 组件关系

```
apps/free/cli/         ← CLI + Daemon 是同一套代码，同一个 binary
├── src/index.ts       ← `free` 命令入口
├── src/daemon/
│   ├── run.ts         ← Daemon 主进程（后台运行时的入口）
│   ├── controlServer.ts  ← Daemon 内部 HTTP 控制端口（仅本机）
│   └── controlClient.ts  ← 其他进程/测试通过此调用 Daemon
├── src/api/
│   └── apiSession.ts  ← ApiSessionClient（socket + HTTP，Daemon 持有）
├── src/claude/
│   ├── loop.ts        ← 主循环（local/remote 模式切换）
│   ├── claudeRemoteLauncher.ts
│   └── claudeRemote.ts   ← 调用 Claude SDK
└── src/daemon/
    └── streamingMessageHandler.ts ← 流式 text_delta 处理
```

### 2.2 测试中的角色分工

| 角色                                                       | 谁来承担                                    |
| ---------------------------------------------------------- | ------------------------------------------- |
| **App 侧**（HTTP 调用 + user-scoped socket）               | 测试进程                                    |
| **Server**（路由、DB、广播）                               | 真实 Server（localhost:3005）               |
| **Daemon 进程**（session-scoped socket + 运行 Claude）     | 真实 Daemon（`free daemon start` 已在运行） |
| **CLI 内部组件**（loop / claudeRemote / streamingHandler） | Daemon 进程内自动执行，测试不介入           |
| **Claude API**                                             | 真实 Claude（需要 API Key）                 |

**测试只扮演 App 侧。Daemon 和 Claude 全部真实运行。**

---

## 3. 完整链路流程图

```mermaid
sequenceDiagram
    participant Test  as 测试进程<br/>(扮演 App)
    participant Server as Server<br/>localhost:3005
    participant DS    as Daemon controlServer<br/>(本机 HTTP)
    participant AC    as ApiSessionClient<br/>(Daemon 内部)
    participant Loop  as loop.ts →<br/>claudeRemote.ts
    participant SMH   as streamingMessageHandler<br/>(Daemon 内部)
    participant Claude as Claude API

    Note over Test,Claude: ══════ 前置条件检查 ══════
    Test->>Test: readCredentials() → token<br/>无 credentials → skipIf + 提示用户运行 free auth login
    Test->>Server: GET /health
    Server-->>Test: 200 OK（无则 skipIf）
    Test->>DS: controlClient.checkIfDaemonRunning()
    DS-->>Test: { status: running }（无则 skipIf）

    Note over Test,Claude: ══════ Step 1：创建 Session ══════
    Test->>Server: POST /v1/sessions<br/>{ tag, metadata: encrypted }
    Server->>Server: db.session.create()
    Server-->>Test: 200 { session: { id: SESSION_ID, ... } }

    Note over Test,Claude: ══════ Step 2：App 连接 Socket ══════
    Test->>Server: Socket.IO connect<br/>clientType=user-scoped, token=TOKEN
    Server-->>Test: connected（eventRouter 注册 user-scoped 连接）

    Note over Test,Claude: ══════ Step 3：Daemon 启动 Session ══════
    Test->>DS: controlClient.spawnDaemonSession(dir, SESSION_ID)<br/>HTTP POST → controlServer /spawn-session
    DS->>DS: spawnSession() 异步启动
    DS-->>Test: 200 { success: true, sessionId }

    DS->>Loop: 新子进程：loop.ts remote 模式
    Loop->>AC: new ApiSessionClient(token, session)
    AC->>Server: Socket.IO connect<br/>clientType=session-scoped, sessionId=SESSION_ID
    Server-->>AC: connected（eventRouter 注册 session-scoped 连接）

    AC->>AC: sendSessionEvent({ type: 'ready' })<br/>→ enqueueMessage() → flushOutbox()
    AC->>Server: POST /v3/sessions/SESSION_ID/messages<br/>{ content: encrypted(ready事件) }
    Server->>Server: db.sessionMessage.create() + allocateUserSeq()
    Server->>Server: eventRouter.emitUpdate()<br/>recipientFilter: all-interested-in-session
    Server->>Test: socket 'update'<br/>{ body: { t: 'new-message', sid: SESSION_ID } }
    Server->>AC: socket 'update'（session-scoped 也收到）

    Test->>Test: 轮询 listDaemonSessions()<br/>等待 sessionId 出现 → Daemon 就绪

    Note over Test,Claude: ══════ Step 4：App 发送用户消息 ══════
    Test->>Server: POST /v3/sessions/SESSION_ID/messages<br/>{ messages: [{ localId, content: encrypted("say hello"), _trace: { tid: TRACE_ID, sid } }] }
    Server->>Server: [v3] received messages 日志
    Server->>Server: db.$transaction → sessionMessage.create(traceId=TRACE_ID)
    Server->>Server: [v3] stored messages 日志
    Server->>Server: allocateUserSeq() + buildNewMessageUpdate(_trace)
    Server->>Server: [v3] published event 日志
    Server->>Server: eventRouter.emitUpdate()<br/>[eventRouter] emitting event 日志
    Server-->>Test: 200 { messages: [{ id, seq, localId }] }
    Server->>AC: socket 'update'<br/>{ body: { t: 'new-message' }, _trace: { tid: TRACE_ID } }

    Note over Test,Claude: ══════ Step 5：CLI 处理消息 ══════
    AC->>AC: socket.on('update') 触发<br/>setCurrentTurnTrace(continueTrace(_trace))<br/>→ [apiSession] Processing message (fast path) 日志
    AC->>AC: decrypt(message.content) → UserMessage
    AC->>AC: routeIncomingMessage() → pendingMessageCallback

    AC->>Loop: UserMessage 传入 claudeRemote nextMessage()
    Loop->>Loop: [loop] Iteration { mode: remote } 日志
    Loop->>Loop: claudeRemoteLauncher → claudeRemote()

    Loop->>Claude: query(prompt, sdkOptions)<br/>[claudeRemote] Starting to iterate 日志
    Note over Loop,Claude: Claude API 处理中...

    Note over Test,Claude: ══════ Step 6：Streaming 回传 ══════
    Claude-->>Loop: streaming text_delta
    Loop->>SMH: streamingHandler.onTextDelta(delta)
    SMH->>SMH: 累积 text + 节流
    SMH->>SMH: flush() → [streaming] delta sent 日志
    SMH->>Server: socket emit 'streaming:text-delta'<br/>{ type: text_delta, delta, _trace }
    Server->>Server: streamingHandler → eventRouter.emitEphemeral()
    Server->>Test: socket 'ephemeral'<br/>{ type: 'text_delta', delta: "Hello" }

    Note over Test,Claude: ══════ Step 7：完整回复消息入库 ══════
    Claude-->>Loop: result message（本轮结束）
    Loop->>Loop: [claudeRemote] Result received 日志
    Loop->>AC: sendClaudeSessionMessage(body)<br/>→ mapClaudeLogMessageToSessionEnvelopes()
    AC->>AC: sendSessionProtocolMessage(envelope)<br/>→ enqueueMessage() → [apiSession] message enqueued 日志
    AC->>AC: flushOutbox() 触发<br/>[apiSession] flushing outbox 日志

    AC->>Server: POST /v3/sessions/SESSION_ID/messages<br/>{ messages: [{ content: encrypted(agent回复), _trace: { tid: TRACE_ID } }] }
    Server->>Server: eventRouter.emitUpdate() + [v3] published event 日志
    Server->>Test: socket 'update'<br/>{ body: { t: 'new-message' }, _trace: { tid: TRACE_ID } }
    AC->>AC: [apiSession] outbox flushed 日志

    Note over Test,Claude: ══════ Step 8：轮次结束信号 ══════
    Loop->>AC: closeClaudeSessionTurn()
    AC->>AC: setCurrentTurnTrace(undefined)
    AC->>AC: keepAlive(thinking=false, 'remote')
    AC->>Server: socket volatile emit 'session-alive'<br/>{ thinking: false }
    Server->>Server: sessionUpdateHandler → activity.active=false
    Server->>Test: socket 'ephemeral'<br/>{ type: 'activity', active: false }

    Note over Test: 收到 activity.active=false → 本轮完整回复已全部到达<br/>开始断言

    Note over Test,Claude: ══════ Step 9：归档 Session ══════
    Test->>DS: stopDaemonSession(SESSION_ID)
    DS->>Loop: 停止 loop.ts / claudeRemote abort
    AC->>Server: socket emit 'session-end'
    AC->>AC: close() → socket.close()

    Test->>Server: DELETE /v1/sessions/SESSION_ID
    Server->>Server: sessionDelete() → inTx → db 级联删除
    Server->>Server: afterTx → allocateUserSeq() + buildDeleteSessionUpdate()
    Server->>Server: eventRouter.emitUpdate()<br/>recipientFilter: user-scoped-only
    Server->>Test: socket 'update'<br/>{ body: { t: 'delete-session', sid: SESSION_ID } }
    Server-->>Test: 200 { success: true }
```

---

## 4. 前置条件检查设计

```typescript
async function checkPrerequisites(): Promise<{ ready: boolean; reasons: string[] }> {
  const reasons: string[] = [];

  // 1. Credentials
  const creds = await readCredentials();
  if (!creds) {
    reasons.push('❌ 未找到认证信息 → 请先运行: free auth login');
  }

  // 2. Server
  try {
    const res = await fetch(`${configuration.serverUrl}/health`,
      { signal: AbortSignal.timeout(2000) });
    if (!res.ok) reasons.push(`❌ Server 返回 ${res.status} → 请启动 Server`);
  } catch {
    reasons.push(`❌ Server 不可达 (${configuration.serverUrl}) → 请启动 Server`);
  }

  // 3. Daemon
  const daemonState = await checkIfDaemonRunningAndCleanupStaleState();
  if (daemonState.status !== 'running') {
    reasons.push('❌ Daemon 未运行 → 请先运行: free daemon start');
  }

  return { ready: reasons.length === 0, reasons };
}

const { ready, reasons } = await checkPrerequisites();
if (!ready) {
  console.log('[E2E Test] 跳过：前置条件未满足');
  reasons.forEach(r => console.log(' ', r));
}

describe.skipIf(!ready)('Message Lifecycle E2E', { timeout: 120_000 }, () => { ... });
```

---

## 5. 完整断言设计

### 5.1 HTTP 层断言

```typescript
// Step 1: Session 创建
expect(createRes.status).toBe(200);
expect(sessionId).toMatch(/^[a-z0-9-]+$/);

// Step 4: 用户消息发送
expect(sendRes.status).toBe(200);
expect(sendResBody.messages[0].localId).toBe(LOCAL_ID);

// Step 9: Session 删除
expect(deleteRes.status).toBe(200);
expect(deleteResBody.success).toBe(true);
```

### 5.2 Socket 事件层断言

```typescript
// Step 4 → CLI 收到（通过 listDaemonSessions 侧面验证消息被处理）
// Step 7: App 收到 agent 回复
const agentUpdates = collectedUpdates.filter(
  u => u.body?.t === 'new-message' && u.body?.sid === sessionId
);
expect(agentUpdates.length).toBeGreaterThanOrEqual(1);

// Step 8: 收到完整回复的结束信号
expect(turnCompletedSignalReceived).toBe(true); // ephemeral activity.active=false

// Step 9: delete-session 广播
const deleteEvent = collectedUpdates.find(u => u.body?.t === 'delete-session');
expect(deleteEvent).toBeDefined();
expect(deleteEvent?.body?.sid).toBe(sessionId);
```

### 5.3 traceId 贯通断言

```typescript
const TRACE_ID = `test-trace-${Date.now()}`;

// 发送时注入 _trace
POST body: { messages: [{ ..., _trace: { tid: TRACE_ID, sid: 'span-1' } }] }

// 验证 agent 回复消息也携带了同一个 traceId
// （Server 从 DB 的 traceId 字段重建，传播给 CLI 的 _trace）
const agentUpdate = agentUpdates[agentUpdates.length - 1]; // 最后一条
// _trace.tid 应与原始 TRACE_ID 相同（continueTrace 保留 traceId）
expect(agentUpdate._trace?.tid).toBe(TRACE_ID);
```

### 5.4 完整消息验证

```typescript
// 等待 activity.active=false 后，验证消息的完整性
// 解密消息内容，确认包含有意义的 agent 回复文本
const lastAgentMsg = agentUpdates[agentUpdates.length - 1];
const decrypted = decrypt(encKey, encVariant, decodeBase64(lastAgentMsg.body.message.content.c));
// session protocol envelope 格式
expect(decrypted).toMatchObject({
  role: 'agent',
  content: { type: 'session' },
});
```

---

## 6. 实现计划

### 文件位置

```
apps/free/cli/src/api/messageLifecycle.integration.test.ts
```

与 `daemon.integration.test.ts` 同目录，共用同一套环境变量（`.env.integration-test`）。

### 依赖的 utilities

| 依赖                                         | 来源                     |
| -------------------------------------------- | ------------------------ |
| `readCredentials()`                          | `@/persistence`          |
| `configuration`                              | `@/configuration`        |
| `checkIfDaemonRunningAndCleanupStaleState()` | `@/daemon/controlClient` |
| `spawnDaemonSession()`                       | `@/daemon/controlClient` |
| `stopDaemonSession()`                        | `@/daemon/controlClient` |
| `listDaemonSessions()`                       | `@/daemon/controlClient` |
| `ApiClient`                                  | `@/api/api`              |
| `decrypt / decodeBase64`                     | `@/api/encryption`       |
| `io` (socket.io-client)                      | `socket.io-client`       |

### 测试结构

```typescript
describe.skipIf(!ready)('Message Lifecycle E2E', { timeout: 120_000 }, () => {
  let sessionId: string;
  let encKey: Uint8Array;
  let encVariant: 'legacy' | 'dataKey';
  let appSocket: Socket;
  const collectedUpdates: any[] = [];
  const collectedEphemerals: any[] = [];

  beforeAll(async () => {
    // 1. 读取真实 credentials
    // 2. ApiClient.create() → getOrCreateSession() 创建 session
    // 3. 连接 user-scoped socket，监听所有 update + ephemeral
    // 4. spawnDaemonSession(dir, sessionId)
    // 5. 等待 Daemon 就绪（轮询 listDaemonSessions）
  });

  afterAll(async () => {
    await stopDaemonSession(sessionId);
    await new Promise(r => setTimeout(r, 500)); // 等 socket 关闭
    appSocket?.disconnect();
    await fetch(`${serverUrl}/v1/sessions/${sessionId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
  });

  it('完整消息生命周期', async () => {
    const TRACE_ID = `e2e-trace-${Date.now()}`;
    const LOCAL_ID = `local-${Date.now()}`;

    // Step 4: 发送用户消息
    // Step 5-7: 等待 activity.active=false（最长 90s，Claude 需要时间）
    // Step 8: 断言 collectedUpdates 里有 agent 回复
    // Step 9: 断言 _trace.tid 贯通
    // Step 10: 断言解密后内容非空
  });

  it('归档 session 后 App 收到 delete-session 事件', async () => {
    // 此时 beforeAll 创建的 session 已发过消息
    // afterAll 会 DELETE，但这个 it 先手动 DELETE 再断言
  });
});
```

### 关键辅助函数

```typescript
// 等待某个 socket 事件满足条件，超时则 reject
function waitForEvent<T>(
  events: T[],
  predicate: (e: T) => boolean,
  timeoutMs = 90_000,
  description = ''
): Promise<T>;

// 等待 activity.active=false（本轮 Claude 回复完整结束）
function waitForTurnComplete(
  ephemerals: any[],
  sessionId: string,
  timeoutMs = 90_000
): Promise<void>;

// 轮询 listDaemonSessions 直到 sessionId 出现
async function waitForDaemonSession(sessionId: string, timeoutMs = 15_000): Promise<void>;
```

---

## 7. 运行方式

```bash
# 前置：确保以下都在运行
free daemon start
# Server 已启动

# 跑测试
cd apps/free/cli
dotenv -e .env.integration-test -- npx vitest run src/api/messageLifecycle.integration.test.ts

# 验证 traceId 贯通（测试完成后）
TRACE_ID="e2e-trace-xxxxx"
grep "$TRACE_ID" ~/.free-dev/logs/*.jsonl | wc -l  # 应该 > 5（跨 server/cli 日志）
```

---

## 8. 与现有测试的区别

| 测试                                       | 范围                      | Mock                   | Claude             |
| ------------------------------------------ | ------------------------- | ---------------------- | ------------------ |
| `apiSession.test.ts`                       | ApiSessionClient 单元     | socket + axios 全 mock | ❌                 |
| `v3SessionRoutes.test.ts`                  | Server HTTP 路由单元      | DB + eventRouter mock  | ❌                 |
| `v3SessionRoutes.integration.test.ts`      | Server HTTP → Socket 集成 | DB 真实，无 Daemon     | ❌                 |
| `daemon.integration.test.ts`               | Daemon 启停管理           | 无 mock                | ❌                 |
| **`messageLifecycle.integration.test.ts`** | **全链路 E2E**            | **无 mock，全真实**    | **✅ 真实 Claude** |

---

## 9. 实现归档（2026-03-14）

### 实现文件

| 文件                                                         | 用途                              |
| ------------------------------------------------------------ | --------------------------------- |
| `apps/free/cli/src/api/messageLifecycle.integration.test.ts` | 主测试文件（338 行）              |
| `apps/free/cli/src/test-helpers/FakeAppClient.ts`            | 模拟 App 端协议行为（245 行）     |
| `apps/free/cli/src/test-helpers/FakeCliSessionClient.ts`     | 模拟 CLI 端 session 行为（87 行） |
| `apps/free/cli/src/test-helpers/integrationEnvironment.ts`   | 测试环境初始化（180 行）          |
| `apps/free/cli/src/test-helpers/daemonTestHarness.ts`        | Daemon 测试工具（110 行）         |

### 已实现的测试用例

1. ✅ "broadcasts encrypted user and agent messages to both user-scoped and session-scoped sockets"
2. ✅ "fetches and decrypts persisted messages via FakeAppClient"
3. ✅ "persists and broadcasts capability updates without relying on the app UI"
4. ✅ "emits delete-session to user-scoped sockets when the session is deleted"

### 与原始设计的偏差

1. **不依赖真实 Daemon/Claude**：原始设计要求全链路（包括真实 Daemon + 真实 Claude API），实际实现使用 `FakeCliSessionClient` 模拟 CLI 端，不需要启动 Daemon 或调用 Claude API。这大幅降低了测试环境要求和执行时间（45s 超时 vs 原设计 120s）
2. **真实 Agent Smoke 单独测试**：需要真实 Agent 的测试拆分到了 `daemonAgentSmoke.integration.test.ts`，通过 `FREE_RUN_REAL_AGENT_SMOKE=1` 环境变量门控
3. **traceId 贯通断言**：通过 FakeCliSessionClient 发送带 traceId 的消息并验证 Server 持久化和广播，而非端到端跟踪到 Claude API
4. **Capability 验证**：原设计未包含 capability 测试，实际实现增加了 capability update 持久化和广播验证
