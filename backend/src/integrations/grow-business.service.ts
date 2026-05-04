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

  async getStatus(tenantId: string) {
    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        growBusinessLocationId: true,
        growBusinessConnectedAt: true,
      },
    });
    if (!t) throw new NotFoundException('Negocio no encontrado');
    return {
      connected: !!t.growBusinessLocationId,
      locationId: t.growBusinessLocationId,
      connectedAt: t.growBusinessConnectedAt,
    };
  }

  async connect(tenantId: string, locationId: string, apiKey: string) {
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
      },
    });
    this.logger.log(`Conectado tenant=${t.brandName} locationId=${locationId}`);
    return { ok: true, connectedAt: new Date() };
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
    const creds = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { growBusinessLocationId: true, growBusinessApiKey: true },
    });
    if (!creds?.growBusinessLocationId || !creds.growBusinessApiKey) {
      return { ok: false as const, message: 'Negocio no conectado a Grow Business' };
    }
    try {
      const res = await fetch(`${this.API_BASE}/conversations/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${creds.growBusinessApiKey}`,
          Version: this.API_VERSION,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          type: 'SMS',
          locationId: creds.growBusinessLocationId,
          message: body,
          toNumber: toPhone,
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
