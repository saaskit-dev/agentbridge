# RFC-010: WebSocket-Only Message Transport + Local SQLite Cache

> Status: Implemented
> Created: 2026-03-18
> Author: AgentBridge Team

## 1. 目标

将消息流核心链路从 HTTP POST/GET 迁移到全 WebSocket（Socket.IO `emitWithAck`），并在 App 端增加本地 SQLite 缓存实现秒开 + 增量同步。

### 1.1 不在范围内

- 管理类 HTTP API（account、kv、artifacts、friends、feed、push、voice、connect、version）保持不变
- streaming:text-delta / streaming:text-complete / streaming:thinking-delta 等 ephemeral 事件不变
- eventRouter 路由逻辑不变
- 加解密逻辑不变

## 2. 现状分析

### 2.1 当前消息流

```
Agent 消息 (Daemon → Server → App):
  Track A: streaming delta → WS emit → Server streamingHandler → eventRouter.emitEphemeral → App (打字机效果，不入库)
  Track B: HTTP POST /v3/sessions/:id/messages → Server 写 DB → eventRouter.emitUpdate → App WS 收 update (持久化)

用户消息 (App → Server → Daemon):
  HTTP POST /v3/sessions/:id/messages → Server 写 DB → eventRouter.emitUpdate → Daemon WS 收 update

历史消息拉取:
  HTTP GET /v3/sessions/:id/messages?after_seq=N&limit=100 → 分页返回
```

### 2.2 需要替换的 HTTP 端点（仅 2 个）

| HTTP 路由                        | 方向                | 用途                          |
| -------------------------------- | ------------------- | ----------------------------- |
| `POST /v3/sessions/:id/messages` | App/Daemon → Server | 发送消息（批量，最多 100 条） |
| `GET /v3/sessions/:id/messages`  | App/Daemon ← Server | 拉取历史/增量消息             |

### 2.3 Server 端已有的 WS 消息处理

`sessionUpdateHandler.ts:377-447` 已有 `socket.on('message', ...)` 处理器：

- 校验 userId + sessionId
- 按 message.id 去重（DB 查询）
- 分配 seq（`allocateSessionSeq`）
- 写入 DB（`sessionMessage.create`）
- `eventRouter.emitUpdate({ skipSenderConnection: connection })` — self-echo 防护
- AsyncLock 防并发
- **不足**：单条消息、无 ack 回调、无批量

`v3SessionRoutes.ts:131-314` HTTP POST handler 有更完整的批量逻辑：

- 事务内批量去重（`findMany + Set`）
- `allocateSessionSeqBatch` 批量分配 seq
- 返回所有消息的 seq 列表
- X-Socket-Id 防 self-echo

### 2.4 App 端无消息缓存

`persistence.ts` 用 MMKV 存 settings/profile/outbox 等小数据，**不缓存消息内容**。每次进入 session 都从 Server 全量拉取。

## 3. 新增 WS 协议

### 3.1 `send-messages`（App/Daemon → Server）

复用 `v3SessionRoutes.ts` POST handler 的批量事务逻辑，搬进 WS 事件。

**请求**（emitWithAck）：

```typescript
{
  sessionId: string;
  messages: Array<{
    id: string; // client-generated，用于去重
    content: string; // 加密后的内容
    _trace?: WireTrace; // 可选，trace 传播
  }>;
}
```

**响应（ack callback）**：

```typescript
// 成功
{ ok: true, messages: Array<{ id: string; seq: number; createdAt: number; updatedAt: number }> }

// 失败
{ ok: false, error: string }
```

**Server 处理逻辑**：

1. 校验 `sessionId` 归属当前连接的 `userId`
2. 批内去重（同一 `id` 只保留第一条）
3. 事务内：
   a. 查已存在的消息（`findMany WHERE id IN [...]`）
   b. 过滤出新消息
   c. `allocateSessionSeqBatch` 批量分配 seq
   d. 逐条 `sessionMessage.create`
4. 对每条新消息：`eventRouter.emitUpdate({ skipSenderConnection: connection })`
5. ack 返回所有消息（已存在 + 新创建）的 `{ id, seq }`

