# RFC-011: App 稳定性问题清单与修复方案

> Status: Planning
> Created: 2026-03-26
> Author: AgentBridge Team

## 1. 背景

本 RFC 归档当前已知的 9 个稳定性问题，按模块分组、明确根因、给出修复方向，作为后续 Sprint 的工作依据。

---

## 2. 问题清单

### 2.1 APP 侧

#### Issue-1：数据渲染过慢（高危）

**现象**：会话消息列表在消息数量较多时滚动卡顿，新消息到达时整屏闪烁。

**根因**：
- `useSessionMessages`（`storage.ts:1378`）订阅整个 `messages` 数组，reducer 每次产出新数组引用都触发全列表重渲
- `ChatList` 将所有消息一次性传入 FlatList，无 windowing 保护
- `ToolView` / `MessageView` 未做 `React.memo` 隔离

**修复方向**：
1. `ChatList` 改为只订阅 message ID 列表；单条消息用 `useMessage(sessionId, id)` 独立订阅，隔离更新范围
2. `ToolView` / `MessageView` 加 `React.memo` + 细粒度 `areEqual`
3. FlatList 补充 `getItemLayout`（定高消息）或 `removeClippedSubviews`

**验收标准**：1000 条消息的会话，新消息到达时 JS 帧耗时 < 16ms。

---

#### Issue-2：切换 options 超时卡死（高危）

**现象**：在 SessionView 切换 config option（model、mode 等）后，UI 长时间无响应，最终超时报错。

**根因**：
- `sessionSetConfig` → `apiSocket.sessionRPC` → `socket.emitWithAck`（`apiSocket.ts:131`）
- Socket.io `emitWithAck` 无默认超时，daemon 端 handler 未注册或阻塞时 Promise 永远不 resolve
- 5 次重试逻辑（`apiSocket.ts:145`）仅覆盖 `'RPC method not available'` 错误，真正的 hang 无法触发

**修复方向**：
```typescript
// apiSocket.ts — sessionRPC 增加超时保护
// 方案 A：Socket.io v4 内置
const result = await this.socket!.timeout(8000).emitWithAck('rpc-call', request);

// 方案 B：Promise.race
const result = await Promise.race([
  this.socket!.emitWithAck('rpc-call', request),
  new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('RPC timeout after 8s')), 8000)
  ),
]);
```
同时在 `sessionSetConfig` 调用处 catch 超时错误并向 UI 抛出可展示的提示。

**验收标准**：daemon 不可达时，UI 在 8 秒内收到明确错误提示，不再卡死。

---

#### Issue-3：缓存数据丢失，缺少对齐/修补机制（高危）

**现象**：App 重启后部分消息消失；除非手动 clear cache 否则无法恢复。

**根因**：
1. `messageDB.web.ts:63` — 初始化失败时设 `initFailed = true`（模块级变量），此后所有 DB 操作静默返回空，无法自愈
2. `upsertMessages`（`:129`）与 `updateLastSeq`（`:132`）是两次独立调用，非原子操作；断线时 `last_seq` 可能先于消息写入而超前
3. 无 integrity check，DB 损坏时不感知
4. 无"按 seq 对比服务端、补拉差量"的修复路径

**修复方向**：
1. 将 `initFailed` 逻辑改为可重置，提供 `resetAndReinitDB()` 供 clear cache 以外的场景调用
2. `upsertMessages` + `updateLastSeq` 合并到同一事务：
   ```sql
   BEGIN TRANSACTION;
     INSERT OR REPLACE INTO messages ...;
     INSERT OR REPLACE INTO session_sync (session_id, last_seq, synced_at) VALUES (...);
   COMMIT;
   ```
3. 启动时执行 `PRAGMA integrity_check`，失败则删除 DB 文件并重建
4. 新增 `repairSession(sessionId)` 函数：读取本地 `last_seq`，与服务端最新 seq 对比，拉取差量并回填

**验收标准**：强杀 App 后重启，消息丢失率为 0；DB 文件损坏时自动重建而非静默失败。

---

#### Issue-4：work 状态显示断断续续（中危）

**现象**：会话列表 / 聊天头部的"运行中"指示器忽闪忽灭，无法区分"正在执行"、"等待权限"、"异常挂起"。

