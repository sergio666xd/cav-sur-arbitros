"use client";

import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";
import type { Shirt } from "@/lib/types";
import { Spinner } from "./ui";

/** Muestra de color de una camiseta. */
export function ShirtSwatch({ color, className = "h-3.5 w-3.5" }: { color: string; className?: string }) {
  return <span className={`inline-block shrink-0 rounded-full border border-black/15 ${className}`} style={{ backgroundColor: color }} />;
}

/** Nombre de la camiseta con su color. */
export function ShirtLabel({ shirt }: { shirt: Shirt }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <ShirtSwatch color={shirt.color} />
      {shirt.name}
    </span>
  );
}

/** Selector de la camiseta de una franja; guarda al cambiar. */
export function ShirtSelect({ dayId, value, shirts, onSaved, className = "" }: {
  dayId: number;
  value: Shirt | null;
  shirts: Shirt[];
  onSaved?: (shirt: Shirt | null) => void;
  className?: string;
}) {
  const [current, setCurrent] = useState<Shirt | null>(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function change(raw: string) {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ shirt: Shirt | null }>(`/tournament-days/${dayId}/shirt`, {
        method: "PUT",
        body: { shirt_id: raw ? Number(raw) : null },
      });
      setCurrent(r.shirt);
      onSaved?.(r.shirt);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (shirts.length === 0 && !current) {
    return <Link href="/admin/camisetas" className={`text-xs font-medium text-brand-700 hover:underline ${className}`}>Registrar camisetas</Link>;
  }

  return (
    <span className={`inline-flex flex-wrap items-center gap-2 ${className}`}>
      {current ? <ShirtSwatch color={current.color} className="h-4 w-4" /> : null}
      <select className="input w-auto py-1 text-xs" aria-label="Camiseta" value={current?.id ?? ""} disabled={busy}
        onChange={(e) => change(e.target.value)}>
        <option value="">Sin camiseta</option>
        {shirts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      {busy && <Spinner className="h-3 w-3" />}
      {error && <span className="text-xs text-red-700">{error}</span>}
    </span>
  );
}
