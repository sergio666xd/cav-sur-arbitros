"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, getToken, setToken, type Me } from "./api";

type AuthState = {
  user: Me | null;
  loading: boolean;
  login: (token: string, user: Me) => void;
  logout: () => void;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      setUser(await api<Me>("/auth/me"));
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = (token: string, me: Me) => {
    setToken(token);
    setUser(me);
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    window.location.href = "/login";
  };

  return <AuthContext.Provider value={{ user, loading, login, logout, refresh }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth fuera de AuthProvider");
  return ctx;
}

export function homeFor(user: Me): string {
  if (user.perm_availability) return "/disponibilidad";
  if (user.perm_admin) return "/admin/torneos";
  return "/ranking";
}
