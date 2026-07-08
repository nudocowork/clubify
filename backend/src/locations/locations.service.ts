import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantsService } from '../tenants/tenants.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { QueueService } from '../jobs/queue.service';

export type LocationDto = {
  name: string;
  address?: string;
  latitude: number;
  longitude: number;
  radiusMeters?: number;
  walletRelevantText?: string;
  mapsUrl?: string;
  // #3: administrador de sede (recibe alertas de reseña negativa de esta sede).
  adminName?: string;
  adminPhone?: string;
  // Sedes por estado: estado/región (llave de ruteo) + número de pedidos.
  state?: string;
  ordersWhatsappPhone?: string;
};

@Injectable()
export class LocationsService {
  private readonly logger = new Logger(LocationsService.name);

  constructor(
    private prisma: PrismaService,
    private tenants: TenantsService,
    private jobs: QueueService,
  ) {}

  /**
   * GeoPush (2026-07-07): tras crear/editar/eliminar una ubicación, los pases
   * de Apple/Google YA instalados en los celulares NO tienen el nuevo geofence
   * — el SO solo dispara la notificación "estás cerca de {negocio}" cuando las
   * coordenadas están DENTRO del pase. El pase se regenera con
   * `tenant.locations` al re-fetchearse, así que basta con forzar un refresh
   * silencioso de todos los pases del tenant (bump lastActivityAt + push).
   * Sin esto, la ubicación se guardaba pero la notificación NUNCA llegaba a
   * quienes ya tenían la tarjeta. Fire-and-forget: no bloquea la respuesta ni
   * falla la operación si el push falla.
   */
  private async refreshTenantWallets(tenantId: string) {
    const passes = await this.prisma.pass.findMany({
      where: { tenantId, status: { not: 'REVOKED' } },
      select: { id: true },
    });
    if (passes.length === 0) return;
    // Apple usa If-Modified-Since: sin bumpear lastActivityAt responde 304 y
    // iOS mantiene el .pkpass cacheado (viejo, sin el geofence nuevo).
    await this.prisma.pass.updateMany({
      where: { id: { in: passes.map((p) => p.id) } },
      data: { lastActivityAt: new Date() },
    });
    for (const p of passes) {
      await this.jobs.enqueue('wallet.push', {
        passId: p.id,
        reason: 'geopush_location_change',
        silent: true,
      } as any);
    }
    this.logger.log(
      `GeoPush: refresh de ${passes.length} pases del tenant ${tenantId} tras cambio de ubicación`,
    );
  }

  private queueWalletRefresh(tenantId: string) {
    void this.refreshTenantWallets(tenantId).catch((e) =>
      this.logger.warn(
        `GeoPush refresh falló para tenant ${tenantId}: ${e?.message ?? e}`,
      ),
    );
  }

  /** ¿El cambio afecta el geofence del wallet? (coords/radio/texto). Solo esos
   *  campos requieren re-pushear los pases; editar adminPhone/state no. */
  private geofenceFieldsTouched(dto: Partial<LocationDto>) {
    return (
      'latitude' in dto ||
      'longitude' in dto ||
      'radiusMeters' in dto ||
      'walletRelevantText' in dto
    );
  }

  private tid(user: AuthUser, override?: string) {
    if (user.role === 'SUPER_ADMIN') {
      if (!override) throw new ForbiddenException('tenantId required');
      return override;
    }
    if (!user.tenantId) throw new ForbiddenException();
    return user.tenantId;
  }

  list(user: AuthUser, override?: string) {
    const tid = this.tid(user, override);
    return this.prisma.location.findMany({ where: { tenantId: tid }, orderBy: { createdAt: 'asc' } });
  }

  async create(user: AuthUser, dto: LocationDto, override?: string) {
    const tid = this.tid(user, override);
    const max = await this.tenants.getMaxLocations(tid);
    const count = await this.prisma.location.count({ where: { tenantId: tid } });
    if (count >= max) {
      throw new BadRequestException(
        `Plan limit reached (${max} locations). Solicita ampliación al Super Admin.`,
      );
    }
    const created = await this.prisma.location.create({
      data: {
        tenantId: tid,
        name: dto.name,
        address: dto.address ?? '',
        latitude: dto.latitude,
        longitude: dto.longitude,
        radiusMeters: dto.radiusMeters ?? 300,
        walletRelevantText: dto.walletRelevantText?.trim() || null,
        mapsUrl: dto.mapsUrl?.trim() || null,
        adminName: dto.adminName?.trim() || null,
        adminPhone: dto.adminPhone?.trim() || null,
        state: dto.state?.trim() || null,
        ordersWhatsappPhone: dto.ordersWhatsappPhone?.trim() || null,
      },
    });
    // Nueva ubicación → los pases ya instalados deben recibir el geofence.
    this.queueWalletRefresh(tid);
    return created;
  }

  async update(user: AuthUser, id: string, dto: Partial<LocationDto>) {
    const loc = await this.prisma.location.findUnique({ where: { id } });
    if (!loc) throw new NotFoundException('Location');
    if (user.role !== 'SUPER_ADMIN' && loc.tenantId !== user.tenantId) {
      throw new ForbiddenException();
    }
    // Normalizamos los campos de admin (trim → null si vacío) sin pisar el
    // resto del dto que viene del controller.
    const data: any = { ...dto };
    if ('adminName' in dto) data.adminName = dto.adminName?.trim() || null;
    if ('adminPhone' in dto) data.adminPhone = dto.adminPhone?.trim() || null;
    if ('state' in dto) data.state = dto.state?.trim() || null;
    if ('ordersWhatsappPhone' in dto)
      data.ordersWhatsappPhone = dto.ordersWhatsappPhone?.trim() || null;
    const updated = await this.prisma.location.update({ where: { id }, data });
    // Solo re-pushear si cambió algo del geofence (coords/radio/texto).
    if (this.geofenceFieldsTouched(dto)) this.queueWalletRefresh(loc.tenantId);
    return updated;
  }

  async remove(user: AuthUser, id: string) {
    const loc = await this.prisma.location.findUnique({ where: { id } });
    if (!loc) throw new NotFoundException();
    if (user.role !== 'SUPER_ADMIN' && loc.tenantId !== user.tenantId) {
      throw new ForbiddenException();
    }
    await this.prisma.location.delete({ where: { id } });
    // Ubicación eliminada → el geofence debe salir de los pases instalados.
    this.queueWalletRefresh(loc.tenantId);
    return { ok: true };
  }
}
