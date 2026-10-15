import Link from "next/link";
import { notFound } from "next/navigation";
import { num, sql } from "@/lib/db";
import { etiqueta, quetzales, ruta } from "@/lib/quincena";

export const dynamic = "force-dynamic";

export default async function ResumenPage({ params }: { params: Promise<{ anio: string }> }) {
  const anio = Number((await params).anio);
  if (!Number.isInteger(anio)) notFound();

  const quincenas = await sql`
    select anio, mes, quincena, estado, ingresos, egresos, ingresos - egresos as disponible
    from v_resumen_quincena where anio = ${anio} order by fecha`;
  const rubros = await sql`
    select cat.nombre as rubro, sum(coalesce(m.monto_real, m.monto_plan)) as total
    from movimientos m
    join periodos p on p.id = m.periodo_id
    join conceptos c on c.id = m.concepto_id
    join categorias cat on cat.id = c.categoria_id
    where p.anio = ${anio} and m.tipo <> 'ingreso'
    group by cat.nombre order by total desc`;

  const ingresos = quincenas.reduce((s, r) => s + num(r.ingresos), 0);
  const disponible = quincenas.reduce((s, r) => s + num(r.disponible), 0);
  const negativas = quincenas.filter((r) => num(r.disponible) < 0).length;
  const peor = Math.max(1, ...quincenas.map((r) => Math.abs(num(r.disponible))));

  return (
    <>
      <div className="mb-4 flex items-center justify-between text-sm">
        <Link href={`/resumen/${anio - 1}`}>← {anio - 1}</Link>
        <h1 className="text-lg font-semibold">Resumen {anio}</h1>
        <Link href={`/resumen/${anio + 1}`}>{anio + 1} →</Link>
      </div>

      {quincenas.length === 0 ? (
        <p className="text-stone-600">No hay quincenas en {anio}.</p>
      ) : (
        <>
          <p className="mb-6">
            {negativas} de {quincenas.length} quincenas cierran en negativo. Disponible del año:{" "}
            <span className={disponible < 0 ? "font-semibold text-red-600" : "font-semibold text-emerald-700"}>{quetzales(disponible)}</span>.
          </p>

          <section className="mb-6 rounded-lg bg-white p-4 shadow-sm dark:bg-stone-900">
            <h2 className="mb-2 text-sm font-semibold">Disponible por quincena</h2>
            <ul className="space-y-1 text-sm">
              {quincenas.map((r) => {
                const d = num(r.disponible);
                const ancho = `${(Math.abs(d) / peor) * 50}%`;
                const qn = { anio: r.anio, mes: r.mes, q: r.quincena } as const;
                return (
                  <li key={`${r.mes}-${r.quincena}`} className="grid grid-cols-[7.5rem_1fr_6.5rem] items-center gap-2">
                    <Link href={ruta(qn)} className="truncate hover:underline">{etiqueta(qn).replace(` ${anio}`, "")}</Link>
                    <div className="relative h-3">
                      <div className="absolute inset-y-0 left-1/2 w-px bg-stone-300" />
                      <div
                        className={`absolute inset-y-0 rounded-sm ${d < 0 ? "right-1/2 bg-red-400" : "left-1/2 bg-emerald-500"}`}
                        style={{ width: ancho }}
                      />
                    </div>
                    <span className={`text-right tabular-nums ${d < 0 ? "text-red-600" : ""}`}>{quetzales(d)}</span>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="rounded-lg bg-white p-4 shadow-sm dark:bg-stone-900">
            <h2 className="mb-2 text-sm font-semibold">Gasto por rubro</h2>
            <table className="w-full text-sm">
              <tbody>
                {rubros.map((r) => (
                  <tr key={r.rubro} className="border-t border-stone-100 dark:border-stone-800">
                    <td className="py-1">{r.rubro}</td>
                    <td className="text-right tabular-nums">{quetzales(num(r.total))}</td>
                    <td className="w-16 text-right text-stone-500 tabular-nums">{((num(r.total) / ingresos) * 100).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-stone-500">Porcentaje sobre los ingresos del año ({quetzales(ingresos)}).</p>
          </section>
        </>
      )}
    </>
  );
}
