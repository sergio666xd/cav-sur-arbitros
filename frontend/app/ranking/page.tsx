"use client";

import Shell from "@/components/Shell";
import { Alert, Badge, Empty, Loading, PageHeader } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useFetch } from "@/lib/useFetch";

type Row = { position: number; name: string; points: number | null; is_chief: boolean };

const MEDALS = ["", "🥇", "🥈", "🥉"];

export default function RankingPage() {
  const { user } = useAuth();
  const { data, error, loading } = useFetch<Row[]>("/ranking");
  const me = user ? `${user.first_name} ${user.last_name}` : "";
  // Las medallas se cuentan sin el Jefe, que siempre aparece primero.
  let place = 0;

  return (
    <Shell>
      <PageHeader title="Ranking" subtitle="Puntos acumulados por calificaciones de desempeño." />
      {loading ? (
        <Loading />
      ) : error ? (
        <Alert>{error}</Alert>
      ) : !data?.length ? (
        <Empty>Aún no hay árbitros en el ranking.</Empty>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="table">
            <thead>
              <tr>
                <th className="w-16">#</th>
                <th>Árbitro</th>
                <th className="text-right">Puntos</th>
              </tr>
            </thead>
            <tbody>
              {data.map((r) => {
                if (!r.is_chief) place++;
                return (
                  <tr key={r.position} className={r.name === me ? "bg-brand-50" : ""}>
                    <td className="font-semibold text-stone-500">{r.position}</td>
                    <td className="font-medium">
                      {!r.is_chief && MEDALS[place] ? `${MEDALS[place]} ` : ""}
                      {r.name} {r.is_chief && <Badge color="brand">Jefe</Badge>}
                    </td>
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
