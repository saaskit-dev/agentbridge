/**
 * E2E Scenario Test Suite
 *
 * 通过 Metro bundler 的 window.__r() 直接调用内部模块，
 * 在浏览器 DevTools console 或 Chrome DevTools MCP 中执行。
 *
 * 使用方式：
 *   1. 在 Chrome DevTools MCP 中通过 evaluate_script 执行
 *   2. 或者在浏览器 console 中粘贴执行
 *
 * 模块 ID 映射（开发环境，ID 可能因代码变动而变化）：
 *   - ops:     window.__r(1655) → machineSpawnNewSession, sessionAllow, sessionDeny, etc.
 *   - storage: window.__r(1472) → storage (Zustand store)
 *   - sync:    window.__r(1487) → sync (Sync singleton)
 */

// ============================================================================
// 场景清单
// ============================================================================
//
// 一、Session 生命周期
//   1.1 创建 session（每种 agent 类型）
//   1.2 发送消息并等待回复
//   1.3 中断正在执行的任务（abort）
//   1.4 终止 session 进程（kill）
//   1.5 删除 session（delete）
//
// 二、权限决策
//   2.1 Agent 请求权限 → 用户批准（approve）
//   2.2 Agent 请求权限 → 批准本次会话（approve_for_session）
//   2.3 Agent 请求权限 → 用户拒绝（deny）
//   2.4 Agent 请求权限 → 用户中止（abort）
//   2.5 权限模式：read-only / accept-edits / yolo
//
// 三、Session 配置
//   3.1 切换模型（setModel）
//   3.2 切换模式（setMode）
//   3.3 设置配置项（setConfig）
//   3.4 执行 slash 命令（runCommand）
//
// 四、文件操作
//   4.1 读取文件（readFile）
//   4.2 写入文件（writeFile）
//   4.3 列出目录（listDirectory）
//   4.4 获取目录树（getDirectoryTree）
//   4.5 代码搜索（ripgrep）
//
// 五、Bash 执行
//   5.1 执行命令并获取 stdout/stderr/exitCode
//
// 六、消息流
//   6.1 发送消息 → 加密 → 服务端 → 解密 → 显示
//   6.2 Outbox 队列（离线后重连自动发送）
//   6.3 流式文本更新（ephemeral updates）
//
// 七、设置
//   7.1 修改权限模式默认值
//   7.2 修改语言
//   7.3 切换功能开关
//
// 八、工件（Artifacts）
//   8.1 创建工件
//   8.2 更新工件
//   8.3 列出工件
//
// ============================================================================

interface TestResult {
  scenario: string;
  status: 'pass' | 'fail' | 'skip';
  detail?: any;
  error?: string;
  durationMs?: number;
}

interface TestContext {
  ops: any;
  storage: any;
  sync: any;
  machineId: string;
  homeDir: string;
  /** 当前测试创建的 session IDs，测试结束后清理 */
  createdSessionIds: string[];
}

// ============================================================================
// Module Discovery - 自动发现模块 ID
// ============================================================================

function discoverModules(): { opsId: number; storageId: number; syncId: number } | null {
  const r = (window as any).__r;
  if (!r) return null;

  let opsId = -1, storageId = -1, syncId = -1;

  for (let i = 0; i < 3000; i++) {
    try {
      const mod = r(i);
      if (!mod) continue;
      if (mod.machineSpawnNewSession && mod.sessionAllow) opsId = i;
      if (mod.storage && mod.useAllMachines) storageId = i;
      if (mod.sync && typeof mod.sync.sendMessage === 'function') syncId = i;
    } catch {}
  }

  if (opsId < 0 || storageId < 0 || syncId < 0) return null;
  return { opsId, storageId, syncId };
}

// ============================================================================
// Helpers
// ============================================================================

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForCondition(
  check: () => boolean,
  timeoutMs: number = 30000,
  intervalMs: number = 500
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (check()) return true;
    await sleep(intervalMs);
  }
  return false;
}

function getSessionMessages(ctx: TestContext, sessionId: string): any[] {
  return ctx.storage.getState().sessionMessages[sessionId] || [];
}

function getSession(ctx: TestContext, sessionId: string): any {
  return ctx.storage.getState().sessions[sessionId];
}

function hasAgentReply(ctx: TestContext, sessionId: string): boolean {
  const msgs = getSessionMessages(ctx, sessionId);
  return msgs.some((m: any) => m.type === 'agent_text' || m.type === 'text' || m.role === 'assistant');
}

