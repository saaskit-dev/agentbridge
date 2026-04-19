import * as Updates from 'expo-updates';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  ReactNode,
} from 'react';
import { Platform } from 'react-native';
import { TokenStorage, AuthCredentials } from '@/auth/tokenStorage';
import { clearPersistence } from '@/sync/persistence';
import { syncCreate } from '@/sync/sync';
import { setAnalyticsEnabled } from '@/appTelemetry';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';
const logger = new Logger('app/auth/AuthContext');

interface AuthContextType {
  isAuthenticated: boolean;
  credentials: AuthCredentials | null;
  login: (token: string, secret: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const AuthStatusContext = createContext<boolean>(false);

export function AuthProvider({
  children,
  initialCredentials,
}: {
  children: ReactNode;
  initialCredentials: AuthCredentials | null;
}) {
  const [isAuthenticated, setIsAuthenticated] = useState(!!initialCredentials);
  const [credentials, setCredentials] = useState<AuthCredentials | null>(initialCredentials);

  const login = useCallback(async (token: string, secret: string) => {
    const newCredentials: AuthCredentials = { token, secret };
    const success = await TokenStorage.setCredentials(newCredentials);
    if (success) {
      await syncCreate(newCredentials);
      // Enable RemoteSink telemetry after login
      setAnalyticsEnabled(true, token);
      setCredentials(newCredentials);
      setIsAuthenticated(true);
    } else {
      throw new Error('Failed to save credentials');
    }
  }, []);

  const logout = useCallback(async () => {
    // Disable RemoteSink telemetry on logout
    setAnalyticsEnabled(false);
    await clearPersistence();
    await TokenStorage.removeCredentials();

    // Update React state to ensure UI consistency
    setCredentials(null);
    setIsAuthenticated(false);

    if (Platform.OS === 'web') {
      window.location.reload();
    } else {
      try {
        await Updates.reloadAsync();
      } catch (error) {
        // In dev mode, reloadAsync will throw ERR_UPDATES_DISABLED
        logger.debug('Reload failed (expected in dev mode):', error);
      }
    }
  }, []);

  const authContextValue = useMemo<AuthContextType>(
    () => ({
      isAuthenticated,
      credentials,
      login,
      logout,
    }),
    [credentials, isAuthenticated, login, logout]
  );

  // Update global auth state when local state changes
  useEffect(() => {
    setCurrentAuth(credentials ? authContextValue : null);
  }, [authContextValue, credentials]);

  return (
    <AuthStatusContext.Provider value={isAuthenticated}>
      <AuthContext.Provider value={authContextValue}>{children}</AuthContext.Provider>
    </AuthStatusContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export function useIsAuthenticated() {
  return useContext(AuthStatusContext);
}

// Helper to get current auth state for non-React contexts
let currentAuthState: AuthContextType | null = null;

export function setCurrentAuth(auth: AuthContextType | null) {
  currentAuthState = auth;
}

export function getCurrentAuth(): AuthContextType | null {
  return currentAuthState;
}
