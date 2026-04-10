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
}

export const SessionContext = createContext<SessionContextValue>({
  session: null,
  loading: false,
  initializing: true,
  error: null,
  login: async () => {},
  logout: () => {},
});

export function useSession() {
  return useContext(SessionContext);
}

export function useSessionProvider(): SessionContextValue {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSession = useCallback(async (email: string) => {
    // Check if auth cookie is still valid by hitting a protected route
    const authCheck = await fetch("/api/session/balances?sessionId=check", {
      method: "GET",
    });
    if (authCheck.status === 401) {
      // Cookie expired — clear localStorage, user must re-login
      localStorage.removeItem("xls66-email");
      return;
    }

    const res = await fetch(`/api/session?email=${encodeURIComponent(email)}`);
    if (res.ok) {
      const data = await res.json();
      setSession(data.session);
    }
  }, []);

  useEffect(() => {
    const email = localStorage.getItem("xls66-email");
    if (email) {
      fetchSession(email).finally(() => setInitializing(false));
    } else {
      setInitializing(false);
    }
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

  return { session, loading, initializing, error, login, logout };
}
