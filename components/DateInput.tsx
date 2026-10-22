"use client";

import { CalendarIcon } from "@heroicons/react/24/outline";
import { useEffect, useRef, useState } from "react";

// Campo de fecha en formato DD/MM/AAAA (estándar de Colombia). El valor que entra y sale es ISO (AAAA-MM-DD).
// El botón del calendario abre el selector nativo del navegador.

function toText(iso: string): string {
  const [y, m, d] = iso.split("-");
  return iso ? `${d}/${m}/${y}` : "";
}

function toIso(text: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (!m) return null;
  const [, d, mo, y] = m.map(Number);
  const date = new Date(y, mo - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

// Inserta las barras mientras se escribe: 23102026 -> 23/10/2026.
function mask(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)].filter(Boolean).join("/");
}

export default function DateInput({ value, onChange, required, className = "input" }: {
  value: string;
  onChange: (iso: string) => void;
  required?: boolean;
  className?: string;
}) {
  const [text, setText] = useState(toText(value));
  const picker = useRef<HTMLInputElement>(null);
  const field = useRef<HTMLInputElement>(null);

  // Si el valor cambia desde fuera (p. ej. "añadir día siguiente"), se refleja en el texto.
  useEffect(() => {
    if ((toIso(text) ?? "") !== value) setText(toText(value));
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  function type(raw: string) {
    const t = mask(raw);
    setText(t);
    const iso = toIso(t);
    field.current?.setCustomValidity(t && !iso ? "Escribe una fecha válida en formato DD/MM/AAAA." : "");
    onChange(iso ?? "");
  }

  return (
    <div className="relative">
      <input
        ref={field}
        className={`${className} pr-10`}
        inputMode="numeric"
        placeholder="DD/MM/AAAA"
        value={text}
        onChange={(e) => type(e.target.value)}
        required={required}
      />
      <button
        type="button"
        aria-label="Abrir calendario"
        className="absolute inset-y-0 right-0 px-3 text-stone-400 transition-colors hover:text-brand-600"
        onClick={() => picker.current?.showPicker?.()}
      >
        <CalendarIcon className="h-5 w-5" />
      </button>
      <input
        ref={picker}
        type="date"
        tabIndex={-1}
        aria-hidden
        className="pointer-events-none absolute bottom-0 right-0 h-0 w-0 opacity-0"
        value={value}
        onChange={(e) => type(toText(e.target.value))}
      />
    </div>
  );
}
