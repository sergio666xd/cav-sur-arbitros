"use client";

import { CheckIcon, ClockIcon, HandRaisedIcon, LockClosedIcon, UsersIcon, XMarkIcon } from "@heroicons/react/20/solid";
import { CalendarDaysIcon } from "@heroicons/react/24/outline";
import { useState } from "react";
import DateHeading from "@/components/DateHeading";
import DayFilter from "@/components/DayFilter";
import Shell from "@/components/Shell";
import { Alert, Badge, Empty, Loading, Modal, PageHeader, ProgressBar, Skeleton, Spinner } from "@/components/ui";
import { api, formatDate, formatDateTime, hoursLabel } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useFetch } from "@/lib/useFetch";

type Slot = {
  key: number;
  date: string;
  slot_label: string;
  all_day: boolean;
  start_time: string | null;
  end_time: string | null;
  /** El árbitro puede indicar su horario (dentro del de la disponibilidad). */
  allow_custom_hours: boolean;
  /** Horario que indicó al inscribirse; null: desde el inicio / hasta el final. */
  my_start_time: string | null;
  my_end_time: string | null;
  /** Total de requeridos: null si algún torneo los oculta (salvo que no se vea ninguno por nombre). */
  required: number | null;
  registered: number;
  mine: boolean;
  open: boolean;
  tournaments: { name: string; categories: string[]; visible: boolean; name_hidden: boolean; required: number | null }[];
  /** Torneos de la disponibilidad que el árbitro no ve por nombre. */
  hidden_count: number;
};

type Referee = { name: string; since: string; start_time: string | null; end_time: string | null };
// Horario escrito en una disponibilidad; vacío: desde el inicio / hasta el final.
type Draft = { from: string; until: string };

