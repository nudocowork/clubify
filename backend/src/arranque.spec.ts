import { describe, it, expect, vi, afterEach } from 'vitest';
import express, { json } from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { prepararCierreYLimites } from './arranque';

/**
 * Lo que `main.ts` prepara antes de aceptar tráfico y no se puede probar
 * importando `main.ts` (arranca la app entera al importarlo).
 *
 * EL FALLO (arqueo 2026-09-17):
 *  · Sin `enableShutdownHooks()`, en cada redespliegue Nest no llamaba a los
 *    `onModuleDestroy`: Prisma no soltaba conexiones, las colas no cerraban
 *    sus workers (y los trabajos a medias se reintentaban) y las conexiones
 *    con Apple quedaban abiertas.
 *  · Todas las rutas aceptaban cuerpos de 15 MB, también las PÚBLICAS que solo
 *    reciben un puñado de bytes: el registro de Apple Wallet y el contador de
 *    clics del InfoLink.
 */

let servidor: Server | null = null;
afterEach(() => {
  servidor?.close();
  servidor = null;
});

function appFalsa() {
  const ex = express();
  const app: any = {
    enableShutdownHooks: vi.fn(),
    use: (...args: any[]) => ex.use(...args),
  };
  return { app, ex };
}

async function levantar(ex: express.Express): Promise<string> {
  // Igual que main.ts: después de lo nuestro va el parser global de 15 MB.
  ex.use(json({ limit: '15mb' }));
  ex.post(/.*/, (req, res) => {
    res.json({ recibido: JSON.stringify(req.body).length });
  });
  await new Promise<void>((ok) => {
    servidor = ex.listen(0, ok);
  });
  return `http://127.0.0.1:${(servidor!.address() as AddressInfo).port}`;
}

const cuerpo = (bytes: number) => JSON.stringify({ type: 'click_button', metadata: { label: 'x'.repeat(bytes) } });

describe('prepararCierreYLimites', () => {
  it('enciende los ganchos de cierre de Nest', () => {
    const { app } = appFalsa();
    prepararCierreYLimites(app);
    expect(app.enableShutdownHooks).toHaveBeenCalledTimes(1);
  });

  it('las rutas públicas pequeñas rechazan un cuerpo grande (413), también con /api/v1', async () => {
    const { app, ex } = appFalsa();
    prepararCierreYLimites(app);
    const base = await levantar(ex);
    for (const ruta of ['/api/public/i/abc/track', '/api/v1/public/i/abc/track', '/api/wallet/apple/v1/log']) {
      const r = await fetch(base + ruta, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: cuerpo(200_000),
      });
      expect(r.status, ruta).toBe(413);
    }
  });

  it('un clic normal sigue entrando, y el resto de rutas conservan su tope', async () => {
    const { app, ex } = appFalsa();
    prepararCierreYLimites(app);
    const base = await levantar(ex);
    const clic = await fetch(`${base}/api/public/i/abc/track`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'click_button', metadata: { label: 'WhatsApp', buttonType: 'WHATSAPP' } }),
    });
    expect(clic.status).toBe(200);
    const poster = await fetch(`${base}/api/qr-posters`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: cuerpo(2_000_000),
    });
    expect(poster.status).toBe(200);
  });
});
