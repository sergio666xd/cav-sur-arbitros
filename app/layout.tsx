import type { Metadata } from "next";
import { AuthProvider } from "@/lib/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "Árbitros CAV-Sur",
  description: "Corporación de Árbitros del Valle SUR: gestión de disponibilidades, asignaciones y ranking de árbitros de voleibol",
  openGraph: { siteName: "Corporación de Árbitros del Valle SUR" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
