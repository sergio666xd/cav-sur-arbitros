"use client";

import { CalendarDaysIcon, CheckBadgeIcon, ClipboardDocumentListIcon, FlagIcon, PuzzlePieceIcon } from "@heroicons/react/24/outline";
import Place from "@/components/Place";
import Shell from "@/components/Shell";
import { Alert, Badge, Empty, Loading, PageHeader, StatCard, StatSkeleton } from "@/components/ui";
import { formatDate } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useFetch } from "@/lib/useFetch";

type Day = {
  id: number;
  date: string;
  slot_label: string;
  effective_location: string;
  effective_categories: string[];
  role: string | null;
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
        <div className="space-y-4">
          {data.map((t, i) => (
            <div key={t.id} className="card animate-slide-up" style={{ animationDelay: `${Math.min(i, 8) * 60}ms` }}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="text-lg font-semibold">{t.name}</h2>
                </div>
                <div className="flex flex-wrap gap-1">
                  {t.categories.map((c) => <Badge key={c} color="brand">{c}</Badge>)}
                </div>
              </div>
              {t.notes && <p className="mt-2 whitespace-pre-line text-sm text-stone-600">{t.notes}</p>}
              <div className="mt-4 space-y-3">
                {t.days.map((d) => (
                  <div key={d.id} className="rounded-lg border border-stone-200 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-medium">{formatDate(d.date)} · {d.slot_label}</div>
                      {d.role && <Badge color="brand">{d.role}</Badge>}
                    </div>
                    <Place place={d.effective_location} className="mt-1 text-sm text-stone-600" />
                    {d.effective_categories.length > 0 && (
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        {d.effective_categories.map((c) => <Badge key={c} color="stone">{c}</Badge>)}
                      </div>
                    )}
                    <div className="mt-2 text-sm text-stone-600">
                      <span className="text-stone-500">Equipo arbitral: </span>
                      {d.crew.map((c, i) => (
                        <span key={i} className={c.me ? "font-semibold text-ink" : ""}>
                          {c.name}{c.role ? ` (${c.role})` : ""}{i < d.crew.length - 1 ? ", " : ""}
                        </span>
                      ))}
                    </div>
                    {!user?.is_chief && (
                      <div className="mt-2 text-sm">
                        {d.refereed === null ? (
                          <span className="text-stone-400">Partidos aún sin registrar</span>
                        ) : (
                          <span>
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
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Shell>
  );
}
