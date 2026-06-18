import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantsService } from '../tenants/tenants.service';
import { AuthUser } from '../common/decorators/current-user.decorator';

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
};

@Injectable()
export class LocationsService {
  constructor(
    private prisma: PrismaService,
    private tenants: TenantsService,
  ) {}

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
    return this.prisma.location.create({
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
      },
    });
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
    return this.prisma.location.update({ where: { id }, data });
  }

  async remove(user: AuthUser, id: string) {
    const loc = await this.prisma.location.findUnique({ where: { id } });
    if (!loc) throw new NotFoundException();
    if (user.role !== 'SUPER_ADMIN' && loc.tenantId !== user.tenantId) {
      throw new ForbiddenException();
    }
    await this.prisma.location.delete({ where: { id } });
    return { ok: true };
  }
}
