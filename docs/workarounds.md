# Workarounds

临时 hack 登记表。每条记录包含：原因、触发条件、上游 issue、以及明确的删除条件。

**添加 workaround 时必须同步更新本文档**，包括：pnpm patches、Metro/Babel 配置 hack、
用于绕过第三方 bug 的 Expo config plugin、以及兼容性原因的依赖版本锁定。

升级依赖前先检查本文档，确认是否可以同步移除对应 workaround。

---

## apps/free/app/sources/app/(app)/machine/[id]/import-sessions.tsx — iOS 禁用 FlatList `removeClippedSubviews`

**问题**：在 React Native Fabric 的 iOS 真机上，导入 session 列表页开启 `removeClippedSubviews` 后，TestFlight 崩溃日志命中
`RCTViewComponentView updateClippedSubviewsWithClipRect:relativeToView:` 递归栈并以 `SIGABRT` 终止。

**触发条件**：

- iOS TestFlight / release 包
- 新架构 Fabric 打开
- 进入 machine import sessions 页面并滚动 `FlatList`
- 该列表启用 `removeClippedSubviews`

**修复内容**：

- 该页面的 `FlatList` 仅在 Android 保持 `removeClippedSubviews`
- iOS 显式关闭，优先规避 native clipped-subview 崩溃

**上游**：React Native 官方 `FlatList` 文档明确标注 `removeClippedSubviews` 可能导致内容/渲染 bug，Fabric 下 iOS 原生栈也已出现对应崩溃迹象。

**删除条件**：升级到确认不再出现 `RCTViewComponentView updateClippedSubviewsWithClipRect:relativeToView:` 崩溃的 React Native / Expo 版本，并完成 iOS 真机回归后可移除。

---

## apps/free/app/sources/sync/cacheContent.ts / messageDB.native.ts — SQLite bind 参数统一把 `undefined` 归一化为 `null`

**问题**：TestFlight 旧崩溃日志在 iOS 上命中 `SQLiteModule.bindStatementParam`、`convertNSExceptionToJSError` 与 Hermes `EXC_BAD_ACCESS` 组合栈。
`expo-sqlite` 的 TurboModule 路径在绑定非法参数值（尤其 `undefined`）时，会先抛原生异常，再由 JSI/Exception 转换链路放大成进程级崩溃。

**触发条件**：

- iOS TestFlight / release 包
- App 通过 `expo-sqlite` 写入 SQLite
- 绑定参数数组里混入 `undefined`（例如 `JSON.stringify(undefined)` 的结果）

**修复内容**：

- 新增 `serializeCachedContent()`，保证缓存消息内容最差也写入 JSON `null`
- 新增 `sanitizeSQLiteParams()`，在 native SQLite 封装层把所有 `undefined` 统一转换为 `null`
- 让错误退化为可观测的 SQL/约束失败，而不是 native bind 崩溃

**上游**：崩溃栈指向 Expo SQLite iOS TurboModule 绑定路径；当前修复属于对第三方原生异常放大行为的防御性兼容处理。

**删除条件**：确认上游 `expo-sqlite` 在 iOS 上对 `undefined`/非法绑定值做了安全处理，且新包长期不再出现 `SQLiteModule.bindStatementParam` / `convertNSExceptionToJSError` 相关崩溃后可移除。

---

## packages/core/package.json / scripts/dev.sh — 清理 macOS `uchg` 不可变 dist 目录

**问题**：在 macOS 上，`packages/core/dist` 偶发会被打上 `uchg`（user immutable）标记，导致即使文件归属正确，
`rm -rf dist` 仍报 `Operation not permitted`，从而让 `pnpm build` 和 `./run dev` 卡死在 core 构建阶段。

**触发条件**：

- 运行 `pnpm --filter @saaskit-dev/agentbridge build`
- 或运行 `./run dev`
- 且 `packages/core/dist` 或其子文件带有 `uchg` 标记

**修复内容**：

- 在 `packages/core` 的 `build` 脚本里，删除 `dist` 前先执行 `chflags -R nouchg dist`
- 在 `scripts/dev.sh` 的 cleanup / build core 流程里，对 `packages/core/dist` 和 `apps/free/cli/dist` 同样先解锁再删除

