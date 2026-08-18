import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { EmailService } from './email.service';
import { emailShell } from './templates/templates';
import {
  brandBaseUrl,
  brandEmailSender,
  BrandEmailSender,
  BRAND_EMAIL_SELECT,
} from './brand-email-creds.util';
import {
  EmailTemplateDef,
  findEmailTemplate,
  fmtEmailDate,
  interpolateEmail,
  isEmailTemplateEnabled,
  resolveEmailTemplate,
} from './brand-email-templates';

/** Slug de la marca de PLATAFORMA: la única que usa la cuenta de email global. */
const PLATFORM_SLUG = 'clubify';

type ResolvedBrand = {
  id: string | null;
  name: string;
  slug: string;
  isPlatform: boolean;
  /** De dónde sale el correo: cuenta propia, remitente propio, o nada. */
  sender: BrandEmailSender;
  /** Dominio de la marca — los links del correo apuntan acá. */
  baseUrl: string;
};

type ResolvedTenant = {
  id: string;
  brandName: string;
  slug: string;
  logoUrl: string | null;
  primaryColor: string | null;
  whatsappPhone: string | null;
  email: string;
  currentPeriodEnd: Date | null;
  whiteLabelId: string | null;
};

export type SendBrandEmailResult =
  | { sent: true }
  | {
      sent: false;
      reason:
        | 'unknown_template'
        | 'tenant_not_found'
        | 'no_recipient'
        | 'no_connection'
        | 'template_disabled'
        | 'send_failed';
    };

/**
 * Envío de los CORREOS del ciclo de vida al dueño del negocio que compró
 * (bienvenida, panel creado, pago confirmado, pausa, reembolso…).
 *
 * Reglas, en orden:
 *  1. La plantilla existe y no está apagada para la marca.
 *  2. La marca puede enviar (ver `brandEmailSender`): con su cuenta Resend
 *     propia (`emailConfig`), o con su remitente propio sobre la cuenta de la
 *     plataforma (`emailFrom`). La marca `clubify` y los negocios sin marca
 *     usan la cuenta de plataforma. Una marca blanca sin ninguno de los dos NO
 *     envía: mandar desde `@soyclubify.com` la delataría y rompería DMARC.
 *  3. El cuerpo es texto plano editable por la marca; el HTML de marca (logo,
 *     color, pie) lo pone el sistema con `emailShell`.
 *
 * Todo es best-effort: ningún fallo de correo puede tumbar un webhook de pago.
 */
@Injectable()
export class BrandEmailService {
  private readonly logger = new Logger(BrandEmailService.name);

  constructor(
    private prisma: PrismaService,
    private email: EmailService,
  ) {}

