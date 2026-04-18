const { withInfoPlist, withGradleProperties } = require('expo/config-plugins');

/**
 * 自动同步版本号到原生项目
 * 无需手动删除 ios/android 目录
 *
 * 使用方法:
 * 1. 修改 app.config.js 中的 version
 * 2. 运行 expo prebuild 或 self-hosted iOS release 脚本
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
    const upsertProperty = (key, value) => {
      const index = config.modResults.findIndex(item => item.type === 'property' && item.key === key);
      if (index >= 0) {
        config.modResults[index].value = value;
      } else {
        config.modResults.push({
          type: 'property',
          key,
          value,
        });
      }
    };

    // 查找或添加 versionName
    upsertProperty('versionName', version);

    // 查找或添加 versionCode
    upsertProperty('versionCode', buildNumber);
    upsertProperty('org.gradle.jvmargs', '-Xmx4096m -XX:MaxMetaspaceSize=1024m -Dfile.encoding=UTF-8');
    upsertProperty('org.gradle.parallel', 'false');
    upsertProperty('org.gradle.workers.max', '2');
    upsertProperty('kotlin.daemon.jvmargs', '-Xmx2048m');

    return config;
  });

  return config;
};

module.exports = withVersionSync;
