"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import Shell from "@/components/Shell";
import TournamentForm, { DEFAULT_ROLES, type TournamentFormValue } from "@/components/TournamentForm";
import { Alert, Loading, PageHeader } from "@/components/ui";
import { api } from "@/lib/api";
import { useFetch } from "@/lib/useFetch";
import type { TournamentDetail } from "@/lib/types";

function toForm(t: TournamentDetail): TournamentFormValue {
  return {
    name: t.name,
    venues: t.venues.length ? t.venues : [""],
    categories: t.categories,
    referees_required: t.referees_required,
    is_visible: t.is_visible,
    has_roles: t.has_roles,
    roles: t.roles.length ? t.roles : DEFAULT_ROLES,
    notes: t.notes,
    // Las fechas pasadas no se editan aquí; el backend las conserva.
    days: t.days.filter((d) => !d.past).map((d) => ({
      id: d.id,
      date: d.date,
      all_day: d.all_day,
      start_time: d.start_time ?? "08:00",
      end_time: d.end_time ?? "18:00",
      referees_required: d.referees_required ? String(d.referees_required) : "",
      custom: !!d.categories?.length,
      location: d.location ?? t.location,
      categories: d.categories ?? [],
    })),
  };
}

export default function EditTournamentPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data, loading, error } = useFetch<TournamentDetail>(`/tournaments/${id}`);
  return (
    <Shell allow={(u) => u.perm_create_tournaments}>
      <Link href={`/admin/torneos/${id}`} className="mb-4 inline-block text-sm text-brand-700 hover:underline">← Volver al torneo</Link>
      <PageHeader title="Editar torneo y fechas" subtitle="Añade nuevas fechas para reutilizar el torneo. Si cambias la fecha de una franja, se borran sus disponibilidades y asignaciones." />
      {loading ? (
        <Loading />
      ) : error ? (
        <Alert>{error}</Alert>
      ) : data ? (
        <TournamentForm
          initial={toForm(data)}
          pastCount={data.days.filter((d) => d.past).length}
          submitLabel="Guardar cambios"
          onSubmit={async (body) => {
            await api(`/tournaments/${id}`, { method: "PUT", body });
            router.push(`/admin/torneos/${id}`);
          }}
        />
      ) : null}
    </Shell>
  );
}
