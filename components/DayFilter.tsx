"use client";

import { formatShortDate } from "@/lib/api";

/** Botones para filtrar por fecha: "Todos" y una opción por cada fecha (AAAA-MM-DD). */
export default function DayFilter({ dates, value, onChange }: { dates: string[]; value: string; onChange: (d: string) => void }) {
  if (dates.length < 2) return null;
  const chip = (active: boolean) =>
    `shrink-0 rounded-full border px-3 py-1.5 text-sm transition active:scale-95 ${
      active ? "border-brand-500 bg-brand-500 text-white shadow-sm" : "border-stone-300 bg-white hover:border-brand-400"
    }`;
  return (
    <div className="-mx-4 mb-5 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0" role="group" aria-label="Filtrar por día">
      <button type="button" className={chip(!value)} onClick={() => onChange("")}>Todos</button>
      {dates.map((d) => (
        <button key={d} type="button" className={chip(value === d)} onClick={() => onChange(d)}>
          {formatShortDate(d)}
        </button>
      ))}
    </div>
  );
}

/** Fechas únicas y ordenadas. */
export function uniqueDates(dates: string[]): string[] {
  return [...new Set(dates)].sort();
}
