"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, getToken, setToken, type Me } from "./api";
import { THEME_KEY } from "./theme";

type AuthState = {
  user: Me | null;
  loading: boolean;
  login: (token: string, user: Me) => void;
  logout: () => void;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

/** Color de la app según el rol: azul para el jefe (y el sistema), verde para administradores; naranja para el resto. */
function themeFor(u: Me | null): string | null {
  if (!u) return null;
  if (u.perm_chief) return "chief";
  if (u.perm_admin) return "admin";
  return null;
}

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

  useEffect(() => {
    if (loading) return;
    const theme = themeFor(user);
    const root = document.documentElement;
    if (theme) root.dataset.theme = theme;
    else delete root.dataset.theme;
    try {
      if (theme) localStorage.setItem(THEME_KEY, theme);
      else localStorage.removeItem(THEME_KEY);
    } catch {}
  }, [user, loading]);

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
