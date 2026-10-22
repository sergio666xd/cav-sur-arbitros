"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import AuthCard from "@/components/AuthCard";
import DateInput from "@/components/DateInput";
import { Alert, Spinner } from "@/components/ui";
import { api, type Me } from "@/lib/api";
import { homeFor, useAuth } from "@/lib/auth";

export default function RegisterPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState({ first_name: "", last_name: "", document: "", birth_date: "", code: "", pin: "", pin2: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Enlace compartido desde Clave de registro: /registro?clave=ABC123
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("clave");
    if (code) setForm((f) => ({ ...f, code: code.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) }));
  }, []);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (form.pin !== form.pin2) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { pin2: _, ...body } = form;
      const res = await api<{ token: string; user: Me }>("/auth/register", { method: "POST", body });
      login(res.token, res.user);
      router.replace(homeFor(res.user));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title="Registro de árbitro" subtitle="Necesitas la clave de 6 caracteres que te dio el Jefe o un administrador.">
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Nombre</label>
            <input className="input" value={form.first_name} onChange={set("first_name")} required />
          </div>
          <div>
            <label className="label">Apellido</label>
            <input className="input" value={form.last_name} onChange={set("last_name")} required />
          </div>
        </div>
        <div>
          <label className="label">Número de documento</label>
          <input className="input" inputMode="numeric" value={form.document} onChange={set("document")} required />
        </div>
        <div>
          <label className="label">Fecha de nacimiento</label>
          <DateInput value={form.birth_date} onChange={(v) => setForm((f) => ({ ...f, birth_date: v }))} required />
        </div>
        <div>
          <label className="label">Clave de registro</label>
          <input className="input font-mono uppercase tracking-[0.3em]" maxLength={6} value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })} required />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Contraseña (4 dígitos)</label>
            <input className="input tracking-[0.5em]" type="password" inputMode="numeric" maxLength={4} value={form.pin}
              onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, "") })} required />
          </div>
          <div>
            <label className="label">Repetir contraseña</label>
            <input className="input tracking-[0.5em]" type="password" inputMode="numeric" maxLength={4} value={form.pin2}
              onChange={(e) => setForm({ ...form, pin2: e.target.value.replace(/\D/g, "") })} required />
          </div>
        </div>
        {error && <Alert>{error}</Alert>}
        <button className="btn-primary w-full" disabled={busy || form.code.length !== 6 || form.pin.length !== 4}>
          {busy ? <><Spinner />Registrando...</> : "Crear cuenta"}
        </button>
      </form>
      <p className="mt-5 text-center text-sm text-stone-500">
        ¿Ya tienes cuenta? <Link href="/login" className="font-semibold text-brand-600 hover:underline">Ingresar</Link>
      </p>
    </AuthCard>
  );
}
