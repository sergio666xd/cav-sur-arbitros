"use client";

import { CheckCircleIcon, HandRaisedIcon, MapPinIcon, PlusIcon, SwatchIcon } from "@heroicons/react/20/solid";
import { TrophyIcon } from "@heroicons/react/24/outline";
import Link from "next/link";
import { useMemo, useState } from "react";
import DayFilter, { uniqueDates } from "@/components/DayFilter";
import Shell from "@/components/Shell";
import { Alert, Badge, Empty, Loading, PageHeader } from "@/components/ui";
import { formatShortDate } from "@/lib/api";
import { shortAddress } from "@/lib/maps";
import { useAuth } from "@/lib/auth";
import { useFetch } from "@/lib/useFetch";
import type { DayDetail, TournamentDetail } from "@/lib/types";

type Row = Omit<TournamentDetail, "days"> & {
  days: (Omit<DayDetail, "candidates" | "assignments"> & { assigned_count: number })[];
  past_count: number;
  last_past_date: string | null;
};

type PastDay = Omit<DayDetail, "candidates" | "assignments" | "available_count" | "open"> & {
  tournament_id: number;
  tournament: string;
  assigned_count: number;
  records_count: number;
  records_pending: number;
  refereed: number;
  scored: number;
};

function TournamentCards() {
  const { user } = useAuth();
  const { data, loading, error } = useFetch<Row[]>("/tournaments");
  const [day, setDay] = useState("");
  const dates = useMemo(() => uniqueDates((data ?? []).flatMap((t) => t.days.map((d) => d.date))), [data]);
  if (loading) return <Loading />;
  if (error) return <Alert>{error}</Alert>;
  if (!data?.length)
    return <Empty icon={TrophyIcon}>{user?.perm_chief ? "Todavía no hay torneos." : "No tienes torneos asignados. El Jefe te los asigna."}</Empty>;
  // Con un día elegido, solo los torneos que juegan ese día y solo sus franjas de ese día.
  const shown = day
    ? data.filter((t) => t.days.some((d) => d.date === day)).map((t) => ({ ...t, days: t.days.filter((d) => d.date === day) }))
    : data;
  return (
    <>
    <DayFilter dates={dates} value={day} onChange={setDay} />
    <div className="grid gap-4 md:grid-cols-2">
      {shown.map((t, i) => (
        <div key={t.id} className="card flex animate-slide-up flex-col hover:shadow-md" style={{ animationDelay: `${Math.min(i, 8) * 50}ms` }}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <Link href={`/admin/torneos/${t.id}`} className="text-lg font-semibold hover:text-brand-700 hover:underline">{t.name}</Link>
              <div className="flex items-center gap-1 text-sm text-stone-600">
                <MapPinIcon className="h-4 w-4 shrink-0 text-brand-500" />{t.venues.length > 1 ? `${t.venues.length} sedes` : shortAddress(t.location)}
              </div>
            </div>
            <div className="flex flex-col items-end gap-1">
              {!t.is_visible && <Badge color="stone">Oculto</Badge>}
              {t.has_roles && <Badge color="blue">Con roles</Badge>}
            </div>
          </div>
          {t.categories.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">{t.categories.map((c) => <Badge key={c} color="brand">{c}</Badge>)}</div>
          )}
          {t.days.length > 0 ? (
            <table className="mt-3 w-full text-sm">
              <tbody>
                {t.days.map((d) => (
                  <tr key={d.id} className="border-t border-stone-100">
                    <td className="py-1.5 pr-2">{formatShortDate(d.date)}</td>
                    <td className="py-1.5 pr-2 text-stone-500">
                      {d.slot_label}
                      {t.venues.length > 1 && <div className="flex items-center gap-1 text-xs"><MapPinIcon className="h-3 w-3 shrink-0" />{shortAddress(d.effective_location)}</div>}
                    </td>
                    <td className="py-1.5 text-right text-xs whitespace-nowrap">
                      {d.hidden ? (
                        <Badge color="violet">Oculta</Badge>
                      ) : (
                        <span title="Disponibles" className="inline-flex items-center gap-0.5 text-stone-600">
                          <HandRaisedIcon className="h-3.5 w-3.5" />{d.available_count}
                        </span>
                      )}{" "}
                      <span title="Asignados / requeridos" className={`ml-2 inline-flex items-center gap-0.5 ${d.assigned_count >= d.required ? "text-green-700" : "text-brand-700"}`}>
                        <CheckCircleIcon className="h-3.5 w-3.5" />{d.assigned_count}/{d.required}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="mt-3 text-sm text-stone-500">Sin fechas próximas.</p>
          )}
          <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-3 text-xs text-stone-500">
            <span>{t.past_count > 0 ? `${t.past_count} fecha(s) anterior(es)` : ""}</span>
            <div className="flex gap-2">
              {user?.perm_create_tournaments && (
                <Link href={`/admin/torneos/${t.id}/editar`} className="btn-ghost px-2 py-1 text-xs"><PlusIcon className="h-3.5 w-3.5" />Añadir fechas</Link>
              )}
              <Link href={`/admin/torneos/${t.id}`} className="btn-secondary px-3 py-1 text-xs">Gestionar</Link>
            </div>
          </div>
        </div>
      ))}
    </div>
    </>
  );
}

function PastDays() {
  const { data, loading, error } = useFetch<PastDay[]>("/tournament-days/past");
  const [filter, setFilter] = useState<string>("");
  const [grouped, setGrouped] = useState(true);

  const tournaments = useMemo(() => {
    const m = new Map<number, string>();
    for (const d of data ?? []) m.set(d.tournament_id, d.tournament);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], "es"));
  }, [data]);

  const rows = (data ?? []).filter((d) => !filter || String(d.tournament_id) === filter);
  const groups = useMemo(() => {
    const m = new Map<number, PastDay[]>();
    for (const d of rows) m.set(d.tournament_id, [...(m.get(d.tournament_id) ?? []), d]);
    return [...m.values()];
  }, [rows]);

  if (loading) return <Loading variant="table" />;
  if (error) return <Alert>{error}</Alert>;

  const table = (items: PastDay[], showTournament: boolean) => (
    <div className="card overflow-x-auto p-0">
      <table className="table">
        <thead>
          <tr>
            <th>Fecha</th>
            {showTournament && <th>Torneo</th>}
            <th>Franja</th>
            <th>Lugar</th>
            <th className="text-right">Asignados</th>
            <th className="text-right">Pitados / planillados</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map((d) => (
            <tr key={d.id}>
              <td className="whitespace-nowrap">{formatShortDate(d.date)}</td>
              {showTournament && <td className="font-medium">{d.tournament}</td>}
              <td>{d.slot_label}</td>
              <td className="text-stone-600">{shortAddress(d.effective_location)}</td>
              <td className="text-right">{d.assigned_count}/{d.required}</td>
              <td className="text-right">
                {d.refereed} / {d.scored}
                {d.records_pending > 0 && <div><Badge color="red">{d.records_pending} sin registrar</Badge></div>}
              </td>
              <td className="text-right">
                <Link href={`/admin/torneos/${d.tournament_id}#dia-${d.id}`} className="text-brand-700 hover:underline">Ver</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select className="input w-auto" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">Todos los torneos</option>
          {tournaments.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="switch" checked={grouped} onChange={(e) => setGrouped(e.target.checked)} />
          Agrupar por torneo
        </label>
        <span className="text-sm text-stone-500">{rows.length} fecha(s)</span>
      </div>
      {rows.length === 0 ? (
        <Empty>No hay fechas anteriores.</Empty>
      ) : grouped ? (
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g[0].tournament_id}>
              <h2 className="mb-2 flex items-center gap-2 font-semibold">
                <Link href={`/admin/torneos/${g[0].tournament_id}`} className="hover:text-brand-700 hover:underline">{g[0].tournament}</Link>
                <span className="text-sm font-normal text-stone-500">· {g.length} fecha(s)</span>
              </h2>
              {table(g, false)}
            </section>
          ))}
        </div>
      ) : (
        table(rows, true)
      )}
    </div>
  );
}

export default function TournamentsPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<"torneos" | "anteriores">("torneos");

  return (
    <Shell allow={(u) => u.perm_admin}>
      <PageHeader
        title="Torneos"
        subtitle="Los torneos no se archivan: puedes añadirles fechas nuevas cuando quieras."
        action={
          <div className="flex flex-wrap gap-2">
            <Link href="/admin/camisetas" className="btn-secondary"><SwatchIcon className="h-4 w-4" />Camisetas</Link>
            {user?.perm_create_tournaments && <Link href="/admin/torneos/nuevo" className="btn-primary"><PlusIcon className="h-4 w-4" />Nuevo torneo</Link>}
          </div>
        }
      />
      <div className="mb-4 inline-flex rounded-lg border border-stone-200 bg-white p-1 text-sm">
        {([["torneos", "Torneos"], ["anteriores", "Fechas anteriores"]] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`rounded-md px-3 py-1.5 font-medium transition duration-200 ${tab === k ? "bg-brand-500 text-white shadow-sm" : "text-stone-600 hover:bg-stone-100"}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === "torneos" ? <TournamentCards /> : <PastDays />}
    </Shell>
  );
}
