import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { GrowBusinessService } from '../integrations/grow-business.service';
import {
  brandGrowCreds,
  BRAND_GROW_SELECT,
} from '../integrations/brand-sms-creds.util';

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
 * (no se llega aquí si el cliente ya existe). Para tracking, agregamos
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

  // Circuit-breaker anti-repetición (bug 2026-07-06: alertas de compra/
  // onboarding llegando repetidamente). Evita reenviar una alerta con la MISMA
  // clave (tipo + email) dentro de una ventana corta, sin importar quién la
  // dispare (webhook, cron, reintento, doble submit). En memoria: suficiente
  // para cortar bursts; se complementa con guards de DB donde existen.
  private readonly recentAlerts = new Map<string, number>();
  private readonly ALERT_DEDUP_MS = 10 * 60 * 1000;

  private isDuplicateAlert(key: string): boolean {
    const now = Date.now();
    const last = this.recentAlerts.get(key);
    if (last && now - last < this.ALERT_DEDUP_MS) return true;
    this.recentAlerts.set(key, now);
    if (this.recentAlerts.size > 1000) {
      for (const [k, t] of this.recentAlerts)
        if (now - t > this.ALERT_DEDUP_MS) this.recentAlerts.delete(k);
    }
    return false;
  }

  /** Clave estable ignorando timestamps/números variables: primera línea
   *  (tipo de mensaje) + email del cuerpo. */
  private alertKey(body: string): string {
    const email =
      body.match(/[\w.+-]+@[\w.-]+\.[\w.-]+/)?.[0]?.toLowerCase() ?? '';
    const firstLine = body.split('\n')[0].slice(0, 60);
    return `${firstLine}::${email}`;
  }

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
      // GUARD anti-repetición: si este user YA fue alertado (o hubo una alerta
      // idéntica reciente), no reenviamos. Antes se seteaba preregAlertedAt
      // DESPUÉS de enviar pero no se chequeaba al entrar → doble llamada =
      // "Nuevo preregistro" duplicado.
      const already = await this.prisma.user
        .findUnique({
          where: { id: opts.userId },
          select: { preregAlertedAt: true },
        })
        .catch(() => null);
      if (
        already?.preregAlertedAt &&
        Date.now() - already.preregAlertedAt.getTime() < 24 * 60 * 60 * 1000
      ) {
        this.logger.log(
          `prereg alert ya enviado para user=${opts.userId} — skip`,
        );
        return;
      }
      if (this.isDuplicateAlert(`prereg::${opts.customerEmail.toLowerCase()}`)) {
        this.logger.warn(
          `prereg alert idéntico reciente para ${opts.customerEmail} — skip (anti-spam)`,
        );
        return;
      }
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
   * Envía un SMS arbitrario al equipo (Javier + Jhon o teléfonos
   * configurados via Setting `prereg.alertPhones`) usando la misma
   * subcuenta GB que las alertas de signup. Reusable desde otros
   * servicios — el cron de trial F4 lo usa para recordatorios.
   *
   * Fire-and-forget: captura sus propios errores y devuelve void.
   */
  async sendTeamAlert(body: string): Promise<{
    ok: boolean;
    sent: number;
    total: number;
  }> {
    try {
      // Anti-repetición: no reenviar una alerta idéntica (mismo tipo+email)
      // dentro de la ventana. Corta bursts de "Nueva compra"/"Pago SIN cuenta"
      // sin importar el disparador (bug 2026-07-06).
      if (this.isDuplicateAlert(this.alertKey(body))) {
        this.logger.warn(
          'sendTeamAlert: alerta idéntica reciente — skip (anti-spam)',
        );
        return { ok: true, sent: 0, total: 0 };
      }
      const account = await this.resolveAccount();
      if (!account) {
        this.logger.warn('sendTeamAlert: sin GrowBusinessAccount');
        return { ok: false, sent: 0, total: 0 };
      }
      const phones = await this.resolvePhones();
      if (phones.length === 0) {
        return { ok: false, sent: 0, total: 0 };
      }
      const results = await Promise.all(
        phones.map(async (p) => {
          const r = await this.growBusiness
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
          return r.ok;
        }),
      );
      const sent = results.filter(Boolean).length;
      return { ok: sent > 0, sent, total: phones.length };
    } catch (e) {
      this.logger.warn(`sendTeamAlert falló: ${(e as Error).message}`);
      return { ok: false, sent: 0, total: 0 };
    }
  }

  /**
   * Envía SMS + WhatsApp al COMPRADOR (no al equipo) con el link de
   * activación post-pago Hotmart (2026-06-11). Idempotente desde el
   * caller — éste se llama dentro de `notifyPendingRecovery` que
   * controla recoveryNotifiedAt.
   *
   * Estrategia: intenta WhatsApp primero (más engagement en LATAM); si
   * el LeadConnector no tiene WhatsApp habilitado en la subcuenta cae
   * a SMS. Si tampoco hay teléfono válido, devolvemos ok=false y el
   * email queda como única notificación.
   */
  async sendBuyerActivationLink(opts: {
    email: string;
    name: string | null;
    phone: string | null;
    activateUrl: string;
    /** Marca del comprador: el mensaje sale por SU subcuenta de Grow Business
     *  (fallback: la global de siempre) y queda en MessageLog a su nombre. */
    whiteLabelId?: string | null;
    /** Nombre de la marca para el texto («Recibimos tu pago en Sellea»). */
    platformName?: string | null;
  }): Promise<{ ok: boolean; channel: 'whatsapp' | 'sms' | 'none' }> {
    try {
      // Anti-repetición: no reenviar el link de activación al mismo comprador
      // dentro de la ventana (bug 2026-07-06: mensaje de onboarding al cliente
      // repetido). Defensa extra al recoveryNotifiedAt del caller.
      if (this.isDuplicateAlert(`buyer-activation::${opts.email.toLowerCase()}`)) {
        this.logger.warn(
          `sendBuyerActivationLink: link idéntico reciente para ${opts.email} — skip (anti-spam)`,
        );
        return { ok: false, channel: 'none' };
      }
      const phone = normalizeBuyerPhone(opts.phone);
      if (!phone) {
        this.logger.warn(
          `sendBuyerActivationLink: teléfono inválido o ausente para ${opts.email}`,
        );
        return { ok: false, channel: 'none' };
      }
      const account = await this.resolveBuyerAccount(opts.whiteLabelId);
      if (!account) {
        this.logger.warn('sendBuyerActivationLink: sin GrowBusinessAccount');
        return { ok: false, channel: 'none' };
      }
      // Contexto para MessageLog: sin él, este envío al comprador no se puede
      // rastrear desde el historial de la marca.
      const ctx = {
        whiteLabelId: opts.whiteLabelId ?? null,
        feature: 'activacion-compra',
      };
      const greeting = opts.name
        ? `Hola ${opts.name.split(' ')[0]} 👋`
        : 'Hola 👋';
      // El nombre de la marca viene de la BD (nunca escrito a mano acá): un
      // comprador de Sellea lee «tu pago en Sellea», no un mensaje anónimo.
      const enMarca = opts.platformName?.trim()
        ? ` en ${opts.platformName.trim()}`
        : '';
      const body =
        `${greeting} Recibimos tu pago${enMarca} 🎉.\n\n` +
        `Para activar tu cuenta en 30 segundos, entra aquí:\n${opts.activateUrl}\n\n` +
        `Importante: usa el mismo correo del pago (${opts.email}) para que se active al instante.`;

      // SMS, no WhatsApp.
      //
      // Se intentaba WhatsApp primero por engagement, pero LeadConnector
      // ACEPTA `type: 'WhatsApp'` y devuelve un providerMessageId aunque la
      // subcuenta no tenga proveedor de WhatsApp conectado: lo entrega por
      // SMS sin avisar. Resultado: al comprador le llegaba un SMS y el
      // historial de la marca lo registraba como WhatsApp (comprobado en los
      // dos envios del 2026-08-22). Un historial que miente sobre el canal no
      // sirve para lo que se construyo.
      //
      // Mientras GHL no informe el canal real, se manda por el que de verdad
      // sale. Si una marca conecta WhatsApp de verdad, esto se reabre con un
      // flag por subcuenta, no adivinando.
      const sms = await this.growBusiness
        .sendSmsWithCreds(
          {
            locationId: account.locationId,
            apiKey: account.apiKey,
            switchNumber: account.switchNumber,
          },
          phone,
          body,
          ctx,
        )
        .catch((e) => ({ ok: false as const, message: (e as Error).message }));
      return {
        ok: sms.ok,
        channel: sms.ok ? 'sms' : 'none',
      };
    } catch (e) {
      this.logger.warn(
        `sendBuyerActivationLink falló: ${(e as Error).message}`,
      );
      return { ok: false, channel: 'none' };
    }
  }

  /**
   * Credenciales para escribirle al COMPRADOR: la subcuenta de Grow Business
   * de SU marca si la tiene vinculada — así el mensaje llega con la identidad
   * correcta (un comprador de Sellea no debe recibir nada desde la subcuenta
   * de Clubify). Si la marca no tiene subcuenta, caemos a la global de
   * siempre: mejor avisar por el canal imperfecto que dejar al comprador sin
   * su link de activación.
   */
  private async resolveBuyerAccount(whiteLabelId?: string | null): Promise<{
    locationId: string;
    apiKey: string;
    switchNumber: number | null;
  } | null> {
    if (whiteLabelId) {
      const wl = await this.prisma.whiteLabel
        .findUnique({
          where: { id: whiteLabelId },
          select: BRAND_GROW_SELECT,
        })
        .catch(() => null);
      const creds = brandGrowCreds(wl);
      if (creds) return creds;
    }
    return this.resolveAccount();
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

/**
 * Normaliza un teléfono del comprador Hotmart al formato E.164. Hotmart
 * a veces manda el número sin el `+` y otras veces sin código de país
 * (ej. 5016258620 podría ser Salvador 503 o Colombia 57 mal escrito).
 *
 * Reglas:
 *  - Si arranca con `+` y tiene 10-15 dígitos → válido tal cual.
 *  - Si arranca con `00` lo convertimos a `+` (formato europeo).
 *  - Si tiene 10 dígitos y empieza con 3, asumimos Colombia (+57).
 *  - Si tiene 11+ dígitos sin `+`, agregamos `+` al inicio.
 *  - Cualquier otro caso → null (no enviar, caemos a email solo).
 */
function normalizeBuyerPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/[^\d+]/g, '');
  if (!digits) return null;

  if (digits.startsWith('+')) {
    const rest = digits.slice(1);
    if (/^\d{10,15}$/.test(rest)) return digits;
    return null;
  }
  if (digits.startsWith('00')) {
    const candidate = '+' + digits.slice(2);
    if (/^\+\d{10,15}$/.test(candidate)) return candidate;
    return null;
  }
  // Colombia local: 10 dígitos que empiezan con 3 (celular).
  if (digits.length === 10 && digits.startsWith('3')) {
    return '+57' + digits;
  }
  // 11+ dígitos sin `+` — asumimos que ya trae el código de país.
  if (digits.length >= 11 && digits.length <= 15) {
    return '+' + digits;
  }
  return null;
}
