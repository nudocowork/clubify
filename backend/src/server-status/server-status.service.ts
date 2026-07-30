import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as fs from 'fs';
import { PrismaService } from '../common/prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { RailwayMetricsService } from './railway-metrics.service';

/**
 * Centro de monitoreo de infraestructura ("Estado del Servidor" en
 * /superadmin). SOLO LECTURA sobre catálogos de Postgres + process + Railway
 * API. Nada acá muta datos de negocio. Diseño: todo lo medible desde Postgres
 * es REAL; lo que solo Railway sabe (capacidad de volumen, CPU) viene de la
 * Railway API y degrada limpio si falta el token — nunca se inventan números.
 */

const GB = 1024 * 1024 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;

// Capacidad por defecto de la BD si no hay Railway API ni Setting manual.
// Etiquetada "estimado" en el panel — plan Pro Railway ~ 8 GB.
const DEFAULT_DB_LIMIT_BYTES = 8 * GB;

// ---- config keys (Setting) -------------------------------------------------
const K = {
  dbLimitBytes: 'server.status.dbLimitBytes',
  alertEmail: 'server.status.alertEmail',
  lastAlertLevel: 'server.status.lastAlertLevel',
};

let _cachedContainerLimit: number | null | undefined;
function detectContainerMemoryLimit(): number | null {
  if (_cachedContainerLimit !== undefined) return _cachedContainerLimit;
  try {
    const v2 = fs.readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim();
    if (v2 && v2 !== 'max') {
      const n = parseInt(v2, 10);
      if (!isNaN(n) && n > 0 && n < 1e15) return (_cachedContainerLimit = n);
    }
  } catch {
    /* cgroup v2 no disponible */
  }
  try {
    const v1 = fs
      .readFileSync('/sys/fs/cgroup/memory/memory.limit_in_bytes', 'utf8')
      .trim();
    if (v1) {
      const n = parseInt(v1, 10);
      if (!isNaN(n) && n > 0 && n < 1e15) return (_cachedContainerLimit = n);
    }
  } catch {
    /* sin cgroup */
  }
  return (_cachedContainerLimit = null);
}

type Level = 'ok' | 'warn' | 'high' | 'crit' | 'emergency';

@Injectable()
export class ServerStatusService {
  private readonly logger = new Logger(ServerStatusService.name);

  constructor(
    private prisma: PrismaService,
    private railway: RailwayMetricsService,
    private email: EmailService,
  ) {}

  // =========================================================================
  //                              OVERVIEW
  // =========================================================================

  async overview() {
    const [dbSize, conns, maint, growthRaw, storage, railwayVol, railwayMetrics] =
      await Promise.all([
        this.dbTotalSize(),
        this.connections(),
        this.maintenanceAges(),
        this.growth(),
        this.storageEstimate(),
        this.railway.postgresVolume(),
        this.railway.serviceMetrics(process.env.RAILWAY_SERVICE_ID),
      ]);

    const capacity = await this.resolveCapacity(dbSize.bytes, railwayVol);
    const memory = this.memoryInfo(railwayMetrics);
    const cpu = this.cpuInfo(railwayMetrics);

    const dbPct = capacity.limitBytes
      ? (capacity.usedBytes / capacity.limitBytes) * 100
      : 0;
    const dbLevel = capacityLevel(dbPct);

    // Proyección re-anclada a la capacidad resuelta (Railway o Setting).
    const projection = this.project(growthRaw, capacity.usedBytes, capacity.limitBytes);

    const semaforo = this.semaforo(dbLevel.level, memory.level, conns.level);

    const alerts = this.buildAlerts({ dbPct, dbLevel, memory, conns, projection });
    const recommendations = this.recommendations({ dbLevel, memory, projection, storage });

    return {
      generatedAt: new Date().toISOString(),
      semaforo,
      database: {
        usedBytes: capacity.usedBytes,
        usedPretty: prettyBytes(capacity.usedBytes),
        logicalSizeBytes: dbSize.bytes, // pg_database_size (siempre real)
        logicalSizePretty: dbSize.pretty,
        limitBytes: capacity.limitBytes,
        limitPretty: capacity.limitBytes ? prettyBytes(capacity.limitBytes) : null,
        availableBytes: capacity.limitBytes
          ? Math.max(0, capacity.limitBytes - capacity.usedBytes)
          : null,
        percent: round1(dbPct),
        level: dbLevel.level,
        levelLabel: dbLevel.label,
        capacitySource: capacity.source, // 'railway' | 'manual' | 'estimado'
      },
      memory,
      cpu,
      connections: conns,
      storage,
      maintenance: maint,
      growth: {
        samples: growthRaw.samples,
        perDayBytes: growthRaw.perDayBytes,
        perDayPretty: growthRaw.perDayBytes != null ? prettyBytes(growthRaw.perDayBytes) : null,
        perWeekBytes: growthRaw.perWeekBytes,
        perMonthBytes: growthRaw.perMonthBytes,
      },
      projection,
      alerts,
      recommendations,
      railway: {
        ...this.railway.configState(),
        volumeAvailable: railwayVol.available,
        metricsAvailable: railwayMetrics.available,
        note: this.railway.isConfigured()
          ? undefined
          : 'Sin RAILWAY_API_TOKEN: capacidad y CPU son estimadas/configurables. Setéalo para datos reales.',
      },
      uptime: {
        backendSeconds: Math.round(process.uptime()),
        nodeVersion: process.version,
        env: process.env.NODE_ENV ?? 'unknown',
      },
    };
  }

