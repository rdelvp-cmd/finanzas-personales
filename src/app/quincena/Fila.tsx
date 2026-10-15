"use client";

import { useTransition } from "react";
import { cambiarEstadoPago, eliminarMovimiento, guardarMovimiento, type EstadoPago } from "./actions";
import { quetzales } from "@/lib/quincena";

export type Movimiento = {
  id: number;
  concepto: string;
  tipo: string;
  monto_plan: number;
  monto_real: number | null;
  pagado: boolean;
  provisionado: boolean;
  nota: string | null;
};

const ESTILO: Record<EstadoPago, string> = {
  pendiente: "border-stone-300 text-stone-600 dark:border-stone-700 dark:text-stone-300",
  pagado: "border-emerald-600 bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  provisionado: "border-sky-600 bg-sky-50 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
};

// provision = lo apartado para este concepto en otras quincenas, disponible para usar al pagar
export function Fila({ m, cerrada, provision }: { m: Movimiento; cerrada: boolean; provision: number }) {
  const [pendiente, start] = useTransition();
  const estado: EstadoPago = m.pagado ? "pagado" : m.provisionado ? "provisionado" : "pendiente";
  const ingreso = m.tipo === "ingreso";
  const diferencia = m.monto_real != null && m.monto_real !== m.monto_plan;

  function cambiar(nuevo: EstadoPago) {
    let usar = false;
    if (nuevo === "pagado" && provision > 0) {
      usar = confirm(`Tienes ${quetzales(provision)} provisionado para ${m.concepto}. ¿Lo usas para este pago?`);
    }
    start(() => cambiarEstadoPago(m.id, nuevo, usar));
  }

  return (
    <li className={`flex flex-wrap items-center gap-x-3 gap-y-1 py-2 ${pendiente ? "opacity-50" : ""}`}>
      <select
        aria-label={`Estado de ${m.concepto}`}
        value={estado}
        disabled={cerrada || pendiente}
        onChange={(e) => cambiar(e.target.value as EstadoPago)}
        className={`w-[7.5rem] rounded border px-1 py-1 text-xs font-medium ${ESTILO[estado]}`}
      >
        <option value="pendiente">Pendiente</option>
        <option value="pagado">{ingreso ? "Recibido" : "Pagado"}</option>
        {!ingreso && <option value="provisionado">Provisionado</option>}
      </select>
      <div className="min-w-0 flex-1">
        <p className={`truncate ${estado !== "pendiente" ? "text-stone-500" : ""}`}>{m.concepto}</p>
        {provision > 0 && estado === "pendiente" && (
          <p className="text-xs text-sky-700 dark:text-sky-400">{quetzales(provision)} provisionado</p>
        )}
        {m.nota && m.nota !== "Importado de RV 2026" && <p className="truncate text-xs text-stone-500">{m.nota}</p>}
      </div>
      <form action={(f) => start(() => guardarMovimiento(f))} className="flex items-center gap-2">
        <input type="hidden" name="id" value={m.id} />
        <span className="hidden text-right text-xs text-stone-500 sm:inline">plan {quetzales(m.monto_plan)}</span>
        <input
          name="monto_real"
          inputMode="decimal"
          aria-label={`Monto real de ${m.concepto}`}
          defaultValue={m.monto_real ?? ""}
          placeholder={m.monto_plan.toFixed(2)}
          disabled={cerrada}
          onBlur={(e) => e.currentTarget.form?.requestSubmit()}
          className={`w-28 rounded border bg-transparent px-2 py-1 text-right tabular-nums ${diferencia ? "border-amber-500" : "border-stone-300 dark:border-stone-700"}`}
        />
      </form>
      {!cerrada && (
        <button
          type="button"
          aria-label={`Quitar ${m.concepto}`}
          className="text-stone-400 hover:text-red-600"
          onClick={() => confirm(`¿Quitar ${m.concepto} de esta quincena?`) && start(() => eliminarMovimiento(m.id))}
        >
          ×
        </button>
      )}
    </li>
  );
}
