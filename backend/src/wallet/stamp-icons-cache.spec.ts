import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import sharp from 'sharp';
import { fetchTwemojiPng, resolveCustomImageRenderer } from './stamp-icons';

/**
 * Las cachés de iconos del cartón de sellos.
 *
 * EL FALLO (arqueo 2026-09-17):
 *  · `twemojiCache` y `customIconCache` eran `Map` sin tope. La clave la manda
 *    el panel (`POST /cards/preview-strips` sin `MaxLength`): cada emoji o URL
 *    nueva era memoria que no volvía hasta el despliegue.
 *  · Un fallo PASAJERO (CDN lento, R2 con un 503) se guardaba como `null` para
 *    siempre, y la tarjeta salía con el ✓ de respaldo hasta el próximo
 *    despliegue.
 *  · El icono propio se descargaba de CUALQUIER URL que mandara el cliente.
 */

const BUCKET = 'https://pub-prueba-iconos.r2.dev';
let png: Buffer;

beforeEach(async () => {
  process.env.S3_PUBLIC_URL = BUCKET;
  png ??= await sharp({ create: { width: 4, height: 4, channels: 4, background: '#f00' } }).png().toBuffer();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const ok = () => new Response(new Uint8Array(png), { status: 200, headers: { 'content-type': 'image/png' } });

describe('Twemoji', () => {
  it('un fallo pasajero NO se queda guardado para siempre', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-17T10:00:00Z'));
    const fetch = vi.fn().mockRejectedValueOnce(new Error('ECONNRESET')).mockImplementation(async () => ok());
    vi.stubGlobal('fetch', fetch);

    expect(await fetchTwemojiPng('🦩')).toBeNull();
    vi.setSystemTime(new Date('2026-09-17T10:05:00Z'));
    expect(await fetchTwemojiPng('🦩')).toBeInstanceOf(Buffer);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('la caché tiene tope: con cientos de emojis distintos, los viejos salen', async () => {
    const fetch = vi.fn(async () => ok());
    vi.stubGlobal('fetch', fetch);
    const emojis = Array.from({ length: 260 }, (_, i) => String.fromCodePoint(0x1f400 + i));
    for (const e of emojis) await fetchTwemojiPng(e);
    expect(fetch).toHaveBeenCalledTimes(260);
    // El primero ya fue expulsado: se vuelve a pedir.
    await fetchTwemojiPng(emojis[0]);
    expect(fetch).toHaveBeenCalledTimes(261);
  });

  it('un «emoji» de miles de caracteres no sale a internet', async () => {
    const fetch = vi.fn(async () => ok());
    vi.stubGlobal('fetch', fetch);
    expect(await fetchTwemojiPng('🍕'.repeat(3000))).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('icono de sello propio', () => {
  it('no descarga URLs que no sean de nuestro almacenamiento', async () => {
    const fetch = vi.fn(async () => ok());
    vi.stubGlobal('fetch', fetch);
    for (const url of [
      'http://169.254.169.254/latest/meta-data/iam',
      'http://localhost:3001/api/health',
      `${BUCKET}.atacante.com/x.png`,
      `https://usuario@atacante.com/x.png`,
    ]) {
      expect(await resolveCustomImageRenderer(url)).toBeNull();
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('la imagen de nuestro bucket se sigue usando, con tiempo máximo', async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => ok());
    vi.stubGlobal('fetch', fetch);
    const r = await resolveCustomImageRenderer(`${BUCKET}/sellos/cafe-ok.png`);
    expect(r).not.toBeNull();
    expect(fetch.mock.calls[0][1]?.signal).toBeDefined();
  });

  it('un 503 pasajero no deja la tarjeta con el ✓ hasta el próximo despliegue', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-17T11:00:00Z'));
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('caído', { status: 503 }))
      .mockImplementation(async () => ok());
    vi.stubGlobal('fetch', fetch);
    const url = `${BUCKET}/sellos/cafe-503.png`;
    expect(await resolveCustomImageRenderer(url)).toBeNull();
    vi.setSystemTime(new Date('2026-09-17T11:05:00Z'));
    expect(await resolveCustomImageRenderer(url)).not.toBeNull();
  });
});