**上游**：不是第三方库 bug，更像是本地文件系统 / 历史脚本留下的不可变标记副作用。

**删除条件**：确认不会再有构建产物被打上 `uchg`，且连续多轮 `./run dev` / `pnpm build` 都无需解锁时可移除。

---

## apps/free/app/src-tauri/tauri.conf.json — Tauri 通过 Expo Web 固定 8081 端口启动

**问题**：Tauri 桌面壳需要一个稳定可预测的前端地址。Expo 默认开发端口会漂移，而且原先配置使用 `yarn start`，
既不符合本仓库的 `pnpm` 工作区，也会启动原生开发服务器而不是 Web 前端。

**触发条件**：

- 运行 `pnpm tauri:dev` 启动桌面开发版
- 或运行 `pnpm tauri:build:*` 构建桌面包

**修复内容**：

- 新增专用脚本：
  - `desktop:web:dev` → `scripts/desktop-web-dev.sh`
  - 该脚本内部启动 `expo start --web --port 8081 --host localhost`，并等待 `http://localhost:8081` 真正 ready 后再继续
  - `desktop:web:build` / `desktop:web:build:dev` → 导出桌面前端静态资源
- Tauri `beforeDevCommand` / `beforeBuildCommand` 改为调用上述 `pnpm` 脚本
- Tauri `devUrl` 固定为 `http://localhost:8081`，与 Expo Web dev server 同源；通过启动脚本等待 server ready，
  避免桌面 WebView 首次加载失败后落到 `chrome-error://chromewebdata/`

**上游**：不是第三方 bug，而是本仓库桌面集成对 Expo Web 启动方式的约束。

**删除条件**：若未来改为独立桌面前端构建链，或 Tauri 集成不再依赖 Expo Web dev server / export 产物，可移除。

---

## apps/free/app/src-tauri/src/lib.rs — 本地桌面包未配置 updater 时禁用 Tauri updater plugin

**问题**：本地 `tauri build` 默认不会生成 `tauri.updater.conf.json`，因为 updater 公钥只在发布流程里通过
`TAURI_UPDATER_PUBLIC_KEY` 注入。此时仍初始化 `tauri-plugin-updater`，应用启动会直接 panic：
`invalid type: null, expected struct Config`，导致 `.app` 双击打不开。

**触发条件**：

- 运行 `./run desktop build` 或 `./run desktop build-dev`
- 且构建环境未设置 `TAURI_UPDATER_PUBLIC_KEY`
- 产物启动时初始化 `tauri-plugin-updater`

**修复内容**：

- Rust 侧仅在编译时检测到 `TAURI_UPDATER_PUBLIC_KEY` 非空时，才注册 `tauri-plugin-updater`
- 本地普通测试包 / 正式包可正常启动
- 带 updater 签名的发布流程仍通过环境变量启用 updater

**上游**：Tauri updater 配置为必填结构；当配置缺失但 plugin 仍初始化时会在启动阶段失败。这是当前本地无签名构建流程与 updater 插件约束之间的集成兼容处理。

**删除条件**：若未来本地所有桌面构建都统一生成合法 updater 配置，或 Tauri updater 支持无配置安全降级，可移除。

---

## scripts/repair-tauri-macos-app-signature.sh — 本地 Tauri macOS 产物重做 ad-hoc 签名

**问题**：本地 `tauri build` 产出的 `.app` 在当前链路下会出现无效 ad-hoc 签名，`codesign --verify` 报：
`code has no resources but signature indicates they must be present`。这种情况下 Finder 双击、右键打开都可能失败。

**触发条件**：

- macOS 本地运行 `./run desktop build`
- 或 `./run desktop build-dev`
- 或 `./run desktop ship`

**修复内容**：

- 新增 `scripts/repair-tauri-macos-app-signature.sh`
- 桌面 build 完成后，对 `src-tauri/target/release/bundle/macos/*.app` 执行：
  `codesign --force --deep --sign -`
- 仅修复本地 app bundle 的 ad-hoc 签名完整性；不等同于 Apple Developer ID 签名，也不包含 notarization

**上游**：当前 Tauri 本地 macOS 打包链路生成的 ad-hoc 签名不稳定，导致 bundle 在本机验证即失败。属于本地桌面打包兼容 workaround。

