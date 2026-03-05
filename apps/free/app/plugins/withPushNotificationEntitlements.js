const { withEntitlementsPlist } = require('@expo/config-plugins');

/**
 * 根据 APP_ENV 环境变量自动配置 iOS Push Notification entitlements
 * - development: aps-environment = development
 * - preview/production: aps-environment = production
 */
const withPushNotificationEntitlements = (config) => {
  const variant = process.env.APP_ENV || 'development';

  // 根据环境设置 aps-environment
  // development: 开发推送环境
  // preview/production: 生产推送环境
  const apsEnvironment = variant === 'development' ? 'development' : 'production';

  config = withEntitlementsPlist(config, (config) => {
    config.modResults['aps-environment'] = apsEnvironment;
    return config;
  });

  return config;
};

module.exports = withPushNotificationEntitlements;