  /**
   * Envía un correo del ciclo de vida.
   *
   * @param opts.tenantId  negocio destinatario (resuelve marca, branding y dueño)
   * @param opts.to        override del destinatario (default: dueño del negocio)
   * @param opts.vars      valores extra para los tokens de la plantilla
   */
  async sendTemplate(opts: {
    templateId: string;
    tenantId?: string | null;
    whiteLabelId?: string | null;
    to?: string | null;
    vars?: Record<string, string>;
  }): Promise<SendBrandEmailResult> {
    const def = findEmailTemplate(opts.templateId);
    if (!def) return { sent: false, reason: 'unknown_template' };

    try {
      const tenant = opts.tenantId
        ? await this.loadTenant(opts.tenantId)
        : null;
      if (opts.tenantId && !tenant) {
        return { sent: false, reason: 'tenant_not_found' };
      }

      const brand = await this.resolveBrand(
        opts.whiteLabelId ?? tenant?.whiteLabelId ?? null,
      );

      const enabled = await isEmailTemplateEnabled(
        this.prisma,
        def.id,
        brand.id,
      );
      if (!enabled) return { sent: false, reason: 'template_disabled' };

      // Gate de envío: una marca blanca sin cuenta ni remitente propios calla.
      if (brand.sender.mode === 'none') {
        this.logger.warn(
          `Correo ${def.id} omitido: la marca ${brand.name} no tiene remitente ni cuenta de email propios.`,
        );
        return { sent: false, reason: 'no_connection' };
      }

      const to = (opts.to ?? (await this.recipientOf(tenant)))?.trim();
      if (!to) return { sent: false, reason: 'no_recipient' };

      const ownerName = tenant ? await this.ownerFirstName(tenant.id) : '';
      const vars = this.buildVars(def, {
        tenant,
        brand,
        ownerName,
        to,
        extra: opts.vars ?? {},
      });

      const resolved = await resolveEmailTemplate(this.prisma, def.id, brand.id);
      const subject = interpolateEmail(resolved?.subject ?? def.subject, vars);
      const body = interpolateEmail(resolved?.body ?? def.default, vars);

      const ok = await this.email.sendWithCreds(brand.sender.creds, {
        to,
        subject,
        html: this.renderHtml({ def, brand, tenant, body, vars }),
        text: body,
        // En modo `shared` el mensaje viaja por la cuenta de la plataforma, así
        // que el remitente de la marca hay que ponerlo acá.
        ...(brand.sender.from ? { from: brand.sender.from } : {}),
        ...(brand.sender.replyTo ? { replyTo: brand.sender.replyTo } : {}),
      });
      if (!ok) return { sent: false, reason: 'send_failed' };
      this.logger.log(`Correo ${def.id} enviado a ${to} (marca ${brand.name})`);
      return { sent: true };
    } catch (e) {
      // Nunca propagamos: esto cuelga de webhooks de pago y crons.
      this.logger.warn(
        `Correo ${def.id} falló: ${(e as Error)?.message ?? String(e)}`,
      );
      return { sent: false, reason: 'send_failed' };
    }
  }

  // ─────────── Resolución de marca / negocio / destinatario ───────────

  /** Marca + credenciales. Sin marca (negocio legacy) = plataforma. */
  private async resolveBrand(whiteLabelId: string | null): Promise<ResolvedBrand> {
    const platform = (id: string | null): ResolvedBrand => ({
      id,
      name: 'Clubify',
      slug: PLATFORM_SLUG,
      isPlatform: true,
      sender: { mode: 'platform' as const, creds: null, from: null, replyTo: null },
      baseUrl: this.appUrl(),
    });
    if (!whiteLabelId) return platform(null);
    const wl = await this.prisma.whiteLabel
      .findUnique({ where: { id: whiteLabelId }, select: BRAND_EMAIL_SELECT })
      .catch(() => null);
    if (!wl) return platform(whiteLabelId);
    const isPlatform = wl.slug === PLATFORM_SLUG;
    return {
      id: wl.id,
      name: (wl.name || '').trim() || 'Clubify',
      slug: wl.slug,
      isPlatform,
      sender: brandEmailSender(wl, { isPlatform }),
      baseUrl: brandBaseUrl(wl, this.appUrl()),
    };
  }

  /** URL base de la plataforma (fallback para marcas sin dominio propio). */
  private appUrl(): string {
    return (process.env.APP_URL ?? 'https://soyclubify.com').replace(/\/$/, '');
  }

  private async loadTenant(tenantId: string): Promise<ResolvedTenant | null> {
    return this.prisma.tenant
      .findUnique({
        where: { id: tenantId },
        select: {
          id: true,
          brandName: true,
          slug: true,
          logoUrl: true,
          primaryColor: true,
          whatsappPhone: true,
          email: true,
          currentPeriodEnd: true,
          whiteLabelId: true,
        },
      })
      .catch(() => null);
  }

  /** Dueño del negocio (login real) y, si no hay, el email del negocio. */
  private async recipientOf(tenant: ResolvedTenant | null): Promise<string | null> {
    if (!tenant) return null;
    const owner = await this.prisma.user
      .findFirst({
        where: { tenantId: tenant.id, role: 'TENANT_OWNER', isActive: true },
        select: { email: true },
        orderBy: { createdAt: 'asc' },
      })
      .catch(() => null);
    return owner?.email?.trim() || tenant.email?.trim() || null;
  }

