import Constants from 'expo-constants';
import { serverConfigStore } from './cachedKVStore';

const SERVER_KEY = 'custom-server-url';
const PRODUCTION_SERVER_URL = 'https://free-server.saaskit.app';

// __DEV__ 由 React Native 运行时注入：debug build = true, release build = false
// debug 时优先用 app.config.js 烘焙的局域网 IP 地址，release 时直接用生产 URL
const DEFAULT_SERVER_URL: string = __DEV__
  ? (Constants.expoConfig?.extra?.app?.serverUrl ?? PRODUCTION_SERVER_URL)
  : PRODUCTION_SERVER_URL;

function getDevWebServerUrlFromLocation(): string | null {
  if (!__DEV__ || typeof window === 'undefined') {
    return null;
  }

  try {
    const { protocol, hostname, port } = window.location;
    if ((protocol === 'http:' || protocol === 'https:') && port === '8081') {
      return `${protocol}//${hostname}:3000`;
    }
  } catch {
    // Ignore and fall back to other resolution paths.
  }

  return null;
}

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

function getStoredCustomServerUrl(): string | undefined {
  const url = serverConfigStore.getString(SERVER_KEY);
  return url ? normalizeUrl(url) : undefined;
}

function isProductionServerUrl(url: string | undefined): boolean {
  if (!url) return false;

  try {
    return new URL(normalizeUrl(url)).origin === new URL(PRODUCTION_SERVER_URL).origin;
  } catch {
    return false;
  }
}

export function isIgnoringProductionCustomServerInDev(): boolean {
  return __DEV__ && isProductionServerUrl(getStoredCustomServerUrl());
}

export function getServerUrl(): string {
  const devWebServerUrl = getDevWebServerUrlFromLocation();
  if (devWebServerUrl) {
    return devWebServerUrl;
  }

  const customServerUrl = getStoredCustomServerUrl();
  if (!customServerUrl) {
    return DEFAULT_SERVER_URL;
  }

  if (isIgnoringProductionCustomServerInDev()) {
    return DEFAULT_SERVER_URL;
  }

  return customServerUrl;
}

export function setServerUrl(url: string | null): void {
  if (url && url.trim()) {
    serverConfigStore.set(SERVER_KEY, normalizeUrl(url));
  } else {
    serverConfigStore.delete(SERVER_KEY);
  }
}

export function isUsingCustomServer(): boolean {
  return getStoredCustomServerUrl() !== undefined && !isIgnoringProductionCustomServerInDev();
}

export function getServerInfo(): { hostname: string; port?: number; isCustom: boolean } {
  const url = getServerUrl();
  const isCustom = isUsingCustomServer();

  try {
    const parsed = new URL(url);
    const port = parsed.port ? parseInt(parsed.port) : undefined;
    return {
      hostname: parsed.hostname,
      port,
      isCustom,
    };
  } catch {
    // Fallback if URL parsing fails
    return {
      hostname: url,
      port: undefined,
      isCustom,
    };
  }
}

export function validateServerUrl(url: string): { valid: boolean; error?: string } {
  if (!url || !url.trim()) {
    return { valid: false, error: 'Server URL cannot be empty' };
  }

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { valid: false, error: 'Server URL must use HTTP or HTTPS protocol' };
    }
    return { valid: true };
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }
}
