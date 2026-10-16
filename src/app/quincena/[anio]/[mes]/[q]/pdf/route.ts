import { PDFDocument, PDFFont, PDFPage, rgb, StandardFonts } from "pdf-lib";
import { num, sql } from "@/lib/db";
import { corte as corteDe, dinero, etiqueta, hoyGT, parse } from "@/lib/quincena";

export const dynamic = "force-dynamic";

type Params = Promise<{ anio: string; mes: string; q: string }>;

const iso = (d: Date) => d.toISOString().slice(0, 10);
const fechaCorta = (v: string | Date | null) => {
  if (!v) return "";
  const [a, m, d] = (typeof v === "string" ? v : iso(v)).slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
};
// Las fuentes estándar del PDF solo tienen Latin-1
const limpio = (s: string) => s.replace(/[–—]/g, "-").replace(/[^\x20-\x7E\xA0-\xFF]/g, "");

// Escribe el documento de arriba hacia abajo y abre página nueva cuando se acaba el espacio
class Hoja {
  page!: PDFPage;
  y = 0;
  constructor(private doc: PDFDocument, private font: PDFFont, private bold: PDFFont) { this.nueva(); }
  static ancho = 612; static alto = 792; static margen = 48;
  nueva() { this.page = this.doc.addPage([Hoja.ancho, Hoja.alto]); this.y = Hoja.alto - Hoja.margen; }
  espacio(h: number) { if (this.y - h < Hoja.margen) this.nueva(); }
  texto(s: string, x: number, o: { size?: number; bold?: boolean; derecha?: boolean; gris?: boolean } = {}) {
    const size = o.size ?? 9, f = o.bold ? this.bold : this.font, t = limpio(s);
    const px = o.derecha ? x - f.widthOfTextAtSize(t, size) : x;
    this.page.drawText(t, { x: px, y: this.y, size, font: f, color: o.gris ? rgb(0.45, 0.45, 0.45) : rgb(0.1, 0.1, 0.1) });
  }
  linea(grosor = 0.5) {
    this.page.drawLine({ start: { x: Hoja.margen, y: this.y + 9 }, end: { x: Hoja.ancho - Hoja.margen, y: this.y + 9 }, thickness: grosor, color: rgb(0.75, 0.75, 0.75) });
  }
  baja(h = 13) { this.y -= h; }
  titulo(s: string) { this.espacio(50); this.baja(26); this.texto(s, Hoja.margen, { size: 11, bold: true }); this.baja(16); }
}