  // =========================================================================
  //                         POSTGRES METRICS (reales)
  // =========================================================================

  private async dbTotalSize(): Promise<{ bytes: number; pretty: string }> {
    try {
      const rows = await this.prisma.$queryRawUnsafe<{ size: bigint; pretty: string }[]>(
        `SELECT pg_database_size(current_database())::bigint AS size,
                pg_size_pretty(pg_database_size(current_database())) AS pretty`,
      );
      return { bytes: Number(rows[0]?.size ?? 0), pretty: rows[0]?.pretty ?? '0 B' };
    } catch {
      return { bytes: 0, pretty: '—' };
    }
  }

  async tables() {
    const [top, totals] = await Promise.all([this.topTables(), this.storageTotals()]);
    return { tables: top, totals };
  }

  private async topTables() {
    try {
      const rows = await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT
           c.relname AS name,
           n.nspname AS schema,
           pg_total_relation_size(c.oid)::bigint AS total_bytes,
           pg_table_size(c.oid)::bigint AS data_bytes,
           pg_indexes_size(c.oid)::bigint AS index_bytes,
           c.reltuples::bigint AS est_rows,
           COALESCE(s.n_live_tup, 0)::bigint AS live_rows,
           GREATEST(s.last_vacuum, s.last_autovacuum) AS last_vacuum,
           GREATEST(s.last_analyze, s.last_autoanalyze) AS last_analyze
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
         WHERE c.relkind = 'r'
           AND n.nspname NOT IN ('pg_catalog','information_schema')
         ORDER BY pg_total_relation_size(c.oid) DESC
         LIMIT 20`,
      );
      return rows.map((r) => ({
        name: r.name,
        schema: r.schema,
        totalBytes: Number(r.total_bytes),
        totalPretty: prettyBytes(Number(r.total_bytes)),
        dataBytes: Number(r.data_bytes),
        indexBytes: Number(r.index_bytes),
        indexPretty: prettyBytes(Number(r.index_bytes)),
        rows: Number(r.live_rows) || Number(r.est_rows),
        lastVacuum: r.last_vacuum ? new Date(r.last_vacuum).toISOString() : null,
        lastAnalyze: r.last_analyze ? new Date(r.last_analyze).toISOString() : null,
      }));
    } catch (e: any) {
      this.logger.warn(`topTables failed: ${e?.message}`);
      return [];
    }
  }

  private async storageTotals() {
    try {
      const rows = await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT
           COUNT(*)::int AS table_count,
           COALESCE(SUM(pg_table_size(c.oid)),0)::bigint AS table_bytes,
           COALESCE(SUM(pg_indexes_size(c.oid)),0)::bigint AS index_bytes
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE c.relkind = 'r' AND n.nspname = 'public'`,
      );
      const r = rows[0] ?? {};
      return {
        tableCount: Number(r.table_count ?? 0),
        tableBytes: Number(r.table_bytes ?? 0),
        tablePretty: prettyBytes(Number(r.table_bytes ?? 0)),
        indexBytes: Number(r.index_bytes ?? 0),
        indexPretty: prettyBytes(Number(r.index_bytes ?? 0)),
      };
    } catch {
      return { tableCount: 0, tableBytes: 0, tablePretty: '—', indexBytes: 0, indexPretty: '—' };
    }
  }

  private async connections() {
    try {
      const rows = await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT
           (SELECT COUNT(*) FROM pg_stat_activity WHERE datname = current_database())::int AS active,
           (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') AS max`,
      );
      const active = Number(rows[0]?.active ?? 0);
      const max = Number(rows[0]?.max ?? 0);
      const pct = max ? (active / max) * 100 : 0;
      return {
        active,
        max,
        percent: round1(pct),
        level: (pct >= 90 ? 'crit' : pct >= 70 ? 'warn' : 'ok') as 'ok' | 'warn' | 'crit',
      };
    } catch {
      return { active: 0, max: 0, percent: 0, level: 'ok' as const };
    }
  }

  private async maintenanceAges() {
    try {
      const rows = await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT
           MAX(GREATEST(last_vacuum, last_autovacuum))   AS last_vacuum,
           MAX(GREATEST(last_analyze, last_autoanalyze)) AS last_analyze
         FROM pg_stat_user_tables`,
      );
      const r = rows[0] ?? {};
      return {
        lastVacuum: r.last_vacuum ? new Date(r.last_vacuum).toISOString() : null,
        lastAnalyze: r.last_analyze ? new Date(r.last_analyze).toISOString() : null,
      };
    } catch {
      return { lastVacuum: null, lastAnalyze: null };
    }
  }

  /** Consultas lentas — solo si la extensión pg_stat_statements está activa. */
  async slowQueries() {
    try {
      const ext = await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements' LIMIT 1`,
      );
      if (!ext.length) {
        return {
          available: false,
          reason:
            'La extensión pg_stat_statements no está activa en esta base. Actívala en Railway para ver consultas lentas.',
          queries: [],
        };
      }
      const rows = await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT LEFT(query, 200) AS query,
                calls::bigint AS calls,
                ROUND(mean_exec_time::numeric, 1) AS mean_ms,
                ROUND(total_exec_time::numeric, 1) AS total_ms
         FROM pg_stat_statements
         WHERE query NOT ILIKE '%pg_stat_statements%'
         ORDER BY mean_exec_time DESC
         LIMIT 15`,
      );
      return {
        available: true,
        queries: rows.map((r) => ({
          query: r.query,
          calls: Number(r.calls),
          meanMs: Number(r.mean_ms),
          totalMs: Number(r.total_ms),
        })),
      };
    } catch (e: any) {
      return { available: false, reason: e?.message ?? 'error', queries: [] };
    }
  }

  // =========================================================================
  //                     DETECCIÓN DE DATOS PESADOS
  // =========================================================================

  /**
   * Heurística barata sobre pg_stats: columnas con avg_width alto = probable
   * base64 / blobs / payloads / imágenes guardadas dentro de Postgres.
   */
  async heavyData() {
    try {
      const rows = await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT s.schemaname AS schema,
                s.tablename  AS "table",
                s.attname    AS "column",
                s.avg_width  AS avg_width,
                t.typname    AS type
         FROM pg_stats s
         JOIN pg_class c   ON c.relname = s.tablename
         JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = s.schemaname
         JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = s.attname
         JOIN pg_type t     ON t.oid = a.atttypid
         WHERE s.schemaname = 'public'
           AND s.avg_width > 500
         ORDER BY s.avg_width DESC
         LIMIT 30`,
      );
      const findings = rows.map((r) => {
        const w = Number(r.avg_width);
        const suspect =
          w > 2000 ||
          r.type === 'bytea' ||
          /image|logo|photo|avatar|payload|base64|file|attachment|pdf|audio|video/i.test(
            r.column,
          );
        return {
          schema: r.schema,
          table: r.table,
          column: r.column,
          type: r.type,
          avgWidthBytes: w,
          avgWidthPretty: prettyBytes(w),
          suspect,
        };
      });
      return {
        available: true,
        findings,
        hasSuspects: findings.some((f) => f.suspect),
        note:
          'Ancho promedio por fila. Columnas anchas (base64/bytea/payloads) conviene moverlas a object storage (R2/S3). No se elimina nada automáticamente.',
      };
    } catch (e: any) {
      return { available: false, reason: e?.message ?? 'error', findings: [], hasSuspects: false };
    }
  }

  // =========================================================================
  //                     CONSUMO POR MARCA BLANCA
  // =========================================================================

  async perBrand() {
    const brands = await this.prisma.whiteLabel.findMany({
      select: {
        id: true,
        name: true,
        slug: true,
        primaryColor: true,
        status: true,
        creditsAvailable: true,
        creditsUnlimited: true,
      },
    });
    const byId = new Map(brands.map((b) => [b.id, b]));

    // Conteos agrupados por marca vía join Tenant. count(*) es exacto; es un
    // endpoint de admin, no hot-path.
    const tables = [
      { key: 'businesses', sql: `SELECT "whiteLabelId" AS wl, COUNT(*)::bigint AS n FROM "Tenant" GROUP BY "whiteLabelId"` },
      { key: 'customers', sql: `SELECT t."whiteLabelId" AS wl, COUNT(*)::bigint AS n FROM "Customer" x JOIN "Tenant" t ON t.id = x."tenantId" GROUP BY t."whiteLabelId"` },
      { key: 'orders', sql: `SELECT t."whiteLabelId" AS wl, COUNT(*)::bigint AS n FROM "Order" x JOIN "Tenant" t ON t.id = x."tenantId" GROUP BY t."whiteLabelId"` },
      { key: 'stamps', sql: `SELECT t."whiteLabelId" AS wl, COUNT(*)::bigint AS n FROM "Stamp" x JOIN "Tenant" t ON t.id = x."tenantId" GROUP BY t."whiteLabelId"` },
      { key: 'passes', sql: `SELECT t."whiteLabelId" AS wl, COUNT(*)::bigint AS n FROM "Pass" x JOIN "Tenant" t ON t.id = x."tenantId" GROUP BY t."whiteLabelId"` },
      { key: 'notifications', sql: `SELECT t."whiteLabelId" AS wl, COUNT(*)::bigint AS n FROM "Notification" x JOIN "Tenant" t ON t.id = x."tenantId" GROUP BY t."whiteLabelId"` },
      { key: 'products', sql: `SELECT t."whiteLabelId" AS wl, COUNT(*)::bigint AS n FROM "Product" x JOIN "Tenant" t ON t.id = x."tenantId" GROUP BY t."whiteLabelId"` },
    ] as const;

    const results = await Promise.all(
      tables.map(async (t) => {
        try {
          const rows = await this.prisma.$queryRawUnsafe<{ wl: string | null; n: bigint }[]>(t.sql);
          return { key: t.key, rows };
        } catch {
          return { key: t.key, rows: [] as { wl: string | null; n: bigint }[] };
        }
      }),
    );

    // Acumulamos por marca (null → bucket "Sin marca").
    type BrandCounts = {
      businesses: number;
      customers: number;
      orders: number;
      stamps: number;
      passes: number;
      notifications: number;
      products: number;
      rowsTotal: number;
    };
    const acc = new Map<string, BrandCounts>();
    const ensure = (id: string): BrandCounts => {
      if (!acc.has(id)) {
        acc.set(id, { businesses: 0, customers: 0, orders: 0, stamps: 0, passes: 0, notifications: 0, products: 0, rowsTotal: 0 });
      }
      return acc.get(id)!;
    };
    for (const { key, rows } of results) {
      for (const r of rows) {
        const id = r.wl ?? '__none__';
        const rec = ensure(id);
        const n = Number(r.n);
        (rec as any)[key] = n;
        // rowsTotal excluye "businesses" (cuenta de tenants, no de filas de datos).
        if (key !== 'businesses') rec.rowsTotal += n;
      }
    }

    const grandRows = [...acc.values()].reduce((s, r) => s + r.rowsTotal, 0);
    const dbSize = await this.dbTotalSize();

    const out = [...acc.entries()]
      .map(([id, rec]) => {
        const b = id === '__none__' ? null : byId.get(id);
        const share = grandRows > 0 ? rec.rowsTotal / grandRows : 0;
        return {
          id,
          name: b?.name ?? (id === '__none__' ? 'Sin marca asignada' : 'Marca desconocida'),
          slug: b?.slug ?? null,
          primaryColor: b?.primaryColor ?? '#9aa4af',
          status: b?.status ?? null,
          creditsAvailable: b?.creditsAvailable ?? null,
          creditsUnlimited: b?.creditsUnlimited ?? false,
          ...rec,
          sharePct: round1(share * 100),
          estBytes: Math.round(share * dbSize.bytes),
          estPretty: prettyBytes(Math.round(share * dbSize.bytes)),
        };
      })
      .sort((a, b) => b.rowsTotal - a.rowsTotal);

    return {
      brands: out,
      grandRows,
      dbSizeBytes: dbSize.bytes,
      note:
        'El uso de BD por marca es una ESTIMACIÓN (proporción de filas sobre el total × tamaño de la base). Los conteos de registros sí son exactos.',
    };
  }

  // =========================================================================
  //                    SALUD DE SERVICIOS (pings activos)
  // =========================================================================

  async services() {
    const frontendUrl = process.env.FRONTEND_URL || 'https://soyclubify.com';
    const httpTargets: { key: string; name: string; url: string }[] = [
      { key: 'frontend', name: 'Frontend (Vercel)', url: frontendUrl },
      { key: 'stripe', name: 'Stripe', url: 'https://api.stripe.com' },
      { key: 'hotmart', name: 'Hotmart', url: 'https://api-sec-vlc.hotmart.com' },
      { key: 'maps', name: 'Google Maps', url: 'https://maps.googleapis.com/maps/api/js' },
      { key: 'apple-wallet', name: 'Apple (APNs)', url: 'https://api.push.apple.com' },
      { key: 'google-wallet', name: 'Google Wallet', url: 'https://walletobjects.googleapis.com' },
      { key: 'email', name: 'Email (Resend)', url: 'https://api.resend.com' },
      { key: 'sms', name: 'SMS (Grow Business)', url: 'https://services.leadconnectorhq.com' },
    ];

    const [db, ...https] = await Promise.all([
      this.pingDb(),
      ...httpTargets.map((t) => this.pingHttp(t)),
    ]);

    const backend = {
      key: 'backend',
      name: 'Backend / API',
      status: 'operativo' as const,
      latencyMs: 0,
      detail: `uptime ${Math.round(process.uptime())}s`,
    };

    return {
      services: [backend, db, ...https],
      note:
        'Los pings miden ALCANZABILIDAD desde el contenedor (DNS+TCP+HTTP). Un 401/403/404 cuenta como "operativo" (el servicio responde). Error de red o timeout = caído.',
    };
  }

  private async pingDb() {
    const t0 = Date.now();
    try {
      await this.prisma.$queryRawUnsafe(`SELECT 1`);
      return { key: 'postgres', name: 'PostgreSQL', status: 'operativo' as const, latencyMs: Date.now() - t0, detail: null as string | null };
    } catch (e: any) {
      return { key: 'postgres', name: 'PostgreSQL', status: 'caido' as const, latencyMs: Date.now() - t0, detail: e?.message ?? 'error' };
    }
  }

  private async pingHttp(t: { key: string; name: string; url: string }) {
    const t0 = Date.now();
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(t.url, { method: 'GET', signal: ctrl.signal, redirect: 'manual' });
      clearTimeout(to);
      const ms = Date.now() - t0;
      // Cualquier respuesta HTTP = alcanzable. >1500ms = lento.
      return {
        key: t.key,
        name: t.name,
        status: (ms > 1500 ? 'lento' : 'operativo') as 'operativo' | 'lento',
        latencyMs: ms,
        detail: `HTTP ${res.status}`,
      };
    } catch (e: any) {
      return {
        key: t.key,
        name: t.name,
        status: 'caido' as const,
        latencyMs: Date.now() - t0,
        detail: e?.name === 'AbortError' ? 'timeout' : (e?.message ?? 'error'),
      };
    }
  }

  // =========================================================================
  //                  CRECIMIENTO + PROYECCIÓN (desde snapshots)
  // =========================================================================

  private async growth() {
    let snaps: { dbSizeBytes: bigint; createdAt: Date }[] = [];
    try {
      snaps = await this.prisma.serverMetricSnapshot.findMany({
        orderBy: { createdAt: 'asc' },
        take: 120,
        select: { dbSizeBytes: true, createdAt: true },
      });
    } catch {
      snaps = [];
    }
    if (snaps.length < 2) {
      return { samples: snaps.length, perDayBytes: null, perWeekBytes: null, perMonthBytes: null };
    }
    const first = snaps[0];
    const last = snaps[snaps.length - 1];
    const days = Math.max(
      1 / 24,
      (last.createdAt.getTime() - first.createdAt.getTime()) / DAY_MS,
    );
    const delta = Number(last.dbSizeBytes) - Number(first.dbSizeBytes);
    const perDay = delta / days;
    return {
      samples: snaps.length,
      perDayBytes: Math.round(perDay),
      perWeekBytes: Math.round(perDay * 7),
      perMonthBytes: Math.round(perDay * 30),
    };
  }

  private project(
    growth: { samples: number; perDayBytes: number | null },
    usedBytes: number,
    limitBytes: number | null,
  ) {
    if (growth.samples < 2 || growth.perDayBytes == null) {
      return {
        status: 'collecting' as const,
        message:
          growth.samples < 2
            ? 'Recolectando datos: la proyección aparece tras 2+ snapshots diarios.'
            : 'Sin datos suficientes.',
        daysTo90: null,
        daysTo100: null,
        fullDate: null,
      };
    }
    if (!limitBytes) {
      return { status: 'no-capacity' as const, message: 'Falta capacidad configurada.', daysTo90: null, daysTo100: null, fullDate: null };
    }
    if (growth.perDayBytes <= 0) {
      return { status: 'stable' as const, message: 'Sin crecimiento neto — estable o decreciendo.', daysTo90: null, daysTo100: null, fullDate: null };
    }
    const to90 = (0.9 * limitBytes - usedBytes) / growth.perDayBytes;
    const to100 = (limitBytes - usedBytes) / growth.perDayBytes;
    const fullDate = to100 > 0 ? new Date(Date.now() + to100 * DAY_MS).toISOString() : null;
    return {
      status: 'ok' as const,
      message: null as string | null,
      daysTo90: to90 > 0 ? Math.round(to90) : 0,
      daysTo100: to100 > 0 ? Math.round(to100) : 0,
      fullDate,
    };
  }

  // =========================================================================
  //                     STORAGE (estimación R2) — igual que system-health
  // =========================================================================

  private async storageEstimate() {
    const AVG = 50 * 1024;
    try {
      const [logos, products, promos, cats, heroes, cardLogos] = await Promise.all([
        this.prisma.tenant.count({ where: { logoUrl: { not: null } } }),
        this.prisma.product.count({ where: { imageUrl: { not: null } } }),
        this.prisma.promotion.count({ where: { imageUrl: { not: null } } }),
        this.prisma.category.count({ where: { imageUrl: { not: null } } }),
        this.prisma.storefront.count({ where: { heroImageUrl: { not: null } } }),
        this.prisma.card.count({ where: { logoUrl: { not: null } } }),
      ]);
      const fileCount = logos + products + promos + cats + heroes + cardLogos;
      const bytes = fileCount * AVG;
      return {
        provider: 'Cloudflare R2',
        fileCount,
        estimateBytes: bytes,
        estimatePretty: prettyBytes(bytes),
        note: 'Estimado (nº de archivos × 50 KB prom). Para bytes exactos hace falta el API de R2.',
      };
    } catch {
      return { provider: 'Cloudflare R2', fileCount: 0, estimateBytes: 0, estimatePretty: '—', note: 'estimado' };
    }
  }

  // =========================================================================
  //                        capacity / memory / cpu
  // =========================================================================

  private async resolveCapacity(
    logicalBytes: number,
    railwayVol: Awaited<ReturnType<RailwayMetricsService['postgresVolume']>>,
  ): Promise<{ usedBytes: number; limitBytes: number | null; source: string }> {
    // 1) Railway API (real): disco usado + capacidad del volumen.
    if (railwayVol.available && railwayVol.capacityBytes) {
      return {
        usedBytes: railwayVol.usedBytes ?? logicalBytes,
        limitBytes: railwayVol.capacityBytes,
        source: 'railway',
      };
    }
    // 2) Setting manual (lo setea el super admin con el valor real de su plan).
    const manual = await this.getSettingNumber(K.dbLimitBytes);
    if (manual && manual > 0) {
      return { usedBytes: logicalBytes, limitBytes: manual, source: 'manual' };
    }
    // 3) Default estimado.
    return { usedBytes: logicalBytes, limitBytes: DEFAULT_DB_LIMIT_BYTES, source: 'estimado' };
  }

  private memoryInfo(
    railwayMetrics: Awaited<ReturnType<RailwayMetricsService['serviceMetrics']>>,
  ) {
    const rss = process.memoryUsage().rss;
    const cgroupLimit = detectContainerMemoryLimit();
    // Preferimos el uso reportado por Railway si existe; si no, RSS del proceso.
    const usedBytes =
      railwayMetrics.available && railwayMetrics.memoryBytes != null
        ? railwayMetrics.memoryBytes
        : rss;
    const limitBytes = cgroupLimit ?? null;
    const pct = limitBytes ? (usedBytes / limitBytes) * 100 : 0;
    return {
      usedBytes,
      usedPretty: prettyBytes(usedBytes),
      rssBytes: rss,
      limitBytes,
      limitPretty: limitBytes ? prettyBytes(limitBytes) : null,
      percent: round1(pct),
      level: (limitBytes ? (pct >= 90 ? 'crit' : pct >= 70 ? 'warn' : 'ok') : 'ok') as 'ok' | 'warn' | 'crit',
      source: railwayMetrics.available && railwayMetrics.memoryBytes != null ? 'railway' : 'cgroup',
    };
  }

  private cpuInfo(
    railwayMetrics: Awaited<ReturnType<RailwayMetricsService['serviceMetrics']>>,
  ) {
    if (railwayMetrics.available && railwayMetrics.cpuVcpu != null) {
      return { available: true, vcpu: round1(railwayMetrics.cpuVcpu), source: 'railway', note: null as string | null };
    }
    return {
      available: false,
      vcpu: null,
      source: null,
      note: 'CPU en tiempo real requiere RAILWAY_API_TOKEN.',
    };
  }

  // =========================================================================
  //                        semáforo / alertas / recs
  // =========================================================================

  private semaforo(dbLevel: Level, memLevel: string, connLevel: string) {
    const rank: Record<string, number> = { ok: 0, warn: 1, high: 2, crit: 3, emergency: 4 };
    const worst = Math.max(rank[dbLevel] ?? 0, rank[memLevel] ?? 0, rank[connLevel] ?? 0);
    // 4 colores del semáforo (verde/amarillo/naranja/rojo).
    if (worst >= 3) return { color: 'rojo', label: 'Crítico', level: worst };
    if (worst === 2) return { color: 'naranja', label: 'Riesgo alto', level: worst };
    if (worst === 1) return { color: 'amarillo', label: 'Advertencia', level: worst };
    return { color: 'verde', label: 'Operativo', level: worst };
  }

  private buildAlerts(d: {
    dbPct: number;
    dbLevel: { level: Level; label: string };
    memory: { level: string; percent: number };
    conns: { level: string; active: number; max: number };
    projection: { status: string; daysTo90: number | null };
  }) {
    const alerts: { level: string; title: string; body: string }[] = [];
    if (d.dbLevel.level !== 'ok') {
      alerts.push({
        level: d.dbLevel.level,
        title: `Base de datos al ${round1(d.dbPct)}% (${d.dbLevel.label})`,
        body:
          d.dbLevel.level === 'emergency' || d.dbLevel.level === 'crit'
            ? 'Sube el volumen de Postgres en Railway o purga datos antiguos (audit logs, notificaciones, webhooks).'
            : 'Vigila el crecimiento y planifica ampliación o limpieza.',
      });
    }
    if (d.memory.level === 'crit') {
      alerts.push({ level: 'crit', title: `Memoria al ${d.memory.percent}%`, body: 'Riesgo de OOM-kill. Sube RAM o revisa fugas de memoria.' });
    } else if (d.memory.level === 'warn') {
      alerts.push({ level: 'warn', title: `Memoria al ${d.memory.percent}%`, body: 'RSS elevado — monitorea que baje tras el GC.' });
    }
    if (d.conns.level !== 'ok') {
      alerts.push({ level: d.conns.level, title: `Conexiones ${d.conns.active}/${d.conns.max}`, body: 'Cerca del máximo — revisa el pool (pgbouncer/connection_limit).' });
    }
    if (d.projection.status === 'ok' && d.projection.daysTo90 != null && d.projection.daysTo90 <= 30) {
      alerts.push({ level: d.projection.daysTo90 <= 14 ? 'crit' : 'warn', title: `Proyección: 90% en ~${d.projection.daysTo90} días`, body: 'Planifica ampliación de capacidad antes de la saturación.' });
    }
    return alerts;
  }

  private recommendations(d: {
    dbLevel: { level: Level };
    memory: { level: string };
    projection: { status: string; daysTo100: number | null };
    storage: { fileCount: number };
  }) {
    const recs: { level: 'info' | 'warn' | 'crit'; text: string }[] = [];
    if (d.dbLevel.level === 'emergency' || d.dbLevel.level === 'crit') {
      recs.push({ level: 'crit', text: 'Aumentar el volumen de Postgres en Railway (10→20 GB) o purgar AuditLog/Notification/webhooks antiguos.' });
    } else if (d.dbLevel.level === 'high' || d.dbLevel.level === 'warn') {
      recs.push({ level: 'warn', text: 'Archivar datos fríos (logs, webhooks procesados, sesiones vencidas) para liberar espacio.' });
    }
    if (d.projection.status === 'ok' && d.projection.daysTo100 != null && d.projection.daysTo100 <= 60) {
      recs.push({ level: 'warn', text: `A ritmo actual la BD se llena en ~${d.projection.daysTo100} días. Programa la ampliación.` });
    }
    if (d.memory.level !== 'ok') {
      recs.push({ level: d.memory.level === 'crit' ? 'crit' : 'warn', text: 'Revisar consumo de memoria del backend; considerar subir RAM o replicas.' });
    }
    if (!recs.length) {
      recs.push({ level: 'info', text: 'Sistema saludable. Sin acciones requeridas en este momento.' });
    }
    return recs;
  }

  // =========================================================================
  //                          config (Setting)
  // =========================================================================

  async getConfig() {
    const [dbLimitBytes, alertEmail] = await Promise.all([
      this.getSettingNumber(K.dbLimitBytes),
      this.getSetting(K.alertEmail),
    ]);
    return {
      dbLimitBytes: dbLimitBytes ?? null,
      dbLimitPretty: dbLimitBytes ? prettyBytes(dbLimitBytes) : null,
      alertEmail: alertEmail ?? null,
      railway: this.railway.configState(),
      defaultDbLimitBytes: DEFAULT_DB_LIMIT_BYTES,
    };
  }

  async setConfig(dto: { dbLimitBytes?: number | null; alertEmail?: string | null }) {
    if (dto.dbLimitBytes !== undefined) {
      if (dto.dbLimitBytes === null || dto.dbLimitBytes === 0) {
        await this.deleteSetting(K.dbLimitBytes);
      } else {
        await this.setSetting(K.dbLimitBytes, String(Math.round(dto.dbLimitBytes)));
      }
    }
    if (dto.alertEmail !== undefined) {
      if (!dto.alertEmail) await this.deleteSetting(K.alertEmail);
      else await this.setSetting(K.alertEmail, dto.alertEmail.trim());
    }
    return this.getConfig();
  }

  // =========================================================================
  //                        snapshots + cron + alert email
  // =========================================================================

  async takeSnapshot(source: 'cron' | 'manual' = 'manual') {
    const [dbSize, conns, totals, railwayVol] = await Promise.all([
      this.dbTotalSize(),
      this.connections(),
      this.storageTotals(),
      this.railway.postgresVolume(),
    ]);
    const capacity = await this.resolveCapacity(dbSize.bytes, railwayVol);
    const storage = await this.storageEstimate();
    const rss = process.memoryUsage().rss;
    const memLimit = detectContainerMemoryLimit();

    let perBrand: any = null;
    try {
      const pb = await this.perBrand();
      perBrand = pb.brands.map((b) => ({ id: b.id, name: b.name, rows: b.rowsTotal, businesses: b.businesses }));
    } catch {
      perBrand = null;
    }

    const row = await this.prisma.serverMetricSnapshot.create({
      data: {
        dbSizeBytes: BigInt(Math.round(capacity.usedBytes)),
        dbLimitBytes: capacity.limitBytes ? BigInt(Math.round(capacity.limitBytes)) : null,
        tableCount: totals.tableCount,
        connectionsActive: conns.active,
        connectionsMax: conns.max,
        memoryRssBytes: BigInt(rss),
        memoryLimitBytes: memLimit ? BigInt(memLimit) : null,
        storageBytes: BigInt(storage.estimateBytes),
        perBrand,
        source,
      },
    });
    return { id: row.id, createdAt: row.createdAt, dbSizeBytes: Number(row.dbSizeBytes), source };
  }

  // Snapshot diario 03:30 (después de retention.daily-cleanup a las 03:15).
  @Cron('30 3 * * *', { name: 'server-status.daily-snapshot' })
  async dailySnapshotCron() {
    try {
      await this.takeSnapshot('cron');
      await this.checkAndAlert();
      this.logger.log('Snapshot diario de infraestructura guardado.');
    } catch (e: any) {
      this.logger.error(`Fallo el snapshot diario: ${e?.message ?? e}`);
    }
  }

  /** Envía email de alerta SOLO cuando el nivel de capacidad ESCALA (anti-spam). */
  private async checkAndAlert() {
    try {
      const dbSize = await this.dbTotalSize();
      const railwayVol = await this.railway.postgresVolume();
      const capacity = await this.resolveCapacity(dbSize.bytes, railwayVol);
      if (!capacity.limitBytes) return;
      const pct = (capacity.usedBytes / capacity.limitBytes) * 100;
      const lvl = capacityLevel(pct);
      const rank: Record<string, number> = { ok: 0, warn: 1, high: 2, crit: 3, emergency: 4 };
      const prevRaw = await this.getSetting(K.lastAlertLevel);
      const prevRank = rank[prevRaw ?? 'ok'] ?? 0;
      const curRank = rank[lvl.level] ?? 0;
      await this.setSetting(K.lastAlertLevel, lvl.level);
      if (curRank <= prevRank || curRank < rank['warn']) return; // solo escaladas ≥ advertencia

      const to = (await this.getSetting(K.alertEmail)) || process.env.PLATFORM_ALERT_EMAIL;
      if (!to) return;
      await this.email.send({
        to,
        subject: `⚠️ Estado del Servidor: base de datos al ${round1(pct)}% (${lvl.label})`,
        html: `<div style="font-family:system-ui,sans-serif">
          <h2>Alerta de capacidad</h2>
          <p>La base de datos alcanzó <b>${round1(pct)}%</b> de su capacidad (${prettyBytes(capacity.usedBytes)} de ${prettyBytes(capacity.limitBytes)}).</p>
          <p>Nivel: <b>${lvl.label}</b>. Revisa el panel Estado del Servidor en /superadmin.</p>
        </div>`,
        text: `Base de datos al ${round1(pct)}% (${lvl.label}). Revisa /superadmin → Estado del Servidor.`,
      });
      this.logger.warn(`Alerta de capacidad enviada a ${to} (${lvl.level}, ${round1(pct)}%).`);
    } catch (e: any) {
      this.logger.warn(`checkAndAlert falló: ${e?.message ?? e}`);
    }
  }

  // ---- Setting helpers ------------------------------------------------------
  private async getSetting(key: string): Promise<string | null> {
    const row = await this.prisma.setting.findUnique({ where: { key } });
    return row?.value ?? null;
  }
  private async getSettingNumber(key: string): Promise<number | null> {
    const v = await this.getSetting(key);
    if (v == null) return null;
    const n = Number(v);
    return isNaN(n) ? null : n;
  }
  private async setSetting(key: string, value: string) {
    await this.prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
  }
  private async deleteSetting(key: string) {
    await this.prisma.setting.deleteMany({ where: { key } });
  }
}

// ===========================================================================
//                               helpers
// ===========================================================================

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

/** Niveles de capacidad según los umbrales del PDF (60/70/80/90/95/100). */
function capacityLevel(pct: number): { level: Level; label: string } {
  if (pct >= 95) return { level: 'emergency', label: 'Emergencia' };
  if (pct >= 90) return { level: 'crit', label: 'Crítico' };
  if (pct >= 80) return { level: 'high', label: 'Alta prioridad' };
  if (pct >= 70) return { level: 'warn', label: 'Advertencia' };
  return { level: 'ok', label: 'Normal' };
}

function prettyBytes(bytes: number): string {
  if (!isFinite(bytes)) return '—';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let n = bytes / 1024;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 ? 2 : 1)} ${units[i]}`;
}