**删除条件**：升级到不会再生成无效 ad-hoc 签名的 Tauri/macOS 打包链路后，确认连续多次本地 build 产物都能通过
`codesign --verify --deep --strict` 且可直接打开时移除。

---

## apps/free/app/src-tauri/Cargo.toml — 桌面正式包启用 Tauri `devtools` feature 以支持 F12

**问题**：默认情况下，Tauri 仅在 debug build 暴露 `open_devtools()` 等 API。当前需要在本地桌面正式包里也能通过
`F12` / `Cmd+Alt+I` 打开 WebView 开发者工具，便于排查问题。

**触发条件**：

- 运行桌面正式包（`./run desktop build`）
- 需要在 release 产物里打开 Tauri / WebView DevTools

**修复内容**：

- `tauri` crate 打开 `devtools` feature
- App 内监听 `F12` / `Cmd+Alt+I`，通过 Tauri command 打开 DevTools

**上游**：Tauri 设计如此。`open_devtools()` 在 release 构建中默认关闭，必须显式启用 `devtools` feature。

**删除条件**：若未来改为仅在测试构建启用 DevTools，或排查链路不再依赖 release 包内置 DevTools，可移除。

---

## .github/workflows/release-desktop.yml — 桌面发布流程先把 Tauri updater 私钥 secret 转成 CLI 真正要求的 base64 格式

**问题**：`TAURI_SIGNING_PRIVATE_KEY` 以 GitHub secret 多行内容直接注入环境变量时，
`tauri-action` / Tauri CLI 在发布阶段会把它当成“base64 编码后的完整私钥文本”解析。
如果 secret 里直接保存的是 `tauri signer generate` 产出的两行 `.key` 文件内容，就会报：
`failed to decode base64 secret key`。

**触发条件**：

- 运行 `Release Desktop` GitHub Actions workflow
- `TAURI_SIGNING_PRIVATE_KEY` 保存的是 `tauri signer generate` 产出的完整私钥文件内容

**修复内容**：

- workflow 先检测 secret 是否已经是 Tauri CLI 需要的单行 base64 格式
- 若不是，则把完整 `.key` 文本内容做一次 base64 编码
- 再将该单行值写入 `GITHUB_ENV`

**上游**：Tauri CLI 的 updater signing helper 最终会先对 `TAURI_SIGNING_PRIVATE_KEY` 做 base64 decode，再把结果当成 minisign key box 文本解析；因此完整 `.key` 文件内容不能直接原样塞进环境变量。

**删除条件**：若未来 Tauri CLI 明确支持直接读取多行 `.key` 文件内容作为环境变量，或团队统一改为只存单行 base64 兼容格式的私钥内容，可移除。

---

## scripts/prepare-desktop-updater-config.js — updater 公钥也按 Tauri CLI 期望转换为完整文本的 base64

**问题**：`TAURI_UPDATER_PUBLIC_KEY` 若直接使用 `.pub` 文件中的第二行 key 内容，
Tauri CLI 在 updater 签名阶段仍会先做 base64 decode，再把结果当成 minisign 公钥文本解析，
最终报 `failed to decode pubkey`。

**触发条件**：

- 运行桌面发布 workflow
- `TAURI_UPDATER_PUBLIC_KEY` 使用的是 `.pub` 文件里的裸 key 行，或 workflow 将完整 `.pub` 文本错误归一化成裸 key 行

**修复内容**：

- updater config 生成脚本先检测输入是否已是 Tauri 兼容的单行 base64
- 若输入是完整 `.pub` 文本，则将完整文本整体 base64 编码
- 不再把 `.pub` 文件压扁成第二行 key 内容

**上游**：Tauri CLI 的 `pub_key` helper 与私钥 helper 一样，会先 base64 decode，再把结果当作 minisign key box 文本解析。

**删除条件**：若未来 Tauri CLI 明确支持直接使用 `.pub` 第二行裸 key，或团队统一只保存单行 base64 兼容格式的 updater 公钥，可移除。

---

## ./run / scripts/free-desktop-release.sh / scripts/resolve-desktop-updater-env.js — 本地桌面打包自动发现 `~/.tauri` updater 密钥，避免因为未手工 export 而缺失自动更新产物

