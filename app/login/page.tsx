"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import AuthCard from "@/components/AuthCard";
import { Alert, Spinner } from "@/components/ui";
import { api, type Me } from "@/lib/api";
import { homeFor, useAuth } from "@/lib/auth";

export default function LoginPage() {
  const { user, login } = useAuth();
  const router = useRouter();
  const [document, setDocument] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user) router.replace(homeFor(user));
  }, [user, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ token: string; user: Me }>("/auth/login", { method: "POST", body: { document, pin } });
      login(res.token, res.user);
      router.replace(homeFor(res.user));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title="Ingresar" subtitle="Usa tu número de documento y tu contraseña de 4 dígitos.">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="doc">Número de documento</label>
          <input id="doc" className="input" inputMode="numeric" autoComplete="username" value={document}
            onChange={(e) => setDocument(e.target.value)} required />
        </div>
        <div>
          <label className="label" htmlFor="pin">Contraseña</label>
          <input id="pin" className="input tracking-[0.5em]" type="password" inputMode="numeric" maxLength={4}
            autoComplete="current-password" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} required />
        </div>
        {error && <Alert>{error}</Alert>}
        <button className="btn-primary w-full" disabled={busy || pin.length !== 4}>{busy ? <><Spinner />Ingresando...</> : "Ingresar"}</button>
      </form>
      <p className="mt-5 text-center text-sm text-stone-500">
        ¿Eres árbitro nuevo? <Link href="/registro" className="font-semibold text-brand-600 hover:underline">Regístrate con tu clave</Link>
      </p>
    </AuthCard>
  );
}
