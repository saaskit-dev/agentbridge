#!/usr/bin/env node

/**
 * 版本管理脚本
 *
 * 使用方式:
 *   node scripts/version.js                  # 查看 app / desktop 当前版本
 *   node scripts/version.js app             # 查看移动端版本
 *   node scripts/version.js desktop         # 查看桌面端版本
 *   node scripts/version.js <version>       # 设置移动端新版本
 *   node scripts/version.js patch           # 自动升级移动端 patch 版本 (0.0.1 -> 0.0.2)
 *   node scripts/version.js desktop patch   # 自动升级桌面端 patch 版本
 *   node scripts/version.js desktop 0.2.0   # 设置桌面端指定版本
 *
 * 修改后需要运行 prebuild 同步到原生项目:
 *   cd apps/free/app && npx expo prebuild
 */

const fs = require('fs');
const path = require('path');
const { DEFAULT_RELEASE_TIME_ZONE, generateTimeVersion } = require('./releaseTime');

const APP_DIR = path.join(__dirname, '../apps/free/app');
const APP_PACKAGE_JSON_PATH = path.join(APP_DIR, 'package.json');
const TAURI_CONFIG_PATH = path.join(APP_DIR, 'src-tauri/tauri.conf.json');
const VERSION_TARGETS = {
  app: {
    label: 'App / Mobile',
    files: [APP_PACKAGE_JSON_PATH],
  },
  desktop: {
    label: 'Desktop',
    files: [TAURI_CONFIG_PATH],
  },
};

function extractExplicitVersion(input) {
  const trimmed = input.trim();

  if (/^\d+\.\d+\.\d+$/.test(trimmed)) {
    return trimmed;
  }

  const match = trimmed.match(/(?:^|[^\d])v?(\d+\.\d+\.\d+)(?=$|[^\d])/);
  return match ? match[1] : null;
}

function readJsonVersion(filePath) {
  const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return content.version ?? null;
}

function getCurrentVersion(target) {
  const spec = VERSION_TARGETS[target];
  if (!spec) {
    return null;
  }
  return readJsonVersion(spec.files[0]);
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

function resolveVersionTarget(arg) {
  if (!arg) {
    return null;
  }
  return Object.prototype.hasOwnProperty.call(VERSION_TARGETS, arg) ? arg : null;
}

function resolveVersionCommand(args) {
  const [first, second] = args;
  const explicitTarget = resolveVersionTarget(first);

  if (explicitTarget) {
    return { target: explicitTarget, value: second ?? null, explicitTarget: true };
  }

  return { target: 'app', value: first ?? null, explicitTarget: false };
}

function printUsage() {
  console.log('当前版本:');
  console.log(`  app: ${getCurrentVersion('app') || 'unknown'}`);
  console.log(`  desktop: ${getCurrentVersion('desktop') || 'unknown'}`);
  console.log('');
  console.log('使用方式:');
  console.log('  node scripts/version.js [app]                  查看移动端版本');
  console.log('  node scripts/version.js desktop                查看桌面端版本');
  console.log('  node scripts/version.js [app] <version>        设置移动端版本（或从文本中提取 x.y.z）');
  console.log('  node scripts/version.js desktop <version>      设置桌面端版本（或从文本中提取 x.y.z）');
  console.log(`  node scripts/version.js [app] time             按 ${DEFAULT_RELEASE_TIME_ZONE} 当前时间生成移动端版本`);
  console.log(`  node scripts/version.js desktop time           按 ${DEFAULT_RELEASE_TIME_ZONE} 当前时间生成桌面端版本`);
  console.log('  node scripts/version.js [app] patch            升级移动端 patch 版本');
  console.log('  node scripts/version.js [app] minor            升级移动端 minor 版本');
  console.log('  node scripts/version.js [app] major            升级移动端 major 版本');
  console.log('  node scripts/version.js desktop patch          升级桌面端 patch 版本');
  console.log('  node scripts/version.js desktop minor          升级桌面端 minor 版本');
  console.log('  node scripts/version.js desktop major          升级桌面端 major 版本');
}

function printCurrentTargetVersion(target) {
  const version = getCurrentVersion(target);
  const label = VERSION_TARGETS[target]?.label || target;
  console.log(`当前 ${label} 版本: ${version || 'unknown'}`);
}

function updateVersion(target, newVersion) {
  const spec = VERSION_TARGETS[target];
  if (!spec) {
    console.error(`❌ 未知版本目标: ${target}`);
    process.exit(1);
  }

  for (const filePath of spec.files) {
    updateJsonVersion(filePath, newVersion);
  }

  console.log(`✅ ${spec.label} 版本已更新: ${newVersion}`);
  console.log('');
  console.log('下一步:');
  if (target === 'desktop') {
    console.log('  1. 构建桌面包:');
    console.log('     ./run desktop release');
  } else {
    console.log('  1. 如修改了原生配置，运行 prebuild 同步移动端原生项目:');
    console.log('     cd apps/free/app && npx expo prebuild');
    console.log('');
    console.log('  2. 构建 Android APK:');
    console.log('     ./run release android');
    console.log('');
    console.log('  3. 或在 self-hosted macOS runner / 本机构建 iOS:');
    console.log('     ./scripts/free-app-release-production.sh ios');
  }
}

function main() {
  const { target, value, explicitTarget } = resolveVersionCommand(process.argv.slice(2));

  if (!value) {
    if (explicitTarget) {
      printCurrentTargetVersion(target);
    } else {
      printUsage();
    }
    return;
  }

  const currentVersion = getCurrentVersion(target);
  if (!currentVersion) {
    console.error(`❌ 无法读取 ${target} 当前版本`);
    process.exit(1);
  }

  if (value === 'patch' || value === 'minor' || value === 'major') {
    const newVersion = bumpVersion(currentVersion, value);
    updateVersion(target, newVersion);
  } else if (value === 'time') {
    updateVersion(target, generateTimeVersion());
  } else {
    const explicitVersion = extractExplicitVersion(value);
    if (explicitVersion) {
      updateVersion(target, explicitVersion);
      return;
    }

    console.error('❌ 版本格式错误，请使用 x.y.z 格式，或提供包含 x.y.z 的文本');
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  bumpVersion,
  extractExplicitVersion,
  generateTimeVersion,
  resolveVersionCommand,
};
