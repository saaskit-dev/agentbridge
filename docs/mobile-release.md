# Mobile Release

## Final State

移动端发布现在不再依赖 Expo 云服务：

- 原生包构建与上传：本机 macOS 或 self-hosted GitHub runner
- OTA：本地 Expo CLI 生成产物，GitHub Releases 托管静态 assets，你们自己的 server 只托管 manifest
- GitHub Actions：只负责触发脚本，不再调用 `eas build` / `eas submit` / `eas update`

## iOS Release

主入口：

```bash
./scripts/free-app-release-production.sh ios
cd apps/free/app && pnpm run release:ios:beta
cd apps/free/app && pnpm run release:ios:production
```

统一命令入口：

```bash
./run release beta
./run release ios
```

CI workflow：

- `.github/workflows/release-ios.yml`

流程：

1. 保持 app marketing version（例如 `0.0.1`）
2. 本地查询 iOS 上一个 build number 并递增
3. Android versionCode 独立自增
4. `expo prebuild --platform ios`
5. `pod-install`
6. `xcodebuild archive/export`
7. `xcrun altool` 上传 App Store Connect
8. 按 lane 分发到 TestFlight 或生产

必备 secret：

- `APPLE_TEAM_ID`
- `ASC_APP_ID`
- `ASC_KEY_ID`
- `ASC_ISSUER_ID`
- `ASC_PRIVATE_KEY`
- `GOOGLE_SERVICES_PLIST`
- `GOOGLE_SERVICES_JSON`

可选变量：

- `TESTFLIGHT_GROUP`
- `XCODE_APP_PATH`
- `IOS_RUNNER_LABELS_JSON`

## OTA Release

主入口：

```bash
cd apps/free/app
OTA_MESSAGE="fix login bug" \
OTA_SERVER_URL=https://your-server.example.com \
OTA_SERVER_TOKEN=your-admin-token \
GITHUB_TOKEN=ghp_xxx \
pnpm run ota
```

统一命令入口：

```bash
OTA_SERVER_URL=https://your-server.example.com \
OTA_SERVER_TOKEN=your-admin-token \
GITHUB_TOKEN=ghp_xxx \
./run ota
```

脚本会：

1. 本地执行 `expo export`
2. 生成 `metadata.json` 和 `assetmap.json`
3. 按平台计算 `runtimeVersion`
4. 上传 bundle 与 assets 到 GitHub Releases
5. 把 release metadata 与 manifest 写入你们自己的 server

发布后验证：

```bash
OTA_SERVER_URL=https://your-server.example.com \
OTA_SERVER_TOKEN=your-admin-token \
GITHUB_TOKEN=ghp_xxx \
OTA_RELEASE_ID=the-release-id \
node ./scripts/verify-ota-release.mjs
```

回滚到上一条已知 release 的方式：

```bash
curl -X POST https://your-server.example.com/updates/admin/promote \
  -H "Authorization: Bearer $OTA_SERVER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"releaseId":"older-release-id"}'
```

server 需要开启：

```bash
EXPO_UPDATES_GATEWAY_MODE=self-hosted
EXPO_UPDATES_GATEWAY_ENABLED=true
EXPO_UPDATES_ADMIN_TOKEN=your-admin-token
```

客户端默认会从生产 server 的 `/updates` 拉 OTA。内部包若需覆盖，可设置：

```bash
EXPO_UPDATES_URL=https://your-server.example.com/updates
```

## CI Maintenance

建议保留两条 workflow：

- `release-ios.yml`
- `release-android.yml`
- `release-ota.yml`

其中 OTA workflow 需要注入：

- `OTA_SERVER_URL`
- `OTA_SERVER_TOKEN`
- `GITHUB_TOKEN`

Android workflow 需要注入：

- `ANDROID_UPLOAD_KEYSTORE_BASE64`
- `ANDROID_UPLOAD_STORE_PASSWORD`
- `ANDROID_UPLOAD_KEY_ALIAS`
- `ANDROID_UPLOAD_KEY_PASSWORD`
- `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`

CI 可选变量：

- `ANDROID_RUNNER_LABELS_JSON`
- `VPS_SSH_PORT`
- `SERVER_DEPLOY_DIR`

不再需要：

- `EXPO_TOKEN`
- EAS project/channel/build profile 配置

## Android Release

主入口：

```bash
./scripts/free-app-release-production.sh android
cd apps/free/app && pnpm run release:android:production
./run release android
```

CI workflow：

- `.github/workflows/release-android.yml`

流程：

1. `expo prebuild --platform android`
2. 用 upload keystore 构建 signed `app-release.aab`
3. GitHub Actions 手动触发后上传到 Google Play

## Current Gaps

- Android 链路这次只补到脚本和 CI，尚未做真实 Google Play 上传验收
- OTA 最终链路已经切到自托管 server + GitHub Releases，但仍需你们在真实环境完成一次端到端验收
