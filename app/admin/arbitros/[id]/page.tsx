"use client";

import { CalendarDaysIcon, ClipboardDocumentListIcon, FlagIcon, PuzzlePieceIcon, StarIcon } from "@heroicons/react/24/outline";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { RoleBadges, type UserRow } from "@/components/RoleBadges";
import BackLink from "@/components/BackLink";
import Shell from "@/components/Shell";
import { Alert, Badge, Empty, Loading, PageHeader, StatCard } from "@/components/ui";
import { api, formatDate, formatDateTime, formatShortDate } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useFetch } from "@/lib/useFetch";

type Detail = UserRow & {
  created_at: string;
  upcoming_availability: { date: string; slot_label: string; tournament: string }[];
  assignments: { tournament_id: number; tournament: string; date: string; role: string | null; refereed: number | null; scored: number | null; other: number | null }[];
  ratings: { score: string; points: number; date: string }[];
};

const SCORE_LABEL: Record<string, string> = { MUY_MALO: "Muy Malo", MALO: "Malo", REGULAR: "Regular", BUENO: "Bueno", EXCELENTE: "Excelente" };

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
          <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
            {([
              ["Asignaciones", data.assignments.length, CalendarDaysIcon],
              ["Pitados", data.is_chief ? null : data.refereed, FlagIcon],
              ["Planillados", data.is_chief ? null : data.scored, ClipboardDocumentListIcon],
              ["Otros roles", data.is_chief ? null : data.other, PuzzlePieceIcon],
              ["Puntos", data.points ?? null, StarIcon],
            ] as const).map(([l, v, icon], i) => (
              <StatCard key={l} label={l} value={v} icon={icon} delay={i * 50} />
            ))}
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            <div className="card space-y-2 text-sm">
              <h2 className="mb-2 font-semibold">Datos</h2>
              {data.birth_date && (
                <div><span className="text-stone-500">Nacimiento:</span> {formatDate(data.birth_date, false)} ({data.age} años)</div>
              )}
              <div><span className="text-stone-500">Registrado:</span> {formatDateTime(data.created_at)}</div>
              <h3 className="pt-3 font-semibold">Próximas disponibilidades</h3>
              {data.upcoming_availability.length === 0 ? (
                <p className="text-stone-500">Ninguna.</p>
              ) : (
                <ul className="space-y-1">
                  {data.upcoming_availability.map((a, i) => (
                    <li key={i}>{formatShortDate(a.date)} · {a.slot_label} <span className="text-stone-500">({a.tournament})</span></li>
                  ))}
                </ul>
              )}
            </div>

            {user?.is_chief && !data.is_chief && (
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

            <div className="card text-sm">
              <h2 className="mb-2 font-semibold">Calificaciones</h2>
              {data.ratings.length === 0 ? (
                <p className="text-stone-500">Sin calificaciones.</p>
              ) : (
                <ul className="space-y-1">
                  {data.ratings.map((r, i) => (
                    <li key={i} className="flex justify-between">
                      <span>{SCORE_LABEL[r.score]} <span className="text-stone-400">· {formatDateTime(r.date)}</span></span>
                      <span className="font-semibold">+{r.points}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <h2 className="mb-3 mt-8 text-lg font-semibold">Historial de asignaciones</h2>
          {data.assignments.length === 0 ? (
            <Empty>Sin asignaciones.</Empty>
          ) : (
            <div className="card overflow-x-auto p-0">
              <table className="table">
                <thead>
                  <tr><th>Fecha</th><th>Torneo</th><th>Rol</th><th className="text-right">Pitados</th><th className="text-right">Planillados</th><th className="text-right">Otros roles</th></tr>
                </thead>
                <tbody>
                  {data.assignments.map((a, i) => (
                    <tr key={i}>
                      <td>{formatShortDate(a.date)}</td>
                      <td><Link className="text-brand-700 hover:underline" href={`/admin/torneos/${a.tournament_id}`}>{a.tournament}</Link></td>
                      <td>{a.role ? <Badge color="brand">{a.role}</Badge> : "—"}</td>
                      <td className="text-right">{a.refereed ?? "—"}</td>
                      <td className="text-right">{a.scored ?? "—"}</td>
                      <td className="text-right">{a.other ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
    </Shell>
  );
}
