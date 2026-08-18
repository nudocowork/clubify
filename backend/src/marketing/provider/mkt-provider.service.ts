import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { GrowBusinessService } from '../../integrations/grow-business.service';
import { brandGrowCreds, BRAND_GROW_SELECT } from '../../integrations/brand-sms-creds.util';
import {
  SendResult,
  ConnectionInfo,
  pickMessageId,
  classifyReadError,
} from './mkt-provider.util';

/**
 * Envoltorio del proveedor de envío — ÚNICA puerta de salida del motor de email
 * marketing. Envuelve Grow Business (LeadConnector) por debajo, pero expone un
 * contrato neutral (`SendResult`) y NUNCA filtra el nombre del proveedor a la UI
 * ni a los errores del usuario.
 *
 * Reglas del contrato:
 *  - `messageId` se devuelve SIEMPRE que el proveedor lo dé (correlación de eventos).
 *  - `contactId` (id del contacto en el proveedor) se devuelve para guardarlo
 *    junto a la subcuenta de la que salió.
 *  - Un envío sin destinatario o con cuerpo vacío es `skipped` (no `failed`): no
 *    se llama al proveedor y no gasta intentos.
 */
@Injectable()
export class MktProviderService {
  private readonly log = new Logger('MktProvider');
  private readonly API_BASE = 'https://services.leadconnectorhq.com';
  private readonly API_VERSION = '2021-07-28';

  constructor(
    private prisma: PrismaService,
    private grow: GrowBusinessService,
  ) {}

  /** Credenciales de Grow Business de la marca (descifradas). null si la marca no tiene subcuenta. */
  private async brandCreds(
    whiteLabelId: string,
  ): Promise<{ locationId: string; apiKey: string; switchNumber: number | null } | null> {
    const wl = await this.prisma.whiteLabel.findUnique({
      where: { id: whiteLabelId },
      select: BRAND_GROW_SELECT,
    });
    return brandGrowCreds(wl);
  }

  /**
   * Estado de la conexión para el panel (solo lectura). Si el token no tiene el
   * permiso de LECTURA de la cuenta (401), NO decimos "conexión caída":
   * devolvemos lo que sabemos (subaccount configurada) + `scopeLimited`.
   */
  async getConnectionInfo(whiteLabelId: string): Promise<ConnectionInfo> {
    const creds = await this.brandCreds(whiteLabelId);
    if (!creds) return { configured: false };
    try {
      const res = await fetch(`${this.API_BASE}/locations/${creds.locationId}`, {
        method: 'GET',
        signal: AbortSignal.timeout(12000),
        headers: {
          Authorization: `Bearer ${creds.apiKey}`,
          Version: this.API_VERSION,
          Accept: 'application/json',
        },
      });
      if (!res.ok) {
        const { scopeLimited, error } = classifyReadError(res.status);
        // Sabemos contra qué subcuenta enviamos aunque no podamos leer sus datos.
        return { configured: true, subaccount: creds.locationId, scopeLimited, error };
      }
      const data: any = await res.json().catch(() => ({}));
      const loc = data?.location ?? data ?? {};
      return {
        configured: true,
        subaccount: creds.locationId,
        domain: loc?.domain ?? loc?.settings?.domain ?? null,
        from: loc?.email ?? null,
      };
    } catch (e: any) {
      return {
        configured: true,
        subaccount: creds.locationId,
        error: e?.message ?? 'No se pudo leer la configuración de la cuenta.',
      };
    }
  }

  /**
   * Envía un CORREO por la subcuenta de la marca. Valida ANTES de llamar al
   * proveedor: sin destinatario o sin cuerpo → `skipped` (no gasta intentos).
   */
  async sendEmail(input: {
    whiteLabelId: string;
    toEmail: string;
    toName?: string;
    subject: string;
    html: string;
  }): Promise<SendResult> {
    const email = (input.toEmail || '').trim().toLowerCase();
    if (!email.includes('@')) {
      return { ok: false, skipped: true, error: 'Contacto sin correo válido.' };
    }
    const hasBody = !!(input.subject?.trim() || input.html?.trim());
    if (!hasBody) {
      // El proveedor rechaza el cuerpo vacío con 422 y ningún reintento lo
      // arregla → lo omitimos con un motivo accionable.
      return { ok: false, skipped: true, error: 'El nodo no tiene asunto ni contenido — revísalo.' };
    }
    const creds = await this.brandCreds(input.whiteLabelId);
    if (!creds) {
      return { ok: false, skipped: true, error: 'La marca no tiene subcuenta de correo configurada.' };
    }
    const res = await this.grow.sendEmailWithCreds(creds, email, input.subject || '(sin asunto)', input.html || '');
    if (!res.ok) {
      return { ok: false, error: res.message ?? 'Error enviando el correo.' };
    }
    return {
      ok: true,
      messageId: pickMessageId(res) ?? (res.id ? String(res.id) : undefined),
      contactId: res.contactId ?? undefined,
    };
  }

  /**
   * Envía un SMS por la subcuenta de la marca. Mismas reglas de validación
   * previa que el correo.
   */
  async sendSms(input: {
    whiteLabelId: string;
    toPhone: string;
    message: string;
  }): Promise<SendResult> {
    const phone = (input.toPhone || '').trim();
    if (!phone) {
      return { ok: false, skipped: true, error: 'Contacto sin teléfono.' };
    }
    if (!input.message?.trim()) {
      return { ok: false, skipped: true, error: 'El nodo no tiene mensaje — revísalo.' };
    }
    const creds = await this.brandCreds(input.whiteLabelId);
    if (!creds) {
      return { ok: false, skipped: true, error: 'La marca no tiene subcuenta de SMS configurada.' };
    }
    const res = await this.grow.sendSmsWithCreds(creds, phone, input.message);
    if (!res.ok) {
      return { ok: false, error: ('message' in res && res.message) ? res.message : 'Error enviando el SMS.' };
    }
    return {
      ok: true,
      messageId: pickMessageId(res) ?? (('id' in res && res.id) ? String(res.id) : undefined),
    };
  }
}
