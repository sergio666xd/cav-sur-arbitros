"use client";

import { TrophyIcon as TrophySolid } from "@heroicons/react/20/solid";
import { TrophyIcon } from "@heroicons/react/24/outline";
import Shell from "@/components/Shell";
import { Alert, Badge, Empty, Loading, PageHeader } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useFetch } from "@/lib/useFetch";
import { useSort } from "@/lib/useSort";

type Row = {
  position: number; name: string; points: number | null; is_chief: boolean;
  refereed: number | null; scored: number | null; other: number | null;
};

const MEDALS = ["", "text-amber-400", "text-stone-400", "text-amber-700"];

export default function RankingPage() {
  const { user } = useAuth();
  const { data, error, loading } = useFetch<Row[]>("/ranking");
  const me = user ? `${user.first_name} ${user.last_name}` : "";
  const { sorted, header } = useSort(data, {
    position: (r) => r.position, name: (r) => r.name, refereed: (r) => r.refereed,
    scored: (r) => r.scored, other: (r) => r.other, points: (r) => r.points,
  });
  // Las medallas se cuentan sin el Jefe, que siempre aparece primero, y no cambian al reordenar.
  const medals = new Map<number, string>();
  (data ?? []).filter((r) => !r.is_chief).slice(0, 3).forEach((r, i) => medals.set(r.position, MEDALS[i + 1]));

  return (
    <Shell>
      <PageHeader title="Ranking" subtitle="Puntos acumulados por calificaciones de desempeño y partidos registrados." />
      {loading ? (
        <Loading variant="table" />
      ) : error ? (
        <Alert>{error}</Alert>
      ) : !data?.length ? (
        <Empty icon={TrophyIcon}>Aún no hay árbitros en el ranking.</Empty>
      ) : (
        <div className="card animate-slide-up overflow-x-auto p-0">
          <table className="table">
            <thead>
              <tr>
                {header("position", "#", "w-16")}
                {header("name", "Árbitro")}
                {header("refereed", "Pitados", "text-right", "desc")}
                {header("scored", "Planillados", "text-right", "desc")}
                {header("other", "Otros roles", "text-right", "desc")}
                {header("points", "Puntos", "text-right", "desc")}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                return (
                  <tr key={r.position} className={r.name === me ? "bg-brand-50" : ""}>
                    <td className="font-semibold text-stone-500">{r.position}</td>
                    <td className="font-medium">
                      <span className="inline-flex items-center gap-1.5">
                        {medals.has(r.position) && <TrophySolid className={`h-5 w-5 animate-pop ${medals.get(r.position)}`} aria-label="Medalla" />}
                        {r.name} {r.is_chief && <Badge color="brand">Jefe</Badge>}
                      </span>
                    </td>
                    <td className="text-right text-stone-600">{r.refereed ?? "—"}</td>
                    <td className="text-right text-stone-600">{r.scored ?? "—"}</td>
                    <td className="text-right text-stone-600">{r.other ?? "—"}</td>
                    <td className="text-right text-lg font-bold text-brand-600">{r.points ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  );
}
