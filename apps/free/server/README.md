# Free Server

AgentBridge 的中继服务器，负责 CLI/Daemon 与手机 App 之间的加密通信、会话管理、消息中转，以及自托管 OTA 更新分发。

内置 PGlite，可独立运行；生产环境也支持外部 PostgreSQL。

## 本地开发

```bash
./run dev
./run dev server

cd apps/free/server
pnpm db:generate
pnpm dev
pnpm standalone serve
```

## 部署

### Docker

```bash
./run build server

cd apps/free/server
docker-compose up -d
```

### Node.js

```bash
cd apps/free/server
pnpm install
pnpm build:bundle
pnpm db:generate
FREE_MASTER_SECRET=your-secret-key node dist/bundle.cjs serve
```

## 环境变量

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `FREE_MASTER_SECRET` | 主加密密钥 | 必填 |
| `PORT` | 监听端口 | `3000` |
| `DATA_DIR` | 数据目录 | `./data` |
| `PGLITE_DIR` | PGlite 目录 | `DATA_DIR/pglite` |
| `DATABASE_URL` | 外部 PostgreSQL 连接串 | - |
| `APP_ENV` | `development` 时放宽 CORS | `production` |
| `LOG_LEVEL` | `debug/info/warn/error` | `debug` |
| `EXPO_UPDATES_GATEWAY_ENABLED` | 启用 OTA gateway | `true` |
| `EXPO_UPDATES_GATEWAY_MODE` | `self-hosted` / `expo` / `disabled` | `self-hosted` |
| `EXPO_UPDATES_UPSTREAM_URL` | 仅 `expo` 代理模式需要 | - |
| `EXPO_UPDATES_GATEWAY_TIMEOUT_MS` | 代理模式超时 | `10000` |
| `EXPO_UPDATES_ADMIN_TOKEN` | OTA 发布写入 token | 必填 |

## OTA Endpoints

客户端更新入口：

- `GET /updates`
- `POST /updates`
- `GET /updates/desktop/latest.json`

发布管理入口：

- `POST /updates/admin/releases`
- `POST /updates/admin/promote`
- `GET /updates/admin/releases`
- `GET /updates/admin/latest`
- `POST /updates/admin/desktop/releases`
- `POST /updates/admin/desktop/promote`
- `GET /updates/admin/desktop/releases`
- `GET /updates/admin/desktop/latest`

客户端请求会按 `platform + runtimeVersion + channel` 返回最新 manifest。
Desktop updater 则通过独立地址 `/updates/desktop/latest.json?channel=stable` 获取当前桌面 release manifest，
不会再依赖 GitHub Releases 的全局 `latest` 语义。

## Self-Hosted OTA

示例配置：

```bash
EXPO_UPDATES_GATEWAY_ENABLED=true
EXPO_UPDATES_GATEWAY_MODE=self-hosted
EXPO_UPDATES_ADMIN_TOKEN=replace-with-a-long-random-token
```

发布命令：

```bash
cd apps/free/app
OTA_MESSAGE="fix login bug" \
OTA_SERVER_URL=https://your-server.example.com \
OTA_SERVER_TOKEN=replace-with-the-same-token \
GITHUB_TOKEN=ghp_xxx \
pnpm run ota
```

这条命令会用本地 Expo CLI 导出更新产物，把 bundle / assets 上传到 GitHub Releases，再把 manifest metadata 写入本 server。

发布后校验：

```bash
OTA_SERVER_URL=https://your-server.example.com \
OTA_SERVER_TOKEN=replace-with-the-same-token \
GITHUB_TOKEN=ghp_xxx \
OTA_RELEASE_ID=release-id \
node ./scripts/verify-ota-release.mjs
```

如需回滚，可把旧 release 重新 promote：

```bash
curl -X POST https://your-server.example.com/updates/admin/promote \
  -H "Authorization: Bearer replace-with-the-same-token" \
  -H "Content-Type: application/json" \
  -d '{"releaseId":"older-release-id"}'
```

## 客户端连接

```bash
FREE_SERVER_URL=https://your-server.example.com free
```

## 外部 PostgreSQL

```bash
docker run -d \
  -p 3000:3000 \
  -e FREE_MASTER_SECRET=your-secret-key \
  -e DATABASE_URL=postgresql://user:pass@db-host:5432/free \
  --restart unless-stopped \
  kilingzhang/free-server:latest
```

## 数据持久化

- PGlite：`DATA_DIR/pglite/`
- 日志：`~/.free/logs/` 或 `FREE_HOME_DIR/logs/`

## 健康检查

```bash
curl http://localhost:3000/health
```
