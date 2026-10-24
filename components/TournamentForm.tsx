"use client";

import { ChevronDownIcon, MapPinIcon, PlusIcon, XMarkIcon } from "@heroicons/react/20/solid";
import { useEffect, useId, useState } from "react";
import { api, formatClock, formatShortDate } from "@/lib/api";
import { shortAddress } from "@/lib/maps";
import DateInput from "./DateInput";
import PlaceInput from "./PlaceInput";
import type { UserRow } from "./RoleBadges";
import { Alert, Badge, Spinner } from "./ui";

export type DayForm = {
  id?: number;
  key?: number; // Clave estable en la lista (solo en el formulario).
  date: string;
  all_day: boolean;
  start_time: string;
  end_time: string;
  referees_required: string;
  custom: boolean; // categorías propias de la franja
  location: string; // sede elegida entre las del torneo
  categories: string[];
  specification: string;
  hidden: boolean; // no sale en Disponibilidad; se asigna a cualquier árbitro
};
export type TournamentFormValue = {
  name: string;
  venues: string[];
  categories: string[];
  referees_required: number;
  is_visible: boolean;
  show_required: boolean;
  has_roles: boolean;
  roles: string[];
  notes: string;
  admin_ids: number[];
  days: DayForm[];
};

export const DEFAULT_ROLES = ["Principal", "Segundo", "Planillero"];

let nextKey = 1;

const rowKey = (d: DayForm, i: number) => String(d.key ?? (d.id ? `id${d.id}` : `i${i}`));

// Resumen de una franja plegada: "Vie 23/10/2026 · 8:00 a. m. – 12:00 p. m."
function daySummary(d: DayForm): string {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(d.date) ? formatShortDate(d.date) : "Sin fecha";
  const start = d.start_time ? formatClock(d.start_time) : "";
  const time = d.all_day ? `Todo el día${start ? ` desde ${start}` : ""}` : `${start}${d.end_time ? ` – ${formatClock(d.end_time)}` : ""}`;
  return [date, time].filter(Boolean).join(" · ");
}

export const emptyDay: DayForm = {
  date: "",
  all_day: false,
  start_time: "08:00",
  end_time: "",
  referees_required: "",
  custom: false,
  location: "",
  categories: [],
  specification: "",
  hidden: false,
};

export const emptyTournament: TournamentFormValue = {
  name: "",
  venues: [""],
  categories: [],
  referees_required: 4,
  is_visible: true,
  show_required: true,
  has_roles: false,
  roles: DEFAULT_ROLES,
  notes: "",
  admin_ids: [],
  days: [emptyDay],
};

