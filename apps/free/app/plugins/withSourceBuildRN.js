const { withDangerousMod } = require('@expo/config-plugins');
const path = require('path');
const fs = require('fs');

/**
 * Config plugin to ensure React Native is built from source.
 *
 * This is needed for Xcode 26+ (Beta) where prebuilt React Native XCFrameworks
 * have header naming mismatches (React-Core-umbrella.h vs React_Core-umbrella.h).
 * Building from source resolves this issue.
 *
 * It modifies ios/Podfile.properties.json to set:
 *   "ios.buildReactNativeFromSource": "true"
 */
const withSourceBuildRN = config => {
  return withDangerousMod(config, [
    'ios',
    modConfig => {
      const iosDir = path.join(modConfig.modRequest.platformProjectRoot);
      const propsPath = path.join(iosDir, 'Podfile.properties.json');

      let props = {};
      if (fs.existsSync(propsPath)) {
        props = JSON.parse(fs.readFileSync(propsPath, 'utf-8'));
      }

      if (props['ios.buildReactNativeFromSource'] !== 'true') {
        props['ios.buildReactNativeFromSource'] = 'true';
        fs.writeFileSync(propsPath, JSON.stringify(props, null, 2) + '\n');
        console.log('✅ Set ios.buildReactNativeFromSource=true in Podfile.properties.json');
      }

      return modConfig;
    },
  ]);
};

module.exports = withSourceBuildRN;
