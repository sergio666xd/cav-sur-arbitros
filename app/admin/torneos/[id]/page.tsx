"use client";

import { CheckCircleIcon, ChevronDownIcon, ExclamationTriangleIcon, MapPinIcon, PencilSquareIcon, TrashIcon } from "@heroicons/react/20/solid";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Fragment, useEffect, useState } from "react";
import BackLink from "@/components/BackLink";
import Place from "@/components/Place";
import AvailabilityImageButton from "@/components/AvailabilityImageButton";
import { assignmentSpec } from "@/lib/availabilityImage";
import Shell, { PENDING_EVENT } from "@/components/Shell";
import { Alert, Badge, Empty, Loading, PageHeader, Spinner } from "@/components/ui";
import { api, formatDate, formatShortDate } from "@/lib/api";
import { shortAddress } from "@/lib/maps";
import { useAuth } from "@/lib/auth";
import { fold } from "@/lib/text";
import { useFetch } from "@/lib/useFetch";
import type { DayDetail, Shirt, TournamentDetail } from "@/lib/types";
import { ShirtLabel, ShirtSelect } from "@/components/Shirt";

function AssignmentEditor({ day, t, onSaved }: { day: DayDetail; t: TournamentDetail; onSaved: () => void }) {
  const initial = () => Object.fromEntries(day.assignments.map((a) => [a.user_id, a.role ?? ""])) as Record<number, string>;
  const [selected, setSelected] = useState<Record<number, string>>(initial);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => setSelected(initial()), [day]); // eslint-disable-line react-hooks/exhaustive-deps

  // Incluye asignados que ya no figuran como candidatos (p. ej. si quitaron su disponibilidad).
  const people = [...day.candidates];
  for (const a of day.assignments) {
    if (!people.some((c) => c.user_id === a.user_id)) people.push({ user_id: a.user_id, name: a.name, is_chief: a.is_chief, assigned_elsewhere: null, available_at: null });
  }
  const count = Object.keys(selected).length;
  const usedRoles = new Set(Object.values(selected).filter(Boolean));

  function toggle(id: number) {
    const next = { ...selected };
    if (id in next) delete next[id];
    else next[id] = "";
    setSelected(next);
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      await api(`/tournament-days/${day.id}/assignments`, {
        method: "PUT",
        body: Object.entries(selected).map(([user_id, role]) => ({ user_id: Number(user_id), role: role || null })),
      });
      setMsg({ kind: "success", text: "Asignación guardada." });
      onSaved();
    } catch (e) {
      setMsg({ kind: "error", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-sm">
        <h3 className="font-semibold">Asignación</h3>
        <span className={count >= day.required ? "text-green-700" : "text-brand-700"}>{count} de {day.required} requeridos</span>
      </div>
      {people.length === 0 ? (
        <p className="text-sm text-stone-500">Ningún árbitro ha marcado disponibilidad para esta franja.</p>
      ) : (
        <ul className="divide-y divide-stone-100 rounded-lg border border-stone-200">
          {people.map((c) => {
            const on = c.user_id in selected;
            const saved = day.assignments.find((a) => a.user_id === c.user_id);
            return (
              <li key={c.user_id} className={`flex flex-wrap items-center gap-3 px-3 py-2 text-sm transition-colors duration-200 ${on ? "bg-brand-50" : ""}`}>
                <input type="checkbox" className="h-4 w-4 accent-brand-500" checked={on} onChange={() => toggle(c.user_id)} />
                <span className="flex-1">
                  {c.name} {c.is_chief && <Badge color="brand">Jefe</Badge>}
                  {c.assigned_elsewhere && (
                    <span className="ml-2 inline-flex items-center gap-1 text-xs text-amber-700">
                      <ExclamationTriangleIcon className="h-3.5 w-3.5" />Asignado en {c.assigned_elsewhere}
                    </span>
                  )}
                  {saved && on && !day.past && (
                    <span className={`ml-2 text-xs ${saved.confirmed ? "text-green-700" : "text-stone-500"}`}>
                      {saved.confirmed ? "✓ Confirmó" : "Sin confirmar"}
                    </span>
                  )}
                </span>
                {t.has_roles && on && (
                  <select className="input w-40 py-1" value={selected[c.user_id]}
                    onChange={(e) => setSelected({ ...selected, [c.user_id]: e.target.value })}>
                    <option value="">Sin rol</option>
                    {t.roles.map((r) => (
                      <option key={r} value={r} disabled={usedRoles.has(r) && selected[c.user_id] !== r}>{r}</option>
                    ))}
                  </select>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {msg && <div className="mt-2"><Alert kind={msg.kind}>{msg.text}</Alert></div>}
      <button className="btn-primary mt-3" disabled={busy} onClick={save}>{busy ? <><Spinner />Guardando...</> : "Guardar asignación"}</button>
    </div>
  );
}

type Counts = { refereed: string; scored: string; other: string };
const KINDS: { k: keyof Counts; short: string; long: string }[] = [
  { k: "refereed", short: "Pit.", long: "Pitados" },
  { k: "scored", short: "Plan.", long: "Planillados" },
  { k: "other", short: "Otros", long: "Otros roles" },
];

// En torneos con roles: el Planillero planilla, Principal y Segundo pitan, y cualquier otro rol cuenta como "otros roles".
function roleKind(role: string): keyof Counts {
  const r = fold(role);
  if (r.includes("planill")) return "scored";
  if (r.includes("principal") || r.includes("segundo")) return "refereed";
  return "other";
}

function MatchEditor({ day, t, onSaved }: { day: DayDetail; t: TournamentDetail; onSaved: () => void }) {
  const refs = day.assignments.filter((a) => !a.is_chief);
  const cats = day.effective_categories;
  // Clave "" = total sin categoría (franjas sin categorías).
  const keys = cats.length ? cats : [""];
  const initial = () =>
    Object.fromEntries(refs.map((a) => [a.user_id, Object.fromEntries(keys.map((k) => {
      const c = k ? a.by_category?.find((x) => x.category === k) : a;
      // Registros antiguos sin desglose: el total va en la primera categoría.
      const legacy = k && !a.by_category && k === keys[0] ? a : null;
      const src = c ?? legacy;
      return [k, { refereed: String(src?.refereed ?? ""), scored: String(src?.scored ?? ""), other: String(src?.other ?? "") }];
    }))])) as Record<number, Record<string, Counts>>;
  const [values, setValues] = useState(initial);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [games, setGames] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => setValues(initial()), [day]); // eslint-disable-line react-hooks/exhaustive-deps

  if (refs.length === 0) return null;
  const withRoles = t.has_roles && refs.some((a) => a.role);

  // Partidos jugados en una categoría: se reparten según el rol de cada árbitro.
  function setGamesFor(cat: string, raw: string) {
    const v = raw.replace(/\D/g, "");
    setGames({ ...games, [cat]: v });
    const next = { ...values };
    for (const a of refs) {
      if (!a.role) continue;
      const k = roleKind(a.role);
      const cur = next[a.user_id]?.[cat];
      next[a.user_id] = {
        ...next[a.user_id],
        [cat]: { refereed: cur?.refereed || "0", scored: cur?.scored || "0", other: cur?.other || "0", [k]: v },
      };
    }
    setValues(next);
  }

  const num = (v?: string) => Number(v || 0);
  const counts = (id: number, c: string) => ({
    refereed: num(values[id]?.[c]?.refereed), scored: num(values[id]?.[c]?.scored), other: num(values[id]?.[c]?.other),
  });
  const total = (id: number, k: keyof Counts) => keys.reduce((n, c) => n + num(values[id]?.[c]?.[k]), 0);

  async function save() {
    setMsg(null);
    setSaving(true);
    try {
      await api(`/tournament-days/${day.id}/matches`, {
        method: "PUT",
        body: refs.map((a) => cats.length
          ? { user_id: a.user_id, categories: cats.map((c) => ({ category: c, ...counts(a.user_id, c) })) }
          : { user_id: a.user_id, ...counts(a.user_id, "") }),
      });
      setMsg({ kind: "success", text: "Partidos registrados." });
      onSaved();
    } catch (e) {
      setMsg({ kind: "error", text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  const set = (id: number, cat: string, k: keyof Counts, v: string) =>
    setValues({ ...values, [id]: { ...values[id], [cat]: { ...values[id]?.[cat], [k]: v.replace(/\D/g, "") } } });

  const cell = (id: number, cat: string, k: keyof Counts, label: string) => (
    <input className="input w-14 px-2 py-1 text-center" inputMode="numeric" aria-label={label}
      value={values[id]?.[cat]?.[k] ?? ""} onChange={(e) => set(id, cat, k, e.target.value)} />
  );

  return (
    <div className="lg:col-span-2">
      <h3 className="mb-2 text-sm font-semibold">Partidos del día{cats.length > 0 && " por categoría"}</h3>
      {withRoles && (
        <div className="mb-3 rounded-lg bg-stone-50 p-3 text-sm">
          <p className="mb-2 text-stone-600">Partidos jugados{cats.length > 0 && " por categoría"}: se rellenan como pitados para Principal y Segundo, como planillados para el Planillero y como otros roles para el resto. Puedes ajustar cada valor después.</p>
          <div className="flex flex-wrap gap-3">
            {keys.map((c) => (
              <label key={c} className="flex items-center gap-2">
                <span className="font-medium">{c || "Partidos"}</span>
                <input className="input w-16 px-2 py-1 text-center" inputMode="numeric" value={games[c] ?? ""}
                  onChange={(e) => setGamesFor(c, e.target.value)} aria-label={`Partidos jugados ${c}`} />
              </label>
            ))}
          </div>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            {cats.length > 0 && (
              <tr>
                <th />
                {cats.map((c) => <th key={c} colSpan={3} className="border-l border-stone-100 text-center normal-case">{c}</th>)}
                <th colSpan={3} className="border-l border-stone-100 text-center">Total</th>
              </tr>
            )}
            <tr>
              <th>Árbitro</th>
              {keys.map((c) => (
                <Fragment key={c}>
                  {KINDS.map((x, n) => (
                    <th key={x.k} className={`text-center ${n === 0 ? "border-l border-stone-100" : ""}`} title={x.long}>{cats.length ? x.short : x.long}</th>
                  ))}
                </Fragment>
              ))}
              {cats.length > 0 && KINDS.map((x, n) => (
                <th key={x.k} className={`text-center ${n === 0 ? "border-l border-stone-100" : ""}`} title={x.long}>{x.short}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {refs.map((a) => (
              <tr key={a.user_id}>
                <td className="whitespace-nowrap">{a.name} {a.role && <span className="text-xs text-stone-500">({a.role})</span>}</td>
                {keys.map((c) => (
                  <Fragment key={c}>
                    {KINDS.map((x, n) => (
                      <td key={x.k} className={n === 0 ? "border-l border-stone-100" : ""}>
                        {cell(a.user_id, c, x.k, `${a.name} ${x.long.toLowerCase()} ${c}`)}
                      </td>
                    ))}
                  </Fragment>
                ))}
                {cats.length > 0 && KINDS.map((x, n) => (
                  <td key={x.k} className={`text-center font-semibold ${n === 0 ? "border-l border-stone-100" : ""}`}>{total(a.user_id, x.k)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {msg && <div className="mt-2"><Alert kind={msg.kind}>{msg.text}</Alert></div>}
      <button className="btn-secondary mt-3" disabled={saving} onClick={save}>{saving ? <><Spinner />Guardando...</> : "Guardar partidos"}</button>
    </div>
  );
}

function DaySection({ d, t, shirts, onSaved }: { d: DayDetail; t: TournamentDetail; shirts: Shirt[]; onSaved: () => void }) {
  const ownPlace = d.location || (d.categories && d.categories.length > 0);
  // Cerrada por defecto; se abre si se llega a esta franja con #dia-N.
  const [open, setOpen] = useState(() => typeof window !== "undefined" && window.location.hash === `#dia-${d.id}`);
  const assigned = d.assignments.length;
  // La camiseta se guarda por separado; no se recarga la página para no perder cambios sin guardar.
  const [shirt, setShirt] = useState(d.shirt);
  useEffect(() => setShirt(d.shirt), [d.shirt]);
  // Igual con el estado de finalizada, para no recargar y perder cambios.
  const [status, setStatus] = useState({ finished: d.finished, can_reopen: d.can_reopen });
  useEffect(() => setStatus({ finished: d.finished, can_reopen: d.can_reopen }), [d.finished, d.can_reopen]);
  const [finishMsg, setFinishMsg] = useState<string | null>(null);

  async function setFinished(finished: boolean) {
    if (finished && !confirm("¿Marcar esta franja como finalizada? Después podrás registrar los partidos.")) return;
    setFinishMsg(null);
    try {
      const r = await api<DayDetail>(`/tournament-days/${d.id}/finished`, { method: "PUT", body: { finished } });
      setStatus({ finished: r.finished, can_reopen: r.can_reopen });
      window.dispatchEvent(new Event(PENDING_EVENT)); // Una franja finalizada ya no pide confirmación.
    } catch (e) {
      setFinishMsg((e as Error).message);
    }
  }
  return (
    <section id={`dia-${d.id}`} className="card scroll-mt-24 animate-slide-up p-0 hover:shadow-md">
      <div className="cursor-pointer p-4 sm:p-5" onClick={() => setOpen(!open)}>
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold">{formatDate(d.date)}</h2>
          <button type="button" className="rounded-md p-1 text-stone-500 transition hover:bg-stone-100" aria-expanded={open}
            aria-label={open ? "Ocultar asignación" : "Ver asignación"} onClick={(e) => { e.stopPropagation(); setOpen(!open); }}>
            <ChevronDownIcon className={`h-5 w-5 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
          </button>
        </div>
        <div onClick={(e) => e.stopPropagation()}><Place place={d.effective_location} className="mt-1 text-sm text-stone-600" /></div>
        {ownPlace && d.effective_categories.length > 0 && (
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {d.effective_categories.map((c) => <Badge key={c} color="brand">{c}</Badge>)}
          </div>
        )}
        {d.specification && <p className="mt-1 text-sm italic text-stone-600">{d.specification}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <Badge color="brand">{d.slot_label}</Badge>
          {d.past ? (
            <Badge color="stone">Fecha pasada</Badge>
          ) : status.finished ? (
            <Badge color="stone">Finalizada</Badge>
          ) : (
            <Badge color={d.open ? "green" : "stone"}>{d.open ? "Disponibilidad abierta" : "Disponibilidad cerrada"}</Badge>
          )}
          <span className="text-stone-500">{d.available_count} disponibles</span>
          {shirt && <span className="text-stone-600"><ShirtLabel shirt={shirt} /></span>}
          <span className={`font-medium ${assigned >= d.required ? "text-green-700" : "text-brand-700"}`}>{assigned} de {d.required} asignados</span>
          {assigned > 0 && !status.finished && (
            <span className="text-stone-500">{d.assignments.filter((a) => a.confirmed).length} de {assigned} confirmaron</span>
          )}
        </div>
      </div>
      {/* Oculta en vez de desmontada, para no perder cambios sin guardar al plegarla. */}
      <div className={open ? "animate-slide-down border-t border-stone-100 p-4 sm:p-5" : "hidden"}>
        {/* Finalizada: ya no se asigna; en su lugar se registran los partidos. */}
        {(!status.finished || status.can_reopen) && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            {!status.finished ? (
              <label className="inline-flex items-center gap-2 text-sm font-medium">
                Camiseta
                <ShirtSelect dayId={d.id} value={shirt} shirts={shirts} onSaved={setShirt} />
              </label>
            ) : <span />}
            <div className="flex flex-wrap items-center gap-2">
              {status.finished ? (
                <button type="button" className="btn-ghost text-sm" onClick={() => setFinished(false)}>Reabrir franja</button>
              ) : d.started && (
                <button type="button" className="btn-secondary text-sm" onClick={() => setFinished(true)}>
                  <CheckCircleIcon className="h-4 w-4" />Marcar como finalizada
                </button>
              )}
              {!status.finished && assigned > 0 && (
                <AvailabilityImageButton
                  label="Imagen de asignación"
                  className="btn-secondary text-sm"
                  fileName={`asignacion-${d.date}-${d.id}`}
                  spec={() => assignmentSpec({
                    tournament: t.name,
                    date: d.date,
                    slotLabel: d.slot_label,
                    location: t.is_visible ? d.effective_location : "",
                    categories: t.is_visible ? d.effective_categories : [],
                    shirt,
                    hasRoles: t.has_roles,
                    roles: t.roles,
                    specification: d.specification,
                    entries: d.assignments,
                  })}
                />
              )}
            </div>
          </div>
        )}
        {finishMsg && <div className="mb-4"><Alert>{finishMsg}</Alert></div>}
        {status.finished ? (
          <MatchEditor day={d} t={t} onSaved={onSaved} />
        ) : (
          <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
            <AssignmentEditor day={d} t={t} onSaved={onSaved} />
          </div>
        )}
      </div>
    </section>
  );
}

export default function TournamentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { data: t, loading, error, reload } = useFetch<TournamentDetail>(`/tournaments/${id}`);
  const [showPast, setShowPast] = useState(false);
  const shirts = useFetch<Shirt[]>("/shirts");

  // Si se llega desde "Fechas anteriores" (#dia-N), abrir esa sección y desplazarse hasta la franja.
  useEffect(() => {
    if (!t || typeof window === "undefined" || !window.location.hash.startsWith("#dia-")) return;
    const dayId = Number(window.location.hash.slice(5));
    if (t.days.some((d) => d.id === dayId && d.past)) setShowPast(true);
    setTimeout(() => document.getElementById(`dia-${dayId}`)?.scrollIntoView({ behavior: "smooth" }), 50);
  }, [t]);

  async function remove() {
    if (!confirm("¿Eliminar este torneo? Se borrarán sus asignaciones, disponibilidades y partidos registrados.")) return;
    await api(`/tournaments/${id}`, { method: "DELETE" });
    router.push("/admin/torneos");
  }

  return (
    <Shell allow={(u) => u.perm_admin}>
      <BackLink href="/admin/torneos">Torneos</BackLink>
      {loading && !t ? (
        <Loading variant="detail" />
      ) : error ? (
        <Alert>{error}</Alert>
      ) : t ? (
        <>
          <PageHeader
            title={t.name}
            subtitle={
              <span className="inline-flex items-start gap-1">
                <MapPinIcon className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />
                {t.venues.length > 1 ? `${t.venues.length} sedes: ${t.venues.map((v) => shortAddress(v)).join(" · ")}` : shortAddress(t.location)}
              </span>
            }
            action={
              <div className="flex flex-wrap gap-2">
                {t.days.some((d) => !d.past) && (
                  <AvailabilityImageButton
                    fileName={`disponibilidad-torneo-${t.id}`}
                    spec={() => ({
                      // Es para compartir: si el torneo está oculto solo se muestran los días.
                      title: t.name,
                      subtitle: "Árbitros con disponibilidad",
                      columns: t.days.filter((d) => !d.past).map((d) => ({
                        date: d.date,
                        top: formatShortDate(d.date),
                        label: d.slot_label,
                        sub: t.is_visible ? shortAddress(d.effective_location) : undefined,
                        required: d.required,
                        entries: d.candidates
                          .filter((c) => !c.is_chief && c.available_at)
                          .map((c) => ({ user_id: c.user_id, name: c.name, at: c.available_at! })),
                      })),
                    })}
                  />
                )}
                {user?.perm_create_tournaments && (
                  <>
                    <Link href={`/admin/torneos/${t.id}/editar`} className="btn-secondary"><PencilSquareIcon className="h-4 w-4" />Editar / añadir fechas</Link>
                    <button className="btn-danger" onClick={remove}><TrashIcon className="h-4 w-4" />Eliminar</button>
                  </>
                )}
              </div>
            }
          />
          <div className="mb-6 flex flex-wrap gap-2">
            {t.categories.map((c) => <Badge key={c} color="brand">{c}</Badge>)}
            <Badge color={t.is_visible ? "green" : "stone"}>{t.is_visible ? "Visible para árbitros" : "Oculto para árbitros"}</Badge>
            {t.has_roles && <Badge color="blue">Roles: {t.roles.join(", ")}</Badge>}
          </div>
          {t.notes && <p className="card mb-6 whitespace-pre-line text-sm text-stone-600">{t.notes}</p>}
          {(() => {
            const upcoming = t.days.filter((d) => !d.past);
            const past = t.days.filter((d) => d.past).reverse();
            return (
              <>
                {upcoming.length === 0 ? (
                  <Empty>
                    Este torneo no tiene fechas próximas.
                    {user?.perm_create_tournaments && (
                      <> <Link href={`/admin/torneos/${t.id}/editar`} className="font-semibold text-brand-700 hover:underline">Añadir fechas</Link></>
                    )}
                  </Empty>
                ) : (
                  <div className="space-y-6">
                    {upcoming.map((d) => <DaySection key={d.id} d={d} t={t} shirts={shirts.data ?? []} onSaved={reload} />)}
                  </div>
                )}
                {past.length > 0 && (
                  <details className="mt-8" open={showPast} onToggle={(e) => setShowPast((e.target as HTMLDetailsElement).open)}>
                    <summary className="cursor-pointer text-lg font-semibold">Fechas anteriores ({past.length})</summary>
                    <div className="mt-4 space-y-6">
                      {past.map((d) => <DaySection key={d.id} d={d} t={t} shirts={shirts.data ?? []} onSaved={reload} />)}
                    </div>
                  </details>
                )}
              </>
            );
          })()}
        </>
      ) : null}
    </Shell>
  );
}
