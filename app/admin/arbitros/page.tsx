"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import Shell from "@/components/Shell";
import { RoleBadges, type UserRow } from "@/components/RoleBadges";
import { Alert, Loading, PageHeader } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useFetch } from "@/lib/useFetch";

export default function RefereesPage() {
  const { user } = useAuth();
  const { data, loading, error } = useFetch<UserRow[]>("/users");
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data ?? []).filter((u) => !term || `${u.first_name} ${u.last_name} ${u.document}`.toLowerCase().includes(term));
  }, [data, q]);

  return (
    <Shell allow={(u) => u.perm_admin}>
      <PageHeader title="Árbitros" subtitle={`${data?.length ?? 0} usuarios registrados`}
        action={<input className="input w-64" placeholder="Buscar por nombre o documento" value={q} onChange={(e) => setQ(e.target.value)} />} />
      {loading ? (
        <Loading />
      ) : error ? (
        <Alert>{error}</Alert>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Documento</th>
                {user?.is_chief && <th>Edad</th>}
                <th>Roles</th>
                <th className="text-right">Asignaciones</th>
                <th className="text-right">Pitados</th>
                <th className="text-right">Planillados</th>
                <th className="text-right">Puntos</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id} className="hover:bg-brand-50/50">
                  <td><Link href={`/admin/arbitros/${u.id}`} className="font-medium text-brand-700 hover:underline">{u.first_name} {u.last_name}</Link></td>
                  <td className="font-mono text-xs">{u.document}</td>
                  {user?.is_chief && <td>{u.age}</td>}
                  <td><RoleBadges u={u} /></td>
                  <td className="text-right">{u.assignments}</td>
                  <td className="text-right">{u.is_chief ? "—" : u.refereed}</td>
                  <td className="text-right">{u.is_chief ? "—" : u.scored}</td>
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
