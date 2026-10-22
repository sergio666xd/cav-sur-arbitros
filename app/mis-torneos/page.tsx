"use client";

import Place from "@/components/Place";
import Shell from "@/components/Shell";
import { Alert, Badge, Empty, Loading, PageHeader } from "@/components/ui";
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
};
type Assigned = { id: number; name: string; location: string; categories: string[]; notes: string; days: Day[] };
type Stats = { refereed: number; scored: number; days_recorded: number; assignments: number };

export default function MyTournamentsPage() {
  const { user } = useAuth();
  const { data, error, loading } = useFetch<Assigned[]>("/me/assignments");
  const stats = useFetch<Stats>("/me/stats");

  return (
    <Shell allow={(u) => u.is_referee || u.is_chief}>
      <PageHeader title="Mis torneos" subtitle="Torneos a los que te han asignado y tus partidos registrados." />
      {stats.data && !user?.is_chief && (
        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            ["Días asignados", stats.data.assignments],
            ["Días registrados", stats.data.days_recorded],
            ["Partidos pitados", stats.data.refereed],
            ["Partidos planillados", stats.data.scored],
          ].map(([label, value]) => (
            <div key={label} className="card">
              <div className="text-xs uppercase tracking-wide text-stone-500">{label}</div>
              <div className="mt-1 text-3xl font-bold text-brand-600">{value}</div>
            </div>
          ))}
        </div>
      )}
      {loading ? (
        <Loading />
      ) : error ? (
        <Alert>{error}</Alert>
      ) : !data?.length ? (
        <Empty>Todavía no tienes torneos asignados.</Empty>
      ) : (
        <div className="space-y-4">
          {data.map((t) => (
            <div key={t.id} className="card">
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
                          <span>🏐 {d.refereed} pitados · 📋 {d.scored} planillados</span>
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
