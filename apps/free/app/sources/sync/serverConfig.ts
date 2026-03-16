import Constants from 'expo-constants';
import { MMKV } from 'react-native-mmkv';

// Separate MMKV instance for server config that persists across logouts
const serverConfigStorage = new MMKV({ id: 'server-config' });

const SERVER_KEY = 'custom-server-url';
const PRODUCTION_SERVER_URL = 'https://free-server.saaskit.app';

// __DEV__ 由 React Native 运行时注入：debug build = true, release build = false
// debug 时优先用 app.config.js 烘焙的局域网 IP 地址，release 时直接用生产 URL
const DEFAULT_SERVER_URL: string = __DEV__
  ? (Constants.expoConfig?.extra?.app?.serverUrl ?? PRODUCTION_SERVER_URL)
  : PRODUCTION_SERVER_URL;

export function getServerUrl(): string {
  return serverConfigStorage.getString(SERVER_KEY) || DEFAULT_SERVER_URL;
}

export function setServerUrl(url: string | null): void {
  if (url && url.trim()) {
    serverConfigStorage.set(SERVER_KEY, url.trim());
  } else {
    serverConfigStorage.delete(SERVER_KEY);
  }
}

export function isUsingCustomServer(): boolean {
  return serverConfigStorage.getString(SERVER_KEY) !== undefined;
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
