import Link from "next/link";
import { num, sql } from "@/lib/db";
import { dinero, quetzales } from "@/lib/quincena";
import { crearCuenta } from "./actions";

export const dynamic = "force-dynamic";

const campo = "rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700";

export default async function CuentasPage() {
  const cuentas = await sql`select * from v_saldos_cuentas where activo order by orden, id`;
  const bancos = cuentas.filter((c) => c.tipo !== "tarjeta");
  const tarjetas = cuentas.filter((c) => c.tipo === "tarjeta");
  const totalQ = bancos.filter((c) => c.moneda === "GTQ").reduce((s, c) => s + num(c.saldo), 0);
  const totalUSD = bancos.filter((c) => c.moneda === "USD").reduce((s, c) => s + num(c.saldo), 0);
  const deuda = tarjetas.reduce((s, c) => s + num(c.saldo), 0);

  return (
    <>
      <h1 className="mb-2 text-lg font-semibold">Cuentas</h1>
      <p className="mb-6 text-sm text-stone-600 dark:text-stone-400">
        En bancos: <b>{quetzales(totalQ)}</b>
        {totalUSD !== 0 && <> y <b>{dinero(totalUSD, "USD")}</b></>}. Deuda en tarjetas: <b className="text-red-600">{quetzales(-deuda)}</b>.
      </p>

      <Grupo titulo="Bancos" cuentas={bancos} />
      <Grupo titulo="Tarjetas de crédito" cuentas={tarjetas} tarjeta />

      <h2 className="mt-8 mb-2 font-semibold">Nueva cuenta</h2>
      <form action={crearCuenta} className="grid grid-cols-2 gap-2 rounded-lg bg-white p-4 shadow-sm sm:grid-cols-4 dark:bg-stone-900">
        <input name="nombre" placeholder="Nombre" required className={`col-span-2 ${campo}`} />
        <input name="banco" placeholder="Banco" className={campo} />
        <select name="tipo" defaultValue="ahorro" className={campo}>
          <option value="banco">Monetaria</option>
          <option value="ahorro">Ahorro</option>
          <option value="tarjeta">Tarjeta de crédito</option>
          <option value="efectivo">Efectivo</option>
          <option value="inversion">Inversión</option>
        </select>
        <select name="moneda" defaultValue="GTQ" className={campo}>
          <option value="GTQ">Quetzales</option>
          <option value="USD">Dólares</option>
        </select>
        <button className="col-span-2 rounded bg-stone-800 px-3 py-1 text-white sm:col-span-3 dark:bg-stone-200 dark:text-stone-900">Crear</button>
      </form>
    </>
  );
}

function Grupo({ titulo, cuentas, tarjeta }: { titulo: string; cuentas: Record<string, any>[]; tarjeta?: boolean }) {
  return (
    <section className="mb-4 rounded-lg bg-white px-4 py-2 shadow-sm dark:bg-stone-900">
      <h2 className="border-b border-stone-200 py-1 text-sm font-semibold dark:border-stone-800">{titulo}</h2>
      <ul className="divide-y divide-stone-100 dark:divide-stone-800">
        {cuentas.map((c) => {
          const saldo = num(c.saldo);
          return (
            <li key={c.id}>
              <Link href={`/cuentas/${c.id}`} className="flex items-center justify-between gap-2 py-3 hover:opacity-80">
                <div className="min-w-0">
                  <p className="truncate">{c.nombre}</p>
                  <p className="text-xs text-stone-500">
                    {[c.banco, c.rol === "salario" ? "aquí cae el salario" : c.rol === "provisiones" ? "aquí van las provisiones" : null].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <span className={`font-semibold tabular-nums ${saldo < 0 ? "text-red-600" : ""}`}>
                  {tarjeta ? `Debes ${quetzales(-saldo)}` : dinero(saldo, c.moneda)}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
