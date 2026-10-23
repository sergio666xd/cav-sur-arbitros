"use client";

import { PlusIcon, TrashIcon } from "@heroicons/react/20/solid";
import { useState } from "react";
import BackLink from "@/components/BackLink";
import Shell from "@/components/Shell";
import { ShirtSwatch } from "@/components/Shirt";
import { Alert, Empty, Loading, PageHeader, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import type { Shirt } from "@/lib/types";
import { useFetch } from "@/lib/useFetch";

export default function ShirtsPage() {
  const { data, loading, error, reload } = useFetch<Shirt[]>("/shirts");
  const [name, setName] = useState("");
  const [color, setColor] = useState("#f65a03");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api("/shirts", { method: "POST", body: { name, color } });
      setName("");
      await reload();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(s: Shirt) {
    if (!confirm(`¿Eliminar la camiseta ${s.name}? Las franjas que la tengan quedarán sin camiseta.`)) return;
    setMsg(null);
    try {
      await api(`/shirts/${s.id}`, { method: "DELETE" });
      await reload();
    } catch (err) {
      setMsg((err as Error).message);
    }
  }

  return (
    <Shell allow={(u) => u.perm_admin}>
      <BackLink href="/admin/torneos">Torneos</BackLink>
      <PageHeader title="Camisetas" subtitle="Colores de camiseta que se pueden asignar a cada franja. Los árbitros asignados ven cuál deben llevar." />
      <form onSubmit={add} className="card mb-6 flex max-w-lg animate-scale-in flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <label className="label" htmlFor="shirt-name">Nombre</label>
          <input id="shirt-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Naranja" maxLength={60} required />
        </div>
        <div>
          <label className="label" htmlFor="shirt-color">Color</label>
          <input id="shirt-color" type="color" className="h-10 w-14 cursor-pointer rounded-lg border border-stone-300 bg-white p-1" value={color} onChange={(e) => setColor(e.target.value)} />
        </div>
        <button className="btn-primary" disabled={busy || !name.trim()}>
          {busy ? <Spinner /> : <PlusIcon className="h-4 w-4" />}Añadir
        </button>
      </form>
      {msg && <div className="mb-4 max-w-lg"><Alert>{msg}</Alert></div>}
      {loading && !data ? (
        <Loading variant="list" />
      ) : error ? (
        <Alert>{error}</Alert>
      ) : !data?.length ? (
        <Empty>Aún no hay camisetas registradas.</Empty>
      ) : (
        <ul className="card max-w-lg divide-y divide-stone-100 p-0">
          {data.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="inline-flex items-center gap-3 font-medium"><ShirtSwatch color={s.color} className="h-6 w-6" />{s.name}</span>
              <button className="btn-ghost px-2 py-1 text-sm text-red-700" onClick={() => remove(s)}>
                <TrashIcon className="h-4 w-4" />Eliminar
              </button>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}