**问题**：本地 `./run desktop build` / `./run desktop ship` 之前只读取当前 shell 的
`TAURI_UPDATER_PUBLIC_KEY`、`TAURI_SIGNING_PRIVATE_KEY`、`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。
即使开发机已经存在 `~/.tauri/free-desktop*.key(.pub/.password)`，没有手工 export 时仍会退化成“无 updater”构建，导致本地验证自动更新链路时经常漏掉签名产物。

**触发条件**：

- 本地运行 `./run desktop build`
- 或本地运行 `./run desktop ship`
- 机器上已经有可用的 `~/.tauri/free-desktop*.key` / `.key.pub` / `.password`
- 但当前 shell 没有显式导出对应三个 Tauri updater 环境变量

**修复内容**：

- 新增 `scripts/resolve-desktop-updater-env.js`
- 优先复用当前进程环境变量
- 若未设置，再尝试读取 `TAURI_*_FILE` 指向的文件
- 若仍未设置，再自动发现 `~/.tauri/` 下最新的 `free-desktop*.key` / `.key.pub` / `.password`
- 本地 `./run desktop build` 和 `./run desktop ship` 在构建前自动注入这些值

**上游**：不是 Tauri 构建失败，而是本地发布脚本之前没有把常见的本机 key 文件落点纳入默认发现路径。

**删除条件**：若后续本地桌面发布统一改成固定 secret 管理器注入，或 release CLI 原生支持从 key 文件自动发现 signer/updater 配置，可删掉该自动发现逻辑。

---

## .github/workflows/release-desktop.yml — 自托管 macOS runner 直接补齐 Cargo PATH 并复用本机 Rust

**问题**：自托管 macOS runner 上即使已经安装了 Rust，GitHub Actions step 的默认 PATH 里也可能没有
`$HOME/.cargo/bin`。此时 `dtolnay/rust-toolchain` 会误判 `rustup` 不存在，退回到在线安装流程；
如果 runner 当时连不上 `https://sh.rustup.rs`，构建会直接以 `curl: (35)` 失败。

**触发条件**：

- 运行 `Release Desktop` workflow
- job 落在自托管 macOS runner
- Rust 已安装在 `$HOME/.cargo/bin`，但未进入 Actions PATH

**修复内容**：

- workflow 改为先显式把 `${CARGO_HOME:-$HOME/.cargo}/bin` 写入 `GITHUB_PATH`
- 若 runner 已有 `rustup` / `cargo` / `rustc`，直接复用本机 stable toolchain
- 仅在 runner 真没有 Rust 时，才回退到在线安装

**上游**：不是业务代码问题，而是自托管 runner 的用户环境与 GitHub Actions 非交互 shell PATH 不一致。

**删除条件**：若后续统一在 runner 镜像里预配好 Rust 且 PATH 恒定，或改用稳定的预装 runner 镜像，可移除。

---

## apps/free/app/plugins/withDevelopmentTeam.js — iOS 自托管 CI 自动签名时显式开启 `REGISTER_APP_GROUPS`

**问题**：`expo prebuild` 重新生成 iOS 工程后，主 app 和 `FocusAudioWidget` 都依赖
`com.apple.security.application-groups`。在 self-hosted macOS runner 上用
`xcodebuild -allowProvisioningUpdates` 自动签名时，如果没有显式打开
`REGISTER_APP_GROUPS=YES`，Xcode 可能不会为带 App Group entitlement 的 target 重新协调
App Group 绑定和匹配的 development provisioning profile，最终在 archive 阶段报
`No profiles for ... were found`。

**触发条件**：

- 运行 `Release iOS` workflow
- job 落在 self-hosted macOS runner
- iOS target 带 `com.apple.security.application-groups` entitlement
- 使用 `xcodebuild -allowProvisioningUpdates` 自动签名

**修复内容**：

- 在 `withDevelopmentTeam.js` 里，对自动签名 target 统一写入：
  - `DEVELOPMENT_TEAM`
  - `CODE_SIGN_STYLE = Automatic`
  - `REGISTER_APP_GROUPS = YES`

**上游**：Xcode 自动签名与 App Group target 的 CI 集成约束，不是业务代码 bug。

