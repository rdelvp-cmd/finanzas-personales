import Link from "next/link";
import { notFound } from "next/navigation";
import { num, sql } from "@/lib/db";
import { anterior, corte, etiqueta, parse, quetzales, ruta, siguiente } from "@/lib/quincena";
import { cambiarEstado, generar, guardarSaldoInicial } from "../../../actions";
import BotonPdf from "./BotonPdf";
import { Fila, type Movimiento } from "../../../Fila";
import { RegistrarPago, type OpcionPago } from "../../../RegistrarPago";

export const dynamic = "force-dynamic";

type Params = Promise<{ anio: string; mes: string; q: string }>;

export default async function QuincenaPage({ params }: { params: Params }) {
  const p = await params;
  const qn = parse(p.anio, p.mes, p.q);
  if (!qn) notFound();

  const [periodo] = await sql`
    select * from v_resumen_quincena where anio = ${qn.anio} and mes = ${qn.mes} and quincena = ${qn.q}`;

  const nav = (
    <div className="mb-4 flex items-center justify-between text-sm">
      <Link href={ruta(anterior(qn))} className="rounded px-2 py-1 hover:bg-stone-200 dark:hover:bg-stone-800">← Anterior</Link>
      <h1 className="text-lg font-semibold">{etiqueta(qn)}</h1>
      <Link href={ruta(siguiente(qn))} className="rounded px-2 py-1 hover:bg-stone-200 dark:hover:bg-stone-800">Siguiente →</Link>
    </div>
  );

  if (!periodo) {
    return (
      <>
        {nav}
        <div className="rounded-lg border border-dashed border-stone-300 p-8 text-center dark:border-stone-700">
          <p className="mb-4 text-stone-600 dark:text-stone-400">Esta quincena todavía no existe.</p>
          <form action={generar.bind(null, qn.anio, qn.mes, qn.q)}>
            <button className="rounded bg-emerald-700 px-4 py-2 font-medium text-white">Generar desde plantillas</button>
          </form>
        </div>
      </>
    );
  }

  const periodoId = Number(periodo.periodo_id);
  const cerrada = periodo.estado === "cerrada";
  const filas = await sql`
    select m.id, m.concepto_id, c.nombre as concepto, cat.nombre as categoria, m.tipo, m.monto_plan, m.monto_real, m.pagado, m.provisionado, m.nota
    from movimientos m
    join conceptos c on c.id = m.concepto_id
    join categorias cat on cat.id = c.categoria_id
    where m.periodo_id = ${periodoId}
    order by (m.tipo = 'ingreso') desc, cat.nombre, m.monto_plan desc`;
  // Para conceptos fuera de esta quincena se sugiere el monto de su plantilla más reciente,
  // o si no tiene, lo último que se pagó por él
  const conceptos = await sql`
    select c.id, c.nombre, cat.tipo,
      coalesce(
        (select t.monto from plantillas t where t.concepto_id = c.id order by t.vigente_desde desc limit 1),
        (select coalesce(m.monto_real, m.monto_plan) from movimientos m join periodos p on p.id = m.periodo_id
          where m.concepto_id = c.id and (m.pagado or m.provisionado) order by p.fecha desc limit 1)
      ) as sugerido
    from conceptos c join categorias cat on cat.id = c.categoria_id
    order by c.nombre`;
  const provisiones = await sql`select concepto_id, saldo from v_provisiones where saldo > 0`;
  const provisionDe = new Map(provisiones.map((p) => [Number(p.concepto_id), num(p.saldo)]));

  const grupos = new Map<string, (Movimiento & { provision: number })[]>();
  const porHacer: (Movimiento & { provision: number })[] = [];
  for (const f of filas) {
    const m: Movimiento = {
      id: Number(f.id),
      concepto: f.concepto,
      tipo: f.tipo,
      monto_plan: num(f.monto_plan),
      monto_real: f.monto_real == null ? null : num(f.monto_real),
      pagado: f.pagado,
      provisionado: f.provisionado,
      nota: f.nota,
    };
    const fila = { ...m, provision: (provisionDe.get(Number(f.concepto_id)) ?? 0) - (m.provisionado ? (m.monto_real ?? m.monto_plan) : 0) };
    // La lista principal muestra solo lo que ya pagaste, provisionaste o recibiste
    if (!m.pagado && !m.provisionado) {
      porHacer.push(fila);
      continue;
    }
    const g = f.tipo === "ingreso" ? "Ingresos" : f.categoria;
    grupos.set(g, [...(grupos.get(g) ?? []), fila]);
  }
  const opcionesPlantilla: OpcionPago[] = porHacer
    .filter((m) => m.monto_plan > 0 || m.monto_real != null)
    .map((m) => ({ valor: `m:${m.id}`, nombre: m.concepto, ingreso: m.tipo === "ingreso", sugerido: m.monto_real ?? m.monto_plan, provision: m.provision }));
  const enPlantilla = new Set(porHacer.map((m) => m.concepto));
  const otrosConceptos: OpcionPago[] = conceptos
    .filter((c) => !enPlantilla.has(c.nombre))
    .map((c) => ({
      valor: `c:${c.id}`,
      nombre: c.nombre,
      ingreso: c.tipo === "ingreso",
      sugerido: c.sugerido == null ? null : num(c.sugerido),
      provision: provisionDe.get(Number(c.id)) ?? 0,
    }));

  const saldoInicial = num(periodo.saldo_inicial);
  const saldoFinal = num(periodo.saldo_final);
  const pendientes = filas.filter((f) => f.tipo !== "ingreso" && !f.pagado && !f.provisionado);
  const provisionado = filas.filter((f) => f.provisionado).reduce((s, f) => s + num(f.monto_real ?? f.monto_plan), 0);
  const porPagar = pendientes.reduce((s, f) => s + num(f.monto_real ?? f.monto_plan), 0);
  // Lo real: solo lo recibido y lo pagado o provisionado; lo pendiente queda aparte
  const recibido = filas.filter((f) => f.tipo === "ingreso" && f.pagado).reduce((s, f) => s + num(f.monto_real ?? f.monto_plan), 0);
  const porRecibir = filas.filter((f) => f.tipo === "ingreso" && !f.pagado).reduce((s, f) => s + num(f.monto_real ?? f.monto_plan), 0);
  const pagado = filas.filter((f) => f.tipo !== "ingreso" && (f.pagado || f.provisionado)).reduce((s, f) => s + num(f.monto_real ?? f.monto_plan), 0);
  const [monetaria] = await sql`select saldo from v_saldos_cuentas where rol = 'salario'`;
  // Abonos, retiros o transferencias registrados a mano en la Monetaria durante la quincena
  const [{ otros }] = await sql`
    select coalesce(sum(t.monto), 0) as otros
    from transacciones t join cuentas c on c.id = t.cuenta_id
    where c.rol = 'salario' and t.movimiento_id is null and t.tipo <> 'ajuste'
      and t.fecha between ${new Date(periodo.fecha).toISOString().slice(0, 10)}::date and ${corte(qn)}::date`;
  const otrosMovimientos = num(otros);
  const disponible = saldoInicial + recibido - pagado + otrosMovimientos;

  return (
    <>
      {nav}

      <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cerrada ? (
          <Dato titulo="Saldo inicial" valor={saldoInicial} />
        ) : (
          <form action={guardarSaldoInicial} className="rounded-lg bg-white p-3 shadow-sm dark:bg-stone-900">
            <input type="hidden" name="periodo_id" value={periodoId} />
            <label htmlFor="saldo_inicial" className="text-xs text-stone-500">Saldo inicial</label>
            <input
              id="saldo_inicial"
              name="saldo_inicial"
              inputMode="decimal"
              defaultValue={saldoInicial.toFixed(2)}
              key={saldoInicial}
              className="w-full rounded border border-transparent bg-transparent text-lg font-semibold tabular-nums hover:border-stone-300 focus:border-stone-400 dark:hover:border-stone-700"
            />
            <p className="text-[10px] text-stone-400">Escribe y presiona Enter</p>
          </form>
        )}
        <Dato titulo="Recibido" valor={recibido} />
        <Dato titulo="Pagado y provisionado" valor={pagado} />
        <Dato
          titulo="Disponible hoy"
          valor={disponible}
          fuerte
          nota={otrosMovimientos !== 0 ? `Incluye ${quetzales(otrosMovimientos)} de otros movimientos de la Monetaria` : undefined}
        />
      </section>

      <p className="mb-4 text-sm text-stone-600 dark:text-stone-400">
        {pendientes.length === 0
          ? "Todo pagado en esta quincena."
          : `Faltan ${pendientes.length} pagos por ${quetzales(porPagar)}.`}{" "}
        {provisionado > 0 && `Provisionaste ${quetzales(provisionado)} a tu ahorro.`}{" "}
        {porRecibir > 0 && `Falta recibir ${quetzales(porRecibir)}.`}{" "}
        {(pendientes.length > 0 || porRecibir > 0) && `Al completar todo te quedarían ${quetzales(saldoFinal + otrosMovimientos)}.`}{" "}
        {monetaria && `Tu Monetaria tiene ${quetzales(num(monetaria.saldo))}.`}{" "}
        {cerrada && "Quincena cerrada."}
      </p>

      {!cerrada && <RegistrarPago periodoId={periodoId} plantilla={opcionesPlantilla} otros={otrosConceptos} />}

      {grupos.size === 0 && (
        <p className="mb-4 rounded-lg border border-dashed border-stone-300 p-4 text-center text-sm text-stone-500 dark:border-stone-700">
          Todavía no has registrado pagos en esta quincena.
        </p>
      )}
      {[...grupos].map(([grupo, movs]) => (
        <section key={grupo} className="mb-4 rounded-lg bg-white px-4 py-2 shadow-sm dark:bg-stone-900">
          <h2 className="flex justify-between border-b border-stone-200 py-1 text-sm font-semibold dark:border-stone-800">
            <span>{grupo}</span>
            <span className="tabular-nums">{quetzales(movs.reduce((s, m) => s + (m.monto_real ?? m.monto_plan), 0))}</span>
          </h2>
          <ul className="divide-y divide-stone-100 dark:divide-stone-800">
            {movs.map((m) => <Fila key={m.id} m={m} cerrada={cerrada} provision={m.provision} />)}
          </ul>
        </section>
      ))}

      {porHacer.length > 0 && (
        <details className="mb-6 rounded-lg bg-white px-4 py-2 shadow-sm dark:bg-stone-900">
          <summary className="cursor-pointer py-1 text-sm font-semibold">
            Pendientes según la plantilla ({porHacer.length}) · {quetzales(porHacer.reduce((s, m) => s + (m.monto_real ?? m.monto_plan), 0))}
          </summary>
          <ul className="divide-y divide-stone-100 dark:divide-stone-800">
            {porHacer.map((m) => <Fila key={m.id} m={m} cerrada={cerrada} provision={m.provision} />)}
          </ul>
        </details>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <BotonPdf href={`${ruta(qn)}/pdf`} nombre={`quincena-${qn.anio}-${String(qn.mes).padStart(2, "0")}-${qn.q === 1 ? "15" : "fin"}.pdf`} />
        <form action={cambiarEstado.bind(null, periodoId, !cerrada)}>
          <button className="text-sm text-stone-600 underline dark:text-stone-400">
            {cerrada ? "Reabrir quincena" : "Cerrar quincena (su saldo pasa a la siguiente)"}
          </button>
        </form>
      </div>
    </>
  );
}

function Dato({ titulo, valor, fuerte, nota }: { titulo: string; valor: number; fuerte?: boolean; nota?: string }) {
  const color = fuerte ? (valor < 0 ? "text-red-600" : "text-emerald-700 dark:text-emerald-400") : "";
  return (
    <div className="rounded-lg bg-white p-3 shadow-sm dark:bg-stone-900">
      <p className="text-xs text-stone-500">{titulo}</p>
      <p className={`text-lg font-semibold tabular-nums ${color}`}>{quetzales(valor)}</p>
      {nota && <p className="text-[10px] text-stone-400">{nota}</p>}
    </div>
  );
}
