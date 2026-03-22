# Contributing to Free

## Build Variants

两个变体，各自独立 bundle ID，可同时安装在同一设备：

| Variant         | Bundle ID                  | App Name   | 用途                          |
| --------------- | -------------------------- | ---------- | ----------------------------- |
| **Development** | `app.saaskit.freecode.dev` | Free (dev) | 本地开发，连局域网 dev server |
| **Production**  | `app.saaskit.freecode`     | Free       | App Store / TestFlight        |

公测通过 **TestFlight**（iOS）/ **内测轨道**（Android）分发，与生产版共用同一个 bundle ID。

## Quick Start

```bash
# 本地开发（自动发现局域网 IP）
./run dev

# 编译运行 iOS / Android Debug
./run ios
./run android

# macOS 桌面 (Tauri)
pnpm tauri:dev
pnpm tauri:build:production
```

## 发版

```bash
# Beta → TestFlight / 内测
./run release beta

# 生产版 → App Store + Google Play
./run release

# 提交 App Store 审核
./run release submit

# OTA 热更新（无需审核）
./run ota
```

## Environment Variables

`app.config.js` 通过 `APP_ENV` 控制变体：

- `development`（默认）→ `.dev` bundle ID，连局域网 dev server
- `production` → 正式 bundle ID，连生产服务器

## Deep Linking

仅 production 变体启用 deep linking（`https://free-server.saaskit.app/*`），避免 dev 构建抢占链接。
