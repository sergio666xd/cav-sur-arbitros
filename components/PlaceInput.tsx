"use client";

import { MapIcon, MapPinIcon, StarIcon } from "@heroicons/react/20/solid";
import { useEffect, useRef, useState } from "react";
import MapPicker from "./MapPicker";
import { MAPS_KEY, newSession, suggestPlaces, type PlaceSuggestion } from "@/lib/maps";
import { fold } from "@/lib/text";

type Option = { key: string; text: string; secondary: string; saved: boolean; pick: () => Promise<string> };

/** Campo de lugar: sugiere lugares guardados y, si hay clave de Google Maps, direcciones de Google. */
export default function PlaceInput({ value, onChange, placeholder, required, saved }: {
  value: string; onChange: (v: string) => void; placeholder?: string; required?: boolean; saved: string[];
}) {
  const [open, setOpen] = useState(false);
  const [google, setGoogle] = useState<PlaceSuggestion[]>([]);
  const [active, setActive] = useState(-1);
  const [picker, setPicker] = useState(false);
  const session = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const typed = useRef(false);

  useEffect(() => {
    if (!MAPS_KEY || !open || !typed.current) return;
    const q = value;
    const t = setTimeout(async () => {
      if (!session.current) session.current = await newSession();
      const s = await suggestPlaces(q, session.current);
      setGoogle(s);
    }, 250);
    return () => clearTimeout(t);
  }, [value, open]);

  const term = fold(value.trim());
  const options: Option[] = [
    ...saved
      .filter((s) => s !== value && (!term || fold(s).includes(term)))
      .slice(0, 5)
      .map((s) => ({ key: "s:" + s, text: s, secondary: "Guardado", saved: true, pick: async () => s })),
    ...google.map((g, i) => ({ key: "g:" + i + g.text, text: g.text, secondary: g.secondary, saved: false, pick: g.pick })),
  ];

  async function choose(o: Option) {
    setOpen(false);
    setGoogle([]);
    typed.current = false;
    onChange(await o.pick());
    session.current = null; // La sesión de Google termina al elegir un lugar.
  }

  return (
    <div className="relative">
      <div className="flex gap-2">
        <input
          className="input"
          value={value}
          placeholder={placeholder}
          required={required}
          autoComplete="off"
          role="combobox"
          aria-expanded={open && options.length > 0}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onChange={(e) => { typed.current = true; setActive(-1); setOpen(true); onChange(e.target.value); }}
          onKeyDown={(e) => {
            if (!open || options.length === 0) return;
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, options.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
            else if (e.key === "Enter" && active >= 0) { e.preventDefault(); choose(options[active]); }
            else if (e.key === "Escape") setOpen(false);
          }}
        />
        {MAPS_KEY && (
          <button type="button" className="btn-secondary shrink-0 px-3" title="Elegir en el mapa" onClick={() => setPicker(true)}>
            <MapIcon className="h-4 w-4" /><span className="hidden sm:inline">Mapa</span>
          </button>
        )}
      </div>
      {MAPS_KEY && (
        <MapPicker open={picker} initial={value} onClose={() => setPicker(false)} onPick={(p) => { typed.current = false; onChange(p); }} />
      )}
      {open && options.length > 0 && (
        <ul className="absolute z-30 mt-1 max-h-72 animate-slide-down w-full overflow-y-auto rounded-lg border border-stone-200 bg-white py-1 text-sm shadow-lg" role="listbox">
          {options.map((o, i) => (
            <li key={o.key} role="option" aria-selected={i === active}>
              <button
                type="button"
                className={`flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-brand-50 ${i === active ? "bg-brand-50" : ""}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(o)}
              >
                {o.saved ? <StarIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" /> : <MapPinIcon className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />}
                <span>
                  <span className="block font-medium text-ink">{o.text}</span>
                  {o.secondary && <span className="block text-xs text-stone-500">{o.secondary}</span>}
                </span>
              </button>
            </li>
          ))}
          {!options[options.length - 1].saved && (
            <li className="px-3 pt-1 text-right text-[10px] text-stone-400">Sugerencias de Google</li>
          )}
        </ul>
      )}
    </div>
  );
}