**与现有 HTTP POST handler 的差异**：

- 不需要 `X-Socket-Id` header — WS 事件天然有 `connection` 对象，直接 `skipSenderConnection: connection`
- 其余逻辑**完全相同**

### 3.2 `fetch-messages`（App/Daemon → Server）

复用 `v3SessionRoutes.ts` GET handler 的查询逻辑。

**请求**（emitWithAck）：

```typescript
{
  sessionId: string;
  after_seq: number; // 从哪条之后，0 = 从头
  limit: number; // 最多返回多少条，上限 500
}
```

**响应（ack callback）**：

```typescript
{
  ok: true;
  messages: Array<{
    id: string;
    seq: number;
    content: unknown; // 加密内容
    traceId?: string;
    createdAt: number;
    updatedAt: number;
  }>;
  hasMore: boolean;
}
```

**Server 处理逻辑**：

1. 校验 `sessionId` 归属 `userId`
2. 查 DB: `WHERE sessionId = ? AND seq > after_seq ORDER BY seq ASC TAKE limit + 1`
3. `hasMore = results.length > limit`
4. 返回 `results.slice(0, limit)`

### 3.3 重连 Replay

Socket 连接建立时，客户端通过握手参数传入已知的最新 seq：

**session-scoped 连接**（Daemon）：

```typescript
socket.handshake.auth.lastSeq = number; // 该 session 的最新 seq
```

**user-scoped 连接**（App）：

```typescript
socket.handshake.auth.lastSeqs = Record<string, number>; // { sessionId: lastSeq }
// 只传当前正在查看的 session 的 lastSeq
```

**Server 处理**（`socket.ts` connection handler）：

- 连接建立后，查 DB `seq > lastSeq`，通过 `socket.emit('update', ...)` 主动推送遗漏消息
- 加 `replay: true` 标记，App 端不触发重复通知
- 上限 100 条；超过 100 条时 `hasMore: true`，App 端继续用 `fetch-messages` 分页拉取

## 4. Server 端改造

### 4.1 sessionUpdateHandler.ts

**改造现有 `socket.on('message', ...)`** → `socket.on('send-messages', ..., callback)`：

- 将 `v3SessionRoutes.ts` POST handler 的批量事务逻辑搬入
- 加 ack callback 返回 `{ ok, messages }`
- `skipSenderConnection: connection`（已有模式）
- 保留 `receiveMessageLock`

**新增 `socket.on('fetch-messages', ..., callback)`**：

- 将 `v3SessionRoutes.ts` GET handler 的查询逻辑搬入
- ack callback 返回 `{ ok, messages, hasMore }`

### 4.2 socket.ts

连接建立后新增 replay 逻辑（§3.3）。

### 4.3 v3SessionRoutes.ts

删除：

- `POST /v3/sessions/:sessionId/messages`（行 131-314）
- `GET /v3/sessions/:sessionId/messages`（行 73-129）

如果文件只剩这两个路由，整个文件删除，并从 `api.ts` 移除 `v3SessionRoutes(typed)` 注册。

## 5. Daemon（CLI）端改造

### 5.1 apiSession.ts — flushOutbox

**改造前**（行 553-565）：

```typescript
const res = await axios.post(
  `${configuration.serverUrl}/v3/sessions/${this.sessionId}/messages`,
  { messages: batch },
  { headers: { 'X-Socket-Id': this.socket.id } }
);
```

**改造后**：

```typescript
const ack = await this.socket.timeout(30000).emitWithAck('send-messages', {
  sessionId: this.sessionId,
  messages: batch,
});
if (!ack.ok) throw new Error(ack.error);
```

其余 outbox 逻辑（入队、出队、InvalidateSync debounce、MMKV 持久化、backoff 重试）全部不变。

### 5.2 apiSession.ts — fetchMessages

**改造前**（行 454-464）：

```typescript
const res = await axios.get(`${configuration.serverUrl}/v3/sessions/${this.sessionId}/messages`, {
  params: { after_seq, limit },
});
```

**改造后**：

