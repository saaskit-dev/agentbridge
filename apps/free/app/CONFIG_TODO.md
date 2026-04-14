# Free App 配置清单

## 1. 自托管 OTA

配置文件：

- `apps/free/app/app.config.js`
- `apps/free/server/.env`

需要配置：

| 字段 | 位置 | 获取方式 |
| --- | --- | --- |
| `updates.url` | `app.config.js` | 你们自己的 server，格式：`https://your-server.example.com/updates` |
| `EXPO_UPDATES_ADMIN_TOKEN` | server 环境变量 | 自行生成长随机 token |
| `OTA_SERVER_URL` | OTA 发布环境变量 | 指向你们 server 根地址 |
| `OTA_SERVER_TOKEN` | OTA 发布环境变量 | 与 `EXPO_UPDATES_ADMIN_TOKEN` 一致 |
| `GITHUB_TOKEN` | OTA 发布环境变量 | GitHub token，用于上传 OTA 静态资产到 Releases |
| `OTA_GITHUB_REPOSITORY` | OTA 发布环境变量 | 可选，格式：`owner/repo` |

操作步骤：

1. 部署你们自己的 server
2. 打开 `/updates` 和 `/updates/admin/*` 路由
3. 在 app 构建环境里确认 `updates.url` 指向你们 server
4. 用 `pnpm run ota` 发布 OTA，并把静态资产传到 GitHub Releases

## 2. Apple Developer / App Store

配置文件：

- `apps/free/app/apple-app-site-association`

需要配置：

| 字段 | 位置 | 获取方式 |
| --- | --- | --- |
| `APPLE_TEAM_ID` | GitHub Actions Secret | Apple Developer → Membership → Team ID |
| `ASC_APP_ID` | GitHub Actions Secret | App Store Connect → App Information → Apple ID |
| `ASC_KEY_ID` / `ASC_ISSUER_ID` / `ASC_PRIVATE_KEY` | GitHub Actions Secret | App Store Connect API Key |
| `appIDs` | `apple-app-site-association` | `TEAM_ID.app.saaskit.freecode` |

## 3. Firebase

配置文件：

- `apps/free/app/google-services.json`
- `apps/free/app/android/app/google-services.json`

需要配置：

| 字段 | 获取方式 |
| --- | --- |
| `project_id` | Firebase Console |
| `mobilesdk_app_id` | Firebase Console |
| `api_key` | Firebase Console |
| `ANDROID_UPLOAD_KEYSTORE_BASE64` | 把 Android release keystore 做 base64 后存到 CI secret |
| `ANDROID_UPLOAD_STORE_PASSWORD` | Android release keystore password |
| `ANDROID_UPLOAD_KEY_ALIAS` | Android release key alias |
| `ANDROID_UPLOAD_KEY_PASSWORD` | Android release key password |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | Google Play Console service account JSON |

## 4. Android App Links

配置文件：

- `apps/free/app/assetlinks.json`

需要配置：

| 字段 | 获取方式 |
| --- | --- |
| `sha256_cert_fingerprints` | 从 Android 签名密钥读取 |

## 5. iOS Universal Links

配置文件：

- `apps/free/app/apple-app-site-association`

需要配置：

- Apple Team ID
- Production bundle ID

## 6. 可选第三方服务

### PostHog

| 环境变量 | 获取方式 |
| --- | --- |
| `EXPO_PUBLIC_POSTHOG_API_KEY` | PostHog Project Settings |

### RevenueCat

| 环境变量 | 获取方式 |
| --- | --- |
| `EXPO_PUBLIC_REVENUE_CAT_APPLE` | RevenueCat API keys |
| `EXPO_PUBLIC_REVENUE_CAT_GOOGLE` | RevenueCat API keys |
| `EXPO_PUBLIC_REVENUE_CAT_STRIPE` | RevenueCat API keys |

## 快速检查

```bash
grep -r "TODO" apps/free/app/ --include="*.json" --include="*.js"
```

- [ ] 自托管 OTA URL
- [ ] OTA admin token
- [ ] Apple Team ID
- [ ] Apple App Store App ID
- [ ] Firebase 配置
- [ ] Android App Links 指纹
- [ ] iOS Universal Links 配置
