import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import { PrismaService } from '../common/prisma/prisma.service';

/**
 * Detecta el límite de memoria del contenedor (Railway, Docker, K8s)
 * leyendo el cgroup. Devuelve null si no hay límite definido (host nativo
 * o cgroupv1 con "no limit"). Se cachea entre llamadas — el limit no
 * cambia durante el lifetime del proceso.
 */
let _cachedContainerLimit: number | null | undefined;
function detectContainerMemoryLimit(): number | null {
  if (_cachedContainerLimit !== undefined) return _cachedContainerLimit;
  // cgroup v2 (modernos: Docker 20+, Railway, K8s)
  try {
    const v2 = fs.readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim();
    if (v2 && v2 !== 'max') {
      const n = parseInt(v2, 10);
      if (!isNaN(n) && n > 0 && n < 1e15) {
        _cachedContainerLimit = n;
        return n;
      }
    }
  } catch {
    // cgroupv2 no disponible, intentar v1
  }
  // cgroup v1 (legacy)
  try {
    const v1 = fs
      .readFileSync('/sys/fs/cgroup/memory/memory.limit_in_bytes', 'utf8')
      .trim();
    if (v1) {
      const n = parseInt(v1, 10);
      // 9223372036854771712 ≈ max int64 = "no limit". Skip.
      if (!isNaN(n) && n > 0 && n < 1e15) {
        _cachedContainerLimit = n;
        return n;
      }
    }
  } catch {
    // no cgroup data — bare metal o entorno sin containerización
  }
  _cachedContainerLimit = null;
  return null;
}

/**
 * Recolecta métricas de salud del sistema (DB, proceso, contadores de
 * negocio, estimación de storage). Solo lectura — no muta nada.
 *
 * Para evitar llamadas costosas a R2 (ListObjectsV2 sobre buckets grandes
 * puede ser lento), la "estimación de storage" se basa en cuántos campos
 * de URL apuntan a archivos en R2 (logos, imágenes de producto, etc) y
 * un tamaño promedio asumido por archivo.
 */
@Injectable()
export class SystemHealthService {
  // Tamaño promedio asumido por imagen subida (50 KB es típico para
  // imágenes ya procesadas/comprimidas).
  private readonly AVG_IMAGE_BYTES = 50 * 1024;

  constructor(private prisma: PrismaService) {}

  async snapshot() {
    const [dbSize, dbTables, counts, storage, jobsLag] = await Promise.all([
      this.dbTotalSize(),
      this.dbTopTables(),
      this.businessCounts(),
      this.storageEstimate(),
      this.jobsBacklog(),
    ]);

    const proc = this.processInfo();
    const indicators = this.computeIndicators({
      dbSizeBytes: dbSize.bytes,
      memoryHeapUsedBytes: proc.memory.heapUsed,
      memoryHeapTotalBytes: proc.memory.heapTotal,
      memoryRssBytes: proc.memory.rss,
      storageEstimateBytes: storage.estimateBytes,
      jobsLag,
    });

    return {
      generatedAt: new Date(),
      db: { ...dbSize, topTables: dbTables },
      process: proc,
      counts,
      storage,
      jobs: { backlog: jobsLag },
      indicators,
      recommendations: this.recommendations(indicators, counts, storage),
    };
  }

  // ---------------------------------------------------------------
  //                      DB metrics (Postgres)
  // ---------------------------------------------------------------

  private async dbTotalSize(): Promise<{ bytes: number; pretty: string }> {
    try {
      const rows = await this.prisma.$queryRawUnsafe<
        { size: bigint; pretty: string }[]
      >(
        `SELECT pg_database_size(current_database())::bigint AS size,
                pg_size_pretty(pg_database_size(current_database())) AS pretty`,
      );
      const r = rows[0];
      return { bytes: Number(r?.size ?? 0), pretty: r?.pretty ?? '0 B' };
    } catch {
      return { bytes: 0, pretty: '—' };
    }
  }

  private async dbTopTables() {
    try {
      const rows = await this.prisma.$queryRawUnsafe<
        { name: string; bytes: bigint; pretty: string; rows: bigint }[]
      >(
        `SELECT
           c.relname AS name,
           pg_total_relation_size(c.oid)::bigint AS bytes,
           pg_size_pretty(pg_total_relation_size(c.oid)) AS pretty,
           c.reltuples::bigint AS rows
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE c.relkind = 'r'
           AND n.nspname NOT IN ('pg_catalog','information_schema')
         ORDER BY pg_total_relation_size(c.oid) DESC
         LIMIT 12`,
      );
      return rows.map((r) => ({
        name: r.name,
        bytes: Number(r.bytes),
        pretty: r.pretty,
        rows: Number(r.rows),
      }));
    } catch {
      return [];
    }
  }

