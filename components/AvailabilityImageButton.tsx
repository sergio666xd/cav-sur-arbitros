"use client";

import { ArrowDownTrayIcon, PhotoIcon, ShareIcon, XMarkIcon } from "@heroicons/react/20/solid";
import { useEffect, useState } from "react";
import { formatShortDate } from "@/lib/api";
import { groupByDate, renderAvailabilityImage, styleColumns, type DateFormat, type ImageSpec } from "@/lib/availabilityImage";
import { Portal, Spinner } from "./ui";

// Botón que genera la imagen de disponibilidad y la muestra para descargar o compartir.
export default function AvailabilityImageButton({ spec, fileName, label = "Imagen de disponibilidad", className = "btn-secondary", disabled = false, title }: {
  spec: () => ImageSpec | Promise<ImageSpec>;
  fileName: string;
  label?: string;
  className?: string;
  disabled?: boolean;
  title?: string;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Datos de la imagen y fechas elegidas; al cambiar la selección se vuelve a dibujar.
  const [base, setBase] = useState<ImageSpec | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  // Opciones de la imagen de disponibilidad: fila de solicitados, una columna por fecha, hora y formato de la fecha.
  const [opts, setOpts] = useState<{ required: boolean; grouped: boolean; showTime: boolean; dateFormat: DateFormat }>(
    { required: true, grouped: false, showTime: true, dateFormat: "short" },
  );

  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  const canGroup = !!base && new Set(base.columns.map((c) => c.date).filter(Boolean)).size
    < base.columns.filter((c) => c.date).length;
  const dates = base ? [...new Set(base.columns.map((c) => c.date).filter((d): d is string => !!d))].sort() : [];
  // Las columnas llevan la fecha si la imagen tiene varias fechas (o si se agrupan por fecha).
  const datedColumns = !!base && (opts.grouped || base.columns.some((c) => c.top && c.date));

  async function render(s: ImageSpec, sel: string[], o = opts) {
    const columns = s.columns.filter((c) => !c.date || sel.includes(c.date));
    const availability = s.kind !== "assignment";
    const blob = await renderAvailabilityImage({
      ...s,
      hideRequired: s.hideRequired || !o.required,
      columns: !availability ? columns : o.grouped ? groupByDate(columns, o.dateFormat) : styleColumns(columns, o),
    });
    const f = new File([blob], `${fileName}.png`, { type: "image/png" });
    setFile(f);
    setUrl(URL.createObjectURL(f));
  }

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const s = await spec();
      const all = [...new Set(s.columns.map((c) => c.date).filter((d): d is string => !!d))];
      setBase(s);
      setSelected(all);
      await render(s, all);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleDate(d: string) {
    if (!base || busy) return;
    const sel = selected.includes(d) ? selected.filter((x) => x !== d) : [...selected, d];
    if (sel.length === 0) return; // Siempre al menos una fecha.
    setSelected(sel);
    setBusy(true);
    try {
      await render(base, sel);
    } finally {
      setBusy(false);
    }
  }

  async function setOption(patch: Partial<typeof opts>) {
    if (!base || busy) return;
    const o = { ...opts, ...patch };
    setOpts(o);
    setBusy(true);
    try {
      await render(base, selected, o);
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setFile(null);
    setUrl(null);
    setBase(null);
  }

  const canShare = typeof navigator !== "undefined" && !!file && !!navigator.canShare?.({ files: [file] });

  return (
    <>
      <button className={className} onClick={generate} disabled={busy || disabled} title={title}>
        {busy ? <Spinner /> : <PhotoIcon className="h-4 w-4" />}
        {busy ? "Generando..." : label}
      </button>
      {error && <span className="text-sm text-red-700">{error}</span>}
      {url && file && (
        <Portal>
        <div className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-black/60 p-4 backdrop-blur-[2px]" onClick={close}>
          <div className="flex max-h-full w-full max-w-lg animate-scale-in flex-col rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3">
              <h2 className="font-semibold">{base?.kind === "assignment" ? "Imagen de asignación" : "Imagen de disponibilidad"}</h2>
              <button className="rounded-md p-1 text-stone-500 transition hover:bg-stone-100 hover:text-ink" aria-label="Cerrar" onClick={close}>
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            {dates.length > 1 && (
              <div className="border-b border-stone-200 px-4 py-3">
                <div className="mb-2 text-xs font-medium text-stone-500">Fechas incluidas</div>
                <div className="flex flex-wrap gap-2" role="group" aria-label="Fechas incluidas">
                  {dates.map((d) => {
                    const on = selected.includes(d);
                    return (
                      <button key={d} type="button" aria-pressed={on} disabled={on && selected.length === 1}
                        title={on && selected.length === 1 ? "Debe quedar al menos una fecha" : undefined}
                        onClick={() => toggleDate(d)}
                        className={`rounded-full border px-3 py-1 text-sm transition active:scale-95 ${
                          on ? "border-brand-500 bg-brand-500 text-white" : "border-stone-300 bg-white text-stone-600 hover:border-brand-400"
                        }`}>
                        {formatShortDate(d)}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {base?.kind !== "assignment" && (
              <div className="space-y-2 border-b border-stone-200 px-4 py-3 text-sm">
                <label className="flex items-center gap-2">
                  <input type="checkbox" className="switch" checked={opts.required} disabled={busy}
                    onChange={(e) => setOption({ required: e.target.checked })} />
                  Mostrar el número de solicitados
                </label>
                {canGroup && (
                  <label className="flex items-center gap-2">
                    <input type="checkbox" className="switch" checked={opts.grouped} disabled={busy}
                      onChange={(e) => setOption({ grouped: e.target.checked })} />
                    Agrupar las franjas de cada fecha en una sola columna
                  </label>
                )}
                {!opts.grouped && (
                  <label className="flex items-center gap-2">
                    <input type="checkbox" className="switch" checked={opts.showTime} disabled={busy}
                      onChange={(e) => setOption({ showTime: e.target.checked })} />
                    Mostrar la hora
                  </label>
                )}
                {datedColumns && (
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <span>Fecha:</span>
                    <div className="inline-flex rounded-lg border border-stone-300 p-0.5" role="group" aria-label="Formato de la fecha">
                      {([["day", "Solo el día"], ["short", "Fecha corta"]] as const).map(([v, text]) => (
                        <button key={v} type="button" aria-pressed={opts.dateFormat === v} disabled={busy}
                          onClick={() => opts.dateFormat !== v && setOption({ dateFormat: v })}
                          className={`rounded-md px-3 py-1 text-sm transition ${
                            opts.dateFormat === v ? "bg-brand-500 text-white" : "text-stone-600 hover:bg-stone-100"
                          }`}>
                          {text}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            <div className={`min-h-0 overflow-y-auto bg-stone-100 p-4 transition-opacity ${busy ? "opacity-60" : ""}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={base?.kind === "assignment" ? "Árbitros asignados" : "Lista de árbitros con disponibilidad"} className="w-full animate-fade-in rounded-lg shadow" />
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t border-stone-200 px-4 py-3">
              {canShare && (
                <button className="btn-secondary" onClick={() => navigator.share({ files: [file] }).catch(() => {})}>
                  <ShareIcon className="h-4 w-4" />Compartir
                </button>
              )}
              <a className="btn-primary" href={url} download={file.name}><ArrowDownTrayIcon className="h-4 w-4" />Descargar</a>
            </div>
          </div>
        </div>
        </Portal>
      )}
    </>
  );
}
