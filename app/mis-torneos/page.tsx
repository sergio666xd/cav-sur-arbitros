"use client";

import { CalendarDaysIcon, CheckBadgeIcon, ClipboardDocumentListIcon, FlagIcon, PuzzlePieceIcon } from "@heroicons/react/24/outline";
import { CalendarIcon, CheckIcon, ChevronDownIcon, ClockIcon, ExclamationTriangleIcon, InformationCircleIcon, UserGroupIcon } from "@heroicons/react/20/solid";
import { useState } from "react";
import DayFilter, { uniqueDates } from "@/components/DayFilter";
import Place from "@/components/Place";
import { ShirtSwatch } from "@/components/Shirt";
import Shell, { PENDING_EVENT } from "@/components/Shell";
import { Alert, Badge, Empty, Loading, PageHeader, Spinner, StatCard, StatSkeleton } from "@/components/ui";
import { api, atClock, formatDate, todayIso } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Shirt } from "@/lib/types";
import { useFetch } from "@/lib/useFetch";

type Day = {
  id: number;
  date: string;
  slot_label: string;
  all_day: boolean;
  start_time: string | null;
  end_time: string | null;
  effective_location: string;
  effective_categories: string[];
  role: string | null;
  specification: string | null;
  confirmed: boolean;
  shirt: Shirt | null;
  crew: { name: string; role: string | null; me: boolean }[];
  refereed: number | null;
  scored: number | null;
  other: number | null;
  by_category: { category: string; refereed: number; scored: number; other?: number }[] | null;
};
type Assigned = { id: number; name: string; location: string; categories: string[]; notes: string; days: Day[] };
type Stats = { refereed: number; scored: number; other: number; days_recorded: number; assignments: number };

export default function MyTournamentsPage() {
  const { user } = useAuth();
  const { data, error, loading } = useFetch<Assigned[]>("/me/assignments");
  const [day, setDay] = useState("");
  // Para filtrar solo se ofrecen las fechas próximas.
  const upcoming = uniqueDates((data ?? []).flatMap((t) => t.days.map((d) => d.date)).filter((d) => d >= todayIso()));
  const stats = useFetch<Stats>("/me/stats");

  return (
    <Shell allow={(u) => u.is_referee || u.is_chief}>
      <PageHeader title="Mis torneos" subtitle="Torneos a los que te han asignado y tus partidos registrados." />
      {!user?.is_chief && (
        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
          {stats.data ? ([
            ["Días asignados", stats.data.assignments, CalendarDaysIcon],
            ["Días registrados", stats.data.days_recorded, CheckBadgeIcon],
            ["Partidos pitados", stats.data.refereed, FlagIcon],
            ["Partidos planillados", stats.data.scored, ClipboardDocumentListIcon],
            ["Otros roles", stats.data.other, PuzzlePieceIcon],
          ] as const).map(([label, value, icon], i) => (
            <StatCard key={label} label={label} value={value} icon={icon} delay={i * 50} />
          )) : <StatSkeleton count={5} />}
        </div>
      )}
      {loading ? (
        <Loading variant="list" />
      ) : error ? (
        <Alert>{error}</Alert>
      ) : !data?.length ? (
        <Empty icon={CalendarDaysIcon}>Todavía no tienes torneos asignados.</Empty>
      ) : (
        <div className="space-y-3">
          <DayFilter dates={upcoming} value={day} onChange={setDay} />
          {sortDays(data).filter(({ d }) => !day || d.date === day).map(({ t, d }, i) => (
            <DayCard key={d.id} t={t} d={d} showMatches={!user?.is_chief} delay={Math.min(i, 8) * 60} />
          ))}
        </div>
      )}
    </Shell>
  );
}

// En Mis torneos la hora es de citación: "Llegar a las ...".
function arrival(d: Day) {
  if (!d.start_time) return d.slot_label;
  const at = `Llegar a ${atClock(d.start_time)}`;
  if (d.all_day) return `Todo el día, llegar a ${atClock(d.start_time)}`;
  return d.end_time ? `${at}, hasta ${atClock(d.end_time)}` : at;
}

// Un día asignado por tarjeta: primero los próximos (del más cercano al más lejano), luego los pasados.
function sortDays(data: Assigned[]) {
  const today = todayIso();
  const all = data.flatMap((t) => t.days.map((d) => ({ t, d })));
  const upcoming = all.filter((x) => x.d.date >= today).sort((a, b) => a.d.date.localeCompare(b.d.date));
  const past = all.filter((x) => x.d.date < today).sort((a, b) => b.d.date.localeCompare(a.d.date));
  return [...upcoming, ...past];
}

