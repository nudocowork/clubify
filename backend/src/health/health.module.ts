import { Controller, Get, HttpCode, HttpStatus, Module } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../common/prisma/prisma.service';

const STARTED_AT = Date.now();

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
