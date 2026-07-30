import { Injectable, Logger } from '@nestjs/common';

/**
 * Cliente best-effort de la Railway Public GraphQL API (backboard) para traer
 * datos que SOLO Railway conoce: capacidad real del volumen de Postgres,
 * CPU/RAM del contenedor y (a futuro) estado de backups.
 *
 * Diseño defensivo — el módulo "Estado del Servidor" NUNCA depende de que esto
 * funcione: si falta el token o la query falla, cada método devuelve
 * `{ available: false, reason }` y el resto del panel sigue mostrando lo que sí
 * es medible desde Postgres. Así cumplimos la regla de no inventar números.
 *
 * Config por variables de entorno (Railway inyecta las de *_ID automáticamente
 * en cada servicio; el token y el serviceId de Postgres se setean a mano):
 *   RAILWAY_API_TOKEN            → account/team token (header Authorization: Bearer)
 *   RAILWAY_PROJECT_TOKEN        → alternativa: project token (header Project-Access-Token)
 *   RAILWAY_PROJECT_ID           → id del proyecto (auto)
 *   RAILWAY_ENVIRONMENT_ID       → id del environment (auto)
 *   RAILWAY_SERVICE_ID           → id del servicio backend (auto)
 *   RAILWAY_POSTGRES_SERVICE_ID  → id del servicio Postgres (se setea a mano)
 *
 * NOTA (verificar en vivo): la forma exacta de la query `metrics` y de los
 * volúmenes de la API de Railway se confirma con el token puesto. El parseo es
 * tolerante a campos faltantes a propósito; si el shape difiere, se ajusta acá
 * sin tocar el resto del módulo.
 */

const RAILWAY_GQL = 'https://backboard.railway.app/graphql/v2';
const GIB = 1024 * 1024 * 1024;

export type RailwayResult<T> =
  | ({ available: true } & T)
  | { available: false; reason: string };

@Injectable()
export class RailwayMetricsService {
  private readonly logger = new Logger(RailwayMetricsService.name);

  private get token(): string | null {
    return (
      process.env.RAILWAY_API_TOKEN ||
      process.env.RAILWAY_PROJECT_TOKEN ||
      null
    );
  }

  private get authHeader(): Record<string, string> | null {
    if (process.env.RAILWAY_API_TOKEN) {
      return { Authorization: `Bearer ${process.env.RAILWAY_API_TOKEN}` };
    }
    if (process.env.RAILWAY_PROJECT_TOKEN) {
      return { 'Project-Access-Token': process.env.RAILWAY_PROJECT_TOKEN };
    }
    return null;
  }

  isConfigured(): boolean {
    return !!this.token;
  }

  /** Diagnóstico de config (sin exponer el token) para el panel. */
  configState() {
    return {
      hasToken: !!this.token,
      tokenKind: process.env.RAILWAY_API_TOKEN
        ? 'account'
        : process.env.RAILWAY_PROJECT_TOKEN
          ? 'project'
          : null,
      projectId: process.env.RAILWAY_PROJECT_ID ?? null,
      environmentId: process.env.RAILWAY_ENVIRONMENT_ID ?? null,
      backendServiceId: process.env.RAILWAY_SERVICE_ID ?? null,
      postgresServiceId: process.env.RAILWAY_POSTGRES_SERVICE_ID ?? null,
    };
  }

  private async gql<T = any>(
    query: string,
    variables: Record<string, any>,
  ): Promise<T | null> {
    const auth = this.authHeader;
    if (!auth) return null;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(RAILWAY_GQL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({ query, variables }),
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (!res.ok) {
        this.logger.warn(`Railway API HTTP ${res.status}`);
        return null;
      }
      const json: any = await res.json();
      if (json?.errors?.length) {
        this.logger.warn(`Railway API errors: ${JSON.stringify(json.errors).slice(0, 300)}`);
        return null;
      }
      return json?.data ?? null;
    } catch (e: any) {
      this.logger.warn(`Railway API fetch failed: ${e?.message ?? e}`);
      return null;
    }
  }

