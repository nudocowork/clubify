import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

export type CreateSupplierDto = {
  name: string;
  phone: string;
  email?: string | null;
  notes?: string | null;
};

@Injectable()
export class SuppliersService {
  constructor(private prisma: PrismaService) {}

  list(tenantId: string) {
    return this.prisma.supplier.findMany({
      where: { tenantId, isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  async get(tenantId: string, id: string) {
    const s = await this.prisma.supplier.findFirst({
      where: { id, tenantId },
    });
    if (!s) throw new NotFoundException('Proveedor no encontrado');
    return s;
  }

  async create(tenantId: string, dto: CreateSupplierDto) {
    return this.prisma.supplier.create({
      data: {
        tenantId,
        name: dto.name.trim(),
        phone: dto.phone.trim(),
        email: dto.email?.trim() || null,
        notes: dto.notes?.trim() || null,
      },
    });
  }

  async update(
    tenantId: string,
    id: string,
    dto: Partial<CreateSupplierDto> & { isActive?: boolean },
  ) {
    const s = await this.prisma.supplier.findFirst({ where: { id, tenantId } });
    if (!s) throw new NotFoundException();
    return this.prisma.supplier.update({
      where: { id },
      data: {
        name: dto.name?.trim() ?? s.name,
        phone: dto.phone?.trim() ?? s.phone,
        email: dto.email !== undefined ? dto.email?.trim() || null : s.email,
        notes: dto.notes !== undefined ? dto.notes?.trim() || null : s.notes,
        isActive: dto.isActive ?? s.isActive,
      },
    });
  }

  async remove(tenantId: string, id: string) {
    const s = await this.prisma.supplier.findFirst({ where: { id, tenantId } });
    if (!s) throw new NotFoundException();
    // Soft delete (mantiene FKs en FrequentProduct con SET NULL via Prisma)
    await this.prisma.supplier.update({
      where: { id },
      data: { isActive: false },
    });
    return { ok: true };
  }
}
