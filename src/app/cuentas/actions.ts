"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { hoyGT } from "@/lib/quincena";

const monto = (v: FormDataEntryValue | null) => {
  const n = Number(String(v ?? "").replace(/[Q$,\s]/g, ""));
  if (!Number.isFinite(n)) throw new Error("Monto inválido");
  return n;
};
const texto = (v: FormDataEntryValue | null) => String(v ?? "").trim() || null;
const fecha = (v: FormDataEntryValue | null) => texto(v) ?? hoyGT();
const TIPOS = ["banco", "ahorro", "tarjeta", "efectivo", "inversion"];

export async function crearCuenta(form: FormData) {
  const tipo = String(form.get("tipo"));
  const moneda = ["USD", "MXN"].includes(String(form.get("moneda"))) ? String(form.get("moneda")) : "GTQ";
  if (!TIPOS.includes(tipo)) throw new Error("Tipo inválido");
  const nombre = texto(form.get("nombre"));
  if (!nombre) throw new Error("Falta el nombre");
  const [c] = await sql`
    insert into cuentas (nombre, banco, tipo, moneda, orden)
    values (${nombre}, ${texto(form.get("banco"))}, ${tipo}, ${moneda}, (select coalesce(max(orden), 0) + 1 from cuentas))
    returning id`;
  // Las tarjetas llevan saldo en quetzales y en dólares
  if (tipo === "tarjeta" && moneda === "GTQ") {
    await sql`
      insert into cuentas (nombre, banco, tipo, moneda, orden, principal_id)
      select nombre || ' (US$)', banco, 'tarjeta', 'USD', orden, id from cuentas where id = ${c.id}`;
  }
  revalidatePath("/cuentas");
  redirect(`/cuentas/${c.id}`);
}

// Saldo inicial: lo que dice el banco en una fecha. Para tarjetas se escribe la deuda en positivo.
export async function configurarCuenta(form: FormData) {
  const id = Number(form.get("id"));
  const [c] = await sql`select tipo from cuentas where id = ${id}`;
  const saldo = monto(form.get("saldo_inicial"));
  const valor = c.tipo === "tarjeta" ? -Math.abs(saldo) : saldo;
  await sql`
    update cuentas
    set nombre = coalesce(${texto(form.get("nombre"))}, nombre),
        banco = ${texto(form.get("banco"))},
        saldo_inicial = ${valor},
        fecha_saldo = ${fecha(form.get("fecha_saldo"))},
        activo = ${form.get("activo") === "on"}
    where id = ${id}`;
  // La parte en dólares de una tarjeta sigue el nombre, banco y estado de la principal
  await sql`
    update cuentas h
    set nombre = p.nombre || ' (US$)', banco = p.banco, activo = p.activo
    from cuentas p
    where p.id = ${id} and h.principal_id = p.id`;
  revalidatePath("/cuentas", "layout");
}

// Cuadrar: registra un ajuste por la diferencia entre el saldo del banco y el de la app
export async function cuadrarCuenta(form: FormData) {
  const id = Number(form.get("id"));
  const [c] = await sql`select tipo, saldo from v_saldos_cuentas where id = ${id}`;
  const real = monto(form.get("saldo_real"));
  const objetivo = c.tipo === "tarjeta" ? -Math.abs(real) : real;
  const diferencia = Math.round((objetivo - Number(c.saldo)) * 100) / 100;
  if (diferencia !== 0) {
    await sql`
      insert into transacciones (cuenta_id, fecha, monto, tipo, nota)
      values (${id}, ${hoyGT()}::date, ${diferencia}, 'ajuste', 'Cuadre con el banco')`;
  }
  revalidatePath("/cuentas", "layout");
}

export async function registrarTransaccion(form: FormData) {
  const id = Number(form.get("id"));
  const clase = String(form.get("clase"));
  const valor = Math.abs(monto(form.get("monto")));
  const dia = fecha(form.get("fecha"));
  const nota = texto(form.get("nota"));

  const origen = Number(form.get("destino_id"));
  const [cuenta] = await sql`select tipo from cuentas where id = ${id}`;
  if (clase === "ingreso" && cuenta?.tipo === "tarjeta" && origen && origen !== id) {
    // Abono a tarjeta: sale de la cuenta elegida (en su moneda, si es otra) y baja la deuda
    const salio = texto(form.get("monto_destino")) ? Math.abs(monto(form.get("monto_destino"))) : valor;
    await sql`
      with g as (select gen_random_uuid() as grupo)
      insert into transacciones (cuenta_id, fecha, monto, tipo, grupo, nota)
      select ${origen}::int, ${dia}::date, ${-salio}::numeric, 'transferencia', g.grupo, ${nota}::text from g
      union all
      select ${id}::int, ${dia}::date, ${valor}::numeric, 'transferencia', g.grupo, ${nota}::text from g`;
  } else if (clase === "ingreso" || clase === "gasto") {
    await sql`
      insert into transacciones (cuenta_id, fecha, monto, tipo, nota)
      values (${id}, ${dia}, ${clase === "ingreso" ? valor : -valor}, ${clase}, ${nota})`;
  } else if (clase === "transferencia") {
    const destino = Number(form.get("destino_id"));
    if (!destino || destino === id) throw new Error("Elige la cuenta destino");
    // Entre monedas distintas se escribe cuánto llegó a la otra cuenta
    const recibido = texto(form.get("monto_destino")) ? Math.abs(monto(form.get("monto_destino"))) : valor;
    await sql`
      with g as (select gen_random_uuid() as grupo)
      insert into transacciones (cuenta_id, fecha, monto, tipo, grupo, nota)
      select ${id}::int, ${dia}::date, ${-valor}::numeric, 'transferencia', g.grupo, ${nota}::text from g
      union all
      select ${destino}::int, ${dia}::date, ${recibido}::numeric, 'transferencia', g.grupo, ${nota}::text from g`;
  } else {
    throw new Error("Tipo inválido");
  }
  revalidatePath("/cuentas", "layout");
}

// Solo las transacciones manuales; las de la quincena se cambian desde la quincena
export async function eliminarTransaccion(id: number) {
  await sql`
    delete from transacciones
    where movimiento_id is null
      and (id = ${id} or grupo = (select grupo from transacciones where id = ${id} and grupo is not null))`;
  revalidatePath("/cuentas", "layout");
}

export async function vincularConcepto(form: FormData) {
  const cuentaId = Number(form.get("id"));
  const conceptoId = Number(form.get("concepto_id"));
  await sql`update conceptos set cuenta_destino_id = null where cuenta_destino_id = ${cuentaId}`;
  if (conceptoId) await sql`update conceptos set cuenta_destino_id = ${cuentaId} where id = ${conceptoId}`;
  revalidatePath("/cuentas", "layout");
}
