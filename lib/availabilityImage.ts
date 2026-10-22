import { dmy, formatShortDate, formatTime } from "./api";
import { shortAddress } from "./maps";

// Dibuja en un canvas una imagen para compartir: tabla con los árbitros en filas, las franjas en
// columnas y una X donde el árbitro marcó disponibilidad.

export type ImageEntry = { user_id: number; name: string; at: string };
export type ImageColumn = { top?: string; label: string; sub?: string; required: number; entries: ImageEntry[] };
export type ImageSpec = { title: string; subtitle?: string; columns: ImageColumn[] };

// Fila de /availability/summary: una franja combinada tal como la ve un árbitro.
export type SummaryRow = {
  date: string;
  slot_label: string;
  required: number;
  tournament: { name: string; location: string } | null;
  entries: ImageEntry[];
};

export function summaryColumns(rows: SummaryRow[], withDate: boolean): ImageColumn[] {
  return rows.map((r) => ({
    top: withDate ? formatShortDate(r.date) : undefined,
    label: r.slot_label,
    sub: r.tournament ? [r.tournament.name, shortAddress(r.tournament.location)].filter(Boolean).join(" · ") : undefined,
    required: r.required,
    entries: r.entries,
  }));
}

const PAD = 56;
const INK = "#1b1f24";
const BRAND = "#f65a03";
const MUTED = "#78716c";
const LINE = "#d6d3d1";
const MARK = "#c6e7b4";
const ZEBRA = "#fafaf9";
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const ROW = 46;
const COL = 190;

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// Parte un texto en líneas que caben en `max` píxeles.
function wrap(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > max) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

