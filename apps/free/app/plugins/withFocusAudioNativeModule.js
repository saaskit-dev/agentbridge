const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const POD_DECLARATION = "  pod 'FocusAudioNative', :path => '../modules/focus-audio-native/ios'\n";

const PROVIDER_PATCH = `
    expo_modules_provider = Dir.glob(
      File.join(installer.sandbox.root, 'Target Support Files', 'Pods-*', 'ExpoModulesProvider.swift')
    ).first
    if expo_modules_provider && File.exist?(expo_modules_provider)
      content = File.read(expo_modules_provider)
      patched = content
      unless patched.include?('import FocusAudioNative')
        patched = patched.sub("import ExpoModulesCore\\n", "import ExpoModulesCore\\nimport FocusAudioNative\\n")
      end
      patched = patched.gsub(
        "return [\\n      ExtensionStorageModule.self,",
        "return [\\n      FocusAudioNativeModule.self,\\n      ExtensionStorageModule.self,"
      )
      if content != patched
        File.write(expo_modules_provider, patched)
        puts '✅ Patched ExpoModulesProvider.swift to register FocusAudioNativeModule'
      end
    end`;

const withFocusAudioNativeModule = config =>
  withDangerousMod(config, [
    'ios',
    modConfig => {
      const podfilePath = path.join(modConfig.modRequest.platformProjectRoot, 'Podfile');

      if (!fs.existsSync(podfilePath)) {
        console.warn('⚠️ Podfile not found, skipping FocusAudioNative Pod integration');
        return modConfig;
      }

      let podfile = fs.readFileSync(podfilePath, 'utf8');

      if (!podfile.includes("pod 'FocusAudioNative'")) {
        podfile = podfile.replace('  use_expo_modules!\n', `  use_expo_modules!\n${POD_DECLARATION}`);
      }

      if (!podfile.includes('Patched ExpoModulesProvider.swift to register FocusAudioNativeModule')) {
        const postInstallEndPattern = /react_native_post_install\([\s\S]*?\n\s*\)/;
        const match = podfile.match(postInstallEndPattern);

        if (!match) {
          console.warn('⚠️ Could not find react_native_post_install block in Podfile');
          return modConfig;
        }

        const insertIndex = match.index + match[0].length;
        podfile = podfile.slice(0, insertIndex) + '\n' + PROVIDER_PATCH + podfile.slice(insertIndex);
      }

      fs.writeFileSync(podfilePath, podfile);
      console.log('✅ Ensured FocusAudioNative is integrated into Podfile');
      return modConfig;
    },
  ]);

module.exports = withFocusAudioNativeModule;
