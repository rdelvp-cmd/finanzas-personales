"use client";

import { useTransition } from "react";
import { alternarPagado, eliminarMovimiento, guardarMovimiento } from "./actions";
import { quetzales } from "@/lib/quincena";

export type Movimiento = {
  id: number;
  concepto: string;
  tipo: string;
  monto_plan: number;
  monto_real: number | null;
  pagado: boolean;
  nota: string | null;
};

export function Fila({ m, cerrada }: { m: Movimiento; cerrada: boolean }) {
  const [pendiente, start] = useTransition();
  const diferencia = m.monto_real != null && m.monto_real !== m.monto_plan;

  return (
    <li className={`flex items-center gap-3 py-2 ${pendiente ? "opacity-50" : ""}`}>
      <input
        type="checkbox"
        aria-label={`Marcar ${m.concepto} como ${m.tipo === "ingreso" ? "recibido" : "pagado"}`}
        className="size-5 accent-emerald-600"
        checked={m.pagado}
        disabled={cerrada || pendiente}
        onChange={(e) => start(() => alternarPagado(m.id, e.target.checked))}
      />
      <div className="min-w-0 flex-1">
        <p className={`truncate ${m.pagado ? "text-stone-500 line-through decoration-stone-400" : ""}`}>{m.concepto}</p>
        {m.nota && m.nota !== "Importado de RV 2026" && <p className="truncate text-xs text-stone-500">{m.nota}</p>}
      </div>
      <form action={(f) => start(() => guardarMovimiento(f))} className="flex items-center gap-2">
        <input type="hidden" name="id" value={m.id} />
        {m.pagado && <input type="hidden" name="pagado" value="on" />}
        <span className="hidden text-right text-xs text-stone-500 sm:inline">plan {quetzales(m.monto_plan)}</span>
        <input
          name="monto_real"
          inputMode="decimal"
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
