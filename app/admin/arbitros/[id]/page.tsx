"use client";

import { CheckCircleIcon, NoSymbolIcon, StarIcon, TrashIcon } from "@heroicons/react/20/solid";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { RoleBadges, type UserRow } from "@/components/RoleBadges";
import BackLink from "@/components/BackLink";
import { AssignmentHistory, RatingsCard, StatsRow, UpcomingAvailability, type RefereeDetail } from "@/components/RefereeStats";
import Shell from "@/components/Shell";
import { WhatsappLink } from "@/components/Whatsapp";
import { Alert, Loading, PageHeader } from "@/components/ui";
import { api, formatDate, formatDateTime } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useFetch } from "@/lib/useFetch";

type Detail = UserRow & RefereeDetail & { created_at: string };

export default function RefereeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user, refresh } = useAuth();
  const router = useRouter();
  const { data, loading, error, reload } = useFetch<Detail>(`/users/${id}`);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [pin, setPin] = useState("");

  async function setRole(patch: Partial<Pick<UserRow, "is_referee" | "is_admin" | "active">>) {
    setMsg(null);
    try {
      await api(`/users/${id}/roles`, { method: "PATCH", body: patch });
      await reload();
    } catch (e) {
      setMsg({ kind: "error", text: (e as Error).message });
    }
  }

  async function suspend(on: boolean) {
    const name = `${data?.first_name} ${data?.last_name}`;
    if (on && !confirm(`¿Suspender a ${name}? Podrá ingresar, pero solo verá un aviso para contactarte.`)) return;
    await setRole({ active: !on });
  }

  async function removeUser() {
    const name = `${data?.first_name} ${data?.last_name}`;
    if (!confirm(`¿Eliminar a ${name}? Se borran su cuenta, disponibilidades, asignaciones, partidos y calificaciones. No se puede deshacer.`)) return;
    try {
      await api(`/users/${id}`, { method: "DELETE" });
      router.replace("/admin/arbitros");
    } catch (e) {
      setMsg({ kind: "error", text: (e as Error).message });
    }
  }

  async function transferChief() {
    const name = `${data?.first_name} ${data?.last_name}`;
    if (!confirm(`¿Transferir el rol de Jefe a ${name}? Solo puede haber un Jefe: tú quedarás como administrador.`)) return;
    try {
      await api(`/users/${id}/transfer-chief`, { method: "POST" });
      await refresh();
      await reload();
      setMsg({ kind: "success", text: `${name} es ahora el Jefe.` });
    } catch (e) {
      setMsg({ kind: "error", text: (e as Error).message });
    }
  }

  async function resetPin() {
    try {
      await api(`/users/${id}/reset-pin`, { method: "POST", body: { new_pin: pin } });
      setPin("");
      setMsg({ kind: "success", text: "Contraseña restablecida. Comunícasela al árbitro." });
    } catch (e) {
      setMsg({ kind: "error", text: (e as Error).message });
    }
  }

  return (
    <Shell allow={(u) => u.perm_admin}>
      <BackLink href="/admin/arbitros">Árbitros</BackLink>
      {loading && !data ? (
        <Loading variant="detail" />
      ) : error ? (
        <Alert>{error}</Alert>
      ) : data ? (
        <>
          <PageHeader title={`${data.first_name} ${data.last_name}`} subtitle={`Documento ${data.document}`} action={<RoleBadges u={data} />} />
          {msg && <div className="mb-4"><Alert kind={msg.kind}>{msg.text}</Alert></div>}
          <StatsRow data={data} isChief={data.is_chief} />

          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            <div className="card space-y-2 text-sm">
              <h2 className="mb-2 font-semibold">Datos</h2>
              <div><span className="text-stone-500">WhatsApp:</span>{" "}
                {data.whatsapp ? <WhatsappLink number={data.whatsapp} /> : <span className="text-stone-400">Sin registrar</span>}
              </div>
              {data.birth_date && (
                <div><span className="text-stone-500">Nacimiento:</span> {formatDate(data.birth_date, false)} ({data.age} años)</div>
              )}
              <div><span className="text-stone-500">Registrado:</span> {formatDateTime(data.created_at)}</div>
              <UpcomingAvailability data={data} />
            </div>

            {user?.perm_chief && !data.is_chief && (!data.is_system || !user.is_chief) && (
              <div className="card space-y-3 text-sm">
                <h2 className="font-semibold">Permisos (solo Jefe)</h2>
                {([
                  ["is_referee", "Árbitro", data.is_referee],
                  ["is_admin", "Administrador", data.is_admin],
                ] as const).map(([key, label, value]) => (
                  <label key={key} className="flex items-center justify-between gap-3">
                    <span>{label}</span>
                    <input type="checkbox" className="switch" checked={value}
                      onChange={(e) => setRole({ [key]: e.target.checked })} />
                  </label>
                ))}
                <div className="border-t border-stone-100 pt-3">
                  <label className="label">Restablecer contraseña</label>
                  <div className="flex gap-2">
                    <input className="input" placeholder="4 dígitos" inputMode="numeric" maxLength={4} value={pin}
                      onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} />
                    <button className="btn-secondary" disabled={pin.length !== 4} onClick={resetPin}>Guardar</button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 border-t border-stone-100 pt-3">
                  {data.active ? (
                    <button className="btn-secondary text-amber-700" onClick={() => suspend(true)}>
                      <NoSymbolIcon className="h-4 w-4" />Suspender
                    </button>
                  ) : (
                    <button className="btn-secondary text-green-700" onClick={() => suspend(false)}>
                      <CheckCircleIcon className="h-4 w-4" />Quitar suspensión
                    </button>
                  )}
                  {user.is_chief && data.active && !data.is_system && (
                    <button className="btn-secondary text-brand-700" onClick={transferChief}>
                      <StarIcon className="h-4 w-4" />Transferir rol de Jefe
                    </button>
                  )}
                  <button className="btn-ghost text-red-600" onClick={removeUser}><TrashIcon className="h-4 w-4" />Eliminar</button>
                </div>
              </div>
            )}

            <RatingsCard data={data}>
              {/* Solo el Jefe califica: aquí puede restar puntos a un árbitro activo. */}
              {user?.is_chief && data.is_referee && !data.is_chief && data.active && <DeductPoints userId={data.id} onDone={reload} />}
            </RatingsCard>
          </div>

          <AssignmentHistory data={data} linkTournaments />
        </>
      ) : null}
    </Shell>
  );
}

function DeductPoints({ userId, onDone }: { userId: number; onDone: () => void }) {
  const [points, setPoints] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(points);
    if (!confirm(`¿Restar ${n} puntos? Quedará en el historial de calificaciones.`)) return;
    setBusy(true);
    setError(null);
    try {
      await api("/ratings", { method: "POST", body: { items: [{ user_id: userId, deduct: n, reason: reason.trim() || null }] } });
      setPoints("");
      setReason("");
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-2 border-t border-stone-100 pt-3">
      <label className="label">Restar puntos</label>
      <div className="flex gap-2">
        <input className="input w-24" type="number" min={1} max={1000} placeholder="Puntos" value={points}
          onChange={(e) => setPoints(e.target.value)} required />
        <input className="input flex-1" placeholder="Motivo (opcional)" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      {error && <Alert>{error}</Alert>}
      <button className="btn-secondary text-red-600" disabled={busy || !(Number(points) > 0)}>
        {busy ? "Guardando..." : Number(points) > 0 ? `Restar ${Number(points)} puntos` : "Restar puntos"}
      </button>
    </form>
  );
}
