/**
 * Montos de las acciones que mueven DINERO o PUNTOS en el escáner
 * (CASHBACK_ADD/REDEEM, POINTS_ADD/DEDUCT).
 *
 * POR QUÉ EXISTE (auditoría 2026-11-26): el servidor se creía el número que
 * mandaba el navegador. `amount` no tenía validación ninguna, así que:
 *  · un `CASHBACK_REDEEM` con monto NEGATIVO le SUMABA saldo al cliente;
 *  · un texto en vez de número reventaba `Prisma.Decimal` con un 500;
 *  · el cashback lo calculaba la pantalla (`compra × %`) y el servidor lo
 *    aceptaba tal cual: cualquiera con sesión de cajero podía abonar lo que
 *    quisiera;
 *  · la compra mínima de la tarjeta (`cashbackMinPurchase`) no se miraba en
 *    ningún lado.
 *
 * Pura y sin base de datos, para probarla sola.
 */
import { BadRequestException } from '@nestjs/common';

export const ACCIONES_DE_DINERO = ['CASHBACK_ADD', 'CASHBACK_REDEEM', 'POINTS_ADD', 'POINTS_DEDUCT'] as const;

/** Tope de cordura: nadie abona ni compra por encima de esto en un escaneo. */
const MAXIMO = 1_000_000_000;

/** Mismo porcentaje de respaldo que usa el escáner cuando la tarjeta no tiene uno. */
const PORCENTAJE_POR_DEFECTO = 5;

function numeroValido(v: unknown, campo: string): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) throw new BadRequestException(`El ${campo} no es un número.`);
  if (n < 0) throw new BadRequestException(`El ${campo} no puede ser negativo.`);
  if (n > MAXIMO) throw new BadRequestException(`El ${campo} es demasiado grande.`);
  return n;
}

const pesos = (n: number) => `$${Math.round(n).toLocaleString('es-CO')}`;

/**
 * Valida `amount` y `purchaseAmount` para cualquier acción (que sean números,
 * no negativos, acotados) y, en las de dinero, decide el monto que vale.
 *
 * CASHBACK_ADD: el monto lo calcula EL SERVIDOR con la compra y el % de la
 * tarjeta; lo que diga el navegador se ignora. Sin compra solo puede abonar un
 * SUPER_ADMIN (ajuste a mano).
 */
export function montoDeLaAccion(o: {
  accion: string;
  amount: unknown;
  purchaseAmount: unknown;
  esSuperAdmin: boolean;
  card: { cashbackPercent?: number | null; cashbackMinPurchase?: unknown };
}): { amount: number | undefined; purchaseAmount: number | undefined } {
  const amount = numeroValido(o.amount, 'monto');
  const purchaseAmount = numeroValido(o.purchaseAmount, 'monto de la compra');
  if (!(ACCIONES_DE_DINERO as readonly string[]).includes(o.accion)) {
    return { amount, purchaseAmount };
  }

  if (o.accion === 'CASHBACK_ADD') {
    if (purchaseAmount === undefined || purchaseAmount <= 0) {
      if (o.esSuperAdmin && amount && amount > 0) return { amount, purchaseAmount };
      throw new BadRequestException('Escribe el monto de la compra para calcular el cashback.');
    }
    const minimo = Number(o.card.cashbackMinPurchase ?? 0);
    if (minimo > 0 && purchaseAmount < minimo) {
      throw new BadRequestException(
        `Compra mínima para ganar cashback: ${pesos(minimo)}. La compra de ${pesos(purchaseAmount)} no alcanza.`,
      );
    }
    const pct = o.card.cashbackPercent ?? PORCENTAJE_POR_DEFECTO;
    const ganado = Math.round((purchaseAmount * pct) / 100);
    if (ganado <= 0) {
      throw new BadRequestException('Esa compra no alcanza para generar cashback.');
    }
    return { amount: ganado, purchaseAmount };
  }

  // Canjes y puntos: el monto lo pone el cajero, pero tiene que ser positivo.
  if (amount === undefined || amount <= 0) {
    throw new BadRequestException(
      o.accion === 'CASHBACK_REDEEM' ? 'Escribe cuánto saldo va a usar.' : 'Escribe cuántos puntos.',
    );
  }
  return { amount, purchaseAmount };
}

/** Saldo que no alcanza, dicho en español y con lo que hay. */
export function saldoInsuficiente(accion: 'CASHBACK_REDEEM' | 'POINTS_DEDUCT', saldo: number): string {
  return accion === 'CASHBACK_REDEEM'
    ? `El saldo no alcanza: el cliente tiene ${pesos(saldo)}.`
    : `Los puntos no alcanzan: el cliente tiene ${Math.floor(saldo)}.`;
}
