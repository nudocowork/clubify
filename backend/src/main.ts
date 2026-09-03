// eslint-disable-next-line no-console
console.log('[Boot] main.ts top — node version=' + process.version);
// Use stderr.write con fsync para garantizar flush incluso si stdout
// queda buffered. Útil para Railway/Docker donde stdout puede demorar
// en aparecer si el proceso se cuelga después.
process.stderr.write(
  `[Boot] PORT env = ${process.env.PORT ?? '(undefined)'}\n`,
);
process.stderr.write(
  `[Boot] NODE_ENV = ${process.env.NODE_ENV ?? '(undefined)'}\n`,
);
process.stderr.write(
  `[Boot] DATABASE_URL host = ${(process.env.DATABASE_URL ?? '').split('@')[1]?.split('/')[0] ?? '(missing)'}\n`,
);
// `import './instrument'` DEBE ser la primera línea — Sentry parchea http/pg
// vía auto-instrumentación, y necesita correr antes de cualquier otro import.
import './instrument';
// eslint-disable-next-line no-console
console.log('[Boot] main.ts after instrument import');
import { NestFactory, HttpAdapterHost } from '@nestjs/core';
import { ValidationPipe, Logger, type INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { json, urlencoded, type Request, type Response, type NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
// eslint-disable-next-line no-console
console.log('[Boot] main.ts before AppModule import');
import { AppModule } from './app.module';
import { PrismaService } from './common/prisma/prisma.service';
// eslint-disable-next-line no-console
console.log('[Boot] main.ts after AppModule import');
import { SentryExceptionFilter } from './common/sentry/sentry.filter';

/**
 * CORS:
 *  - permite APP_URL exacto
 *  - permite cualquier subdominio de CORS_ROOT_DOMAIN (ej. *.soyclubify.com)
 *  - permite cualquier origin listado (coma-separado) en CORS_EXTRA_ORIGINS
 *  - permite localhost y *.localhost en cualquier puerto (dev)
 *  - los customDomains de tenants se agregan a CORS_EXTRA_ORIGINS o se actualiza
 *    en redeploy (rotan rara vez, evita query DB en cada request)
 */
// Hosts de dominios propios de marcas blancas (ej. selleala.com,
// app.selleala.com) permitidos para CORS. Se refresca desde la DB al boot y
// cada pocos minutos — así CUALQUIER WhiteLabel ACTIVE con domain/appDomain
// queda habilitado automáticamente sin tocar env ni redeployar. Sin esto, el
// login/panel servido en el dominio de la marca no puede llamar al API
// (api.soyclubify.com) → "Failed to fetch" por CORS.
const brandHosts = new Set<string>();
function normHost(s?: string | null): string {
  return (s ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '')
    .split('/')[0];
}
async function refreshBrandHosts(prisma: PrismaService): Promise<void> {
  try {
    const wls = await prisma.whiteLabel.findMany({
      where: { status: 'ACTIVE' },
      select: { domain: true, appDomain: true },
    });
    const next = new Set<string>();
    for (const wl of wls) {
      for (const d of [wl.domain, wl.appDomain]) {
        const h = normHost(d);
        if (!h) continue;
        next.add(h);
        // El dominio de marketing suele servirse también con www.
        if (!h.startsWith('www.')) next.add('www.' + h);
      }
    }
    brandHosts.clear();
    next.forEach((h) => brandHosts.add(h));
    // eslint-disable-next-line no-console
    console.log(`[CORS] brand hosts cargados: ${brandHosts.size}`);
  } catch (e) {
    // Si la query falla, conservamos el cache previo (no rompemos CORS).
    // eslint-disable-next-line no-console
    console.warn('[CORS] refreshBrandHosts falló:', (e as Error)?.message);
  }
}

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
    // Dominios propios de marcas blancas (refrescados desde la DB).
    if (brandHosts.has(hostname)) return true;

    return false;
  } catch {
    return false;
  }
}

/**
 * Compat shim: aceptar `/api/v1/*` y servirlo desde `/api/*`. Mantenemos el
 * paths sin versión como "v1 implícito" — todos los clientes actuales
 * (frontend Vercel, wallet apps, integraciones) siguen funcionando sin
 * cambios. Futuros endpoints v2 (breaking) vivirán en `/api/v2/*` y este
 * alias deja de aplicarse para esa versión.
 */
function v1AliasMiddleware(req: Request, _res: Response, next: NextFunction) {
  if (req.url.startsWith('/api/v1/')) {
    req.url = '/api' + req.url.slice('/api/v1'.length);
  } else if (req.url === '/api/v1') {
    req.url = '/api';
  }
  next();
}

/**
 * Basic auth gating para `/api/docs`. En prod, sin SWAGGER_USER/PASSWORD
 * seteados, retornamos 404 (Swagger no existe). Esto evita exponer la
 * superficie de API a scrapers/tooling automatizado.
 */
function swaggerBasicAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.path.startsWith('/api/docs')) return next();

  const expectedUser = process.env.SWAGGER_USER;
  const expectedPass = process.env.SWAGGER_PASSWORD;
  const isProd = process.env.NODE_ENV === 'production';

  if (isProd && (!expectedUser || !expectedPass)) {
    res.status(404).send('Not found');
    return;
  }
  if (!expectedUser || !expectedPass) return next(); // dev: open

  const header = req.headers.authorization ?? '';
  const match = /^Basic\s+(.+)$/i.exec(header);
  if (!match) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Clubify API Docs"');
    res.status(401).send('Authentication required');
    return;
  }
  const [user, pass] = Buffer.from(match[1], 'base64').toString().split(':');
  const userOk =
    user != null &&
    user.length === expectedUser.length &&
    timingSafeEqual(Buffer.from(user), Buffer.from(expectedUser));
  const passOk =
    pass != null &&
    pass.length === expectedPass.length &&
    timingSafeEqual(Buffer.from(pass), Buffer.from(expectedPass));
  if (userOk && passOk) return next();

  res.setHeader('WWW-Authenticate', 'Basic realm="Clubify API Docs"');
  res.status(401).send('Invalid credentials');
}

function setupSwagger(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('Clubify API')
    .setDescription(
      'API multi-tenant para fidelización + menú + pedidos + wallet. ' +
        'v1 implícito (no requiere prefijo). Próximas versiones breaking ' +
        'irán en /api/v2/*.',
    )
    .setVersion('1.0.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'JWT',
    )
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      docExpansion: 'none',
    },
  });
}

async function bootstrap() {
  // eslint-disable-next-line no-console
  console.log('[Boot] >>> NestFactory.create');
  const app = await NestFactory.create(AppModule, {
    // Desactivamos el body parser default de Nest (limit 100kb) y lo
    // reemplazamos abajo con un limit mayor. El editor de QR posters guarda
    // imágenes como base64 inline en el config → payloads de varios MB que
    // antes daban 413 "Request entity too large" en TODOS los QR (menú,
    // reseñas, infolink, descuento, mostrador). 15MB cubre el caso real
    // (Konva data URLs + imágenes de fondo) sin abrir a abuso.
    bodyParser: false,
    cors: {
      origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        return cb(null, isOriginAllowed(origin));
      },
      credentials: true,
    },
  });
  // verify stashea el RAW body en req.rawBody (Buffer) — Stripe lo necesita
  // para validar la firma del webhook (/webhooks/stripe/:slug). El parseo JSON
  // sigue normal para el resto de las rutas.
  app.use(
    json({
      limit: '15mb',
      verify: (req: any, _res, buf) => {
        if (buf && buf.length) req.rawBody = buf;
      },
    }),
  );
  app.use(urlencoded({ limit: '15mb', extended: true }));
  // CORP en 'cross-origin': este backend es una API consumida por múltiples
  // dominios de marca blanca (soyfidelity.com, selleala.com, dominios propios).
  // El default de helmet (Cross-Origin-Resource-Policy: same-origin) bloqueaba
  // la carga del favicon/icono de marca (/superadmin-public/white-labels/icon)
  // como subrecurso cross-origin → ERR_BLOCKED_BY_RESPONSE.NotSameOrigin en la
  // consola y favicon de marca caído. La protección de datos sensibles la dan
  // JWT + CORS (isOriginAllowed), no CORP.
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  // Compat versioning + Swagger gating se conectan ANTES del global prefix
  // porque tocan la URL en bruto del request.
  app.use(v1AliasMiddleware);
  app.use(swaggerBasicAuth);
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Sentry exception filter global. Solo reporta 5xx + non-HTTP errors;
  // 4xx (auth/validation/notfound) NO ensucian el dashboard.
  const httpAdapter = app.get(HttpAdapterHost);
  app.useGlobalFilters(new SentryExceptionFilter(httpAdapter.httpAdapter));

  setupSwagger(app);

  // Cargamos los dominios propios de marcas blancas para CORS antes de aceptar
  // tráfico, y los refrescamos cada 3 min (una marca nueva queda habilitada
  // sin redeploy).
  try {
    const prisma = app.get(PrismaService);
    await refreshBrandHosts(prisma);
    setInterval(() => void refreshBrandHosts(prisma), 3 * 60 * 1000);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[CORS] no se pudo inicializar brand hosts:', (e as Error)?.message);
  }

  // eslint-disable-next-line no-console
  console.log('[Boot] >>> NestFactory.create OK');
  const port = Number(process.env.PORT ?? 3001);
  // eslint-disable-next-line no-console
  console.log(`[Boot] >>> app.listen ${port}`);
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`[Boot] >>> listening OK`);
  Logger.log(`Clubify API listening on :${port}`, 'Bootstrap');
  if (process.env.NODE_ENV !== 'production' || process.env.SWAGGER_USER) {
    Logger.log(`Swagger docs: http://0.0.0.0:${port}/api/docs`, 'Bootstrap');
  }
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[Boot] FATAL:', err?.message ?? err);
  console.error(err?.stack ?? '');
  process.exit(1);
});
