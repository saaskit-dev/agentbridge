/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = config => {
  const appBundleId = config.ios?.bundleIdentifier ?? 'app.saaskit.freecode';

  return {
    type: 'widget',
    name: 'FocusAudioWidget',
    displayName: 'Focus Audio',
    bundleIdentifier: '.focusaudio',
    deploymentTarget: '17.0',
    colors: {
      $accent: { color: '#1D4ED8', darkColor: '#60A5FA' },
      $widgetBackground: { color: '#F3F4F6', darkColor: '#111827' },
    },
    entitlements: {
      'com.apple.security.application-groups': [`group.${appBundleId}`],
    },
  };
};
