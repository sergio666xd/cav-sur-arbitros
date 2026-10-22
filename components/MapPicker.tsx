"use client";

import { useEffect, useRef, useState } from "react";
import { loadGeocoding, loadMapsLib, loadPlaces, placeLabel } from "@/lib/maps";
import { Modal } from "./ui";

const BOGOTA = { lat: 4.711, lng: -74.0721 };

type Picked = { label: string; pos: google.maps.LatLngLiteral };

/** Ventana con un mapa: clic (o arrastrar el marcador) para elegir el lugar. */
export default function MapPicker({ open, initial, onClose, onPick }: {
  open: boolean; initial: string; onClose: () => void; onPick: (place: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPicked(null);
    setStatus("loading");
    (async () => {
      const [maps, places, geocoding] = await Promise.all([loadMapsLib(), loadPlaces(), loadGeocoding()]);
      if (cancelled || !box.current) return;
      if (!maps) return setStatus("error");

      // Centrar en el lugar escrito, si Google lo encuentra.
      let center: google.maps.LatLngLiteral = BOGOTA;
      let zoom = 12;
      if (initial.trim() && places) {
        try {
          const { places: found } = await places.Place.searchByText({ textQuery: initial, fields: ["location"], maxResultCount: 1, region: "co" });
          const loc = found[0]?.location;
          if (loc) { center = loc.toJSON(); zoom = 16; }
        } catch { /* se queda en Bogotá */ }
      }
      if (cancelled || !box.current) return;

      const map = new maps.Map(box.current, { center, zoom, streetViewControl: false, mapTypeControl: false, clickableIcons: true });
      const marker = new google.maps.Marker({ map, draggable: true, visible: false });
      const geocoder = geocoding ? new geocoding.Geocoder() : null;

      async function describe(pos: google.maps.LatLngLiteral, placeId?: string) {
        setResolving(true);
        let label = "";
        try {
          if (placeId && places) {
            const p = new places.Place({ id: placeId });
            await p.fetchFields({ fields: ["displayName", "formattedAddress"] });
            label = placeLabel(p.displayName, p.formattedAddress);
          } else if (geocoder) {
            const { results } = await geocoder.geocode({ location: pos });
            label = results[0]?.formatted_address ?? "";
          }
        } catch { /* sin dirección: se usan las coordenadas */ }
        if (!cancelled) {
          setPicked({ pos, label: label || `${pos.lat.toFixed(6)},${pos.lng.toFixed(6)}` });
          setResolving(false);
        }
      }

      function place(pos: google.maps.LatLngLiteral, placeId?: string) {
        marker.setPosition(pos);
        marker.setVisible(true);
        describe(pos, placeId);
      }

      map.addListener("click", (e: google.maps.MapMouseEvent | google.maps.IconMouseEvent) => {
        if (!e.latLng) return;
        const placeId = "placeId" in e ? e.placeId ?? undefined : undefined;
        if (placeId) e.stop(); // Evita la ventanita de información de Google.
        place(e.latLng.toJSON(), placeId);
      });
      marker.addListener("dragend", () => {
        const p = marker.getPosition();
        if (p) place(p.toJSON());
      });
      setStatus("ready");
    })();
    return () => { cancelled = true; };
  }, [open, initial]);

  return (
    <Modal open={open} onClose={onClose} title="Elegir en el mapa">
      <p className="mb-2 text-sm text-stone-500">Haz clic en el lugar (o en un sitio marcado en el mapa). Puedes arrastrar el marcador para ajustarlo.</p>
      <div className="relative h-80 overflow-hidden rounded-lg border border-stone-200 bg-stone-100">
        <div ref={box} className="h-full w-full" />
        {status !== "ready" && (
          <div className="absolute inset-0 grid place-items-center text-sm text-stone-500">
            {status === "loading" ? "Cargando mapa..." : "No se pudo cargar Google Maps."}
          </div>
        )}
      </div>
      <div className="mt-3 min-h-10 text-sm">
        {resolving ? <span className="text-stone-500">Buscando dirección...</span>
          : picked ? <span>📍 {picked.label}</span>
          : <span className="text-stone-400">Aún no has elegido un punto.</span>}
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
        <button type="button" className="btn-primary" disabled={!picked || resolving}
          onClick={() => { if (picked) { onPick(picked.label); onClose(); } }}>
          Usar este lugar
        </button>
      </div>
    </Modal>
  );
}
