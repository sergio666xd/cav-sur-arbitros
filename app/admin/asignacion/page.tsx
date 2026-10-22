"use client";

import { ClockIcon, ExclamationTriangleIcon } from "@heroicons/react/20/solid";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import AvailabilityImageButton from "@/components/AvailabilityImageButton";
import { summaryColumns, type SummaryRow } from "@/lib/availabilityImage";
import Shell from "@/components/Shell";
import { Alert, Badge, Empty, Loading, PageHeader, Spinner } from "@/components/ui";
import { api, formatDate, formatShortDate } from "@/lib/api";
import { useFetch } from "@/lib/useFetch";

type Column = {
  id: number;
  tournament_id: number;
  tournament: string;
  has_roles: boolean;
  roles: string[];
  all_day: boolean;
  start_time: string | null;
  end_time: string | null;
  slot_label: string;
  required: number;
  effective_location: string;
};

type BoardRow = {
  user_id: number;
  name: string;
  is_chief: boolean;
  available_day_ids: number[];
  assigned: Record<string, string | null>;
};

type Group = { key: number; slot_label: string; columns: Column[]; rows: BoardRow[] };
type Board = { date: string; dates: string[]; groups: Group[] };

// Selección: día -> (árbitro -> rol, "" si no tiene rol).
type Selection = Record<number, Record<number, string>>;

function fromBoard(board: Board): Selection {
  const sel: Selection = {};
  for (const g of board.groups) {
    for (const c of g.columns) sel[c.id] = {};
    for (const r of g.rows) {
      for (const [dayId, role] of Object.entries(r.assigned)) sel[Number(dayId)][r.user_id] = role ?? "";
    }
  }
  return sel;
}

function overlaps(a: Column, b: Column) {
  if (a.all_day || b.all_day || !a.start_time || !b.start_time) return true;
  return a.start_time < (b.end_time ?? "24:00") && b.start_time < (a.end_time ?? "24:00");
}

