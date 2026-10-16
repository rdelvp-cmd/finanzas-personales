import Link from "next/link";
import { notFound } from "next/navigation";
import { num, sql } from "@/lib/db";
import { anterior, etiqueta, parse, quetzales, ruta, siguiente } from "@/lib/quincena";
import { agregarMovimiento, cambiarEstado, generar, guardarSaldoInicial } from "../../../actions";
import { Fila, type Movimiento } from "../../../Fila";

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
  const conceptos = await sql`select id, nombre from conceptos order by nombre`;
  const provisiones = await sql`select concepto_id, saldo from v_provisiones where saldo > 0`;
  const provisionDe = new Map(provisiones.map((p) => [Number(p.concepto_id), num(p.saldo)]));

  const grupos = new Map<string, (Movimiento & { provision: number })[]>();
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
    const g = f.tipo === "ingreso" ? "Ingresos" : f.categoria;
    grupos.set(g, [...(grupos.get(g) ?? []), { ...m, provision: (provisionDe.get(Number(f.concepto_id)) ?? 0) - (m.provisionado ? (m.monto_real ?? m.monto_plan) : 0) }]);
  }

  const saldoInicial = num(periodo.saldo_inicial);
  const saldoFinal = num(periodo.saldo_final);
  const pendientes = filas.filter((f) => f.tipo !== "ingreso" && !f.pagado && !f.provisionado);
  const provisionado = filas.filter((f) => f.provisionado).reduce((s, f) => s + num(f.monto_real ?? f.monto_plan), 0);
  const porPagar = pendientes.reduce((s, f) => s + num(f.monto_real ?? f.monto_plan), 0);
  // Lo real: solo lo recibido y lo pagado o provisionado; lo pendiente queda aparte
  const recibido = filas.filter((f) => f.tipo === "ingreso" && f.pagado).reduce((s, f) => s + num(f.monto_real ?? f.monto_plan), 0);
  const porRecibir = filas.filter((f) => f.tipo === "ingreso" && !f.pagado).reduce((s, f) => s + num(f.monto_real ?? f.monto_plan), 0);
  const pagado = filas.filter((f) => f.tipo !== "ingreso" && (f.pagado || f.provisionado)).reduce((s, f) => s + num(f.monto_real ?? f.monto_plan), 0);
  const disponible = saldoInicial + recibido - pagado;
  const [monetaria] = await sql`select saldo from v_saldos_cuentas where rol = 'salario'`;

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
        <Dato titulo="Disponible hoy" valor={disponible} fuerte />
      </section>

      <p className="mb-4 text-sm text-stone-600 dark:text-stone-400">
        {pendientes.length === 0
          ? "Todo pagado en esta quincena."
          : `Faltan ${pendientes.length} pagos por ${quetzales(porPagar)}.`}{" "}
        {provisionado > 0 && `Provisionaste ${quetzales(provisionado)} a tu ahorro.`}{" "}
        {porRecibir > 0 && `Falta recibir ${quetzales(porRecibir)}.`}{" "}
        {(pendientes.length > 0 || porRecibir > 0) && `Al completar todo te quedarían ${quetzales(saldoFinal)}.`}{" "}
        {monetaria && `Tu Monetaria tiene ${quetzales(num(monetaria.saldo))}.`}{" "}
        {cerrada && "Quincena cerrada."}
      </p>

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

      {!cerrada && (
        <form action={agregarMovimiento} className="mb-6 flex flex-wrap gap-2 rounded-lg bg-white p-4 shadow-sm dark:bg-stone-900">
          <input type="hidden" name="periodo_id" value={periodoId} />
          <select name="concepto_id" required className="flex-1 rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700">
            {conceptos.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
          <input name="monto" inputMode="decimal" placeholder="Monto" required className="w-28 rounded border border-stone-300 bg-transparent px-2 py-1 text-right dark:border-stone-700" />
          <input name="nota" placeholder="Nota" className="w-full rounded border border-stone-300 bg-transparent px-2 py-1 sm:w-auto sm:flex-1 dark:border-stone-700" />
          <button className="rounded bg-stone-800 px-3 py-1 text-white dark:bg-stone-200 dark:text-stone-900">Agregar</button>
        </form>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* se abre en otra pestaña para que en el teléfono se pueda compartir y volver */}
        <a href={`${ruta(qn)}/pdf`} target="_blank" rel="noopener" className="rounded bg-stone-800 px-3 py-1 text-sm text-white dark:bg-stone-200 dark:text-stone-900">
          Descargar PDF
        </a>
        <form action={cambiarEstado.bind(null, periodoId, !cerrada)}>
          <button className="text-sm text-stone-600 underline dark:text-stone-400">
            {cerrada ? "Reabrir quincena" : "Cerrar quincena (su saldo pasa a la siguiente)"}
          </button>
        </form>
      </div>
    </>
  );
}

function Dato({ titulo, valor, fuerte }: { titulo: string; valor: number; fuerte?: boolean }) {
  const color = fuerte ? (valor < 0 ? "text-red-600" : "text-emerald-700 dark:text-emerald-400") : "";
  return (
    <div className="rounded-lg bg-white p-3 shadow-sm dark:bg-stone-900">
      <p className="text-xs text-stone-500">{titulo}</p>
      <p className={`text-lg font-semibold tabular-nums ${color}`}>{quetzales(valor)}</p>
    </div>
  );
}