```typescript
const ack = await this.socket.timeout(30000).emitWithAck('fetch-messages', {
  sessionId: this.sessionId,
  after_seq,
  limit,
});
if (!ack.ok) throw new Error(ack.error);
return ack;
```

### 5.3 重连带 lastSeq

```typescript
this.socket = io(serverUrl, {
  auth: {
    token,
    clientType: 'session-scoped',
    sessionId: this.sessionId,
    lastSeq: this.lastKnownSeq, // 新增
  },
});

this.socket.on('connect', () => {
  this.socket.auth = { ...this.socket.auth, lastSeq: this.lastKnownSeq };
  this.sendSync.invalidate(); // 重连后立即 flush outbox
});
```

### 5.4 socket 未连接时的行为

`emitWithAck` 在 socket 未连接时会抛错 → catch 块触发已有的 backoff 重试 → socket 重连后 `invalidate()` 重新 flush。逻辑与 HTTP 失败重试完全对等。

## 6. App 端改造

### 6.1 sync.ts — flushOutbox

**改造前**（行 1694）：

```typescript
await this.apiSocket.request(`/v3/sessions/${sessionId}/messages`, {
  method: 'POST',
  body: { messages: batch },
});
```

`apiSocket.request()` 是 HTTP fetch 封装（`apiSocket.ts:230-250`）。

**改造后**：

```typescript
const ack = await this.apiSocket.emitWithAck('send-messages', {
  sessionId,
  messages: batch,
});
if (!ack.ok) throw new Error(ack.error);
```

### 6.2 sync.ts — fetchMessages

**改造前**（行 1769-1773）：

```typescript
const data = await this.apiSocket.request(
  `/v3/sessions/${sessionId}/messages?after_seq=${seq}&limit=100`
);
```

**改造后**：

```typescript
const ack = await this.apiSocket.emitWithAck('fetch-messages', {
  sessionId,
  after_seq: seq,
  limit: 100,
});
if (!ack.ok) throw new Error(ack.error);
const { messages, hasMore } = ack;
```

### 6.3 apiSocket.ts — 重连带 lastSeqs

```typescript
this.socket = io(serverUrl, {
  auth: {
    token,
    clientType: 'user-scoped',
    lastSeqs: this.getActiveSessionLastSeqs(),
  },
});
```

`getActiveSessionLastSeqs()` 从 SQLite 缓存读取当前 session 的 lastSeq。

## 7. SQLite 本地缓存

### 7.1 架构

```
Native (iOS/Android)          Web (Browser)
───────────────────           ──────────────────────────
expo-sqlite                   @journeyapps/wa-sqlite v1.5.0
(原生 SQLite)                 + IDBBatchAtomicVFS
                              (IndexedDB 后端，多标签页安全)
        │                           │
        └────── 统一接口 ────────────┘
                MessageDB
               (同一套 SQL)
```

### 7.2 为什么不用 expo-sqlite 三端统一

expo-sqlite Web 端基于 `@sqlite.org/sqlite-wasm` + OPFS：

- 需要 COOP/COEP headers（`Cross-Origin-Embedder-Policy`、`Cross-Origin-Opener-Policy`），可能影响第三方资源
- OPFS 单写者限制，多标签页第二个标签页无法写入
- Web 支持仍为 alpha 状态（已知 bug：blob 数据损坏 #41127、文件创建失败 #39903）

### 7.3 为什么选 wa-sqlite + IDBBatchAtomicVFS

- **不需要 COOP/COEP headers**（不依赖 SharedArrayBuffer）
- **不需要 OPFS**（底层用 IndexedDB）
- **多标签页安全**（排他锁，不会崩溃或降级，写操作排队等待）
- **不需要 Web Worker**（可在主线程运行）
- **SQL 语法与 expo-sqlite 完全一致**（都是 SQLite）
- 使用 `@journeyapps/wa-sqlite`（PowerSync 维护的 fork，活跃更新，v1.5.0）

### 7.4 文件结构

```
sync/
  messageDB.ts           ← 接口定义 + 类型（三端共享）
  messageDB.native.ts    ← expo-sqlite 实现
  messageDB.web.ts       ← wa-sqlite + IDBBatchAtomicVFS 实现
```