function GroupTable({ group, sel, setSel }: { group: Group; sel: Selection; setSel: (s: Selection) => void }) {
  const cols = group.columns;

  function toggle(col: Column, userId: number) {
    const day = { ...sel[col.id] };
    if (userId in day) delete day[userId];
    else day[userId] = "";
    setSel({ ...sel, [col.id]: day });
  }

  function setRole(col: Column, userId: number, role: string) {
    setSel({ ...sel, [col.id]: { ...sel[col.id], [userId]: role } });
  }

  function conflict(row: BoardRow) {
    const on = cols.filter((c) => row.user_id in sel[c.id]);
    for (let i = 0; i < on.length; i++) {
      for (let j = i + 1; j < on.length; j++) if (overlaps(on[i], on[j])) return true;
    }
    return false;
  }

  return (
    <section className="card overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 bg-stone-50 px-4 py-3">
        <h2 className="flex items-center gap-1.5 font-semibold"><ClockIcon className="h-5 w-5 text-brand-500" />{group.slot_label}</h2>
        <span className="text-xs text-stone-500">
          {group.rows.filter((r) => !r.is_chief).length} árbitro(s) disponibles · {cols.length} torneo(s)
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-max text-sm">
          <thead>
            <tr className="border-b border-stone-200 align-bottom">
              <th className="sticky left-0 z-10 bg-white px-4 py-3 text-left font-semibold">Árbitro</th>
              {cols.map((c) => {
                const count = Object.keys(sel[c.id]).length;
                return (
                  <th key={c.id} className="min-w-40 border-l border-stone-100 px-3 py-3 text-left font-normal">
                    <Link href={`/admin/torneos/${c.tournament_id}#dia-${c.id}`} className="font-semibold text-ink hover:text-brand-700 hover:underline">
                      {c.tournament}
                    </Link>
                    <div className="text-xs text-stone-500">{c.slot_label}{c.effective_location && ` · ${c.effective_location}`}</div>
                    <div className={`mt-1 text-xs font-medium ${count >= c.required ? "text-green-700" : "text-brand-700"}`}>
                      {count} de {c.required} asignados
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {group.rows.map((r) => {
              const warn = conflict(r);
              return (
                <tr key={r.user_id} className={warn ? "bg-amber-50" : ""}>
                  <td className={`sticky left-0 z-10 px-4 py-2 ${warn ? "bg-amber-50" : "bg-white"}`}>
                    <div className="flex items-center gap-2 whitespace-nowrap">
                      {r.name} {r.is_chief && <Badge color="brand">Jefe</Badge>}
                    </div>
                    {warn && <div className="flex animate-fade-in items-center gap-1 text-xs text-amber-700"><ExclamationTriangleIcon className="h-3.5 w-3.5" />Asignado en torneos con horario cruzado</div>}
                  </td>
                  {cols.map((c) => {
                    const on = r.user_id in sel[c.id];
                    const available = r.is_chief || r.available_day_ids.includes(c.id);
                    const used = new Set(Object.entries(sel[c.id]).filter(([u]) => Number(u) !== r.user_id).map(([, role]) => role).filter(Boolean));
                    return (
                      <td key={c.id} className={`border-l border-stone-100 px-3 py-2 ${on ? "bg-brand-50" : ""}`}>
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-brand-500 disabled:opacity-30"
                            aria-label={`${r.name} en ${c.tournament}`}
                            checked={on}
                            disabled={!available && !on}
                            title={available ? undefined : "No marcó disponibilidad para esta franja"}
                            onChange={() => toggle(c, r.user_id)}
                          />
                          {c.has_roles && on && (
                            <select
                              className="input w-auto py-1 text-xs"
                              value={sel[c.id][r.user_id]}
                              onChange={(e) => setRole(c, r.user_id, e.target.value)}
                            >
                              <option value="">Sin rol</option>
                              {c.roles.map((role) => (
                                <option key={role} value={role} disabled={used.has(role)}>{role}</option>
                              ))}
                            </select>
                          )}
                          {!available && !on && <span className="text-xs text-stone-400">—</span>}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function AssignmentBoardPage() {
  const [date, setDate] = useState<string | null>(null);
  const { data, loading, error, reload } = useFetch<Board>(`/assignment-board${date ? `?d=${date}` : ""}`);
  const [sel, setSel] = useState<Selection>({});
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data) setSel(fromBoard(data));
  }, [data]);

  const ready = data !== null && data.groups.every((g) => g.columns.every((c) => c.id in sel));
  const original = useMemo(() => (data ? JSON.stringify(fromBoard(data)) : ""), [data]);
  const dirty = data !== null && JSON.stringify(sel) !== original;

  function pickDate(d: string) {
    if (dirty && !confirm("Tienes cambios sin guardar. ¿Cambiar de fecha y descartarlos?")) return;
    setMsg(null);
    setDate(d);
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      await api("/assignment-board", {
        method: "PUT",
        body: {
          days: Object.entries(sel).map(([dayId, people]) => ({
            day_id: Number(dayId),
            items: Object.entries(people).map(([userId, role]) => ({ user_id: Number(userId), role: role || null })),
          })),
        },
      });
      await reload();
      setMsg({ kind: "success", text: "Asignaciones guardadas." });
    } catch (e) {
      setMsg({ kind: "error", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell allow={(u) => u.perm_admin}>
      <PageHeader
        title="Asignación"
        subtitle="Asigna árbitros a todos los torneos de una fecha, franja por franja."
        action={data && data.groups.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <AvailabilityImageButton
              label="Imagen de esta fecha"
              fileName={`disponibilidad-${data.date}`}
              spec={async () => ({
                title: "Árbitros disponibles",
                subtitle: formatDate(data.date),
                columns: summaryColumns(await api<SummaryRow[]>(`/availability/summary?d=${data.date}`), false),
              })}
            />
            <AvailabilityImageButton
              label="Todas las fechas"
              fileName="disponibilidad-proximas-fechas"
              spec={async () => ({
                title: "Árbitros disponibles",
                subtitle: "Próximas fechas",
                columns: summaryColumns(await api<SummaryRow[]>("/availability/summary"), true),
              })}
            />
            <button className="btn-primary" disabled={busy || !dirty} onClick={save}>
              {busy ? <><Spinner />Guardando...</> : dirty ? "Guardar cambios" : "Sin cambios"}
            </button>
          </div>
        )}
      />
      {(loading && !data) || (data && !ready) ? (
        <Loading variant="table" />
      ) : error ? (
        <Alert>{error}</Alert>
      ) : data ? (
        data.dates.length === 0 ? (
          <Empty>No hay torneos con fechas próximas.</Empty>
        ) : (
          <>
            <div className="mb-6 flex flex-wrap gap-2">
              {data.dates.map((d) => (
                <button
                  key={d}
                  onClick={() => pickDate(d)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition active:scale-95 ${
                    d === data.date ? "border-brand-500 bg-brand-500 text-white shadow-sm" : "border-stone-300 bg-white hover:border-brand-400"
                  }`}
                >
                  {loading && d === date && <Spinner className="h-3 w-3" />}
                  {formatShortDate(d)}
                </button>
              ))}
            </div>
            <h2 className="mb-3 text-lg font-semibold">{formatDate(data.date)}</h2>
            {msg && <div className="mb-4"><Alert kind={msg.kind}>{msg.text}</Alert></div>}
            {data.groups.length === 0 ? (
              <Empty>No hay torneos en esta fecha.</Empty>
            ) : (
              <div className={`space-y-6 transition-opacity duration-200 ${loading ? "pointer-events-none opacity-50" : ""}`}>
                {data.groups.map((g, i) => (
                  <div key={`${data.date}-${g.key}`} className="animate-slide-up" style={{ animationDelay: `${i * 60}ms` }}>
                    <GroupTable group={g} sel={sel} setSel={setSel} />
                  </div>
                ))}
              </div>
            )}
            <p className="mt-4 text-xs text-stone-500">
              Solo se puede marcar a quien registró disponibilidad para la franja. El JEFE siempre puede asignarse.
            </p>
          </>
        )
      ) : null}
    </Shell>
  );
}