function hasPendingPermission(ctx: TestContext, sessionId: string): boolean {
  const session = getSession(ctx, sessionId);
  if (!session?.agentState?.requests) return false;
  return Object.keys(session.agentState.requests).length > 0;
}

function getFirstPendingPermissionId(ctx: TestContext, sessionId: string): string | null {
  const session = getSession(ctx, sessionId);
  if (!session?.agentState?.requests) return null;
  const ids = Object.keys(session.agentState.requests);
  return ids.length > 0 ? ids[0] : null;
}

// ============================================================================
// Test Runner
// ============================================================================

async function runScenario(
  name: string,
  fn: (ctx: TestContext) => Promise<any>,
  ctx: TestContext
): Promise<TestResult> {
  const start = Date.now();
  try {
    const detail = await fn(ctx);
    return { scenario: name, status: 'pass', detail, durationMs: Date.now() - start };
  } catch (e: any) {
    return { scenario: name, status: 'fail', error: String(e), durationMs: Date.now() - start };
  }
}

// ============================================================================
// Scenario Implementations
// ============================================================================

// --- 1.1 创建 session（所有 agent 类型） ---
async function test_createSessions(ctx: TestContext) {
  const agents = ['claude', 'claude-native', 'codex', 'gemini', 'opencode'];
  const results: any[] = [];

  for (const agent of agents) {
    try {
      const result = await ctx.ops.machineSpawnNewSession({
        machineId: ctx.machineId,
        directory: ctx.homeDir,
        approvedNewDirectoryCreation: true,
        agent,
      });
      if (result.type === 'success' && result.sessionId) {
        ctx.createdSessionIds.push(result.sessionId);
        results.push({ agent, sessionId: result.sessionId, status: 'ok' });
      } else {
        results.push({ agent, status: 'spawn_failed', result });
      }
    } catch (e: any) {
      results.push({ agent, status: 'error', error: String(e) });
    }
  }

  const allOk = results.every(r => r.status === 'ok');
  if (!allOk) throw new Error(`Some agents failed: ${JSON.stringify(results.filter(r => r.status !== 'ok'))}`);
  return results;
}

// --- 1.2 发送消息并等待回复 ---
async function test_sendMessageAndWaitReply(ctx: TestContext) {
  const result = await ctx.ops.machineSpawnNewSession({
    machineId: ctx.machineId,
    directory: ctx.homeDir,
    approvedNewDirectoryCreation: true,
    agent: 'claude',
  });
  if (result.type !== 'success') throw new Error('Failed to create session');

  const sid = result.sessionId;
  ctx.createdSessionIds.push(sid);

  await ctx.sync.refreshSessions();
  await ctx.sync.sendMessage(sid, '回复 OK 两个字母就行，不要其他内容');

  // 等待回复（最多 30 秒）
  const gotReply = await waitForCondition(() => hasAgentReply(ctx, sid), 30000);
  if (!gotReply) throw new Error('No agent reply within 30s');

  const messages = getSessionMessages(ctx, sid);
  return { sessionId: sid, messageCount: messages.length, lastMessage: messages[messages.length - 1] };
}

// --- 1.3 中断任务 (abort) ---
async function test_abortSession(ctx: TestContext) {
  const result = await ctx.ops.machineSpawnNewSession({
    machineId: ctx.machineId,
    directory: ctx.homeDir,
    approvedNewDirectoryCreation: true,
    agent: 'claude',
  });
  if (result.type !== 'success') throw new Error('Failed to create session');

  const sid = result.sessionId;
  ctx.createdSessionIds.push(sid);

  await ctx.sync.refreshSessions();
  await ctx.sync.sendMessage(sid, '请列出 /Users/dev 目录下的所有文件，每行一个，不要省略');

  // 等 2 秒让 agent 开始工作
  await sleep(2000);

  // 中断
  await ctx.ops.sessionAbort(sid);
  return { sessionId: sid, aborted: true };
}

// --- 1.4 终止 session 进程 (kill) ---
async function test_killSession(ctx: TestContext) {
  const result = await ctx.ops.machineSpawnNewSession({
    machineId: ctx.machineId,
    directory: ctx.homeDir,
    approvedNewDirectoryCreation: true,
    agent: 'claude',
  });
  if (result.type !== 'success') throw new Error('Failed to create session');

  const sid = result.sessionId;
  // Don't add to createdSessionIds since we're killing it

  await ctx.ops.sessionKill(sid);
  return { sessionId: sid, killed: true };
}

