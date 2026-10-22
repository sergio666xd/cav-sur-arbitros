"use client";

import { ArrowDownTrayIcon, CheckIcon, ClipboardDocumentIcon, KeyIcon, LinkIcon, NoSymbolIcon, PlusIcon, TrashIcon } from "@heroicons/react/20/solid";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Alert, Badge, Loading, PageHeader, Spinner } from "@/components/ui";
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

// Código QR del enlace de registro, para escanearlo con el celular o descargarlo.
function RegistrationQr({ link, code }: { link: string; code: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    QRCode.toDataURL(link, { width: 480, margin: 2, color: { dark: "#1c1917" } }).then(setSrc).catch(() => setSrc(null));
  }, [link]);
  if (!src) return <div className="mx-auto mt-4 h-48 w-48 animate-pulse rounded-lg bg-stone-100" />;
  return (
    <div className="mt-4 flex flex-col items-center gap-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="Código QR del enlace de registro" className="h-48 w-48 animate-fade-in rounded-lg border border-stone-200" />
      <a href={src} download={`registro-cav-sur-${code}.png`} className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
        <ArrowDownTrayIcon className="h-3.5 w-3.5" />Descargar QR
      </a>
    </div>
  );
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
    <section className="card mt-8 max-w-3xl animate-slide-up p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 px-4 py-3">
        <h2 className="font-semibold">Claves anteriores</h2>
        <button className="btn-ghost text-sm text-red-700" onClick={() => run("/codes/history", `¿Eliminar las ${data.length} claves anteriores? No se puede deshacer.`)}>
          <TrashIcon className="h-4 w-4" />Eliminar todas
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
                    <TrashIcon className="h-4 w-4" />Eliminar
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

function registrationLink(code: string) {
  return `${window.location.origin}/registro?clave=${code}`;
}

export default function CodePage() {
  const { data, loading, error, reload } = useFetch<Code | null>("/codes/active");
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState<"clave" | "enlace" | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  async function create() {
    setMsg(null);
    setBusy(true);
    try {
      await api("/codes", { method: "POST" });
      await reload();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!confirm("¿Revocar la clave vigente? Nadie más podrá registrarse con ella.")) return;
    setBusy(true);
    try {
      await api("/codes/active", { method: "DELETE" });
      await reload();
      setVersion((v) => v + 1);
    } finally {
      setBusy(false);
    }
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
        <Loading variant="form" />
      ) : error ? (
        <Alert>{error}</Alert>
      ) : data ? (
        <div className="card max-w-lg animate-scale-in text-center">
          <div className="inline-flex items-center gap-1.5 text-sm text-stone-500"><KeyIcon className="h-4 w-4" />Clave vigente</div>
          <button onClick={() => copy(data.code, "clave")} title="Copiar"
            className="my-3 block w-full font-mono text-5xl font-bold tracking-[0.3em] text-brand-600 transition hover:text-brand-700 active:scale-95">
            {data.code.split("").map((ch, i) => (
              <span key={i} className="inline-block animate-pop" style={{ animationDelay: `${i * 50}ms` }}>{ch}</span>
            ))}
          </button>
          <div className={`flex items-center justify-center gap-1 text-xs ${copied === "clave" ? "text-green-700" : "text-stone-500"}`}>
            {copied === "clave" ? <><CheckIcon className="h-3.5 w-3.5 animate-pop" />¡Copiada!</> : <><ClipboardDocumentIcon className="h-3.5 w-3.5" />Toca la clave para copiarla</>}
          </div>
          <button
            className="btn-secondary mt-4"
            onClick={() => copy(registrationLink(data.code), "enlace")}
          >
            {copied === "enlace"
              ? <><CheckIcon className="h-4 w-4 animate-pop text-green-600" />¡Enlace copiado!</>
              : <><LinkIcon className="h-4 w-4" />Copiar enlace de registro</>}
          </button>
          <p className="mt-1 text-xs text-stone-500">Abre el formulario de registro con la clave ya escrita. También puedes escanear el QR.</p>
          <RegistrationQr link={registrationLink(data.code)} code={data.code} />
          <dl className="mt-4 grid grid-cols-2 gap-2 text-left text-sm">
            <dt className="text-stone-500">Caduca en</dt><dd className="font-medium">{remaining(data.expires_at, now)}</dd>
            <dt className="text-stone-500">Caduca el</dt><dd>{formatDateTime(data.expires_at)}</dd>
            <dt className="text-stone-500">Creada por</dt><dd>{data.created_by}</dd>
            <dt className="text-stone-500">Registros con ella</dt><dd>{data.uses}</dd>
          </dl>
          <button className="btn-danger mt-5" disabled={busy} onClick={revoke}>
            {busy ? <Spinner /> : <NoSymbolIcon className="h-4 w-4" />}Revocar clave
          </button>
        </div>
      ) : (
        <div className="card max-w-lg animate-scale-in text-center">
          <KeyIcon className="mx-auto mb-3 h-10 w-10 text-stone-300" />
          <p className="mb-4 text-sm text-stone-500">No hay ninguna clave vigente.</p>
          <button className="btn-primary" disabled={busy} onClick={create}>
            {busy ? <Spinner /> : <PlusIcon className="h-4 w-4" />}Generar clave
          </button>
        </div>
      )}
      <History version={version} />
    </Shell>
  );
}