  private async ownerFirstName(tenantId: string): Promise<string> {
    const owner = await this.prisma.user
      .findFirst({
        where: { tenantId, role: 'TENANT_OWNER', isActive: true },
        select: { fullName: true },
        orderBy: { createdAt: 'asc' },
      })
      .catch(() => null);
    const full = (owner?.fullName || '').trim();
    return full ? full.split(/\s+/)[0] : '';
  }

  // ─────────── Tokens y render ───────────

  private buildVars(
    def: EmailTemplateDef,
    ctx: {
      tenant: ResolvedTenant | null;
      brand: ResolvedBrand;
      ownerName: string;
      to: string;
      extra: Record<string, string>;
    },
  ): Record<string, string> {
    const base: Record<string, string> = {
      platform: ctx.brand.name,
      brandName: ctx.tenant?.brandName ?? ctx.brand.name,
      ownerName: ctx.ownerName || 'hola',
      // Dominio propio de la marca si lo tiene: el dueño entra por SU sitio,
      // no por soyclubify.com.
      panelUrl: `${ctx.brand.baseUrl}/app`,
      loginEmail: ctx.to,
      supportEmail: ctx.brand.sender.replyTo ?? '',
      nextChargeDate: ctx.tenant?.currentPeriodEnd
        ? fmtEmailDate(ctx.tenant.currentPeriodEnd)
        : '',
    };
    // Los valores explícitos del llamador ganan (ej. nextChargeDate del webhook,
    // que es más fresco que el currentPeriodEnd que acabamos de leer).
    for (const [k, v] of Object.entries(ctx.extra)) {
      if (v != null && String(v).trim()) base[k] = String(v);
    }
    void def;
    return base;
  }

  /** Cuerpo plano → HTML de marca. Escapa todo: la marca escribe texto, no HTML. */
  private renderHtml(args: {
    def: EmailTemplateDef;
    brand: ResolvedBrand;
    tenant: ResolvedTenant | null;
    body: string;
    vars: Record<string, string>;
  }): string {
    const { def, brand, tenant, body, vars } = args;
    const ctaHref = def.cta ? vars[def.cta.urlVar]?.trim() : '';
    return emailShell({
      tenant: {
        brandName: tenant?.brandName || brand.name,
        logoUrl: tenant?.logoUrl ?? null,
        primaryColor: tenant?.primaryColor ?? null,
        whatsappPhone: tenant?.whatsappPhone ?? null,
        slug: tenant?.slug ?? brand.slug,
      },
      preheader: firstLine(body),
      body: textToHtml(body),
      ...(def.cta && ctaHref
        ? { cta: { label: def.cta.label, href: ctaHref } }
        : {}),
      // El pie dice "Hecho con <marca>"; en marca blanca nunca linkea a Clubify.
      platform: { name: brand.name },
      footer: `Enviado por ${brand.name}`,
    });
  }
}

// ─────────── Helpers de texto ───────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Texto plano → párrafos HTML. Soporta `**negrita**` y listas numeradas
 * (líneas que empiezan con "1." / "2." …) porque los defaults las usan.
 * Todo lo demás se escapa: el editor de la marca nunca inyecta HTML.
 */
function textToHtml(text: string): string {
  const blocks = text.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  return blocks
    .map((block) => {
      const lines = block.split('\n').map((l) => l.trim());
      const isList = lines.length > 1 && lines.every((l) => /^\d+[.)]\s/.test(l));
      if (isList) {
        const items = lines
          .map(
            (l) =>
              `<li style="margin-bottom:6px">${inline(l.replace(/^\d+[.)]\s*/, ''))}</li>`,
          )
          .join('');
        return `<ol style="margin:0 0 16px;padding-left:20px;color:#374151;line-height:1.8">${items}</ol>`;
      }
      return `<p style="margin:0 0 14px;color:#374151;line-height:1.55">${lines
        .map(inline)
        .join('<br/>')}</p>`;
    })
    .join('');
}

function inline(line: string): string {
  return escapeHtml(line).replace(
    /\*\*(.+?)\*\*/g,
    '<b style="color:#0F172A">$1</b>',
  );
}

function firstLine(text: string): string {
  const l = text.split('\n').find((x) => x.trim());
  return (l ?? '').replace(/\*\*/g, '').trim().slice(0, 120);
}
