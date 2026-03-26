# RFC-011: App 稳定性问题清单与修复方案

> Status: Completed
> Created: 2026-03-26
> Completed: 2026-03-26
> Author: AgentBridge Team

## 1. 背景

本 RFC 归档了 9 个已知稳定性问题，按模块分组、明确根因、给出修复方向，作为 Sprint 工作依据。
**全部 9 个 issue 已在 2026-03-26 完成修复并合并到 main。**

---

## 2. 问题清单

### 2.1 APP 侧

#### Issue-1：数据渲染过慢（高危）✅ 已修复

**现象**：会话消息列表在消息数量较多时滚动卡顿，新消息到达时整屏闪烁。

**根因**：
- `useSessionMessages`（`storage.ts`）订阅整个 `messages` 数组，reducer 每次产出新数组引用都触发全列表重渲
- `ChatList` 将所有消息一次性传入 FlatList，无 windowing 保护
- `ToolView` / `MessageView` 未做 `React.memo` 隔离

**实际实现**（commit `f4adab9`）：
1. `ChatList` 改为只订阅 message ID 列表（新增 `useSessionMessageIds` hook，`storage.ts`）；单条消息用 `MessageRow` 独立订阅，隔离更新范围
2. `MessageView` 加 `React.memo` 隔离重渲
3. FlatList 加 `removeClippedSubviews`

**与 RFC 方向的差异**：
- RFC 建议 `getItemLayout`（定高消息），实际用 `removeClippedSubviews`（定高适配复杂，`removeClippedSubviews` 效果等价且实现更简单）
- `useMessage(sessionId, id)` 模式与 RFC 完全一致

**验收标准**：✅ 新消息到达时只渲染新增条目，不触发全列表重渲

---

#### Issue-2：切换 options 超时卡死（高危）✅ 已修复

**现象**：切换 config option 后 UI 长时间无响应，最终超时报错。

**根因**：
- `sessionRPC` → `socket.emitWithAck` 无超时保护
- RPC 5 次重试仅覆盖 `'RPC method not available'` 错误，hang 无法触发

**实际实现**（commits `b0d5355`、`24dc4ef`）：
1. `apiSocket.ts:250` — `socket.timeout(5000).emitWithAck`（方案 A）：5s 内未收到 ack 抛出 `TimeoutError`
2. `daemon-rpc-ready` 事件驱动替换轮询重试：daemon 注册首个 RPC 方法后广播一次，App 端等待信号后重试，消除了重试时序竞态
3. ACP JSONRPC 全链路 `withTimeout()`：`prompt()` 2min、`loadSession()` 5min 超时保护（`24dc4ef`）

**与 RFC 方向的差异**：
- RFC 建议 8s timeout，实际实现 5s（更激进，经生产验证合理）
- 额外新增了 `daemon-rpc-ready` 事件机制，比 RFC 描述的 catch-and-show 更完善

**验收标准**：✅ daemon 不可达时，UI 在 5 秒内收到明确错误提示

---

#### Issue-3：缓存数据丢失（高危）✅ 已修复

**现象**：App 重启后部分消息消失；`last_seq` 超前导致下次同步跳过消息。

**根因**：
1. `initFailed = true` 模块级变量，初始化失败后全生命周期静默降级，无法自愈
2. `upsertMessages` + `updateLastSeq` 两次独立调用，断线时 seq 可能超前于消息

**实际实现**（commit `f12b9c5`）：
1. 新增 `upsertMessagesAndSeq(sessionId, messages, seq)` — 原子事务，消息写入与 seq 更新在同一 `BEGIN TRANSACTION; ... COMMIT;` 内（`messageDB.native.ts` 用 `withTransactionAsync`，`messageDB.web.ts` 用字符串拼接事务）
2. `messageDB.web.ts` 中 `initFailed: boolean` 改为 `initRetryAfter: number` + `initAttempt: number`，指数退避重试（30s → 60s → 120s），3 次后才永久降级
3. `sync.ts` 中所有 `upsertMessages + updateLastSeq` 调用替换为 `upsertMessagesAndSeq`

**与 RFC 方向的差异**：
- RFC 建议 `PRAGMA integrity_check` 和 `repairSession()`，实际未实现（属于增强，不阻塞核心修复）
- RFC 建议 `resetAndReinitDB()`，实际通过指数退避实现等价的"自愈"能力

**验收标准**：✅ 强杀 App 后重启，seq 与消息保持原子一致

---

#### Issue-4：work 状态显示断断续续（中危）✅ 已修复

**现象**：运行中指示器忽闪忽灭，无法区分"正在执行"、"等待权限"、"异常挂起"。

**根因**：
- `session.thinking: boolean` 是唯一运行指示，无法区分细粒度状态
- `AgentState.requests` 未映射到独立 UI 状态

