"use client";

import Link from "next/link";
import { useState } from "react";
import Shell from "@/components/Shell";
import { Alert, Badge, Empty, Loading, PageHeader } from "@/components/ui";
import { formatShortDate } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useFetch } from "@/lib/useFetch";
import type { DayDetail, TournamentDetail } from "@/lib/types";

type Row = Omit<TournamentDetail, "days"> & { days: (Omit<DayDetail, "candidates" | "assignments"> & { assigned_count: number })[] };

export default function TournamentsPage() {
  const { user } = useAuth();
  const [scope, setScope] = useState<"upcoming" | "past">("upcoming");
  const { data, loading, error } = useFetch<Row[]>(`/tournaments?scope=${scope}`);

  return (
    <Shell allow={(u) => u.perm_admin}>
      <PageHeader
        title="Torneos"
        action={user?.perm_create_tournaments && <Link href="/admin/torneos/nuevo" className="btn-primary">+ Nuevo torneo</Link>}
      />
      <div className="mb-4 inline-flex rounded-lg border border-stone-200 bg-white p-1 text-sm">
        {(["upcoming", "past"] as const).map((s) => (
          <button key={s} onClick={() => setScope(s)}
            className={`rounded-md px-3 py-1.5 font-medium ${scope === s ? "bg-brand-500 text-white" : "text-stone-600 hover:bg-stone-100"}`}>
            {s === "upcoming" ? "Próximos" : "Anteriores"}
          </button>
        ))}
      </div>
      {loading ? (
        <Loading />
      ) : error ? (
        <Alert>{error}</Alert>
      ) : !data?.length ? (
        <Empty>{scope === "upcoming" ? "No hay torneos próximos." : "No hay torneos anteriores."}</Empty>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.map((t) => (
            <Link key={t.id} href={`/admin/torneos/${t.id}`} className="card block transition hover:border-brand-300 hover:shadow-md">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="text-lg font-semibold">{t.name}</h2>
                  <div className="text-sm text-stone-600">📍 {t.location}</div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  {!t.is_visible && <Badge color="stone">Oculto</Badge>}
                  {t.has_roles && <Badge color="blue">Con roles</Badge>}
                </div>
              </div>
              {t.categories.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">{t.categories.map((c) => <Badge key={c} color="brand">{c}</Badge>)}</div>
              )}
              <table className="mt-3 w-full text-sm">
                <tbody>
                  {t.days.map((d) => (
                    <tr key={d.id} className="border-t border-stone-100">
                      <td className="py-1.5">{formatShortDate(d.date)}</td>
                      <td className="py-1.5 text-stone-500">{d.slot_label}</td>
                      <td className="py-1.5 text-right text-xs">
                        <span title="Disponibles">🙋 {d.available_count}</span>{" "}
                        <span title="Asignados / requeridos" className={d.assigned_count >= d.required ? "text-green-700" : "text-brand-700"}>
                          ✅ {d.assigned_count}/{d.required}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Link>
          ))}
        </div>
      )}
    </Shell>
  );
}
