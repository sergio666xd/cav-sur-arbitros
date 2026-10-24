import { dmy, formatDate, formatShortDate, formatTime } from "./api";
import { shortAddress } from "./maps";

// Dibuja en un canvas una imagen para compartir: tabla con los árbitros en filas, las franjas en
// columnas y una X donde el árbitro marcó disponibilidad. En modo "assignment" muestra en cambio a
// los árbitros asignados, con su rol (o una X si no tiene), y sin totales.

// at: cuándo marcó disponibilidad (ordena las filas). mark: rol asignado.
export type ImageEntry = { user_id: number; name: string; at: string; mark?: string };
// date (AAAA-MM-DD) permite elegir qué fechas incluir al generar la imagen.
// days: franjas de torneo que cubre la columna, para sumar bien los solicitados al agrupar por fecha.
export type ImageColumn = {
  date?: string;
  top?: string;
  label: string;
  sub?: string;
  required: number;
  days?: { id: number; required: number }[];
  entries: ImageEntry[];
};
// info: datos que se muestran debajo del encabezado (p. ej. fecha, hora y lugar); color dibuja
// una muestra antes del valor (camiseta).
// hideColumns: solo se listan los árbitros, sin columnas (asignación de un torneo sin roles).
export type ImageSpec = {
  title: string;
  subtitle?: string;
  kind?: "availability" | "assignment";
  info?: { label: string; value: string; color?: string }[];
  hideColumns?: boolean;
  // footer: texto al pie de la imagen.
  footer?: string;
  // hideRequired: en disponibilidad, sin la fila de solicitados.
  hideRequired?: boolean;
  columns: ImageColumn[];
};

// Fila de /availability/summary: una franja combinada tal como la ve un árbitro.
export type SummaryRow = {
  date: string;
  slot_label: string;
  required: number;
  days: { id: number; required: number }[];
  tournament: { name: string } | null;
  entries: ImageEntry[];
};

export function summaryColumns(rows: SummaryRow[], withDate: boolean): ImageColumn[] {
  return rows.map((r) => ({
    date: r.date,
    top: withDate ? formatShortDate(r.date) : undefined,
    label: r.slot_label,
    sub: r.tournament?.name,
    required: r.required,
    days: r.days,
    entries: r.entries,
  }));
}

// Una sola columna por fecha: junta las franjas de cada día. Un árbitro cuenta una vez por fecha
// (con su primera inscripción) y los solicitados suman cada franja de torneo una sola vez, aunque
// la cubran varias disponibilidades.
export function groupByDate(cols: ImageColumn[]): ImageColumn[] {
  const out: ImageColumn[] = [];
  const byDate = new Map<string, ImageColumn & { seen: Map<number, number>; loose: number }>();
  for (const c of cols) {
    if (!c.date) {
      out.push(c);
      continue;
    }
    let g = byDate.get(c.date);
    if (!g) {
      // El día completo ("Sábado") y debajo la fecha.
      const [day] = formatDate(c.date).split(" ");
      const [, short] = formatShortDate(c.date).split(" ");
      g = { date: c.date, label: day, sub: short, required: 0, entries: [], seen: new Map(), loose: 0 };
      byDate.set(c.date, g);
      out.push(g);
    }
    if (c.days) for (const d of c.days) g.seen.set(d.id, d.required);
    else g.loose += c.required;
    g.required = g.loose + [...g.seen.values()].reduce((a, b) => a + b, 0);
    for (const e of c.entries) {
      const i = g.entries.findIndex((x) => x.user_id === e.user_id);
      if (i < 0) g.entries.push(e);
      else if (e.at < g.entries[i].at) g.entries[i] = e;
    }
  }
  return out;
}

