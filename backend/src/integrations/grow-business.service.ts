import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

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
      },
    });
    if (!tenant?.growBusinessLocationId || !tenant.growBusinessApiKey) {
      return { ok: false as const, message: 'Negocio no conectado a Grow Business' };
    }
    return this.sendSmsWithCreds(
      {
        locationId: tenant.growBusinessLocationId,
        apiKey: tenant.growBusinessApiKey,
        switchNumber: tenant.growBusinessSwitchNumber,
      },
      toPhone,
      body,
    );
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
    const alreadyHasPrefix = /^#Switch\d+\s*\n/i.test(body);
    const messageBody =
      creds.switchNumber != null && !alreadyHasPrefix
        ? `#Switch${creds.switchNumber}\n\n${body}`
        : body;

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
          'No se pudo crear/buscar el contacto en Grow Business. Revisá API key, location y formato del teléfono.',
      };
    }

    try {
      const res = await fetch(`${this.API_BASE}/conversations/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${creds.apiKey}`,
          Version: this.API_VERSION,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          type: 'SMS',
          contactId,
          message: messageBody,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return { ok: false as const, status: res.status, message: text.slice(0, 200) };
      }
      const data = await res.json().catch(() => ({}));
      return { ok: true as const, id: data?.messageId ?? data?.id ?? null };
    } catch (e: any) {
      return { ok: false as const, message: e?.message ?? 'Error enviando SMS' };
    }
  }
}
