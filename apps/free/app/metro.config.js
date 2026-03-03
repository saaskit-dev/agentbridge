const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname, {
  // Enable CSS support for web
  isCSSEnabled: true,
});

// Add support for .wasm files (required by Skia for all platforms)
// Source: https://shopify.github.io/react-native-skia/docs/getting-started/installation/
config.resolver.assetExts.push('wasm');

// inlineRequires disabled to fix HMR
// See: https://github.com/facebook/metro/issues/768
config.transformer.getTransformOptions = async () => ({
  transform: {
    experimentalImportSupport: false,
    inlineRequires: false,
  },
});

// NOTE: Package Exports is enabled by default in Metro 0.82+
// Do NOT manually set unstable_enablePackageExports as it causes bugs
// See: https://github.com/facebook/metro/issues/1464

// Fix @noble/hashes and similar packages that import with .js extension
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith('@noble/') && moduleName.endsWith('.js')) {
    const strippedModule = moduleName.replace(/\.js$/, '');
    return context.resolveRequest(context, strippedModule, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
