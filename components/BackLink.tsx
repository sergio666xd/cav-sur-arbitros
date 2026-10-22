import { ArrowLeftIcon } from "@heroicons/react/20/solid";
import Link from "next/link";

// Enlace "volver" de las páginas de detalle.
export default function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="group mb-4 inline-flex items-center gap-1 text-sm text-brand-700 hover:underline">
      <ArrowLeftIcon className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
      {children}
    </Link>
  );
}