**删除条件**：若未来迁移到稳定的手动签名/profile 管理链路，或确认新版 Xcode 在 CI
自动签名时不再需要显式 `REGISTER_APP_GROUPS` 也能稳定为 App Group target 生成匹配 profile，可移除。

---

## .github/workflows/release-desktop.yml / scripts/free-desktop-release.sh / ./run / scripts/create-macos-dmg.sh — macOS 桌面发布避开 Tauri 内置 DMG 脚本，改为独立 `hdiutil` 打包并在打包前重做 ad-hoc 签名

**问题**：`tauri-bundler` 的 `bundle_dmg.sh` 在部分 macOS 环境里并不稳定，
即使 `.app` 已经成功产出，后续 DMG 阶段仍可能直接失败，导致本地 `./run desktop release` /
`./run desktop ship` 和 CI 发布流程都中断。

**触发条件**：

- 运行 `Release Desktop` workflow
- 或本地运行 `./run desktop release`
- 或本地运行 `./run desktop ship`
- macOS job 使用默认 `targets = "all"` 或包含 `dmg`
- 当前 macOS 图形 / Finder / hdiutil 环境不满足 Tauri 内置 DMG 脚本要求

**修复内容**：

- macOS 发布 / 本地构建先只让 Tauri 产出稳定的 `app` bundle
- 保留 updater 所需的 `.app.tar.gz` / 签名产物
- 在生成 DMG 前对 `.app` 再执行一次 `codesign --force --deep --sign -`
- 后续改用独立 `hdiutil makehybrid -hfs` 脚本生成简化版 DMG，避开当前环境里会报 `Device not configured` 的 `hdiutil create -srcfolder`
- 若本地 `hdiutil` 仍失败，则回退生成 `.zip`，保证至少有可分发的桌面包
- 本地 `desktop ship` 会先清理旧版 `.dmg` / `.zip` 和同版本 staged 目录，再把本次产物整理进 staged release 目录
- CI 再把该 DMG 作为 release asset 单独上传

**上游**：Tauri bundler 的 DMG 打包脚本依赖更完整的 macOS 图形会话环境，在自托管 CI 上容易出现环境相关失败。

**删除条件**：若后续 runner 环境稳定支持 Tauri 内置 `bundle_dmg.sh`，可删掉独立 DMG 打包脚本并恢复 Tauri 原生 DMG 流程。

---

## apps/free/app/sources/sync/serverConfig.ts — development 模式忽略生产 `custom-server-url`

**问题**：Web/desktop 开发时，用户之前保存过的 `custom-server-url=https://free-server.saaskit.app`
会覆盖掉 dev 默认的本地 server，导致页面虽然由 `./run dev` 提供，API 却仍然打到线上。

**触发条件**：

- `APP_ENV=development` / `__DEV__ === true`
- 且本地缓存里存在 `custom-server-url`
- 且该地址指向 `https://free-server.saaskit.app`

**修复内容**：

- development 模式下检测到生产 host 时，`getServerUrl()` 直接回退到 dev 默认 server
- Server 设置页显示提示文案，明确说明“开发模式已忽略生产服务器地址”
- 其他自定义测试地址不受影响，仍可正常覆盖默认值

**上游**：不是第三方 bug，而是本地开发与持久化 server 配置之间的运行时优先级冲突。

**删除条件**：如果未来 server 配置切换改成显式环境隔离，不再共享同一份持久化 `custom-server-url`，可移除。

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

## apps/free/app/plugins/withFocusAudioNativeModule.js

**问题**：本地 Expo module `FocusAudioNative` 能被 `expo-modules-autolinking` 发现，但当前生成链路没有把它稳定注册进
`ExpoModulesProvider.swift`，导致 JS 侧拿不到 `FocusAudioNative` 原生模块。

**触发条件**：

- `expo prebuild -p ios --clean`
- 或重新安装 iOS Pods
- 且 app 依赖 `apps/free/app/modules/focus-audio-native`

**修复内容**：