export async function GET(_req: Request, { params }: { params: Params }) {
  const p = await params;
  const qn = parse(p.anio, p.mes, p.q);
  if (!qn) return new Response("Quincena inválida", { status: 404 });

  const [periodo] = await sql`select * from v_resumen_quincena where anio = ${qn.anio} and mes = ${qn.mes} and quincena = ${qn.q}`;
  if (!periodo) return new Response("Esa quincena todavía no existe", { status: 404 });

  const filas = await sql`
    select c.nombre as concepto, cat.nombre as categoria, m.tipo, m.monto_plan, m.monto_real, m.pagado, m.provisionado, m.fecha_pago
    from movimientos m
    join conceptos c on c.id = m.concepto_id
    join categorias cat on cat.id = c.categoria_id
    where m.periodo_id = ${periodo.periodo_id}
    order by cat.nombre, m.monto_plan desc`;

  // Corte de saldos: el día antes de la siguiente quincena, o hoy si todavía no llega
  const hoy = hoyGT();
  const corte = corteDe(qn, hoy);
  const cuentas = await sql`
    select c.id, c.nombre, c.tipo, c.moneda, c.rol, c.principal_id, c.fecha_saldo,
      c.saldo_inicial + coalesce(sum(t.monto) filter (where t.fecha >= c.fecha_saldo and t.fecha <= ${corte}::date), 0) as saldo
    from cuentas c
    left join transacciones t on t.cuenta_id = c.id
    where c.activo
    group by c.id
    order by c.orden, c.id`;
  // Movimientos de cada cuenta desde el día de la quincena hasta el corte
  const desde = iso(new Date(periodo.fecha));
  const movimientos = await sql`
    select t.cuenta_id, t.fecha, t.monto, t.tipo, t.nota, t.movimiento_id, co.nombre as concepto,
      (select cu.nombre from transacciones t2 join cuentas cu on cu.id = t2.cuenta_id
       where t2.grupo = t.grupo and t2.id <> t.id limit 1) as contraparte
    from transacciones t
    left join movimientos m on m.id = t.movimiento_id
    left join conceptos co on co.id = m.concepto_id
    where t.fecha between ${desde}::date and ${corte}::date
    order by t.fecha, t.id`;

  const monetariaId = cuentas.find((c) => c.rol === "salario")?.id;

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const h = new Hoja(doc, font, bold);
  const M = Hoja.margen, D = Hoja.ancho - M;

  h.texto(`Quincena del ${etiqueta(qn)}`, M, { size: 16, bold: true });
  h.baja(16);
  h.texto(`${periodo.estado === "cerrada" ? "Cerrada" : "Abierta"} · generado el ${fechaCorta(hoy)}`, M, { gris: true });
  h.baja(22);

  // Resumen
  const real = (f: Record<string, any>) => num(f.monto_real ?? f.monto_plan);
  const recibido = filas.filter((f) => f.tipo === "ingreso" && f.pagado).reduce((s, f) => s + real(f), 0);
  const pagado = filas.filter((f) => f.tipo !== "ingreso" && (f.pagado || f.provisionado)).reduce((s, f) => s + real(f), 0);
  // Abonos, retiros o transferencias registrados a mano en la Monetaria (no en la lista de la quincena)
  const otros = movimientos
    .filter((t) => t.cuenta_id === monetariaId && t.movimiento_id == null && t.tipo !== "ajuste")
    .reduce((s, t) => s + num(t.monto), 0);
  const resumen: [string, number][] = [
    ["Saldo inicial", num(periodo.saldo_inicial)],
    ["Recibido", recibido],
    ["Pagado y provisionado", pagado],
    ...(otros !== 0 ? [["Otros movimientos", otros] as [string, number]] : []),
    ["Disponible", num(periodo.saldo_inicial) + recibido - pagado + otros],
  ];
  const col = (D - M) / resumen.length;
  resumen.forEach(([t], i) => h.texto(t, M + col * i, { gris: true }));
  h.baja(14);
  resumen.forEach(([, v], i) => h.texto(dinero(v, "GTQ"), M + col * i, { size: 12, bold: true }));
  if (Math.abs(num(periodo.saldo_final) - (num(periodo.saldo_inicial) + recibido - pagado)) >= 0.01) {
    h.baja(16);
    h.texto(`Con lo pendiente por recibir y pagar, el saldo quedaría en ${dinero(num(periodo.saldo_final) + otros, "GTQ")}.`, M, { gris: true });
  }
  h.baja(10);

  const monto = (f: Record<string, any>) => num(f.monto_real ?? f.monto_plan);
  const estado = (f: Record<string, any>) =>
    f.pagado ? (f.tipo === "ingreso" ? "Recibido" : "Pagado") : f.provisionado ? "Provisionado" : "Pendiente";

  const tabla = (lista: Record<string, any>[], conCategoria: boolean) => {
    h.texto("Concepto", M, { bold: true });
    h.texto("Plan", 330, { bold: true, derecha: true });
    h.texto("Real", 410, { bold: true, derecha: true });
    h.texto("Estado", 425, { bold: true });
    h.texto("Fecha", D, { bold: true, derecha: true });
    h.baja(4);
    let categoria = "";
    for (const f of lista) {
      if (conCategoria && f.categoria !== categoria) {
        categoria = f.categoria;
        h.espacio(30); h.baja(14); h.texto(categoria, M, { bold: true, gris: true });
      }
      h.espacio(14); h.baja(13); h.linea(0.25);
      h.texto(f.concepto.length > 48 ? f.concepto.slice(0, 46) + "..." : f.concepto, conCategoria ? M + 8 : M);
      h.texto(dinero(num(f.monto_plan), "GTQ"), 330, { derecha: true, gris: true });
      h.texto(f.pagado || f.provisionado || f.monto_real != null ? dinero(monto(f), "GTQ") : "", 410, { derecha: true });
      h.texto(estado(f), 425, { gris: estado(f) === "Pendiente" });
      h.texto(fechaCorta(f.fecha_pago), D, { derecha: true, gris: true });
    }
  };
  const totales = (pares: [string, number][]) => {
    h.espacio(20); h.baja(18); h.linea(0.75);
    let x = M;
    for (const [t, v] of pares) { h.texto(`${t}: ${dinero(v, "GTQ")}`, x, { bold: true }); x += (D - M) / pares.length; }
  };

  const ingresos = filas.filter((f) => f.tipo === "ingreso");
  const egresos = filas.filter((f) => f.tipo !== "ingreso");
  const suma = (l: Record<string, any>[]) => l.reduce((s, f) => s + monto(f), 0);

  h.titulo("Lo que recibí");
  tabla(ingresos, false);
  totales([["Recibido", suma(ingresos.filter((f) => f.pagado))], ["Pendiente", suma(ingresos.filter((f) => !f.pagado))]]);

  h.titulo("Lo que pagué");
  tabla(egresos, true);
  totales([
    ["Pagado", suma(egresos.filter((f) => f.pagado))],
    ["Provisionado", suma(egresos.filter((f) => f.provisionado))],
    ["Pendiente", suma(egresos.filter((f) => !f.pagado && !f.provisionado))],
  ]);

  // Detalle por cuenta y tarjeta (cada moneda por separado)
  h.titulo(`Movimientos del ${fechaCorta(desde)} al ${fechaCorta(corte)}`);
  const NOMBRE_TIPO: Record<string, string> = { ingreso: "Depósito", gasto: "Gasto", transferencia: "Transferencia", ajuste: "Ajuste de cuadre" };
  const conMovimientos = cuentas.filter((c) => movimientos.some((t) => t.cuenta_id === c.id));
  if (conMovimientos.length === 0) {
    h.texto("No hubo movimientos en las cuentas en este período.", M, { gris: true });
    h.baja(4);
  }
  for (const c of conMovimientos) {
    const lista = movimientos.filter((t) => t.cuenta_id === c.id);
    const tarjeta = c.tipo === "tarjeta";
    h.espacio(44); h.baja(18);
    h.texto(c.nombre, M, { bold: true });
    h.texto(tarjeta ? "tarjeta de crédito" : c.moneda === "USD" ? "dólares" : "quetzales", M + bold.widthOfTextAtSize(limpio(c.nombre), 9) + 8, { gris: true });
    for (const t of lista) {
      const v = num(t.monto);
      // En tarjetas, un monto negativo es una compra (sube la deuda)
      const tipo = tarjeta && t.tipo === "gasto" ? "Compra" : tarjeta && v > 0 ? "Pago / abono" : NOMBRE_TIPO[t.tipo] ?? t.tipo;
      const detalle = [t.concepto, t.contraparte && (v < 0 ? `a ${t.contraparte}` : `de ${t.contraparte}`), t.nota].filter(Boolean).join(" · ");
      h.espacio(14); h.baja(13); h.linea(0.25);
      h.texto(fechaCorta(t.fecha), M + 8, { gris: true });
      h.texto(tipo, M + 70);
      h.texto(detalle.length > 52 ? detalle.slice(0, 51) + "..." : detalle, M + 160, { gris: true });
      // En tarjetas se muestra sin signo: el tipo dice si es compra o pago
      h.texto(tarjeta ? dinero(Math.abs(v), c.moneda) : `${v > 0 ? "+" : ""}${dinero(v, c.moneda)}`, D, { derecha: true });
    }
    const neto = lista.reduce((s, t) => s + num(t.monto), 0);
    h.espacio(14); h.baja(13); h.linea(0.5);
    if (tarjeta) {
      const compras = -lista.filter((t) => num(t.monto) < 0).reduce((s, t) => s + num(t.monto), 0);
      const pagos = lista.filter((t) => num(t.monto) > 0).reduce((s, t) => s + num(t.monto), 0);
      h.texto(`Compras: ${dinero(compras, c.moneda)}`, M + 70, { bold: true });
      h.texto(`Pagos: ${dinero(pagos, c.moneda)}`, M + 230, { bold: true });
      h.texto(`${neto <= 0 ? "La deuda subió" : "La deuda bajó"} ${dinero(Math.abs(neto), c.moneda)}`, D, { bold: true, derecha: true });
    } else {
      h.texto("Movimiento neto", M + 70, { bold: true });
      h.texto(`${neto > 0 ? "+" : ""}${dinero(neto, c.moneda)}`, D, { bold: true, derecha: true });
    }
  }

  // Saldos: bancos y tarjetas (cada tarjeta con su parte en dólares)
  h.titulo(`Saldos de las cuentas al ${fechaCorta(corte)}`);
  const usd = new Map(cuentas.filter((c) => c.principal_id != null).map((c) => [c.principal_id, c]));
  const fila = (nombre: string, valores: string[], nota = "") => {
    h.espacio(14); h.baja(13); h.linea(0.25);
    h.texto(nombre, M);
    if (nota) h.texto(nota, 300, { gris: true });
    valores.forEach((v, i) => h.texto(v, D - (valores.length - 1 - i) * 90, { derecha: true }));
  };
  const sinDato = (c: Record<string, any>) => iso(new Date(c.fecha_saldo)) > corte;
  h.texto("Bancos", M, { bold: true, gris: true });
  for (const c of cuentas.filter((c) => c.tipo !== "tarjeta")) {
    fila(c.nombre, [sinDato(c) ? "-" : dinero(num(c.saldo), c.moneda)], sinDato(c) ? "saldo inicial posterior" : "");
  }
  h.espacio(30); h.baja(22);
  h.texto("Tarjetas de crédito (deuda)", M, { bold: true, gris: true });
  h.texto("Quetzales", D - 90, { bold: true, gris: true, derecha: true });
  h.texto("Dólares", D, { bold: true, gris: true, derecha: true });
  for (const c of cuentas.filter((c) => c.tipo === "tarjeta" && c.principal_id == null)) {
    const d = usd.get(c.id);
    fila(c.nombre, [sinDato(c) ? "-" : dinero(-num(c.saldo), "GTQ"), d ? (sinDato(d) ? "-" : dinero(-num(d.saldo), "USD")) : ""]);
  }

  const bytes = await doc.save();
  const nombre = `quincena-${qn.anio}-${String(qn.mes).padStart(2, "0")}-${qn.q === 1 ? "15" : "fin"}.pdf`;
  return new Response(Buffer.from(bytes), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${nombre}"` },
  });
}
