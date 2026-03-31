# RFC-009: E2E Browser Testing via Metro Module Injection

> Historical note for the `headless-runtime` worktree:
> This RFC documents legacy and current implementation details. It is not the architecture
> source of truth for the refactor. Use `013-headless-runtime-architecture.md` first.

- **Status**: Implemented ✅（测试 harness 完成，CI 自动化待做）
- **Created**: 2026-03-15
- **Implemented**: 2026-03-16

## 原理

React Native Web 的开发服务器（Metro）会在 `window.__r` 上暴露模块系统。通过遍历模块 ID，可以直接获取 app 内部的业务模块（ops、storage、sync），绕过 UI 层直接调用函数，实现快速批量自动化测试。

**适用条件：** 仅限 Metro dev server（`localhost:8081`），生产包不可用。

## 核心 API

```js
window.__r; // Metro 的 require 函数
window.__r(id); // 按数字 ID 加载模块，返回 exports
```

## Step 1: 自动发现模块 ID

模块 ID 是数字且不稳定（代码变动后会变），所以每次通过导出特征自动发现：

```js
function discoverModules() {
  let opsId = -1,
    storageId = -1,
    syncId = -1;
  for (let i = 0; i < 3000; i++) {
    try {
      const mod = window.__r(i);
      if (!mod) continue;
      // ops 模块：导出 machineSpawnNewSession, sessionAllow 等
      if (mod.machineSpawnNewSession && mod.sessionAllow) opsId = i;
      // storage 模块：导出 Zustand store 和 hooks
      if (mod.storage && mod.useAllMachines) storageId = i;
      // sync 模块：导出 Sync 单例，有 sendMessage 方法
      if (mod.sync && typeof mod.sync.sendMessage === 'function') syncId = i;
    } catch {}
  }
  return { opsId, storageId, syncId };
}
```

## Step 2: 获取模块实例

```js
const { opsId, storageId, syncId } = discoverModules();

const ops = window.__r(opsId); // sync/ops.ts 导出
const storage = window.__r(storageId).storage; // Zustand store
const sync = window.__r(syncId).sync; // Sync 类单例
```

## Step 3: 获取基础上下文

```js
// 获取第一台在线机器
const machines = Object.values(storage.getState().machines);
const machine = machines[0];
const machineId = machine.id;
const homeDir = machine.metadata?.homeDir || '/Users/dev';
```

## 可用操作速查

### Session 生命周期

```js
// 创建 session
const result = await ops.machineSpawnNewSession({
  machineId,
  directory: homeDir,
  approvedNewDirectoryCreation: true,
  agent: 'claude', // claude | claude-acp | codex | codex-acp | gemini | opencode
  model: 'sonnet', // 可选
});
// result = { type: 'success', sessionId: '...' }

// 刷新 sessions（初始化加密，创建后必须调用）
await sync.refreshSessions();

// 发送消息
await sync.sendMessage(sessionId, '你好');

// 中断当前任务
await ops.sessionAbort(sessionId);

// 终止 session 进程
await ops.sessionKill(sessionId);

// 删除 session
await ops.sessionDelete(sessionId);
```

### 权限决策

```js
// 设置权限模式
storage.getState().updateSessionPermissionMode(sessionId, 'accept-edits');
// 可选值: 'read-only' | 'accept-edits' | 'yolo'

// 检查是否有待处理的权限请求
const session = storage.getState().sessions[sessionId];
const requests = session?.agentState?.requests || {};
const permissionId = Object.keys(requests)[0];

// 批准
await ops.sessionAllow(sessionId, permissionId);

// 拒绝
await ops.sessionDeny(sessionId, permissionId);
```

### Session 配置

```js
await ops.sessionSetModel(sessionId, 'sonnet'); // 切换模型
await ops.sessionSetMode(sessionId, 'code'); // 切换模式
await ops.sessionSetConfig(sessionId, optionId, val); // 设置配置
await ops.sessionRunCommand(sessionId, commandId); // 执行 slash 命令
```

### 文件操作（通过 CLI daemon 在远端执行）

