"use client";

import { ChevronDownIcon, PlusIcon, TrashIcon, XMarkIcon } from "@heroicons/react/20/solid";
import { StarIcon } from "@heroicons/react/24/outline";
import { useState } from "react";
import { signedPoints } from "@/components/RefereeStats";
import Shell from "@/components/Shell";
import { Alert, Empty, Loading, PageHeader, Spinner } from "@/components/ui";
import { api, formatDateTime } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useFetch } from "@/lib/useFetch";

type Ref = { user_id: number; name: string; points: number };
type Scale = { value: string; label: string; points: number }[];
type Batch = { id: number; created_at: string; items: { name: string; score: string; points: number; reason: string | null }[] };

// Opción para restar puntos: el Jefe escribe cuántos.
const DEDUCT = "DESCUENTO";

const COLORS: Record<string, string> = {
  P5: "peer-checked:bg-orange-400 peer-checked:text-white",
  P10: "peer-checked:bg-amber-300 peer-checked:text-ink",
  P20: "peer-checked:bg-lime-400 peer-checked:text-ink",
  P35: "peer-checked:bg-lime-600 peer-checked:text-white",
  P50: "peer-checked:bg-green-600 peer-checked:text-white",
  [DEDUCT]: "peer-checked:bg-red-600 peer-checked:text-white",
};

