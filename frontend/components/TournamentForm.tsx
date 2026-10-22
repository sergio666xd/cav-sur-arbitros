"use client";

import { useState } from "react";
import { Alert } from "./ui";

export type DayForm = { id?: number; date: string; all_day: boolean; start_time: string; end_time: string; referees_required: string };
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

export const emptyTournament: TournamentFormValue = {
  name: "",
  location: "",
  categories: [],
  referees_required: 4,
  is_visible: true,
  has_roles: false,
  roles: DEFAULT_ROLES,
  notes: "",
  days: [{ date: "", all_day: false, start_time: "08:00", end_time: "18:00", referees_required: "" }],
};

function nextDate(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return dt.toISOString().slice(0, 10);
}

function ListInput({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (v && !value.includes(v)) onChange([...value, v]);
    setDraft("");
  };
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
        <input className="input" value={draft} placeholder={placeholder} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); } }} />
        <button type="button" className="btn-secondary" onClick={add}>Añadir</button>
      </div>
    </div>
  );
}

export default function TournamentForm({
  initial,
  submitLabel,
  onSubmit,
}: {
  initial: TournamentFormValue;
  submitLabel: string;
  onSubmit: (body: unknown) => Promise<void>;
}) {
  const [v, setV] = useState<TournamentFormValue>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const setDay = (i: number, patch: Partial<DayForm>) => setV({ ...v, days: v.days.map((d, j) => (j === i ? { ...d, ...patch } : d)) });

  function addDay() {
    const last = v.days[v.days.length - 1];
    setV({ ...v, days: [...v.days, { ...last, id: undefined, date: nextDate(last?.date ?? "") }] });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
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
          <label className="label">Lugar</label>
          <input className="input" value={v.location} onChange={(e) => setV({ ...v, location: e.target.value })} required />
        </div>
        <div>
          <label className="label">Árbitros requeridos por día</label>
          <input className="input" type="number" min={1} value={v.referees_required}
            onChange={(e) => setV({ ...v, referees_required: Number(e.target.value) })} required />
        </div>
        <div className="md:col-span-2">
          <label className="label">Categorías</label>
          <ListInput value={v.categories} onChange={(categories) => setV({ ...v, categories })} placeholder="Ej. Sub-17 femenino" />
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
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Días y franjas horarias</h2>
          <button type="button" className="btn-secondary" onClick={addDay}>+ Añadir día</button>
        </div>
        <div className="space-y-3">
          {v.days.map((d, i) => (
            <div key={i} className="grid items-end gap-3 rounded-lg border border-stone-200 p-3 sm:grid-cols-6">
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
                {v.days.length > 1 && (
                  <button type="button" className="btn-ghost self-end px-2 text-red-600" title="Quitar día"
                    onClick={() => setV({ ...v, days: v.days.filter((_, j) => j !== i) })}>✕</button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      {error && <Alert>{error}</Alert>}
      <button className="btn-primary" disabled={busy}>{busy ? "Guardando..." : submitLabel}</button>
    </form>
  );
}