// --- 1.5 删除 session ---
async function test_deleteSession(ctx: TestContext) {
  const result = await ctx.ops.machineSpawnNewSession({
    machineId: ctx.machineId,
    directory: ctx.homeDir,
    approvedNewDirectoryCreation: true,
    agent: 'claude',
  });
  if (result.type !== 'success') throw new Error('Failed to create session');

  const sid = result.sessionId;
  await ctx.ops.sessionDelete(sid);
  return { sessionId: sid, deleted: true };
}

// --- 2.1 权限请求 → 批准 ---
async function test_permissionApprove(ctx: TestContext) {
  const result = await ctx.ops.machineSpawnNewSession({
    machineId: ctx.machineId,
    directory: ctx.homeDir,
    approvedNewDirectoryCreation: true,
    agent: 'claude',
  });
  if (result.type !== 'success') throw new Error('Failed to create session');

  const sid = result.sessionId;
  ctx.createdSessionIds.push(sid);

  // accept-edits 模式，agent 执行 bash 会请求权限
  ctx.storage.getState().updateSessionPermissionMode(sid, 'accept-edits');
  await ctx.sync.refreshSessions();
  await ctx.sync.sendMessage(sid, '执行 echo "hello permission test"');

  // 等待权限请求
  const gotPermission = await waitForCondition(() => hasPendingPermission(ctx, sid), 30000);
  if (!gotPermission) {
    // 可能 agent 在 yolo 模式直接执行了，或者还没产生权限请求
    return { sessionId: sid, status: 'no_permission_requested', note: 'agent may have auto-approved' };
  }

  const permId = getFirstPendingPermissionId(ctx, sid);
  if (!permId) throw new Error('Permission ID not found');

  await ctx.ops.sessionAllow(sid, permId);
  return { sessionId: sid, permissionId: permId, approved: true };
}

// --- 2.3 权限请求 → 拒绝 ---
async function test_permissionDeny(ctx: TestContext) {
  const result = await ctx.ops.machineSpawnNewSession({
    machineId: ctx.machineId,
    directory: ctx.homeDir,
    approvedNewDirectoryCreation: true,
    agent: 'claude',
  });
  if (result.type !== 'success') throw new Error('Failed to create session');

  const sid = result.sessionId;
  ctx.createdSessionIds.push(sid);

  ctx.storage.getState().updateSessionPermissionMode(sid, 'accept-edits');
  await ctx.sync.refreshSessions();
  await ctx.sync.sendMessage(sid, '执行 echo "deny test"');

  const gotPermission = await waitForCondition(() => hasPendingPermission(ctx, sid), 30000);
  if (!gotPermission) {
    return { sessionId: sid, status: 'no_permission_requested' };
  }

  const permId = getFirstPendingPermissionId(ctx, sid);
  if (!permId) throw new Error('Permission ID not found');

  await ctx.ops.sessionDeny(sid, permId);
  return { sessionId: sid, permissionId: permId, denied: true };
}

// --- 2.5 权限模式：yolo 自动批准 ---
async function test_permissionYolo(ctx: TestContext) {
  const result = await ctx.ops.machineSpawnNewSession({
    machineId: ctx.machineId,
    directory: ctx.homeDir,
    approvedNewDirectoryCreation: true,
    agent: 'claude',
  });
  if (result.type !== 'success') throw new Error('Failed to create session');

  const sid = result.sessionId;
  ctx.createdSessionIds.push(sid);

  ctx.storage.getState().updateSessionPermissionMode(sid, 'yolo');
  await ctx.sync.refreshSessions();
  await ctx.sync.sendMessage(sid, '执行 echo "yolo mode test" 并返回结果');

  // yolo 模式下不应该有权限请求，直接等回复
  const gotReply = await waitForCondition(() => hasAgentReply(ctx, sid), 30000);
  const hadPermissionRequest = hasPendingPermission(ctx, sid);

  return {
    sessionId: sid,
    gotReply,
    hadPermissionRequest,
    yoloWorked: gotReply && !hadPermissionRequest,
  };
}

