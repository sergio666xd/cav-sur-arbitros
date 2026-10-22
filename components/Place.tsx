"use client";

import { useState } from "react";
import { mapsEmbed, mapsLink } from "@/lib/maps";

/** Muestra un lugar con enlace a Google Maps y, si hay clave, un mapa desplegable. */
export default function Place({ place, className = "", defaultOpen = false }: { place: string; className?: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  if (!place) return null;
  const embed = mapsEmbed(place);
  return (
    <div className={className}>
      <span className="inline-flex flex-wrap items-center gap-x-2">
        <span>📍 {place}</span>
        {embed ? (
          <button type="button" className="text-xs font-medium text-brand-700 hover:underline" onClick={() => setOpen(!open)}>
            {open ? "Ocultar mapa" : "Ver mapa"}
          </button>
        ) : (
          <a href={mapsLink(place)} target="_blank" rel="noreferrer" className="text-xs font-medium text-brand-700 hover:underline">
            Abrir en Google Maps ↗
          </a>
        )}
      </span>
      {embed && open && (
        <div className="mt-2 overflow-hidden rounded-lg border border-stone-200">
          <iframe title={`Mapa de ${place}`} src={embed} className="h-56 w-full" loading="lazy" referrerPolicy="no-referrer-when-downgrade" allowFullScreen />
          <a href={mapsLink(place)} target="_blank" rel="noreferrer" className="block bg-stone-50 px-3 py-1.5 text-right text-xs text-brand-700 hover:underline">
            Abrir en Google Maps ↗
          </a>
        </div>
      )}
    </div>
  );
}
