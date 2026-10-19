export type Quincena = { anio: number; mes: number; q: 1 | 2 };

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export const nombreMes = (mes: number) => MESES[mes - 1];

export function etiqueta({ anio, mes, q }: Quincena) {
  const dia = q === 1 ? 15 : new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  return `${dia} de ${nombreMes(mes)} ${anio}`;
}

// La fecha de hoy en Guatemala (AAAA-MM-DD); el servidor y la base van en UTC
export const hoyGT = (ahora = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guatemala" }).format(ahora);

// La quincena de hoy en Guatemala, no en la zona del servidor
export function actual(hoy = new Date()): Quincena {
  const partes = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guatemala", year: "numeric", month: "numeric", day: "numeric" }).formatToParts(hoy);
  const valor = (t: string) => Number(partes.find((p) => p.type === t)?.value);
  return { anio: valor("year"), mes: valor("month"), q: valor("day") <= 15 ? 1 : 2 };
}

export function siguiente({ anio, mes, q }: Quincena): Quincena {
  if (q === 1) return { anio, mes, q: 2 };
  return mes === 12 ? { anio: anio + 1, mes: 1, q: 1 } : { anio, mes: mes + 1, q: 1 };
}

export function anterior({ anio, mes, q }: Quincena): Quincena {
  if (q === 2) return { anio, mes, q: 1 };
  return mes === 1 ? { anio: anio - 1, mes: 12, q: 2 } : { anio, mes: mes - 1, q: 2 };
}

// Hasta qué día cuenta una quincena: el día antes de la siguiente, o hoy si todavía no llega
export function corte(qn: Quincena, hoy = hoyGT()) {
  const sig = siguiente(qn);
  const dia = sig.q === 1 ? 15 : new Date(Date.UTC(sig.anio, sig.mes, 0)).getUTCDate();
  const fin = new Date(Date.UTC(sig.anio, sig.mes - 1, dia) - 86400000).toISOString().slice(0, 10);
  return fin < hoy ? fin : hoy;
}

export const ruta = ({ anio, mes, q }: Quincena) => `/quincena/${anio}/${mes}/${q}`;

export function parse(anio: string, mes: string, q: string): Quincena | null {
  const a = Number(anio), m = Number(mes), n = Number(q);
  if (!Number.isInteger(a) || a < 2000 || a > 2100) return null;
  if (!Number.isInteger(m) || m < 1 || m > 12) return null;
  if (n !== 1 && n !== 2) return null;
  return { anio: a, mes: m, q: n };
}

export const quetzales = (v: number) =>
  `${v < 0 ? "-" : ""}Q${Math.abs(v).toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const SIMBOLOS: Record<string, string> = { USD: "US$", MXN: "MX$" };

export const dinero = (v: number, moneda: string) =>
  moneda in SIMBOLOS
    ? `${v < 0 ? "-" : ""}${SIMBOLOS[moneda]}${Math.abs(v).toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : quetzales(v);

// "dólares", "pesos" o "quetzales"
export const nombreMoneda = (moneda: string) => (moneda === "USD" ? "dólares" : moneda === "MXN" ? "pesos" : "quetzales");