Metro bundler 自动按平台解析 `.native.ts` / `.web.ts`。

### 7.5 接口定义（`messageDB.ts`）

```typescript
export interface CachedMessage {
  id: string;
  sessionId: string;
  seq: number;
  content: string; // 解密后的 JSON string
  role: 'user' | 'agent';
  createdAt: number; // unix ms
  updatedAt: number;
}

export interface MessageDB {
  init(): Promise<void>;

  /** 读取 session 消息，按 seq 正序 */
  getMessages(
    sessionId: string,
    opts: {
      limit: number;
      beforeSeq?: number; // 向上翻页：seq < beforeSeq
    }
  ): Promise<CachedMessage[]>;

  /** 读取 session 最新 seq 水位线 */
  getLastSeq(sessionId: string): Promise<number>;

  /** 批量写入/更新消息（INSERT OR REPLACE） */
  upsertMessages(sessionId: string, messages: CachedMessage[]): Promise<void>;

  /** 更新 session 同步水位线 */
  updateLastSeq(sessionId: string, seq: number): Promise<void>;

  /** 删除 session 时清理缓存 */
  deleteSession(sessionId: string): Promise<void>;
}
```

### 7.6 Schema（两端共享，同一段 SQL）

```sql
CREATE TABLE IF NOT EXISTS messages (
  id         TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  seq        INTEGER NOT NULL,
  content    TEXT NOT NULL,
  role       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_msg_session_seq
  ON messages(session_id, seq);

CREATE TABLE IF NOT EXISTS session_sync (
  session_id TEXT PRIMARY KEY,
  last_seq   INTEGER NOT NULL DEFAULT 0,
  synced_at  INTEGER NOT NULL
);
```

### 7.7 Native 实现（`messageDB.native.ts`）

```typescript
import * as SQLite from 'expo-sqlite';

let db: SQLite.SQLiteDatabase;

async function init() {
  db = await SQLite.openDatabaseAsync('messages.db');
  await db.execAsync(SCHEMA_SQL);
}

async function getMessages(sessionId: string, opts: { limit: number; beforeSeq?: number }) {
  if (opts.beforeSeq != null) {
    return db.getAllAsync<CachedMessage>(
      'SELECT * FROM messages WHERE session_id = ? AND seq < ? ORDER BY seq DESC LIMIT ?',
      [sessionId, opts.beforeSeq, opts.limit]
    );
  }
  return db.getAllAsync<CachedMessage>(
    'SELECT * FROM messages WHERE session_id = ? ORDER BY seq ASC LIMIT ?',
    [sessionId, opts.limit]
  );
}

async function getLastSeq(sessionId: string) {
  const row = await db.getFirstAsync<{ last_seq: number }>(
    'SELECT last_seq FROM session_sync WHERE session_id = ?',
    [sessionId]
  );
  return row?.last_seq ?? 0;
}

async function upsertMessages(sessionId: string, messages: CachedMessage[]) {
  await db.withTransactionAsync(async () => {
    for (const m of messages) {
      await db.runAsync(
        `INSERT OR REPLACE INTO messages (id, session_id, seq, content, role, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [m.id, m.sessionId, m.seq, m.content, m.role, m.createdAt, m.updatedAt]
      );
    }
  });
}

async function updateLastSeq(sessionId: string, seq: number) {
  await db.runAsync(
    `INSERT OR REPLACE INTO session_sync (session_id, last_seq, synced_at) VALUES (?, ?, ?)`,
    [sessionId, seq, Date.now()]
  );
}

async function deleteSession(sessionId: string) {
  await db.execAsync(`DELETE FROM messages WHERE session_id = '${sessionId}'`);
  await db.execAsync(`DELETE FROM session_sync WHERE session_id = '${sessionId}'`);
}
```

### 7.8 Web 实现（`messageDB.web.ts`）

```typescript
import SQLiteESMFactory from '@journeyapps/wa-sqlite/dist/wa-sqlite-async.mjs';
import { IDBBatchAtomicVFS } from '@journeyapps/wa-sqlite/src/examples/IDBBatchAtomicVFS.js';
import * as SQLiteAPI from '@journeyapps/wa-sqlite';

