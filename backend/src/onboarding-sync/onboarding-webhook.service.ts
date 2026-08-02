import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../common/prisma/prisma.service';
import { QueueService } from '../jobs/queue.service';

// Reintentos DESPUÉS de un fallo (≠2xx o error de red): 1min, 10min, 1h.
// El intento inmediato es el job inicial (attempt 0); estos son los re-encolados.
const RETRY_DELAYS_MS = [60_000, 600_000, 3_600_000];

// Onboarding Sync API — Fase D. Webhook SALIENTE: cuando un negocio se ACTIVA
// en Clubify, se hace un POST firmado (HMAC-sha256) a una URL configurable del
// onboarding, para que dispare su propia mensajería. Config global en Setting
// (una sola integración externa). Best-effort: nunca rompe la activación.
const K = {
  url: 'onboarding.webhook.url',
  secret: 'onboarding.webhook.secret',
  enabled: 'onboarding.webhook.enabled',
};

@Injectable()
export class OnboardingWebhookService {
  private readonly logger = new Logger('OnboardingWebhook');
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: QueueService,
  ) {}

  private async read() {
    const rows = await this.prisma.setting.findMany({
      where: { key: { in: [K.url, K.secret, K.enabled] } },
      select: { key: true, value: true },
    });
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    return {
      url: map[K.url] || '',
      secret: map[K.secret] || '',
      enabled: map[K.enabled] === '1',
    };
  }

  private upsert(key: string, value: string) {
    return this.prisma.setting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
  }

  /** Config para el panel — nunca devuelve el secreto en claro. */
  async getConfig() {
    const c = await this.read();
    return {
      url: c.url,
      enabled: c.enabled,
      hasSecret: !!c.secret,
      secretLast4: c.secret ? c.secret.slice(-4) : null,
    };
  }

  async setConfig(body: any) {
    const ops: any[] = [];
    if (body.url !== undefined)
      ops.push(this.upsert(K.url, body.url ? String(body.url).trim() : ''));
    if (body.secret !== undefined)
      ops.push(this.upsert(K.secret, body.secret ? String(body.secret) : ''));
    if (body.enabled !== undefined)
      ops.push(this.upsert(K.enabled, body.enabled ? '1' : '0'));
    if (ops.length) await this.prisma.$transaction(ops);
    return this.getConfig();
  }

  private sign(rawBody: string, secret: string): string {
    return 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  }

  /** POST firmado, best-effort (nunca lanza; timeout corto). */
  private async post(
    url: string,
    secret: string,
    payload: any,
  ): Promise<{ ok: boolean; status: number | null; error?: string }> {
    const rawBody = JSON.stringify(payload);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Clubify-Event': String(payload?.event ?? 'unknown'),
          ...(secret ? { 'X-Clubify-Signature': this.sign(rawBody, secret) } : {}),
        },
        body: rawBody,
        signal: controller.signal,
      });
      return { ok: res.ok, status: res.status };
    } catch (e: any) {
      return { ok: false, status: null, error: e?.message || 'fetch_failed' };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Emite un evento si el webhook está habilitado y con URL. No lanza nunca.
   *  Encola un intento INMEDIATO en la cola durable (BullMQ); si el onboarding
   *  responde ≠2xx, el worker re-encola con delays 1min/10min/1h (deliverJob).
   *  Sobrevive reinicios del proceso. El payload/firma es el MISMO en cada
   *  intento (idempotente: el onboarding dedup por business_id). Sin Redis
   *  (stub) corre inline el intento inmediato; los reintentos se omiten. */
  async emit(event: string, data: Record<string, any>): Promise<void> {
    try {
      const c = await this.read();
      if (!c.enabled || !c.url) return;
      const payload = { event, ...data, sent_at: new Date().toISOString() };
      // attempts:1 → sin auto-retry de BullMQ; el rescheduling lo maneja
      // deliverJob para respetar exactamente 1min/10min/1h.
      await this.jobs.enqueue(
        'onboarding.webhook',
        { payload, attempt: 0 },
        { attempts: 1 },
      );
    } catch (e: any) {
      this.logger.warn(`webhook ${event} enqueue error: ${e?.message}`);
    }
  }

  /** Handler del job 'onboarding.webhook'. POST firmado; si falla, re-encola el
   *  MISMO payload con delay 1min → 10min → 1h (hasta agotar). Nunca lanza (así
   *  BullMQ marca el job completo y no dispara su propio backoff). */
  async deliverJob(job: { payload: any; attempt: number }): Promise<void> {
    try {
      const c = await this.read();
      if (!c.enabled || !c.url) return;
      const attempt = job?.attempt ?? 0;
      const r = await this.post(c.url, c.secret, job.payload);
      if (r.ok) return;
      if (attempt < RETRY_DELAYS_MS.length) {
        const delay = RETRY_DELAYS_MS[attempt];
        await this.jobs.enqueue(
          'onboarding.webhook',
          { payload: job.payload, attempt: attempt + 1 },
          { attempts: 1, delay },
        );
        this.logger.warn(
          `webhook ${job.payload?.event} intento ${attempt + 1} falló (status=${r.status ?? '-'} ${r.error ?? ''}); reintento en ${Math.round(delay / 1000)}s`,
        );
      } else {
        this.logger.warn(
          `webhook ${job.payload?.event} agotó reintentos (status=${r.status ?? '-'} ${r.error ?? ''})`,
        );
      }
    } catch (e: any) {
      this.logger.warn(`webhook deliverJob error: ${e?.message}`);
    }
  }

  /** Señal `business.activated`. Best-effort (fire-and-forget desde el caller). */
  async emitBusinessActivated(tenantId: string): Promise<void> {
    try {
      const t = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true, brandName: true, name: true, phone: true, slug: true },
      });
      if (!t) return;
      await this.emit('business.activated', {
        business_id: t.id,
        name: t.brandName || t.name,
        phone: t.phone,
        slug: t.slug,
        activated_at: new Date().toISOString(),
      });
    } catch {
      /* best-effort: jamás propaga */
    }
  }

  /** Dispara un `webhook.test` con la config guardada y devuelve el resultado. */
  async test(): Promise<{ ok: boolean; status: number | null; message: string }> {
    const c = await this.read();
    if (!c.url) {
      return { ok: false, status: null, message: 'Configura primero la URL del webhook.' };
    }
    const r = await this.post(c.url, c.secret, {
      event: 'webhook.test',
      message: 'Ping de Clubify (Onboarding Sync)',
      sent_at: new Date().toISOString(),
    });
    return {
      ok: r.ok,
      status: r.status,
      message: r.ok
        ? `OK — el endpoint respondió HTTP ${r.status}.`
        : `Falló${r.status ? ` (HTTP ${r.status})` : ''}${r.error ? `: ${r.error}` : ''}.`,
    };
  }
}
