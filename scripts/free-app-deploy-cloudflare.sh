#!/bin/bash

# Free App - Cloudflare Pages 部署脚本
# 用法: ./scripts/free-app-deploy-cloudflare.sh [project-name]
# 示例: ./scripts/free-app-deploy-cloudflare.sh free-app

set -e

PROJECT_NAME="${1:-free-app}"
DIST_DIR="dist"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
APP_DIR="$ROOT_DIR/apps/free/app"

echo "🚀 部署 Free App 到 Cloudflare Pages"
echo "   项目名: $PROJECT_NAME"
echo "   App 目录: $APP_DIR"
echo ""

cd "$APP_DIR"

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
echo "🏗️  构建 Web 版本..."
rm -rf "$DIST_DIR"
npx expo export --platform web

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
wrangler pages deploy "$DIST_DIR" --project-name="$PROJECT_NAME" --commit-dirty=true

echo ""
echo "✅ 部署完成!"
echo "   访问: https://$PROJECT_NAME.pages.dev"