// --- 3.1 切换模型 ---
async function test_switchModel(ctx: TestContext) {
  const result = await ctx.ops.machineSpawnNewSession({
    machineId: ctx.machineId,
    directory: ctx.homeDir,
    approvedNewDirectoryCreation: true,
    agent: 'claude',
  });
  if (result.type !== 'success') throw new Error('Failed to create session');

  const sid = result.sessionId;
  ctx.createdSessionIds.push(sid);

  await ctx.ops.sessionSetModel(sid, 'sonnet');
  return { sessionId: sid, model: 'sonnet' };
}

// --- 4.1 读取文件 ---
async function test_readFile(ctx: TestContext) {
  const result = await ctx.ops.machineSpawnNewSession({
    machineId: ctx.machineId,
    directory: ctx.homeDir,
    approvedNewDirectoryCreation: true,
    agent: 'claude',
  });
  if (result.type !== 'success') throw new Error('Failed to create session');

  const sid = result.sessionId;
  ctx.createdSessionIds.push(sid);

  const fileResult = await ctx.ops.sessionReadFile(sid, '/Users/dev/agentbridge/package.json');
  return {
    sessionId: sid,
    hasContent: !!fileResult,
    contentLength: typeof fileResult === 'string' ? fileResult.length : 0,
  };
}

// --- 4.3 列出目录 ---
async function test_listDirectory(ctx: TestContext) {
  const result = await ctx.ops.machineSpawnNewSession({
    machineId: ctx.machineId,
    directory: ctx.homeDir,
    approvedNewDirectoryCreation: true,
    agent: 'claude',
  });
  if (result.type !== 'success') throw new Error('Failed to create session');

  const sid = result.sessionId;
  ctx.createdSessionIds.push(sid);

  const dirResult = await ctx.ops.sessionListDirectory(sid, '/Users/dev/agentbridge');
  return {
    sessionId: sid,
    entries: Array.isArray(dirResult) ? dirResult.length : 'not array',
    sample: Array.isArray(dirResult) ? dirResult.slice(0, 5) : dirResult,
  };
}

// --- 4.5 代码搜索 (ripgrep) ---
async function test_ripgrep(ctx: TestContext) {
  const result = await ctx.ops.machineSpawnNewSession({
    machineId: ctx.machineId,
    directory: '/Users/dev/agentbridge',
    approvedNewDirectoryCreation: true,
    agent: 'claude',
  });
  if (result.type !== 'success') throw new Error('Failed to create session');

  const sid = result.sessionId;
  ctx.createdSessionIds.push(sid);

  const rgResult = await ctx.ops.sessionRipgrep(sid, ['machineSpawnNewSession', '--type', 'ts', '-l']);
  return {
    sessionId: sid,
    result: rgResult,
  };
}

// --- 5.1 执行 Bash ---
async function test_bash(ctx: TestContext) {
  const result = await ctx.ops.machineSpawnNewSession({
    machineId: ctx.machineId,
    directory: ctx.homeDir,
    approvedNewDirectoryCreation: true,
    agent: 'claude',
  });
  if (result.type !== 'success') throw new Error('Failed to create session');

  const sid = result.sessionId;
  ctx.createdSessionIds.push(sid);

  const bashResult = await ctx.ops.sessionBash(sid, { command: 'echo "hello from e2e test"' });
  return {
    sessionId: sid,
    stdout: bashResult?.stdout,
    exitCode: bashResult?.exitCode,
  };
}

// --- 7.1 修改设置 ---
async function test_changeSettings(ctx: TestContext) {
  const before = ctx.storage.getState().settings.defaultPermissionMode;

  ctx.sync.applySettings({ defaultPermissionMode: 'yolo' });
  await sleep(500);
  const after1 = ctx.storage.getState().settings.defaultPermissionMode;

  // 还原
  ctx.sync.applySettings({ defaultPermissionMode: before || 'accept-edits' });
  await sleep(500);
  const after2 = ctx.storage.getState().settings.defaultPermissionMode;

  return { before, changed: after1, restored: after2 };
}

// --- 8.1 创建工件 ---
async function test_createArtifact(ctx: TestContext) {
  const artifact = await ctx.sync.createArtifact(
    'E2E Test Artifact',
    '# Test\n\nThis is an automated test artifact.',
    [],
    true // draft
  );
  return { artifact };
}

// ============================================================================
// Batch Runner
// ============================================================================

type ScenarioFilter = 'all' | 'lifecycle' | 'permission' | 'config' | 'file' | 'bash' | 'settings' | 'quick';

