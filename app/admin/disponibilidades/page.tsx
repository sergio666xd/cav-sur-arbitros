"use client";

import { EyeSlashIcon, LockClosedIcon, PencilSquareIcon, PlusIcon, TrashIcon, UserPlusIcon, UsersIcon, XMarkIcon } from "@heroicons/react/20/solid";
import { CalendarDaysIcon } from "@heroicons/react/24/outline";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import DateInput from "@/components/DateInput";
import AvailabilityImageButton from "@/components/AvailabilityImageButton";
import DateHeading from "@/components/DateHeading";
import DayFilter from "@/components/DayFilter";
import Shell from "@/components/Shell";
import { Alert, Badge, Empty, Loading, Modal, PageHeader, ProgressBar, Skeleton, Spinner } from "@/components/ui";
import { api, formatDate, formatDateTime } from "@/lib/api";
import { summaryColumns, type SummaryRow } from "@/lib/availabilityImage";
import { useFetch } from "@/lib/useFetch";

type WindowDay = { id: number; tournament_id: number; tournament: string; slot_label: string; required: number };
type Window = {
  id: number;
  date: string;
  all_day: boolean;
  start_time: string | null;
  end_time: string | null;
  slot_label: string;
  hidden_tournament_ids: number[];
  required: number;
  registered: number;
  open: boolean;
  days: WindowDay[];
  guests: { user_id: number; name: string }[];
  can_edit_guests: boolean;
};
type SlotOption = {
  id: number;
  tournament_id: number;
  tournament: string;
  all_day: boolean;
  start_time: string | null;
  end_time: string | null;
  slot_label: string;
  required: number;
  location: string;
  window_ids: number[];
};
type Draft = { id?: number; date: string; all_day: boolean; start_time: string; end_time: string; day_ids: number[]; hidden: number[] };

const emptyDraft = (date = ""): Draft => ({ date, all_day: false, start_time: "", end_time: "", day_ids: [], hidden: [] });

// Horario que cubre las franjas elegidas: de la primera hora de inicio a la última de fin.
// Si alguna es de todo el día o no tiene hora de fin, la disponibilidad queda de todo el día.
function spanOf(slots: SlotOption[]): Pick<Draft, "all_day" | "start_time" | "end_time"> | null {
  if (!slots.length) return null;
  if (slots.some((s) => s.all_day || !s.start_time || !s.end_time)) return { all_day: true, start_time: "", end_time: "" };
  const starts = slots.map((s) => s.start_time!).sort();
  const ends = slots.map((s) => s.end_time!).sort();
  return { all_day: false, start_time: starts[0], end_time: ends[ends.length - 1] };
}