  /**
   * Últimos valores de métricas de un servicio (CPU en vCPU, memoria en GB,
   * disco en GB). Toma la muestra más reciente de la última hora.
   */
  async serviceMetrics(
    serviceId?: string | null,
  ): Promise<
    RailwayResult<{
      cpuVcpu: number | null;
      memoryBytes: number | null;
      diskBytes: number | null;
    }>
  > {
    if (!this.isConfigured()) return { available: false, reason: 'Sin RAILWAY_API_TOKEN' };
    const svc = serviceId || process.env.RAILWAY_SERVICE_ID || null;
    const env = process.env.RAILWAY_ENVIRONMENT_ID || null;
    if (!svc || !env) {
      return { available: false, reason: 'Faltan RAILWAY_SERVICE_ID / RAILWAY_ENVIRONMENT_ID' };
    }
    // startDate = hace 1h; sampleRate grande → pocas muestras, tomamos la última.
    const startDate = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const query = `
      query metrics($serviceId: String!, $environmentId: String!, $startDate: DateTime!, $measurements: [MetricMeasurement!]!, $sampleRateSeconds: Int) {
        metrics(serviceId: $serviceId, environmentId: $environmentId, startDate: $startDate, measurements: $measurements, sampleRateSeconds: $sampleRateSeconds) {
          measurement
          values { ts value }
        }
      }`;
    const data = await this.gql<{ metrics: { measurement: string; values: { ts: number; value: number }[] }[] }>(
      query,
      {
        serviceId: svc,
        environmentId: env,
        startDate,
        sampleRateSeconds: 300,
        measurements: ['CPU_USAGE', 'MEMORY_USAGE_GB', 'DISK_USAGE_GB'],
      },
    );
    if (!data?.metrics) {
      return { available: false, reason: 'metrics query sin datos (revisar shape/permload token)' };
    }
    const last = (name: string): number | null => {
      const m = data.metrics.find((x) => x.measurement === name);
      const v = m?.values?.length ? m.values[m.values.length - 1]?.value : null;
      return typeof v === 'number' ? v : null;
    };
    const cpu = last('CPU_USAGE');
    const memGb = last('MEMORY_USAGE_GB');
    const diskGb = last('DISK_USAGE_GB');
    return {
      available: true,
      cpuVcpu: cpu,
      memoryBytes: memGb != null ? Math.round(memGb * GIB) : null,
      diskBytes: diskGb != null ? Math.round(diskGb * GIB) : null,
    };
  }

  /**
   * Capacidad y uso del volumen de Postgres (lo que da el % real de disco).
   * Busca el volumen del servicio Postgres dentro del proyecto.
   */
  async postgresVolume(): Promise<
    RailwayResult<{ usedBytes: number | null; capacityBytes: number | null; name: string | null }>
  > {
    if (!this.isConfigured()) return { available: false, reason: 'Sin RAILWAY_API_TOKEN' };
    const projectId = process.env.RAILWAY_PROJECT_ID || null;
    if (!projectId) return { available: false, reason: 'Falta RAILWAY_PROJECT_ID' };
    const pgServiceId = process.env.RAILWAY_POSTGRES_SERVICE_ID || null;

    const query = `
      query project($id: String!) {
        project(id: $id) {
          volumes {
            edges { node {
              id name
              volumeInstances { edges { node { id sizeMB currentSizeMB serviceId environmentId } } }
            } }
          }
        }
      }`;
    const data = await this.gql<any>(query, { id: projectId });
    const edges = data?.project?.volumes?.edges;
    if (!Array.isArray(edges)) {
      return { available: false, reason: 'project.volumes sin datos (revisar shape/token)' };
    }
    // Aplanamos las instancias de volumen y elegimos la del servicio Postgres.
    let picked: { sizeMB?: number; currentSizeMB?: number; name?: string } | null = null;
    for (const e of edges) {
      const node = e?.node;
      const insts = node?.volumeInstances?.edges ?? [];
      for (const ie of insts) {
        const vi = ie?.node;
        if (!vi) continue;
        if (pgServiceId && vi.serviceId === pgServiceId) {
          picked = { ...vi, name: node?.name };
          break;
        }
        // Sin pgServiceId configurado: nos quedamos con la instancia más grande.
        if (!pgServiceId) {
          if (!picked || (vi.currentSizeMB ?? 0) > (picked.currentSizeMB ?? 0)) {
            picked = { ...vi, name: node?.name };
          }
        }
      }
      if (picked && pgServiceId) break;
    }
    if (!picked) return { available: false, reason: 'No se encontró volumen de Postgres' };
    const MB = 1024 * 1024;
    return {
      available: true,
      name: picked.name ?? null,
      usedBytes: picked.currentSizeMB != null ? Math.round(picked.currentSizeMB * MB) : null,
      capacityBytes: picked.sizeMB != null ? Math.round(picked.sizeMB * MB) : null,
    };
  }
}
