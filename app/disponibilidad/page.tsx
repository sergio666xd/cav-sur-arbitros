"use client";

import { useState } from "react";
import Place from "@/components/Place";
import Shell from "@/components/Shell";
import { Alert, Badge, Empty, Loading, Modal, PageHeader } from "@/components/ui";
import { api, formatDate, formatDateTime } from "@/lib/api";
import { useFetch } from "@/lib/useFetch";

type Slot = {
  key: number;
  date: string;
  slot_label: string;
  all_day: boolean;
  required: number;
  registered: number;
  mine: boolean;
  open: boolean;
  tournaments: { name: string; location: string; categories: string[]; visible: boolean }[];
};

type Referee = { name: string; since: string };

export default function AvailabilityPage() {
  const { data, error, loading, reload } = useFetch<Slot[]>("/availability");
  const [busy, setBusy] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [listFor, setListFor] = useState<Slot | null>(null);
  const [list, setList] = useState<Referee[] | null>(null);

  async function toggle(s: Slot) {
    setBusy(s.key);
    setActionError(null);
    try {
      await api(`/availability/${s.key}`, { method: s.mine ? "DELETE" : "POST" });
      await reload();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function showList(s: Slot) {
    setListFor(s);
    setList(null);
    try {
      setList(await api<Referee[]>(`/availability/${s.key}/referees`));
    } catch (e) {
      setActionError((e as Error).message);
      setListFor(null);
    }
  }

  const byDate = new Map<string, Slot[]>();
  for (const s of data ?? []) byDate.set(s.date, [...(byDate.get(s.date) ?? []), s]);

  return (
    <Shell allow={(u) => u.perm_availability}>
      <PageHeader
        title="Disponibilidad"
        subtitle="Marca las franjas en las que puedes arbitrar. La selección se cierra automáticamente el día del torneo."
      />
      {actionError && <div className="mb-4"><Alert>{actionError}</Alert></div>}
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <Alert>{error}</Alert>
      ) : byDate.size === 0 ? (
        <Empty>No hay torneos próximos que requieran disponibilidad.</Empty>
      ) : (
        <div className="space-y-6">
          {[...byDate.entries()].map(([date, slots]) => (
            <section key={date}>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">{formatDate(date)}</h2>
              <div className="grid gap-3 md:grid-cols-2">
                {slots.map((s) => {
                  const pct = Math.min(100, Math.round((s.registered / Math.max(1, s.required)) * 100));
                  return (
                    <div key={s.key} className={`card ${s.mine ? "border-brand-300 ring-1 ring-brand-200" : ""}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-lg font-semibold">{s.slot_label}</div>
                          {s.tournaments.length ? (
                            s.tournaments.map((t) => (
                              <div key={t.name} className="mt-2 text-sm text-stone-600">
                                <div className="font-medium text-ink">
                                  {t.name} {!t.visible && <Badge color="stone">Oculto</Badge>}
                                </div>
                                <Place place={t.location} />
                                {t.categories.length > 0 && (
                                  <div className="mt-1 flex flex-wrap gap-1">
                                    {t.categories.map((c) => <Badge key={c} color="brand">{c}</Badge>)}
                                  </div>
                                )}
                              </div>
                            ))
                          ) : (
                            <div className="mt-1 text-sm italic text-stone-500">Detalles del torneo reservados</div>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          {s.mine && <Badge color="green">Inscrito</Badge>}
                          {!s.open && <Badge color="stone">Cerrado</Badge>}
                        </div>
                      </div>
                      <div className="mt-4">
                        <div className="mb-1 flex justify-between text-xs text-stone-500">
                          <span>{s.registered} inscritos</span>
                          <span>{s.required} requeridos</span>
                        </div>
                        <div className="h-2 rounded-full bg-stone-100">
                          <div className="h-2 rounded-full bg-brand-500" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        {s.open && (
                          <button className={s.mine ? "btn-secondary" : "btn-primary"} disabled={busy === s.key} onClick={() => toggle(s)}>
                            {busy === s.key ? "Guardando..." : s.mine ? "Quitar disponibilidad" : "Estoy disponible"}
                          </button>
                        )}
                        <button className="btn-ghost" onClick={() => showList(s)}>Ver inscritos</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
      <Modal open={!!listFor} onClose={() => setListFor(null)} title="Árbitros inscritos">
        {listFor && <p className="mb-3 text-sm text-stone-500">{formatDate(listFor.date)} · {listFor.slot_label}</p>}
        {!list ? (
          <Loading />
        ) : list.length === 0 ? (
          <p className="text-sm text-stone-500">Aún no hay árbitros inscritos.</p>
        ) : (
          <ol className="divide-y divide-stone-100">
            {list.map((r, i) => (
              <li key={i} className="flex justify-between py-2 text-sm">
                <span>{i + 1}. {r.name}</span>
                <span className="text-xs text-stone-400">{formatDateTime(r.since)}</span>
              </li>
            ))}
          </ol>
        )}
      </Modal>
    </Shell>
  );
}
