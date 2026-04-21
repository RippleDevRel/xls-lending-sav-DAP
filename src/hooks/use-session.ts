"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import type { Session } from "@/types/session";

interface SessionContextValue {
  session: Session | null;
  loading: boolean;
  initializing: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshSession: () => Promise<void>;
}

export const SessionContext = createContext<SessionContextValue>({
  session: null,
  loading: false,
  initializing: true,
  error: null,
  login: async () => {},
  logout: () => {},
  refreshSession: async () => {},
});

export function useSession() {
  return useContext(SessionContext);
}

export function useSessionProvider(): SessionContextValue {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSession = useCallback(async () => {
    // /api/session/me is a lightweight cookie probe — no XRPL roundtrip.
    const res = await fetch("/api/session/me");
    if (res.status === 401) {
      localStorage.removeItem("xls66-email");
      return;
    }
    if (res.ok) {
      const data = await res.json();
      setSession(data.session);
    }
  }, []);

  useEffect(() => {
    fetchSession().finally(() => setInitializing(false));
  }, [fetchSession]);

  const login = useCallback(async (email: string, password: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create session");
      localStorage.setItem("xls66-email", email);
      setSession(data.session);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    await fetch("/api/session/logout", { method: "POST" });
    localStorage.removeItem("xls66-email");
    setSession(null);
  }, []);

  const refreshSession = useCallback(async () => {
    const res = await fetch("/api/session/me");
    if (res.ok) {
      const data = await res.json();
      setSession(data.session);
    }
  }, []);

  return { session, loading, initializing, error, login, logout, refreshSession };
}