  // ---------------------------------------------------------------
  //                    Process / runtime metrics
  // ---------------------------------------------------------------

  private processInfo() {
    const mem = process.memoryUsage();
    return {
      uptimeSeconds: Math.round(process.uptime()),
      nodeVersion: process.version,
      memory: {
        rss: mem.rss,
        heapTotal: mem.heapTotal,
        heapUsed: mem.heapUsed,
        external: mem.external,
      },
      env: process.env.NODE_ENV ?? 'unknown',
    };
  }

  // ---------------------------------------------------------------
  //                     Business counters (proxy de carga)
  // ---------------------------------------------------------------

  private async businessCounts() {
    const last30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [
      tenants,
      tenantsActive,
      customers,
      products,
      orders30d,
      passes,
      stamps30d,
      audits30d,
    ] = await Promise.all([
      this.prisma.tenant.count(),
      this.prisma.tenant.count({ where: { status: 'ACTIVE' } }),
      this.prisma.customer.count(),
      this.prisma.product.count(),
      this.prisma.order.count({ where: { createdAt: { gte: last30 } } }),
      this.prisma.pass.count(),
      this.prisma.stamp.count({ where: { createdAt: { gte: last30 } } }),
      this.prisma.auditLog.count({ where: { createdAt: { gte: last30 } } }),
    ]);
    return {
      tenants,
      tenantsActive,
      customers,
      products,
      orders30d,
      passes,
      stamps30d,
      audits30d,
    };
  }

  // ---------------------------------------------------------------
  //              R2 storage estimation (sin ListObjects)
  // ---------------------------------------------------------------

  private async storageEstimate() {
    // Contamos referencias no-null a R2 en los modelos donde subimos imágenes.
    const [
      tenantLogos,
      productImages,
      promotionImages,
      categoryImages,
      storefrontHero,
      cardLogos,
      cardHeroes,
      cardIcons,
      infoLinkHero,
    ] = await Promise.all([
      this.prisma.tenant.count({ where: { logoUrl: { not: null } } }),
      this.prisma.product.count({ where: { imageUrl: { not: null } } }),
      this.prisma.promotion.count({ where: { imageUrl: { not: null } } }),
      this.prisma.category.count({ where: { imageUrl: { not: null } } }),
      this.prisma.storefront.count({ where: { heroImageUrl: { not: null } } }),
      this.prisma.card.count({ where: { logoUrl: { not: null } } }),
      this.prisma.card.count({ where: { heroImageUrl: { not: null } } }),
      this.prisma.card.count({ where: { iconUrl: { not: null } } }),
      this.prisma.infoLink.count({ where: { heroImageUrl: { not: null } } }),
    ]);

    const fileCount =
      tenantLogos +
      productImages +
      promotionImages +
      categoryImages +
      storefrontHero +
      cardLogos +
      cardHeroes +
      cardIcons +
      infoLinkHero;

    const estimateBytes = fileCount * this.AVG_IMAGE_BYTES;
    return {
      provider: 'Cloudflare R2',
      bucket: process.env.S3_BUCKET ?? '—',
      fileCount,
      avgBytesPerFile: this.AVG_IMAGE_BYTES,
      estimateBytes,
      estimatePretty: prettyBytes(estimateBytes),
      breakdown: {
        tenantLogos,
        productImages,
        promotionImages,
        categoryImages,
        storefrontHero,
        cardLogos,
        cardHeroes,
        cardIcons,
        infoLinkHero,
      },
    };
  }

  // ---------------------------------------------------------------
  //                    Jobs queue backlog (BullMQ)
  // ---------------------------------------------------------------

  private async jobsBacklog() {
    // Notificaciones agendadas que aún no se enviaron (sentAt = null).
    try {
      return await this.prisma.notification.count({ where: { sentAt: null } });
    } catch {
      return 0;
    }
  }

  // ---------------------------------------------------------------
  //               Indicadores con thresholds (semáforo)
  // ---------------------------------------------------------------

