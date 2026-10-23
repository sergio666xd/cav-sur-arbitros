import { formatDate } from "@/lib/api";

// Título de una fecha con el día de la semana resaltado: "SÁBADO 07 de noviembre, 2026".
export default function DateHeading({ date }: { date: string }) {
  const text = formatDate(date);
  const i = text.indexOf(" ");
  return (
    <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">
      <span className="text-base font-bold text-brand-700">{text.slice(0, i)}</span>{text.slice(i)}
    </h2>
  );
}
