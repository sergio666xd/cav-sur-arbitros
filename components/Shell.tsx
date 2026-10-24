"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { api, type Me } from "@/lib/api";
import {
  ArrowRightStartOnRectangleIcon, Bars3Icon, CalendarDaysIcon, CalendarIcon, ClipboardDocumentCheckIcon, KeyIcon, NoSymbolIcon,
  StarIcon, TrophyIcon, UserCircleIcon, UserGroupIcon, ViewColumnsIcon, XMarkIcon,
} from "@heroicons/react/24/outline";
import { useFetch } from "@/lib/useFetch";
import { Skeleton } from "./ui";
import { formatPhone } from "./Whatsapp";

type Icon = React.ComponentType<{ className?: string }>;
type Section = "Arbitraje" | "Administración";
type NavItem = { href: string; label: string; icon: Icon; section: Section; show: (u: Me) => boolean };

const SECTIONS: Section[] = ["Arbitraje", "Administración"];

const NAV: NavItem[] = [
  { href: "/disponibilidad", section: "Arbitraje", label: "Disponibilidad", icon: CalendarDaysIcon, show: (u) => u.perm_availability },
  { href: "/mis-torneos", section: "Arbitraje", label: "Mis torneos", icon: ClipboardDocumentCheckIcon, show: (u) => u.is_referee || u.is_chief },
  { href: "/ranking", section: "Arbitraje", label: "Ranking", icon: TrophyIcon, show: () => true },
  { href: "/admin/torneos", section: "Administración", label: "Torneos", icon: CalendarDaysIcon, show: (u) => u.perm_admin },
  { href: "/admin/disponibilidades", section: "Administración", label: "Habilitar disponibilidad", icon: CalendarIcon, show: (u) => u.perm_admin },
  { href: "/admin/asignacion", section: "Administración", label: "Asignación", icon: ViewColumnsIcon, show: (u) => u.perm_admin },
  { href: "/admin/arbitros", section: "Administración", label: "Árbitros", icon: UserGroupIcon, show: (u) => u.perm_admin },
  { href: "/admin/clave", section: "Administración", label: "Clave de registro", icon: KeyIcon, show: (u) => u.perm_admin },
  { href: "/jefe/calificaciones", section: "Administración", label: "Calificaciones", icon: StarIcon, show: (u) => u.perm_chief },
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
  if (u.is_admin) roles.push("Coordinador");
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
  const tracksAssignments = !!user && user.active && (user.is_referee || user.is_chief);
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
        <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col gap-2 border-r-2 border-brand-500 bg-night px-3 py-5 lg:flex">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/horizontal-negativo.svg" alt="CAV.SUR" className="mx-2 mb-4 h-16 w-auto self-start" />
          {Array.from({ length: 5 }, (_, i) => <div key={i} className="h-9 animate-pulse rounded-md bg-white/10" />)}
        </aside>
        <div className="border-b-2 border-brand-500 bg-night lg:hidden">
          <div className="viewport-center mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/horizontal-negativo.svg" alt="CAV.SUR" className="h-12 w-auto" />
            <div className="h-8 w-10 animate-pulse rounded-md bg-white/10" />
          </div>
        </div>
        <div className="lg:pl-64">
          <div className="viewport-center mx-auto max-w-6xl space-y-4 px-4 py-8 lg:max-w-7xl lg:px-8">
            <Skeleton className="h-7 w-56" />
            <Skeleton className="h-4 w-80 max-w-full" />
            <div className="grid gap-4 pt-2 md:grid-cols-2">
              <Skeleton className="h-32" /><Skeleton className="h-32" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!user.active) return <Suspended onLogout={logout} />;

  const items = NAV.filter((n) => n.show(user));
  // Agrupa el menú por sección; los títulos solo aparecen si hay más de una.
  const groups = SECTIONS.map((title) => ({ title, items: items.filter((n) => n.section === title) })).filter((g) => g.items.length);
  const titled = groups.length > 1;
  const allowed = allow ? allow(user) : true;
  const linkClass = (href: string) =>
    `flex items-center gap-3 rounded-md px-3 py-2 text-sm transition duration-200 ${
      pathname.startsWith(href) ? "bg-brand-500 font-semibold text-white shadow-sm" : "text-white/80 hover:bg-white/10 hover:text-white"
    }`;

  return (
    <div className="min-h-screen">
      {/* Escritorio: barra lateral fija con todas las secciones. */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r-2 border-brand-500 bg-night text-white lg:flex">
        <Link href="/" className="px-5 py-5" aria-label="Inicio">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/horizontal-negativo.svg" alt="CAV.SUR" className="h-16 w-auto" />
        </Link>
        <nav className="flex-1 space-y-4 overflow-y-auto px-3 pb-3">
          {groups.map((g) => (
            <div key={g.title} className="space-y-1">
              {titled && <div className="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-white/45">{g.title}</div>}
              {g.items.map((n) => (
                <Link key={n.href} href={n.href} className={linkClass(n.href)}>
                  <n.icon className="h-5 w-5 shrink-0 opacity-80" />{n.label}
                  {n.href === "/mis-torneos" && pending > 0 && <span className="ml-auto"><PendingBadge count={pending} /></span>}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="space-y-1 border-t border-white/15 p-3">
          <Link href="/perfil" className={linkClass("/perfil")}>
            <UserCircleIcon className="h-5 w-5 shrink-0 opacity-80" />
            <div className="min-w-0 leading-tight">
              <div className="truncate font-semibold">{user.first_name} {user.last_name}</div>
              <div className="truncate text-xs font-normal text-white/60">{roleLabel(user)}</div>
            </div>
          </Link>
          <button onClick={logout} className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm text-white/80 transition hover:bg-white/10 hover:text-white">
            <ArrowRightStartOnRectangleIcon className="h-5 w-5 opacity-80" />Salir
          </button>
        </div>
      </aside>

      {/* Móvil y tableta: barra superior con menú desplegable. */}
      <header className="sticky top-0 z-40 border-b-2 border-brand-500 bg-night text-white shadow lg:hidden">
        <div className="viewport-center mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/" className="flex shrink-0 items-center gap-3" aria-label="Inicio">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/horizontal-negativo.svg" alt="CAV.SUR" className="h-12 w-auto" />
          </Link>
          <button className="relative rounded-md p-1.5 transition hover:bg-white/10 active:scale-90" onClick={() => setMenuOpen(!menuOpen)}
            aria-label={menuOpen ? "Cerrar menú" : "Abrir menú"} aria-expanded={menuOpen}>
            {menuOpen ? <XMarkIcon className="h-6 w-6" /> : <Bars3Icon className="h-6 w-6" />}
            {pending > 0 && !menuOpen && <span className="absolute right-0.5 top-0.5 h-2.5 w-2.5 animate-pop rounded-full bg-red-600 ring-2 ring-night" />}
          </button>
        </div>
        {/* El menú móvil se despliega con una transición de altura. */}
        <div className={`grid transition-all duration-300 ease-out ${menuOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
          <nav className="overflow-hidden" aria-hidden={!menuOpen}>
            <div className="border-t border-white/20 px-4 pb-3">
              <div className="py-2 text-xs text-white/60">{user.first_name} {user.last_name} · {roleLabel(user)}</div>
              {[...groups, { title: null, items: [{ href: "/perfil", label: "Mi perfil", icon: UserCircleIcon }] }].map((g) => (
                <div key={g.title ?? "cuenta"} className={g.title ? "" : "mt-2 border-t border-white/15 pt-2"}>
                  {titled && g.title && <div className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wider text-white/45">{g.title}</div>}
                  {g.items.map((n) => (
                    <Link key={n.href} href={n.href} tabIndex={menuOpen ? 0 : -1}
                      className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition ${pathname.startsWith(n.href) ? "bg-brand-500 font-semibold text-white" : "hover:bg-white/10"}`}>
                      <n.icon className="h-5 w-5 opacity-80" />{n.label}
                      {n.href === "/mis-torneos" && pending > 0 && <PendingBadge count={pending} />}
                    </Link>
                  ))}
                </div>
              ))}
              <button onClick={logout} tabIndex={menuOpen ? 0 : -1} className="mt-1 flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition hover:bg-white/10">
                <ArrowRightStartOnRectangleIcon className="h-5 w-5 opacity-80" />Salir
              </button>
            </div>
          </nav>
        </div>
      </header>
      <div className="lg:pl-64">
        <main className="viewport-center mx-auto max-w-6xl animate-slide-up px-4 py-8 lg:max-w-7xl lg:px-8">
          {allowed ? children : <p className="text-sm text-stone-500">No tienes permiso para ver esta sección.</p>}
        </main>
      </div>
    </div>
  );
}

