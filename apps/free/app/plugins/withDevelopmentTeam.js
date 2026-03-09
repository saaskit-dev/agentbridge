const { withXcodeProject } = require('@expo/config-plugins');

/**
 * 在 prebuild 后自动写入 DEVELOPMENT_TEAM 和 PRODUCT_BUNDLE_IDENTIFIER，
 * 避免每次 expo prebuild 后丢失签名设置。
 *
 * Bundle Identifier 按 Xcode configuration 区分：
 *   Debug   → app.saaskit.freecode.dev
 *   Release → app.saaskit.freecode.preview
 *
 * Team ID 通过 APPLE_TEAM_ID 环境变量注入，fallback 到 hardcode 默认值。
 */
const BUNDLE_ID_BY_CONFIG = {
  Debug: 'app.saaskit.freecode.dev',
  Release: 'app.saaskit.freecode.preview',
};

const withDevelopmentTeam = (config) => {
  return withXcodeProject(config, (config) => {
    const teamId = process.env.APPLE_TEAM_ID || 'SD58V5WA54';
    const project = config.modResults;
    const buildConfigSection = project.pbxXCBuildConfigurationSection();

    const targets = project.pbxNativeTargetSection();
    for (const key of Object.keys(targets)) {
      if (key.endsWith('_comment')) continue;
      const target = targets[key];
      if (!target.buildConfigurationList) continue;

      const configList = project.pbxXCConfigurationList()[target.buildConfigurationList];
      if (!configList) continue;

      for (const buildConfig of configList.buildConfigurations) {
        const configId = buildConfig.value;
        const entry = buildConfigSection[configId];
        if (!entry?.buildSettings) continue;

        // 配置名称（Debug / Release）
        const configName =
          buildConfigSection[`${configId}_comment`] || buildConfig.comment || '';

        entry.buildSettings.DEVELOPMENT_TEAM = teamId;
        entry.buildSettings.CODE_SIGN_STYLE = 'Automatic';

        const bundleId = BUNDLE_ID_BY_CONFIG[configName];
        if (bundleId) {
          entry.buildSettings.PRODUCT_BUNDLE_IDENTIFIER = bundleId;
        }
      }
    }

    return config;
  });
};

module.exports = withDevelopmentTeam;