```js
await ops.sessionReadFile(sessionId, '/path/to/file');
await ops.sessionWriteFile(sessionId, '/path/to/file', content, expectedHash);
await ops.sessionListDirectory(sessionId, '/path/to/dir');
await ops.sessionGetDirectoryTree(sessionId, '/path', maxDepth);
await ops.sessionRipgrep(sessionId, ['pattern', '--type', 'ts', '-l']);
await ops.sessionBash(sessionId, { command: 'echo hello' });
```

### 设置

```js
// 读取
const settings = storage.getState().settings;

// 修改（会自动同步到服务端）
sync.applySettings({ defaultPermissionMode: 'yolo' });
```

### 读取消息

```js
// 消息存储结构: sessionMessages[sid] = { messages: [], messagesMap, reducerState, isLoaded }
const container = storage.getState().sessionMessages[sessionId];
const messages = container?.messages || [];

// 消息字段: { id, localId, kind, text, tool, children, meta, traceId }
// kind 值: 'text' (文本) | 'tool_call' (工具调用) | 'mode_switch' (模式切换)
// meta.isUser 区分用户消息和 agent 消息

// 触发消息拉取
sync.onSessionVisible(sessionId);
```

## 完整测试模板

在 Chrome DevTools MCP 的 `evaluate_script` 或浏览器 Console 中粘贴执行：

```js
(async () => {
  // 1. 发现模块
  let opsId = -1,
    storageId = -1,
    syncId = -1;
  for (let i = 0; i < 3000; i++) {
    try {
      const mod = window.__r(i);
      if (!mod) continue;
      if (mod.machineSpawnNewSession && mod.sessionAllow) opsId = i;
      if (mod.storage && mod.useAllMachines) storageId = i;
      if (mod.sync && typeof mod.sync.sendMessage === 'function') syncId = i;
    } catch {}
  }

  const ops = window.__r(opsId);
  const storage = window.__r(storageId).storage;
  const sync = window.__r(syncId).sync;
  const machine = Object.values(storage.getState().machines)[0];

  // 2. 创建 session
  const res = await ops.machineSpawnNewSession({
    machineId: machine.id,
    directory: machine.metadata?.homeDir || '/Users/dev',
    approvedNewDirectoryCreation: true,
    agent: 'claude',
  });
  const sid = res.sessionId;
  await sync.refreshSessions();

  // 3. 发送消息
  await sync.sendMessage(sid, '你好');

  // 4. 等待回复
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 500));
    if (i % 4 === 0) sync.onSessionVisible(sid);
    const msgs = storage.getState().sessionMessages[sid]?.messages || [];
    const reply = msgs.find(m => m.kind === 'text' && !m.meta?.isUser);
    if (reply) {
      console.log('Agent replied:', reply.text);
      break;
    }
  }

  // 5. 清理
  await ops.sessionKill(sid);
})();
```

## 批量创建 session 示例

```js
(async () => {
  // ... 模块发现同上 ...

  const agents = ['claude', 'claude-acp', 'codex', 'codex-acp', 'gemini', 'opencode'];
  const message = '执行 echo "batch test"';

  for (const agent of agents) {
    const res = await ops.machineSpawnNewSession({
      machineId: machine.id,
      directory: machine.metadata?.homeDir,
      approvedNewDirectoryCreation: true,
      agent,
    });
    if (res.type === 'success') {
      await sync.refreshSessions();
      await sync.sendMessage(res.sessionId, message);
      console.log(`${agent}: ${res.sessionId} OK`);
    }
  }
})();
```

## 测试场景清单