  private computeIndicators(d: {
    dbSizeBytes: number;
    memoryHeapUsedBytes: number;
    memoryHeapTotalBytes: number;
    memoryRssBytes: number;
    storageEstimateBytes: number;
    jobsLag: number;
  }) {
    // Umbrales asumidos (Railway Postgres Hobby ~ 1GB; Pro 8GB+).
    // Para Clubify estamos en plan Pro Railway, ~8 GB de DB plan.
    const DB_LIMIT_BYTES = 8 * 1024 * 1024 * 1024; // 8 GB
    // R2 plan free es 10 GB; pago muy barato, asumimos 100 GB de cómodo.
    const STORAGE_BUDGET_BYTES = 10 * 1024 * 1024 * 1024;

    const dbPct = (d.dbSizeBytes / DB_LIMIT_BYTES) * 100;
    const storagePct = (d.storageEstimateBytes / STORAGE_BUDGET_BYTES) * 100;

    // Memoria: la métrica útil es RSS / container_limit (lo que predice
    // un OOM real). Antes usábamos heapUsed/heapTotal que en Node sano
    // siempre está cerca del 95% antes del GC — falsos positivos
    // crónicos. Si no podemos detectar container_limit (entorno bare
    // metal / dev), fallback a `null` y no marcamos alarma.
    const containerLimit = detectContainerMemoryLimit();
    const memPct =
      containerLimit && containerLimit > 0
        ? (d.memoryRssBytes / containerLimit) * 100
        : 0;

    return {
      database: {
        usedBytes: d.dbSizeBytes,
        limitBytes: DB_LIMIT_BYTES,
        percent: round1(dbPct),
        level: levelFor(dbPct, 70, 90),
      },
      memory: {
        // Reportamos RSS (uso real del proceso, lo que Railway mide para
        // OOM-kill). heapUsed/heapTotal quedan disponibles en
        // `process.memory` para diagnóstico, pero NO se usan para el
        // semáforo principal.
        usedBytes: d.memoryRssBytes,
        limitBytes: containerLimit ?? 0,
        percent: round1(memPct),
        // Sin container_limit, no podemos saber si está al límite: nivel
        // 'ok' por default. Con limit: warn >70%, crit >90%.
        level: containerLimit ? levelFor(memPct, 70, 90) : 'ok',
      },
      storage: {
        usedBytes: d.storageEstimateBytes,
        limitBytes: STORAGE_BUDGET_BYTES,
        percent: round1(storagePct),
        level: levelFor(storagePct, 70, 90),
      },
      jobs: {
        backlog: d.jobsLag,
        level: levelFor(d.jobsLag, 50, 200),
      },
    };
  }

  private recommendations(
    ind: ReturnType<SystemHealthService['computeIndicators']>,
    counts: { tenants: number; orders30d: number },
    storage: { fileCount: number },
  ) {
    const recs: { level: 'info' | 'warn' | 'crit'; text: string }[] = [];

    if (ind.database.level === 'crit') {
      recs.push({
        level: 'crit',
        text:
          'Base de datos sobre 90% — escala el plan Postgres en Railway o purga audit logs viejos.',
      });
    } else if (ind.database.level === 'warn') {
      recs.push({
        level: 'warn',
        text:
          'Base de datos sobre 70% — considera archivar AuditLog/Notification antiguos.',
      });
    }

    if (ind.storage.level === 'crit') {
      recs.push({
        level: 'crit',
        text: 'Storage estimado >90% del presupuesto — sube el plan R2 o limpia imágenes huérfanas.',
      });
    } else if (ind.storage.level === 'warn') {
      recs.push({
        level: 'warn',
        text: 'Storage al 70% del presupuesto — proyecta crecimiento del próximo trimestre.',
      });
    }

    if (ind.memory.level === 'crit') {
      recs.push({
        level: 'crit',
        text:
          'RSS del proceso sobre 90% del límite del contenedor — riesgo real de OOM-kill. Subí RAM/replicas en Railway.',
      });
    } else if (ind.memory.level === 'warn') {
      recs.push({
        level: 'warn',
        text:
          'RSS del proceso sobre 70% del límite del contenedor — monitorea crecimiento; si sube y no baja tras GC puede haber memory leak.',
      });
    }

    if (ind.jobs.level === 'crit') {
      recs.push({
        level: 'crit',
        text: `Cola de notificaciones con ${ind.jobs.backlog} pendientes — verifica el worker.`,
      });
    }

    if (counts.tenants > 0 && counts.orders30d / counts.tenants > 1000) {
      recs.push({
        level: 'info',
        text: 'Volumen de pedidos por tenant alto — considera índices adicionales en Order(tenantId, createdAt).',
      });
    }

    if (storage.fileCount > 0 && recs.length === 0) {
      recs.push({
        level: 'info',
        text: 'Sistema saludable. Sin acciones requeridas en este momento.',
      });
    }

    return recs;
  }
}

// =================================================================
//                          helpers
// =================================================================

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

function levelFor(value: number, warnAt: number, critAt: number): 'ok' | 'warn' | 'crit' {
  if (value >= critAt) return 'crit';
  if (value >= warnAt) return 'warn';
  return 'ok';
}

function prettyBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let n = bytes / 1024;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 ? 2 : 1)} ${units[i]}`;
}
