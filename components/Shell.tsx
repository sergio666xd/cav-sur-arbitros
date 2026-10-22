"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import type { Me } from "@/lib/api";
import { Loading } from "./ui";

type NavItem = { href: string; label: string; show: (u: Me) => boolean };

const NAV: NavItem[] = [
  { href: "/disponibilidad", label: "Disponibilidad", show: (u) => u.perm_availability },
  { href: "/mis-torneos", label: "Mis torneos", show: (u) => u.is_referee || u.is_chief },
  { href: "/ranking", label: "Ranking", show: () => true },
  { href: "/admin/torneos", label: "Torneos", show: (u) => u.perm_admin },
  { href: "/admin/asignacion", label: "Asignación", show: (u) => u.perm_admin },
  { href: "/admin/arbitros", label: "Árbitros", show: (u) => u.perm_admin },
  { href: "/admin/clave", label: "Clave de registro", show: (u) => u.perm_admin },
  { href: "/jefe/calificaciones", label: "Calificaciones", show: (u) => u.is_chief },
];

function roleLabel(u: Me) {
  if (u.is_chief) return "Jefe";
  const roles = [];
  if (u.is_admin) roles.push("Administrador");
  if (u.is_referee) roles.push("Árbitro");
  return roles.join(" · ");
}

export default function Shell({
  children,
  allow,
}: {
  children: React.ReactNode;
  allow?: (u: Me) => boolean;
}) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  useEffect(() => setMenuOpen(false), [pathname]);

  if (loading || !user) {
    return (
      <div className="mx-auto max-w-5xl px-4">
        <Loading />
      </div>
    );
  }

  const items = NAV.filter((n) => n.show(user));
  const allowed = allow ? allow(user) : true;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b-2 border-brand-500 bg-night text-white shadow">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/" className="flex shrink-0 items-center gap-3" aria-label="Inicio">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/horizontal-negativo-transparente.svg" alt="CAV-SUR" className="h-9 w-auto" />
          </Link>
          <nav className="hidden gap-1 lg:flex">
            {items.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  pathname.startsWith(n.href) ? "bg-brand-500 text-white" : "text-white/80 hover:bg-white/10 hover:text-white"
                }`}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="hidden items-center gap-3 lg:flex">
            <Link href="/perfil" className="text-right text-xs leading-tight hover:underline">
              <div className="font-semibold">{user.first_name} {user.last_name}</div>
              <div className="text-white/60">{roleLabel(user)}</div>
            </Link>
            <button onClick={logout} className="rounded-md bg-white/15 px-3 py-1.5 text-sm hover:bg-white/25">Salir</button>
          </div>
          <button className="rounded-md px-2 py-1 text-xl lg:hidden" onClick={() => setMenuOpen(!menuOpen)} aria-label="Menú">☰</button>
        </div>
        {menuOpen && (
          <nav className="border-t border-white/20 px-4 pb-3 lg:hidden">
            <div className="py-2 text-xs text-white/60">{user.first_name} {user.last_name} · {roleLabel(user)}</div>
            {items.map((n) => (
              <Link key={n.href} href={n.href} className="block rounded-md px-3 py-2 text-sm hover:bg-white/10">
                {n.label}
              </Link>
            ))}
            <Link href="/perfil" className="block rounded-md px-3 py-2 text-sm hover:bg-white/10">Mi perfil</Link>
            <button onClick={logout} className="mt-1 block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-white/10">Salir</button>
          </nav>
        )}
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">
        {allowed ? children : <p className="text-sm text-stone-500">No tienes permiso para ver esta sección.</p>}
      </main>
    </div>
  );
}
