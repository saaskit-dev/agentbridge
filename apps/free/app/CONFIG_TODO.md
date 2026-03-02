# Free App 配置清单

---

## 1. Expo / EAS

### 配置文件
- `apps/free/app/app.config.js`
- `apps/free/app/eas.json`

### 需要配置
| 字段 | 位置 | 获取方式 |
|------|------|----------|
| `eas.projectId` | app.config.js | [Expo Dashboard](https://expo.dev) → Create project → Settings |
| `updates.url` | app.config.js | 同上，格式：`https://u.expo.dev/[PROJECT_ID]` |
| `owner` | app.config.js | 你的 Expo 用户名 |

### 操作步骤
```bash
# 1. 登录/注册 Expo
npx expo login

# 2. 创建项目
cd apps/free/app
npx eas init --id

# 3. 项目 ID 会自动写入 app.config.js
```

---

## 2. Apple Developer / App Store

### 配置文件
- `apps/free/app/eas.json`
- `apps/free/app/apple-app-site-association`

### 需要配置
| 字段 | 位置 | 获取方式 |
|------|------|----------|
| `appleId` | eas.json | 你的 Apple ID 邮箱 |
| `appleTeamId` | eas.json | [Apple Developer](https://developer.apple.com/account) → Membership → Team ID |
| `ascAppId` | eas.json | [App Store Connect](https://appstoreconnect.apple.com) → My Apps → [App] → App Information → Apple ID |
| `appIDs` | apple-app-site-association | `TEAM_ID.app.saaskit.free` |

### 操作步骤
1. 注册 [Apple Developer Program](https://developer.apple.com/programs/) ($99/年)
2. 在 [App Store Connect](https://appstoreconnect.apple.com) 创建新 App
3. 记录 Team ID 和 App ID

---

## 3. Firebase (Android Push Notifications)

### 配置文件
- `apps/free/app/google-services.json`
- `apps/free/app/android/app/google-services.json`

### 需要配置
| 字段 | 获取方式 |
|------|----------|
| `project_id` | [Firebase Console](https://console.firebase.google.com) → Create project |
| `mobilesdk_app_id` | Firebase Console → Project Settings → Your apps |
| `api_key` | 同上 |

### 操作步骤
1. 访问 [Firebase Console](https://console.firebase.google.com)
2. 创建新项目（或使用现有项目）
3. 添加 Android 应用：
   - Package name: `app.saaskit.free` (production) 或 `app.saaskit.free.dev` (dev)
4. 下载 `google-services.json` 替换上述两个文件
---

## 4. Android App Links (assetlinks.json)

### 配置文件
- `apps/free/app/assetlinks.json`

### 需要配置
| 字段 | 获取方式 |
|------|----------|
| `sha256_cert_fingerprints` | 从你的签名密钥获取 |

### 操作步骤
```bash
# 获取 SHA-256 指纹（debug keystore）
keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android

# 或者从你的 release keystore
keytool -list -v -keystore your-release-key.jks -alias your-alias
```

然后将指纹上传到你的服务器：
`https://your-domain.com/.well-known/assetlinks.json`

---

## 5. iOS Universal Links (apple-app-site-association)

### 配置文件
- `apps/free/app/apple-app-site-association`

### 需要配置
- 你的 Apple Team ID
- 你的 Bundle ID

### 操作步骤
1. 获取 Team ID（见 Apple Developer 部分）
2. 上传到你的服务器：
   `https://your-domain.com/.well-known/apple-app-site-association`
3. 在 Apple Developer 后台启用 Associated Domains

---

## 6. 第三方服务（可选）

### PostHog (Analytics)
| 环境变量 | 获取方式 |
|----------|----------|
| `EXPO_PUBLIC_POSTHOG_API_KEY` | [PostHog](https://posthog.com) → Project Settings |

### RevenueCat (In-App Purchases)
| 环境变量 | 获取方式 |
|----------|----------|
| `EXPO_PUBLIC_REVENUE_CAT_APPLE` | [RevenueCat](https://www.revenuecat.com) → Projects → [Project] → API keys |
| `EXPO_PUBLIC_REVENUE_CAT_GOOGLE` | 同上 |
| `EXPO_PUBLIC_REVENUE_CAT_STRIPE` | 同上 |

---

## 快速检查清单

```bash
# 检查所有 TODO 标记
grep -r "TODO" apps/free/app/ --include="*.json" --include="*.js"
```

- [ ] Expo EAS project ID
- [ ] Apple Team ID
- [ ] Apple App Store App ID
- [ ] Firebase google-services.json (Android)
- [ ] Android App Links SHA-256 指纹
- [ ] iOS Universal Links Team ID
