import {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  useCallback,
  type ReactNode,
} from "react";
import { authApi, tokenStore, type User } from "./api";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Access tokens expire in 15 min; schedule silent refresh at 14 min
const REFRESH_INTERVAL_MS = 14 * 60 * 1000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Schedule a silent proactive token refresh
  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(async () => {
      const refreshToken = tokenStore.getRefresh();
      if (!refreshToken) return;
      try {
        const res = await authApi.refresh(refreshToken);
        const currentUser = tokenStore.getUser();
        if (currentUser) {
          tokenStore.set(res.access_token, res.refresh_token, currentUser);
          scheduleRefresh(); // schedule next refresh
        }
      } catch {
        // Refresh failed — the api layer will redirect to login on next 401
        setUser(null);
        tokenStore.clear();
      }
    }, REFRESH_INTERVAL_MS);
  }, []);

  // On mount: restore session from localStorage
  useEffect(() => {
    const storedUser = tokenStore.getUser();
    const accessToken = tokenStore.getAccess();
    const refreshToken = tokenStore.getRefresh();

    if (!accessToken || !refreshToken) {
      setLoading(false);
      return;
    }

    if (storedUser) {
      // Optimistically restore user from storage, then validate in background
      setUser(storedUser);
      setLoading(false);
      scheduleRefresh();

      // Validate token is still good against server
      authApi
        .me()
        .then((freshUser) => {
          setUser(freshUser);
          tokenStore.set(accessToken, refreshToken, freshUser);
        })
        .catch(() => {
          // me() failed — try to refresh, handled by api interceptor
          // If that also fails, user is cleared by redirectToLogin
          setUser(null);
          tokenStore.clear();
        });
    } else {
      setLoading(false);
    }

    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [scheduleRefresh]);

  const login = useCallback(
    async (username: string, password: string) => {
      const res = await authApi.login(username, password);
      tokenStore.set(res.access_token, res.refresh_token, res.user);
      setUser(res.user);
      scheduleRefresh();
    },
    [scheduleRefresh]
  );

  const logout = useCallback(async () => {
    const refreshToken = tokenStore.getRefresh();
    try {
      await authApi.logout(refreshToken ?? undefined);
    } catch {
      // Swallow logout errors — we clear locally regardless
    } finally {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      tokenStore.clear();
      setUser(null);
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
}
