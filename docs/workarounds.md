# Workarounds

临时 hack 登记表。每条记录包含：原因、触发条件、上游 issue、以及明确的删除条件。

**添加 workaround 时必须同步更新本文档**，包括：pnpm patches、Metro/Babel 配置 hack、
用于绕过第三方 bug 的 Expo config plugin、以及兼容性原因的依赖版本锁定。

升级依赖前先检查本文档，确认是否可以同步移除对应 workaround。

---

## patches/@babel__runtime@7.28.6.patch

**问题**：`class X extends Error` 在 Hermes 新架构下 crash。

`@babel/runtime` 的 `isNativeReflectConstruct()` 用 `Boolean` 测试 `Reflect.construct` 是否可用，
Hermes 通过了测试，但实际调用 `Reflect.construct(Error, <Arguments>, newTarget)` 时 crash。
根本原因是 Hermes 新架构对 `Reflect.construct` 的 `argumentsList` 参数为 Arguments exotic object
时处理有 bug。

**触发条件**：

- `newArchEnabled: true`（Hermes 新架构）
- `react-native-purchases` 在启动时触发 ERROR 级日志
- 开发模式（Metro HMR 拦截 `console.error` 并调用 `new NamelessError()`）

**修复内容**：在 `isNativeReflectConstruct` 里补充对 `Error` 的二次验证，
使其在 Hermes 新架构下返回 `false`，走不依赖 `Reflect.construct` 的 fallback 路径。

**上游**：待提 issue 至 facebook/hermes 和 babel/babel。

**删除条件**：升级 `react-native` 到 Hermes 修复该 bug 的版本后移除此 patch，
同时确认 `@babel/runtime` 版本也已在 `isNativeReflectConstruct` 中加入 Error 验证。

---

## apps/free/app/plugins/withFmtConsteval.js

**问题**：Xcode 26 Beta 的 Apple Clang 对 fmt 11.x 中的 `consteval` 函数报错：
"Call to consteval function is not a constant expression"。

**触发条件**：Xcode 26 Beta + iOS 构建。

**修复内容**：

1. Podfile `post_install` 注入 `FMT_USE_CONSTEVAL=0` 到 fmt target 的编译参数。
2. Patch fmt 的 `base.h`，在自动检测块外加 `#ifndef FMT_USE_CONSTEVAL` 守卫，
   防止 base.h 覆盖上面设置的宏。

**上游**：Apple Clang bug，等 Xcode 26 正式版修复。

**删除条件**：Xcode 26 正式版发布后，确认该 Clang bug 已修复，移除此 plugin 及 `app.config.js` 中的引用。

---

## apps/free/app/plugins/withSourceBuildRN.js

**问题**：Xcode 26 Beta 预构建的 React Native XCFrameworks 存在头文件命名不一致问题：
`React-Core-umbrella.h` vs `React_Core-umbrella.h`，导致 iOS 构建失败。

**触发条件**：Xcode 26 Beta + iOS 构建 + 使用预构建 RN XCFrameworks（默认行为）。

**修复内容**：在 `Podfile.properties.json` 中设置 `ios.buildReactNativeFromSource=true`，
改为从源码编译 React Native，绕过预构建产物的头文件问题。

**上游**：React Native 预构建 XCFrameworks 的命名 bug，等官方修复。

**删除条件**：升级 `react-native` 到预构建 XCFrameworks 头文件命名修复的版本后移除。

---

## apps/free/app/plugins/withDisableScriptSandbox.js

**问题**：React Native 的 "Bundle React Native code and images" 构建阶段脚本需要写入
构建产物目录（如 `ip.txt`），被 Xcode 的 User Script Sandboxing 拦截导致构建失败。

**触发条件**：Xcode 启用 `ENABLE_USER_SCRIPT_SANDBOXING`（新版 Xcode 默认开启）+ RN 构建。

**修复内容**：对所有 build configuration 强制设置 `ENABLE_USER_SCRIPT_SANDBOXING = NO`。

**上游**：React Native 构建脚本未适配 sandboxing，需 RN 官方修复构建脚本的写文件方式。

**删除条件**：升级 `react-native` 到官方修复构建脚本 sandboxing 问题的版本后移除。

---

## apps/free/app/metro.config.js — inlineRequires: false

**问题**：Metro 的 `inlineRequires` 优化与 HMR（Hot Module Replacement）存在兼容问题，
开启后 HMR 刷新异常。

