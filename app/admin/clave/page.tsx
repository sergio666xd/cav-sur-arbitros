"use client";

import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Alert, Badge, Loading, PageHeader } from "@/components/ui";
import { api, formatDateTime } from "@/lib/api";
import { useFetch } from "@/lib/useFetch";

type Code = { id: number; revoked: boolean; code: string; created_at: string; expires_at: string; created_by: string; uses: number };

function remaining(expires: string, now: number) {
  const ms = new Date(expires + "Z").getTime() - now;
  if (ms <= 0) return "caducada";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h} h ${m} min`;
}

function History({ version }: { version: number }) {
  const { data, reload } = useFetch<Code[]>(`/codes/history?v=${version}`);
  const [err, setErr] = useState<string | null>(null);
  if (!data || data.length === 0) return null;

  async function run(path: string, question: string) {
    if (!confirm(question)) return;
    setErr(null);
    try {
      await api(path, { method: "DELETE" });
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <section className="card mt-8 max-w-3xl p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 px-4 py-3">
        <h2 className="font-semibold">Claves anteriores</h2>
        <button className="btn-ghost text-sm text-red-700" onClick={() => run("/codes/history", `¿Eliminar las ${data.length} claves anteriores? No se puede deshacer.`)}>
          Eliminar todas
        </button>
      </div>
      {err && <div className="p-4"><Alert>{err}</Alert></div>}
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr><th>Clave</th><th>Estado</th><th>Creada</th><th>Por</th><th className="text-right">Registros</th><th /></tr>
          </thead>
          <tbody>
            {data.map((c) => (
              <tr key={c.id}>
                <td className="font-mono font-semibold">{c.code}</td>
                <td><Badge color={c.revoked ? "red" : "stone"}>{c.revoked ? "Revocada" : "Caducada"}</Badge></td>
                <td className="whitespace-nowrap">{formatDateTime(c.created_at)}</td>
                <td>{c.created_by}</td>
                <td className="text-right">{c.uses}</td>
                <td className="text-right">
                  <button className="btn-ghost px-2 py-1 text-sm text-red-700" title="Eliminar"
                    onClick={() => run(`/codes/${c.id}`, `¿Eliminar la clave ${c.code}?`)}>
                    Eliminar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function CodePage() {
  const { data, loading, error, reload } = useFetch<Code | null>("/codes/active");
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState<"clave" | "enlace" | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [version, setVersion] = useState(0);

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
    setVersion((v) => v + 1);
  }

  async function copy(text: string, what: "clave" | "enlace") {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
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
          <button onClick={() => copy(data.code, "clave")} title="Copiar"
            className="my-3 font-mono text-5xl font-bold tracking-[0.3em] text-brand-600 hover:text-brand-700">
            {data.code}
          </button>
          <div className="text-xs text-stone-500">{copied === "clave" ? "¡Copiada!" : "Toca la clave para copiarla"}</div>
          <button
            className="btn-secondary mt-4"
            onClick={() => copy(`${window.location.origin}/registro?clave=${data.code}`, "enlace")}
          >
            {copied === "enlace" ? "¡Enlace copiado!" : "🔗 Copiar enlace de registro"}
          </button>
          <p className="mt-1 text-xs text-stone-500">Abre el formulario de registro con la clave ya escrita.</p>
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
      <History version={version} />
    </Shell>
  );
}
