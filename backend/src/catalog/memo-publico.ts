/**
 * Caché en memoria de las respuestas PÚBLICAS del menú (negocio y carta).
 *
 * Por qué (Café 1550, 2026-10-03, «no carga el menú»): cada respuesta hace unas
 * 12 consultas, y el backend llega a la base por el proxy público de Railway
 * (~140 ms cada una): 2–3,5 s. La caché del borde de Vercel lo tapa solo cuando
 * está caliente, y es POR REGIÓN y dura minutos: un negocio con pocas visitas
 * casi siempre la encuentra fría, y su cliente espera los 3,5 s. Con esto, una
 * respuesta ya armada sale de memoria en milisegundos.
 *
 * - Fresca `FRESCA_MS`: se sirve sin tocar la base.
 * - Hasta `VIGENTE_MS`: se sirve al instante y se rehace por detrás (lo mismo
 *   que ya hace `stale-while-revalidate` en el borde).
 * - Peticiones simultáneas de la misma clave comparten UNA carga.
 * - Un error no se guarda: la siguiente petición lo vuelve a intentar.
 */
export const FRESCA_MS = 30_000;
export const VIGENTE_MS = 10 * 60_000;
const MAXIMO = 500;

type Entrada = { valor: unknown; guardado: number };

export class MemoPublico {
  private entradas = new Map<string, Entrada>();
  private enCurso = new Map<string, Promise<unknown>>();

  constructor(private reloj: () => number = Date.now) {}

  async obtener<T>(clave: string, cargar: () => Promise<T>): Promise<T> {
    const e = this.entradas.get(clave);
    const edad = e ? this.reloj() - e.guardado : Infinity;
    if (e && edad < FRESCA_MS) return e.valor as T;
    if (e && edad < VIGENTE_MS) {
      // Se sirve la guardada YA; la nueva queda para la siguiente visita.
      this.cargar(clave, cargar).catch(() => undefined);
      return e.valor as T;
    }
    return this.cargar(clave, cargar);
  }

  private cargar<T>(clave: string, cargar: () => Promise<T>): Promise<T> {
    const ya = this.enCurso.get(clave);
    if (ya) return ya as Promise<T>;
    const p = cargar()
      .then((valor) => {
        // Reinsertar la mueve al final: el Map queda en orden de uso y lo
        // primero que sale al pasar del máximo es lo que nadie pidió hace más.
        this.entradas.delete(clave);
        this.entradas.set(clave, { valor, guardado: this.reloj() });
        if (this.entradas.size > MAXIMO) {
          const vieja = this.entradas.keys().next().value;
          if (vieja !== undefined) this.entradas.delete(vieja);
        }
        return valor;
      })
      .finally(() => this.enCurso.delete(clave));
    this.enCurso.set(clave, p);
    return p;
  }

  /** Cuántas respuestas hay guardadas (para pruebas y diagnóstico). */
  get tamano() {
    return this.entradas.size;
  }
}
