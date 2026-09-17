import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { ValidationPipe } from '@nestjs/common';
import { PublicOrdersController } from './public-orders.controller';

/**
 * El pedido público acepta `variantIds` (varias variantes de un producto).
 *
 * EL BUG: el storefront manda `variantIds` en cada línea de un producto con
 * `maxVariantsTotal >= 2`, y el servicio sabe cobrarlas, pero el DTO público
 * no declaraba el campo. Con `forbidNonWhitelisted` el ValidationPipe tumbaba
 * el pedido ENTERO con un 400 («property variantIds should not exist») justo
 * al pulsar «Pedir». El pedido manual del panel ya lo tenía declarado.
 *
 * Se valida con el mismo `ValidationPipe` y las mismas opciones que `main.ts`,
 * sobre la clase real que Nest le pasa al endpoint.
 */

const pipe = new ValidationPipe({
  whitelist: true,
  transform: true,
  forbidNonWhitelisted: true,
});

// La clase del @Body() tal como la ve Nest (metadatos del decorador).
const Cuerpo = Reflect.getMetadata(
  'design:paramtypes',
  PublicOrdersController.prototype,
  'create',
)[0];

const pedido = (item: Record<string, unknown>) => ({
  tenantSlug: 'heladeria',
  customer: { fullName: 'Ana', phone: '+57 3001234567' },
  items: [{ productId: 'p1', qty: 1, ...item }],
  fulfillment: 'PICKUP',
});

const validar = (body: unknown) =>
  pipe.transform(body, { type: 'body', metatype: Cuerpo, data: '' });

describe('POST /public/orders — variantes múltiples', () => {
  it('acepta `variantIds` en una línea', async () => {
    const r = await validar(pedido({ variantIds: ['v-fresa', 'v-mora'] }));
    expect(r.items[0].variantIds).toEqual(['v-fresa', 'v-mora']);
  });

  it('rechaza `variantIds` que no sean textos', async () => {
    await expect(validar(pedido({ variantIds: [1, 2] }))).rejects.toThrow();
  });

  it('rechaza `variantIds` que no sea una lista', async () => {
    await expect(validar(pedido({ variantIds: 'v-fresa' }))).rejects.toThrow();
  });

  it('un pedido de siempre, con una sola variante, sigue pasando', async () => {
    const r = await validar(pedido({ variantId: 'v-fresa' }));
    expect(r.items[0].variantId).toBe('v-fresa');
  });
});
