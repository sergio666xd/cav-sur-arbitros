"use client";

import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Alert, Loading, PageHeader } from "@/components/ui";
import { api, formatDateTime } from "@/lib/api";
import { useFetch } from "@/lib/useFetch";

type Code = { code: string; created_at: string; expires_at: string; created_by: string; uses: number };

function remaining(expires: string, now: number) {
  const ms = new Date(expires + "Z").getTime() - now;
  if (ms <= 0) return "caducada";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h} h ${m} min`;
}

export default function CodePage() {
  const { data, loading, error, reload } = useFetch<Code | null>("/codes/active");
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  async function create() {
    setMsg(null);
    try {
      await api("/codes", { method: "POST" });
      await reload();
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  async function revoke() {
    if (!confirm("¿Revocar la clave vigente? Nadie más podrá registrarse con ella.")) return;
    await api("/codes/active", { method: "DELETE" });
    await reload();
  }

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* el navegador no permite copiar */
    }
  }

  return (
    <Shell allow={(u) => u.perm_admin}>
      <PageHeader
        title="Clave de registro"
        subtitle="Los árbitros nuevos se registran con esta clave. Dura 24 horas, solo hay una vigente a la vez y la pueden usar varios árbitros."
      />
      {msg && <div className="mb-4"><Alert>{msg}</Alert></div>}
      {loading ? (
        <Loading />
      ) : error ? (
        <Alert>{error}</Alert>
      ) : data ? (
        <div className="card max-w-lg text-center">
          <div className="text-sm text-stone-500">Clave vigente</div>
          <button onClick={() => copy(data.code)} title="Copiar"
            className="my-3 font-mono text-5xl font-bold tracking-[0.3em] text-brand-600 hover:text-brand-700">
            {data.code}
          </button>
          <div className="text-xs text-stone-500">{copied ? "¡Copiada!" : "Toca la clave para copiarla"}</div>
          <dl className="mt-4 grid grid-cols-2 gap-2 text-left text-sm">
            <dt className="text-stone-500">Caduca en</dt><dd className="font-medium">{remaining(data.expires_at, now)}</dd>
            <dt className="text-stone-500">Caduca el</dt><dd>{formatDateTime(data.expires_at)}</dd>
            <dt className="text-stone-500">Creada por</dt><dd>{data.created_by}</dd>
            <dt className="text-stone-500">Registros con ella</dt><dd>{data.uses}</dd>
          </dl>
          <button className="btn-danger mt-5" onClick={revoke}>Revocar clave</button>
        </div>
      ) : (
        <div className="card max-w-lg text-center">
          <p className="mb-4 text-sm text-stone-500">No hay ninguna clave vigente.</p>
          <button className="btn-primary" onClick={create}>Generar clave</button>
        </div>
      )}
    </Shell>
  );
}