let sqlite3: SQLiteAPI.SQLiteAPI;
let db: number;

async function init() {
  const module = await SQLiteESMFactory();
  sqlite3 = SQLiteAPI.Factory(module);
  const vfs = await IDBBatchAtomicVFS.create('messages', module);
  sqlite3.vfs_register(vfs, true);
  db = await sqlite3.open_v2('messages');
  await exec(SCHEMA_SQL);
}

async function exec(sql: string) {
  await sqlite3.exec(db, sql);
}

async function query<T>(sql: string): Promise<T[]> {
  const rows: T[] = [];
  await sqlite3.exec(db, sql, (row, columns) => {
    const obj = {} as any;
    columns.forEach((col, i) => {
      obj[col] = row[i];
    });
    rows.push(obj);
  });
  return rows;
}

// getMessages, getLastSeq, upsertMessages, updateLastSeq, deleteSession
// SQL 语句与 Native 端完全相同，仅调用 query() / exec() 封装
```

### 7.9 依赖

```
Native:  npx expo install expo-sqlite            # Expo SDK 54 标配
Web:     npm install @journeyapps/wa-sqlite      # PowerSync fork, v1.5.0, ~400KB WASM
```

Metro 配置：仅需确认 `config.resolver.assetExts` 包含 `'wasm'`（项目已有）。不需要 COOP/COEP headers。

## 8. 进入 Session 的完整新流程

```
用户点开 session
        │
        ▼
Step 1: messageDB.getMessages(sessionId, { limit: 100 })
        → 立即从本地 SQLite 读取缓存 → 渲染（0ms 延迟）
        （首次打开无缓存时返回空数组）
        │
        ▼
Step 2: messageDB.getLastSeq(sessionId)
        → lastSeq（如 850，首次为 0）
        │
        ▼
Step 3: socket.emitWithAck('fetch-messages', { sessionId, after_seq: lastSeq, limit: 100 })
        → 从 Server 拉增量
        │
        ├── hasMore = true → 继续分页（循环 Step 3）
        ├── hasMore = false → 增量同步完成
        │
        ▼
Step 4: messageDB.upsertMessages(sessionId, newMessages)
        messageDB.updateLastSeq(sessionId, maxSeq)
        → 写回本地缓存
        │
        ▼
Step 5: 进入实时模式
        socket.on('update') → 新消息追加渲染
                            → messageDB.upsertMessages()（异步写缓存，不阻塞 UI）
                            → messageDB.updateLastSeq()
```

## 9. 重连场景

### 9.1 Daemon（session-scoped）重连

```
WS 断线 → outbox 中的消息保留
WS 重连 → 握手带 lastSeq
        → Server replay 遗漏消息（≤100 条）
        → InvalidateSync.invalidate() 立即 flush outbox
        → emitWithAck('send-messages', ...) 发送积压消息
```

### 9.2 App（user-scoped）重连

```
WS 断线 → 页面仍可查看本地缓存
WS 重连 → 握手带 lastSeqs
        → Server replay 遗漏消息
        → 如果 replay 超过 100 条 → App 继续 fetch-messages 分页补全
        → 新消息合并进 SQLite
```

## 10. 文件变更清单

```
新增 (2 个文件):
  app/sources/sync/messageDB.native.ts      # expo-sqlite 实现
  app/sources/sync/messageDB.web.ts         # wa-sqlite + IDBBatchAtomicVFS 实现

