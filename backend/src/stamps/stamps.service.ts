import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, StampAction } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { QueueService } from '../jobs/queue.service';
import { computePassExpiry } from '../cards/expiry.util';

export type StampDto = {
  passId: string;
  action: StampAction;
  amount?: number;
  note?: string;
  locationId?: string;
  pin?: string;
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

    // Enforcement de fecha de vencimiento de la tarjeta. Bloqueamos
    // STAMP/POINTS_ADD/POINTS_DEDUCT/REDEEM cuando el pass está vencido,
    // pero permitimos REFUND/VISIT (admin puede arreglar saldos).
    const expiry = computePassExpiry(pass);
    if (expiry && expiry.getTime() < Date.now()) {
      const blocking = ['STAMP', 'POINTS_ADD', 'POINTS_DEDUCT', 'REDEEM'];
      if (blocking.includes(dto.action)) {
        throw new BadRequestException(
          `La tarjeta está vencida desde ${expiry.toLocaleDateString('es-CO')}`,
        );
      }
    }

    const amount = new Prisma.Decimal(dto.amount ?? 1);

    // Anti-abuso: si STAMP con amount > 1, exigir PIN configurado por
    // super admin (Setting key scanner.staffPin). Si no hay PIN seteado,
    // se permite (backwards compat hasta que el admin lo configure).
    if (dto.action === 'STAMP' && Number(amount) > 1) {
      const pinRow = await this.prisma.setting.findUnique({
        where: { key: 'scanner.staffPin' },
      });
      const expected = pinRow?.value?.trim();
      if (expected && (dto.pin ?? '').trim() !== expected) {
        throw new ForbiddenException('PIN del escáner inválido');
      }
    }

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

    // Encolar push al wallet. Si BullMQ tiene Redis, el worker lo consume
    // y llama wallet.pushPassUpdate(). Si Redis está offline, enqueue
    // rechaza y caemos al call directo in-process como fallback. Antes
    // se llamaban AMBOS siempre → push doble al iPhone (2 fetches del
    // .pkpass innecesarios).
    this.jobs
      .enqueue('wallet.push', { passId: pass.id, reason: dto.action })
      .catch(() => {
        // Fallback: queue no disponible, push directo in-process
        this.wallet.pushPassUpdate(pass.id).catch(() => null);
      });

    // Hito de multiRewards alcanzado → push de "ganaste X". Solo cuando
    // sumamos sellos (STAMP), no en REFUND/REDEEM. Disparamos cuando
    // newStamps cruza un hito que pass.stampsCount no había alcanzado.
    if (dto.action === 'STAMP' && pass.card.type === 'STAMPS') {
      const milestones: Array<{ at: number; reward: string }> =
        Array.isArray(pass.card.multiRewards as any)
          ? (pass.card.multiRewards as any)
          : [];
      const just = milestones.find(
        (m) =>
          typeof m.at === 'number' &&
          m.at > 0 &&
          pass.stampsCount < m.at &&
          newStamps >= m.at,
      );
      if (just) {
        const message = `🎉 ¡Ganaste ${just.reward}! Acumulaste ${just.at} sellos.`;
        // Push silencioso por canal wallet — el cliente lo ve al abrir
        // el .pkpass actualizado. La notif programada formal se podrá
        // enviar después por SMS/Push si el dueño lo configura en
        // automations.
        this.jobs
          .enqueue('wallet.push', {
            passId: pass.id,
            reason: 'milestone',
            message,
          })
          .catch(() => null);
      }
    }

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
