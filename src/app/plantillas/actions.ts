"use server";

import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";

const FRECUENCIAS = ["quincenal", "mensual", "bimestral", "trimestral", "semestral", "anual", "unica"];
const QUINCENAS = ["q15", "fin_mes", "ambas"];

function meses(v: FormDataEntryValue | null) {
  const lista = String(v ?? "").split(",").map((s) => Number(s.trim())).filter((n) => n >= 1 && n <= 12);
  return lista.length ? lista : null;
}

export async function guardarPlantilla(form: FormData) {
  const id = Number(form.get("id"));
  const monto = Number(String(form.get("monto")).replace(/[Q,\s]/g, ""));
  if (!Number.isFinite(monto) || monto < 0) throw new Error("Monto inválido");
  const activo = form.get("activo") === "on";
  await sql`update plantillas set monto = ${monto}, activo = ${activo}, meses = ${meses(form.get("meses"))} where id = ${id}`;
  revalidatePath("/plantillas");
}

export async function crearPlantilla(form: FormData) {
  const conceptoId = Number(form.get("concepto_id"));
  const monto = Number(String(form.get("monto")).replace(/[Q,\s]/g, ""));
  const frecuencia = String(form.get("frecuencia"));
  const quincena = String(form.get("quincena"));
  const desde = String(form.get("vigente_desde") || new Date().toISOString().slice(0, 10));
  if (!Number.isFinite(monto) || !FRECUENCIAS.includes(frecuencia) || !QUINCENAS.includes(quincena)) throw new Error("Datos inválidos");
  await sql`
    insert into plantillas (concepto_id, tipo, monto, frecuencia, quincena, meses, vigente_desde)
    select c.id, cat.tipo, ${monto}, ${frecuencia}::frecuencia, ${quincena}::cual_quincena, ${meses(form.get("meses"))}, ${desde}
    from conceptos c join categorias cat on cat.id = c.categoria_id
    where c.id = ${conceptoId}`;
  revalidatePath("/plantillas");
}

export async function crearConcepto(form: FormData) {
  const nombre = String(form.get("nombre") ?? "").trim();
  const categoriaId = Number(form.get("categoria_id"));
  if (!nombre) throw new Error("Falta el nombre");
  await sql`insert into conceptos (nombre, categoria_id) values (${nombre}, ${categoriaId}) on conflict (nombre) do nothing`;
  revalidatePath("/plantillas");
}