修改 (7 个文件):
  server/src/app/api/socket/sessionUpdateHandler.ts
    → 改造 socket.on('message') 为 socket.on('send-messages', ..., ack)
    → 新增 socket.on('fetch-messages', ..., ack)

  server/src/app/api/socket.ts
    → 连接建立后新增 replay 逻辑

  cli/src/api/apiSession.ts
    → flushOutbox: axios.post → emitWithAck('send-messages')
    → fetchMessages: axios.get → emitWithAck('fetch-messages')
    → 重连带 lastSeq

  app/sources/sync/sync.ts
    → flushOutbox: apiSocket.request (HTTP) → emitWithAck('send-messages')
    → fetchMessages: apiSocket.request (HTTP) → emitWithAck('fetch-messages')
    → 进 session 先读 SQLite 缓存
    → 实时消息写 SQLite 缓存

  app/sources/sync/apiSocket.ts
    → 重连带 lastSeqs

  app/sources/-session/SessionView.tsx
    → 先渲染本地缓存

  app/sources/sync/messageDB.ts
    → 接口定义 + 类型 + Schema 常量

删除 (1 个文件):
  server/src/app/api/routes/v3SessionRoutes.ts
    → 删除 POST + GET 消息路由
    → 如果文件只剩这两个路由则整个删除
    → 从 api.ts 移除 v3SessionRoutes(typed) 注册

配置 (1 个文件):
  app/package.json
    → +expo-sqlite (native)
    → +@journeyapps/wa-sqlite (web)
```

## 11. 实施阶段

### Phase 1: Server 新增 WS 事件（双轨运行，不删 HTTP）

1. `sessionUpdateHandler.ts` 新增 `send-messages` 事件（搬入 v3SessionRoutes POST 逻辑 + ack）
2. `sessionUpdateHandler.ts` 新增 `fetch-messages` 事件（搬入 v3SessionRoutes GET 逻辑 + ack）
3. `socket.ts` 新增 replay 逻辑

**验证**：手动通过 WS 调用 send-messages / fetch-messages，确认落库 + 广播 + ack 正确。

### Phase 2: CLI 切换到 WS

1. `apiSession.ts` flushOutbox 改 `emitWithAck('send-messages')`
2. `apiSession.ts` fetchMessages 改 `emitWithAck('fetch-messages')`
3. 重连带 lastSeq

**验证**：Daemon 发 agent 消息 → Server 落库 → App 能收到 update 事件。

### Phase 3: App 切换到 WS

1. `sync.ts` flushOutbox 改 `emitWithAck('send-messages')`
2. `sync.ts` fetchMessages 改 `emitWithAck('fetch-messages')`
3. `apiSocket.ts` 重连带 lastSeqs

**验证**：App 发用户消息 → Server 落库 → Daemon 收到 → Agent 回复 → App 收到。

### Phase 4: 删除 HTTP 路由

1. 确认 HTTP 端点零流量（可通过 metrics 验证）
2. 删除 `v3SessionRoutes.ts` 中 POST + GET
3. 删除 CLI/App 中所有 HTTP 消息调用残留代码
4. `grep -r "v3/sessions" apps/free/ --include="*.ts"` 确认无残留

### Phase 5: SQLite 缓存

1. 安装依赖：`expo-sqlite`（native）、`@journeyapps/wa-sqlite`（web）
2. 新增 `messageDB.ts`（接口）、`messageDB.native.ts`、`messageDB.web.ts`
3. `sync.ts` 进 session 先读缓存 + 实时消息写缓存
4. `SessionView.tsx` 先渲染本地缓存

**验证**：

- 进入 session → 立即显示缓存消息（无网络延迟）
- 收到新消息 → SQLite 同步更新
- 杀 App 后重新打开 session → 缓存仍在，增量同步
- Web 多标签页 → 不崩溃，写操作排队

## 12. 不需要改动的部分

| 模块                  | 原因                                    |
| --------------------- | --------------------------------------- |
| `eventRouter.ts`      | emitUpdate / emitEphemeral 逻辑不变     |
| `streamingHandler.ts` | streaming:text-delta 路径不变           |
| `AgentSession.ts`     | forwardOutputMessage 逻辑不变           |
| `rpcHandler.ts`       | App→Daemon 远程调用框架，与消息传递无关 |
| 所有管理 HTTP 路由    | account、kv、artifacts 等不在范围内     |
| outbox MMKV 持久化    | 只换发送载体，持久化机制不动            |
| 加解密逻辑            | 消息格式不变                            |
| Metro 配置            | wasm 支持已有，不需要 COOP/COEP         |