export default function RatingsPage() {
  const { user } = useAuth();
  // El rol system ve las calificaciones, pero solo el Jefe califica o anula.
  const canRate = !!user?.is_chief;
  const refs = useFetch<Ref[]>("/ratings/referees");
  const scale = useFetch<Scale>("/ratings/scale");
  const history = useFetch<Batch[]>("/ratings/history");
  const [editing, setEditing] = useState(false);
  const [picks, setPicks] = useState<Record<number, string>>({});
  const [deducts, setDeducts] = useState<Record<number, string>>({});
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const pointsOf = (id: number, v: string) => (v === DEDUCT ? -(Number(deducts[id]) || 0) : scale.data?.find((x) => x.value === v)?.points ?? 0);
  const total = Object.entries(picks).reduce((s, [id, v]) => s + pointsOf(Number(id), v), 0);
  const count = Object.keys(picks).length;
  const missing = Object.entries(picks).some(([id, v]) => v === DEDUCT && !(Number(deducts[Number(id)]) > 0));

  async function confirmRatings() {
    if (!confirm(`¿Confirmar ${count} calificación(es)? En total: ${signedPoints(total)} puntos.`)) return;
    setBusy(true);
    setMsg(null);
    try {
      await api("/ratings", { method: "POST", body: { items: Object.entries(picks).map(([id, score]) => (
        score === DEDUCT ? { user_id: Number(id), deduct: Number(deducts[Number(id)]) } : { user_id: Number(id), score }
      )) } });
      setPicks({});
      setDeducts({});
      setEditing(false);
      setMsg({ kind: "success", text: "Calificaciones registradas." });
      refs.reload();
      history.reload();
    } catch (e) {
      setMsg({ kind: "error", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function removeBatch(id: number) {
    if (!confirm("¿Anular esta calificación? Se restarán sus puntos del ranking.")) return;
    await api(`/ratings/${id}`, { method: "DELETE" });
    refs.reload();
    history.reload();
  }

  return (
    <Shell allow={(u) => u.perm_chief}>
      <PageHeader
        title="Calificaciones de desempeño"
        subtitle={scale.data ? `Puntos por calificación: ${scale.data.map((s) => s.label).join(" · ")}` : undefined}
        action={canRate && !editing && <button className="btn-primary" onClick={() => { setEditing(true); setMsg(null); }}><PlusIcon className="h-4 w-4" />Añadir calificación</button>}
      />
      {msg && <div className="mb-4"><Alert kind={msg.kind}>{msg.text}</Alert></div>}

      {editing && (
        <div className="card mb-8 animate-slide-up">
          <p className="mb-4 text-sm text-stone-500">Elige una calificación para cada árbitro que quieras calificar. No se guarda nada hasta que confirmes.</p>
          {refs.loading || scale.loading ? (
            <Loading variant="list" />
          ) : !refs.data?.length ? (
            <Empty>No hay árbitros activos.</Empty>
          ) : (
            <div className="divide-y divide-stone-100">
              {refs.data.map((r) => (
                <div key={r.user_id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div className="text-sm">
                    <div className="font-medium">{r.name}</div>
                    <div className="text-xs text-stone-500">{r.points} pts actuales</div>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {[...(scale.data ?? []), { value: DEDUCT, label: "Restar", points: 0 }].map((s) => (
                      <label key={s.value} className="cursor-pointer">
                        <input type="radio" className="peer sr-only" name={`r-${r.user_id}`} checked={picks[r.user_id] === s.value}
                          onChange={() => setPicks({ ...picks, [r.user_id]: s.value })} />
                        <span className={`block min-w-[3rem] rounded-md border border-stone-200 px-2.5 py-1 text-center text-xs font-semibold text-stone-600 peer-[:not(:checked)]:hover:bg-stone-50 ${COLORS[s.value]}`}>
                          {s.label}
                        </span>
                      </label>
                    ))}
                    {picks[r.user_id] === DEDUCT && (
                      <input className="input w-20 animate-pop py-1 text-xs" type="number" min={1} max={1000} placeholder="Puntos" autoFocus
                        aria-label={`Puntos a restar a ${r.name}`} value={deducts[r.user_id] ?? ""}
                        onChange={(e) => setDeducts({ ...deducts, [r.user_id]: e.target.value })} />
                    )}
                    {picks[r.user_id] && (
                      <button className="animate-pop px-2 text-xs text-stone-400 transition hover:text-stone-700" title="Quitar"
                        aria-label="Quitar" onClick={() => { const p = { ...picks }; delete p[r.user_id]; setPicks(p); }}><XMarkIcon className="h-4 w-4" /></button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="sticky bottom-0 mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 bg-white pt-4">
            <span className="text-sm text-stone-600">{count} seleccionados · {signedPoints(total)} puntos</span>
            <div className="flex gap-2">
              <button className="btn-secondary" onClick={() => { setEditing(false); setPicks({}); }}>Cancelar</button>
              <button className="btn-primary" disabled={!count || missing || busy} onClick={confirmRatings}>{busy ? <><Spinner />Guardando...</> : "Confirmar calificaciones"}</button>
            </div>
          </div>
        </div>
      )}

      <h2 className="mb-3 text-lg font-semibold">Historial</h2>
      {history.loading ? (
        <Loading variant="list" />
      ) : !history.data?.length ? (
        <Empty icon={StarIcon}>Aún no hay calificaciones.</Empty>
      ) : (
        <div className="space-y-3">
          {history.data.map((b) => (
            <details key={b.id} className="card group hover:shadow-md">
              <summary className="flex cursor-pointer list-none items-center justify-between text-sm">
                <span><b>{formatDateTime(b.created_at)}</b> · {b.items.length} árbitros · {signedPoints(b.items.reduce((s, i) => s + i.points, 0))} pts</span>
                <ChevronDownIcon className="h-5 w-5 text-stone-400 transition-transform duration-200 group-open:rotate-180" />
              </summary>
              <ul className="mt-3 animate-slide-down space-y-1 text-sm">
                {b.items.map((i, k) => (
                  <li key={k} className="flex justify-between gap-2">
                    <span>{i.name}{i.reason && <span className="text-stone-500"> · {i.reason}</span>}</span>
                    <span className={i.points < 0 ? "text-red-600" : ""}>{i.score === signedPoints(i.points) ? i.score : `${i.score} (${signedPoints(i.points)})`}</span>
                  </li>
                ))}
              </ul>
              {canRate && <button className="btn-ghost mt-3 text-red-600" onClick={() => removeBatch(b.id)}><TrashIcon className="h-4 w-4" />Anular esta calificación</button>}
            </details>
          ))}
        </div>
      )}
    </Shell>
  );
}
