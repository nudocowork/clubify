import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { GrowBusinessService } from '../integrations/grow-business.service';
import { SMS_TEMPLATES, interpolateSms } from '../billing/sms-templates';

/**
 * SMS que la PLATAFORMA (Clubify) le manda al dueño de una MARCA BLANCA sobre
 * sus créditos. Tres eventos:
 *   1. créditos acreditados (compra Hotmart / asignación manual)
 *   2. saldo bajo (≤ 2 créditos) — una sola vez hasta recargar
 *   3. negocios en pendientes por falta de créditos — una sola vez hasta recargar
 *
 * Remitente: la subcuenta GLOBAL de Grow Business de Clubify (la misma de los
 * alerts de prereg). Destinatario: `WhiteLabel.notifyPhone`. Si la marca no
 * tiene teléfono configurado, no se envía nada (best-effort, nunca tira).
 *
 * Módulo propio (depende solo de Integrations) para no acoplar a Billing /
 * Superadmin y evitar ciclos de DI. El render reusa SMS_TEMPLATES +
 * interpolateSms y respeta el override en Setting `sms.<id>` (editable desde
 * el Master Admin), igual que SmsTemplatesService.
 */
@Injectable()
export class WhiteLabelNotificationsService {
  private readonly logger = new Logger(WhiteLabelNotificationsService.name);
  private static readonly LOW_CREDITS_THRESHOLD = 2;

  constructor(
    private prisma: PrismaService,
    private growBusiness: GrowBusinessService,
  ) {}

  /** Renderiza una plantilla `sms.<id>` (override → default) interpolada. */
  private async render(id: string, vars: Record<string, string>) {
    const def = SMS_TEMPLATES.find((t) => t.id === id);
    if (!def) return '';
    const row = await this.prisma.setting.findUnique({
      where: { key: `sms.${id}` },
    });
    const tpl = row?.value?.trim() || def.default;
    return interpolateSms(tpl, vars);
  }

