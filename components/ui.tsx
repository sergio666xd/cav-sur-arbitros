"use client";

import { CheckCircleIcon, ExclamationTriangleIcon, InformationCircleIcon, XMarkIcon } from "@heroicons/react/20/solid";
import { useEffect, useState } from "react";

export function Alert({ kind = "error", children }: { kind?: "error" | "success" | "info"; children: React.ReactNode }) {
  const { styles, Icon } = {
    error: { styles: "border-red-200 bg-red-50 text-red-800", Icon: ExclamationTriangleIcon },
    success: { styles: "border-green-200 bg-green-50 text-green-800", Icon: CheckCircleIcon },
    info: { styles: "border-brand-200 bg-brand-50 text-brand-900", Icon: InformationCircleIcon },
  }[kind];
  return (
    <div role={kind === "error" ? "alert" : "status"} className={`flex animate-slide-down items-start gap-2 rounded-lg border px-4 py-3 text-sm ${styles}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div>{children}</div>
    </div>
  );
}

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return <span className={`inline-block shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`} aria-hidden />;
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden />;
}

// Esqueletos con la forma aproximada de cada tipo de página mientras llegan los datos.
export function Loading({ variant = "cards" }: { variant?: "cards" | "table" | "detail" | "form" | "list" }) {
  return (
    <div className="animate-fade-in" role="status" aria-label="Cargando">
      {variant === "table" && (
        <div className="card p-0">
          <div className="flex gap-4 border-b border-stone-200 px-4 py-3">
            <Skeleton className="h-3 w-8" /><Skeleton className="h-3 w-40" /><Skeleton className="ml-auto h-3 w-16" /><Skeleton className="h-3 w-16" />
          </div>
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex items-center gap-4 border-b border-stone-100 px-4 py-3 last:border-0">
              <Skeleton className="h-4 w-8" />
              <Skeleton className={`h-4 ${["w-48", "w-36", "w-56", "w-40", "w-44", "w-32"][i]}`} />
              <Skeleton className="ml-auto h-4 w-12" />
              <Skeleton className="h-4 w-12" />
            </div>
          ))}
        </div>
      )}
      {variant === "cards" && (
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="card space-y-3">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
              <div className="flex gap-2 pt-1"><Skeleton className="h-5 w-14 rounded-full" /><Skeleton className="h-5 w-16 rounded-full" /></div>
              <Skeleton className="h-2 w-full rounded-full" />
            </div>
          ))}
        </div>
      )}
      {variant === "list" && (
        <div className="space-y-3">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="card flex items-center gap-4 py-4">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="flex-1 space-y-2"><Skeleton className="h-4 w-1/3" /><Skeleton className="h-3 w-1/2" /></div>
              <Skeleton className="h-8 w-20" />
            </div>
          ))}
        </div>
      )}
      {variant === "detail" && (
        <div className="space-y-6">
          <div className="space-y-3"><Skeleton className="h-7 w-72 max-w-full" /><Skeleton className="h-4 w-56 max-w-full" /></div>
          <div className="flex gap-2"><Skeleton className="h-5 w-16 rounded-full" /><Skeleton className="h-5 w-20 rounded-full" /><Skeleton className="h-5 w-24 rounded-full" /></div>
          {Array.from({ length: 2 }, (_, i) => (
            <div key={i} className="card grid gap-6 lg:grid-cols-2">
              <div className="space-y-3"><Skeleton className="h-6 w-2/3" /><Skeleton className="h-4 w-1/2" /><Skeleton className="h-4 w-1/3" /></div>
              <div className="space-y-2">{Array.from({ length: 4 }, (_, j) => <Skeleton key={j} className="h-9 w-full" />)}</div>
            </div>
          ))}
        </div>
      )}
      {variant === "form" && (
        <div className="card max-w-2xl space-y-5">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="space-y-2"><Skeleton className="h-4 w-32" /><Skeleton className="h-10 w-full" /></div>
          ))}
        </div>
      )}
      <span className="sr-only">Cargando...</span>
    </div>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-6 flex animate-fade-in flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-stone-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Empty({ children, icon: Icon }: { children: React.ReactNode; icon?: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="animate-fade-in rounded-xl border border-dashed border-stone-300 bg-white p-8 text-center text-sm text-stone-500">
      {Icon && <Icon className="mx-auto mb-3 h-8 w-8 text-stone-300" />}
      {children}
    </div>
  );
}

export function Badge({ color = "stone", children }: { color?: "brand" | "green" | "stone" | "red" | "blue"; children: React.ReactNode }) {
  const styles = {
    brand: "bg-brand-100 text-brand-800",
    green: "bg-green-100 text-green-800",
    stone: "bg-stone-100 text-stone-700",
    red: "bg-red-100 text-red-700",
    blue: "bg-sky-100 text-sky-800",
  }[color];
  return <span className={`badge ${styles}`}>{children}</span>;
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex animate-fade-in items-end justify-center bg-black/40 p-4 backdrop-blur-[2px] sm:items-center" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-lg animate-scale-in overflow-y-auto rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button className="btn-ghost px-2 py-1" onClick={onClose} aria-label="Cerrar"><XMarkIcon className="h-5 w-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

// Número que sube desde 0 hasta su valor al aparecer.
export function CountUp({ value, duration = 700 }: { value: number; duration?: number }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(value);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      setShown(Math.round(value * (1 - Math.pow(1 - p, 3))));
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);
  return <>{shown}</>;
}

export function StatCard({ label, value, icon: Icon, delay = 0 }: {
  label: string;
  value: number | null;
  icon?: React.ComponentType<{ className?: string }>;
  delay?: number;
}) {
  return (
    <div className="card animate-slide-up hover:shadow-md" style={{ animationDelay: `${delay}ms` }}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs uppercase tracking-wide text-stone-500">{label}</div>
        {Icon && <Icon className="h-5 w-5 text-brand-400" />}
      </div>
      <div className="mt-1 text-3xl font-bold tabular-nums text-brand-600">{value === null ? "—" : <CountUp value={value} />}</div>
    </div>
  );
}

export function StatSkeleton({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="card space-y-3"><Skeleton className="h-3 w-24" /><Skeleton className="h-8 w-12" /></div>
      ))}
    </>
  );
}

// Barra que se llena con una transición al aparecer y cuando cambia el valor.
export function ProgressBar({ pct }: { pct: number }) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setWidth(pct));
    return () => cancelAnimationFrame(frame);
  }, [pct]);
  return (
    <div className="h-2 overflow-hidden rounded-full bg-stone-100">
      <div className={`h-2 rounded-full transition-[width] duration-700 ease-out ${pct >= 100 ? "bg-green-500" : "bg-brand-500"}`} style={{ width: `${width}%` }} />
    </div>
  );
}
