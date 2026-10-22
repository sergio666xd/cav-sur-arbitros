"use client";

import { useEffect, useId, useState } from "react";
import { api } from "@/lib/api";
import { Alert } from "./ui";

export type DayForm = {
  id?: number;
  date: string;
  all_day: boolean;
  start_time: string;
  end_time: string;
  referees_required: string;
  custom: boolean; // lugar y categorías propios de la franja
  location: string;
  categories: string[];
};
export type TournamentFormValue = {
  name: string;
  location: string;
  categories: string[];
  referees_required: number;
  is_visible: boolean;
  has_roles: boolean;
  roles: string[];
  notes: string;
  days: DayForm[];
};

export const DEFAULT_ROLES = ["Principal", "Segundo", "Planillero"];

export const emptyDay: DayForm = {
  date: "",
  all_day: false,
  start_time: "08:00",
  end_time: "18:00",
  referees_required: "",
  custom: false,
  location: "",
  categories: [],
};

export const emptyTournament: TournamentFormValue = {
  name: "",
  location: "",
  categories: [],
  referees_required: 4,
  is_visible: true,
  has_roles: false,
  roles: DEFAULT_ROLES,
  notes: "",
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
          <span key={c} className="badge bg-brand-100 text-brand-800">
            {c}
            <button type="button" className="ml-1 text-brand-600 hover:text-brand-900" onClick={() => onChange(value.filter((x) => x !== c))}>×</button>
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

function LocationInput({ value, onChange, placeholder, required, options }: {
  value: string; onChange: (v: string) => void; placeholder?: string; required?: boolean; options: string[];
}) {
  const listId = useId();
  return (
    <>
      <input className="input" value={value} placeholder={placeholder} list={listId} required={required}
        onChange={(e) => onChange(e.target.value)} autoComplete="off" />
      <datalist id={listId}>{options.map((o) => <option key={o} value={o} />)}</datalist>
    </>
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

  function addDay() {
    const last = v.days[v.days.length - 1];
    setV({ ...v, days: [...v.days, last ? { ...last, id: undefined, date: nextDate(last.date) } : { ...emptyDay }] });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!v.location.trim() && v.days.some((d) => !d.custom || !d.location.trim())) {
      setError("Indica el lugar del torneo o el de cada franja.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        ...v,
        roles: v.has_roles ? v.roles : [],
        days: v.days.map((d) => ({
          id: d.id,
          date: d.date,
          all_day: d.all_day,
          start_time: d.all_day ? null : d.start_time,
          end_time: d.all_day ? null : d.end_time,
          referees_required: d.referees_required ? Number(d.referees_required) : null,
          location: d.custom ? d.location : null,
          categories: d.custom && d.categories.length ? d.categories : null,
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
        <div>
          <label className="label">Lugar del torneo</label>
          <LocationInput value={v.location} onChange={(location) => setV({ ...v, location })} options={locations}
            placeholder="Se usa en todas las franjas salvo que indiques otro" />
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
          <input type="checkbox" className="mt-0.5 h-5 w-5 accent-brand-500" checked={v.is_visible} onChange={(e) => setV({ ...v, is_visible: e.target.checked })} />
          <span><b>Información visible</b><br /><span className="text-stone-500">Si no, los árbitros solo verán la fecha y la franja.</span></span>
        </label>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-0.5 h-5 w-5 accent-brand-500" checked={v.has_roles} onChange={(e) => setV({ ...v, has_roles: e.target.checked })} />
          <span><b>Torneo con roles</b><br /><span className="text-stone-500">Cada árbitro asignado recibe un rol, p. ej. Principal, Segundo y Planillero.</span></span>
        </label>
        {v.has_roles && (
          <div className="md:col-span-2">
            <label className="label">Roles</label>
            <ListInput value={v.roles} onChange={(roles) => setV({ ...v, roles })} placeholder="Nuevo rol" />
          </div>
        )}
      </div>

      <div className="card">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="font-semibold">Fechas y franjas</h2>
          <button type="button" className="btn-secondary" onClick={addDay}>+ Añadir franja</button>
        </div>
        {pastCount > 0 && (
          <p className="mb-3 text-sm text-stone-500">Este torneo tiene {pastCount} fecha(s) anterior(es); se conservan con sus asignaciones y partidos.</p>
        )}
        {v.days.length === 0 && <p className="py-4 text-sm text-stone-500">Sin fechas próximas. Añade una franja para reutilizar el torneo.</p>}
        <div className="mt-3 space-y-3">
          {v.days.map((d, i) => (
            <div key={i} className="rounded-lg border border-stone-200 p-3">
              <div className="grid items-end gap-3 sm:grid-cols-6">
                <div className="sm:col-span-2">
                  <label className="label">Fecha</label>
                  <input className="input" type="date" value={d.date} onChange={(e) => setDay(i, { date: e.target.value })} required />
                </div>
                <label className="flex items-center gap-2 pb-2 text-sm">
                  <input type="checkbox" className="h-5 w-5 accent-brand-500" checked={d.all_day} onChange={(e) => setDay(i, { all_day: e.target.checked })} />
                  Todo el día
                </label>
                {!d.all_day ? (
                  <>
                    <div>
                      <label className="label">Desde</label>
                      <input className="input" type="time" value={d.start_time} onChange={(e) => setDay(i, { start_time: e.target.value })} required />
                    </div>
                    <div>
                      <label className="label">Hasta</label>
                      <input className="input" type="time" value={d.end_time} onChange={(e) => setDay(i, { end_time: e.target.value })} required />
                    </div>
                  </>
                ) : (
                  <div className="sm:col-span-2" />
                )}
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="label" title="Vacío = el valor general del torneo">Árbitros</label>
                    <input className="input" type="number" min={1} placeholder={String(v.referees_required)} value={d.referees_required}
                      onChange={(e) => setDay(i, { referees_required: e.target.value })} />
                  </div>
                  <button type="button" className="btn-ghost self-end px-2 text-red-600" title="Quitar franja"
                    onClick={() => setV({ ...v, days: v.days.filter((_, j) => j !== i) })}>✕</button>
                </div>
              </div>
              <label className="mt-3 flex items-center gap-2 text-sm text-stone-600">
                <input type="checkbox" className="h-4 w-4 accent-brand-500" checked={d.custom}
                  onChange={(e) => setDay(i, { custom: e.target.checked })} />
                Lugar y categorías propios para esta franja
              </label>
              {d.custom && (
                <div className="mt-3 grid gap-3 border-t border-stone-100 pt-3 md:grid-cols-2">
                  <div>
                    <label className="label">Lugar de la franja</label>
                    <LocationInput value={d.location} onChange={(location) => setDay(i, { location })} options={locations}
                      placeholder={v.location || "Lugar"} required={!v.location.trim()} />
                  </div>
                  <div>
                    <label className="label">Categorías de la franja</label>
                    <ListInput value={d.categories} onChange={(c) => setDay(i, { categories: c })}
                      placeholder={v.categories.join(", ") || "Categoría"} suggestions={categories} />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      {error && <Alert>{error}</Alert>}
      <button className="btn-primary" disabled={busy}>{busy ? "Guardando..." : submitLabel}</button>
    </form>
  );
}
