<div align="center">
  <pre style="font-size: 24px; font-weight: bold; letter-spacing: 4px;">
  ███████╗██████╗ ███████╗███████╗
  ██╔════╝██╔══██╗██╔════╝██╔════╝
  █████╗  ██████╔╝█████╗  █████╗
  ██╔══╝  ██╔══██╗██╔══╝  ██╔══╝
  ██║     ██║  ██║███████╗███████╗
  ╚═╝     ╚═╝  ╚═╝╚══════╝╚══════╝
  </pre>
</div>

<h1 align="center">
  Free - 多智能体移动/桌面客户端
</h1>

<h4 align="center">
Multi-Agent Mobile/Desktop Client - 随时随地指挥 AI Agent，全流程增强，更智能的自动化体验
</h4>

## ✨ 核心特性

- 🤖 **多 Agent 支持** - 统一管理 Claude Code、Codex、Gemini 等多个 AI Agent
- 📱 **随时随地** - 移动端实时监控和干预，不再被桌面束缚
- 🔄 **流程增强** - 在 Agent 工作的各个阶段提供智能辅助
- ⚡ **即时切换** - 手机、平板、电脑无缝切换，一键接管
- 🔐 **端到端加密** - 数据安全，代码不离开你的设备
- 🛠️ **开源透明** - 完全开源，可审计、可定制

## 🎯 适用场景

- 通勤路上查看 Agent 进度
- 会议间隙处理权限请求
- 外出时监控长时间任务
- 多项目并行管理
- 团队协作与 Agent 共享

## 📦 项目组件

| 组件          | 说明                       |
| ------------- | -------------------------- |
| `free-cli`    | 命令行工具，连接本地 Agent |
| `free-server` | 后端服务，加密同步         |
| `free-app`    | 移动/Web/桌面客户端（本仓库） |

## 🚀 快速开始

```bash
# 安装依赖
pnpm install

# 启动 Web 开发
pnpm web

# 启动桌面开发版（Tauri）
pnpm tauri:dev

# 启动 iOS 开发
pnpm ios

# 启动 Android 开发
pnpm android

# 构建桌面安装包
pnpm tauri:build:production

# 构建并整理桌面发布产物
./run desktop ship
```

## 📄 许可证

MIT License
