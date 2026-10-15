"use server";

import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";

const monto = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").replace(/[Q,\s]/g, "");
  if (s === "") return null;
  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error("Monto inválido");
  return n;
};

export async function generar(anio: number, mes: number, q: number) {
  await sql`select generar_quincena(${anio}, ${mes}, ${q}::smallint)`;
  revalidatePath("/quincena", "layout");
}

export async function guardarMovimiento(form: FormData) {
  const id = Number(form.get("id"));
  const real = monto(form.get("monto_real"));
  const pagado = form.get("pagado") === "on";
  await sql`
    update movimientos
    set monto_real = ${real},
        pagado = ${pagado},
        fecha_pago = case when ${pagado} then coalesce(fecha_pago, current_date) else null end
    where id = ${id}`;
  revalidatePath("/quincena", "layout");
}

export async function alternarPagado(id: number, pagado: boolean) {
  await sql`
    update movimientos
    set pagado = ${pagado},
        monto_real = case when ${pagado} then coalesce(monto_real, monto_plan) else monto_real end,
        fecha_pago = case when ${pagado} then coalesce(fecha_pago, current_date) else null end
    where id = ${id}`;
  revalidatePath("/quincena", "layout");
}

export async function agregarMovimiento(form: FormData) {
  const periodoId = Number(form.get("periodo_id"));
  const conceptoId = Number(form.get("concepto_id"));
  const plan = monto(form.get("monto")) ?? 0;
  const nota = String(form.get("nota") ?? "") || null;
  await sql`
    insert into movimientos (periodo_id, concepto_id, tipo, monto_plan, nota)
    select ${periodoId}, c.id, cat.tipo, ${plan}, ${nota}
    from conceptos c join categorias cat on cat.id = c.categoria_id
    where c.id = ${conceptoId}`;
  revalidatePath("/quincena", "layout");
}

export async function eliminarMovimiento(id: number) {
  await sql`delete from movimientos where id = ${id}`;
  revalidatePath("/quincena", "layout");
}

export async function cambiarEstado(periodoId: number, cerrar: boolean) {
  await sql`
    update periodos
    set estado = ${cerrar ? "cerrada" : "abierta"}::estado_periodo,
        cerrado_en = ${cerrar ? new Date().toISOString() : null}
    where id = ${periodoId}`;
  revalidatePath("/", "layout");
}
