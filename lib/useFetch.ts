"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";

// Cada cuánto se vuelve a pedir la información en segundo plano.
export const REFRESH_MS = 10_000;

/**
 * Carga `path` y lo mantiene al día: cada `refresh` ms lo vuelve a pedir en silencio (sin "cargando")
 * y solo cambia `data` si la respuesta es distinta, para no redibujar ni parpadear. Se detiene con
 * la pestaña oculta o mientras `paused`, y se actualiza al volver. `refresh: 0` lo desactiva.
 */
export function useFetch<T>(path: string | null, { refresh = REFRESH_MS, paused = false }: { refresh?: number; paused?: boolean } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Última respuesta (como texto) y número de carga: una actualización silenciosa que llega
  // después de una recarga (p. ej. tras guardar) no debe reemplazarla con datos viejos.
  const last = useRef("");
  const seq = useRef(0);
  const busy = useRef(false);

  const reload = useCallback(async () => {
    if (!path) return;
    const n = ++seq.current;
    setLoading(true);
    try {
      const result = await api<T>(path);
      if (n !== seq.current) return;
      last.current = JSON.stringify(result);
      setData(result);
      setError(null);
    } catch (e) {
      if (n === seq.current) setError((e as Error).message);
    } finally {
      if (n === seq.current) setLoading(false);
    }
  }, [path]);

  const refreshNow = useCallback(async () => {
    if (!path || busy.current || document.hidden) return;
    const n = seq.current;
    busy.current = true;
    try {
      const result = await api<T>(path);
      const text = JSON.stringify(result);
      if (n !== seq.current || text === last.current) return;
      last.current = text;
      setData(result);
      setError(null);
    } catch {
      // Sin conexión u otro fallo pasajero: se deja lo que ya se ve.
    } finally {
      busy.current = false;
    }
  }, [path]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (!refresh || paused) return;
    const timer = setInterval(refreshNow, refresh);
    const onVisible = () => { if (!document.hidden) refreshNow(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [refresh, paused, refreshNow]);

  return { data, error, loading, reload, setData };
}
