"use client";

import { useRouter } from "next/navigation";
import BackLink from "@/components/BackLink";
import Shell from "@/components/Shell";
import TournamentForm, { emptyTournament } from "@/components/TournamentForm";
import { PageHeader } from "@/components/ui";
import { api } from "@/lib/api";

export default function NewTournamentPage() {
  const router = useRouter();
  return (
    <Shell allow={(u) => u.perm_create_tournaments}>
      <BackLink href="/admin/torneos">Torneos</BackLink>
      <PageHeader title="Nuevo torneo" />
      <TournamentForm
        initial={emptyTournament}
        submitLabel="Crear torneo"
        onSubmit={async (body) => {
          const res = await api<{ id: number }>("/tournaments", { method: "POST", body });
          router.push(`/admin/torneos/${res.id}`);
        }}
      />
    </Shell>
  );
}
