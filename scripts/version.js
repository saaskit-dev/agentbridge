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

const APP_CONFIG_PATH = path.join(__dirname, '../apps/free/app/app.config.js');

function getCurrentVersion() {
  const content = fs.readFileSync(APP_CONFIG_PATH, 'utf8');
  const match = content.match(/version:\s*['"]([^'"]+)['"]/);
  return match ? match[1] : null;
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

function updateVersion(newVersion) {
  // 更新 app.config.js
  let appConfig = fs.readFileSync(APP_CONFIG_PATH, 'utf8');
  appConfig = appConfig.replace(
    /version:\s*['"][^'"]+['"]/,
    `version: '${newVersion}'`
  );
  fs.writeFileSync(APP_CONFIG_PATH, appConfig);

  console.log(`✅ App 版本已更新: ${newVersion}`);
  console.log('');
  console.log('下一步:');
  console.log('  1. 运行 prebuild 同步到原生项目:');
  console.log('     cd apps/free/app && npx expo prebuild');
  console.log('');
  console.log('  2. 或者直接构建 (EAS 会自动运行 prebuild):');
  console.log('     cd apps/free/app && eas build');
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
