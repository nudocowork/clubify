import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';

export type CustomerDto = {
  fullName: string;
  email?: string;
  phone?: string;
  birthday?: string;
  externalId?: string;
};

@Injectable()
export class CustomersService {
  constructor(private prisma: PrismaService) {}

  private tenantId(user: AuthUser, override?: string) {
    if (user.role === 'SUPER_ADMIN') {
      if (!override) throw new ForbiddenException('tenantId required');
      return override;
    }
    if (!user.tenantId) throw new ForbiddenException();
    return user.tenantId;
  }

  list(user: AuthUser, search?: string, override?: string) {
    const tid = this.tenantId(user, override);
    return this.prisma.customer.findMany({
      where: {
        tenantId: tid,
        ...(search
          ? {
              OR: [
                { fullName: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
                { phone: { contains: search } },
              ],
            }
          : {}),
      },
      include: { _count: { select: { passes: true, stamps: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async get(user: AuthUser, id: string) {
    const c = await this.prisma.customer.findUnique({
      where: { id },
      include: {
        passes: { include: { card: true } },
        stamps: { orderBy: { createdAt: 'desc' }, take: 50 },
      },
    });
    if (!c) throw new NotFoundException('Customer');
    if (user.role !== 'SUPER_ADMIN' && c.tenantId !== user.tenantId) {
      throw new ForbiddenException();
    }
    // Enrich con pedidos recientes (los queries por `customerId` ya tienen índice)
    const orders = await this.prisma.order.findMany({
      where: { customerId: id },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: {
        id: true,
        code: true,
        status: true,
        total: true,
        paymentStatus: true,
        fulfillment: true,
        createdAt: true,
      },
    });
    return { ...c, orders };
  }

  create(user: AuthUser, dto: CustomerDto, override?: string) {
    const tid = this.tenantId(user, override);
    return this.prisma.customer.create({
      data: {
        tenantId: tid,
        fullName: dto.fullName,
        email: dto.email,
        phone: dto.phone,
        birthday: dto.birthday ? new Date(dto.birthday) : undefined,
        externalId: dto.externalId,
      },
    });
  }

  async update(user: AuthUser, id: string, dto: Partial<CustomerDto>) {
    await this.get(user, id);
    return this.prisma.customer.update({
      where: { id },
      data: { ...dto, birthday: dto.birthday ? new Date(dto.birthday) : undefined },
    });
  }

  async remove(user: AuthUser, id: string) {
    await this.get(user, id);
    await this.prisma.customer.delete({ where: { id } });
    return { ok: true };
  }
}
