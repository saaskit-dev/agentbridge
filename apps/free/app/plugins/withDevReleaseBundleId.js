const { withXcodeProject } = require('@expo/config-plugins');

/**
 * 仅在 APP_ENV=development 时，将 Xcode Release 配置的 bundle ID 改为 preview 版本。
 * 这样同一次 prebuild 可以同时支持：
 *   Debug   → app.saaskit.freecode.dev      (热更新开发包)
 *   Release → app.saaskit.freecode.preview  (本地 Release 测试包)
 */
module.exports = (config) => {
  if (process.env.APP_ENV !== 'development') return config;

  return withXcodeProject(config, (config) => {
    const project = config.modResults;
    const buildConfigs = project.pbxXCBuildConfigurationSection();

    for (const key of Object.keys(buildConfigs)) {
      const entry = buildConfigs[key];
      if (typeof entry !== 'object' || !entry.buildSettings) continue;
      if (entry.name === 'Release' && entry.buildSettings.PRODUCT_BUNDLE_IDENTIFIER) {
        entry.buildSettings.PRODUCT_BUNDLE_IDENTIFIER = '"app.saaskit.freecode.preview"';
      }
    }

    return config;
  });
};
