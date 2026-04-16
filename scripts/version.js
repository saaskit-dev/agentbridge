#!/usr/bin/env node

/**
 * 统一版本管理脚本
 *
 * 使用方式:
 *   node scripts/version.js <version>        # 设置新版本
 *   node scripts/version.js patch            # 自动升级 patch 版本 (0.0.1 -> 0.0.2)
 *   node scripts/version.js minor            # 自动升级 minor 版本 (0.0.1 -> 0.1.0)
 *   node scripts/version.js major            # 自动升级 major 版本 (0.0.1 -> 1.0.0)
 *   node scripts/version.js                  # 查看当前版本
 *
 * 修改后需要运行 prebuild 同步到原生项目:
 *   cd apps/free/app && npx expo prebuild
 */

const fs = require('fs');
const path = require('path');

const APP_DIR = path.join(__dirname, '../apps/free/app');
const APP_PACKAGE_JSON_PATH = path.join(APP_DIR, 'package.json');
const TAURI_CONFIG_PATH = path.join(APP_DIR, 'src-tauri/tauri.conf.json');

function getCurrentVersion() {
  const content = JSON.parse(fs.readFileSync(APP_PACKAGE_JSON_PATH, 'utf8'));
  return content.version ?? null;
}

function bumpVersion(version, type) {
  const parts = version.split('.').map(Number);
  const [major, minor, patch] = parts;

  switch (type) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
    default:
      return version;
  }
}

function updateJsonVersion(filePath, newVersion) {
  const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  content.version = newVersion;
  fs.writeFileSync(filePath, JSON.stringify(content, null, 2) + '\n');
}

function updateVersion(newVersion) {
  updateJsonVersion(APP_PACKAGE_JSON_PATH, newVersion);
  updateJsonVersion(TAURI_CONFIG_PATH, newVersion);

  console.log(`✅ App / Desktop 版本已更新: ${newVersion}`);
  console.log('');
  console.log('下一步:');
  console.log('  1. 如修改了原生配置，运行 prebuild 同步移动端原生项目:');
  console.log('     cd apps/free/app && npx expo prebuild');
  console.log('');
  console.log('  2. 构建桌面包:');
  console.log('     ./run desktop release');
  console.log('');
  console.log('  3. 构建 Android APK:');
  console.log('     ./run release android');
  console.log('');
  console.log('  4. 或在 self-hosted macOS runner / 本机构建 iOS:');
  console.log('     ./scripts/free-app-release-production.sh ios');
}

function main() {
  const arg = process.argv[2];
  const currentVersion = getCurrentVersion();

  if (!currentVersion) {
    console.error('❌ 无法读取当前版本');
    process.exit(1);
  }

  if (!arg) {
    console.log(`当前版本: ${currentVersion}`);
    console.log('');
    console.log('使用方式:');
    console.log('  node scripts/version.js <version>    设置指定版本');
    console.log('  node scripts/version.js patch        升级 patch 版本');
    console.log('  node scripts/version.js minor        升级 minor 版本');
    console.log('  node scripts/version.js major        升级 major 版本');
    return;
  }

  if (arg === 'patch' || arg === 'minor' || arg === 'major') {
    const newVersion = bumpVersion(currentVersion, arg);
    updateVersion(newVersion);
  } else if (/^\d+\.\d+\.\d+$/.test(arg)) {
    updateVersion(arg);
  } else {
    console.error('❌ 版本格式错误，请使用 x.y.z 格式');
    process.exit(1);
  }
}

main();
