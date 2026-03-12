const { withXcodeProject, withInfoPlist, withAppBuildGradle } = require('@expo/config-plugins');

/**
 * 仅在 APP_ENV=development 时生效。
 * 同一次 prebuild 支持 Debug / Release 两套配置：
 *
 *   Debug   → app.saaskit.freecode.dev      "Free (dev)"
 *   Release → app.saaskit.freecode.preview  "Free (preview)"
 *
 * iOS 实现：
 *   1. xcodeproj 每个 build configuration 写入 PRODUCT_BUNDLE_IDENTIFIER 和 APP_DISPLAY_NAME
 *   2. Info.plist 的 CFBundleDisplayName 改为 $(APP_DISPLAY_NAME)，让 Xcode 按 config 解析
 *
 * Android 实现：
 *   在 release buildType 中覆盖 applicationId 为 .preview
 */
module.exports = (config) => {
  if (process.env.APP_ENV !== 'development') return config;

  // ── iOS ──────────────────────────────────────────────────────────────────

  const iosVariants = {
    Debug:   { bundleId: '"app.saaskit.freecode.dev"',     displayName: '"Free (dev)"' },
    Release: { bundleId: '"app.saaskit.freecode.preview"', displayName: '"Free (preview)"' },
  };

  config = withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const buildConfigs = project.pbxXCBuildConfigurationSection();

    for (const key of Object.keys(buildConfigs)) {
      const entry = buildConfigs[key];
      if (typeof entry !== 'object' || !entry.buildSettings) continue;
      const variant = iosVariants[entry.name];
      if (!variant) continue;

      entry.buildSettings.PRODUCT_BUNDLE_IDENTIFIER = variant.bundleId;
      entry.buildSettings.APP_DISPLAY_NAME = variant.displayName;
    }

    return cfg;
  });

  config = withInfoPlist(config, (cfg) => {
    cfg.modResults.CFBundleDisplayName = '$(APP_DISPLAY_NAME)';
    return cfg;
  });

  // ── Android ──────────────────────────────────────────────────────────────

  config = withAppBuildGradle(config, (cfg) => {
    // 在 release buildType 中覆盖 applicationId 为 .preview
    cfg.modResults.contents = cfg.modResults.contents.replace(
      /(\bbuildTypes\b[\s\S]*?\brelease\b\s*\{)/,
      `$1\n            applicationId 'app.saaskit.freecode.preview'`
    );
    return cfg;
  });

  return config;
};
