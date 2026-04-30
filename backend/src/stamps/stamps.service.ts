import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, StampAction } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { QueueService } from '../jobs/queue.service';

export type StampDto = {
  passId: string;
  action: StampAction;
  amount?: number;
  note?: string;
  locationId?: string;
};

@Injectable()
export class StampsService {
  constructor(
    private prisma: PrismaService,
    private wallet: WalletService,
    private jobs: QueueService,
  ) {}

  async record(user: AuthUser, dto: StampDto) {
    const pass = await this.prisma.pass.findUnique({
      where: { id: dto.passId },
      include: { card: true },
    });
    if (!pass) throw new NotFoundException('Pass');
    if (user.role !== 'SUPER_ADMIN' && pass.tenantId !== user.tenantId) {
      throw new ForbiddenException();
    }
    if (pass.status === 'REVOKED') throw new BadRequestException('Pass is revoked');

    const amount = new Prisma.Decimal(dto.amount ?? 1);

    let newStamps = pass.stampsCount;
    let newPoints = pass.pointsBalance;

    switch (dto.action) {
      case 'STAMP':
        newStamps = pass.stampsCount + Number(amount);
        break;
      case 'POINTS_ADD':
        newPoints = new Prisma.Decimal(pass.pointsBalance).add(amount);
        break;
      case 'POINTS_DEDUCT':
        newPoints = new Prisma.Decimal(pass.pointsBalance).sub(amount);
        if (Number(newPoints) < 0) throw new BadRequestException('Insufficient points');
        break;
      case 'REDEEM':
        if (pass.card.type === 'STAMPS') {
          const required = pass.card.stampsRequired ?? 10;
          if (pass.stampsCount < required) throw new BadRequestException('Not enough stamps to redeem');
          newStamps = pass.stampsCount - required;
        }
        break;
      case 'REFUND':
        newStamps = Math.max(0, pass.stampsCount - Number(amount));
        break;
      case 'VISIT':
        // sólo registrar, sin afectar balance
        break;
    }

    const required = pass.card.stampsRequired ?? Number.MAX_SAFE_INTEGER;
    const completed = pass.card.type === 'STAMPS' && newStamps >= required;

    const [stamp, updatedPass] = await this.prisma.$transaction([
      this.prisma.stamp.create({
        data: {
          tenantId: pass.tenantId,
          passId: pass.id,
          customerId: pass.customerId,
          locationId: dto.locationId,
          operatorId: user.id,
          action: dto.action,
          amount,
          note: dto.note,
        },
      }),
      this.prisma.pass.update({
        where: { id: pass.id },
        data: {
          stampsCount: newStamps,
          pointsBalance: newPoints,
          lastActivityAt: new Date(),
          status: completed ? 'COMPLETED' : pass.status,
        },
      }),
    ]);

    // Encolar push al wallet (BullMQ si Redis está, sino stub log)
    this.jobs
      .enqueue('wallet.push', { passId: pass.id, reason: dto.action })
      .catch(() => null);

    // Backwards-compat: actualización in-process si el wallet adapter lo necesita
    this.wallet.pushPassUpdate(pass.id).catch(() => null);

    return { stamp, pass: updatedPass };
  }

  history(user: AuthUser, passId: string) {
    return this.prisma.stamp.findMany({
      where: {
        passId,
        ...(user.role !== 'SUPER_ADMIN' ? { tenantId: user.tenantId ?? '' } : {}),
      },
      include: { operator: { select: { fullName: true } }, location: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
}
