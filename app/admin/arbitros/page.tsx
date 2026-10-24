"use client";

import { MagnifyingGlassIcon } from "@heroicons/react/20/solid";
import Link from "next/link";
import { useMemo, useState } from "react";
import Shell from "@/components/Shell";
import { RoleBadges, type UserRow } from "@/components/RoleBadges";
import { Alert, Loading, PageHeader } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useFetch } from "@/lib/useFetch";
import { useSort } from "@/lib/useSort";

export default function RefereesPage() {
  const { user } = useAuth();
  const { data, loading, error } = useFetch<UserRow[]>("/users");
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data ?? []).filter((u) => !term || `${u.first_name} ${u.last_name} ${u.document}`.toLowerCase().includes(term));
  }, [data, q]);
  const roleLabel = (u: UserRow) => (u.is_chief ? "Jefe" : [u.is_admin && "Coordinador", u.is_referee && "Árbitro"].filter(Boolean).join(" "));
  const { sorted, header } = useSort(rows, {
    name: (u) => `${u.first_name} ${u.last_name}`, document: (u) => u.document, age: (u) => u.age, roles: roleLabel,
    assignments: (u) => u.assignments, refereed: (u) => (u.is_chief ? null : u.refereed),
    scored: (u) => (u.is_chief ? null : u.scored), other: (u) => (u.is_chief ? null : u.other), points: (u) => u.points,
  });

  return (
    <Shell allow={(u) => u.perm_admin}>
      <PageHeader title="Árbitros" subtitle={`${data?.length ?? 0} usuarios registrados`}
        action={
          <div className="relative w-64">
            <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-stone-400" />
            <input className="input pl-9" placeholder="Buscar por nombre o documento" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        } />
      {loading ? (
        <Loading variant="table" />
      ) : error ? (
        <Alert>{error}</Alert>
      ) : (
        <div className="card animate-slide-up overflow-x-auto p-0">
          <table className="table">
            <thead>
              <tr>
                {header("name", "Nombre")}
                {header("document", "Documento")}
                {user?.perm_chief && header("age", "Edad")}
                {header("roles", "Roles")}
                {header("assignments", "Asignaciones", "text-right", "desc")}
                {header("refereed", "Pitados", "text-right", "desc")}
                {header("scored", "Planillados", "text-right", "desc")}
                {header("other", "Otros roles", "text-right", "desc")}
                {header("points", "Puntos", "text-right", "desc")}
              </tr>
            </thead>
            <tbody>
              {sorted.map((u) => (
                <tr key={u.id} className="hover:bg-brand-50/50">
                  <td><Link href={`/admin/arbitros/${u.id}`} className="font-medium text-brand-700 hover:underline">{u.first_name} {u.last_name}</Link></td>
                  <td className="font-mono text-xs">{u.document}</td>
                  {user?.perm_chief && <td>{u.age}</td>}
                  <td><RoleBadges u={u} /></td>
                  <td className="text-right">{u.assignments}</td>
                  <td className="text-right">{u.is_chief ? "—" : u.refereed}</td>
                  <td className="text-right">{u.is_chief ? "—" : u.scored}</td>
                  <td className="text-right">{u.is_chief ? "—" : u.other}</td>
                  <td className="text-right font-semibold">{u.points ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  );
}
