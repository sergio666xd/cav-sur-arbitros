import { CalendarDaysIcon, ClipboardDocumentListIcon, FlagIcon, PuzzlePieceIcon, StarIcon } from "@heroicons/react/24/outline";
import Link from "next/link";
import { Badge, Empty, StatCard } from "@/components/ui";
import { formatDateTime, formatShortDate } from "@/lib/api";

// Lo que devuelven /users/{id} y /me/detail.
export type RefereeDetail = {
  refereed: number;
  scored: number;
  other: number;
  points: number | null;
  upcoming_availability: { date: string; slot_label: string; tournament: string }[];
  assignments: { tournament_id: number; tournament: string; date: string; role: string | null; refereed: number | null; scored: number | null; other: number | null }[];
  ratings: { score: string; points: number; date: string }[];
};

const SCORE_LABEL: Record<string, string> = { MUY_MALO: "Muy Malo", MALO: "Malo", REGULAR: "Regular", BUENO: "Bueno", EXCELENTE: "Excelente" };

export function StatsRow({ data, isChief }: { data: RefereeDetail; isChief: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
      {([
        ["Asignaciones", data.assignments.length, CalendarDaysIcon],
        ["Pitados", isChief ? null : data.refereed, FlagIcon],
        ["Planillados", isChief ? null : data.scored, ClipboardDocumentListIcon],
        ["Otros roles", isChief ? null : data.other, PuzzlePieceIcon],
        ["Puntos", data.points ?? null, StarIcon],
      ] as const).map(([l, v, icon], i) => (
        <StatCard key={l} label={l} value={v} icon={icon} delay={i * 50} />
      ))}
    </div>
  );
}

export function UpcomingAvailability({ data }: { data: RefereeDetail }) {
  return (
    <>
      <h3 className="pt-3 font-semibold">Próximas disponibilidades</h3>
      {data.upcoming_availability.length === 0 ? (
        <p className="text-stone-500">Ninguna.</p>
      ) : (
        <ul className="space-y-1">
          {data.upcoming_availability.map((a, i) => (
            <li key={i}>{formatShortDate(a.date)} · {a.slot_label} <span className="text-stone-500">({a.tournament})</span></li>
          ))}
        </ul>
      )}
    </>
  );
}

export function RatingsCard({ data }: { data: RefereeDetail }) {
  return (
    <div className="card text-sm">
      <h2 className="mb-2 font-semibold">Calificaciones</h2>
      {data.ratings.length === 0 ? (
        <p className="text-stone-500">Sin calificaciones.</p>
      ) : (
        <ul className="space-y-1">
          {data.ratings.map((r, i) => (
            <li key={i} className="flex justify-between">
              <span>{SCORE_LABEL[r.score]} <span className="text-stone-400">· {formatDateTime(r.date)}</span></span>
              <span className="font-semibold">+{r.points}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// linkTournaments: enlaza cada torneo a su página de gestión (solo admins).
export function AssignmentHistory({ data, linkTournaments = false }: { data: RefereeDetail; linkTournaments?: boolean }) {
  return (
    <>
      <h2 className="mb-3 mt-8 text-lg font-semibold">Historial de asignaciones</h2>
      {data.assignments.length === 0 ? (
        <Empty>Sin asignaciones.</Empty>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="table">
            <thead>
              <tr><th>Fecha</th><th>Torneo</th><th>Rol</th><th className="text-right">Pitados</th><th className="text-right">Planillados</th><th className="text-right">Otros roles</th></tr>
            </thead>
            <tbody>
              {data.assignments.map((a, i) => (
                <tr key={i}>
                  <td>{formatShortDate(a.date)}</td>
                  <td>
                    {linkTournaments
                      ? <Link className="text-brand-700 hover:underline" href={`/admin/torneos/${a.tournament_id}`}>{a.tournament}</Link>
                      : a.tournament}
                  </td>
                  <td>{a.role ? <Badge color="brand">{a.role}</Badge> : "—"}</td>
                  <td className="text-right">{a.refereed ?? "—"}</td>
                  <td className="text-right">{a.scored ?? "—"}</td>
                  <td className="text-right">{a.other ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
