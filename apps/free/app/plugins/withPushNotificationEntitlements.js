const { withEntitlementsPlist } = require('@expo/config-plugins');

/**
 * 根据 APP_ENV 环境变量自动配置 iOS Push Notification entitlements
 * - development: aps-environment = development
 * - production: aps-environment = production
 */
const withPushNotificationEntitlements = config => {
  const variant = process.env.APP_ENV || 'development';
  const apsEnvironment = variant === 'development' ? 'development' : 'production';

  config = withEntitlementsPlist(config, config => {
    config.modResults['aps-environment'] = apsEnvironment;
    return config;
  });

  return config;
};

module.exports = withPushNotificationEntitlements;