**实际实现**（commit `6aab9c9`）：
1. `ReducerState` 新增 `activeToolCallCount: number`，reducer 末尾遍历所有消息重新计算（确定性）
2. `storage.ts` 新增 `useSessionActiveToolCallCount(sessionId)` hook
3. `sessionUtils.ts` 中 `SessionState` 类型扩展为：
   ```typescript
   type SessionState =
     | 'disconnected'       // 会话不存在
     | 'suspended'          // daemon 离线但 thinking=true（amber #FF9500）
     | 'thinking'           // 在线推理中（blue pulsing）
     | 'tool_running'       // 在线 + thinking + 工具运行中（blue pulsing）
     | 'waiting'            // 在线空闲
     | 'permission_required'; // 待批准权限
   ```
4. `useSessionStatus()` 集中派生所有状态，UI 统一消费

**与 RFC 方向的差异**：
- RFC 建议 `workStatus` 放入 `ReducerState`，实际通过 `useSessionStatus()` hook 派生（避免 reducer 依赖 session 连接状态）
- RFC 的 `'error'` 状态未实现（最后一条 error 消息可通过其他方式展示）
- RFC 命名 `awaiting_permission`，实际命名 `permission_required`（与其他 RPC 字段对齐）

**验收标准**：✅ `suspended` 和 `tool_running` 状态可准确触发和显示

---

#### Issue-5：大历史记录初次全量加载（中危）✅ 已修复

**现象**：打开有大量历史消息的会话时，首屏加载慢，内存占用高。

**根因**：
- 初次打开会话时 sync 拉取全量消息并一次性 reduce
- 初始化路径未限制条数

**实际实现**（commit `f12b9c5`）：
1. `onSessionVisible` 初始缓存加载限制改为 50 条（原 5000）
2. `loadOlderMessages` 新增 SQLite 缓存优先路径：先查本地 `messageDB.getMessages(sessionId, { limit: 50, beforeSeq })`，有数据直接使用，无数据再回落到服务端拉取

**与 RFC 方向的差异**：与 RFC 方向完全一致

**验收标准**：✅ 首屏加载最新 50 条；向上滚动触发增量加载

---

### 2.2 权限/安全

#### Issue-6：权限申请超时用户未回复时未自动拒绝（高危）✅ 已修复

**现象**：用户锁屏或离开后，pending permission request 永久挂起。

**根因**：
- `PermissionFooter.tsx` 无任何 timeout 机制
- daemon 端 permission request 无 TTL

**实际实现**（commit `f4adab9`）：

App 端（`PermissionFooter.tsx`）：
```typescript
useEffect(() => {
  if (permission.status !== 'pending') return;
  const timer = setTimeout(() => {
    void sessionDeny(sessionId, permission.id, undefined, undefined, 'denied');
    logger.info('tool_permission_auto_denied_timeout', { sessionId, permissionId: permission.id });
  }, 5 * 60 * 1000); // 5 分钟无操作自动拒绝
  return () => clearTimeout(timer);
}, [permission.id, permission.status, sessionId]);
```

Daemon 端（`BasePermissionHandler.ts`）：
- `PendingRequest` 新增 `createdAt` 字段
- 每 5 分钟 GC 清理超 30 分钟的 pending 请求，自动标记 denied 并从 agentState 移除

**与 RFC 方向的差异**：与 RFC 方向完全一致

**验收标准**：✅ permission 挂起 5 分钟后 UI 自动变为 denied；daemon 侧 30 分钟后自动清理

---

#### Issue-7：Cursor ACP 权限申请出现重复申请（中危）✅ 已修复

**现象**：Cursor agent 会连续弹出多个相同的权限申请弹窗。

**根因**：
- Cursor ACP `request_permission` 消息的 `toolCall?.id` 为 null，导致 `acp.ts` 每次 `randomUUID()` 生成新 ID
- reducer Phase 0 仅以 `permId` 去重，相同工具不同 ID → 创建重复消息

**实际实现**（commits `533a78e`、`de6d52a`）：
1. `reducer.ts` Phase 0 中新增内容去重（content-based dedup）：创建新权限消息前，先遍历 `state.permissions` 寻找 `status === 'pending'` 且 `tool + stableStringify(arguments)` 相同的已有条目；若找到，直接将新 `permId` 别名到已有消息 ID
2. 新增 `stableStringify()` 函数：递归按字母序排列对象键，确保键顺序不同的相同参数能正确匹配（修复 `JSON.stringify` 键顺序不稳定问题）

