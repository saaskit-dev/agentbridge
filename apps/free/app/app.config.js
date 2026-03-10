// 环境配置：
//   development           → Free (dev),     .dev bundleId, 连 localhost
//   development-preview   → Free (preview), .preview bundleId, 连生产 (内测分发)
//   production            → Free,           无后缀 bundleId, 连生产
const variant = process.env.APP_ENV || 'development';

const configs = {
  development: {
    name: 'Free (dev)',
    bundleId: 'app.saaskit.freecode.dev',
    googleServicesFile: './firebase/GoogleService-Info.development.plist',
  },
  'development-preview': {
    name: 'Free (preview)',
    bundleId: 'app.saaskit.freecode.preview',
    googleServicesFile: './firebase/GoogleService-Info.preview.plist',
  },
  production: {
    name: 'Free',
    bundleId: 'app.saaskit.freecode',
    googleServicesFile: './firebase/GoogleService-Info.production.plist',
  },
};

const config = configs[variant] || configs.development;
const { name, bundleId, googleServicesFile } = config;

export default {
  expo: {
    name,
    slug: 'free',
    version: '0.0.1',
    runtimeVersion: '18',
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
      config: {
        usesNonExemptEncryption: false,
      },
      infoPlist: {
        NSMicrophoneUsageDescription:
          'Allow $(PRODUCT_NAME) to access your microphone for voice conversations with AI.',
        NSLocalNetworkUsageDescription:
          'Allow $(PRODUCT_NAME) to find and connect to local devices on your network.',
        NSBonjourServices: ['_http._tcp', '_https._tcp'],
      },
      googleServicesFile,
      associatedDomains: variant === 'production' ? ['applinks:free-server.saaskit.app'] : [],
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
      googleServicesFile: './firebase/google-services.json',
      intentFilters:
        variant === 'production'
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
      require('./plugins/withPushNotificationEntitlements.js'), // 自动配置推送 entitlements
      require('./plugins/withEinkCompatibility.js'),
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
      // TODO: Configure your own Expo updates URL
      // Get from: https://expo.dev/accounts/[your-account]/projects/free
      // url: "https://u.expo.dev/YOUR_PROJECT_ID",
      requestHeaders: {
        'expo-channel-name': 'production',
      },
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
        postHogKey: process.env.EXPO_PUBLIC_POSTHOG_API_KEY,
        revenueCatAppleKey: process.env.EXPO_PUBLIC_REVENUE_CAT_APPLE,
        revenueCatGoogleKey: process.env.EXPO_PUBLIC_REVENUE_CAT_GOOGLE,
        revenueCatStripeKey: process.env.EXPO_PUBLIC_REVENUE_CAT_STRIPE,
      },
    },
    // TODO: Configure your own Expo account
    // Get from: https://expo.dev
    // owner: "your-expo-username"
  },
};
