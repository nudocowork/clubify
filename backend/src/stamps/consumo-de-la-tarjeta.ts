/**
 * Cuánto ha consumido un cliente EN UNA TARJETA, para decidir el premio al
 * canjear (Javier, 2026-10-31): el premio debe ir acorde con lo consumido, y
 * dos clientes con 10 sellos pueden haber gastado cifras muy distintas.
 *
 * Solo cuenta lo que tiene monto registrado. `purchaseAmount` no se pidió
 * siempre, y un sello viejo sin monto no vale cero: por eso `sinMonto` se
 * devuelve aparte y la pantalla avisa, en vez de enseñar un total que parece
 * completo sin serlo.
 *
 * Mismo criterio que `metrics.service`: venta = STAMP o VISIT con monto. En
 * CASHBACK_ADD `purchaseAmount` va en null a propósito (ver el schema).
 */

export interface FilaDeConsumo {
  action: string;
  purchaseAmount: unknown;
  giftReason: string | null;
  redeemKind: string | null;
  orderId: string | null;
  createdAt: Date;
}

export interface TramoDeConsumo {
  total: number;
  compras: number;
  ticketPromedio: number;
}

/**
 * Una tarjeta LLENA: lo que el cliente compró desde el canje anterior (o desde
 * que empezó) hasta el canje que la vació. Un canje de premio exige la tarjeta
 * completa (`stamps.service`, `REDEEM` resta `stampsRequired`), así que cada
 * canje que no es de cupón es una tarjeta terminada.
 */
export interface TarjetaLlena extends TramoDeConsumo {
  /** 1 = la primera que llenó. */
  numero: number;
  /** Primera compra con monto de esa vuelta; null si ninguna tuvo monto. */
  desde: Date | null;
  canjeadaAt: Date;
  /** Sellos de compra de esa vuelta sin monto: la cifra se queda corta. */
  sinMonto: number;
}

export interface ConsumoDeLaTarjeta {
  historico: TramoDeConsumo;
  /** Cada vez que llenó la tarjeta, cuánto gastó (Javier, 2026-11-27: «si ha
   *  llenado varias veces, que me muestre cada vez cuánto ha gastado»). */
  tarjetasLlenas: TarjetaLlena[];
  /** Lo acumulado para el premio que se va a canjear ahora. */
  desdeElCanje: TramoDeConsumo;
  ultimoCanjeAt: Date | null;
  ultimaCompraAt: Date | null;
  /** Sellos de compra sin monto registrado: no suman al total. */
  sinMonto: number;
  /** Sellos regalados (cortesía o fecha especial): nunca son consumo. */
  regalos: number;
}

const tramo = (montos: number[]): TramoDeConsumo => {
  const total = montos.reduce((s, m) => s + m, 0);
  return {
    total,
    compras: montos.length,
    ticketPromedio: montos.length ? total / montos.length : 0,
  };
};

export function resumirConsumo(filas: FilaDeConsumo[]): ConsumoDeLaTarjeta {
  // Canjear un cupón de bienvenida no gasta los sellos: no abre otro premio.
  const canjes = filas
    .filter((f) => f.action === 'REDEEM' && f.redeemKind !== 'COUPON')
    .map((f) => f.createdAt.getTime());
  const ultimoCanje = canjes.length ? Math.max(...canjes) : null;

  const historico: number[] = [];
  const desdeElCanje: number[] = [];
  let ultimaCompra: number | null = null;
  let sinMonto = 0;
  let regalos = 0;
  // Una vuelta por canje, en orden; la compra va a la primera vuelta cuyo canje
  // es igual o posterior a ella (mismo corte que `desdeElCanje`: lo de después
  // del último canje es la vuelta en curso).
  const cortes = [...canjes].sort((a, b) => a - b);
  const vueltas = cortes.map(() => ({ montos: [] as number[], desde: null as number | null, sinMonto: 0 }));
  const vueltaDe = (t: number) => cortes.findIndex((c) => t <= c);

  for (const f of filas) {
    if (f.action !== 'STAMP' && f.action !== 'VISIT') continue;
    if (f.giftReason) {
      regalos += 1;
      continue;
    }
    const monto = Number(f.purchaseAmount ?? 0);
    if (!(monto > 0)) {
      // Con pedido y sin monto = pedido cancelado (`orders.service` lo vacía):
      // no es un dato que falte, es una compra que no ocurrió.
      if (!f.orderId) {
        sinMonto += 1;
        const v = vueltaDe(f.createdAt.getTime());
        if (v >= 0) vueltas[v].sinMonto += 1;
      }
      continue;
    }
    const cuando = f.createdAt.getTime();
    historico.push(monto);
    const v = vueltaDe(cuando);
    if (v >= 0) {
      vueltas[v].montos.push(monto);
      if (vueltas[v].desde === null || cuando < vueltas[v].desde!) vueltas[v].desde = cuando;
    }
    if (ultimoCanje === null || cuando > ultimoCanje) desdeElCanje.push(monto);
    if (ultimaCompra === null || cuando > ultimaCompra) ultimaCompra = cuando;
  }

  return {
    historico: tramo(historico),
    tarjetasLlenas: vueltas.map((v, i) => ({
      numero: i + 1,
      ...tramo(v.montos),
      desde: v.desde === null ? null : new Date(v.desde),
      canjeadaAt: new Date(cortes[i]),
      sinMonto: v.sinMonto,
    })),
    desdeElCanje: tramo(desdeElCanje),
    ultimoCanjeAt: ultimoCanje === null ? null : new Date(ultimoCanje),
    ultimaCompraAt: ultimaCompra === null ? null : new Date(ultimaCompra),
    sinMonto,
    regalos,
  };
}
