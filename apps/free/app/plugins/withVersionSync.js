const { withInfoPlist, withGradleProperties } = require('@expo/config-plugins');

/**
 * 自动同步版本号到原生项目
 * 无需手动删除 ios/android 目录
 *
 * 使用方法:
 * 1. 修改 app.config.js 中的 version
 * 2. 运行 expo prebuild 或 eas build
 * 3. 版本自动同步到 iOS/Android 原生项目
 */
const withVersionSync = config => {
  const version = config.version || '0.0.1';
  const buildNumber = config.ios?.buildNumber || '1';

  // 同步 iOS 版本 (直接修改 Info.plist)
  config = withInfoPlist(config, config => {
    config.modResults.CFBundleShortVersionString = version;
    config.modResults.CFBundleVersion = buildNumber;
    return config;
  });

  // 同步 Android 版本 (通过 gradle.properties)
  config = withGradleProperties(config, config => {
    // 查找或添加 versionName
    const versionNameIndex = config.modResults.findIndex(
      item => item.type === 'property' && item.key === 'versionName'
    );

    if (versionNameIndex >= 0) {
      config.modResults[versionNameIndex].value = version;
    } else {
      config.modResults.push({
        type: 'property',
        key: 'versionName',
        value: version,
      });
    }

    // 查找或添加 versionCode
    const versionCodeIndex = config.modResults.findIndex(
      item => item.type === 'property' && item.key === 'versionCode'
    );

    if (versionCodeIndex >= 0) {
      config.modResults[versionCodeIndex].value = buildNumber;
    } else {
      config.modResults.push({
        type: 'property',
        key: 'versionCode',
        value: buildNumber,
      });
    }

    return config;
  });

  return config;
};

module.exports = withVersionSync;
