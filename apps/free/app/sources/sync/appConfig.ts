import Constants from 'expo-constants';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';

const logger = new Logger('app/sync/appConfig');

export interface AppConfig {
  postHogKey?: string;
  revenueCatAppleKey?: string;
  revenueCatGoogleKey?: string;
  revenueCatStripeKey?: string;
  elevenLabsAgentIdDev?: string;
  elevenLabsAgentIdProd?: string;
}

/**
 * Loads app configuration from various manifest sources.
 * Looks for the "app" field in expoConfig.extra across different manifests
 * and merges them into a single configuration object.
 *
 * Priority (later overrides earlier):
 * 1. ExponentConstants native module manifest (fetches embedded manifest)
 * 2. Constants.expoConfig
 */
export function loadAppConfig(): AppConfig {
  const config: Partial<AppConfig> = {};

  try {
    // 1. Try ExponentConstants native module directly
    const ExponentConstants = requireOptionalNativeModule('ExponentConstants');
    if (ExponentConstants && ExponentConstants.manifest) {
      let exponentManifest = ExponentConstants.manifest;

      // On Android, manifest is passed as JSON string
      if (typeof exponentManifest === 'string') {
        try {
          exponentManifest = JSON.parse(exponentManifest);
        } catch (e) {
          logger.warn('[loadAppConfig] Failed to parse ExponentConstants.manifest:', e);
        }
      }

      // Look for app config in various locations
      const appConfig = exponentManifest?.extra?.app;
      if (appConfig && typeof appConfig === 'object') {
        Object.assign(config, appConfig);
        logger.debug('[loadAppConfig] Loaded from ExponentConstants:', Object.keys(config));
      }
    }
  } catch (e) {
    logger.warn('[loadAppConfig] Error accessing ExponentConstants:', e);
  }

  try {
    // 2. Try Constants.expoConfig
    if (Constants.expoConfig?.extra?.app) {
      const appConfig = Constants.expoConfig.extra.app;
      if (typeof appConfig === 'object') {
        Object.assign(config, appConfig);
        logger.debug('[loadAppConfig] Loaded from Constants.expoConfig:', Object.keys(config));
      }
    }
  } catch (e) {
    logger.warn('[loadAppConfig] Error accessing Constants.expoConfig:', e);
  }

  logger.debug('[loadAppConfig] Final merged config:', JSON.stringify(config, null, 2));

  // Override with EXPO_PUBLIC_* env vars if present at runtime and different
  // Why: Native config is baked at prebuild time, but EXPO_PUBLIC_* vars
  // are available at runtime via process.env. This allows devs to change
  // keys without rebuilding native code.
  if (
    process.env.EXPO_PUBLIC_REVENUE_CAT_APPLE &&
    config.revenueCatAppleKey !== process.env.EXPO_PUBLIC_REVENUE_CAT_APPLE
  ) {
    logger.debug('[loadAppConfig] Override revenueCatAppleKey from EXPO_PUBLIC_REVENUE_CAT_APPLE');
    config.revenueCatAppleKey = process.env.EXPO_PUBLIC_REVENUE_CAT_APPLE;
  }
  if (
    process.env.EXPO_PUBLIC_REVENUE_CAT_GOOGLE &&
    config.revenueCatGoogleKey !== process.env.EXPO_PUBLIC_REVENUE_CAT_GOOGLE
  ) {
    logger.debug('[loadAppConfig] Override revenueCatGoogleKey from EXPO_PUBLIC_REVENUE_CAT_GOOGLE');
    config.revenueCatGoogleKey = process.env.EXPO_PUBLIC_REVENUE_CAT_GOOGLE;
  }
  if (
    process.env.EXPO_PUBLIC_REVENUE_CAT_STRIPE &&
    config.revenueCatStripeKey !== process.env.EXPO_PUBLIC_REVENUE_CAT_STRIPE
  ) {
    logger.debug('[loadAppConfig] Override revenueCatStripeKey from EXPO_PUBLIC_REVENUE_CAT_STRIPE');
    config.revenueCatStripeKey = process.env.EXPO_PUBLIC_REVENUE_CAT_STRIPE;
  }
  if (
    process.env.EXPO_PUBLIC_POSTHOG_KEY &&
    config.postHogKey !== process.env.EXPO_PUBLIC_POSTHOG_KEY
  ) {
    logger.debug('[loadAppConfig] Override postHogKey from EXPO_PUBLIC_POSTHOG_KEY');
    config.postHogKey = process.env.EXPO_PUBLIC_POSTHOG_KEY;
  }
  if (
    process.env.EXPO_PUBLIC_ELEVENLABS_AGENT_ID_DEV &&
    config.elevenLabsAgentIdDev !== process.env.EXPO_PUBLIC_ELEVENLABS_AGENT_ID_DEV
  ) {
    logger.debug(
      '[loadAppConfig] Override elevenLabsAgentIdDev from EXPO_PUBLIC_ELEVENLABS_AGENT_ID_DEV'
    );
    config.elevenLabsAgentIdDev = process.env.EXPO_PUBLIC_ELEVENLABS_AGENT_ID_DEV;
  }
  if (
    process.env.EXPO_PUBLIC_ELEVENLABS_AGENT_ID_PROD &&
    config.elevenLabsAgentIdProd !== process.env.EXPO_PUBLIC_ELEVENLABS_AGENT_ID_PROD
  ) {
    logger.debug(
      '[loadAppConfig] Override elevenLabsAgentIdProd from EXPO_PUBLIC_ELEVENLABS_AGENT_ID_PROD'
    );
    config.elevenLabsAgentIdProd = process.env.EXPO_PUBLIC_ELEVENLABS_AGENT_ID_PROD;
  }
  return config as AppConfig;
}
