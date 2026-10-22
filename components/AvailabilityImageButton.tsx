"use client";

import { useEffect, useState } from "react";
import { renderAvailabilityImage, type ImageSpec } from "@/lib/availabilityImage";

// Botón que genera la imagen de disponibilidad y la muestra para descargar o compartir.
export default function AvailabilityImageButton({ spec, fileName, label = "🖼️ Imagen de disponibilidad", className = "btn-secondary" }: {
  spec: () => ImageSpec | Promise<ImageSpec>;
  fileName: string;
  label?: string;
  className?: string;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const blob = await renderAvailabilityImage(await spec());
      const f = new File([blob], `${fileName}.png`, { type: "image/png" });
      setFile(f);
      setUrl(URL.createObjectURL(f));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setFile(null);
    setUrl(null);
  }

  const canShare = typeof navigator !== "undefined" && !!file && !!navigator.canShare?.({ files: [file] });

  return (
    <>
      <button className={className} onClick={generate} disabled={busy}>
        {busy ? "Generando..." : label}
      </button>
      {error && <span className="text-sm text-red-700">{error}</span>}
      {url && file && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={close}>
          <div className="flex max-h-full w-full max-w-lg flex-col rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3">
              <h2 className="font-semibold">Imagen de disponibilidad</h2>
              <button className="text-2xl leading-none text-stone-500 hover:text-ink" aria-label="Cerrar" onClick={close}>×</button>
            </div>
            <div className="min-h-0 overflow-y-auto bg-stone-100 p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="Lista de árbitros con disponibilidad" className="w-full rounded-lg shadow" />
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t border-stone-200 px-4 py-3">
              {canShare && (
                <button className="btn-secondary" onClick={() => navigator.share({ files: [file] }).catch(() => {})}>
                  Compartir
                </button>
              )}
              <a className="btn-primary" href={url} download={file.name}>Descargar</a>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
