import { num, sql } from "@/lib/db";
import { nombreMes, quetzales } from "@/lib/quincena";
import { crearConcepto, crearPlantilla, guardarPlantilla } from "./actions";

export const dynamic = "force-dynamic";

const CUANDO: Record<string, string> = { q15: "Día 15", fin_mes: "Fin de mes", ambas: "Las dos quincenas" };

export default async function PlantillasPage() {
  const plantillas = await sql`
    select t.id, c.nombre as concepto, t.tipo, t.monto, t.monto_variable, t.frecuencia, t.quincena, t.meses, t.activo, t.vigente_desde
    from plantillas t join conceptos c on c.id = t.concepto_id
    order by t.quincena, (t.tipo = 'ingreso') desc, t.monto desc`;
  const conceptos = await sql`select id, nombre from conceptos order by nombre`;
  const categorias = await sql`select id, nombre from categorias order by nombre`;

  // Promedio mensual de lo planeado en plantillas activas (no incluye extras como Bono 14)
  const veces = (t: (typeof plantillas)[number]) => {
    const porMes = t.quincena === "ambas" ? 2 : 1;
    const mesesAplica = t.meses ? t.meses.length : 12;
    return (porMes * mesesAplica) / 12;
  };
  const activos = plantillas.filter((t) => t.activo);
  const ingresoMes = activos.filter((t) => t.tipo === "ingreso").reduce((s, t) => s + num(t.monto) * veces(t), 0);
  const egresoMes = activos.filter((t) => t.tipo !== "ingreso").reduce((s, t) => s + num(t.monto) * veces(t), 0);

  const grupos = ["q15", "fin_mes", "ambas"].map((q) => [q, plantillas.filter((t) => t.quincena === q)] as const);

  return (
    <>
      <h1 className="mb-2 text-lg font-semibold">Pagos recurrentes</h1>
      <p className="mb-6 text-sm text-stone-600 dark:text-stone-400">
        Promedio al mes: ingresos {quetzales(ingresoMes)}, egresos {quetzales(egresoMes)}, diferencia{" "}
        <span className={ingresoMes - egresoMes < 0 ? "font-semibold text-red-600" : "font-semibold text-emerald-700"}>{quetzales(ingresoMes - egresoMes)}</span>.
        Cada quincena nueva se genera con estas plantillas.
      </p>

      {grupos.map(([q, lista]) => (
        <section key={q} className="mb-4 rounded-lg bg-white px-4 py-2 shadow-sm dark:bg-stone-900">
          <h2 className="border-b border-stone-200 py-1 text-sm font-semibold dark:border-stone-800">{CUANDO[q]}</h2>
          <ul className="divide-y divide-stone-100 dark:divide-stone-800">
            {lista.map((t) => (
              <li key={t.id}>
                <form action={guardarPlantilla} className="flex flex-wrap items-center gap-2 py-2">
                  <input type="hidden" name="id" value={t.id} />
                  <input type="checkbox" name="activo" defaultChecked={t.activo} aria-label="Activa" className="size-4 accent-emerald-600" />
                  <div className="min-w-0 flex-1">
                    <p className={t.activo ? "" : "text-stone-400 line-through"}>{t.concepto}</p>
                    <p className="text-xs text-stone-500">
                      {t.frecuencia}
                      {t.meses ? ` · ${t.meses.map((m: number) => nombreMes(m).slice(0, 3)).join(", ")}` : ""}
                      {t.monto_variable ? " · monto variable" : ""}
                    </p>
                  </div>
                  <input name="meses" defaultValue={t.meses?.join(",") ?? ""} placeholder="meses (todos)" aria-label="Meses en que aplica" className="w-28 rounded border border-stone-300 bg-transparent px-2 py-1 text-xs dark:border-stone-700" />
                  <input name="monto" inputMode="decimal" defaultValue={num(t.monto).toFixed(2)} aria-label="Monto" className="w-28 rounded border border-stone-300 bg-transparent px-2 py-1 text-right tabular-nums dark:border-stone-700" />
                  <button className="text-sm text-emerald-700 underline">Guardar</button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <h2 className="mt-8 mb-2 font-semibold">Nueva plantilla</h2>
      <form action={crearPlantilla} className="mb-6 grid grid-cols-2 gap-2 rounded-lg bg-white p-4 shadow-sm sm:grid-cols-3 dark:bg-stone-900">
        <select name="concepto_id" className="col-span-2 rounded border border-stone-300 bg-transparent px-2 py-1 sm:col-span-1 dark:border-stone-700">
          {conceptos.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
        <input name="monto" inputMode="decimal" placeholder="Monto" required className="rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700" />
        <select name="frecuencia" defaultValue="mensual" className="rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700">
          {["quincenal", "mensual", "bimestral", "trimestral", "semestral", "anual", "unica"].map((f) => <option key={f}>{f}</option>)}
        </select>
        <select name="quincena" defaultValue="q15" className="rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700">
          {Object.entries(CUANDO).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <input name="meses" placeholder="Meses, ej. 1,4,7,10" className="rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700" />
        <input name="vigente_desde" type="date" className="rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700" />
        <button className="col-span-2 rounded bg-stone-800 px-3 py-1 text-white sm:col-span-3 dark:bg-stone-200 dark:text-stone-900">Agregar plantilla</button>
      </form>

      <h2 className="mb-2 font-semibold">Nuevo concepto</h2>
      <form action={crearConcepto} className="flex flex-wrap gap-2 rounded-lg bg-white p-4 shadow-sm dark:bg-stone-900">
        <input name="nombre" placeholder="Nombre" required className="flex-1 rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700" />
        <select name="categoria_id" className="rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700">
          {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
        <button className="rounded bg-stone-800 px-3 py-1 text-white dark:bg-stone-200 dark:text-stone-900">Agregar</button>
      </form>
    </>
  );
}
