"use client";

import { useParams } from "next/navigation";
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
  const { user } = useAuth();
  const { data, loading, error, reload } = useFetch<Detail>(`/users/${id}`);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [pin, setPin] = useState("");

  async function setRole(patch: Partial<Pick<UserRow, "is_referee" | "is_admin" | "can_create_tournaments" | "active">>) {
    setMsg(null);
    try {
      await api(`/users/${id}/roles`, { method: "PATCH", body: patch });
      await reload();
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
                  ["can_create_tournaments", "Puede crear torneos", data.can_create_tournaments],
                  ["active", "Cuenta activa", data.active],
                ] as const).map(([key, label, value]) => (
                  <label key={key} className="flex items-center justify-between gap-3">
                    <span>{label}</span>
                    <input type="checkbox" className="h-5 w-5 accent-brand-500" checked={value}
                      disabled={key === "can_create_tournaments" && !data.is_admin}
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
              </div>
            )}

            <RatingsCard data={data} />
          </div>

          <AssignmentHistory data={data} linkTournaments />
        </>
      ) : null}
    </Shell>
  );
}
