export type Me = {
  id: number;
  first_name: string;
  last_name: string;
  document: string;
  whatsapp: string | null;
  is_referee: boolean;
  is_admin: boolean;
  is_chief: boolean;
  active: boolean;
  perm_admin: boolean;
  perm_create_tournaments: boolean;
  perm_availability: boolean;
  perm_chief: boolean;
};

const TOKEN_KEY = "cav_token";

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* almacenamiento no disponible */
  }
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function errorMessage(body: unknown, status: number): string {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail) && detail.length) {
      // Errores de validación de FastAPI/Pydantic
      return detail
        .map((d: { msg?: string }) => (d.msg ?? "").replace(/^Value error, /, ""))
        .filter(Boolean)
        .join(" ");
    }
  }
  return status >= 500 ? "Error del servidor. Intenta de nuevo." : "No se pudo completar la acción.";
}

export async function api<T = unknown>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`/api${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    if (res.status === 401 && token) {
      setToken(null);
      if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
        window.location.href = "/login";
      }
    }
    throw new ApiError(res.status, errorMessage(data, res.status));
  }
  return data as T;
}

// ---------- Formatos ----------
export function parseDate(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Fecha de hoy (local) como AAAA-MM-DD.
export function todayIso(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Todas las fechas se muestran como DD/MM/AAAA (estándar de Colombia).
export function dmy(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function weekday(d: Date, style: "long" | "short"): string {
  return cap(d.toLocaleDateString("es-CO", { weekday: style }).replace(".", ""));
}

// Fecha larga "Viernes 23 de octubre, 2026", o solo "23/10/2026" sin el día de la semana.
export function formatDate(iso: string, withWeekday = true): string {
  const d = parseDate(iso);
  if (!withWeekday) return dmy(d);
  const month = d.toLocaleDateString("es-CO", { month: "long" });
  return `${weekday(d, "long")} ${String(d.getDate()).padStart(2, "0")} de ${month}, ${d.getFullYear()}`;
}

// "Vie 23/10/2026"
export function formatShortDate(iso: string): string {
  const d = parseDate(iso);
  return `${weekday(d, "short")} ${dmy(d)}`;
}

// "HH:MM" en formato de 12 horas: "7:00 a. m.".
export function formatClock(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "a. m." : "p. m."}`;
}

// "las 7:00 a. m." o "la 1:00 p. m.".
export function atClock(hhmm: string): string {
  return `${Number(hhmm.split(":")[0]) % 12 === 1 ? "la" : "las"} ${formatClock(hhmm)}`;
}

export function formatTime(d: Date): string {
  return d.toLocaleTimeString("es-CO", { hour: "numeric", minute: "2-digit" });
}

export function formatDateTime(iso: string): string {
  // El backend guarda en UTC sin zona.
  const d = new Date(iso.endsWith("Z") ? iso : iso + "Z");
  return `${dmy(d)} ${formatTime(d)}`;
}