**与 RFC 方向的差异**：
- RFC 建议 `${tool}:${JSON.stringify(arguments)}`（键顺序不稳定），实际用 `stableStringify`（更健壮）
- RFC 建议同时在 `PermissionFooter` 合并展示，实际在 reducer 层直接去重（源头解决，UI 层无需改动）

**验收标准**：✅ Cursor session 中相同工具调用只创建一个权限消息，新 permId 别名到已有消息

---

### 2.3 CLI/工具链

#### Issue-8：文件查看器 ENOENT — 路径含 `-session`（中危）✅ 已修复

**现象**：Claude Code 文件查看器打开 `sources/-session/SessionView.tsx` 时报 ENOENT。

**根因**：
- 目录名以 `-` 开头，部分 CLI 工具将 `-session` 解析为 flag 前缀

**实际实现**（commits `f4adab9`、`2e664b5`）：
1. `sources/-session/` → `sources/_session/`（`git mv`），更新所有 import 路径（`@/-session/` → `@/_session/`）
2. `2e664b5` 额外修复文件查看器使用 `validatePath()` 返回的绝对路径，彻底规避路径解析问题

**与 RFC 方向的差异**：与 RFC 方向完全一致

**验收标准**：✅ 文件查看器和 glob 工具均可正常访问 `_session` 目录

---

### 2.4 Web 侧

#### Issue-9：Web 侧 SQLite 不生效（高危）✅ 已修复

**现象**：Web 版 App 无本地消息缓存，每次刷新重新拉取全量数据。

**根因**：
1. wasm 路径解析：Metro 构建下 asset import 返回模块对象而非 URL，`fetch(wasmAssetUrl)` 失败
2. `initFailed = true` 模块级变量，初始化失败后无法自愈

**实际实现**（commits `f856a6a`、`f12b9c5`）：
1. **wasm 路径修复**（`f856a6a`）：改为静态路径 `/wa-sqlite-async.wasm`（Metro web 静态文件从 `/public` 目录服务），完全绕过 Metro asset 机制
2. **可重试 initFailed**（`f12b9c5`）：`initFailed: boolean` → `initRetryAfter: number` + `initAttempt: number`，指数退避（30s → 60s → 120s → 永久降级），仍失败时降级为 no-cache 模式

**与 RFC 方向的差异**：
- RFC 建议检查 `metro.config.js` 的 `assetExts`，实际通过静态路径绕过，不修改构建配置（更简单可靠）
- RFC 建议 base64 内联作为备选，实际静态路径已满足需求，未采用

**验收标准**：✅ Web 版 App 刷新后从 IndexedDB（wa-sqlite）读取消息缓存

---

## 3. 实施优先级（已完成）

| 优先级 | Issue | Commit | 完成时间 |
|--------|-------|--------|---------|
| P0 | Issue-6 权限超时无自动拒绝 | `f4adab9` | 2026-03-26 |
| P0 | Issue-9 Web SQLite 不生效 | `f856a6a`, `f12b9c5` | 2026-03-26 |
| P0 | Issue-2 options 切换卡死 | `b0d5355`, `24dc4ef` | 2026-03-26 |
| P1 | Issue-3 缓存丢失无修复 | `f12b9c5` | 2026-03-26 |
| P1 | Issue-1 渲染过慢 | `f4adab9`, `471a7e5` | 2026-03-26 |
| P2 | Issue-5 全量加载 | `f12b9c5` | 2026-03-26 |
| P2 | Issue-4 work 状态 | `6aab9c9` | 2026-03-26 |
| P2 | Issue-7 Cursor ACP 重复 | `533a78e`, `de6d52a` | 2026-03-26 |
| P3 | Issue-8 ENOENT 路径 | `f4adab9`, `2e664b5` | 2026-03-26 |

---

## 4. 依赖关系（已验证）

```
Issue-9 (Web SQLite 修复)  ──▶  Issue-3 (缓存原子写入)  ──▶  Issue-5 (增量加载)
Issue-1 (渲染优化)            独立完成
Issue-6 (权限超时)             App 端独立完成；daemon 端 GC 同步完成
Issue-7 (Cursor 重复)          生产日志确认根因后修复
```

---

## 5. 不在本 RFC 范围内

- 新功能开发
- 服务端性能优化
- 非 App / Web / CLI 模块的问题

---

## 6. 遗留事项（不阻塞发布）

以下为 RFC 原始方向中未完全落地的增强项，可在后续迭代跟进：

| Issue | 遗留点 | 原因 |
|-------|--------|------|
| Issue-3 | `PRAGMA integrity_check` + `repairSession()` | 核心原子写入已修复，integrity check 属于防御性增强 |
| Issue-4 | `'error'` 状态 | 错误消息已通过其他 UI 路径展示 |
| Issue-1 | `getItemLayout` 定高优化 | `removeClippedSubviews` 已满足性能需求 |
