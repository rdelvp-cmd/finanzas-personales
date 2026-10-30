"use client";

import { useRef, useState, useTransition } from "react";
import { registrarPago } from "./actions";
import { quetzales } from "@/lib/quincena";

// Una opción del selector: una fila pendiente de la plantilla de esta quincena (m:id)
// o cualquier otro concepto (c:id), con el monto que se sugiere y lo provisionado
export type OpcionPago = {
  valor: string;
  nombre: string;
  ingreso: boolean;
  sugerido: number | null;
  provision: number;
};

export function RegistrarPago({ periodoId, plantilla, otros }: { periodoId: number; plantilla: OpcionPago[]; otros: OpcionPago[] }) {
  const [elegida, setElegida] = useState<OpcionPago | null>(null);
  const [guardando, start] = useTransition();
  const form = useRef<HTMLFormElement>(null);
  const todas = new Map([...plantilla, ...otros].map((o) => [o.valor, o]));

  function elegir(valor: string) {
    const o = todas.get(valor) ?? null;
    setElegida(o);
    const monto = form.current?.elements.namedItem("monto") as HTMLInputElement | null;
    if (monto) monto.value = o?.sugerido != null ? o.sugerido.toFixed(2) : "";
  }

  function enviar(f: FormData) {
    if (elegida && !elegida.ingreso && f.get("estado") === "pagado" && elegida.provision > 0) {
      const usar = confirm(`Tienes ${quetzales(elegida.provision)} provisionado para ${elegida.nombre}. ¿Lo usas para este pago?`);
      f.set("usar_provision", usar ? "1" : "0");
    }
    start(async () => {
      await registrarPago(f);
      form.current?.reset();
      setElegida(null);
    });
  }

  return (
    <form ref={form} action={enviar} className={`mb-6 rounded-lg bg-white p-4 shadow-sm dark:bg-stone-900 ${guardando ? "opacity-50" : ""}`}>
      <h2 className="mb-3 font-semibold">Registrar pago</h2>
      <input type="hidden" name="periodo_id" value={periodoId} />
      <div className="flex flex-wrap gap-2">
        <select
          name="pago"
          required
          defaultValue=""
          onChange={(e) => elegir(e.target.value)}
          className="min-w-0 flex-1 rounded border border-stone-300 bg-transparent px-2 py-2 dark:border-stone-700"
        >
          <option value="" disabled>¿Qué pagaste?</option>
          {plantilla.length > 0 && (
            <optgroup label="Pendientes de esta quincena">
              {plantilla.map((o) => (
                <option key={o.valor} value={o.valor}>{o.nombre} · {quetzales(o.sugerido ?? 0)}</option>
              ))}
            </optgroup>
          )}
          <optgroup label="Otro concepto">
            {otros.map((o) => <option key={o.valor} value={o.valor}>{o.nombre}</option>)}
          </optgroup>
        </select>
        <input
          name="monto"
          inputMode="decimal"
          placeholder="Monto"
          required
          className="w-32 rounded border border-stone-300 bg-transparent px-2 py-2 text-right tabular-nums dark:border-stone-700"
        />
      </div>
      {elegida?.sugerido != null && (
        <p className="mt-1 text-xs text-stone-500">Sugerido según la plantilla: {quetzales(elegida.sugerido)}. Cámbialo si pagaste otra cantidad.</p>
      )}
      {elegida && !elegida.ingreso && elegida.provision > 0 && (
        <p className="mt-1 text-xs text-sky-700 dark:text-sky-400">{quetzales(elegida.provision)} provisionado para este concepto</p>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        <select name="estado" defaultValue="pagado" className="rounded border border-stone-300 bg-transparent px-2 py-2 text-sm dark:border-stone-700">
          <option value="pagado">{elegida?.ingreso ? "Recibido" : "Pagado"}</option>
          {!elegida?.ingreso && <option value="provisionado">Provisionado</option>}
        </select>
        <input name="nota" placeholder="Nota (opcional)" className="min-w-0 flex-1 rounded border border-stone-300 bg-transparent px-2 py-2 text-sm dark:border-stone-700" />
        <button disabled={guardando} className="rounded bg-emerald-700 px-4 py-2 font-medium text-white">Registrar</button>
      </div>
    </form>
  );
}
