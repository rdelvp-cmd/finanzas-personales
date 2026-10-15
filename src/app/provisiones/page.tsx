import { num, sql } from "@/lib/db";
import { quetzales } from "@/lib/quincena";

export const dynamic = "force-dynamic";

export default async function ProvisionesPage() {
  const saldos = await sql`select concepto, saldo, ultima_fecha from v_provisiones where saldo <> 0 order by saldo desc`;
  const historial = await sql`
    select fm.fecha, c.nombre as concepto, fm.monto, fm.nota
    from fondo_movimientos fm
    join fondos f on f.id = fm.fondo_id and f.nombre = 'Provisiones'
    join movimientos m on m.id = fm.movimiento_id
    join conceptos c on c.id = m.concepto_id
    order by fm.fecha desc, fm.id desc
    limit 30`;
  const total = saldos.reduce((s, r) => s + num(r.saldo), 0);

  return (
    <>
      <h1 className="mb-2 text-lg font-semibold">Provisiones</h1>
      <p className="mb-6 text-sm text-stone-600 dark:text-stone-400">
        Lo que apartaste en tu cuenta de ahorro para pagos que todavía no tocan. Total apartado:{" "}
        <span className="font-semibold text-sky-700 dark:text-sky-400">{quetzales(total)}</span>.
      </p>

      {saldos.length === 0 ? (
        <p className="rounded-lg border border-dashed border-stone-300 p-6 text-center text-sm text-stone-500 dark:border-stone-700">
          Todavía no hay provisiones. En la quincena, cambia un pago a &quot;Provisionado&quot; cuando lo mandes a tu ahorro.
        </p>
      ) : (
        <section className="mb-6 rounded-lg bg-white px-4 py-2 shadow-sm dark:bg-stone-900">
          <table className="w-full text-sm">
            <tbody>
              {saldos.map((r) => (
                <tr key={r.concepto} className="border-t border-stone-100 first:border-0 dark:border-stone-800">
                  <td className="py-2">{r.concepto}</td>
                  <td className="text-right font-semibold tabular-nums">{quetzales(num(r.saldo))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {historial.length > 0 && (
        <section className="rounded-lg bg-white px-4 py-2 shadow-sm dark:bg-stone-900">
          <h2 className="border-b border-stone-200 py-1 text-sm font-semibold dark:border-stone-800">Movimientos recientes</h2>
          <ul className="divide-y divide-stone-100 text-sm dark:divide-stone-800">
            {historial.map((h, i) => (
              <li key={i} className="flex justify-between gap-2 py-2">
                <span className="text-stone-500 tabular-nums">{new Date(h.fecha).toISOString().slice(0, 10)}</span>
                <span className="flex-1 truncate">{h.concepto}{h.nota ? ` · ${h.nota}` : ""}</span>
                <span className={`tabular-nums ${num(h.monto) < 0 ? "text-stone-600" : "text-sky-700 dark:text-sky-400"}`}>
                  {num(h.monto) > 0 ? "+" : ""}{quetzales(num(h.monto))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
