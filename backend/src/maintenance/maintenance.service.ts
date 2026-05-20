import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

/**
 * Maintenance Mode global. Guardamos 3 settings en la tabla `Setting`:
 *   maintenance.enabled  → "true" | "false"
 *   maintenance.message  → mensaje custom para mostrar al cliente
 *   maintenance.until    → ISO timestamp opcional del ETA
 *
 * Se chequea en CADA request via MaintenanceGuard. Para no martirizar
 * el DB con N requests/s, cacheamos el snapshot in-memory con TTL 30s.
 * Cuando el SUPER_ADMIN actualiza el flag, invalidamos el cache.
 *
 * Otros pods/instancias de Railway tendrán cache stale hasta 30s — es
 * aceptable porque el modo mantenimiento se programa con anticipación
 * (no es un kill switch instantáneo). Si necesitás corte INMEDIATO,
 * llamar `getStatus({ forceFresh: true })` desde el guard primero — pero
 * por default usamos el cache.
 */

export type MaintenanceStatus = {
  enabled: boolean;
  message: string | null;
  until: string | null; // ISO timestamp
};

const KEYS = {
  enabled: 'maintenance.enabled',
  message: 'maintenance.message',
  until: 'maintenance.until',
} as const;

const CACHE_TTL_MS = 30_000;

@Injectable()
export class MaintenanceService {
  constructor(private prisma: PrismaService) {}

  private cache: { value: MaintenanceStatus; expiresAt: number } | null =
    null;

  invalidate() {
    this.cache = null;
  }

  async getStatus(opts: { forceFresh?: boolean } = {}): Promise<MaintenanceStatus> {
    const now = Date.now();
    if (!opts.forceFresh && this.cache && this.cache.expiresAt > now) {
      return this.cache.value;
    }
    const rows = await this.prisma.setting.findMany({
      where: { key: { in: [KEYS.enabled, KEYS.message, KEYS.until] } },
      select: { key: true, value: true },
    });
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const value: MaintenanceStatus = {
      enabled: map.get(KEYS.enabled) === 'true',
      message: map.get(KEYS.message) || null,
      until: map.get(KEYS.until) || null,
    };
    this.cache = { value, expiresAt: now + CACHE_TTL_MS };
    return value;
  }

  async setStatus(patch: Partial<MaintenanceStatus>): Promise<MaintenanceStatus> {
    // Upsert sólo los campos que vinieron en el patch. Para "limpiar"
    // un mensaje/ETA hay que mandar null explícito.
    const ops: Promise<any>[] = [];
    if (patch.enabled !== undefined) {
      ops.push(
        this.prisma.setting.upsert({
          where: { key: KEYS.enabled },
          update: { value: patch.enabled ? 'true' : 'false' },
          create: { key: KEYS.enabled, value: patch.enabled ? 'true' : 'false' },
        }),
      );
    }
    if (patch.message !== undefined) {
      const v = (patch.message ?? '').trim();
      ops.push(
        this.prisma.setting.upsert({
          where: { key: KEYS.message },
          update: { value: v },
          create: { key: KEYS.message, value: v },
        }),
      );
    }
    if (patch.until !== undefined) {
      const v = (patch.until ?? '').trim();
      ops.push(
        this.prisma.setting.upsert({
          where: { key: KEYS.until },
          update: { value: v },
          create: { key: KEYS.until, value: v },
        }),
      );
    }
    await Promise.all(ops);
    this.invalidate();
    return this.getStatus({ forceFresh: true });
  }
}
