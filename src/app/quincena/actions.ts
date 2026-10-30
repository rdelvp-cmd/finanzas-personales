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
  await sql.transaction(marcar(id, estado, usarProvision));
  revalidatePath("/", "layout");
}

// Las sentencias que marcan una fila como pendiente, pagada o provisionada
function marcar(id: number, estado: EstadoPago, usarProvision: boolean) {
  const pagado = estado === "pagado";
  const provisionado = estado === "provisionado";
  const hoy = hoyGT();
  return [
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
  ];
}

// Registra un pago (o ingreso) real: si el concepto venía en la plantilla de esta
// quincena se completa esa fila; si no, se agrega una fila nueva ya pagada
export async function registrarPago(form: FormData) {
  const periodoId = Number(form.get("periodo_id"));
  const [clase, valor] = String(form.get("pago")).split(":");
  const real = monto(form.get("monto"));
  if (real == null) throw new Error("Falta el monto");
  const estado = String(form.get("estado")) as EstadoPago;
  if (estado !== "pagado" && estado !== "provisionado") throw new Error("Estado inválido");
  const nota = String(form.get("nota") ?? "").trim() || null;
  const usarProvision = form.get("usar_provision") === "1";

  let id: number;
  if (clase === "m") {
    id = Number(valor);
    await sql`
      update movimientos set monto_real = ${real}, nota = coalesce(${nota}, nota)
      where id = ${id} and periodo_id = ${periodoId} and not pagado and not provisionado`;
  } else {
    const [fila] = await sql`
      insert into movimientos (periodo_id, concepto_id, tipo, monto_plan, monto_real, nota)
      select ${periodoId}, c.id, cat.tipo, 0, ${real}, ${nota}
      from conceptos c join categorias cat on cat.id = c.categoria_id
      where c.id = ${Number(valor)}
      returning id`;
    id = Number(fila.id);
  }
  await sql.transaction(marcar(id, estado, usarProvision));
  revalidatePath("/", "layout");
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