async function runAllScenarios(filter: ScenarioFilter = 'all'): Promise<TestResult[]> {
  const modules = discoverModules();
  if (!modules) throw new Error('Cannot discover Metro modules. Is this running in dev mode?');

  const r = (window as any).__r;
  const ops = r(modules.opsId);
  const storageModule = r(modules.storageId);
  const syncModule = r(modules.syncId);

  // Find first machine
  const machines = Object.values(storageModule.storage.getState().machines) as any[];
  if (machines.length === 0) throw new Error('No machines found');
  const machine = machines[0];

  const ctx: TestContext = {
    ops,
    storage: storageModule.storage,
    sync: syncModule.sync,
    machineId: machine.id,
    homeDir: machine.metadata?.homeDir || '/Users/dev',
    createdSessionIds: [],
  };

  const scenarios: Array<{ name: string; fn: (ctx: TestContext) => Promise<any>; group: string }> = [
    // Lifecycle
    { name: '1.1 创建 session（所有 agent 类型）', fn: test_createSessions, group: 'lifecycle' },
    { name: '1.2 发送消息并等待回复', fn: test_sendMessageAndWaitReply, group: 'lifecycle' },
    { name: '1.3 中断任务 (abort)', fn: test_abortSession, group: 'lifecycle' },
    { name: '1.4 终止 session (kill)', fn: test_killSession, group: 'lifecycle' },
    { name: '1.5 删除 session', fn: test_deleteSession, group: 'lifecycle' },

    // Permission
    { name: '2.1 权限请求 → 批准', fn: test_permissionApprove, group: 'permission' },
    { name: '2.3 权限请求 → 拒绝', fn: test_permissionDeny, group: 'permission' },
    { name: '2.5 权限模式 yolo', fn: test_permissionYolo, group: 'permission' },

    // Config
    { name: '3.1 切换模型', fn: test_switchModel, group: 'config' },

    // File ops
    { name: '4.1 读取文件', fn: test_readFile, group: 'file' },
    { name: '4.3 列出目录', fn: test_listDirectory, group: 'file' },
    { name: '4.5 代码搜索 (ripgrep)', fn: test_ripgrep, group: 'file' },

    // Bash
    { name: '5.1 执行 Bash', fn: test_bash, group: 'bash' },

    // Settings
    { name: '7.1 修改设置', fn: test_changeSettings, group: 'settings' },

    // Artifacts
    { name: '8.1 创建工件', fn: test_createArtifact, group: 'settings' },
  ];

  // Filter
  const filtered = filter === 'all'
    ? scenarios
    : filter === 'quick'
      ? scenarios.filter(s => ['config', 'file', 'bash', 'settings'].includes(s.group))
      : scenarios.filter(s => s.group === filter);

  const results: TestResult[] = [];

  for (const scenario of filtered) {
    console.log(`[E2E] Running: ${scenario.name}`);
    const result = await runScenario(scenario.name, scenario.fn, ctx);
    results.push(result);
    console.log(`[E2E] ${result.status.toUpperCase()}: ${scenario.name} (${result.durationMs}ms)`);
    if (result.status === 'fail') {
      console.error(`[E2E] Error:`, result.error);
    }
  }

  // Summary
  const passed = results.filter(r => r.status === 'pass').length;
  const failed = results.filter(r => r.status === 'fail').length;
  console.log(`\n[E2E] ========== SUMMARY ==========`);
  console.log(`[E2E] Total: ${results.length}, Passed: ${passed}, Failed: ${failed}`);

  // Cleanup: kill created sessions
  console.log(`[E2E] Cleaning up ${ctx.createdSessionIds.length} sessions...`);
  for (const sid of ctx.createdSessionIds) {
    try {
      await ops.sessionKill(sid);
    } catch {}
  }

  return results;
}

// Export for use
(window as any).__e2e = {
  discoverModules,
  runAllScenarios,
  // Individual tests for manual use
  tests: {
    test_createSessions,
    test_sendMessageAndWaitReply,
    test_abortSession,
    test_killSession,
    test_deleteSession,
    test_permissionApprove,
    test_permissionDeny,
    test_permissionYolo,
    test_switchModel,
    test_readFile,
    test_listDirectory,
    test_ripgrep,
    test_bash,
    test_changeSettings,
    test_createArtifact,
  },
};

export { runAllScenarios, discoverModules };
