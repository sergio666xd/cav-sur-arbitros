// Dibuja en un canvas una imagen para compartir con la lista de árbitros disponibles.

export type ImageSection = { heading: string; sub?: string; names: string[]; required: number };
export type ImageSpec = { title: string; subtitle?: string; sections: ImageSection[] };

const W = 1080;
const PAD = 64;
const INK = "#1b1f24";
const BRAND = "#f65a03";
const MUTED = "#78716c";
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

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
  const inner = W - PAD * 2;
  const colW = (inner - 32) / 2;

  // Primera pasada para medir el alto; la segunda dibuja.
  const draw = (paint: boolean) => {
    let y = 0;
    const HEADER = 190;
    if (paint) {
      ctx.fillStyle = INK;
      ctx.fillRect(0, 0, W, HEADER);
      ctx.fillStyle = BRAND;
      ctx.fillRect(0, HEADER, W, 8);
      if (logo) ctx.drawImage(logo, PAD - 10, 40, 110 * (1320 / 375), 110);
      else {
        ctx.fillStyle = "#fff";
        ctx.font = `800 64px ${FONT}`;
        ctx.fillText("CAV-SUR", PAD, 120);
      }
    }
    y = HEADER + 8 + 64;

    ctx.font = `800 46px ${FONT}`;
    for (const l of wrap(ctx, spec.title, inner)) {
      if (paint) { ctx.fillStyle = INK; ctx.fillText(l, PAD, y + 40); }
      y += 56;
    }
    if (spec.subtitle) {
      ctx.font = `400 30px ${FONT}`;
      for (const l of wrap(ctx, spec.subtitle, inner)) {
        if (paint) { ctx.fillStyle = MUTED; ctx.fillText(l, PAD, y + 30); }
        y += 40;
      }
    }
    y += 24;

    for (const s of spec.sections) {
      y += 24;
      const top = y;
      y += 32;
      ctx.font = `700 34px ${FONT}`;
      const heading = wrap(ctx, s.heading, inner - 48);
      for (const l of heading) {
        if (paint) { ctx.fillStyle = INK; ctx.fillText(l, PAD + 24, y + 32); }
        y += 44;
      }
      if (s.sub) {
        ctx.font = `400 26px ${FONT}`;
        for (const l of wrap(ctx, s.sub, inner - 48)) {
          if (paint) { ctx.fillStyle = MUTED; ctx.fillText(l, PAD + 24, y + 26); }
          y += 36;
        }
      }
      ctx.font = `600 26px ${FONT}`;
      const label = `${s.names.length} ${s.names.length === 1 ? "disponible" : "disponibles"} de ${s.required} ${s.required === 1 ? "solicitado" : "solicitados"}`;
      if (paint) { ctx.fillStyle = BRAND; ctx.fillText(label, PAD + 24, y + 30); }
      y += 52;

      // Nombres en dos columnas, ordenados de arriba abajo.
      ctx.font = `400 30px ${FONT}`;
      const names = s.names.length ? s.names : ["Nadie ha marcado disponibilidad."];
      const twoCols = names.length > 6;
      const perCol = twoCols ? Math.ceil(names.length / 2) : names.length;
      const width = twoCols ? colW - 24 : inner - 48;
      let colY = [y, y];
      names.forEach((n, i) => {
        const c = twoCols && i >= perCol ? 1 : 0;
        const x = PAD + 24 + c * (colW + 32);
        const text = s.names.length ? `${i + 1}. ${n}` : n;
        for (const l of wrap(ctx, text, width)) {
          if (paint) { ctx.fillStyle = s.names.length ? INK : MUTED; ctx.fillText(l, x, colY[c] + 30); }
          colY[c] += 42;
        }
      });
      y = Math.max(...colY) + 24;
      if (paint) {
        ctx.strokeStyle = "#e7e5e4";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(PAD, top, inner, y - top, 20);
        ctx.stroke();
        ctx.fillStyle = BRAND;
        ctx.fillRect(PAD, top + 20, 6, y - top - 40);
      }
    }

    y += 48;
    ctx.font = `400 22px ${FONT}`;
    const stamp = `Generado el ${new Date().toLocaleString("es-CO", { dateStyle: "long", timeStyle: "short" })}`;
    if (paint) { ctx.fillStyle = MUTED; ctx.fillText(stamp, PAD, y); }
    return y + PAD;
  };

  canvas.width = W;
  canvas.height = draw(false);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, canvas.height);
  ctx.textBaseline = "alphabetic";
  draw(true);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("No se pudo generar la imagen."))), "image/png"),
  );
}
