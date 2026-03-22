const { withDangerousMod } = require('@expo/config-plugins');
const path = require('path');
const fs = require('fs');

/**
 * Config plugin to fix fmt library consteval errors on Xcode 26+ (Beta).
 *
 * Root cause: Xcode 26 beta's Apple Clang declares __cpp_consteval but the
 * implementation is broken for fmt 11.x's consteval format string validation.
 * fmt/base.h enables consteval for __apple_build_version__ >= 14000029L via
 * __cpp_consteval, but the check has no upper bound for buggy beta compilers.
 *
 * Fix: In the post_install hook, patch fmt/base.h to disable consteval for
 * ALL Apple Clang builds by removing the upper-bound version restriction.
 * GCC_PREPROCESSOR_DEFINITIONS/-D flag does NOT work because base.h's
 * #define FMT_USE_CONSTEVAL overrides any compiler-defined value (no #ifndef guard).
 */
const withFmtConsteval = config => {
  return withDangerousMod(config, [
    'ios',
    modConfig => {
      const podfilePath = path.join(modConfig.modRequest.platformProjectRoot, 'Podfile');

      if (!fs.existsSync(podfilePath)) {
        console.warn('⚠️ Podfile not found, skipping fmt consteval fix');
        return modConfig;
      }

      let podfile = fs.readFileSync(podfilePath, 'utf-8');

      const fmtFix = `
    # Workaround: Xcode 26 beta's Apple Clang has a consteval bug with fmt 11.x.
    # GCC_PREPROCESSOR_DEFINITIONS won't work because base.h #define overrides it.
    # Directly patch base.h to disable consteval for all Apple Clang builds.
    fmt_base_h = File.join(installer.sandbox.root, 'fmt/include/fmt/base.h')
    if File.exist?(fmt_base_h)
      content = File.read(fmt_base_h)
      patched = content.gsub(
        '#elif defined(__apple_build_version__) && __apple_build_version__ < 14000029L',
        '#elif defined(__apple_build_version__) // FMT_XCODE26_PATCH: disable consteval for all Apple Clang'
      )
      if content != patched
        File.write(fmt_base_h, patched)
        puts '✅ Patched fmt/base.h to disable consteval for Apple Clang (Xcode 26 beta workaround)'
      end
    end`;

      // Don't add if already present
      if (podfile.includes('FMT_XCODE26_PATCH')) {
        return modConfig;
      }

      // Remove old GCC_PREPROCESSOR_DEFINITIONS approach if present
      if (podfile.includes('FMT_USE_CONSTEVAL')) {
        podfile = podfile.replace(
          /\n\s*# Workaround: Xcode 26 beta[\s\S]*?FMT_USE_CONSTEVAL=0'\n\s*end\n\s*end\n\s*end/,
          ''
        );
      }

      // Insert after react_native_post_install call inside post_install block
      const postInstallEndPattern = /react_native_post_install\([\s\S]*?\n\s*\)/;
      const match = podfile.match(postInstallEndPattern);

      if (match) {
        const insertIndex = match.index + match[0].length;
        podfile = podfile.slice(0, insertIndex) + '\n' + fmtFix + podfile.slice(insertIndex);

        fs.writeFileSync(podfilePath, podfile);
        console.log('✅ Added fmt consteval workaround to Podfile (base.h patch approach)');
      } else {
        console.warn('⚠️ Could not find post_install hook in Podfile');
      }

      return modConfig;
    },
  ]);
};

module.exports = withFmtConsteval;
