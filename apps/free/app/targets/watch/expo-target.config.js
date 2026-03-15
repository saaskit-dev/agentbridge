/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => {
  // 从主 app bundleIdentifier 派生 watch bundleId：
  //   app.saaskit.freecode.dev     → app.saaskit.freecode.watch.dev
  //   app.saaskit.freecode.preview → app.saaskit.freecode.watch.preview
  //   app.saaskit.freecode         → app.saaskit.freecode.watch
  const appBundleId = config.ios?.bundleIdentifier ?? 'app.saaskit.freecode';
  const base = 'app.saaskit.freecode';
  const suffix = appBundleId.startsWith(base + '.') ? appBundleId.slice(base.length) : '';
  const watchBundleId = base + '.watch' + suffix;

  return {
    type: 'watch',
    name: 'FreeWatch',
    displayName: 'Free',
    bundleIdentifier: watchBundleId,
    deploymentTarget: '10.0',
    frameworks: ['SwiftUI', 'WatchConnectivity'],
    colors: {
      $accent: { color: '#5D95E4', darkColor: '#95BFFF' },
    },
    entitlements: {
      'com.apple.security.application-groups': [`group.${appBundleId}`],
    },
  };
};
