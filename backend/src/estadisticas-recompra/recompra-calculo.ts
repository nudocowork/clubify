// Reglas de la pantalla «Recompra por negocio» (/superadmin/recompra). Puras,
// sin base de datos, para poder probarlas: el SQL entrega filas por negocio y
// aquí se decide quién entra al promedio y qué se marca como dudoso.
//
// Las mismas definiciones del informe de casos de éxito del 2026-11-13
// (scripts/estadisticas-casos-de-exito.cjs). Si cambian aquí, cambian allá.

export type FilaVentana = {
  unicos: number;
  recurrentes: number;
  visitas: number;
  diasEntre: number | null;
  ingresos: number | null;
  conMonto: number;
};

export type NegocioCrudo = {
  id: string;
  nombre: string;
  marca: string;
  status: string;
  currency: string;
  alta: Date;
  historico: FilaVentana | null;
  ultimos90: FilaVentana | null;
  medianaMonto: number | null;
  pctMontoBajo: number | null;
};

/** Mínimos para que un negocio entre al promedio. Con menos clientes o menos
 *  tiempo, un 80 % de recompra son 4 personas y arrastra el promedio. */
export const MIN_CLIENTES = 30;
export const MIN_DIAS = 60;

/** Negocios cuyos sellos no son compras de clientes. Momento: 31 clientes con
 *  2 tarjetas cada uno, 49 sellos en un solo día puestos por una sola persona
 *  y 19 de 30 repeticiones a menos de 10 minutos (revisión del 2026-11-13).
 *  Daba 97 % de recompra y se comía el primer puesto del ranking. */
export const EXCLUIDOS: Array<{ coincide: string; motivo: string }> = [
  { coincide: 'momento', motivo: 'Sellos de prueba: casi todos en dos días y por una sola persona.' },
];

const MONEDAS_SIN_DECIMALES = new Set(['COP', 'CLP']);

export const porcentaje = (a: number, b: number) => (b ? Math.round((1000 * a) / b) / 10 : null);

export function exclusion(nombre: string, slug: string): string | null {
  const texto = `${nombre} ${slug}`.toLowerCase();
  return EXCLUIDOS.find((e) => texto.includes(e.coincide))?.motivo ?? null;
}

/** Por qué un negocio no entra al promedio, o null si entra. */
export function motivoFuera(n: NegocioCrudo, excluido: string | null, hoy: Date): string | null {
  if (excluido) return excluido;
  if (n.status === 'SUSPENDED') return 'Suspendido.';
  const dias = Math.floor((hoy.getTime() - n.alta.getTime()) / 86400000);
  if ((n.historico?.unicos ?? 0) < MIN_CLIENTES) return `Menos de ${MIN_CLIENTES} clientes.`;
  if (dias < MIN_DIAS) return `Menos de ${MIN_DIAS} días en Clubify.`;
  return null;
}

/** Montos que el cajero escribe sin ser el valor real (p. ej. «1» en pesos).
 *  No toca la recompra, pero el ticket promedio de ese negocio no sirve. */
export function montoDudoso(n: Pick<NegocioCrudo, 'currency' | 'medianaMonto' | 'pctMontoBajo'>): boolean {
  if ((n.pctMontoBajo ?? 0) > 30) return true;
  return MONEDAS_SIN_DECIMALES.has(n.currency) && n.medianaMonto != null && n.medianaMonto < 1000;
}

export type Promedio = { negocios: number; recompra: number | null; frecuencia: number | null; diasEntre: number | null };

/** Promedio POR NEGOCIO (cada negocio pesa igual), no de todos los clientes
 *  juntos: lo que se pidió es «el negocio típico de Clubify». */
export function promedio(filas: Array<FilaVentana | null>): Promedio {
  const xs = filas.filter((f): f is FilaVentana => !!f && f.unicos > 0);
  const media = (v: Array<number | null>) => {
    const ok = v.filter((y): y is number => y != null && !Number.isNaN(y));
    return ok.length ? Math.round((10 * ok.reduce((s, y) => s + y, 0)) / ok.length) / 10 : null;
  };
  return {
    negocios: xs.length,
    recompra: media(xs.map((f) => porcentaje(f.recurrentes, f.unicos))),
    frecuencia: media(xs.map((f) => f.visitas / f.unicos)),
    diasEntre: media(xs.map((f) => f.diasEntre)),
  };
}
