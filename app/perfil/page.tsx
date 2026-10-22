"use client";

import { UserCircleIcon } from "@heroicons/react/24/outline";
import { useState } from "react";
import Shell from "@/components/Shell";
import { Alert, PageHeader, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export default function ProfilePage() {
  const { user } = useAuth();
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