export default function AvailabilityPage() {
  const { user } = useAuth();
  const { data, error, loading, reload } = useFetch<Slot[]>("/availability");
  const [busy, setBusy] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [listFor, setListFor] = useState<Slot | null>(null);
  const [list, setList] = useState<Referee[] | null>(null);
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const saved = (s: Slot): Draft => ({ from: s.my_start_time ?? "", until: s.my_end_time ?? "" });
  const hoursOf = (s: Slot) => drafts[s.key] ?? saved(s);
  const bodyOf = (s: Slot) => ({ start_time: hoursOf(s).from || null, end_time: hoursOf(s).until || null });
  const changed = (s: Slot) => hoursOf(s).from !== saved(s).from || hoursOf(s).until !== saved(s).until;
  const forget = (s: Slot) => setDrafts(({ [s.key]: _, ...rest }) => rest);

  async function toggle(s: Slot) {
    setBusy(s.key);
    setActionError(null);
    try {
      await api(`/availability/${s.key}`, s.mine
        ? { method: "DELETE" }
        : { method: "POST", body: s.allow_custom_hours ? bodyOf(s) : undefined });
      await reload();
      forget(s);
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function saveHours(s: Slot) {
    setBusy(s.key);
    setActionError(null);
    try {
      await api(`/availability/${s.key}`, { method: "POST", body: bodyOf(s) });
      await reload();
      forget(s);
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function showList(s: Slot) {
    setListFor(s);
    setList(null);
    try {
      setList(await api<Referee[]>(`/availability/${s.key}/referees`));
    } catch (e) {
      setActionError((e as Error).message);
      setListFor(null);
    }
  }

  const [day, setDay] = useState("");
  const byDate = new Map<string, Slot[]>();
  for (const s of data ?? []) byDate.set(s.date, [...(byDate.get(s.date) ?? []), s]);
  const shownDates = [...byDate.entries()].filter(([date]) => !day || date === day);

  return (
    <Shell allow={(u) => u.perm_availability}>
      <PageHeader
        title="Disponibilidad"
        subtitle="Inscríbete en las disponibilidades habilitadas en las que puedes arbitrar. La inscripción se cierra automáticamente el día del torneo."
      />
      {actionError && <div className="mb-4"><Alert>{actionError}</Alert></div>}
      {loading && !data ? (
        <Loading variant="cards" />
      ) : error ? (
        <Alert>{error}</Alert>
      ) : byDate.size === 0 ? (
        <Empty icon={CalendarDaysIcon}>No hay disponibilidades habilitadas por ahora.</Empty>
      ) : (
        <div className="space-y-6">
          <DayFilter dates={[...byDate.keys()]} value={day} onChange={setDay} />
          {shownDates.map(([date, slots], i) => (
            <section key={date} className="animate-slide-up" style={{ animationDelay: `${Math.min(i, 6) * 60}ms` }}>
              <DateHeading date={date} />
              <div className="grid gap-3 md:grid-cols-2">
                {slots.map((s) => {
                  return (
                    <div key={s.key} className={`card transition-all duration-300 hover:shadow-md ${s.mine ? "border-brand-300 ring-1 ring-brand-200" : ""}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-lg font-semibold">{s.slot_label}</div>
                          {s.tournaments.length ? (
                            s.tournaments.map((t) => (
                              <div key={t.name} className="mt-2 text-sm text-stone-600">
                                <div className="font-medium text-ink">
                                  {t.name}
                                  {t.required !== null && <span className="font-normal text-stone-500"> · {t.required} requeridos</span>}
                                  {" "}{!t.visible && user?.perm_admin && <Badge color="stone">Oculto</Badge>}
                                  {t.name_hidden && <Badge color="violet">Nombre oculto a árbitros</Badge>}
                                </div>
                                {t.categories.length > 0 && (
                                  <div className="mt-1 flex flex-wrap gap-1">
                                    {t.categories.map((c) => <Badge key={c} color="brand">{c}</Badge>)}
                                  </div>
                                )}
                              </div>
                            ))
                          ) : null}
                          {s.hidden_count > 0 && (
                            <div className={`${s.tournaments.length ? "mt-1" : "mt-2"} text-sm font-medium text-stone-500`}>
                              {s.tournaments.length ? "y otros torneos" : s.hidden_count === 1 ? "1 torneo" : `${s.hidden_count} torneos`}
                            </div>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          {s.mine && <span className="animate-pop"><Badge color="green"><CheckIcon className="mr-0.5 h-3 w-3" />Inscrito</Badge></span>}
                          {!s.open && <Badge color="stone"><LockClosedIcon className="mr-0.5 h-3 w-3" />Cerrado</Badge>}
                        </div>
                      </div>
                      {s.required === null ? (
                        <div className="mt-4 text-xs text-stone-500">{s.registered} inscritos</div>
                      ) : (
                        <div className="mt-4">
                          <div className="mb-1 flex justify-between text-xs text-stone-500">
                            <span>{s.registered} inscritos</span>
                            <span>{s.required} requeridos</span>
                          </div>
                          <ProgressBar pct={Math.min(100, Math.round((s.registered / Math.max(1, s.required)) * 100))} />
                        </div>
                      )}
                      {s.mine && (s.my_start_time || s.my_end_time) && !s.open && (
                        <p className="mt-3 flex items-center gap-1 text-sm text-sky-700">
                          <ClockIcon className="h-4 w-4" />Tu horario: {hoursLabel(s.my_start_time, s.my_end_time)}
                        </p>
                      )}
                      {s.open && s.allow_custom_hours && (
                        <div className="mt-4 rounded-lg bg-stone-50 p-3">
                          <div className="mb-2 text-sm font-medium">Tu horario <span className="font-normal text-stone-500">(opcional)</span></div>
                          <div className="grid grid-cols-2 gap-2">
                            {(["from", "until"] as const).map((k) => (
                              <div key={k}>
                                <label className="label" htmlFor={`${k}-${s.key}`}>{k === "from" ? "Desde" : "Hasta"}</label>
                                <input id={`${k}-${s.key}`} className="input" type="time" value={hoursOf(s)[k]}
                                  min={s.all_day ? undefined : s.start_time ?? undefined} max={s.end_time ?? undefined}
                                  onChange={(e) => setDrafts({ ...drafts, [s.key]: { ...hoursOf(s), [k]: e.target.value } })} />
                              </div>
                            ))}
                          </div>
                          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                            <p className="text-xs text-stone-500">
                              {s.mine
                                ? s.my_start_time || s.my_end_time ? `Inscrito: ${hoursLabel(s.my_start_time, s.my_end_time)}` : "Inscrito para todo el horario"
                                : "Déjalo vacío si puedes todo el horario."}
                            </p>
                            {s.mine && changed(s) && (
                              <button className="btn-secondary" disabled={busy === s.key} onClick={() => saveHours(s)}>
                                {busy === s.key ? <Spinner /> : <CheckIcon className="h-4 w-4" />}Guardar horario
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                      <div className="mt-4 flex flex-wrap gap-2">
                        {s.open && (
                          <button className={s.mine ? "btn-secondary" : "btn-primary"} disabled={busy === s.key} onClick={() => toggle(s)}>
                            {busy === s.key ? <><Spinner />Guardando...</> : s.mine
                              ? <><XMarkIcon className="h-4 w-4" />Quitar disponibilidad</>
                              : <><HandRaisedIcon className="h-4 w-4" />Estoy disponible</>}
                          </button>
                        )}
                        <button className="btn-ghost" onClick={() => showList(s)}><UsersIcon className="h-4 w-4" />Ver inscritos</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
      <Modal open={!!listFor} onClose={() => setListFor(null)} title="Árbitros inscritos">
        {listFor && <p className="mb-3 text-sm text-stone-500">{formatDate(listFor.date)} · {listFor.slot_label}</p>}
        {!list ? (
          <div className="space-y-3 py-1">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-5 w-full" />)}</div>
        ) : list.length === 0 ? (
          <p className="text-sm text-stone-500">Aún no hay árbitros inscritos.</p>
        ) : (
          <ol className="divide-y divide-stone-100">
            {list.map((r, i) => (
              <li key={i} className="flex animate-fade-in justify-between py-2 text-sm" style={{ animationDelay: `${i * 30}ms` }}>
                <span>
                  {i + 1}. {r.name}
                  {(r.start_time || r.end_time) && (
                    <span className="ml-1.5 text-xs font-medium text-sky-700">{hoursLabel(r.start_time, r.end_time)}</span>
                  )}
                </span>
                <span className="text-xs text-stone-400">{formatDateTime(r.since)}</span>
              </li>
            ))}
          </ol>
        )}
      </Modal>
    </Shell>
  );
}