**根因**：
- `storageTypes.ts:73` — `session.status` 只有 `active|offline|archived|deleted`，无运行语义
- `session.thinking: boolean` 是唯一运行指示，`thinking=false` 无法区分"正常空闲"与"异常挂起"
- `AgentState.requests`（待批准权限）未映射到独立的 UI 状态
- 各处 UI 各自推断工作状态，逻辑不一致

**修复方向**：
在 reducer 层新增派生字段 `workStatus`，存入 `ReducerState`：

```typescript
type WorkStatus =
  | 'idle'                // 无活动
  | 'thinking'            // agent 正在推理
  | 'awaiting_permission' // 有 pending permission request
  | 'tool_running'        // tool 正在执行
  | 'suspended'           // session 离线但有未完成 tool（推测挂起）
  | 'error';              // 最后一条消息为 error

// 优先级：awaiting_permission > tool_running > thinking > suspended > error > idle
```

UI 统一消费 `reducerState.workStatus`，不再各处自行推断。

**验收标准**：全部 5 种状态可在测试场景中准确触发和显示。

---

#### Issue-5：大历史记录初次全量加载（中危）

**现象**：打开有大量历史消息的会话时，首屏加载慢，内存占用高。

**根因**：
- 初次打开会话时 sync 拉取全量消息并一次性 reduce
- `messageDB.getMessages` 虽支持 `beforeSeq` 分页（`:95`），但初始化路径可能未限制条数
- `ChatList` 未实现 `onStartReached` 触发增量加载

**修复方向**：
1. 初始加载限制为最新 50 条：`SELECT ... ORDER BY seq DESC LIMIT 50`
2. `ChatList` 补充 `onStartReached` 回调，触发 `sync.loadOlderMessages(sessionId, beforeSeq)`
3. `useSessionMessages` 的 `hasOlderMessages` / `isLoadingOlder` 已预留接口，补全实现

**验收标准**：1000 条历史消息的会话首屏加载 < 1 秒；向上滚动时动态加载更早的消息。

---

### 2.2 权限/安全

#### Issue-6：权限申请超时用户未回复时未自动拒绝（高危）

**现象**：用户锁屏或离开后，pending permission request 永久挂起，agent tool 调用最终超时失败，错误信息不明确。

**根因**：
- `PermissionFooter.tsx` 无任何 timeout 机制，`pending` 状态可永久保持
- App 端无 `setTimeout → sessionDeny` 兜底
- daemon 端 permission request 无 TTL

**修复方向**：

App 端（`PermissionFooter.tsx`）：
```typescript
useEffect(() => {
  if (permission.status !== 'pending') return;
  // 5 分钟无操作自动拒绝
  const timer = setTimeout(() => {
    void sessionDeny(sessionId, permission.id, undefined, undefined, 'denied');
    logger.info('tool_permission_auto_denied_timeout', { sessionId, permissionId: permission.id });
  }, 5 * 60 * 1000);
  return () => clearTimeout(timer);
}, [permission.id, permission.status, sessionId]);
```

Daemon 端：permission request 存入时记录 `createdAt`，超过 30 分钟未决策时自动标记 `denied` 并广播状态变更。

**验收标准**：permission 挂起 5 分钟后 UI 自动变为 denied；daemon 侧 30 分钟后自动清理并向 agent 返回 denied。

---

#### Issue-7：Cursor ACP 权限申请控制不生效，出现重复申请（中危）

**现象**：Cursor agent 会连续弹出多个相同的权限申请弹窗。

**根因**：
- `agentFlavor.ts:33-41` — `usesAcpPermissionDecisions('cursor')` 返回 `true`，走 ACP 权限路径，本身正确
- Cursor ACP 发出的 permission request 消息中 `id` 字段可能每次不同（或为空），绕过 reducer 的 `processedIds` 去重
- reducer 当前仅以 `id` 字段去重，未考虑 `(tool + arguments)` 维度

**修复方向**：
1. reducer 处理 pending permission 时，额外以 `${tool}:${JSON.stringify(arguments)}` 作为 content-based 去重 key（`id` 为空时 fallback）
2. `PermissionFooter` 渲染时，相同 `toolName + toolInput` 的多个 pending 请求合并展示为一条

**需要调查**：抓取 Cursor ACP 实际发出的 permission request 结构，确认 `id` 字段是否稳定。

