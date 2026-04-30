import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';

/**
 * CORS:
 *  - permite APP_URL exacto
 *  - permite cualquier subdominio de CORS_ROOT_DOMAIN (ej. *.soyclubify.com)
 *  - permite cualquier origin listado (coma-separado) en CORS_EXTRA_ORIGINS
 *  - permite localhost y *.localhost en cualquier puerto (dev)
 *  - los customDomains de tenants se agregan a CORS_EXTRA_ORIGINS o se actualiza
 *    en redeploy (rotan rara vez, evita query DB en cada request)
 */
function isOriginAllowed(origin: string): boolean {
  try {
    const u = new URL(origin);
    const host = u.host.toLowerCase();
    const hostname = u.hostname.toLowerCase();

    const appUrl = (process.env.APP_URL ?? '').toLowerCase();
    const root = (process.env.CORS_ROOT_DOMAIN ?? '')
      .replace(/^https?:\/\//, '')
      .replace(/\/$/, '')
      .toLowerCase();
    const extras = (process.env.CORS_EXTRA_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    if (origin.toLowerCase() === appUrl) return true;
    if (extras.includes(origin.toLowerCase()) || extras.includes(host)) return true;
    if (root && (hostname === root || hostname.endsWith('.' + root))) return true;
    if (hostname === 'localhost' || hostname.endsWith('.localhost')) return true;

    return false;
  } catch {
    return false;
  }
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    cors: {
      origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        return cb(null, isOriginAllowed(origin));
      },
      credentials: true,
    },
  });
  app.use(helmet());
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port, '0.0.0.0');
  Logger.log(`Clubify API listening on :${port}`, 'Bootstrap');
}

bootstrap();