**触发条件**：开发模式 + HMR + `inlineRequires: true`（Metro 默认值）。

**上游**：https://github.com/facebook/metro/issues/768

**删除条件**：上游 issue 关闭，且升级 Metro 到包含修复的版本后，移除 `inlineRequires: false` 配置项。

---

## apps/free/app/metro.config.js — Node ESM .js 扩展名解析

**问题**：遵循 Node ESM 规范的包（如 `@noble/hashes`、`@agentbridge/core/telemetry` 内部相对路径）
在 TypeScript 源码中写 `import x from './utils.js'`，实际文件是 `utils.ts`。
Metro resolver 无法自动将 `.js` 映射到 `.ts`，导致 "Unable to resolve" 错误。

**触发条件**：

- 项目依赖 `@noble/` 系列包，或
- 依赖 `@agentbridge/core` 的 telemetry 模块（使用 TypeScript ESM 显式 `.js` 扩展名）

**修复内容**：自定义 `resolveRequest`，精确匹配两类来源并去掉 `.js` 后缀后重新解析：

1. `@noble/` 前缀的所有 import
2. 相对路径（`.` 开头）的 import，但仅限 `originModulePath` 来自 `packages/core/src/` 时

**注意**：不能对所有相对路径做无条件剥离，否则会影响 npm 包（如 `react-textarea-autosize`）
的内部 `.js` 模块解析，导致 default 导出变成 `undefined`。

**上游**：`@noble/` 系列遵循 Node ESM 规范（显式扩展名），Metro 对此支持不完整。
Metro 0.82+ 已通过 `unstable_enablePackageExports` 提供标准解法，但有已知 bug
（见 https://github.com/facebook/metro/issues/1464），暂不启用。

**删除条件**：Metro package exports 支持稳定后，启用 `unstable_enablePackageExports`
并移除自定义 `resolveRequest`。

---

## packages/core/src/implementations/agent/factories.ts — codex-acp 显式安装平台子包

**问题**：`@zed-industries/codex-acp` 主包通过 `npx @zed-industries/codex-acp` 启动时，
在当前环境下不会可靠安装平台 optional dependency，导致启动时报：
`Failed to locate @zed-industries/codex-acp-<platform>-<arch> binary`。

此外，`@zed-industries/codex-acp@0.10.0` 已发布，但对应平台子包版本未完整发布，
会进一步放大这个问题。

**触发条件**：

- `codex-acp` 通过裸 `npx @zed-industries/codex-acp` 启动
- 当前平台依赖 optional binary（例如 `darwin-arm64`）
- npm/npx 未把 optional platform package 一起装好，或上游版本发布不一致

**修复内容**：

- 将 `codex-acp` 启动命令改为显式安装：
  - 主包 `@zed-industries/codex-acp@0.9.5`
  - 当前平台子包 `@zed-industries/codex-acp-<platform>-<arch>@0.9.5`
- 通过 `npx -p <main> -p <platform> codex-acp` 启动，绕过 optional dependency 安装不可靠的问题

**上游**：Zed `codex-acp` 包发布/安装链路问题，尤其是主包与平台子包版本不同步。

**删除条件**：

- 上游修复 `@zed-industries/codex-acp` 的 optional dependency 安装问题，且
- 当前平台子包版本与主包版本重新保持一致，验证裸 `npx @zed-industries/codex-acp` 可稳定启动后移除。

---

## apps/free/cli/src/daemon/buildAgentAuthEnv.ts — codex daemon overlay HOME

**问题**：`codex-acp` 会加载用户 skills。当某个 skill 的 `SKILL.md` 损坏时，ACP session 创建会卡死或超时。

**触发条件**：

- 启动 `codex-acp` session
- 用户 skills 中存在损坏的 `SKILL.md`

**修复内容**：

- daemon 为 codex 子进程生成一个 overlay HOME
- overlay HOME 保留真实家目录的大部分内容，但显式去掉 `.agents`
- 这样 codex 仍能读取真实认证和其余 home 状态，但不会再加载用户损坏 skills

**上游**：Codex 当前对坏 skill 缺少隔离，skills 解析错误会拖挂 ACP 初始化。

**删除条件**：

- Codex 能在坏 skill 存在时忽略该 skill 而不影响 session 创建，或
- Codex 提供稳定的官方配置来禁用/重定向用户 skills，或修复 skills 加载链路后可安全移除。
