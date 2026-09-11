import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../common/prisma/prisma.service';
import { QueueService } from '../jobs/queue.service';
import { EmailService } from '../email/email.service';
import { OnboardingService } from './onboarding.service';
import { resolveBrandEmail } from '../email/brand-email';
import { accountActivatedTemplate } from '../email/templates/templates';

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
  // API de la app de Onboarding, para dar de alta el onboarding al crear el
  // negocio. Separadas del webhook: aquel avisa de una activación, esta CREA.
  apiUrl: 'onboarding.api.url',
  apiKey: 'onboarding.api.key',
};

@Injectable()
export class OnboardingWebhookService {
  private readonly logger = new Logger('OnboardingWebhook');
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: QueueService,
    private readonly email: EmailService,
    private readonly onboarding: OnboardingService,
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

  /** Config de la API del Onboarding. Sin url o sin llave, no se hace nada. */
  private async readApi() {
    const rows = await this.prisma.setting.findMany({
      where: { key: { in: [K.apiUrl, K.apiKey] } },
      select: { key: true, value: true },
    });
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    return { url: map[K.apiUrl] || '', key: map[K.apiKey] || '' };
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
    const [c, api] = await Promise.all([this.read(), this.readApi()]);
    return {
      url: c.url,
      enabled: c.enabled,
      hasSecret: !!c.secret,
      secretLast4: c.secret ? c.secret.slice(-4) : null,
      apiUrl: api.url,
      hasApiKey: !!api.key,
      apiKeyLast4: api.key ? api.key.slice(-4) : null,
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
    if (body.apiUrl !== undefined)
      ops.push(this.upsert(K.apiUrl, body.apiUrl ? String(body.apiUrl).trim() : ''));
    if (body.apiKey !== undefined)
      ops.push(this.upsert(K.apiKey, body.apiKey ? String(body.apiKey) : ''));
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
    let tenant: {
      id: string;
      brandName: string;
      name: string | null;
      phone: string | null;
      slug: string;
      logoUrl: string | null;
      primaryColor: string | null;
      whatsappPhone: string | null;
      whiteLabelId: string | null;
    } | null = null;
    try {
      tenant = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: {
          id: true, brandName: true, name: true, phone: true, slug: true,
          logoUrl: true, primaryColor: true, whatsappPhone: true, whiteLabelId: true,
        },
      });
      if (!tenant) return;
      await this.emit('business.activated', {
        business_id: tenant.id,
        name: tenant.brandName || tenant.name,
        phone: tenant.phone,
        slug: tenant.slug,
        activated_at: new Date().toISOString(),
      });
    } catch {
      /* best-effort: jamás propaga */
    }
    // Email de "cuenta activada" al dueño (datos de acceso + login de la marca).
    // SOLO en marcas con remitente propio configurado (ej Sellea) — otras marcas
    // no cambian. Best-effort, nunca rompe la activación.
    try {
      if (!tenant) return;
      const brandEmail = await resolveBrandEmail(
        this.prisma,
        tenant.whiteLabelId,
        process.env.APP_URL || 'https://soyclubify.com',
      );
      if (!brandEmail.hasBrandSender) return; // opt-in por marca
      const owner = await this.prisma.user.findFirst({
        where: { tenantId, role: 'TENANT_OWNER', isActive: true },
        orderBy: { createdAt: 'asc' },
        select: { email: true, fullName: true },
      });
      if (!owner?.email) return;
      this.email.send({
        to: owner.email,
        from: brandEmail.from,
        replyTo: brandEmail.replyTo,
        ...accountActivatedTemplate({
          tenant: {
            brandName: tenant.brandName,
            logoUrl: tenant.logoUrl,
            primaryColor: tenant.primaryColor,
            whatsappPhone: tenant.whatsappPhone,
            slug: tenant.slug,
          },
          fullName: owner.fullName ?? undefined,
          loginEmail: owner.email,
          loginUrl: brandEmail.loginUrl,
          brand: { name: brandEmail.brandName },
        }),
      });
    } catch (e: any) {
      this.logger.warn(`email cuenta-activada falló: ${e?.message}`);
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

  /**
   * Da de alta el onboarding del negocio en la app de Onboarding.
   *
   * Es el disparo que faltaba: hasta ahora Clubify creaba el negocio y alguien
   * tenía que ir a la otra app a crear el onboarding a mano, copiar el
   * business_id y pegar un token. Cuando ese paso se olvidaba, el cliente
   * llenaba el formulario entero y no salía nada hacia Clubify.
   *
   * Manda el negocio YA VINCULADO (`clubify: {business_id, token}`), así que la
   * sincronización funciona desde el primer minuto, y el otro lado le manda el
   * enlace a los implementadores.
   *
   * Best-effort y sin reintentos a propósito: el negocio ya está creado y el
   * alta del onboarding se puede rehacer a mano. Reintentar sin coordinar con
   * la idempotencia del otro lado es cómo se acaba con dos onboardings del
   * mismo negocio.
   */
  async crearClienteEnOnboarding(tenantId: string): Promise<void> {
    try {
      const cfg = await this.readApi();
      // Sin configurar no hace nada. Es lo que mantiene esto inerte hasta que
      // alguien ponga la URL y la llave en el panel.
      if (!cfg.url || !cfg.key) return;

      const t = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: {
          brandName: true,
          phone: true,
          businessCategorySlug: true,
          sedeMenuEnabled: true,
        },
      });
      if (!t) return;

      // `createToken` se niega en negocios de marca blanca: el onboarding sync
      // es interno de Clubify. Que se niegue aquí es correcto, no un fallo.
      let token: string;
      let tokenId: string;
      try {
        const cred = await this.onboarding.createToken(tenantId, 'Alta automática');
        token = cred.token;
        tokenId = cred.id;
      } catch {
        return;
      }

      const base = cfg.url.replace(/\/+$/, '');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const res = await fetch(`${base}/api/v1/clients`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${cfg.key}`,
          },
          body: JSON.stringify({
            name: t.brandName,
            business_type: t.businessCategorySlug ?? null,
            // El teléfono viaja para que el implementador sepa a quién
            // reenviarle el enlace; el enlace NO se le manda al negocio.
            data: { step1: { name: t.brandName, whatsapp: t.phone ?? '' } },
            clubify: { business_id: tenantId, token },
            // Clubify ya sabe si el negocio lleva varias sedes, así que el
            // cliente recibe el flujo correcto sin que nadie lo elija.
            menu_type: t.sedeMenuEnabled ? 'multi_location' : 'single',
          }),
          signal: controller.signal,
        });
        if (!res.ok) {
          this.logger.warn(
            `Alta en Onboarding falló para ${tenantId}: HTTP ${res.status}`,
          );
          // SE REVOCA EL TOKEN SI EL ALTA NO ENTRÓ.
          //
          // Si no, queda un token vivo de un onboarding que no existe: quien
          // luego busque «negocios sin token» lo ve con uno y lo da por hecho,
          // así que nadie reintenta NUNCA y el cliente se queda sin su
          // formulario. Revocarlo deja el negocio otra vez «sin onboarding»,
          // que es la verdad.
          await this.onboarding.revokeToken(tenantId, tokenId).catch(() => null);
        }
      } finally {
        clearTimeout(timer);
      }
    } catch (e: any) {
      this.logger.warn(
        `Alta en Onboarding falló para ${tenantId}: ${e?.message || 'error'}`,
      );
    }
  }

  /**
   * ¿Este negocio ya tiene su onboarding dado de alta?
   *
   * Se mira por el TOKEN vivo, que es la huella que deja el alta. Lo usa el
   * reconciliador para no dar de alta dos veces al mismo.
   */
  async tieneOnboarding(tenantId: string): Promise<boolean> {
    const n = await this.prisma.onboardingToken.count({
      where: { tenantId, revokedAt: null },
    });
    return n > 0;
  }
}
