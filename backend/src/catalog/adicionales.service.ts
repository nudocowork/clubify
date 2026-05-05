import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';

export type AdicionalDto = {
  name: string;
  price: number;
  isActive?: boolean;
};

@Injectable()
export class AdicionalesService {
  constructor(private prisma: PrismaService) {}

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
    return this.prisma.adicional.findMany({
      where: { tenantId: tid },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async create(user: AuthUser, dto: AdicionalDto, override?: string) {
    const tid = this.tid(user, override);
    const last = await this.prisma.adicional.findFirst({
      where: { tenantId: tid },
      orderBy: { position: 'desc' },
    });
    return this.prisma.adicional.create({
      data: {
        tenantId: tid,
        name: dto.name,
        price: dto.price,
        isActive: dto.isActive ?? true,
        position: (last?.position ?? -1) + 1,
      },
    });
  }

  async update(user: AuthUser, id: string, dto: Partial<AdicionalDto>) {
    const a = await this.prisma.adicional.findUnique({ where: { id } });
    if (!a) throw new NotFoundException();
    if (user.role !== 'SUPER_ADMIN' && a.tenantId !== user.tenantId) {
      throw new ForbiddenException();
    }
    return this.prisma.adicional.update({ where: { id }, data: dto });
  }

  async remove(user: AuthUser, id: string) {
    const a = await this.prisma.adicional.findUnique({ where: { id } });
    if (!a) throw new NotFoundException();
    if (user.role !== 'SUPER_ADMIN' && a.tenantId !== user.tenantId) {
      throw new ForbiddenException();
    }
    await this.prisma.adicional.delete({ where: { id } });
    return { ok: true };
  }

  async reorder(user: AuthUser, ids: string[]) {
    const tid = user.role === 'SUPER_ADMIN' ? null : user.tenantId;
    await this.prisma.$transaction(
      ids.map((id, position) =>
        this.prisma.adicional.updateMany({
          where: { id, ...(tid ? { tenantId: tid } : {}) },
          data: { position },
        }),
      ),
    );
    return { ok: true };
  }
}
