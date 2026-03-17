#!/bin/bash

# Free App - Cloudflare Pages 部署脚本
# 用法: ./scripts/free-app-deploy-cloudflare.sh [project-name] [env]
# 示例: ./scripts/free-app-deploy-cloudflare.sh free-app production

set -e

PROJECT_NAME="${1:-free-app}"
APP_ENV="${2:-production}"
DIST_DIR="dist"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
APP_DIR="$ROOT_DIR/apps/free/app"

echo "🚀 部署 Free App 到 Cloudflare Pages"
echo "   项目名: $PROJECT_NAME"
echo "   环境:   $APP_ENV"
echo "   App 目录: $APP_DIR"
echo ""

cd "$APP_DIR"

# 加载环境变量（优先 .env.$APP_ENV，fallback .env）
ENV_FILE=".env.$APP_ENV"
if [ -f "$ENV_FILE" ]; then
    echo "🔑 加载环境变量: $ENV_FILE"
    set -a
    source "$ENV_FILE"
    set +a
elif [ -f ".env" ]; then
    echo "🔑 加载环境变量: .env (未找到 $ENV_FILE)"
    set -a
    source ".env"
    set +a
else
    echo "⚠️  未找到环境变量文件，使用当前 shell 环境"
fi

# 打印 key 状态（不打印完整值）
echo ""
echo "   REVENUE_CAT_APPLE:  ${EXPO_PUBLIC_REVENUE_CAT_APPLE:0:12}..."
echo "   REVENUE_CAT_GOOGLE: ${EXPO_PUBLIC_REVENUE_CAT_GOOGLE:0:12}..."
echo "   REVENUE_CAT_STRIPE: ${EXPO_PUBLIC_REVENUE_CAT_STRIPE:0:12}..."
echo ""

# 检查 node_modules
if [ ! -d "node_modules" ]; then
    echo "📦 安装依赖..."
    yarn install
fi

# 检查 wrangler
if ! command -v wrangler &> /dev/null; then
    echo "📦 安装 wrangler..."
    npm install -g wrangler
fi

# 检查登录状态
echo "🔐 检查 Cloudflare 登录状态..."
if ! wrangler whoami &> /dev/null; then
    echo "请先登录 Cloudflare:"
    wrangler login
fi

# 构建
echo ""
echo "🏗️  构建 Web 版本 (APP_ENV=$APP_ENV)..."
rm -rf "$DIST_DIR"
APP_ENV="$APP_ENV" npx expo export --platform web --clear

# 检查构建结果
if [ ! -d "$DIST_DIR" ]; then
    echo "❌ 构建失败: $DIST_DIR 目录不存在"
    exit 1
fi

# 添加 SPA 路由配置 for Cloudflare Pages
echo "📋 添加 SPA 路由配置..."
echo '{"version": 1, "include": ["/*"], "exclude": ["/_expo/*", "/assets/*", "/*.js", "/*.css", "/*.wasm", "/*.ico", "/*.png", "/*.jpg", "/*.svg"]}' > "$DIST_DIR/_routes.json"
echo "/* /index.html 200" > "$DIST_DIR/_redirects"

echo ""
echo "📤 部署到 Cloudflare Pages..."
# --commit-message: Cloudflare API rejects non-ASCII commit messages (code 8000111),
# so we override with a safe ASCII string derived from the git short hash.
COMMIT_HASH=$(git rev-parse --short HEAD 2>/dev/null || echo "manual")
wrangler pages deploy "$DIST_DIR" --project-name="$PROJECT_NAME" --commit-dirty=true --commit-message="deploy ${COMMIT_HASH}"

echo ""
echo "✅ 部署完成! (环境: $APP_ENV)"
echo "   访问: https://$PROJECT_NAME-3bp.pages.dev"
