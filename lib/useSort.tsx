"use client";

import { ChevronUpDownIcon, ChevronUpIcon } from "@heroicons/react/20/solid";
import { useMemo, useState } from "react";
import { fold } from "./text";

type Dir = "asc" | "desc";
type Value = string | number | null | undefined;

/** Ordena filas por la columna elegida; tocar la misma columna invierte el orden y una tercera vez lo quita. */
export function useSort<T>(rows: T[] | null | undefined, getters: Record<string, (r: T) => Value>) {
  const [sort, setSort] = useState<{ key: string; dir: Dir } | null>(null);

  const sorted = useMemo(() => {
    const list = [...(rows ?? [])];
    if (!sort) return list;
    const get = getters[sort.key];
    const sign = sort.dir === "asc" ? 1 : -1;
    return list.sort((a, b) => {
      const x = get(a), y = get(b);
      // Los vacíos van siempre al final.
      if (x == null || x === "") return y == null || y === "" ? 0 : 1;
      if (y == null || y === "") return -1;
      if (typeof x === "number" && typeof y === "number") return (x - y) * sign;
      return fold(String(x)).localeCompare(fold(String(y)), "es") * sign;
    });
  }, [rows, sort]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggle(key: string, firstDir: Dir = "asc") {
    setSort((s) => {
      if (!s || s.key !== key) return { key, dir: firstDir };
      if (s.dir === firstDir) return { key, dir: firstDir === "asc" ? "desc" : "asc" };
      return null;
    });
  }

  function header(k: string, children: React.ReactNode, className = "", first: Dir = "asc") {
    const active = sort?.key === k;
    const right = className.includes("text-right");
    return (
      <th key={k} className={className} aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : "none"}>
        <button type="button" onClick={() => toggle(k, first)}
          className={`inline-flex items-center gap-1 uppercase transition-colors hover:text-brand-700 ${right ? "flex-row-reverse" : ""} ${active ? "text-brand-700" : ""}`}>
          {children}
          {active
            ? <ChevronUpIcon className={`h-3.5 w-3.5 transition-transform duration-200 ${sort!.dir === "desc" ? "rotate-180" : ""}`} />
            : <ChevronUpDownIcon className="h-3.5 w-3.5 opacity-50" />}
        </button>
      </th>
    );
  }

  return { sorted, header, sort };
}