| #   | 场景                          | 关键 API                                                    | 注意事项                               |
| --- | ----------------------------- | ----------------------------------------------------------- | -------------------------------------- |
| 1.1 | 创建 session（各 agent 类型） | `machineSpawnNewSession`                                    | 创建后必须 `refreshSessions()`         |
| 1.2 | 发送消息并等待回复            | `sendMessage` + 轮询 messages                               | 需要 `onSessionVisible` 触发拉取       |
| 1.3 | 中断任务                      | `sessionAbort`                                              | agent 未就绪时可能抛 RPC not available |
| 1.4 | 终止进程                      | `sessionKill`                                               | —                                      |
| 1.5 | 删除 session                  | `sessionDelete`                                             | —                                      |
| 2.1 | 权限批准                      | `sessionAllow`                                              | 需在 accept-edits 模式                 |
| 2.2 | 权限批准（仅本次）            | `sessionAllow(sid, id, null, null, 'approved_for_session')` | ACP agent 专用                         |
| 2.3 | 权限拒绝                      | `sessionDeny`                                               | —                                      |
| 2.4 | 权限中止                      | `sessionDeny(sid, id, null, null, 'abort')`                 | 终止整个操作                           |
| 2.5 | Yolo 模式                     | `updateSessionPermissionMode(sid, 'yolo')`                  | 不产生权限请求                         |
| 3.1 | 切换模型                      | `sessionSetModel`                                           | —                                      |
| 3.2 | 切换模式                      | `sessionSetMode`                                            | ACP agent                              |
| 4.1 | 读取文件                      | `sessionReadFile`                                           | 返回 base64                            |
| 4.2 | 写入文件                      | `sessionWriteFile`                                          | 支持 CAS (expectedHash)                |
| 4.3 | 列出目录                      | `sessionListDirectory`                                      | 返回 `{name, type, size, modified}[]`  |
| 4.4 | 目录树                        | `sessionGetDirectoryTree`                                   | 支持 maxDepth                          |
| 4.5 | 代码搜索                      | `sessionRipgrep`                                            | 参数为 args 数组                       |
| 5.1 | 执行命令                      | `sessionBash`                                               | 返回 `{stdout, stderr, exitCode}`      |
| 7.1 | 修改设置                      | `sync.applySettings`                                        | 自动同步服务端                         |

## 关键注意事项

1. **创建后必须 `refreshSessions()`** — 否则加密未初始化，后续操作报 `Session encryption not found`
2. **消息结构** — `sessionMessages[sid]` 不是数组，而是 `{ messages: [], messagesMap, reducerState, isLoaded }`
3. **消息字段** — 用 `kind`（不是 `type`/`role`），用 `meta.isUser` 区分用户和 agent
4. **拉取消息** — 消息不是自动推的，需要 `sync.onSessionVisible(sid)` 触发拉取
5. **模块 ID 不稳定** — 代码变动后 ID 会变，始终使用自动发现而非硬编码
6. **abort 时机** — agent 未开始工作时 `sessionAbort` 可能报 `RPC method not available`，非 bug

---

## 实现归档（2026-03-16）

### 实现文件

`apps/free/app/sources/__tests__/e2e-scenarios.ts`（626 行）

### 已实现的测试场景（18 个）

| 分类       | 场景                     | 函数名                         |
| ---------- | ------------------------ | ------------------------------ |
| lifecycle  | 创建 session（各 agent） | `test_createSessions`          |
| lifecycle  | 发消息等回复             | `test_sendMessageAndWaitReply` |
| lifecycle  | 中断任务                 | `test_abortSession`            |
| lifecycle  | 终止进程                 | `test_killSession`             |
| lifecycle  | 删除 session             | `test_deleteSession`           |
| permission | 批准权限                 | `test_permissionApprove`       |
| permission | 拒绝权限                 | `test_permissionDeny`          |
| permission | Yolo 模式                | `test_permissionYolo`          |
| config     | 切换模型                 | `test_switchModel`             |
| file       | 读取文件                 | `test_readFile`                |
| file       | 列出目录                 | `test_listDirectory`           |
| file       | 代码搜索                 | `test_ripgrep`                 |
| bash       | 执行命令                 | `test_bash`                    |
| settings   | 修改设置                 | `test_changeSettings`          |
| artifact   | 创建 artifact            | `test_createArtifact`          |

### 执行方式

通过 `window.__e2e.runAllScenarios(filter)` 调用，支持 filter：`'all'` / `'lifecycle'` / `'permission'` / `'config'` / `'file'` / `'bash'` / `'settings'` / `'quick'`

### 待完成

- CI/CD 自动化（Playwright/WebDriver 集成）
- 结果自动收集与上报
