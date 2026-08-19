import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { brandGrowCreds, BRAND_GROW_SELECT } from './brand-sms-creds.util';

/**
 * Integración con el proveedor externo de SMS "Grow Business" (provider real
 * por debajo: GoHighLevel API). El nombre "Grow Business" es lo único que se
 * expone al usuario final — ni en logs ni UI debe aparecer "GHL" o
 * "GoHighLevel". Cada tenant lo conecta el SUPER_ADMIN con su locationId +
 * apiKey específicos del sub-account.
 */
@Injectable()
export class GrowBusinessService {
  private logger = new Logger('GrowBusiness');
  private readonly API_BASE = 'https://services.leadconnectorhq.com';
  private readonly API_VERSION = '2021-07-28';

  // 2026-08-01: TODO mensaje saliente vía Grow Business arranca con
  // `#switch_unique|1|` para que salga del número de VENTAS (prioridad 1). Se
  // cambió desde |2| (soporte) porque ese WhatsApp presentó problemas de
  // entrega. Tenants con `switchNumber` explícito pueden seguir overrideando —
  // esto es solo el default. (El nombre se conserva por compatibilidad de refs.)
  private readonly DEFAULT_SUPPORT_SWITCH = 1;

  constructor(private prisma: PrismaService) {}

  /**
   * Upsert (find or create) de contacto en Grow Business y devuelve el
   * contactId. El endpoint /conversations/messages requiere contactId
   * desde 2025 (antes aceptaba toNumber directo). Si no existe el
   * contacto, lo crea con el phone como única data.
   *
   * Best-effort: si falla, devuelve null para que el caller decida
   * abortar el SMS sin crashear el flow principal.
   */
  private async upsertContact(
    locationId: string,
    apiKey: string,
    phone: string,
  ): Promise<string | null> {
    try {
      // Normalizamos a E.164 si no viene con + adelante (el endpoint
      // tolera ambas formas pero "phone": "+57..." es lo seguro).
      const phoneE164 = phone.trim().startsWith('+')
        ? phone.trim()
        : `+${phone.replace(/\D/g, '')}`;
      const res = await fetch(`${this.API_BASE}/contacts/upsert`, {
        method: 'POST',
        // FIX 2026-06-16 (review): timeout en llamada externa (LeadConnector)
        // para no colgar el request/worker si el upstream no responde.
        signal: AbortSignal.timeout(15000),
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Version: this.API_VERSION,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          locationId,
          phone: phoneE164,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        this.logger.warn(
          `upsertContact failed status=${res.status} body=${text.slice(0, 200)}`,
        );
        return null;
      }
      const data = await res.json().catch(() => null as any);
      // El response puede venir como { contact: {id} } o { id } según versión.
      const id =
        data?.contact?.id ??
        data?.id ??
        data?.contactId ??
        null;
      if (!id) {
        this.logger.warn(
          `upsertContact OK pero sin id en response: ${JSON.stringify(data).slice(0, 200)}`,
        );
        return null;
      }
      return id;
    } catch (e: any) {
      this.logger.warn(`upsertContact threw: ${e?.message ?? e}`);
      return null;
    }
  }

  async getStatus(tenantId: string) {
    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        growBusinessLocationId: true,
        growBusinessConnectedAt: true,
        growBusinessSwitchNumber: true,
      },
    });
    if (!t) throw new NotFoundException('Negocio no encontrado');
    return {
      connected: !!t.growBusinessLocationId,
      locationId: t.growBusinessLocationId,
      connectedAt: t.growBusinessConnectedAt,
      switchNumber: t.growBusinessSwitchNumber,
    };
  }

  async connect(
    tenantId: string,
    locationId: string,
    apiKey: string,
    switchNumber?: number | null,
  ) {
    if (!locationId?.trim() || !apiKey?.trim()) {
      throw new BadRequestException('Location ID y API key son obligatorios');
    }
    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, brandName: true },
    });
    if (!t) throw new NotFoundException('Negocio no encontrado');

    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        growBusinessLocationId: locationId.trim(),
        growBusinessApiKey: apiKey.trim(),
        growBusinessConnectedAt: new Date(),
        // Solo seteamos switch si llegó. Si vino undefined, respetamos
        // el valor anterior; si llegó null explícito (limpiar), lo
        // borramos.
        ...(switchNumber === undefined
          ? {}
          : { growBusinessSwitchNumber: switchNumber }),
      },
    });
    this.logger.log(`Conectado tenant=${t.brandName} locationId=${locationId}`);
    return { ok: true, connectedAt: new Date() };
  }

  /** Actualiza SOLO el switch number, sin tocar locationId/apiKey. */
  async setSwitchNumber(tenantId: string, switchNumber: number | null) {
    if (switchNumber !== null && (!Number.isInteger(switchNumber) || switchNumber < 1)) {
      throw new BadRequestException('Switch number debe ser un entero ≥ 1');
    }
    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true },
    });
    if (!t) throw new NotFoundException('Negocio no encontrado');
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { growBusinessSwitchNumber: switchNumber },
    });
    return { ok: true, switchNumber };
  }

  async disconnect(tenantId: string) {
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        growBusinessLocationId: null,
        growBusinessApiKey: null,
        growBusinessConnectedAt: null,
      },
    });
    return { ok: true };
  }

  /**
   * Llama al endpoint /locations/:id del provider para validar las credenciales.
   * Si responde 200 con datos, la conexión está OK.
   */
  async testConnection(tenantId: string) {
    const creds = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { growBusinessLocationId: true, growBusinessApiKey: true },
    });
    if (!creds?.growBusinessLocationId || !creds.growBusinessApiKey) {
      throw new BadRequestException('Este negocio no está conectado');
    }
    try {
      const res = await fetch(
        `${this.API_BASE}/locations/${creds.growBusinessLocationId}`,
        {
          signal: AbortSignal.timeout(15000),
          headers: {
            Authorization: `Bearer ${creds.growBusinessApiKey}`,
            Version: this.API_VERSION,
            Accept: 'application/json',
          },
        },
      );
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        return {
          ok: false,
          status: res.status,
          message:
            res.status === 401
              ? 'API key inválida o sin permisos para esta location'
              : res.status === 404
              ? 'Location ID no encontrado'
              : `Error ${res.status}: ${body.slice(0, 200)}`,
        };
      }
      const data = await res.json().catch(() => null);
      return {
        ok: true,
        locationName: data?.location?.name ?? data?.name ?? null,
      };
    } catch (e: any) {
      return {
        ok: false,
        message: e?.message ?? 'Error de red conectando con el proveedor',
      };
    }
  }

  /**
   * Envía un SMS desde el sub-account del tenant. Devuelve `{ok:true, id}` o
   * `{ok:false, message}`. Used internamente por el motor de mensajes.
   */
  async sendSms(tenantId: string, toPhone: string, body: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        growBusinessLocationId: true,
        growBusinessApiKey: true,
        growBusinessSwitchNumber: true,
        whiteLabel: { select: BRAND_GROW_SELECT },
      },
    });
    // Candidatas en orden de preferencia: creds PROPIAS del negocio > subcuenta
    // GHL de su MARCA blanca (nunca la de Clubify). Se prueban en CASCADA: si la
    // primera falla, se reintenta con la siguiente. Esto auto-cura el caso en
    // que la key propia del tenant quedó VENCIDA frente a la de la marca (misma
    // location) — bug real en negocios white-label — sin re-sincronizar a mano.
    // Un fallo = no se envió nada, así que reintentar no duplica el mensaje.
    // Ver feedback_grow_business_stale_tenant_key_prefers_over_brand.
    const candidates: {
      locationId: string;
      apiKey: string;
      switchNumber: number | null;
    }[] = [];
    if (tenant?.growBusinessLocationId && tenant.growBusinessApiKey) {
      candidates.push({
        locationId: tenant.growBusinessLocationId,
        apiKey: tenant.growBusinessApiKey,
        switchNumber: tenant.growBusinessSwitchNumber,
      });
    }
    const brand = brandGrowCreds(tenant?.whiteLabel);
    if (
      brand &&
      !candidates.some(
        (c) => c.locationId === brand.locationId && c.apiKey === brand.apiKey,
      )
    ) {
      candidates.push(brand);
    }
    if (!candidates.length) {
      return { ok: false as const, message: 'Negocio no conectado a Grow Business' };
    }
    let last: {
      ok: boolean;
      message?: string;
      status?: number;
      id?: string | null;
    } = {
      ok: false,
      message: 'Grow Business: sin credenciales válidas',
    };
    for (let i = 0; i < candidates.length; i++) {
      last = await this.sendSmsWithCreds(candidates[i], toPhone, body);
      if (last.ok) return last;
      if (i < candidates.length - 1) {
        this.logger.warn(
          `sendSms tenant=${tenantId}: creds #${i + 1} fallaron (${('message' in last && last.message) || 'error'}) — reintentando con la siguiente subcuenta`,
        );
      }
    }
    return last;
  }

  /**
   * Envía un SMS usando credenciales explícitas (subcuenta global de
   * GrowBusinessAccount). Usado por features tipo alertas de reseñas
   * cuando el tenant tiene `reviewAlertsAccountId` apuntando a una
   * subcuenta compartida en lugar de credenciales propias.
   */
  async sendSmsWithCreds(
    creds: { locationId: string; apiKey: string; switchNumber?: number | null },
    toPhone: string,
    body: string,
  ) {
    if (!creds.locationId || !creds.apiKey) {
      return { ok: false as const, message: 'Credenciales incompletas' };
    }
    // Switch prefix (Grow Business multi-number).
    //
    // Formato: `#switch_unique|<priority>|<message>`. El backend de GHL/
    // LeadConnector parsea el prefijo y enruta el SMS por el número de la
    // prioridad indicada (cada subcuenta tiene múltiples números con
    // prioridades distintas).
    //
    // 2026-06-06 (item 3 sprint): el default cambió. Antes: si switchNumber
    // era null, NO se agregaba prefijo y el SMS salía del número por defecto
    // (ventas). Ahora: si switchNumber es null, se usa DEFAULT_SUPPORT_SWITCH
    // (2 = soporte) para garantizar que TODOS los mensajes salgan desde
    // soporte salvo override explícito. Tenants/cuentas con switchNumber
    // configurado mantienen su override.
    //
    // Compat: si el caller ya armó el prefijo manualmente (legacy `#Switch<n>\n`
    // o `#switch_unique|<n>|`), respetamos su decisión y no doble-prefixeamos.
    const alreadyHasPrefix =
      /^#switch_unique\|\d+\|/i.test(body) || /^#Switch\d+\s*\n/i.test(body);
    const effectiveSwitch =
      creds.switchNumber != null ? creds.switchNumber : this.DEFAULT_SUPPORT_SWITCH;
    const messageBody = alreadyHasPrefix
      ? body
      : `#switch_unique|${effectiveSwitch}|${body}`;

    // Grow Business / LeadConnector cambió la API: /conversations/messages
    // ya no acepta `toNumber` directo (devuelve 404 "Contact id not given").
    // Hay que hacer upsert del contacto primero y mandar con `contactId`.
    const contactId = await this.upsertContact(
      creds.locationId,
      creds.apiKey,
      toPhone,
    );
    if (!contactId) {
      return {
        ok: false as const,
        message:
          'No se pudo crear/buscar el contacto en Grow Business. Revisa API key, location y formato del teléfono.',
      };
    }

    return this.postChannelMessage(creds.apiKey, contactId, 'SMS', messageBody);
  }

  /**
   * Envía un WhatsApp message server-side via Grow Business (F6).
   * Mismo flujo que sendSmsWithCreds (upsert contact + POST messages)
   * pero con `type: 'WhatsApp'`. La subcuenta GB del afiliado debe tener
   * WhatsApp habilitado en LeadConnector — si no, la API devuelve un
   * 422 con mensaje claro y lo propagamos al user.
   */
  async sendWhatsAppWithCreds(
    creds: { locationId: string; apiKey: string },
    toPhone: string,
    body: string,
  ) {
    if (!creds.locationId || !creds.apiKey) {
      return { ok: false as const, message: 'Credenciales incompletas' };
    }
    const contactId = await this.upsertContact(
      creds.locationId,
      creds.apiKey,
      toPhone,
    );
    if (!contactId) {
      return {
        ok: false as const,
        message:
          'No se pudo crear/buscar el contacto en Grow Business. Revisa API key, location y formato del teléfono.',
      };
    }
    return this.postChannelMessage(creds.apiKey, contactId, 'WhatsApp', body);
  }

  /**
   * Upsert de contacto por CORREO (el de SMS usa el teléfono). Mismo endpoint;
   * cambia la llave con la que Grow Business identifica al contacto.
   */
  private async upsertContactByEmail(
    locationId: string,
    apiKey: string,
    email: string,
  ): Promise<string | null> {
    try {
      const res = await fetch(`${this.API_BASE}/contacts/upsert`, {
        method: 'POST',
        signal: AbortSignal.timeout(15000),
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Version: this.API_VERSION,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ locationId, email: email.trim().toLowerCase() }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        this.logger.warn(
          `upsertContactByEmail failed status=${res.status} body=${text.slice(0, 200)}`,
        );
        return null;
      }
      const data = await res.json().catch(() => null as any);
      const id = data?.contact?.id ?? data?.id ?? data?.contactId ?? null;
      if (!id) {
        this.logger.warn(
          `upsertContactByEmail OK pero sin id: ${JSON.stringify(data).slice(0, 200)}`,
        );
        return null;
      }
      return id;
    } catch (e: any) {
      this.logger.warn(`upsertContactByEmail threw: ${e?.message ?? e}`);
      return null;
    }
  }

  /**
   * Envía un CORREO por la subcuenta de Grow Business de la marca — el mismo
   * camino que ya usan el SMS y el WhatsApp, con la misma conexión probada.
   *
   * El REMITENTE lo pone la subcuenta: como cada marca tiene la suya, el correo
   * sale con el dominio y la firma de esa marca sin que haya que configurar
   * nada aparte. Por eso NO forzamos `emailFrom`: mandar uno sin verificar en
   * la subcuenta haría rebotar el envío.
   *
   * Nada de prefijo `#switch_unique|n|` — eso enruta números de teléfono y no
   * significa nada en un correo; iría a parar al cuerpo del mensaje.
   */
  async sendEmailWithCreds(
    creds: { locationId: string; apiKey: string },
    toEmail: string,
    subject: string,
    html: string,
    opts?: { text?: string },
  ) {
    if (!creds.locationId || !creds.apiKey) {
      return { ok: false as const, message: 'Credenciales incompletas' };
    }
    const to = (toEmail ?? '').trim();
    if (!to) return { ok: false as const, message: 'Destinatario vacío' };

    const contactId = await this.upsertContactByEmail(
      creds.locationId,
      creds.apiKey,
      to,
    );
    if (!contactId) {
      return {
        ok: false as const,
        message:
          'No se pudo crear/buscar el contacto en Grow Business. Revisa API key, location y el correo.',
      };
    }
    return this.postChannelMessage(creds.apiKey, contactId, 'Email', opts?.text ?? '', {
      subject,
      html,
      ...(opts?.text ? { emailBody: opts.text } : {}),
    });
  }

  /**
   * Helper interno: POST /conversations/messages con `type` específico.
   * Devuelve mismo shape que las funciones públicas (ok/status/message/id).
   */
  private async postChannelMessage(
    apiKey: string,
    contactId: string,
    type: 'SMS' | 'WhatsApp' | 'Email',
    message: string,
    extra?: Record<string, unknown>,
  ) {
    try {
      const res = await fetch(`${this.API_BASE}/conversations/messages`, {
        method: 'POST',
        // FIX 2026-06-16 (review): timeout en llamada externa (LeadConnector)
        // para no colgar el request/worker si el upstream no responde.
        signal: AbortSignal.timeout(15000),
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Version: this.API_VERSION,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ type, contactId, message, ...(extra ?? {}) }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return {
          ok: false as const,
          status: res.status,
          message: text.slice(0, 200),
        };
      }
      const data = await res.json().catch(() => ({}));
      return { ok: true as const, id: data?.messageId ?? data?.id ?? null };
    } catch (e: any) {
      return {
        ok: false as const,
        message: e?.message ?? `Error enviando ${type}`,
      };
    }
  }
}