  /** Subcuenta global de Grow Business (Setting prereg.alertAccountId →
   *  GENERAL → cualquiera). Mismo remitente que los alerts de la plataforma. */
  private async resolveSenderAccount(): Promise<{
    locationId: string;
    apiKey: string;
    switchNumber: number | null;
  } | null> {
    const setting = await this.prisma.setting.findUnique({
      where: { key: 'prereg.alertAccountId' },
    });
    if (setting?.value) {
      const acc = await this.prisma.growBusinessAccount.findFirst({
        where: { id: setting.value, deletedAt: null },
        select: { locationId: true, apiKey: true, switchNumber: true },
      });
      if (acc) return acc;
    }
    const general = await this.prisma.growBusinessAccount.findFirst({
      where: { purpose: 'GENERAL', deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { locationId: true, apiKey: true, switchNumber: true },
    });
    if (general) return general;
    return this.prisma.growBusinessAccount.findFirst({
      where: { deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { locationId: true, apiKey: true, switchNumber: true },
    });
  }

  /** Envía un SMS a la marca usando el remitente global. Best-effort. */
  private async send(notifyPhone: string | null, templateId: string, vars: Record<string, string>) {
    const phone = notifyPhone?.trim();
    if (!phone) return false;
    const account = await this.resolveSenderAccount();
    if (!account) {
      this.logger.warn('Sin subcuenta Grow Business global para SMS de marca');
      return false;
    }
    const message = await this.render(templateId, vars);
    if (!message) return false;
    const r = await this.growBusiness
      .sendSmsWithCreds(
        { locationId: account.locationId, apiKey: account.apiKey, switchNumber: account.switchNumber },
        phone,
        message,
      )
      .catch((e) => ({ ok: false as const, message: (e as Error)?.message }));
    if (!r.ok) {
      this.logger.warn(`SMS marca ${templateId} falló: ${r.message ?? 'unknown'}`);
    }
    return r.ok;
  }

  /**
   * Créditos acreditados a la marca. Manda el SMS de confirmación y, como el
   * saldo subió, limpia el flag de "saldo bajo" para poder volver a avisar
   * cuando baje otra vez. `available` es el saldo DESPUÉS de acreditar.
   */
  async onCreditsPurchased(whiteLabelId: string, creditsAdded: number, available: number) {
    const wl = await this.prisma.whiteLabel.findUnique({
      where: { id: whiteLabelId },
      select: { name: true, notifyPhone: true },
    });
    if (!wl) return;
    // Reset de dedups: con saldo recargado, los avisos vuelven a estar armados.
    await this.prisma.whiteLabel.update({
      where: { id: whiteLabelId },
      data: { lowCreditsNotifiedAt: null, pendingClientsNotifiedAt: null },
    });
    await this.send(wl.notifyPhone, 'wl_credits_purchased', {
      brandName: wl.name,
      credits: String(creditsAdded),
      available: String(available),
    });
  }

  /**
   * Saldo después de un consumo. Si quedó en ≤2 y no avisamos todavía para
   * este "tramo bajo", mandamos el SMS una sola vez (flag lowCreditsNotifiedAt).
   * Las marcas ilimitadas no aplican.
   */
  async onCreditsConsumed(whiteLabelId: string, available: number) {
    if (available > WhiteLabelNotificationsService.LOW_CREDITS_THRESHOLD) return;
    const wl = await this.prisma.whiteLabel.findUnique({
      where: { id: whiteLabelId },
      select: { name: true, notifyPhone: true, creditsUnlimited: true, lowCreditsNotifiedAt: true },
    });
    if (!wl || wl.creditsUnlimited || wl.lowCreditsNotifiedAt) return;
    // Claim atómico del aviso: solo el primero que pase lo manda.
    const claim = await this.prisma.whiteLabel.updateMany({
      where: { id: whiteLabelId, lowCreditsNotifiedAt: null },
      data: { lowCreditsNotifiedAt: new Date() },
    });
    if (claim.count === 0) return;
    const ok = await this.send(wl.notifyPhone, 'wl_credits_low', {
      brandName: wl.name,
      available: String(available),
    });
    if (!ok) {
      // Si falló el envío, revertimos para reintentar en el próximo consumo.
      await this.prisma.whiteLabel.updateMany({
        where: { id: whiteLabelId },
        data: { lowCreditsNotifiedAt: null },
      });
    }
  }

  /**
   * La marca tiene `count` negocios pendientes de activación por falta de
   * créditos. Avisa una sola vez (flag pendingClientsNotifiedAt) hasta que
   * recargue. count=0 → limpia el flag (ya no hay pendientes).
   */
  async onPendingClients(whiteLabelId: string, count: number) {
    if (count <= 0) {
      await this.prisma.whiteLabel.updateMany({
        where: { id: whiteLabelId, pendingClientsNotifiedAt: { not: null } },
        data: { pendingClientsNotifiedAt: null },
      });
      return;
    }
    const wl = await this.prisma.whiteLabel.findUnique({
      where: { id: whiteLabelId },
      select: { name: true, notifyPhone: true, creditsUnlimited: true, pendingClientsNotifiedAt: true },
    });
    if (!wl || wl.creditsUnlimited || wl.pendingClientsNotifiedAt) return;
    const claim = await this.prisma.whiteLabel.updateMany({
      where: { id: whiteLabelId, pendingClientsNotifiedAt: null },
      data: { pendingClientsNotifiedAt: new Date() },
    });
    if (claim.count === 0) return;
    const ok = await this.send(wl.notifyPhone, 'wl_clients_pending', {
      brandName: wl.name,
      count: String(count),
    });
    if (!ok) {
      await this.prisma.whiteLabel.updateMany({
        where: { id: whiteLabelId },
        data: { pendingClientsNotifiedAt: null },
      });
    }
  }
}