**验收标准**：Cursor session 中同一工具调用只展示一个权限弹窗。

---

### 2.3 CLI/工具链

#### Issue-8：文件查看器 ENOENT — 路径含 `-session`（中危）

**现象**：Claude Code 文件查看器尝试打开 `apps/free/app/sources/-session/SessionView.tsx` 时报 ENOENT；某些 glob/watch 工具也跳过该目录。

**根因**：
- `sources/-session/` 目录名以 `-` 开头
- 部分 CLI 工具将 `-session` 解析为 flag 前缀而非路径段
- Expo Metro file watcher 在某些配置下会跳过 `-` 开头的目录

**修复方向**：
将 `sources/-session/` 重命名为 `sources/_session/`（或直接 `sources/session/`，sources 目录下无 Expo Router 冲突）：
```bash
git mv apps/free/app/sources/-session apps/free/app/sources/_session
```
更新所有 `import` 路径（`@/-session/` → `@/_session/`）。

**验收标准**：重命名后 `npx madge --circular` 通过，文件查看器和 glob 工具均可正常访问。

---

### 2.4 Web 侧

#### Issue-9：Web 侧 SQLite 不生效（高危）

**现象**：Web 版 App 无本地消息缓存，每次刷新重新拉取全量数据，且无离线支持。

**根因**：
1. `messageDB.web.ts:16` — `import wasmAssetUrl from '.../wa-sqlite-async.wasm'` 依赖 Metro asset 机制，在 Expo web（Webpack）构建下 wasm 文件路径解析方式不同，`fetch(wasmAssetUrl)` 返回 404
2. `messageDB.web.ts:33` — `IDBBatchAtomicVFS` 从 `src/examples/` 导入，该路径为非稳定 API，包更新后可能消失
3. 任何初始化失败都触发 `initFailed = true`，错误被 `String(error)` 吞掉，开发者无法感知具体原因
4. `initFailed` 为模块级变量，进程生命周期内不可恢复

**修复方向**：
1. **诊断先行**：将 `logger.warn` 改为 `logger.error` 并打印完整 stack，确认实际失败原因
2. **wasm 路径修复**：
   - 检查 `metro.config.js` 的 `assetExts` 是否包含 `wasm`
   - 检查 `webpack.config.js` 是否配置 `asset/resource` for `.wasm`
   - 备选：将 wasm 文件 base64 内联，消除运行时 fetch
3. **依赖路径稳定化**：将 `IDBBatchAtomicVFS` 改从包的 stable export 导入（或 vendor 到项目内）
4. **可恢复 initFailed**：改为指数退避重试（最多 3 次），仍失败后降级为 no-cache 模式并上报

**验收标准**：Web 版 App 刷新后消息从 IndexedDB 读取，网络请求中无全量消息拉取。

---

## 3. 实施优先级

| 优先级 | Issue | 原因 |
|--------|-------|------|
| P0 | Issue-6 权限超时无自动拒绝 | agent 流程 hang，影响所有用户 |
| P0 | Issue-9 Web SQLite 不生效 | Web 端核心功能缺失 |
| P0 | Issue-2 options 切换卡死 | RPC hang 可无限期阻塞 UI |
| P1 | Issue-3 缓存丢失无修复 | 数据可靠性问题 |
| P1 | Issue-1 渲染过慢 | 体验核心，影响留存 |
| P2 | Issue-5 全量加载 | 影响历史消息多的用户 |
| P2 | Issue-4 work 状态 | UX 质量 |
| P2 | Issue-7 Cursor ACP 重复 | 特定 agent 问题 |
| P3 | Issue-8 ENOENT 路径 | 工具链问题，不影响运行时 |

---

## 4. 依赖关系

```
Issue-3 (缓存修复) 依赖 Issue-9 (Web SQLite 先跑通)
Issue-5 (增量加载) 依赖 Issue-3 (缓存可靠后才有意义)
Issue-1 (渲染优化) 可独立进行
Issue-6 (权限超时) App 端可独立进行，daemon 端需协调
Issue-7 (Cursor 重复) 需要先抓包确认 Cursor permission id 结构
```

---

## 5. 不在本 RFC 范围内

- 新功能开发
- 服务端性能优化
- 非 App / Web / CLI 模块的问题
