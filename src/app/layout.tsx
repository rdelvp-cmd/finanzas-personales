import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = { title: "Finanzas personales" };
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const anio = new Date().getFullYear();
  return (
    <html lang="es">
      <body className="min-h-screen">
        <nav className="sticky top-0 z-10 border-b border-stone-200 bg-white/90 backdrop-blur dark:border-stone-800 dark:bg-stone-900/90">
          <div className="mx-auto flex max-w-3xl gap-4 px-4 py-3 text-sm font-medium">
            <Link href="/">Quincena</Link>
            <Link href="/provisiones">Provisiones</Link>
            <Link href="/plantillas">Plantillas</Link>
            <Link href={`/resumen/${anio}`}>Resumen {anio}</Link>
          </div>
        </nav>
        <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