1. 向生成的 `ios/Podfile` 注入 `pod 'FocusAudioNative', :path => '../modules/focus-audio-native/ios'`
2. 在 `post_install` 中 patch `ExpoModulesProvider.swift`，补上 `import FocusAudioNative`
3. 同时把 `FocusAudioNativeModule.self` 注入 provider 返回数组，确保 Expo runtime 能注册该模块

**上游**：Expo local module / autolinking 与当前工程生成链路的集成问题，待确认是 Expo 54 还是 `@bacons/apple-targets`
共同作用下的边界情况。

**删除条件**：当 `expo prebuild` 生成的 iOS 工程能够稳定自动注册 `FocusAudioNativeModule`，且不再需要 Podfile/Provider patch 时移除。

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

---

## scripts/free-app-ios-release.sh / scripts/configure-ios-manual-signing.rb — iOS CI 发布显式切到 App Store profile 的 manual signing

**问题**：自托管 macOS runner 上的 `expo prebuild` 会通过 `withDevelopmentTeam.js` 把 iOS target 统一写成
`CODE_SIGN_STYLE = Automatic`。在 `xcodebuild archive` 阶段，Xcode 会错误地给 `FocusAudioWidget` 选中旧的
development provisioning profile，导致 TestFlight archive 混入 dev profile 并以 `exit 65` 失败。

**触发条件**：

- 运行 `Release iOS` workflow
- self-hosted runner 本机同时存在 development / distribution signing 资产
- widget target `app.saaskit.freecode.focusaudio` 开启了 App Group capability
- `xcodebuild archive` 仍依赖 automatic signing

**修复内容**：

- 发布脚本先根据本机 distribution certificate 反查对应的 App Store Connect certificate id
- 用 App Store Connect API 为主 app / widget 动态创建并下载 `IOS_APP_STORE` profiles
- 同时安装到：
  - `~/Library/MobileDevice/Provisioning Profiles`
  - `~/Library/Developer/Xcode/UserData/Provisioning Profiles`
- 再通过 `scripts/configure-ios-manual-signing.rb` 将生成后的 Xcode project 的 `Release` 配置改为
  `CODE_SIGN_STYLE = Manual`，并为主 app / widget 显式写入对应 profile name / UUID
- `exportOptions.plist` 同步改为 `manual` 并带 `provisioningProfiles`

**上游**：属于 Expo prebuild + self-hosted runner + 多 target 签名资产共存时的 Xcode 自动签名选择问题，不是业务代码问题。

**删除条件**：若未来 prebuild 插件能够对发布态和开发态分离签名策略，或确认 Xcode automatic signing 在该 runner 上稳定选择 App Store profile，不再把 widget 签成 development profile，可移除。

---

## scripts/free-app-ios-release.sh — self-hosted iOS 发布显式绑定用户 keychain 并预热 codesign

**问题**：`Release iOS` 在 self-hosted macOS runner 上执行 `xcodebuild archive` 时，`FocusAudioWidget` 的
`codesign` 会间歇性返回 `errSecInternalComponent`。同一张 distribution 证书、同一份 profile、同一份
entitlements 在终端里手工执行 `codesign` 可以成功，说明不是 profile 或 capability 配错，而是 Xcode 在
CI 进程里没有稳定命中正确的用户 keychain/私钥访问路径。

**触发条件**：

- 使用 self-hosted macOS runner 发布 iOS
- 分发证书和私钥存放在用户默认 keychain
- `xcodebuild archive` 在签 `FocusAudioWidget.appex` 时由 Xcode 内部调用 `codesign`

**修复内容**：

- 发布脚本不再依赖当前 shell 的 `HOME` 或默认 keychain 解析结果
- 改为通过用户目录元数据显式定位真实 home，再固定使用 `<real-home>/Library/Keychains/login.keychain-db`
- 给 `xcodebuild archive/export` 额外注入 `OTHER_CODE_SIGN_FLAGS=--keychain <path>`，强制 Xcode 内部的
  `codesign` 使用同一把用户 keychain

**上游**：属于 self-hosted macOS runner 环境下 Xcode/Keychain 集成稳定性问题，不是业务代码问题。

**删除条件**：若后续 runner 的证书改为放在独立 CI keychain，或确认在当前 runner 配置下 Xcode 可稳定访问
默认 keychain 中的分发私钥，不再出现 `errSecInternalComponent`，可删除。
