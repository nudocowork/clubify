import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { GrowBusinessService } from '../integrations/grow-business.service';

/**
 * Notificación SMS al equipo cuando un cliente se preregistra
 * (signup desde landing, link de afiliado, o cualquier punto que
 * cree un User/Tenant nuevo).
 *
 * Config:
 * - Setting `prereg.alertPhones` (JSON array de teléfonos E.164).
 *   Default hardcoded a Javier + Jhon (configurable después desde
 *   admin sin redeploy).
 * - Setting `prereg.alertAccountId` (id de GrowBusinessAccount a usar).
 *   Si no está seteado, usa la primera GB account `purpose=GENERAL`
 *   (o cualquier no-eliminada en último fallback).
 *
 * Dedup: el endpoint /auth/signup ya rechaza emails duplicados con 409
 * (no se llega acá si el cliente ya existe). Para tracking, agregamos
 * el campo `User.preregAlertedAt` para que el cron de reintentos NO
 * envíe el mismo cliente dos veces si fail-retry.
 */
@Injectable()
export class PreregAlertsService {
  private logger = new Logger(PreregAlertsService.name);

  // Default hardcoded. Se sobrescribe via Setting prereg.alertPhones.
  private static FALLBACK_PHONES: Array<{ name: string; phone: string }> = [
    { name: 'Javier', phone: '+573248088401' },
    { name: 'Jhon', phone: '+573181666999' },
  ];

  constructor(
    private prisma: PrismaService,
    private growBusiness: GrowBusinessService,
  ) {}

  /**
   * Dispara los SMS. Fire-and-forget recomendado por el caller — el
   * service captura sus propios errores y no propaga.
   */
  async alertSignup(opts: {
    userId: string;
    customerName: string;
    customerEmail: string;
    customerPhone?: string | null;
    source: string; // "Landing principal" | "Afiliado XYZ123" | etc.
    referrerName?: string | null;
    campaignName?: string | null;
  }): Promise<void> {
    try {
      // Resolver subcuenta GB a usar.
      const account = await this.resolveAccount();
      if (!account) {
        this.logger.warn(
          `Sin GrowBusinessAccount configurada — skip prereg alert para user=${opts.userId}`,
        );
        return;
      }
      // Resolver números.
      const phones = await this.resolvePhones();
      if (phones.length === 0) {
        this.logger.warn(`Sin números configurados — skip prereg alert`);
        return;
      }

      const body = this.buildMessage(opts);

      // Fan-out de envíos en paralelo. Cada uno captura su error.
      await Promise.all(
        phones.map(async (p) => {
          const result = await this.growBusiness
            .sendSmsWithCreds(
              {
                locationId: account.locationId,
                apiKey: account.apiKey,
                switchNumber: account.switchNumber,
              },
              p.phone,
              body,
            )
            .catch((e) => ({ ok: false, message: (e as Error).message }));
          if (!('ok' in result) || !result.ok) {
            this.logger.warn(
              `prereg alert SMS a ${p.name} (${p.phone}) falló: ${(result as any)?.message ?? 'unknown'}`,
            );
          }
        }),
      );

      // Marcar el user para dedup. Si el cron re-procesa este user no
      // re-envía.
      await this.prisma.user
        .update({
          where: { id: opts.userId },
          data: { preregAlertedAt: new Date() },
        })
        .catch(() => null);
    } catch (e) {
      this.logger.warn(
        `alertSignup falló para user=${opts.userId}: ${(e as Error).message}`,
      );
    }
  }

  /**
   * Resuelve la GrowBusinessAccount a usar. Prioridad:
   * 1. Setting `prereg.alertAccountId` si apunta a una válida.
   * 2. Primera account con `purpose='GENERAL'` no eliminada.
   * 3. Cualquier account no eliminada (último fallback).
   */
  private async resolveAccount(): Promise<{
    id: string;
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
        select: {
          id: true,
          locationId: true,
          apiKey: true,
          switchNumber: true,
        },
      });
      if (acc) return acc;
    }
    const general = await this.prisma.growBusinessAccount.findFirst({
      where: { purpose: 'GENERAL', deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true, locationId: true, apiKey: true, switchNumber: true },
    });
    if (general) return general;
    return this.prisma.growBusinessAccount.findFirst({
      where: { deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true, locationId: true, apiKey: true, switchNumber: true },
    });
  }

  private async resolvePhones(): Promise<
    Array<{ name: string; phone: string }>
  > {
    const setting = await this.prisma.setting.findUnique({
      where: { key: 'prereg.alertPhones' },
    });
    if (setting?.value) {
      try {
        const parsed = JSON.parse(setting.value);
        if (Array.isArray(parsed)) {
          const valid = parsed.filter(
            (p) =>
              p &&
              typeof p === 'object' &&
              typeof p.phone === 'string' &&
              p.phone.trim().length > 0,
          );
          if (valid.length > 0) return valid;
        }
      } catch {
        // Si el Setting está corrupto, fallback al hardcoded.
      }
    }
    return PreregAlertsService.FALLBACK_PHONES;
  }

  private buildMessage(opts: {
    customerName: string;
    customerEmail: string;
    customerPhone?: string | null;
    source: string;
    referrerName?: string | null;
    campaignName?: string | null;
  }): string {
    const lines = [
      'Nuevo preregistro en Clubify.',
      '',
      `Nombre: ${opts.customerName}`,
      `Teléfono: ${opts.customerPhone ?? '—'}`,
      `Email: ${opts.customerEmail}`,
      `Origen: ${opts.source}`,
    ];
    if (opts.referrerName) {
      lines.push(`Embajador/Influencer: ${opts.referrerName}`);
    }
    if (opts.campaignName) {
      lines.push(`Campaña: ${opts.campaignName}`);
    }
    lines.push(
      `Fecha: ${new Date().toLocaleString('es-CO', {
        dateStyle: 'short',
        timeStyle: 'short',
      })}`,
    );
    lines.push('', 'Revisar en Clubify.');
    return lines.join('\n');
  }
}
