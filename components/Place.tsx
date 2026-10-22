"use client";

import { ArrowTopRightOnSquareIcon, MapPinIcon } from "@heroicons/react/20/solid";
import { useState } from "react";
import { mapsEmbed, mapsLink, shortAddress } from "@/lib/maps";

/**
 * Muestra la dirección corta de un lugar, con un enlace para ver la completa, otro a Google Maps
 * y, si hay clave, un mapa desplegable.
 */
export default function Place({ place, className = "", defaultOpen = false }: { place: string; className?: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [full, setFull] = useState(false);
  if (!place) return null;
  const embed = mapsEmbed(place);
  const short = shortAddress(place);
  const link = "text-xs font-medium text-brand-700 hover:underline";
  return (
    <div className={className}>
      <span className="inline-flex items-start gap-1">
        <MapPinIcon className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />
        <span>
          {full ? place : short}
          <span className="ml-2 inline-flex flex-wrap gap-x-2">
            {short !== place && (
              <button type="button" className={link} onClick={() => setFull(!full)}>
                {full ? "Ocultar dirección" : "Dirección completa"}
              </button>
            )}
            {embed ? (
              <button type="button" className={link} onClick={() => setOpen(!open)}>
                {open ? "Ocultar mapa" : "Ver mapa"}
              </button>
            ) : (
              <a href={mapsLink(place)} target="_blank" rel="noreferrer" className={link}>
                Google Maps <ArrowTopRightOnSquareIcon className="inline h-3 w-3" />
              </a>
            )}
          </span>
        </span>
      </span>
      {embed && open && (
        <div className="mt-2 animate-slide-down overflow-hidden rounded-lg border border-stone-200">
          <iframe title={`Mapa de ${short}`} src={embed} className="h-56 w-full" loading="lazy" allowFullScreen />
          <a href={mapsLink(place)} target="_blank" rel="noreferrer" className="block bg-stone-50 px-3 py-1.5 text-right text-xs text-brand-700 hover:underline">
            Abrir en Google Maps <ArrowTopRightOnSquareIcon className="inline h-3 w-3" />
          </a>
        </div>
      )}
    </div>
  );
}
