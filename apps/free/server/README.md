# Free Server

Free Server 是一个多智能体服务的后端，支持 Claude Code、Codex、Gemini 等 AI Agent。

## 本地开发

```bash
# 安装依赖
pnpm install

# 生成 Prisma 客户端
pnpm db:generate

# 启动开发服务器
pnpm dev

# 或者使用独立模式 (PGlite)
pnpm standalone
```

## Docker 部署

### 构建镜像

```bash
./build.sh
```

### 部署到 VPS

```bash
# 设置环境变量
export FREE_MASTER_SECRET=your-secret-key

# 运行部署脚本
./deploy.sh
```

### 环境变量

| 变量 | 描述 | 必需 |
|------|------|------|
| `FREE_MASTER_SECRET` | 主密钥 (加密/认证) | 是 |
| `PORT` | 服务器端口 | 否 (默认 3000) |
| `DATA_DIR` | 数据目录 | 否 (默认 ./data) |
| `DATABASE_URL` | 外部 PostgreSQL | 否 (默认用 PGlite) |

## 多实例部署

如需多实例部署，使用外部 PostgreSQL：

```bash
export DATABASE_URL="postgresql://user:password@host:5432/database"
```

Socket.IO 会自动启用 PostgreSQL adapter 支持跨实例通信。

## 项目结构

```
packages/free/server/
├── src/
│   ├── main.ts          # 本地开发入口
│   ├── standalone.ts    # 独立模式入口
│   ├── app/             # API 路由和业务逻辑
│   └── storage/         # 数据库和存储
├── prisma/              # Prisma schema
├── Dockerfile           # Docker 镜像
├── build.sh             # 构建并推送镜像
├── deploy.sh            # VPS 部署脚本
└── start-free.sh        # 容器启动脚本
```
