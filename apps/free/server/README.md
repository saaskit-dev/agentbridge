# Free Server

AgentBridge 的中继服务器，负责协调 CLI/Daemon 与手机 App 之间的加密通信、会话管理和消息中转。

内置 PGlite 嵌入式数据库，无需外部 PostgreSQL 即可独立运行。

## 本地开发

```bash
# 推荐：从项目根目录一键启动（含 server + daemon + web）
./run dev

# 或只启动 server
./run dev server

# 或手动启动（需先在 .env 中配置环境变量）
cd apps/free/server
pnpm db:generate
pnpm dev                    # 开发模式（tsx 热重载）
pnpm standalone serve       # 独立模式（PGlite 嵌入式）
```

## 部署

### Docker（推荐）

```bash
# 构建镜像
./run build server

# 启动容器（使用 docker-compose）
cd apps/free/server
docker-compose up -d

# 或手动启动
docker run -d \
  -p 3000:3000 \
  -e FREE_MASTER_SECRET=your-secret-key \
  -v free-data:/app/data \
  --restart unless-stopped \
  kilingzhang/free-server:latest
```

### Node.js 直接运行

适合快速测试或无 Docker 环境：

```bash
cd apps/free/server
pnpm install
pnpm build:bundle
pnpm db:generate
FREE_MASTER_SECRET=your-secret-key node dist/bundle.cjs serve
```

## 环境变量

| 变量                 | 说明                                                    | 默认值            |
| -------------------- | ------------------------------------------------------- | ----------------- |
| `FREE_MASTER_SECRET` | 主加密密钥，用于认证和数据加密                          | **必填**          |
| `PORT`               | 服务器监听端口                                          | `3000`            |
| `DATA_DIR`           | 数据目录（PGlite、日志等）                              | `./data`          |
| `PGLITE_DIR`         | PGlite 数据库目录                                       | `DATA_DIR/pglite` |
| `DATABASE_URL`       | 外部 PostgreSQL 连接字符串（设置后使用 PG 而非 PGlite） | —                 |
| `APP_ENV`            | 设为 `development` 时放宽 CORS、禁用日志脱敏            | `production`      |
| `LOG_LEVEL`          | 日志级别：`debug` / `info` / `warn` / `error`           | `debug`           |

## 服务器命令

`bundle.cjs` 是一个内置多命令的可执行文件：

```bash
node dist/bundle.cjs serve      # 启动服务器（自动运行迁移）
node dist/bundle.cjs migrate    # 仅执行数据库迁移
node dist/bundle.cjs reset      # 清空所有数据，恢复初始状态
node dist/bundle.cjs logs       # 查询服务器日志
```

**日志查询选项：**

```bash
node dist/bundle.cjs logs --trace <id>           # 按 trace ID 过滤
node dist/bundle.cjs logs --session <id>          # 按 session ID 过滤
node dist/bundle.cjs logs --level warn            # 最低日志级别
node dist/bundle.cjs logs --since 1h              # 时间范围（支持 Nm/Nh/Nd）
node dist/bundle.cjs logs --jsonl                 # 输出原始 JSONL
```

## 客户端连接

CLI 安装后，将 `FREE_SERVER_URL` 指向你的服务器：

```bash
# 临时使用
FREE_SERVER_URL=https://your-server.example.com free

# 或写入 shell 配置持久生效
echo 'export FREE_SERVER_URL=https://your-server.example.com' >> ~/.zshrc
```

## 外部 PostgreSQL

生产环境建议使用外部 PostgreSQL 替代内置 PGlite：

```bash
docker run -d \
  -p 3000:3000 \
  -e FREE_MASTER_SECRET=your-secret-key \
  -e DATABASE_URL=postgresql://user:pass@db-host:5432/free \
  --restart unless-stopped \
  kilingzhang/free-server:latest
```

设置 `DATABASE_URL` 后，服务器自动切换到外部 PostgreSQL，不再使用 PGlite。Socket.IO 会自动启用 PostgreSQL adapter 支持跨实例通信。

## 数据持久化

- **PGlite 模式**：数据存储在 `DATA_DIR/pglite/`，Docker 中通过 volume 挂载 `/app/data` 持久化
- **PostgreSQL 模式**：数据存储在外部数据库，容器本身无状态
- **日志文件**：写入 `~/.free/logs/`（或 `FREE_HOME_DIR/logs/`），格式为 JSONL

## 健康检查

```bash
curl http://localhost:3000/health
```

Docker 容器内置健康检查（每 30 秒探测一次 `/`）。

## 反向代理（Nginx 示例）

```nginx
server {
    listen 443 ssl;
    server_name free.example.com;

    ssl_certificate     /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        # WebSocket 支持（必须）
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket 长连接超时
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
```

> WebSocket 支持是必须的 —— AgentBridge 的实时同步依赖 Socket.IO（基于 WebSocket）。

## 项目结构

```
apps/free/server/
├── src/
│   ├── main.ts              # 开发模式入口
│   ├── standalone.ts        # 独立模式入口（含迁移、日志查询）
│   ├── app/
│   │   ├── api/             # REST 路由 & WebSocket 处理
│   │   │   ├── routes/      # 各业务路由（session, telemetry, ...）
│   │   │   └── socket/      # Socket.IO 事件处理
│   │   ├── auth/            # 挑战-响应认证
│   │   ├── kv/              # 键值存储
│   │   ├── events/          # 事件路由
│   │   └── presence/        # 在线状态 & 超时
│   └── storage/             # 数据库抽象（Prisma + PGlite/PostgreSQL）
├── prisma/
│   ├── schema.prisma        # 数据库 Schema
│   └── migrations/          # 数据库迁移
├── Dockerfile               # 多阶段构建
├── docker-compose.yml       # 本地 Docker 测试
└── start-free.sh            # 容器启动脚本
```
