"use client";

import { UserCircleIcon } from "@heroicons/react/24/outline";
import { useState } from "react";
import Shell from "@/components/Shell";
import { WhatsappLink } from "@/components/Whatsapp";
import { Alert, PageHeader, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export default function ProfilePage() {
  const { user, refresh } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/auth/change-pin", { method: "POST", body: { current_pin: current, new_pin: next } });
      setMsg({ kind: "success", text: "Contraseña actualizada." });
      setCurrent("");
      setNext("");
    } catch (err) {
      setMsg({ kind: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const [wa, setWa] = useState<string | null>(null);
  const [waMsg, setWaMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  async function saveWhatsapp(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api("/auth/whatsapp", { method: "PUT", body: { whatsapp: wa } });
      await refresh();
      setWa(null);
      setWaMsg({ kind: "success", text: "WhatsApp actualizado." });
    } catch (err) {
      setWaMsg({ kind: "error", text: (err as Error).message });
    }
  }

  const digits = (fn: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => fn(e.target.value.replace(/\D/g, ""));

  return (
    <Shell>
      <PageHeader title="Mi perfil" />
      {user && (
        <div className="grid gap-6 md:grid-cols-2">
          <div className="card animate-slide-up space-y-2 text-sm">
            <UserCircleIcon className="mb-2 h-12 w-12 text-brand-400" />
            <div><span className="text-stone-500">Nombre:</span> {user.first_name} {user.last_name}</div>
            <div><span className="text-stone-500">Documento:</span> {user.document}</div>
            {wa === null ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-stone-500">WhatsApp:</span>
                {user.whatsapp ? <WhatsappLink number={user.whatsapp} /> : <span className="text-stone-400">Sin registrar</span>}
                <button type="button" className="text-xs font-semibold text-brand-600 hover:underline"
                  onClick={() => { setWa(user.whatsapp ?? ""); setWaMsg(null); }}>
                  {user.whatsapp ? "Cambiar" : "Añadir"}
                </button>
              </div>
            ) : (
              <form onSubmit={saveWhatsapp} className="flex flex-wrap items-center gap-2 pt-1">
                <input className="input max-w-[12rem]" type="tel" inputMode="tel" placeholder="3001234567" autoFocus
                  value={wa} onChange={(e) => setWa(e.target.value)} required />
                <button className="btn-primary">Guardar</button>
                <button type="button" className="btn-secondary" onClick={() => setWa(null)}>Cancelar</button>
              </form>
            )}
            {waMsg && <Alert kind={waMsg.kind}>{waMsg.text}</Alert>}
          </div>
          <form onSubmit={submit} className="card animate-slide-up space-y-4" style={{ animationDelay: "60ms" }}>
            <h2 className="font-semibold">Cambiar contraseña</h2>
            <div>
              <label className="label">Contraseña actual</label>
              <input className="input" type="password" inputMode="numeric" maxLength={4} value={current} onChange={digits(setCurrent)} />
            </div>
            <div>
              <label className="label">Nueva contraseña (4 dígitos)</label>
              <input className="input" type="password" inputMode="numeric" maxLength={4} value={next} onChange={digits(setNext)} />
            </div>
            {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
            <button className="btn-primary" disabled={busy || current.length !== 4 || next.length !== 4}>
              {busy ? <><Spinner />Guardando...</> : "Guardar"}
            </button>
          </form>
        </div>
      )}
    </Shell>
  );
}
