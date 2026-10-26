"use client";

import { ClockIcon, ExclamationTriangleIcon } from "@heroicons/react/20/solid";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import AvailabilityImageButton from "@/components/AvailabilityImageButton";
import { assignmentSpec, summaryColumns, type SummaryRow } from "@/lib/availabilityImage";
import Shell from "@/components/Shell";
import { Alert, Badge, Empty, Loading, PageHeader, Spinner } from "@/components/ui";
import { api, formatDate, formatShortDate } from "@/lib/api";
import { shortAddress } from "@/lib/maps";
import { useFetch } from "@/lib/useFetch";
import { ShirtSelect } from "@/components/Shirt";
import type { Shirt } from "@/lib/types";

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
  effective_categories: string[];
  specification: string | null;
  hidden: boolean;
  visible: boolean;
  shirt: Shirt | null;
};

type BoardRow = {
  user_id: number;
  name: string;
  is_chief: boolean;
  is_guest: boolean;
  available_day_ids: number[];
  assigned: Record<string, string | null>;
  confirmed_day_ids: number[];
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

function GroupTable({ group, date, dirty, shirts, sel, setSel }: {
  group: Group; date: string; dirty: boolean; shirts: Shirt[]; sel: Selection; setSel: (s: Selection) => void;
}) {
  const cols = group.columns;
  // Camiseta de cada franja; se guarda al elegirla, aparte de las asignaciones.
  const [shirtOf, setShirtOf] = useState<Record<number, Shirt | null>>(() => Object.fromEntries(cols.map((c) => [c.id, c.shirt])));
  // Confirmaciones de externos marcadas aquí ("árbitro-franja" -> confirmó), sin recargar el tablero.
  const [marked, setMarked] = useState<Record<string, boolean>>({});
  const [marking, setMarking] = useState<string | null>(null);
  const [markError, setMarkError] = useState<string | null>(null);

  useEffect(() => setMarked({}), [group]);

  const isConfirmed = (r: BoardRow, c: Column) => marked[`${r.user_id}-${c.id}`] ?? r.confirmed_day_ids.includes(c.id);

  async function markConfirmed(r: BoardRow, c: Column, confirmed: boolean) {
    const key = `${r.user_id}-${c.id}`;
    setMarking(key);
    setMarkError(null);
    try {
      await api(`/tournament-days/${c.id}/assignments/${r.user_id}/confirmed`, { method: "PUT", body: { confirmed } });
      setMarked((m) => ({ ...m, [key]: confirmed }));
    } catch (e) {
      setMarkError((e as Error).message);
    } finally {
      setMarking(null);
    }
  }

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
                    {c.hidden && <span className="ml-1.5"><Badge color="violet">Oculta</Badge></span>}
                    <div className="text-xs text-stone-500">{c.slot_label}{c.effective_location && ` · ${shortAddress(c.effective_location)}`}</div>
                    <div className={`mt-1 text-xs font-medium ${count >= c.required ? "text-green-700" : "text-brand-700"}`}>
                      {count} de {c.required} asignados
                    </div>
                    {group.rows.some((r) => String(c.id) in r.assigned) && (
                      <div className="text-xs text-stone-500">
                        {group.rows.filter((r) => String(c.id) in r.assigned && isConfirmed(r, c)).length} confirmaron
                      </div>
                    )}
                    <ShirtSelect className="mt-2" dayId={c.id} value={shirtOf[c.id] ?? null} shirts={shirts}
                      onSaved={(s) => setShirtOf((m) => ({ ...m, [c.id]: s }))} />
                    {group.rows.some((r) => String(c.id) in r.assigned) && (
                      // Usa las asignaciones guardadas, por eso pide guardar antes.
                      <AvailabilityImageButton
                        label="Imagen"
                        className="btn-secondary mt-2 px-2 py-1 text-xs"
                        disabled={dirty}
                        title={dirty ? "Guarda los cambios para generar la imagen" : "Imagen de asignación de esta franja"}
                        fileName={`asignacion-${date}-${c.id}`}
                        spec={() => assignmentSpec({
                          tournament: c.tournament,
                          date,
                          slotLabel: c.slot_label,
                          location: c.effective_location,
                          categories: c.visible ? c.effective_categories : [],
                          shirt: shirtOf[c.id],
                          hasRoles: c.has_roles,
                          roles: c.roles,
                          specification: c.specification,
                          entries: group.rows
                            .filter((r) => String(c.id) in r.assigned)
                            .map((r) => ({ user_id: r.user_id, name: r.name, role: r.assigned[String(c.id)] })),
                        })}
                      />
                    )}
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
                      {r.name} {r.is_chief && <Badge color="chief">Jefe</Badge>}
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
                            className="switch"
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
                          {on && String(c.id) in r.assigned && r.is_guest && (
                            // Un externo no tiene cuenta: se marca aquí cuando confirma.
                            <label className={`inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap text-xs ${isConfirmed(r, c) ? "font-medium text-green-700" : "text-stone-500"}`}
                              title="No tiene cuenta en la aplicación: márcalo cuando te confirme">
                              {marking === `${r.user_id}-${c.id}` ? <Spinner className="h-3 w-3" /> : (
                                <input type="checkbox" className="h-3.5 w-3.5 accent-green-600" checked={isConfirmed(r, c)}
                                  disabled={marking !== null} onChange={(e) => markConfirmed(r, c, e.target.checked)} />
                              )}
                              {isConfirmed(r, c) ? "Confirmó" : "Marcar si confirmó"}
                            </label>
                          )}
                          {on && String(c.id) in r.assigned && !r.is_guest && (
                            // Solo para asignaciones ya guardadas.
                            r.confirmed_day_ids.includes(c.id)
                              ? <span className="whitespace-nowrap text-xs font-medium text-green-700">✓ Confirmó</span>
                              : <span className="whitespace-nowrap text-xs text-stone-500">Sin confirmar</span>
                          )}
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
      {markError && <div className="border-t border-stone-200 p-3"><Alert>{markError}</Alert></div>}
    </section>
  );
}

export default function AssignmentBoardPage() {
  const [date, setDate] = useState<string | null>(null);
  const { data, loading, error, reload } = useFetch<Board>(`/assignment-board${date ? `?d=${date}` : ""}`);
  const [sel, setSel] = useState<Selection>({});
  const shirts = useFetch<Shirt[]>("/shirts");
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
                    <GroupTable group={g} date={data.date} dirty={dirty} shirts={shirts.data ?? []} sel={sel} setSel={setSel} />
                  </div>
                ))}
              </div>
            )}
            <p className="mt-4 text-xs text-stone-500">
              Solo se puede marcar a quien se inscribió en una disponibilidad que cubre la franja; en las franjas ocultas, a cualquier árbitro. Nadie puede quedar en dos franjas que se cruzan, salvo el JEFE.
            </p>
          </>
        )
      ) : null}
    </Shell>
  );
}