function DayCard({ t, d, showMatches, delay }: { t: Assigned; d: Day; showMatches: boolean; delay: number }) {
  const [open, setOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(d.confirmed);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const upcoming = d.date >= todayIso();

  async function confirm() {
    setConfirming(true);
    setConfirmError(null);
    try {
      await api(`/me/assignments/${d.id}/confirm`, { method: "POST" });
      setConfirmed(true);
      window.dispatchEvent(new Event(PENDING_EVENT));
    } catch (e) {
      setConfirmError((e as Error).message);
    } finally {
      setConfirming(false);
    }
  }

  const [crewOpen, setCrewOpen] = useState(false);
  const categories = d.effective_categories.length ? d.effective_categories : t.categories;
  return (
    <div className="card animate-slide-up p-0 hover:shadow-md" style={{ animationDelay: `${delay}ms` }}>
      <div className="cursor-pointer p-4 sm:p-5" onClick={() => setOpen(!open)}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-semibold">{t.name}</h2>
            <div className="mt-1 flex flex-wrap gap-1">
              {d.role && <Badge color="brand">{d.role}</Badge>}
              {upcoming && (confirmed
                ? <span className="animate-pop"><Badge color="green"><CheckIcon className="mr-0.5 h-3 w-3" />Confirmada</Badge></span>
                : <Badge color="red"><ExclamationTriangleIcon className="mr-0.5 h-3 w-3" />Por confirmar</Badge>)}
            </div>
          </div>
          <button type="button" className="rounded-md p-1 text-stone-500 transition hover:bg-stone-100" aria-expanded={open}
            aria-label={open ? "Ocultar detalle" : "Ver detalle"} onClick={(e) => { e.stopPropagation(); setOpen(!open); }}>
            <ChevronDownIcon className={`h-5 w-5 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
          </button>
        </div>
        <div className="mt-3 space-y-1 text-sm text-stone-700">
          <div className="flex items-center gap-1"><CalendarIcon className="h-4 w-4 shrink-0 text-brand-500" />{formatDate(d.date)}</div>
          <div className="flex items-center gap-1"><ClockIcon className="h-4 w-4 shrink-0 text-brand-500" />{arrival(d)}</div>
          <div onClick={(e) => e.stopPropagation()}><Place place={d.effective_location} /></div>
          {d.specification && (
            <div className="flex items-start gap-1"><InformationCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />{d.specification}</div>
          )}
          {d.shirt && (
            <div className="flex items-center gap-1"><ShirtSwatch color={d.shirt.color} className="mx-0.5 h-3 w-3" />Camiseta {d.shirt.name}</div>
          )}
        </div>
        {upcoming && !confirmed && (
          <div className="mt-3 flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
            <button className="btn-primary" disabled={confirming} onClick={confirm}>
              {confirming ? <><Spinner />Confirmando...</> : <><CheckIcon className="h-4 w-4" />Confirmar asignación</>}
            </button>
            {confirmError && <span className="text-sm text-red-700">{confirmError}</span>}
          </div>
        )}
      </div>
      {open && (
        <div className="animate-slide-down space-y-3 border-t border-stone-100 px-4 py-4 text-sm sm:px-5">
          {categories.length > 0 && (
            <div className="flex flex-wrap gap-1">{categories.map((c) => <Badge key={c} color="stone">{c}</Badge>)}</div>
          )}
          {t.notes && <p className="whitespace-pre-line text-stone-600">{t.notes}</p>}
          {showMatches && (
            d.refereed === null ? (
              <div className="text-stone-400">Partidos aún sin registrar</div>
            ) : (
              <div>
                <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="inline-flex items-center gap-1"><FlagIcon className="h-4 w-4 text-brand-500" />{d.refereed} pitados</span>
                  <span className="inline-flex items-center gap-1"><ClipboardDocumentListIcon className="h-4 w-4 text-brand-500" />{d.scored} planillados</span>
                  {d.other ? <span className="inline-flex items-center gap-1"><PuzzlePieceIcon className="h-4 w-4 text-brand-500" />{d.other} otros roles</span> : null}
                </span>
                {d.by_category && d.by_category.some((c) => c.refereed || c.scored || c.other) && (
                  <span className="mt-1 block text-xs text-stone-500">
                    {d.by_category.filter((c) => c.refereed || c.scored || c.other)
                      .map((c) => `${c.category}: ${c.refereed} pit. / ${c.scored} plan.${c.other ? ` / ${c.other} otros` : ""}`).join(" · ")}
                  </span>
                )}
              </div>
            )
          )}
          <div className="rounded-lg border border-stone-200">
            <button type="button" className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left font-medium transition hover:bg-stone-50"
              aria-expanded={crewOpen} onClick={() => setCrewOpen(!crewOpen)}>
              <span className="inline-flex items-center gap-2"><UserGroupIcon className="h-4 w-4 text-brand-500" />Equipo arbitral ({d.crew.length})</span>
              <ChevronDownIcon className={`h-4 w-4 text-stone-500 transition-transform duration-200 ${crewOpen ? "rotate-180" : ""}`} />
            </button>
            {crewOpen && (
              <ul className="animate-slide-down divide-y divide-stone-100 border-t border-stone-100">
                {d.crew.map((c, i) => (
                  <li key={i} className={`flex items-center justify-between gap-2 px-3 py-2 ${c.me ? "font-semibold" : ""}`}>
                    <span>{c.name}{c.me ? " (tú)" : ""}</span>
                    {c.role && <Badge color={c.me ? "brand" : "stone"}>{c.role}</Badge>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
