import type { INestApplication } from '@nestjs/common';
import { json, urlencoded, type NextFunction, type Request, type Response } from 'express';

/**
 * Lo que `main.ts` prepara antes de aceptar tráfico, en un módulo aparte para
 * poder probarlo: importar `main.ts` arranca la aplicación entera.
 */

/**
 * Rutas PÚBLICAS que solo reciben un puñado de bytes. Sobre la URL cruda, así
 * que cubren también el alias `/api/v1/...` (se reescribe más tarde).
 *
 *  · El contador de clics del InfoLink manda `{type, metadata:{label}}`.
 *  · Apple Wallet manda sus líneas de error a `v1/log`.
 *
 * Las dos aceptaban los 15 MB del parser global (pensados para el editor de
 * carteles QR): cualquiera obligaba al servidor a leer y parsear megas por
 * petición.
 */
export const RUTAS_DE_CUERPO_PEQUENO: readonly RegExp[] = [
  /^\/api(?:\/v1)?\/public\/i\/[^/?]+\/track\/?(?:\?|$)/,
  /^\/api(?:\/v1)?\/wallet\/apple\/v1\/log\/?(?:\?|$)/,
];
export const LIMITE_CUERPO_PEQUENO = '16kb';

type AppArrancable = Pick<INestApplication, 'enableShutdownHooks' | 'use'>;

export function prepararCierreYLimites(app: AppArrancable): void {
  // Sin esto, al redesplegar Nest no llamaba a ningún `onModuleDestroy`:
  // Prisma no soltaba sus conexiones, las colas no cerraban los workers —y el
  // trabajo a medias se reintentaba en el contenedor nuevo— y las conexiones
  // HTTP/2 con Apple quedaban colgadas. Con los ganchos, SIGTERM cierra en
  // orden y después termina el proceso con la misma señal.
  app.enableShutdownHooks();

  // Va ANTES del parser global de 15 MB: body-parser marca el cuerpo como
  // leído y el global ya no lo vuelve a leer. Pasado el tope responde 413.
  const jsonPequeno = json({ limit: LIMITE_CUERPO_PEQUENO });
  const formPequeno = urlencoded({ limit: LIMITE_CUERPO_PEQUENO, extended: true });
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!RUTAS_DE_CUERPO_PEQUENO.some((r) => r.test(req.url))) return next();
    jsonPequeno(req, res, (err?: unknown) => {
      if (err) return next(err);
      formPequeno(req, res, next);
    });
  });
}
