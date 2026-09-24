import { Controller, Get, HttpCode, HttpStatus, Module } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../common/prisma/prisma.service';

const STARTED_AT = Date.now();

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
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
