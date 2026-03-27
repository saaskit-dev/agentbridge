const { version } = require('./package.json');
const os = require('os');

// 两个变体：
//
//   development   本地开发   .dev bundleId   debug 签名   连局域网 dev server
//   production    线上+公测  app.saaskit.freecode          App Store / TestFlight
const variant = process.env.APP_ENV || 'development';

const PRODUCTION_SERVER_URL = 'https://free-server.saaskit.app';

/** 自动发现本机局域网 IP，优先使用 REACT_NATIVE_PACKAGER_HOSTNAME（由 ./run 统一设置） */
function getLanIp() {
  if (process.env.REACT_NATIVE_PACKAGER_HOSTNAME) {
    return process.env.REACT_NATIVE_PACKAGER_HOSTNAME;
  }
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address;
    }
  }
  return 'localhost';
}

const configs = {
  development: {
    name: 'Free (dev)',
    bundleId: 'app.saaskit.freecode.dev',
    serverUrl: process.env.EXPO_PUBLIC_FREE_SERVER_URL || `http://${getLanIp()}:3000`,
    googleServicesFile:
      process.env.GOOGLE_SERVICES_PLIST || './firebase/GoogleService-Info.development.plist',
  },
  production: {
    name: 'Free',
    bundleId: 'app.saaskit.freecode',
    serverUrl: PRODUCTION_SERVER_URL,
    googleServicesFile: process.env.GOOGLE_SERVICES_PLIST,
  },
};

const config = configs[variant] || configs.development;
const { name, bundleId, serverUrl, googleServicesFile } = config;

export default {
  expo: {
    name,
    slug: 'free',
    version,
    runtimeVersion: { policy: 'fingerprint' },
    orientation: 'default',
    icon: './sources/assets/images/icon.png',
    scheme: 'free',
    userInterfaceStyle: 'automatic',
    newArchEnabled: true,
    notification: {
      icon: './sources/assets/images/icon-notification.png',
      iosDisplayInForeground: true,
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: bundleId,
      appleTeamId: process.env.APPLE_TEAM_ID || 'SD58V5WA54',
      config: {
        usesNonExemptEncryption: false,
      },
      infoPlist: {
        LSApplicationCategoryType: 'public.app-category.developer-tools',
        NSPhotoLibraryUsageDescription:
          'Allow $(PRODUCT_NAME) to attach images to your messages.',
        NSMicrophoneUsageDescription:
          'Allow $(PRODUCT_NAME) to access your microphone for voice conversations with AI.',
        NSLocalNetworkUsageDescription:
          'Allow $(PRODUCT_NAME) to find and connect to local devices on your network.',
        NSBonjourServices: ['_http._tcp', '_https._tcp'],
        // Dev: allow HTTP to LAN IPs (ATS blocks non-localhost HTTP by default)
        ...(variant === 'development' && {
          NSAppTransportSecurity: {
            NSAllowsArbitraryLoads: true,
            NSAllowsLocalNetworking: true,
          },
        }),
      },
      googleServicesFile,
      associatedDomains: variant !== 'development' ? ['applinks:free-server.saaskit.app'] : [],
    },
    android: {
      adaptiveIcon: {
        foregroundImage: './sources/assets/images/icon-adaptive.png',
        monochromeImage: './sources/assets/images/icon-monochrome.png',
        backgroundColor: '#18171C',
      },
      permissions: [
        'android.permission.RECORD_AUDIO',
        'android.permission.MODIFY_AUDIO_SETTINGS',
        'android.permission.ACCESS_NETWORK_STATE',
        'android.permission.POST_NOTIFICATIONS',
      ],
      blockedPermissions: ['android.permission.ACTIVITY_RECOGNITION'],
      edgeToEdgeEnabled: true,
      package: bundleId,
      googleServicesFile: process.env.GOOGLE_SERVICES_JSON || './firebase/google-services.json',
      intentFilters:
        variant !== 'development'
          ? [
              {
                action: 'VIEW',
                autoVerify: true,
                data: [
                  {
                    scheme: 'https',
                    host: 'free-server.saaskit.app',
                    pathPrefix: '/',
                  },
                ],
                category: ['BROWSABLE', 'DEFAULT'],
              },
            ]
          : [],
    },
    web: {
      bundler: 'metro',
      output: 'single',
      favicon: './sources/assets/images/favicon.png',
    },
    plugins: [
      require('./plugins/withVersionSync.js'), // 自动同步版本到原生项目
      require('./plugins/withDevelopmentTeam.js'), // 自动写入 DEVELOPMENT_TEAM，防止 prebuild 后丢失
      require('./plugins/withXcodeDefaults.js'), // Scheme Run→Release + App Category→Developer Tools
      require('./plugins/withPushNotificationEntitlements.js'), // 自动配置推送 entitlements
      require('./plugins/withEinkCompatibility.js'),
      // '@bacons/apple-targets', // watchOS app target (targets/watch/) — 暂未配置 Watch 签名，跳过
      require('./plugins/withSourceBuildRN.js'),
      require('./plugins/withFmtConsteval.js'),
      [
        'expo-router',
        {
          root: './sources/app',
        },
      ],
      'expo-updates',
      'expo-asset',
      'expo-localization',
      'expo-mail-composer',
      'expo-secure-store',
      'expo-sqlite',
      'expo-web-browser',
      'react-native-vision-camera',
      '@more-tech/react-native-libsodium',
      'react-native-audio-api',
      '@livekit/react-native-expo-plugin',
      '@config-plugins/react-native-webrtc',
      [
        'expo-audio',
        {
          microphonePermission:
            'Allow $(PRODUCT_NAME) to access your microphone for voice conversations.',
        },
      ],
      [
        'expo-location',
        {
          locationAlwaysAndWhenInUsePermission:
            'Allow $(PRODUCT_NAME) to improve AI quality by using your location.',
          locationAlwaysPermission:
            'Allow $(PRODUCT_NAME) to improve AI quality by using your location.',
          locationWhenInUsePermission:
            'Allow $(PRODUCT_NAME) to improve AI quality by using your location.',
        },
      ],
      [
        'expo-calendar',
        {
          calendarPermission:
            'Allow $(PRODUCT_NAME) to access your calendar to improve AI quality.',
        },
      ],
      [
        'expo-camera',
        {
          cameraPermission:
            'Allow $(PRODUCT_NAME) to access your camera to scan QR codes and share photos with AI.',
          microphonePermission:
            'Allow $(PRODUCT_NAME) to access your microphone for voice conversations.',
          recordAudioAndroid: true,
        },
      ],
      [
        'expo-notifications',
        {
          enableBackgroundRemoteNotifications: true,
        },
      ],
      [
        'expo-splash-screen',
        {
          ios: {
            backgroundColor: '#F2F2F7',
            dark: {
              backgroundColor: '#1C1C1E',
            },
          },
          android: {
            image: './sources/assets/images/splash-android-light.png',
            backgroundColor: '#F5F5F5',
            dark: {
              image: './sources/assets/images/splash-android-dark.png',
              backgroundColor: '#1e1e1e',
            },
          },
        },
      ],
    ],
    updates: {
      url: 'https://u.expo.dev/79f0465e-eaa6-47f9-91e0-09e5a5661790',
    },
    experiments: {
      typedRoutes: true,
    },
    extra: {
      router: {
        root: './sources/app',
      },
      eas: {
        projectId: '79f0465e-eaa6-47f9-91e0-09e5a5661790',
      },
      app: {
        isDev: variant === 'development',
        serverUrl,
      },
    },
    owner: 'saaskit-dev',
  },
};
