# RFC-005: OpenTUI 统一 CLI 渲染层

- **Status**: Partially Implemented（统一渲染已实现，OpenTUI 未引入，Claude local PTY 模式仍在）
- **Created**: 2026-03-13
- **Last Updated**: 2026-03-16

## 背景与问题

### 当前架构：两套数据路径

Claude agent 有两种运行模式，数据获取方式完全不同：

**Remote (SDK) 模式**：

```
@anthropic-ai/claude-code SDK → onMessage 回调 → NormalizedMessage → server 同步
```

结构化数据直接可用，同步是天然的。

**Local (PTY) 模式**：

```
pty.spawn(claude) → raw terminal bytes → 转发给 CLI 显示
                  → .jsonl file scanner → sendClaudeSessionMessage → server 同步（旁路）
```

PTY 只产生 ANSI 转义字节流，无结构化数据。必须通过读取 Claude Code 写入的 `~/.claude/projects/<project>/<sessionId>.jsonl` 文件来获取对话内容同步给 server。

### 问题

1. **两套同步路径**：remote 走 SDK 结构化消息，local 走 `.jsonl` 文件扫描，维护成本翻倍
2. **PTY 平台兼容性问题多**：`node-pty` 的 `spawn-helper` 权限、terminal resize、raw mode 等
3. **只有 Claude 有 local 模式**：Codex / Gemini / OpenCode 没有终端交互体验
4. **`.jsonl` scanning 是 hack**：依赖 Claude Code 的内部文件格式，脆弱且有延迟

## 目标

统一所有 agent 的 CLI 体验：用 opentui 构建通用 TUI 渲染层，消费 NormalizedMessage，所有 agent 走 SDK 结构化数据。

```
之前:
  Claude local  → PTY raw bytes → Claude 自带 TUI + .jsonl 旁路扫描同步 server
  Claude remote → SDK 结构化消息 → sendNormalizedMessage 同步 server
  其他 agent    → 各自 SDK → NormalizedMessage → server

之后:
  所有 agent → SDK 结构化消息 → NormalizedMessage
                                  ├→ OpenTUI 渲染终端 UI
                                  └→ sendNormalizedMessage 同步 server
```

## 设计概要

### 核心思路

一份 NormalizedMessage 数据流，两个消费者：

1. **OpenTUI 渲染层**：将 NormalizedMessage 渲染为终端 UI（markdown、diff、tool call 进度、权限提示等）
2. **Server 同步**：现有的 `sendNormalizedMessage()` 路径，无需改动

### 需要渲染的消息类型

基于现有 NormalizedMessage 定义：

- `role: 'agent'` + text content → markdown 渲染
- `role: 'agent'` + tool-call → 工具调用展示（名称、参数、进度）
- `role: 'agent'` + tool-result → 工具结果展示（成功/错误）
- `role: 'event'` + status → 状态指示器（working/idle）
- `role: 'event'` + token_count → token 使用量
- `role: 'event'` + error → 错误展示
- `role: 'user'` → 用户输入回显

### 可以删除的代码

实现后可删除：

- `ClaudeBackend.startLocalMode()` 及所有 PTY 相关逻辑
- `sessionScanner.ts` 及 `.jsonl` 文件扫描机制
- `ClaudeSession` 中的 scanner 生命周期管理
- `IPCServer/IPCClient` 的 `pty_data`、`pty_input`、`pty_resize` 消息类型
- `InputHandler` 的 PTY raw mode 逻辑
- `node-pty` 依赖

## 优先级

**低** — 先确保 remote 模式完美运行，local PTY + scanner 同步作为过渡方案。

## 前置条件

- Remote 模式端到端完美运行（Claude + 其他 agent） ✅
- NormalizedMessage 协议稳定，覆盖所有需要展示的消息类型 ✅
- opentui 库评估完成，确认满足渲染需求 ❌

---

## 实现归档（2026-03-16）

### 当前状态：部分实现

RFC-004 的**核心目标 — 统一所有 agent 的 CLI 渲染**已通过 RFC-003 Daemon 架构的实现大部分达成，但未使用 OpenTUI 库。

### 已实现

| 目标                        | 状态 | 说明                                                                        |
| --------------------------- | ---- | --------------------------------------------------------------------------- |
| 统一 NormalizedMessage 协议 | ✅   | 所有 backend 输出 NormalizedMessage                                         |
| 统一 CLIRenderer            | ✅   | `client/CLIRenderer.ts` — agent 无关的 chalk 渲染器                         |
| 统一 Ink UI                 | ✅   | `ui/ink/RemoteModeDisplay.tsx` — 所有 agent 的 remote 模式共用              |
| 单一 daemon 架构            | ✅   | RFC-003 完成，AgentSession + AgentBackend                                   |
| 删除 per-agent launcher     | ✅   | `runClaude.ts` / `runCodex.ts` / `runGemini.ts` / `runOpenCode.ts` 全部删除 |
| 统一入口                    | ✅   | 所有 agent 通过 `runWithDaemonIPC()` 启动                                   |

### 未实现

| 目标                       | 状态 | 说明                                                                   |
| -------------------------- | ---- | ---------------------------------------------------------------------- |
| 移除 PTY scanning          | ⏳   | `sessionScanner.ts` 仍存在，Claude local PTY 模式仍在使用              |
| 采用 OpenTUI 库            | ❌   | 未启动。当前使用 chalk + Ink 组合                                      |
| 移除 node-pty 依赖         | ⏳   | Claude local PTY 模式仍需要                                            |
| 完全移除 Claude local 模式 | ❌   | 仍活跃。`CLIClient.ts` 在 `stdin.isTTY === true` 时自动进入 local 模式 |

### 实际架构

```
所有 agent → AgentBackend (daemon-owned)
           ├→ NormalizedMessage output
           ├→ Server sync (sendNormalizedMessage)
           └→ IPC broadcast → CLIClient

CLIClient 收到 agent_output:
  ├─ Claude local 模式  → writePtyData() → raw bytes 直接到 stdout
  ├─ Claude remote 模式 → feedMessageToBuffer() + RemoteModeDisplay (Ink)
  └─ 其他 agent         → feedMessageToBuffer() + RemoteModeDisplay (Ink)
```

### 遗留代码

- `ui/ink/CodexDisplay.tsx`、`GeminiDisplay.tsx`、`OpenCodeDisplay.tsx` — 无任何导入引用，属于死代码，可安全删除
