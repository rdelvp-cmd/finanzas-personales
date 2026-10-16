"use server";

import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { hoyGT } from "@/lib/quincena";

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
  await sql.transaction([
    sql`update movimientos set monto_real = ${real} where id = ${id}`,
    // Ajusta la provisión y los saldos de las cuentas al monto real
    sql`select sincronizar_movimiento(${id})`,
  ]);
  revalidatePath("/", "layout");
}

export type EstadoPago = "pendiente" | "pagado" | "provisionado";

export async function cambiarEstadoPago(id: number, estado: EstadoPago, usarProvision = false) {
  const pagado = estado === "pagado";
  const provisionado = estado === "provisionado";
  const hoy = hoyGT();
  await sql.transaction([
    // Se rehacen los aportes o retiros de provisión ligados a esta fila
    sql`delete from fondo_movimientos where movimiento_id = ${id}`,
    sql`
      update movimientos
      set pagado = ${pagado},
          provisionado = ${provisionado},
          monto_real = case when ${estado} <> 'pendiente' then coalesce(monto_real, monto_plan) else monto_real end,
          fecha_pago = case when ${estado} <> 'pendiente' then coalesce(fecha_pago, ${hoy}::date) else null end
      where id = ${id}`,
    sql`
      insert into fondo_movimientos (fondo_id, fecha, monto, origen, movimiento_id)
      select f.id, ${hoy}::date, coalesce(m.monto_real, m.monto_plan), 'provision', m.id
      from movimientos m, fondos f
      where m.id = ${id} and f.nombre = 'Provisiones' and ${provisionado}`,
    sql`
      insert into fondo_movimientos (fondo_id, fecha, monto, origen, movimiento_id, nota)
      select f.id, ${hoy}::date, -p.saldo, 'pago', m.id, 'Pago usando lo provisionado'
      from movimientos m
      join v_provisiones p on p.concepto_id = m.concepto_id
      cross join fondos f
      where m.id = ${id} and f.nombre = 'Provisiones' and p.saldo > 0 and ${pagado} and ${usarProvision}`,
    // Refleja el pago o la provisión en los saldos de las cuentas
    sql`select sincronizar_movimiento(${id})`,
  ]);
  revalidatePath("/", "layout");
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
  await sql.transaction([
    sql`delete from fondo_movimientos where movimiento_id = ${id}`,
    sql`delete from movimientos where id = ${id}`,
  ]);
  revalidatePath("/quincena", "layout");
}

export async function cambiarEstado(periodoId: number, cerrar: boolean) {
  await sql`
    update periodos
    set estado = ${cerrar ? "cerrada" : "abierta"}::estado_periodo,
        cerrado_en = ${cerrar ? new Date().toISOString() : null}
    where id = ${periodoId}`;
  if (cerrar) {
    // Si la quincena siguiente ya existe y sigue abierta, arranca con el saldo real de esta
    await sql`
      update periodos sig
      set saldo_inicial = r.saldo_final
      from v_resumen_quincena r, periodos act
      where r.periodo_id = ${periodoId}
        and act.id = ${periodoId}
        and sig.estado = 'abierta'
        and sig.id = (select id from periodos where fecha > act.fecha order by fecha limit 1)`;
  }
  revalidatePath("/", "layout");
}

export async function guardarSaldoInicial(form: FormData) {
  const periodoId = Number(form.get("periodo_id"));
  const saldo = monto(form.get("saldo_inicial")) ?? 0;
  await sql`update periodos set saldo_inicial = ${saldo} where id = ${periodoId} and estado = 'abierta'`;
  revalidatePath("/quincena", "layout");
}
