import Link from "next/link";
import { notFound } from "next/navigation";
import { num, sql } from "@/lib/db";
import { dinero } from "@/lib/quincena";
import { configurarCuenta, cuadrarCuenta, eliminarTransaccion, registrarTransaccion, vincularConcepto } from "../actions";

export const dynamic = "force-dynamic";

const campo = "rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700";
const boton = "rounded bg-stone-800 px-3 py-1 text-white dark:bg-stone-200 dark:text-stone-900";

export default async function CuentaPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const [c] = await sql`select * from v_saldos_cuentas where id = ${id}`;
  if (!c) notFound();

  const tarjeta = c.tipo === "tarjeta";
  const saldo = num(c.saldo);
  const otras = await sql`select id, nombre, moneda from cuentas where activo and id <> ${id} order by orden, id`;
  const transacciones = await sql`
    select t.id, t.fecha, t.monto, t.tipo, t.nota, t.movimiento_id, co.nombre as concepto,
      (select cu.nombre from transacciones t2 join cuentas cu on cu.id = t2.cuenta_id
       where t2.grupo = t.grupo and t2.id <> t.id limit 1) as contraparte
    from transacciones t
    left join movimientos m on m.id = t.movimiento_id
    left join conceptos co on co.id = m.concepto_id
    where t.cuenta_id = ${id}
    order by t.fecha desc, t.id desc
    limit 60`;
  const conceptos = tarjeta ? await sql`select id, nombre, cuenta_destino_id from conceptos order by nombre` : [];
  const vinculado = conceptos.find((k) => k.cuenta_destino_id === id);
  const fechaSaldo = new Date(c.fecha_saldo).toISOString().slice(0, 10);

  return (
    <>
      <Link href="/cuentas" className="text-sm text-stone-500">← Cuentas</Link>
      <div className="mt-2 mb-6 flex items-end justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">{c.nombre}</h1>
          <p className="text-xs text-stone-500">{[c.banco, c.moneda === "USD" ? "dólares" : "quetzales"].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-stone-500">{tarjeta ? "Deuda" : "Saldo"}</p>
          <p className={`text-2xl font-semibold tabular-nums ${saldo < 0 && !tarjeta ? "text-red-600" : ""}`}>
            {dinero(tarjeta ? -saldo : saldo, c.moneda)}
          </p>
        </div>
      </div>

      <section className="mb-4 rounded-lg bg-white p-4 shadow-sm dark:bg-stone-900">
        <h2 className="mb-2 text-sm font-semibold">Cuadrar con el banco</h2>
        <form action={cuadrarCuenta} className="flex flex-wrap gap-2">
          <input type="hidden" name="id" value={id} />
          <input name="saldo_real" inputMode="decimal" required placeholder={tarjeta ? "Deuda según el banco" : "Saldo según el banco"} className={`flex-1 ${campo}`} />
          <button className={boton}>Cuadrar</button>
        </form>
        <p className="mt-1 text-xs text-stone-500">Si no coincide, se registra un ajuste por la diferencia.</p>
      </section>

      <section className="mb-4 rounded-lg bg-white p-4 shadow-sm dark:bg-stone-900">
        <h2 className="mb-2 text-sm font-semibold">Registrar movimiento</h2>
        <form action={registrarTransaccion} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <input type="hidden" name="id" value={id} />
          <select name="clase" defaultValue={tarjeta ? "gasto" : "ingreso"} className={campo}>
            <option value="ingreso">{tarjeta ? "Abono / pago" : "Depósito"}</option>
            <option value="gasto">{tarjeta ? "Compra" : "Retiro / gasto"}</option>
            <option value="transferencia">Transferir a…</option>
          </select>
          <input name="monto" inputMode="decimal" required placeholder="Monto" className={campo} />
          <input name="fecha" type="date" className={campo} />
          <input name="nota" placeholder="Nota" className={campo} />
          <select name="destino_id" defaultValue="" className={campo}>
            <option value="">Cuenta destino (si transfieres)</option>
            {otras.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
          </select>
          <input name="monto_destino" inputMode="decimal" placeholder="Monto recibido (si es otra moneda)" className={`sm:col-span-2 ${campo}`} />
          <button className={boton}>Registrar</button>
        </form>
        <p className="mt-1 text-xs text-stone-500">
          Los pagos que marcas en la quincena se registran solos{tarjeta ? "; para pagar esta tarjeta desde otra cuenta, transfiere desde esa cuenta" : ""}.
        </p>
      </section>

      {tarjeta && (
        <section className="mb-4 rounded-lg bg-white p-4 shadow-sm dark:bg-stone-900">
          <h2 className="mb-2 text-sm font-semibold">Pago desde la quincena</h2>
          <form action={vincularConcepto} className="flex flex-wrap gap-2">
            <input type="hidden" name="id" value={id} />
            <select name="concepto_id" defaultValue={vinculado?.id ?? ""} className={`flex-1 ${campo}`}>
              <option value="">Ninguno</option>
              {conceptos.map((k) => <option key={k.id} value={k.id}>{k.nombre}</option>)}
            </select>
            <button className={boton}>Guardar</button>
          </form>
          <p className="mt-1 text-xs text-stone-500">Al marcar este concepto como pagado en la quincena, sale de la monetaria y baja la deuda de esta tarjeta.</p>
        </section>
      )}

      <section className="mb-4 rounded-lg bg-white px-4 py-2 shadow-sm dark:bg-stone-900">
        <h2 className="border-b border-stone-200 py-1 text-sm font-semibold dark:border-stone-800">Movimientos</h2>
        {transacciones.length === 0 ? (
          <p className="py-3 text-sm text-stone-500">Sin movimientos desde el saldo inicial.</p>
        ) : (
          <ul className="divide-y divide-stone-100 text-sm dark:divide-stone-800">
            {transacciones.map((t) => {
              const d = new Date(t.fecha).toISOString().slice(0, 10);
              const antes = d < fechaSaldo;
              const texto = [t.concepto, t.contraparte && (num(t.monto) < 0 ? `a ${t.contraparte}` : `de ${t.contraparte}`), t.nota].filter(Boolean).join(" · ") || t.tipo;
              return (
                <li key={t.id} className={`flex items-center gap-2 py-2 ${antes ? "opacity-40" : ""}`}>
                  <span className="text-stone-500 tabular-nums">{d}</span>
                  <span className="min-w-0 flex-1 truncate">{texto}</span>
                  <span className={`tabular-nums ${num(t.monto) < 0 ? "" : "text-emerald-700 dark:text-emerald-400"}`}>
                    {num(t.monto) > 0 ? "+" : ""}{dinero(num(t.monto), c.moneda)}
                  </span>
                  {t.movimiento_id == null && (
                    <form action={eliminarTransaccion.bind(null, Number(t.id))}>
                      <button aria-label="Borrar movimiento" className="text-stone-400 hover:text-red-600">×</button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rounded-lg bg-white p-4 shadow-sm dark:bg-stone-900">
        <h2 className="mb-2 text-sm font-semibold">Configurar</h2>
        <form action={configurarCuenta} className="grid grid-cols-2 gap-2">
          <input type="hidden" name="id" value={id} />
          <label className="text-xs text-stone-500">Nombre<input name="nombre" defaultValue={c.nombre} className={`mt-1 w-full ${campo}`} /></label>
          <label className="text-xs text-stone-500">Banco<input name="banco" defaultValue={c.banco ?? ""} className={`mt-1 w-full ${campo}`} /></label>
          <label className="text-xs text-stone-500">
            {tarjeta ? "Deuda inicial" : "Saldo inicial"}
            <input name="saldo_inicial" inputMode="decimal" defaultValue={Math.abs(num(c.saldo_inicial)).toFixed(2)} className={`mt-1 w-full ${campo}`} />
          </label>
          <label className="text-xs text-stone-500">A la fecha<input name="fecha_saldo" type="date" defaultValue={fechaSaldo} className={`mt-1 w-full ${campo}`} /></label>
          <label className="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" name="activo" defaultChecked={c.activo} /> Cuenta activa</label>
          <button className={`col-span-2 ${boton}`}>Guardar</button>
        </form>
        <p className="mt-1 text-xs text-stone-500">El saldo de la app es este saldo inicial más los movimientos desde esa fecha.</p>
      </section>
    </>
  );
}