// Imagen de los asignados a una franja de un torneo. La columna de rol solo aparece si el torneo
// usa roles. El lugar sale siempre: los asignados lo ven aunque el torneo esté oculto.
export function assignmentSpec(a: {
  tournament: string;
  date: string;
  slotLabel: string;
  location: string;
  categories: string[];
  specification?: string | null;
  shirt?: { name: string; color: string } | null;
  hasRoles: boolean;
  roles: string[];
  entries: { user_id: number; name: string; role: string | null }[];
}): ImageSpec {
  // Con roles, primero por rol (en el orden del torneo) y luego por nombre; sin roles, solo por nombre.
  const rank = (role: string | null) => (a.hasRoles && role && a.roles.includes(role) ? a.roles.indexOf(role) : a.roles.length);
  const entries = [...a.entries].sort((x, y) =>
    rank(x.role) - rank(y.role) || x.name.localeCompare(y.name, "es", { sensitivity: "base" }));
  return {
    kind: "assignment",
    title: a.tournament,
    subtitle: "Árbitros asignados",
    info: [
      { label: "Fecha", value: formatDate(a.date) },
      { label: "Hora", value: a.slotLabel },
      ...(a.location ? [{ label: "Lugar", value: shortAddress(a.location) }] : []),
      ...(a.categories.length ? [{ label: "Categorías", value: a.categories.join(", ") }] : []),
      ...(a.shirt ? [{ label: "Camiseta", value: a.shirt.name, color: a.shirt.color }] : []),
      ...(a.specification ? [{ label: "Especificación", value: a.specification }] : []),
    ],
    hideColumns: !a.hasRoles,
    footer: `Entra a Mis torneos (${window.location.host}/mis-torneos) para confirmar tu asignación y ver el lugar en el mapa.`,
    columns: [{
      label: "Rol",
      required: 0,
      entries: entries.map((e) => ({ user_id: e.user_id, name: e.name, at: "", mark: e.role ?? undefined })),
    }],
  };
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
  const logo = await loadImage("/brand/horizontal-negativo.svg");
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const assignment = spec.kind === "assignment";

  // Filas: cada árbitro una vez. En disponibilidad, en orden de registro (el 1 es quien marcó
  // disponibilidad primero); en asignaciones, en el orden en que llegan.
  const people = new Map<number, { name: string; at: string }>();
  for (const c of spec.columns) {
    for (const e of c.entries) {
      const p = people.get(e.user_id);
      if (!p || e.at < p.at) people.set(e.user_id, { name: e.name, at: e.at });
    }
  }
  const rows = [...people.entries()];
  if (!assignment) rows.sort((a, b) => a[1].at.localeCompare(b[1].at));
  const cols = spec.hideColumns ? [] : spec.columns;
  const marked = cols.map((c) => new Set(c.entries.map((e) => e.user_id)));
  const marks = cols.map((c) => new Map(c.entries.map((e) => [e.user_id, e.mark])));

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
  const headLines = cols.map((c) => {
    ctx.font = `700 24px ${FONT}`;
    // "Desde las 4:30 p. m." se muestra solo como la hora para que quepa en una línea.
    const label = wrap(ctx, c.label.replace(/^Desde las? /, ""), colW - 20);
    ctx.font = `400 20px ${FONT}`;
    const sub = c.sub ? wrap(ctx, c.sub, colW - 20).slice(0, 3).map((l) => l.replace(/\s*·$/, "")) : [];
    ctx.font = `700 22px ${FONT}`;
    const top = c.top ? wrap(ctx, c.top, colW - 20) : [];
    return { top, label, sub };
  });
  const headH = 24 + Math.max(30, ...headLines.map((h) => h.top.length * 30 + h.label.length * 30 + h.sub.length * 24)) + 16;

  // Encabezado oscuro: logo a la izquierda; título, subtítulo y fecha de generación a la derecha.
  // Así todo el espacio debajo queda para la tabla.
  const logoH = 100;
  const logoW = logoH * (696.498 / 378.069);
  const textW = W - PAD * 2 - logoW - 40;
  ctx.font = `800 40px ${FONT}`;
  const titleLines = wrap(ctx, spec.title, textW);
  ctx.font = `400 26px ${FONT}`;
  const subLines = spec.subtitle ? wrap(ctx, spec.subtitle, textW) : [];
  const generated = `Generado el ${dmy(new Date())} a las ${formatTime(new Date())}`;
  const textH = titleLines.length * 48 + subLines.length * 34 + 30;
  const HEADER = Math.max(170, textH + 60);
  // Datos debajo del encabezado: "Etiqueta: valor", partidos en líneas si no caben.
  ctx.font = `700 26px ${FONT}`;
  const SWATCH = 34;
  const info = (spec.info ?? []).map(({ label, value, color }) => {
    const labelW = ctx.measureText(`${label}: `).width + (color ? SWATCH : 0);
    ctx.font = `400 26px ${FONT}`;
    const lines = wrap(ctx, value, W - PAD * 2 - labelW);
    ctx.font = `700 26px ${FONT}`;
    return { label: `${label}: `, labelW, lines, color };
  });
  const infoTop = HEADER + 8 + 32;
  const infoH = info.reduce((h, i) => h + i.lines.length * 36, 0) + (info.length ? 20 : 0);
  const tableTop = infoTop + infoH;
  const tableBottom = tableTop + headH + Math.max(rows.length, 1) * ROW + (assignment ? 0 : spec.hideRequired ? ROW : 2 * ROW);
  canvas.width = W;
  ctx.font = `500 24px ${FONT}`;
  const footerLines = spec.footer ? wrap(ctx, spec.footer, W - PAD * 2) : [];
  const footerTop = tableBottom + 32;
  canvas.height = (footerLines.length ? footerTop + footerLines.length * 34 : tableBottom) + PAD;

  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, canvas.height);
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, W, HEADER);
  ctx.fillStyle = BRAND;
  ctx.fillRect(0, HEADER, W, 8);
  if (logo) ctx.drawImage(logo, PAD - 4, (HEADER - logoH) / 2, logoW, logoH);
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

  let iy = infoTop;
  for (const i of info) {
    ctx.fillStyle = BRAND;
    ctx.font = `700 26px ${FONT}`;
    ctx.fillText(i.label, PAD, iy + 26);
    if (i.color) {
      const cx = PAD + i.labelW - SWATCH + 12;
      ctx.beginPath();
      ctx.arc(cx, iy + 17, 12, 0, Math.PI * 2);
      ctx.fillStyle = i.color;
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.25)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.fillStyle = INK;
    ctx.font = `400 26px ${FONT}`;
    for (const l of i.lines) { ctx.fillText(l, PAD + i.labelW, iy + 26); iy += 36; }
  }

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
    ctx.fillStyle = "#fdba74";
    ctx.font = `700 22px ${FONT}`;
    for (const l of h.top) { center(l, colX(i), colW, hy + 18); hy += 30; }
    ctx.fillStyle = "#fff";
    ctx.font = `700 24px ${FONT}`;
    for (const l of h.label) { center(l, colX(i), colW, hy + 20); hy += 30; }
    ctx.fillStyle = "#d6d3d1";
    ctx.font = `400 20px ${FONT}`;
    for (const l of h.sub) { center(l, colX(i), colW, hy + 16); hy += 24; }
  });

  // Filas de árbitros.
  let ry = tableTop + headH;
  if (!rows.length) {
    ctx.fillStyle = MUTED;
    ctx.font = `400 24px ${FONT}`;
    ctx.fillText(assignment ? "Aún no hay árbitros asignados." : "Nadie ha marcado disponibilidad.", left + numW + 16, ry + 31);
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
      const mark = marks[i].get(uid);
      if (mark) {
        ctx.font = `700 22px ${FONT}`;
        center(wrap(ctx, mark, colW - 16)[0], colX(i), colW, ry + 31);
      } else {
        ctx.font = `800 26px ${FONT}`;
        center("X", colX(i), colW, ry + 32);
      }
    });
    ry += ROW;
  });

  // Totales (solo en disponibilidad): total de inscritos (en naranja si no alcanzan) y solicitados, si se muestran.
  const totals: [string, (i: number) => number][] = assignment ? [] : [
    ["Total", (i) => marked[i].size],
    ...(spec.hideRequired ? [] : [["Solicitados", (i: number) => cols[i].required] as [string, (i: number) => number]]),
  ];
  for (const [label, value] of totals) {
    ctx.fillStyle = "#fff7ed";
    ctx.fillRect(left, ry, tableW, ROW);
    ctx.fillStyle = INK;
    ctx.font = `700 24px ${FONT}`;
    ctx.fillText(label, left + numW + 16, ry + 31);
    cols.forEach((c, i) => {
      ctx.fillStyle = label === "Total" && !spec.hideRequired && marked[i].size < c.required ? BRAND : INK;
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

  // Pie de imagen.
  ctx.fillStyle = MUTED;
  ctx.font = `500 24px ${FONT}`;
  footerLines.forEach((l, i) => center(l, 0, W, footerTop + 24 + i * 34));

  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("No se pudo generar la imagen."))), "image/png"),
  );
}
