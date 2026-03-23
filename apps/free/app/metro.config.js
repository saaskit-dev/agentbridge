const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../../..');

const config = getDefaultConfig(__dirname, {
  // Enable CSS support for web
  isCSSEnabled: true,
});

// Monorepo: explicitly set projectRoot so Metro doesn't infer the workspace root
config.projectRoot = projectRoot;

// Watch workspace packages so Metro can resolve @saaskit-dev/agentbridge
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

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

// Fix packages that use Node ESM .js import convention (Metro can't resolve .js → .ts)
// - @noble/hashes: all imports from that namespace
// - @saaskit-dev/agentbridge relative imports: ONLY when originating from packages/core/src/
//   (scoped to avoid accidentally affecting npm packages like react-textarea-autosize
//    whose internal .js imports are real JS files, not TypeScript ESM)
const agentbridgeCorePattern = path.resolve(workspaceRoot, 'packages/core/src');
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.endsWith('.js')) {
    const isNoble = moduleName.startsWith('@noble/');
    const isCoreRelative =
      moduleName.startsWith('.') && context.originModulePath.startsWith(agentbridgeCorePattern);
    if (isNoble || isCoreRelative) {
      const strippedModule = moduleName.replace(/\.js$/, '');
      return context.resolveRequest(context, strippedModule, platform);
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};

// Bind Metro to LAN IP so physical devices can connect
if (process.env.REACT_NATIVE_PACKAGER_HOSTNAME) {
  config.server = {
    ...config.server,
    host: process.env.REACT_NATIVE_PACKAGER_HOSTNAME,
  };
}

module.exports = config;