function nextDate(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

type Saved = { id: number; name: string };

function useCatalog(kind: "location" | "category") {
  const [values, setValues] = useState<string[]>([]);
  useEffect(() => {
    api<Saved[]>(`/catalog/${kind}`).then((v) => setValues(v.map((x) => x.name))).catch(() => setValues([]));
  }, [kind]);
  return values;
}

function ListInput({
  value,
  onChange,
  placeholder,
  suggestions = [],
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
  suggestions?: string[];
}) {
  const [draft, setDraft] = useState("");
  const listId = useId();
  const add = (raw = draft) => {
    const v = raw.trim();
    if (v && !value.includes(v)) onChange([...value, v]);
    setDraft("");
  };
  const quick = suggestions.filter((s) => !value.includes(s)).slice(0, 8);
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-1">
        {value.map((c) => (
          <span key={c} className="badge animate-pop bg-brand-100 text-brand-800">
            {c}
            <button type="button" className="ml-1 text-brand-600 transition hover:text-brand-900" aria-label={`Quitar ${c}`} onClick={() => onChange(value.filter((x) => x !== c))}><XMarkIcon className="h-3.5 w-3.5" /></button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input className="input" value={draft} placeholder={placeholder} list={listId}
          onChange={(e) => {
            // Elegir una opción del autocompletado la añade directamente.
            if (suggestions.includes(e.target.value)) add(e.target.value);
            else setDraft(e.target.value);
          }}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); } }} />
        <button type="button" className="btn-secondary" onClick={() => add()}>Añadir</button>
      </div>
      <datalist id={listId}>{suggestions.map((s) => <option key={s} value={s} />)}</datalist>
      {quick.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {quick.map((s) => (
            <button key={s} type="button" onClick={() => add(s)}
              className="rounded-full border border-dashed border-stone-300 px-2 py-0.5 text-xs text-stone-600 hover:border-brand-400 hover:text-brand-700">
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function TournamentForm({
  initial,
  submitLabel,
  onSubmit,
  pastCount = 0,
}: {
  initial: TournamentFormValue;
  submitLabel: string;
  onSubmit: (body: unknown) => Promise<void>;
  pastCount?: number;
}) {
  const [v, setV] = useState<TournamentFormValue>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const locations = useCatalog("location");
  const categories = useCatalog("category");

  const setDay = (i: number, patch: Partial<DayForm>) => setV({ ...v, days: v.days.map((d, j) => (j === i ? { ...d, ...patch } : d)) });

  // El botón de arriba añade la franja al principio (copia de la primera, misma fecha) y el de abajo al final.
  function addDay(atStart = false) {
    const key = nextKey++;
    setOpen((o) => new Set(o).add(String(key)));
    const first = v.days[0];
    if (atStart && first) {
      setV({ ...v, days: [{ ...first, id: undefined, key }, ...v.days] });
      return;
    }
    const last = v.days[v.days.length - 1];
    setV({ ...v, days: [...v.days, last ? { ...last, id: undefined, key, date: nextDate(last.date) } : { ...emptyDay, key }] });
  }

  // Franjas desplegadas. Las del torneo guardado empiezan plegadas; las nuevas, abiertas.
  const [open, setOpen] = useState<Set<string>>(() => new Set(v.days.filter((d) => !d.id).map(rowKey)));
  const toggle = (k: string) => setOpen((o) => {
    const n = new Set(o);
    if (n.has(k)) n.delete(k); else n.add(k);
    return n;
  });
  // Si al guardar falta un dato en una franja plegada, se despliega y se señala el campo.
  function revealInvalid(k: string, e: React.FormEvent) {
    if (open.has(k)) return;
    const el = e.target as HTMLInputElement;
    setOpen((o) => new Set(o).add(k));
    requestAnimationFrame(() => el.reportValidity());
  }

  const venues = v.venues.map((x) => x.trim()).filter(Boolean);
  const multi = venues.length > 1;

  function setVenue(i: number, value: string) {
    const old = v.venues[i];
    setV({
      ...v,
      venues: v.venues.map((x, j) => (j === i ? value : x)),
      // Las franjas que tenían esta sede siguen con ella aunque cambie el texto.
      days: v.days.map((d) => (old && d.location === old ? { ...d, location: value } : d)),
    });
  }

  function removeVenue(i: number) {
    const old = v.venues[i];
    const rest = v.venues.filter((_, j) => j !== i);
    setV({
      ...v,
      venues: rest.length ? rest : [""],
      days: v.days.map((d) => (d.location === old ? { ...d, location: "" } : d)),
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!venues.length) {
      setError("Añade al menos una sede del torneo.");
      return;
    }
    if (multi && v.days.some((d) => !venues.includes(d.location.trim()))) {
      setError("Elige la sede de cada franja.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        ...v,
        venues,
        roles: v.has_roles ? v.roles : [],
        days: v.days.map((d) => ({
          id: d.id,
          date: d.date,
          all_day: d.all_day,
          start_time: d.start_time,
          end_time: d.all_day || !d.end_time ? null : d.end_time,
          referees_required: d.referees_required ? Number(d.referees_required) : null,
          location: multi ? d.location.trim() : venues[0],
          categories: d.custom && d.categories.length ? d.categories : null,
          specification: d.specification.trim() || null,
          hidden: d.hidden,
        })),
      });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <div className="card grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2">
          <label className="label">Nombre del torneo</label>
          <input className="input" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} required />
        </div>
        <div className="md:col-span-2">
          <label className="label">Sedes del torneo</label>
          <div className="space-y-2">
            {v.venues.map((venue, i) => (
              <div key={i} className="flex animate-slide-down gap-2">
                <div className="flex-1">
                  <PlaceInput value={venue} onChange={(x) => setVenue(i, x)} saved={locations.filter((l) => !v.venues.includes(l))}
                    placeholder={i === 0 ? "Sede principal" : "Otra sede"} required={i === 0} />
                </div>
                {v.venues.length > 1 && (
                  <button type="button" className="btn-ghost px-2 text-red-600" title="Quitar sede" aria-label="Quitar sede" onClick={() => removeVenue(i)}><XMarkIcon className="h-5 w-5" /></button>
                )}
              </div>
            ))}
          </div>
          <button type="button" className="btn-ghost mt-2 px-2 text-sm text-brand-700" onClick={() => setV({ ...v, venues: [...v.venues, ""] })}>
            <PlusIcon className="h-4 w-4" />Añadir sede
          </button>
        </div>
        <div>
          <label className="label">Árbitros requeridos por franja</label>
          <input className="input" type="number" min={1} value={v.referees_required}
            onChange={(e) => setV({ ...v, referees_required: Number(e.target.value) })} required />
        </div>
        <div className="md:col-span-2">
          <label className="label">Categorías del torneo</label>
          <ListInput value={v.categories} onChange={(c) => setV({ ...v, categories: c })} placeholder="Ej. Sub-17 femenino" suggestions={categories} />
        </div>
        <div className="md:col-span-2">
          <label className="label">Notas para los árbitros asignados</label>
          <textarea className="input min-h-20" value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} />
        </div>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-0.5 switch" checked={v.is_visible} onChange={(e) => setV({ ...v, is_visible: e.target.checked })} />
          <span><b>Información visible</b><br /><span className="text-stone-500">Si no, los árbitros solo verán el nombre del torneo, la fecha y la franja.</span></span>
        </label>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-0.5 switch" checked={v.show_required} onChange={(e) => setV({ ...v, show_required: e.target.checked })} />
          <span><b>Árbitros requeridos visibles</b><br /><span className="text-stone-500">Si no, en Disponibilidad los árbitros solo verán cuántos se han inscrito en cada franja.</span></span>
        </label>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-0.5 switch" checked={v.has_roles} onChange={(e) => setV({ ...v, has_roles: e.target.checked })} />
          <span><b>Torneo con roles</b><br /><span className="text-stone-500">Cada árbitro asignado recibe un rol, p. ej. Principal, Segundo y Planillero.</span></span>
        </label>
        {v.has_roles && (
          <div className="md:col-span-2">
            <label className="label">Roles</label>
            <ListInput value={v.roles} onChange={(roles) => setV({ ...v, roles })} placeholder="Nuevo rol" />
          </div>
        )}
        <div className="md:col-span-2">
          <AdminPicker value={v.admin_ids} onChange={(admin_ids) => setV({ ...v, admin_ids })} />
        </div>
      </div>

      <div className="card">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="font-semibold">Fechas y franjas</h2>
          <button type="button" className="btn-secondary" onClick={() => addDay(true)}><PlusIcon className="h-4 w-4" />Añadir franja</button>
        </div>
        {pastCount > 0 && (
          <p className="mb-3 text-sm text-stone-500">Este torneo tiene {pastCount} fecha(s) anterior(es); se conservan con sus asignaciones y partidos.</p>
        )}
        {v.days.length === 0 && <p className="py-4 text-sm text-stone-500">{pastCount > 0 ? "Sin fechas próximas. Añade una franja para reutilizar el torneo." : "Sin franjas todavía. Puedes guardar el torneo y añadirlas más tarde."}</p>}
        <div className="mt-3 space-y-3">
          {v.days.map((d, i) => {
            const k = rowKey(d, i);
            const isOpen = open.has(k);
            const place = multi && venues.includes(d.location) ? shortAddress(d.location) : "";
            return (
            <div key={k} className="animate-slide-down rounded-lg border border-stone-200" onInvalidCapture={(e) => revealInvalid(k, e)}>
              <div className="flex items-center gap-2 px-3 py-2">
                <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => toggle(k)} aria-expanded={isOpen}>
                  <ChevronDownIcon className={`h-5 w-5 shrink-0 text-stone-400 transition-transform duration-200 ${isOpen ? "" : "-rotate-90"}`} />
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{daySummary(d)}</span>
                      {d.hidden && <Badge color="violet">Oculta</Badge>}
                    </span>
                    {(place || d.specification || d.referees_required) && (
                      <span className="block truncate text-xs text-stone-500">
                        {[place, d.specification, d.referees_required && `${d.referees_required} árbitros`].filter(Boolean).join(" · ")}
                      </span>
                    )}
                  </span>
                </button>
                <button type="button" className="btn-ghost shrink-0 px-2 text-red-600" title="Quitar franja"
                  onClick={() => setV({ ...v, days: v.days.filter((_, j) => j !== i) })}><XMarkIcon className="h-5 w-5" /></button>
              </div>
              <div className={`border-t border-stone-100 p-3 ${isOpen ? "" : "hidden"}`}>
              <div className="grid items-end gap-3 sm:grid-cols-6">
                <div className="sm:col-span-2">
                  <label className="label">Fecha</label>
                  <DateInput value={d.date} onChange={(v) => setDay(i, { date: v })} required />
                </div>
                <label className="flex items-center gap-2 pb-2 text-sm">
                  <input type="checkbox" className="switch" checked={d.all_day} onChange={(e) => setDay(i, { all_day: e.target.checked })} />
                  Todo el día
                </label>
                <div>
                  <label className="label">Desde</label>
                  <input className="input" type="time" value={d.start_time} onChange={(e) => setDay(i, { start_time: e.target.value })} required />
                </div>
                {!d.all_day ? (
                  <div>
                    <label className="label" title="Si no se sabe, déjala vacía: se toma hasta las 23:59">Hasta (opcional)</label>
                    <input className="input" type="time" value={d.end_time} onChange={(e) => setDay(i, { end_time: e.target.value })} />
                  </div>
                ) : (
                  <div className="hidden sm:block" />
                )}
                <div>
                  <label className="label" title="Vacío = el valor general del torneo">Árbitros</label>
                  <input className="input" type="number" min={1} placeholder={String(v.referees_required)} value={d.referees_required}
                    onChange={(e) => setDay(i, { referees_required: e.target.value })} />
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2">
                {multi ? (
                  <div className="flex min-w-64 flex-1 items-center gap-2">
                    <label className="label mb-0 shrink-0">Sede</label>
                    <select className="input py-1.5" value={venues.includes(d.location) ? d.location : ""}
                      onChange={(e) => setDay(i, { location: e.target.value })} required>
                      <option value="" disabled>Elige la sede...</option>
                      {venues.map((x) => <option key={x} value={x} title={x}>{shortAddress(x)}</option>)}
                    </select>
                  </div>
                ) : venues[0] ? (
                  <span className="inline-flex items-center gap-1 text-sm text-stone-500"><MapPinIcon className="h-4 w-4 text-brand-500" />{shortAddress(venues[0])}</span>
                ) : null}
                <label className="flex items-center gap-2 text-sm text-stone-600">
                  <input type="checkbox" className="switch" checked={d.custom}
                    onChange={(e) => setDay(i, { custom: e.target.checked })} />
                  Categorías propias para esta franja
                </label>
                <label className="flex items-center gap-2 text-sm text-stone-600"
                  title="Para eventos privados: no sale en Disponibilidad y se puede asignar a cualquier árbitro.">
                  <input type="checkbox" className="switch" checked={d.hidden}
                    onChange={(e) => setDay(i, { hidden: e.target.checked })} />
                  Franja oculta (no sale en Disponibilidad)
                </label>
              </div>
              {d.custom && (
                <div className="mt-3 border-t border-stone-100 pt-3">
                  <label className="label">Categorías de la franja</label>
                  <ListInput value={d.categories} onChange={(c) => setDay(i, { categories: c })}
                    placeholder={v.categories.join(", ") || "Categoría"} suggestions={categories} />
                </div>
              )}
              <div className="mt-3">
                <label className="label" title="Sale en la imagen de asignación">Especificación (opcional)</label>
                <input className="input" maxLength={300} value={d.specification} placeholder="Ej. Final, cancha 2"
                  onChange={(e) => setDay(i, { specification: e.target.value })} />
              </div>
              </div>
            </div>
            );
          })}
        </div>
        {v.days.length > 0 && (
          <div className="mt-3 flex justify-end">
            <button type="button" className="btn-secondary" onClick={() => addDay()}><PlusIcon className="h-4 w-4" />Añadir franja</button>
          </div>
        )}
      </div>
      {error && <Alert>{error}</Alert>}
      <button className="btn-primary" disabled={busy}>{busy ? <><Spinner />Guardando...</> : submitLabel}</button>
    </form>
  );
}

// Administradores que gestionan el torneo: solo ellos (y el Jefe) lo ven en Torneos, Asignación y Disponibilidad.
function AdminPicker({ value, onChange }: { value: number[]; onChange: (ids: number[]) => void }) {
  const [admins, setAdmins] = useState<UserRow[] | null>(null);
  useEffect(() => {
    api<UserRow[]>("/users").then((u) => setAdmins(u.filter((x) => x.is_admin && !x.is_chief && !x.is_system && x.active))).catch(() => setAdmins([]));
  }, []);
  const toggle = (id: number) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <>
      <label className="label">Coordinadores del torneo</label>
      <p className="mb-2 text-sm text-stone-500">Solo ellos y el Jefe podrán ver y gestionar este torneo.</p>
      {admins === null ? (
        <Spinner />
      ) : admins.length === 0 ? (
        <p className="text-sm text-stone-500">No hay coordinadores. Dale el rol a alguien desde Árbitros.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {admins.map((a) => {
            const on = value.includes(a.id);
            return (
              <button key={a.id} type="button" aria-pressed={on} onClick={() => toggle(a.id)}
                className={`rounded-full border px-3 py-1 text-sm transition active:scale-95 ${on ? "border-brand-500 bg-brand-500 font-semibold text-white" : "border-stone-300 hover:border-brand-500"}`}>
                {a.first_name} {a.last_name}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}
