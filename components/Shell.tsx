"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { api, type Me } from "@/lib/api";
import {
  ArrowRightStartOnRectangleIcon, Bars3Icon, CalendarDaysIcon, ClipboardDocumentCheckIcon, KeyIcon,
  StarIcon, TrophyIcon, UserCircleIcon, UserGroupIcon, ViewColumnsIcon, XMarkIcon,
} from "@heroicons/react/24/outline";
import { Skeleton } from "./ui";

type Icon = React.ComponentType<{ className?: string }>;
type NavItem = { href: string; label: string; icon: Icon; show: (u: Me) => boolean };

const NAV: NavItem[] = [
  { href: "/disponibilidad", label: "Disponibilidad", icon: CalendarDaysIcon, show: (u) => u.perm_availability },
  { href: "/mis-torneos", label: "Mis torneos", icon: ClipboardDocumentCheckIcon, show: (u) => u.is_referee || u.is_chief },
  { href: "/ranking", label: "Ranking", icon: TrophyIcon, show: () => true },
  { href: "/admin/torneos", label: "Torneos", icon: CalendarDaysIcon, show: (u) => u.perm_admin },
  { href: "/admin/asignacion", label: "Asignación", icon: ViewColumnsIcon, show: (u) => u.perm_admin },
  { href: "/admin/arbitros", label: "Árbitros", icon: UserGroupIcon, show: (u) => u.perm_admin },
  { href: "/admin/clave", label: "Clave de registro", icon: KeyIcon, show: (u) => u.perm_admin },
  { href: "/jefe/calificaciones", label: "Calificaciones", icon: StarIcon, show: (u) => u.perm_chief },
];

/** Evento para que el menú vuelva a consultar las asignaciones por confirmar. */
export const PENDING_EVENT = "assignments-changed";

function PendingBadge({ count }: { count: number }) {
  return (
    <span className="ml-1.5 inline-flex h-5 min-w-5 animate-pop items-center justify-center rounded-full bg-red-600 px-1.5 text-xs font-bold text-white"
      title={`${count} asignación(es) por confirmar`} aria-label={`${count} por confirmar`}>
      {count}
    </span>
  );
}

function roleLabel(u: Me) {
  if (u.is_chief) return "Jefe";
  const roles = [];
  if (u.is_admin) roles.push("Administrador");
  if (u.is_referee) roles.push("Árbitro");
  return roles.join(" · ") || (u.perm_chief ? "Sistema" : "");
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

  // Alerta en el menú: asignaciones que el árbitro aún no confirma. Se actualiza al cambiar de
  // página y cuando Mis torneos avisa que se confirmó una.
  const [pending, setPending] = useState(0);
  const tracksAssignments = !!user && (user.is_referee || user.is_chief);
  useEffect(() => {
    if (!tracksAssignments) return;
    const load = () => api<{ count: number }>("/me/pending-confirmations").then((r) => setPending(r.count)).catch(() => {});
    load();
    window.addEventListener(PENDING_EVENT, load);
    return () => window.removeEventListener(PENDING_EVENT, load);
  }, [tracksAssignments, pathname]);

  if (loading || !user) {
    return (
      <div className="min-h-screen">
        <div className="border-b-2 border-brand-500 bg-night">
          <div className="viewport-center mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/horizontal-negativo-transparente.svg" alt="CAV-SUR" className="h-9 w-auto" />
            <div className="h-8 w-24 animate-pulse rounded-md bg-white/10" />
          </div>
        </div>
        <div className="viewport-center mx-auto max-w-6xl space-y-4 px-4 py-8">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-80 max-w-full" />
          <div className="grid gap-4 pt-2 md:grid-cols-2">
            <Skeleton className="h-32" /><Skeleton className="h-32" />
          </div>
        </div>
      </div>
    );
  }

  const items = NAV.filter((n) => n.show(user));
  // Con todas las secciones (system que además es árbitro) el menú no cabe en una línea: se pasa antes al menú móvil.
  const many = items.length > 7;
  const desk = many ? "2xl:flex" : "lg:flex";
  const mobile = many ? "2xl:hidden" : "lg:hidden";
  const allowed = allow ? allow(user) : true;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b-2 border-brand-500 bg-night text-white shadow">
        <div className="viewport-center mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/" className="flex shrink-0 items-center gap-3" aria-label="Inicio">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/horizontal-negativo-transparente.svg" alt="CAV-SUR" className="h-9 w-auto" />
          </Link>
          <nav className={`hidden gap-1 ${desk}`}>
            {items.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition duration-200 ${
                  pathname.startsWith(n.href) ? "bg-brand-500 text-white shadow-sm" : "text-white/80 hover:bg-white/10 hover:text-white"
                }`}
              >
                {n.label}
                {n.href === "/mis-torneos" && pending > 0 && <PendingBadge count={pending} />}
              </Link>
            ))}
          </nav>
          <div className={`hidden items-center gap-3 ${desk}`}>
            <Link href="/perfil" className="text-right text-xs leading-tight hover:underline">
              <div className="font-semibold">{user.first_name} {user.last_name}</div>
              <div className="text-white/60">{roleLabel(user)}</div>
            </Link>
            <button onClick={logout} className="inline-flex items-center gap-1.5 rounded-md bg-white/15 px-3 py-1.5 text-sm transition hover:bg-white/25 active:scale-95">
              <ArrowRightStartOnRectangleIcon className="h-4 w-4" />Salir
            </button>
          </div>
          <button className={`relative rounded-md p-1.5 transition hover:bg-white/10 active:scale-90 ${mobile}`} onClick={() => setMenuOpen(!menuOpen)}
            aria-label={menuOpen ? "Cerrar menú" : "Abrir menú"} aria-expanded={menuOpen}>
            {menuOpen ? <XMarkIcon className="h-6 w-6" /> : <Bars3Icon className="h-6 w-6" />}
            {pending > 0 && !menuOpen && <span className="absolute right-0.5 top-0.5 h-2.5 w-2.5 animate-pop rounded-full bg-red-600 ring-2 ring-night" />}
          </button>
        </div>
        {/* El menú móvil se despliega con una transición de altura. */}
        <div className={`grid transition-all duration-300 ease-out ${mobile} ${menuOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
          <nav className="overflow-hidden" aria-hidden={!menuOpen}>
            <div className="border-t border-white/20 px-4 pb-3">
              <div className="py-2 text-xs text-white/60">{user.first_name} {user.last_name} · {roleLabel(user)}</div>
              {[...items, { href: "/perfil", label: "Mi perfil", icon: UserCircleIcon }].map((n) => (
                <Link key={n.href} href={n.href} tabIndex={menuOpen ? 0 : -1}
                  className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition ${pathname.startsWith(n.href) ? "bg-brand-500 font-semibold text-white" : "hover:bg-white/10"}`}>
                  <n.icon className="h-5 w-5 opacity-80" />{n.label}
                  {n.href === "/mis-torneos" && pending > 0 && <PendingBadge count={pending} />}
                </Link>
              ))}
              <button onClick={logout} tabIndex={menuOpen ? 0 : -1} className="mt-1 flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition hover:bg-white/10">
                <ArrowRightStartOnRectangleIcon className="h-5 w-5 opacity-80" />Salir
              </button>
            </div>
          </nav>
        </div>
      </header>
      <main className="viewport-center mx-auto max-w-6xl animate-slide-up px-4 py-8">
        {allowed ? children : <p className="text-sm text-stone-500">No tienes permiso para ver esta sección.</p>}
      </main>
    </div>
  );
}