export async function renderAvailabilityImage(spec: ImageSpec): Promise<Blob> {
  const logo = await loadImage("/brand/horizontal-negativo-transparente.svg");
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const cols = spec.columns;

  // Filas: cada árbitro una vez, en orden de registro (el 1 es quien marcó disponibilidad primero).
  const people = new Map<number, { name: string; at: string }>();
  for (const c of cols) {
    for (const e of c.entries) {
      const p = people.get(e.user_id);
      if (!p || e.at < p.at) people.set(e.user_id, { name: e.name, at: e.at });
    }
  }
  const rows = [...people.entries()].sort((a, b) => a[1].at.localeCompare(b[1].at));
  const marked = cols.map((c) => new Set(c.entries.map((e) => e.user_id)));

  ctx.font = `500 24px ${FONT}`;
  const numW = 64;
  const minNameW = Math.max(300, ...rows.map(([, p]) => ctx.measureText(p.name).width + 40));
  // La tabla ocupa todo el ancho; el espacio sobrante es para la columna de árbitros.
  const W = Math.max(1080, numW + minNameW + COL * cols.length + PAD * 2);
  const tableW = W - PAD * 2;
  const colW = COL;
  const nameW = tableW - numW - colW * cols.length;
  const left = PAD;

  // Encabezado de cada columna: fecha, franja y torneo (solo si se puede mostrar).
  ctx.font = `400 20px ${FONT}`;
  const headLines = cols.map((c) => ({ top: c.top, label: c.label, sub: c.sub ? wrap(ctx, c.sub, colW - 20).slice(0, 3).map((l) => l.replace(/\s*·$/, "")) : [] }));
  const headH = 24 + Math.max(30, ...headLines.map((h) => (h.top ? 30 : 0) + 30 + h.sub.length * 24)) + 16;

  // Encabezado oscuro: logo a la izquierda; título, subtítulo y fecha de generación a la derecha.
  // Así todo el espacio debajo queda para la tabla.
  const logoH = 100;
  const logoW = logoH * (1320 / 375);
  const textW = W - PAD * 2 - logoW - 40;
  ctx.font = `800 40px ${FONT}`;
  const titleLines = wrap(ctx, spec.title, textW);
  ctx.font = `400 26px ${FONT}`;
  const subLines = spec.subtitle ? wrap(ctx, spec.subtitle, textW) : [];
  const generated = `Generado el ${dmy(new Date())} a las ${formatTime(new Date())}`;
  const textH = titleLines.length * 48 + subLines.length * 34 + 30;
  const HEADER = Math.max(170, textH + 60);
  const tableTop = HEADER + 8 + 32;
  const tableBottom = tableTop + headH + Math.max(rows.length, 1) * ROW + 2 * ROW;
  canvas.width = W;
  canvas.height = tableBottom + PAD;

  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, canvas.height);
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, W, HEADER);
  ctx.fillStyle = BRAND;
  ctx.fillRect(0, HEADER, W, 8);
  if (logo) ctx.drawImage(logo, PAD - 10, (HEADER - logoH) / 2, logoW, logoH);
  else {
    ctx.fillStyle = "#fff";
    ctx.font = `800 60px ${FONT}`;
    ctx.fillText("CAV-SUR", PAD, HEADER / 2 + 20);
  }

  const right = (text: string, yy: number) => ctx.fillText(text, W - PAD - ctx.measureText(text).width, yy);
  let y = (HEADER - textH) / 2;
  ctx.fillStyle = "#fff";
  ctx.font = `800 40px ${FONT}`;
  for (const l of titleLines) { right(l, y + 38); y += 48; }
  ctx.fillStyle = "#fdba74";
  ctx.font = `400 26px ${FONT}`;
  for (const l of subLines) { right(l, y + 28); y += 34; }
  ctx.fillStyle = "#a8a29e";
  ctx.font = `400 20px ${FONT}`;
  right(generated, y + 22);

  const colX = (i: number) => left + numW + nameW + i * colW;
  const center = (text: string, x: number, w: number, yy: number) => ctx.fillText(text, x + (w - ctx.measureText(text).width) / 2, yy);

  // Encabezado de la tabla.
  ctx.fillStyle = INK;
  ctx.fillRect(left, tableTop, tableW, headH);
  ctx.fillStyle = "#fff";
  ctx.font = `700 24px ${FONT}`;
  center("#", left, numW, tableTop + headH - 20);
  ctx.fillText("Árbitro", left + numW + 16, tableTop + headH - 20);
  headLines.forEach((h, i) => {
    let hy = tableTop + 24;
    if (h.top) {
      ctx.fillStyle = "#fdba74";
      ctx.font = `700 22px ${FONT}`;
      center(h.top, colX(i), colW, hy + 18);
      hy += 30;
    }
    ctx.fillStyle = "#fff";
    ctx.font = `700 24px ${FONT}`;
    center(h.label, colX(i), colW, hy + 20);
    hy += 30;
    ctx.fillStyle = "#d6d3d1";
    ctx.font = `400 20px ${FONT}`;
    for (const l of h.sub) { center(l, colX(i), colW, hy + 16); hy += 24; }
  });

  // Filas de árbitros.
  let ry = tableTop + headH;
  if (!rows.length) {
    ctx.fillStyle = MUTED;
    ctx.font = `400 24px ${FONT}`;
    ctx.fillText("Nadie ha marcado disponibilidad.", left + numW + 16, ry + 31);
    ry += ROW;
  }
  rows.forEach(([uid, p], r) => {
    if (r % 2) { ctx.fillStyle = ZEBRA; ctx.fillRect(left, ry, tableW, ROW); }
    ctx.fillStyle = MUTED;
    ctx.font = `600 22px ${FONT}`;
    center(String(r + 1), left, numW, ry + 31);
    ctx.fillStyle = INK;
    ctx.font = `500 24px ${FONT}`;
    ctx.fillText(p.name, left + numW + 16, ry + 31);
    cols.forEach((_, i) => {
      if (!marked[i].has(uid)) return;
      ctx.fillStyle = MARK;
      ctx.fillRect(colX(i), ry, colW, ROW);
      ctx.fillStyle = INK;
      ctx.font = `800 26px ${FONT}`;
      center("X", colX(i), colW, ry + 32);
    });
    ry += ROW;
  });

  // Totales: disponibles (en naranja si no alcanzan) y solicitados.
  const totals: [string, (i: number) => number][] = [
    ["Disponibles", (i) => marked[i].size],
    ["Solicitados", (i) => cols[i].required],
  ];
  for (const [label, value] of totals) {
    ctx.fillStyle = "#fff7ed";
    ctx.fillRect(left, ry, tableW, ROW);
    ctx.fillStyle = INK;
    ctx.font = `700 24px ${FONT}`;
    ctx.fillText(label, left + numW + 16, ry + 31);
    cols.forEach((c, i) => {
      ctx.fillStyle = label === "Disponibles" && marked[i].size < c.required ? BRAND : INK;
      center(String(value(i)), colX(i), colW, ry + 31);
    });
    ry += ROW;
  }

  // Cuadrícula.
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1;
  for (let yy = tableTop + headH; yy <= ry; yy += ROW) {
    ctx.beginPath(); ctx.moveTo(left, yy + 0.5); ctx.lineTo(left + tableW, yy + 0.5); ctx.stroke();
  }
  for (const x of [left, left + numW, ...cols.map((_, i) => colX(i)), left + tableW]) {
    ctx.beginPath(); ctx.moveTo(x + 0.5, tableTop); ctx.lineTo(x + 0.5, ry); ctx.stroke();
  }

  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("No se pudo generar la imagen."))), "image/png"),
  );
}
