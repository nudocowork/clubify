import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CardsController } from './cards.controller';

/**
 * `POST /cards/preview-strips` genera la imagen del cartón con lo que manda el
 * panel, SIN guardar nada. El ícono (`stampIcon`) y el emoji de cada premio
 * son la CLAVE de la caché de iconos y el trozo de URL que se pide a Twemoji:
 * sin tope, un texto de megas entraba entero en memoria y en la petición.
 *
 * Se saca la clase del DTO de los metadatos del propio controlador para
 * probar exactamente lo que valida el `ValidationPipe`.
 */
const Cuerpo = Reflect.getMetadata('design:paramtypes', CardsController.prototype, 'previewStrips')[0];

async function errores(body: Record<string, unknown>) {
  const dto = plainToInstance(Cuerpo as new () => object, body as object);
  return validate(dto, { whitelist: true, forbidNonWhitelisted: true });
}

describe('PreviewStripsBody', () => {
  it('acepta lo que manda el editor de tarjetas', async () => {
    expect(
      await errores({
        stampIcon: '👩🏽‍❤️‍💋‍👨🏿',
        stampsRequired: 10,
        freeRewards: [{ pos: 5, text: 'Café gratis', emoji: '☕', active: true }],
      }),
    ).toEqual([]);
  });

  it('rechaza un ícono de sello enorme', async () => {
    expect((await errores({ stampIcon: '🍕'.repeat(5000) })).length).toBeGreaterThan(0);
  });

  it('rechaza un emoji de premio enorme', async () => {
    expect(
      (await errores({ freeRewards: [{ pos: 1, emoji: 'x'.repeat(5000) }] })).length,
    ).toBeGreaterThan(0);
  });

  it('rechaza cientos de premios', async () => {
    const muchos = Array.from({ length: 500 }, (_, i) => ({ pos: i + 1, emoji: '⭐' }));
    expect((await errores({ freeRewards: muchos })).length).toBeGreaterThan(0);
  });

  it('rechaza una URL de icono propio desmesurada', async () => {
    expect(
      (await errores({ stampIconImageUrl: `https://x.r2.dev/${'a'.repeat(5000)}` })).length,
    ).toBeGreaterThan(0);
  });
});
