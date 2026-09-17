/**
 * Caché en memoria con TOPE: entradas máximas, bytes máximos y caducidad.
 *
 * Existe porque las cachés de iconos eran un `Map` que nunca soltaba nada. La
 * clave la elige quien llama —un emoji, una URL, un tamaño de icono— y varias
 * de esas rutas son públicas o las alimenta el panel sin validar: cada valor
 * nuevo era memoria que no volvía hasta el siguiente despliegue.
 *
 * Expulsa la entrada usada hace más tiempo (un `Map` recorre en orden de
 * inserción, así que leer = sacar y volver a meter la deja la última).
 *
 * La caducidad va POR ENTRADA a propósito: un fallo pasajero se guarda unos
 * segundos y un acierto mucho más. Guardar el fallo para siempre es justo lo
 * que dejaba una tarjeta con el ✓ de respaldo hasta el próximo despliegue.
 */
export type OpcionesCacheAcotada<V> = {
  maxEntradas: number;
  /** Tope de bytes sumando `pesar(valor)`. Sin `pesar`, no aplica. */
  maxBytes?: number;
  pesar?: (valor: V) => number;
  /** Caducidad por defecto (ms). Sin ella, la entrada dura hasta que la expulsen. */
  ttlMs?: number;
  /** Reloj inyectable para las pruebas. */
  ahora?: () => number;
};

type Entrada<V> = { valor: V; vence: number; bytes: number };

export class CacheAcotada<V> {
  private readonly mapa = new Map<string, Entrada<V>>();
  private bytesTotales = 0;

  constructor(private readonly opts: OpcionesCacheAcotada<V>) {}

  private ahora(): number {
    return this.opts.ahora ? this.opts.ahora() : Date.now();
  }

  get size(): number {
    return this.mapa.size;
  }

  get bytes(): number {
    return this.bytesTotales;
  }

  /** `has` que respeta la caducidad (una entrada vencida no cuenta). */
  has(clave: string): boolean {
    return this.leer(clave) !== undefined;
  }

  get(clave: string): V | undefined {
    return this.leer(clave)?.valor;
  }

  private leer(clave: string): Entrada<V> | undefined {
    const e = this.mapa.get(clave);
    if (!e) return undefined;
    if (e.vence <= this.ahora()) {
      this.quitar(clave, e);
      return undefined;
    }
    // Recién usada → al final de la cola de expulsión.
    this.mapa.delete(clave);
    this.mapa.set(clave, e);
    return e;
  }

  set(clave: string, valor: V, ttlMs?: number): void {
    const previa = this.mapa.get(clave);
    if (previa) this.quitar(clave, previa);
    const plazo = ttlMs ?? this.opts.ttlMs;
    const bytes = this.opts.pesar ? Math.max(0, this.opts.pesar(valor)) : 0;
    // Un valor que por sí solo no cabe no se guarda: meterlo expulsaría todo
    // lo demás para nada.
    if (this.opts.maxBytes !== undefined && bytes > this.opts.maxBytes) return;
    this.mapa.set(clave, {
      valor,
      bytes,
      vence: plazo === undefined ? Number.POSITIVE_INFINITY : this.ahora() + plazo,
    });
    this.bytesTotales += bytes;
    this.expulsar();
  }

  delete(clave: string): void {
    const e = this.mapa.get(clave);
    if (e) this.quitar(clave, e);
  }

  clear(): void {
    this.mapa.clear();
    this.bytesTotales = 0;
  }

  private quitar(clave: string, e: Entrada<V>): void {
    this.mapa.delete(clave);
    this.bytesTotales -= e.bytes;
  }

  private expulsar(): void {
    const { maxEntradas, maxBytes } = this.opts;
    while (
      this.mapa.size > maxEntradas ||
      (maxBytes !== undefined && this.bytesTotales > maxBytes)
    ) {
      const masVieja = this.mapa.keys().next();
      if (masVieja.done) break;
      const e = this.mapa.get(masVieja.value)!;
      this.quitar(masVieja.value, e);
    }
  }
}
