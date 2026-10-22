"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Place from "@/components/Place";
import Shell from "@/components/Shell";
import { Alert, Badge, Empty, Loading, PageHeader } from "@/components/ui";
import { api, formatDate } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useFetch } from "@/lib/useFetch";
import type { DayDetail, TournamentDetail } from "@/lib/types";

function AssignmentEditor({ day, t, onSaved }: { day: DayDetail; t: TournamentDetail; onSaved: () => void }) {
  const initial = () => Object.fromEntries(day.assignments.map((a) => [a.user_id, a.role ?? ""])) as Record<number, string>;
  const [selected, setSelected] = useState<Record<number, string>>(initial);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => setSelected(initial()), [day]); // eslint-disable-line react-hooks/exhaustive-deps

  // Incluye asignados que ya no figuran como candidatos (p. ej. si quitaron su disponibilidad).
  const people = [...day.candidates];
  for (const a of day.assignments) {
    if (!people.some((c) => c.user_id === a.user_id)) people.push({ user_id: a.user_id, name: a.name, is_chief: a.is_chief, assigned_elsewhere: null });
  }
  const count = Object.keys(selected).length;
  const usedRoles = new Set(Object.values(selected).filter(Boolean));

  function toggle(id: number) {
    const next = { ...selected };
    if (id in next) delete next[id];
    else next[id] = "";
    setSelected(next);
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      await api(`/tournament-days/${day.id}/assignments`, {
        method: "PUT",
        body: Object.entries(selected).map(([user_id, role]) => ({ user_id: Number(user_id), role: role || null })),
      });
      setMsg({ kind: "success", text: "Asignación guardada." });
      onSaved();
    } catch (e) {
      setMsg({ kind: "error", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-sm">
        <h3 className="font-semibold">Asignación</h3>
        <span className={count >= day.required ? "text-green-700" : "text-brand-700"}>{count} de {day.required} requeridos</span>
      </div>
      {people.length === 0 ? (
        <p className="text-sm text-stone-500">Ningún árbitro ha marcado disponibilidad para esta franja.</p>
      ) : (
        <ul className="divide-y divide-stone-100 rounded-lg border border-stone-200">
          {people.map((c) => {
            const on = c.user_id in selected;
            return (
              <li key={c.user_id} className={`flex flex-wrap items-center gap-3 px-3 py-2 text-sm ${on ? "bg-brand-50" : ""}`}>
                <input type="checkbox" className="h-4 w-4 accent-brand-500" checked={on} onChange={() => toggle(c.user_id)} />
                <span className="flex-1">
                  {c.name} {c.is_chief && <Badge color="brand">Jefe</Badge>}
                  {c.assigned_elsewhere && <span className="ml-2 text-xs text-amber-700">⚠ Asignado en {c.assigned_elsewhere}</span>}
                </span>
                {t.has_roles && on && (
                  <select className="input w-40 py-1" value={selected[c.user_id]}
                    onChange={(e) => setSelected({ ...selected, [c.user_id]: e.target.value })}>
                    <option value="">Sin rol</option>
                    {t.roles.map((r) => (
                      <option key={r} value={r} disabled={usedRoles.has(r) && selected[c.user_id] !== r}>{r}</option>
                    ))}
                  </select>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {msg && <div className="mt-2"><Alert kind={msg.kind}>{msg.text}</Alert></div>}
      <button className="btn-primary mt-3" disabled={busy} onClick={save}>{busy ? "Guardando..." : "Guardar asignación"}</button>
    </div>
  );
}

function MatchEditor({ day, onSaved }: { day: DayDetail; onSaved: () => void }) {
  const refs = day.assignments.filter((a) => !a.is_chief);
  const initial = () => Object.fromEntries(refs.map((a) => [a.user_id, { refereed: String(a.refereed ?? ""), scored: String(a.scored ?? "") }]));
  const [values, setValues] = useState<Record<number, { refereed: string; scored: string }>>(initial);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  useEffect(() => setValues(initial()), [day]); // eslint-disable-line react-hooks/exhaustive-deps

  if (refs.length === 0) return null;

  async function save() {
    setMsg(null);
    try {
      await api(`/tournament-days/${day.id}/matches`, {
        method: "PUT",
        body: refs.map((a) => ({
          user_id: a.user_id,
          refereed: Number(values[a.user_id]?.refereed || 0),
          scored: Number(values[a.user_id]?.scored || 0),
        })),
      });
      setMsg({ kind: "success", text: "Partidos registrados." });
      onSaved();
    } catch (e) {
      setMsg({ kind: "error", text: (e as Error).message });
    }
  }

  const set = (id: number, k: "refereed" | "scored", v: string) => setValues({ ...values, [id]: { ...values[id], [k]: v.replace(/\D/g, "") } });

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">Partidos del día</h3>
      <table className="table">
        <thead><tr><th>Árbitro</th><th className="w-24">Pitados</th><th className="w-24">Planillados</th></tr></thead>
        <tbody>
          {refs.map((a) => (
            <tr key={a.user_id}>
              <td>{a.name} {a.role && <span className="text-xs text-stone-500">({a.role})</span>}</td>
              <td><input className="input py-1" inputMode="numeric" value={values[a.user_id]?.refereed ?? ""} onChange={(e) => set(a.user_id, "refereed", e.target.value)} /></td>
              <td><input className="input py-1" inputMode="numeric" value={values[a.user_id]?.scored ?? ""} onChange={(e) => set(a.user_id, "scored", e.target.value)} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {msg && <div className="mt-2"><Alert kind={msg.kind}>{msg.text}</Alert></div>}
      <button className="btn-secondary mt-3" onClick={save}>Guardar partidos</button>
    </div>
  );
}

function DaySection({ d, t, onSaved }: { d: DayDetail; t: TournamentDetail; onSaved: () => void }) {
  const ownPlace = d.location || (d.categories && d.categories.length > 0);
  return (
    <section id={`dia-${d.id}`} className="card scroll-mt-24">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2 border-b border-stone-100 pb-3">
        <div>
          <h2 className="text-lg font-semibold">{formatDate(d.date)}</h2>
          <Place place={d.effective_location} className="mt-1 text-sm text-stone-600" />
          {ownPlace && d.effective_categories.length > 0 && (
            <div className="mt-1 flex flex-wrap items-center gap-1">
              {d.effective_categories.map((c) => <Badge key={c} color="brand">{c}</Badge>)}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge color="brand">{d.slot_label}</Badge>
          {d.past ? (
            <Badge color="stone">Fecha pasada</Badge>
          ) : (
            <Badge color={d.open ? "green" : "stone"}>{d.open ? "Disponibilidad abierta" : "Disponibilidad cerrada"}</Badge>
          )}
          <span className="text-stone-500">{d.available_count} disponibles</span>
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <AssignmentEditor day={d} t={t} onSaved={onSaved} />
        <MatchEditor day={d} onSaved={onSaved} />
      </div>
    </section>
  );
}

export default function TournamentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { data: t, loading, error, reload } = useFetch<TournamentDetail>(`/tournaments/${id}`);
  const [showPast, setShowPast] = useState(false);

  // Si se llega desde "Fechas anteriores" (#dia-N), abrir esa sección y desplazarse hasta la franja.
  useEffect(() => {
    if (!t || typeof window === "undefined" || !window.location.hash.startsWith("#dia-")) return;
    const dayId = Number(window.location.hash.slice(5));
    if (t.days.some((d) => d.id === dayId && d.past)) setShowPast(true);
    setTimeout(() => document.getElementById(`dia-${dayId}`)?.scrollIntoView({ behavior: "smooth" }), 50);
  }, [t]);

  async function remove() {
    if (!confirm("¿Eliminar este torneo? Se borrarán sus asignaciones, disponibilidades y partidos registrados.")) return;
    await api(`/tournaments/${id}`, { method: "DELETE" });
    router.push("/admin/torneos");
  }

  return (
    <Shell allow={(u) => u.perm_admin}>
      <Link href="/admin/torneos" className="mb-4 inline-block text-sm text-brand-700 hover:underline">← Torneos</Link>
      {loading && !t ? (
        <Loading />
      ) : error ? (
        <Alert>{error}</Alert>
      ) : t ? (
        <>
          <PageHeader
            title={t.name}
            subtitle={t.venues.length > 1 ? `📍 ${t.venues.length} sedes: ${t.venues.map((v) => v.split(",")[0]).join(" · ")}` : `📍 ${t.location}`}
            action={user?.perm_create_tournaments && (
              <div className="flex gap-2">
                <Link href={`/admin/torneos/${t.id}/editar`} className="btn-secondary">Editar / añadir fechas</Link>
                <button className="btn-danger" onClick={remove}>Eliminar</button>
              </div>
            )}
          />
          <div className="mb-6 flex flex-wrap gap-2">
            {t.categories.map((c) => <Badge key={c} color="brand">{c}</Badge>)}
            <Badge color={t.is_visible ? "green" : "stone"}>{t.is_visible ? "Visible para árbitros" : "Oculto para árbitros"}</Badge>
            {t.has_roles && <Badge color="blue">Roles: {t.roles.join(", ")}</Badge>}
          </div>
          {t.notes && <p className="card mb-6 whitespace-pre-line text-sm text-stone-600">{t.notes}</p>}
          {(() => {
            const upcoming = t.days.filter((d) => !d.past);
            const past = t.days.filter((d) => d.past).reverse();
            return (
              <>
                {upcoming.length === 0 ? (
                  <Empty>
                    Este torneo no tiene fechas próximas.
                    {user?.perm_create_tournaments && (
                      <> <Link href={`/admin/torneos/${t.id}/editar`} className="font-semibold text-brand-700 hover:underline">Añadir fechas</Link></>
                    )}
                  </Empty>
                ) : (
                  <div className="space-y-6">
                    {upcoming.map((d) => <DaySection key={d.id} d={d} t={t} onSaved={reload} />)}
                  </div>
                )}
                {past.length > 0 && (
                  <details className="mt-8" open={showPast} onToggle={(e) => setShowPast((e.target as HTMLDetailsElement).open)}>
                    <summary className="cursor-pointer text-lg font-semibold">Fechas anteriores ({past.length})</summary>
                    <div className="mt-4 space-y-6">
                      {past.map((d) => <DaySection key={d.id} d={d} t={t} onSaved={reload} />)}
                    </div>
                  </details>
                )}
              </>
            );
          })()}
        </>
      ) : null}
    </Shell>
  );
}
