# Contributing to AgentBridge

感谢你对 AgentBridge 的关注！欢迎提交 Issue 和 Pull Request。

## 前置要求

- Node.js >= 20.0.0
- pnpm 8+（`corepack enable && corepack prepare pnpm@8 --activate`）
- Git

## 快速开始

```bash
git clone https://github.com/kilingzhang/agentbridge.git
cd agentbridge
pnpm install
pnpm build
```

## 项目结构

```
agentbridge/
├── packages/core/       # @agentbridge/core - 核心类型和接口
└── apps/free/
    ├── cli/             # @free/cli - 命令行工具
    ├── server/          # @free/server - 后端服务
    └── app/             # @free/app - React Native 移动端
```

## 开发命令

```bash
pnpm build              # 构建所有包
pnpm test               # 运行测试
pnpm lint               # 代码检查
pnpm format             # 代码格式化
```

### CLI 开发

```bash
cd apps/free/cli
pnpm dev                # 使用 tsx 直接运行（无需构建）
pnpm build              # 构建
pnpm test               # 运行测试
```

### Server 开发

```bash
cd apps/free/server
cp .env.example .env    # 配置环境变量
pnpm dev                # 启动开发服务器
```

### App 开发

```bash
cd apps/free/app
pnpm start              # 启动 Expo
pnpm web                # Web 模式
pnpm ios                # iOS 模式
```

## 提交规范

提交信息请遵循以下格式：

```
<type>: <description>

feat:     新功能
fix:      修复 Bug
docs:     文档更新
refactor: 代码重构
test:     测试相关
build:    构建/依赖相关
chore:    其他杂项
```

## Pull Request 流程

1. Fork 本仓库
2. 创建特性分支：`git checkout -b feat/my-feature`
3. 提交更改
4. 确保测试通过：`pnpm test`
5. 确保代码规范：`pnpm lint`
6. 提交 Pull Request 到 `main` 分支

## 报告问题

请通过 [GitHub Issues](https://github.com/kilingzhang/agentbridge/issues) 提交问题，并尽量包含：

- 问题描述
- 复现步骤
- 预期行为 vs 实际行为
- 环境信息（OS、Node.js 版本等）

## 许可证

本项目基于 [MIT License](./LICENSE) 开源。
