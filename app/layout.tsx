import type { Metadata } from "next";
import { AuthProvider } from "@/lib/auth";
import { THEME_KEY } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: "Árbitros CAV-Sur",
  description: "Corporación de Árbitros del Valle SUR: gestión de disponibilidades, asignaciones y ranking de árbitros de voleibol",
  openGraph: { siteName: "Corporación de Árbitros del Valle SUR" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        {/* Aplica el color del rol antes de pintar para que no se vea el naranja un instante. */}
        <script dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem("${THEME_KEY}");if(t)document.documentElement.dataset.theme=t}catch(e){}` }} />
      </head>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
