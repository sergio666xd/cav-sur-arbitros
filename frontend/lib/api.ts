export type Me = {
  id: number;
  first_name: string;
  last_name: string;
  document: string;
  is_referee: boolean;
  is_admin: boolean;
  can_create_tournaments: boolean;
  is_chief: boolean;
  active: boolean;
  perm_admin: boolean;
  perm_create_tournaments: boolean;
  perm_availability: boolean;
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

export function formatDate(iso: string, opts: Intl.DateTimeFormatOptions = {}): string {
  return cap(parseDate(iso).toLocaleDateString("es-CO", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    ...opts,
  }));
}

export function formatShortDate(iso: string): string {
  return cap(parseDate(iso).toLocaleDateString("es-CO", { weekday: "short", day: "numeric", month: "short" }));
}

export function formatDateTime(iso: string): string {
  // El backend guarda en UTC sin zona.
  const d = new Date(iso.endsWith("Z") ? iso : iso + "Z");
  return d.toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" });
}
