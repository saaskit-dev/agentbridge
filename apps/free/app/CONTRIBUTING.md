# Contributing to Free

## Build Variants

两个变体，各自独立 bundle ID，可同时安装在同一设备：

| Variant         | Bundle ID                  | App Name   | 用途                          |
| --------------- | -------------------------- | ---------- | ----------------------------- |
| **Development** | `app.saaskit.freecode.dev` | Free (dev) | 本地开发，连局域网 dev server |
| **Production**  | `app.saaskit.freecode`     | Free       | App Store / TestFlight        |

公测当前通过 **TestFlight**（iOS）分发；Android 当前按变体直接产出 debug-signed APK，并上传到 GitHub Release 用于设备分发安装。

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

# 桌面正式产物整理（含 checksum）
./run desktop ship
```

## 发版

```bash
# Beta iOS → TestFlight
./run release beta

# 生产版 iOS → App Store
./run release ios

# 生产版 Android → debug-signed APK
./run release android

# 开发版 Android（.dev 包名，本地 server）→ debug-signed APK
./run release android-dev

# OTA 热更新（无需审核）
./run ota
```

## Environment Variables

`app.config.js` 通过 `APP_ENV` 控制变体：

- `development`（默认）→ `.dev` bundle ID，连局域网 dev server
- `production` → 正式 bundle ID，连生产服务器

两种变体都可以构建为 debug-signed APK；是否是 production / development 包不由签名方式决定，而由 `APP_ENV` 决定。

## Deep Linking

仅 production 变体启用 deep linking（`https://free-server.saaskit.app/*`），避免 dev 构建抢占链接。
