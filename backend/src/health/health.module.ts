import { Controller, Get, HttpCode, HttpStatus, Module } from '@nestjs/common';
import { connect } from 'net';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../common/prisma/prisma.service';

const STARTED_AT = Date.now();
/**
 * Una conexión TCP contra un host: abre, mide y cierra. No manda ni lee nada,
 * así que sirve para pesar el camino de red sin autenticarse contra nada.
 */
function latenciaTcp(host: string, port: number, topeMs = 2000): Promise<number | null> {
  return new Promise((res) => {
    const t0 = Date.now();
    const s = connect(port, host, () => {
      s.destroy();
      res(Date.now() - t0);
    });
    s.on('error', () => res(null));
    s.setTimeout(topeMs, () => {
      s.destroy();
      res(null);
    });
  });
}

/** El host y el puerto de una URL de conexión, sin arrastrar la credencial. */
export function destinoDe(url: string | undefined): { host: string; port: number } | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (!u.hostname) return null;
    return { host: u.hostname, port: Number(u.port) || 5432 };
  } catch {
    return null;
  }
}

/**
 * Qué commit corre aquí.
 *
 * `RAILWAY_GIT_COMMIT_SHA` solo existe cuando Railway despliega desde su
 * integración con GitHub. Nosotros subimos un tarball con `railway up` desde un
 * clon local, así que esa variable NUNCA llegaba y `/health` contestaba
 * `commit: "dev"` desde siempre — sin forma de comprobar si un despliegue
 * entró, que es justo lo que más falta cuando algo «vuelve a estar roto».
 *
 * `scripts/desplegar.cjs` escribe el SHA en `build-info.json` dentro de la copia
 * limpia, y el Dockerfile lo mete en la imagen. Se lee UNA vez al arrancar: el
 * archivo no cambia en caliente y no hace falta tocar el disco en cada `curl`.
 *
 * `desconocido` significa algo concreto: esto no salió del script de despliegue.
 */
const COMMIT = (() => {
  try {
    const ruta = join(process.cwd(), 'build-info.json');
    const { commit } = JSON.parse(readFileSync(ruta, 'utf8')) as { commit?: string };
    if (commit && commit !== 'desconocido') return commit.slice(0, 7);
  } catch {
    // Sin archivo (desarrollo local, o una imagen vieja): se cae al env var.
  }
  return (process.env.RAILWAY_GIT_COMMIT_SHA ?? 'desconocido').slice(0, 7);
})();

@Controller('health')
class HealthController {
  constructor(private prisma: PrismaService) {}

  /** Liveness — siempre 200 si el proceso está vivo. Railway lo usa para reiniciar el container. */
  @Public()
  @Get()
  async health() {
    return {
      ok: true,
      ts: new Date().toISOString(),
      uptimeSec: Math.round((Date.now() - STARTED_AT) / 1000),
      version: process.env.npm_package_version ?? 'dev',
      // Qué commit corre: de un curl, sin abrir el panel. Ver COMMIT arriba.
      commit: COMMIT,
      env: process.env.NODE_ENV ?? 'development',
    };
  }

  /** Readiness — verifica que dependencias críticas (DB) respondan. */
  @Public()
  @Get('ready')
  @HttpCode(HttpStatus.OK)
  async ready() {
    const checks: Record<string, { ok: boolean; latencyMs?: number; error?: string }> = {};

    // Postgres
    const pgStart = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.postgres = { ok: true, latencyMs: Date.now() - pgStart };
    } catch (e: any) {
      checks.postgres = { ok: false, error: e?.message ?? String(e) };
    }

    // Redis (sólo si está configurado)
    if (process.env.REDIS_URL) {
      checks.redis = { ok: true }; // QueueService ya valida al boot, no quiero abrir conexión extra
    }

    // S3 (sólo si está configurado)
    if (process.env.S3_ENDPOINT) {
      checks.s3 = { ok: true };
    }

    const allOk = Object.values(checks).every((c) => c.ok);
    return {
      ok: allOk,
      ts: new Date().toISOString(),
      checks,
    };
  }

  /**
   * ¿Por dónde sale el backend hacia la base, y cuánto cuesta eso?
   *
   * Existe porque `DATABASE_URL` apuntaba al **proxy público** de Railway
   * (`tramway.proxy.rlwy.net`) en vez de a la red interna, y eso son ~140 ms
   * por consulta en lugar de 1-3. Con 2.700 consultas repartidas por el
   * backend no es un detalle: crear un pedido hace 14 y eran ~2 s de puro ir
   * y venir.
   *
   * Contesta dos cosas que antes había que adivinar: por dónde va HOY, y
   * cuánto se ganaría (o se ganó) yendo por dentro. Después de cambiar la
   * variable, `camino` debe decir `interna` y `ahorroPorConsultaMs` bajar a 0
   * porque ya no hay nada que ahorrar.
   *
   * NO devuelve nombres de host ni credenciales: solo por qué camino va y
   * cuánto tarda.
   */
  @Public()
  @Get('red')
  @HttpCode(HttpStatus.OK)
  async red() {
    const actual = destinoDe(process.env.DATABASE_URL);
    if (!actual) return { ok: false, error: 'DATABASE_URL no se puede leer' };

    const esInterna = actual.host.endsWith('.railway.internal');
    const msActual = await latenciaTcp(actual.host, actual.port);

    // Si ya va por dentro no hay nada que comparar. Si va por el proxy, se
    // pesa el camino interno para saber qué se está pagando de más. El host
    // interno se deduce del privado del mismo servicio, que Railway inyecta
    // como `PGHOST` cuando la base está enlazada.
    let msInterna: number | null = null;
    if (!esInterna) {
      const pgHost = process.env.PGHOST;
      if (pgHost && pgHost.endsWith('.railway.internal')) {
        msInterna = await latenciaTcp(pgHost, Number(process.env.PGPORT) || 5432);
      }
    }

    return {
      ok: true,
      ts: new Date().toISOString(),
      camino: esInterna ? 'interna' : 'proxy publico',
      latenciaActualMs: msActual,
      // null = no se pudo pesar el camino interno desde aquí; no se inventa.
      latenciaInternaMs: msInterna,
      ahorroPorConsultaMs: msActual !== null && msInterna !== null ? msActual - msInterna : null,
      // Lo que cuesta el peaje en los caminos que más se usan.
      costeEnCaminosCalientes:
        msActual === null
          ? null
          : {
              crearPedido14Consultas: Math.round(14 * msActual) + ' ms',
              altaEnTarjeta11Consultas: Math.round(11 * msActual) + ' ms',
              duplicarNegocio47Consultas: Math.round(47 * msActual) + ' ms',
            },
    };
  }}

@Module({ controllers: [HealthController] })
export class HealthModule {}
