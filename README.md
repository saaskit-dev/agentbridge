# Free

随时随地指挥 AI Agent — 多智能体远程控制平台

Command AI agents anytime, anywhere — Multi-agent remote control platform.

## 项目概述

Free 是一个开源的多智能体远程控制平台，让你通过移动端实时监控和干预 Claude Code、Codex、Gemini 等 AI Agent。

### 核心特性

- **多 Agent 支持** — 统一管理 Claude Code、Codex、Gemini、OpenCode
- **移动端控制** - 随时随地监控 Agent 进度，处理权限请求
- **端到端加密** — X25519 + AES-256-GCM，数据安全，代码不离开设备
- **实时同步** — WebSocket + InvalidateSync 模式，毫秒级响应
- **会话持久化** — 支持跨设备恢复会话，无缝切换
- **流程增强** — 在 Agent 工作的各个阶段提供智能辅助

### 适用场景

- 通勤路上查看 Agent 进度
- 会议间隙处理权限请求
- 外出时监控长时间任务
- 多项目并行管理

## 项目结构

```
agentbridge/
├── packages/
│   └── core/              # @agentbridge/core - 核心类型和接口
│
└── apps/free/
    ├── cli/               # @free/cli - 命令行工具
    ├── server/            # @free/server - 后端服务
    └── app/               # @free/app - React Native 移动端
```

| 包名                | 描述                                       |
| ------------------- | ------------------------------------------ |
| `@agentbridge/core` | 核心类型、接口契约、跨平台实现             |
| `@free/cli`         | 命令行工具，连接本地 AI Agent              |
| `@free/server`      | 后端服务，加密同步，支持 PGlite/PostgreSQL |
| `@free/app`         | React Native 移动/Web 客户端               |

## 快速开始

### 1. 安装 CLI

**一键安装（推荐）：**

```bash
curl -fsSL https://raw.githubusercontent.com/kilingzhang/agentbridge/main/install.sh | bash
```

**或通过 npm：**

```bash
npm install -g @free/cli
```

**卸载：**

```bash
curl -fsSL https://raw.githubusercontent.com/kilingzhang/agentbridge/main/uninstall.sh | bash
```

### 2. 启动 Agent 会话

```bash
# Claude (默认)
free

# Gemini
free gemini

# Codex
free codex
```

### 3. 连接移动端

CLI 启动后会显示二维码，使用 Free App 扫码连接即可开始远程控制。

## CLI 命令

### 主要命令

```bash
free                    # 启动 Claude Code 会话
free gemini             # 启动 Gemini CLI 会话
free codex              # 启动 Codex 会话
free auth               # 管理认证
free daemon             # 管理后台服务
free doctor             # 系统诊断
```

### 连接管理

```bash
free connect gemini     # Google 账号认证
free connect claude     # Anthropic 认证
free connect codex      # OpenAI 认证
free connect status     # 查看连接状态
```

### 配置选项

```bash
free -m sonnet                    # 指定模型
free -p auto                      # 权限模式: auto, default, plan
free --claude-env KEY=VALUE       # 设置环境变量
```

## 环境变量

| 变量                      | 描述                                               |
| ------------------------- | -------------------------------------------------- |
| `FREE_SERVER_URL`         | 服务器地址 (默认: https://free-server.saaskit.app) |
| `FREE_HOME_DIR`           | 数据目录 (默认: ~/.free)                           |
| `FREE_DISABLE_CAFFEINATE` | 禁用 macOS 防休眠                                  |
| `GEMINI_MODEL`            | Gemini 模型                                        |
| `GOOGLE_CLOUD_PROJECT`    | Google Cloud 项目 ID (Workspace 账号必需)          |

## 开发

```bash
# 安装依赖
pnpm install

# 构建
pnpm build

# 测试
pnpm test

# 启动服务端开发
pnpm server

# 启动移动端
pnpm app
pnpm app:ios
pnpm app:android
```

## 部署

### Docker

```bash
cd apps/free/server
./build.sh
./deploy.sh
```

### 环境变量

| 变量                 | 描述            | 必需             |
| -------------------- | --------------- | ---------------- |
| `FREE_MASTER_SECRET` | 主密钥          | 是               |
| `PORT`               | 端口            | 否 (默认 3000)   |
| `DATABASE_URL`       | PostgreSQL 连接 | 否 (默认 PGlite) |

## 系统要求

- Node.js >= 20.0.0
- Claude CLI (用于 Claude 模式)
- Gemini CLI (用于 Gemini 模式)

## 许可证

MIT
