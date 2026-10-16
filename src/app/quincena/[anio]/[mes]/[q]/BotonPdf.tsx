"use client";

import { useState } from "react";

// En el teléfono el PDF se comparte o guarda con el menú del sistema, sin salir de la app
export default function BotonPdf({ href, nombre }: { href: string; nombre: string }) {
  const [ocupado, setOcupado] = useState(false);

  async function generar() {
    setOcupado(true);
    try {
      const r = await fetch(href);
      if (!r.ok) throw new Error(`Error ${r.status}`);
      const archivo = new File([await r.blob()], nombre, { type: "application/pdf" });
      if (navigator.canShare?.({ files: [archivo] })) {
        await navigator.share({ files: [archivo], title: nombre });
      } else {
        const url = URL.createObjectURL(archivo);
        const a = document.createElement("a");
        a.href = url;
        a.download = nombre;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      }
    } catch (e) {
      // Cerrar el menú de compartir sin elegir nada no es un error
      if (!(e instanceof DOMException && e.name === "AbortError")) alert("No se pudo generar el PDF. Intenta de nuevo.");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <button onClick={generar} disabled={ocupado} className="rounded bg-stone-800 px-3 py-1 text-sm text-white disabled:opacity-60 dark:bg-stone-200 dark:text-stone-900">
      {ocupado ? "Generando…" : "PDF de la quincena"}
    </button>
  );
}
