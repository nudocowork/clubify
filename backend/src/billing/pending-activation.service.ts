import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { BrandEmailService } from '../email/brand-email.service';
import { brandBaseUrl } from '../email/brand-email-creds.util';
import { PreregAlertsService } from '../auth/prereg-alerts.service';

/**
 * Aviso al COMPRADOR que pagó y todavía no creó su cuenta (flujo «pago →
 * datos», filas Pending*Payment). Un solo camino para todas las pasarelas:
 *
 *  - CORREO por BrandEmailService (plantilla `email_buyer_activation`), que
 *    transporta por la subcuenta de Grow Business de la marca. Existe porque
 *    el EmailService clásico no tiene proveedor en producción (sin
 *    RESEND_API_KEY el adaptador escribe en el log y el comprador no recibe
 *    nada) — así se acumularon pagos cobrados sin cuenta creada.
 *  - WhatsApp/SMS por la subcuenta de la MARCA del comprador (fallback a la
 *    global), vía PreregAlertsService.
 *  - SMS al equipo, que es quien persigue estos casos a mano.
 *
 * La identidad siempre es la de la marca del comprador: uno de Sellea recibe
 * el aviso de Sellea, nunca de Clubify. El nombre y el dominio salen de la BD.
 *
 * La IDEMPOTENCIA no vive acá sino en cada pasarela (`recoveryNotifiedAt` en
 * su propia tabla Pending*): este servicio solo envía, y el reenvío manual del
 * panel reutiliza exactamente este camino.
 */
@Injectable()
export class PendingActivationService {
  private readonly logger = new Logger(PendingActivationService.name);

  constructor(
    private prisma: PrismaService,
    private brandEmail: BrandEmailService,
    private alerts: PreregAlertsService,
  ) {}

  async notifyBuyer(opts: {
    gateway: 'HOTMART' | 'STRIPE' | 'CROSS';
    /** null = plataforma (la fila `clubify`). */
    whiteLabelId: string | null;
    email: string;
    name: string | null;
    phone: string | null;
  }): Promise<{
    emailSent: boolean;
    channel: 'whatsapp' | 'sms' | 'none';
    activateUrl: string;
  }> {
    const email = opts.email.trim().toLowerCase();
    const wl = await this.prisma.whiteLabel
      .findFirst({
        where: opts.whiteLabelId
          ? { id: opts.whiteLabelId }
          : { slug: 'clubify' },
        select: { id: true, name: true, domain: true, appDomain: true },
      })
      .catch(() => null);
    const appUrl = (process.env.APP_URL ?? 'https://soyclubify.com').replace(
      /\/$/,
      '',
    );
    // El link vive en el dominio de la marca (mismo frontend servido bajo ese
    // dominio): el comprador de una marca nunca ve un dominio ajeno, y el
    // signup hereda la marca por el Origin.
    const activateUrl = `${brandBaseUrl(wl, appUrl)}/activar?email=${encodeURIComponent(email)}`;
    const buyerName = (opts.name ?? '').trim().split(/\s+/)[0] ?? '';

    const emailRes = await this.brandEmail
      .sendTemplate({
        templateId: 'email_buyer_activation',
        whiteLabelId: opts.whiteLabelId ?? wl?.id ?? null,
        // El comprador no tiene tenant todavía: destinatario explícito.
        to: email,
        vars: { buyerName, activateUrl },
      })
      .catch(() => ({ sent: false as const }));
    if (!emailRes.sent) {
      this.logger.warn(
        `Aviso de compra sin cuenta: el correo no salió para ${email} (marca ${wl?.name ?? 'plataforma'}).`,
      );
    }

    const buyerNotify = await this.alerts
      .sendBuyerActivationLink({
        email,
        name: opts.name,
        phone: opts.phone,
        activateUrl,
        whiteLabelId: opts.whiteLabelId ?? wl?.id ?? null,
        platformName: wl?.name ?? null,
      })
      .catch(() => ({ ok: false as const, channel: 'none' as const }));

    // Al equipo le importa el estado REAL de cada canal: si ninguno salió,
    // este SMS es lo único que evita que el comprador quede en el limbo.
    const gLabel =
      opts.gateway === 'HOTMART'
        ? 'Hotmart'
        : opts.gateway === 'STRIPE'
          ? 'Stripe'
          : 'Cross';
    this.alerts
      .sendTeamAlert(
        `💳 Pago ${gLabel} recibido SIN cuenta aún.\n` +
          `Marca: ${wl?.name ?? '—'}\n` +
          `Email: ${email}\n` +
          `Aviso al comprador: correo ${emailRes.sent ? '✅' : '❌'}, ` +
          `${buyerNotify.ok ? `${buyerNotify.channel} ✅` : 'WhatsApp/SMS ❌'}\n` +
          `Link: ${activateUrl}`,
        'pago_sin_cuenta',
      )
      .catch(() => null);

    return {
      emailSent: emailRes.sent,
      channel: buyerNotify.ok ? buyerNotify.channel : 'none',
      activateUrl,
    };
  }
}
