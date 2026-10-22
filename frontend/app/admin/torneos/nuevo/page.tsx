"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import Shell from "@/components/Shell";
import TournamentForm, { emptyTournament } from "@/components/TournamentForm";
import { PageHeader } from "@/components/ui";
import { api } from "@/lib/api";

export default function NewTournamentPage() {
  const router = useRouter();
  return (
    <Shell allow={(u) => u.perm_create_tournaments}>
      <Link href="/admin/torneos" className="mb-4 inline-block text-sm text-brand-700 hover:underline">← Torneos</Link>
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
