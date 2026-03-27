const { withXcodeProject, withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * prebuild 后自动配置 Xcode 默认值：
 *
 * 1. Scheme 的 Run action 使用 Release 配置（而非默认的 Debug）
 * 2. 设置 App Category 为 Developer Tools（通过 build setting，让 Xcode General tab 正确显示）
 */
module.exports = config => {
  // ── 1. App Category build setting ─────────────────────────────────────────
  config = withXcodeProject(config, cfg => {
    const project = cfg.modResults;
    const buildConfigs = project.pbxXCBuildConfigurationSection();

    for (const key of Object.keys(buildConfigs)) {
      const entry = buildConfigs[key];
      if (typeof entry !== 'object' || !entry.buildSettings) continue;

      // 只对 app target 的配置设置（有 PRODUCT_BUNDLE_IDENTIFIER 的）
      if (!entry.buildSettings.PRODUCT_BUNDLE_IDENTIFIER) continue;

      entry.buildSettings.INFOPLIST_KEY_LSApplicationCategoryType =
        '"public.app-category.developer-tools"';
    }

    return cfg;
  });

  // ── 2. Scheme Run → Release ───────────────────────────────────────────────
  config = withDangerousMod(config, [
    'ios',
    cfg => {
      const projectRoot = cfg.modRequest.projectRoot;
      const schemesDir = path.join(
        projectRoot,
        'ios',
        `${cfg.modRequest.projectName}.xcodeproj`,
        'xcshareddata',
        'xcschemes'
      );

      if (!fs.existsSync(schemesDir)) return cfg;

      for (const file of fs.readdirSync(schemesDir)) {
        if (!file.endsWith('.xcscheme')) continue;

        const schemePath = path.join(schemesDir, file);
        let content = fs.readFileSync(schemePath, 'utf8');

        // 将 LaunchAction 的 buildConfiguration 从 Debug 改为 Release
        content = content.replace(
          /(<LaunchAction\b[^>]*\bbuildConfiguration\s*=\s*)"Debug"/,
          '$1"Release"'
        );

        fs.writeFileSync(schemePath, content, 'utf8');
      }

      return cfg;
    },
  ]);

  return config;
};
