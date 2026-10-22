"use client";

import { useState } from "react";
import Shell from "@/components/Shell";
import { Alert, PageHeader } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export default function ProfilePage() {
  const { user } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api("/auth/change-pin", { method: "POST", body: { current_pin: current, new_pin: next } });
      setMsg({ kind: "success", text: "Contraseña actualizada." });
      setCurrent("");
      setNext("");
    } catch (err) {
      setMsg({ kind: "error", text: (err as Error).message });
    }
  }

  const digits = (fn: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => fn(e.target.value.replace(/\D/g, ""));

  return (
    <Shell>
      <PageHeader title="Mi perfil" />
      {user && (
        <div className="grid gap-6 md:grid-cols-2">
          <div className="card space-y-2 text-sm">
            <div><span className="text-stone-500">Nombre:</span> {user.first_name} {user.last_name}</div>
            <div><span className="text-stone-500">Documento:</span> {user.document}</div>
          </div>
          <form onSubmit={submit} className="card space-y-4">
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
            <button className="btn-primary" disabled={current.length !== 4 || next.length !== 4}>Guardar</button>
          </form>
        </div>
      )}
    </Shell>
  );
}
