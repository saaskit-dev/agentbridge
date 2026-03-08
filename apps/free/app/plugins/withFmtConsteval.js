const { withDangerousMod } = require('@expo/config-plugins');
const path = require('path');
const fs = require('fs');

/**
 * Config plugin to fix fmt library consteval errors on Xcode 26+ (Beta).
 *
 * Xcode 26 beta's Apple Clang has a bug where consteval functions in
 * fmt 11.x fail with "Call to consteval function ... is not a constant
 * expression". This plugin injects a post_install hook into the Podfile
 * that force-defines FMT_USE_CONSTEVAL=0 for the fmt pod target.
 */
const withFmtConsteval = config => {
  return withDangerousMod(config, [
    'ios',
    modConfig => {
      const podfilePath = path.join(
        modConfig.modRequest.platformProjectRoot,
        'Podfile'
      );

      if (!fs.existsSync(podfilePath)) {
        console.warn('⚠️ Podfile not found, skipping fmt consteval fix');
        return modConfig;
      }

      let podfile = fs.readFileSync(podfilePath, 'utf-8');

      const fmtFix = `
    # Workaround: Xcode 26 beta's Apple Clang has a consteval bug with fmt 11.x.
    # Force-disable consteval to avoid "not a constant expression" errors.
    installer.pods_project.targets.each do |target|
      if target.name == 'fmt'
        target.build_configurations.each do |bc|
          bc.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] ||= ['$(inherited)']
          bc.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] << 'FMT_USE_CONSTEVAL=0'
        end
      end
    end`;

      // Don't add if already present
      if (podfile.includes('FMT_USE_CONSTEVAL')) {
        return modConfig;
      }

      // Insert after react_native_post_install call inside post_install block
      const postInstallEndPattern = /react_native_post_install\([^)]*\)/s;
      const match = podfile.match(postInstallEndPattern);

      if (match) {
        const insertIndex = match.index + match[0].length;
        podfile =
          podfile.slice(0, insertIndex) + '\n' + fmtFix + podfile.slice(insertIndex);

        fs.writeFileSync(podfilePath, podfile);
        console.log('✅ Added fmt consteval workaround to Podfile');
      } else {
        console.warn('⚠️ Could not find post_install hook in Podfile');
      }

      return modConfig;
    },
  ]);
};

module.exports = withFmtConsteval;
