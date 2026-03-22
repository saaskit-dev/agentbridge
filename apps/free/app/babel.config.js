module.exports = function (api) {
  api.cache(true);

  // Determine which worklets plugin to use based on installed versions
  // Reanimated v4+ uses react-native-worklets/plugin
  // Reanimated v3.x uses react-native-reanimated/plugin
  let workletsPlugin = 'react-native-worklets/plugin';
  try {
    const reanimatedVersion = require('react-native-reanimated/package.json').version;
    const majorVersion = parseInt(reanimatedVersion.split('.')[0], 10);

    // For Reanimated v3.x, use the old plugin
    if (majorVersion < 4) {
      workletsPlugin = 'react-native-reanimated/plugin';
    }
  } catch (e) {
    // If reanimated isn't installed, default to newer plugin
    // This won't cause issues since the plugin won't be needed anyway
  }

  // Metro wraps all modules in CommonJS-style functions where import.meta
  // is invalid syntax at runtime. This plugin replaces import.meta with a
  // plain object so packages like wa-sqlite (which use import.meta.url to
  // locate their .wasm file) can be bundled without errors.
  const transformImportMeta = babel => ({
    visitor: {
      MetaProperty(path) {
        if (path.node.meta.name === 'import' && path.node.property.name === 'meta') {
          path.replaceWith(
            babel.types.objectExpression([
              babel.types.objectProperty(
                babel.types.identifier('url'),
                babel.types.stringLiteral('')
              ),
            ])
          );
        }
      },
    },
  });

  return {
    presets: ['babel-preset-expo'],
    env: {
      production: {
        plugins: ['transform-remove-console'],
      },
    },
    plugins: [
      transformImportMeta,
      ['react-native-unistyles/plugin', { root: 'sources' }],
      workletsPlugin, // Must be last - automatically selects correct plugin for version
    ],
  };
};