// Un usuario suspendido ingresa, pero solo ve este aviso con el contacto del Jefe.
function Suspended({ onLogout }: { onLogout: () => void }) {
  const { data } = useFetch<{ chief_name: string | null; whatsapp: string | null }>("/auth/suspension");
  return (
    <div className="min-h-screen">
      <header className="border-b-2 border-brand-500 bg-night text-white shadow">
        <div className="viewport-center mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/horizontal-negativo.svg" alt="CAV.SUR" className="h-12 w-auto" />
          <button onClick={onLogout} className="inline-flex items-center gap-1.5 rounded-md bg-white/15 px-3 py-1.5 text-sm transition hover:bg-white/25 active:scale-95">
            <ArrowRightStartOnRectangleIcon className="h-4 w-4" />Salir
          </button>
        </div>
      </header>
      <main className="viewport-center mx-auto max-w-xl animate-slide-up px-4 py-12">
        <div className="card space-y-3 text-center">
          <NoSymbolIcon className="mx-auto h-12 w-12 text-red-500" />
          <h1 className="text-xl font-semibold">Tu cuenta está suspendida</h1>
          <p className="text-sm text-stone-600">
            Mientras esté suspendida no puedes usar la aplicación. Ponte en contacto con el Jefe
            {data?.chief_name ? <> (<b>{data.chief_name}</b>)</> : null} para más información.
          </p>
          {data?.whatsapp && (
            <a href={`https://wa.me/57${data.whatsapp}`} target="_blank" rel="noopener noreferrer"
              className="btn-primary mx-auto bg-green-600 hover:bg-green-700">
              Escribir por WhatsApp · {formatPhone(data.whatsapp)}
            </a>
          )}
        </div>
      </main>
    </div>
  );
}