function WindowForm({ initial, onClose, onSaved }: { initial: Draft; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState<Draft>(initial);
  // Mientras no se toque el horario a mano, se ajusta solo a las franjas elegidas.
  const [autoTime, setAutoTime] = useState(!initial.id);
  const [slots, setSlots] = useState<SlotOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date)) {
      setSlots([]);
      return;
    }
    setSlots(null);
    api<SlotOption[]>(`/availability-windows/slots?d=${v.date}`).then(setSlots).catch((e) => setError((e as Error).message));
  }, [v.date]);

  function toggleSlot(id: number) {
    const day_ids = v.day_ids.includes(id) ? v.day_ids.filter((x) => x !== id) : [...v.day_ids, id];
    const span = autoTime ? spanOf((slots ?? []).filter((s) => day_ids.includes(s.id))) : null;
    setV({ ...v, day_ids, ...(span ?? {}) });
  }

  function setTime(patch: Partial<Draft>) {
    setAutoTime(false);
    setV({ ...v, ...patch });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(v.id ? `/availability-windows/${v.id}` : "/availability-windows", {
        method: v.id ? "PUT" : "POST",
        body: {
          date: v.date,
          all_day: v.all_day,
          start_time: v.all_day ? null : v.start_time || null,
          end_time: v.all_day ? null : v.end_time || null,
          day_ids: v.day_ids.filter((id) => slots?.some((s) => s.id === id)),
          hidden_tournament_ids: v.hidden,
        },
      });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const chosen = (slots ?? []).filter((s) => v.day_ids.includes(s.id));
  const required = chosen.reduce((n, s) => n + s.required, 0);
  const tournaments = [...new Map(chosen.map((s) => [s.tournament_id, s.tournament])).entries()];

  function toggleName(id: number, show: boolean) {
    setV({ ...v, hidden: show ? v.hidden.filter((x) => x !== id) : [...v.hidden, id] });
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <div>
        <label className="label">Fecha</label>
        <DateInput value={v.date} onChange={(date) => setV({ ...v, date, day_ids: [] })} required />
      </div>
      <div>
        <label className="label">Franjas de torneo que cubre</label>
        {slots === null ? (
          <div className="space-y-2">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : slots.length === 0 ? (
          <p className="rounded-lg border border-dashed border-stone-300 p-3 text-sm text-stone-500">
            {v.date ? "No hay franjas de torneo en esta fecha." : "Elige una fecha para ver sus franjas."}
          </p>
        ) : (
          <ul className="divide-y divide-stone-100 rounded-lg border border-stone-200">
            {slots.map((s) => {
              const other = s.window_ids.some((id) => id !== v.id);
              return (
                <li key={s.id}>
                  <label className={`flex cursor-pointer items-center gap-3 px-3 py-2 text-sm ${v.day_ids.includes(s.id) ? "bg-brand-50" : ""}`}>
                    <input type="checkbox" className="switch" checked={v.day_ids.includes(s.id)} onChange={() => toggleSlot(s.id)} />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{s.tournament}</span>
                      <span className="block text-xs text-stone-500">{s.slot_label} · {s.required} árbitros</span>
                    </span>
                    {other && <Badge color="stone">Ya en otra</Badge>}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        {chosen.length > 0 && <p className="mt-1 text-xs text-stone-500">Árbitros necesarios: <b>{required}</b></p>}
      </div>
      <div>
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" className="switch" checked={v.all_day} onChange={(e) => setTime({ all_day: e.target.checked })} />
          Todo el día
        </label>
        {!v.all_day && (
          <div className="mt-2 grid grid-cols-2 gap-3">
            <div>
              <label className="label">Desde</label>
              <input className="input" type="time" value={v.start_time} onChange={(e) => setTime({ start_time: e.target.value })} required />
            </div>
            <div>
              <label className="label" title="Vacío: hasta el final del día">Hasta (opcional)</label>
              <input className="input" type="time" value={v.end_time} onChange={(e) => setTime({ end_time: e.target.value })} />
            </div>
          </div>
        )}
        {autoTime && chosen.length > 0 && <p className="mt-1 text-xs text-stone-500">El horario se ajusta a las franjas elegidas; puedes cambiarlo.</p>}
      </div>
      {tournaments.length > 0 && (
        <div>
          <label className="label">Nombre visible para los árbitros</label>
          <ul className="space-y-1">
            {tournaments.map(([id, name]) => (
              <li key={id}>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="switch" checked={!v.hidden.includes(id)}
                    onChange={(e) => toggleName(id, e.target.checked)} />
                  <span className={v.hidden.includes(id) ? "text-stone-400 line-through" : "font-medium"}>{name}</span>
                </label>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-stone-500">Los árbitros no verán los torneos desmarcados; si los desmarcas todos, solo verán la fecha y el horario.</p>
        </div>
      )}
      {error && <Alert>{error}</Alert>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
        <button className="btn-primary" disabled={busy}>{busy ? <><Spinner />Guardando...</> : v.id ? "Guardar cambios" : "Habilitar"}</button>
      </div>
    </form>
  );
}

// Árbitros sin cuenta: no son usuarios, se inscriben solo con su nombre para poder asignarlos.
function GuestsForm({ window: w, onChanged }: { window: Window; onChanged: (w: Window) => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | "add" | null>(null);

  async function run(key: number | "add", path: string, init: Parameters<typeof api>[1]) {
    setBusy(key);
    setError(null);
    try {
      onChanged(await api<Window>(path, init));
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    if (await run("add", `/availability-windows/${w.id}/guests`, { method: "POST", body: { name } })) setName("");
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-stone-500">
        Para árbitros que no tienen cuenta en la aplicación. Quedan inscritos en esta disponibilidad y podrás asignarlos en sus franjas.
      </p>
      <form onSubmit={add} className="flex gap-2">
        <input className="input min-w-0 flex-1" value={name} onChange={(e) => setName(e.target.value)}
          placeholder="Nombre y apellido" maxLength={120} autoFocus />
        <button className="btn-primary shrink-0" disabled={busy !== null || !name.trim()}>
          {busy === "add" ? <Spinner /> : <PlusIcon className="h-4 w-4" />}Agregar
        </button>
      </form>
      {error && <Alert>{error}</Alert>}
      {w.guests.length === 0 ? (
        <p className="rounded-lg border border-dashed border-stone-300 p-3 text-sm text-stone-500">Aún no has agregado árbitros por nombre en esta disponibilidad.</p>
      ) : (
        <ul className="divide-y divide-stone-100 rounded-lg border border-stone-200">
          {w.guests.map((g) => (
            <li key={g.user_id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className="font-medium">{g.name}</span>
              <button className="btn-ghost text-red-700" disabled={busy !== null} title={`Quitar a ${g.name}`}
                onClick={() => run(g.user_id, `/availability-windows/${w.id}/guests/${g.user_id}`, { method: "DELETE" })}>
                {busy === g.user_id ? <Spinner /> : <XMarkIcon className="h-4 w-4" />}Quitar
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function WindowsPage() {
  const params = useSearchParams();
  const { data, loading, error, reload } = useFetch<Window[]>("/availability-windows");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [day, setDay] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [listFor, setListFor] = useState<Window | null>(null);
  const [list, setList] = useState<{ name: string; since: string }[] | null>(null);
  const [guestsFor, setGuestsFor] = useState<Window | null>(null);

  // Desde un torneo se llega con ?d=AAAA-MM-DD para habilitar esa fecha.
  useEffect(() => {
    const d = params.get("d");
    if (d) setDraft(emptyDraft(d));
  }, [params]);

  async function remove(w: Window) {
    const extra = w.registered ? ` Se borrarán las ${w.registered} inscripciones.` : "";
    if (!confirm(`¿Eliminar la disponibilidad del ${formatDate(w.date)} (${w.slot_label})?${extra}`)) return;
    setMsg(null);
    try {
      await api(`/availability-windows/${w.id}`, { method: "DELETE" });
      await reload();
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  async function showList(w: Window) {
    setListFor(w);
    setList(null);
    try {
      setList(await api(`/availability/${w.id}/referees`));
    } catch (e) {
      setMsg((e as Error).message);
      setListFor(null);
    }
  }

  const byDate = new Map<string, Window[]>();
  for (const w of data ?? []) byDate.set(w.date, [...(byDate.get(w.date) ?? []), w]);
  const shown = [...byDate.entries()].filter(([date]) => !day || date === day);

  return (
    <Shell allow={(u) => u.perm_admin}>
      <PageHeader
        title="Habilitar disponibilidad"
        subtitle="Abre la disponibilidad por fecha, de todo el día o de un horario, para que los árbitros se inscriban. Se cierra sola el día del torneo."
        action={
          <div className="flex flex-wrap gap-2">
            {byDate.size > 0 && (
              <AvailabilityImageButton
                label="Imagen de disponibilidad"
                fileName="disponibilidad-proximas-fechas"
                spec={async () => ({
                  title: "Árbitros disponibles",
                  subtitle: "Próximas fechas",
                  columns: summaryColumns(await api<SummaryRow[]>("/availability/summary"), true),
                })}
              />
            )}
            <button className="btn-primary" onClick={() => setDraft(emptyDraft())}><PlusIcon className="h-4 w-4" />Habilitar disponibilidad</button>
          </div>
        }
      />
      {msg && <div className="mb-4"><Alert>{msg}</Alert></div>}
      {loading && !data ? (
        <Loading variant="cards" />
      ) : error ? (
        <Alert>{error}</Alert>
      ) : byDate.size === 0 ? (
        <Empty icon={CalendarDaysIcon}>No hay disponibilidades habilitadas para las próximas fechas.</Empty>
      ) : (
        <div className="space-y-6">
          <DayFilter dates={[...byDate.keys()]} value={day} onChange={setDay} />
          {shown.map(([date, windows]) => (
            <section key={date} className="animate-slide-up">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <DateHeading date={date} />
                <AvailabilityImageButton
                  label="Imagen de esta fecha"
                  className="btn-ghost mb-2"
                  fileName={`disponibilidad-${date}`}
                  spec={async () => ({
                    title: "Árbitros disponibles",
                    subtitle: formatDate(date),
                    columns: summaryColumns(await api<SummaryRow[]>(`/availability/summary?d=${date}`), false),
                  })}
                />
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {windows.map((w) => (
                  <div key={w.id} className="card">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-lg font-semibold">{w.slot_label}</div>
                        {w.days.length ? (
                          <ul className="mt-1 space-y-0.5 text-sm text-stone-600">
                            {w.days.map((d) => (
                              <li key={d.id}>
                                <span className="font-medium text-ink">{d.tournament}</span> · {d.slot_label} · {d.required} árbitros
                                {w.hidden_tournament_ids.includes(d.tournament_id) && (
                                  <span className="ml-1 inline-flex align-middle" title="Los árbitros no ven el nombre de este torneo">
                                    <Badge color="violet"><EyeSlashIcon className="mr-0.5 h-3 w-3" />Nombre oculto</Badge>
                                  </span>
                                )}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="mt-1 text-sm italic text-stone-500">Sin franjas de torneo asociadas</p>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        {!w.open && <Badge color="stone"><LockClosedIcon className="mr-0.5 h-3 w-3" />Cerrada</Badge>}
                      </div>
                    </div>
                    <div className="mt-4">
                      <div className="mb-1 flex justify-between text-xs text-stone-500">
                        <span>{w.registered} inscritos</span>
                        <span>{w.required} necesarios</span>
                      </div>
                      <ProgressBar pct={Math.min(100, Math.round((w.registered / Math.max(1, w.required)) * 100))} />
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button className="btn-ghost" onClick={() => showList(w)}><UsersIcon className="h-4 w-4" />Inscritos</button>
                      {w.can_edit_guests && (
                        <button className="btn-ghost" onClick={() => setGuestsFor(w)}><UserPlusIcon className="h-4 w-4" />Agregar por nombre</button>
                      )}
                      <button className="btn-ghost" onClick={() => setDraft({
                        id: w.id, date: w.date, all_day: w.all_day, start_time: w.start_time ?? "", end_time: w.end_time ?? "",
                        day_ids: w.days.map((d) => d.id), hidden: w.hidden_tournament_ids,
                      })}><PencilSquareIcon className="h-4 w-4" />Editar</button>
                      <button className="btn-ghost text-red-700" onClick={() => remove(w)}><TrashIcon className="h-4 w-4" />Eliminar</button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
      <Modal open={!!draft} onClose={() => setDraft(null)} title={draft?.id ? "Editar disponibilidad" : "Habilitar disponibilidad"}>
        {draft && (
          <WindowForm key={draft.id ?? `new-${draft.date}`} initial={draft} onClose={() => setDraft(null)}
            onSaved={() => { setDraft(null); reload(); }} />
        )}
      </Modal>
      <Modal open={!!guestsFor} onClose={() => setGuestsFor(null)} title="Agregar árbitros por nombre">
        {guestsFor && (
          <>
            <p className="mb-3 text-sm font-medium">{formatDate(guestsFor.date)} · {guestsFor.slot_label}</p>
            <GuestsForm window={guestsFor} onChanged={(w) => { setGuestsFor(w); reload(); }} />
          </>
        )}
      </Modal>
      <Modal open={!!listFor} onClose={() => setListFor(null)} title="Árbitros inscritos">
        {listFor && <p className="mb-3 text-sm text-stone-500">{formatDate(listFor.date)} · {listFor.slot_label}</p>}
        {!list ? (
          <div className="space-y-3 py-1">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-5 w-full" />)}</div>
        ) : list.length === 0 ? (
          <p className="text-sm text-stone-500">Aún no hay árbitros inscritos.</p>
        ) : (
          <ol className="divide-y divide-stone-100">
            {list.map((r, i) => (
              <li key={i} className="flex justify-between py-2 text-sm">
                <span>{i + 1}. {r.name}</span>
                <span className="text-xs text-stone-400">{formatDateTime(r.since)}</span>
              </li>
            ))}
          </ol>
        )}
      </Modal>
    </Shell>
  );
}

export default function Page() {
  return <Suspense><WindowsPage /></Suspense>;
}
