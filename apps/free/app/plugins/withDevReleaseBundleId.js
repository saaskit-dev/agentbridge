const { withXcodeProject, withInfoPlist } = require('@expo/config-plugins');

/**
 * 仅在 APP_ENV=development 时生效。
 * 同一次 prebuild 支持 Debug / Release 两套配置：
 *
 *   Debug   → app.saaskit.freecode.dev      "Free (dev)"
 *   Release → app.saaskit.freecode.preview  "Free (preview)"
 *
 * 实现方式：
 *   1. 在 xcodeproj 每个 build configuration 写入 PRODUCT_BUNDLE_IDENTIFIER 和 APP_DISPLAY_NAME
 *   2. 在 Info.plist 把 CFBundleDisplayName 改为 $(APP_DISPLAY_NAME)，让 Xcode 按 config 解析
 */
module.exports = (config) => {
  if (process.env.APP_ENV !== 'development') return config;

  const variants = {
    Debug:   { bundleId: '"app.saaskit.freecode.dev"',     displayName: '"Free (dev)"' },
    Release: { bundleId: '"app.saaskit.freecode.preview"', displayName: '"Free (preview)"' },
  };

  // Step 1: 写入 xcodeproj build settings
  config = withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const buildConfigs = project.pbxXCBuildConfigurationSection();

    for (const key of Object.keys(buildConfigs)) {
      const entry = buildConfigs[key];
      if (typeof entry !== 'object' || !entry.buildSettings) continue;
      const variant = variants[entry.name];
      if (!variant) continue;

      entry.buildSettings.PRODUCT_BUNDLE_IDENTIFIER = variant.bundleId;
      entry.buildSettings.APP_DISPLAY_NAME = variant.displayName;
    }

    return cfg;
  });

  // Step 2: Info.plist 用变量引用，让 Xcode 按 configuration 解析
  config = withInfoPlist(config, (cfg) => {
    cfg.modResults.CFBundleDisplayName = '$(APP_DISPLAY_NAME)';
    return cfg;
  });

  return config;
};
