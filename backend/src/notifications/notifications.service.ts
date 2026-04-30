import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';

export type NotificationDto = {
  cardId?: string;
  title: string;
  body: string;
  segment?: Record<string, any>;
};

@Injectable()
export class NotificationsService {
  private logger = new Logger(NotificationsService.name);
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
    return this.prisma.notification.findMany({
      where: { tenantId: tid },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async send(user: AuthUser, dto: NotificationDto, override?: string) {
    const tid = this.tid(user, override);

    const passes = await this.prisma.pass.findMany({
      where: {
        tenantId: tid,
        ...(dto.cardId ? { cardId: dto.cardId } : {}),
        status: 'ACTIVE',
      },
      include: { walletDevices: true },
    });

    let targeted = 0;
    for (const p of passes) {
      targeted += p.walletDevices.length;
      // En MVP: log. En prod: encolar APNs / Google Wallet messages.add
      this.logger.log(`Push to pass ${p.id} (${p.walletDevices.length} devices)`);
    }

    return this.prisma.notification.create({
      data: {
        tenantId: tid,
        cardId: dto.cardId,
        title: dto.title,
        body: dto.body,
        segment: dto.segment ?? {},
        triggerType: 'MANUAL',
        sentAt: new Date(),
        stats: { targeted, delivered: 0, opened: 0 },
      },
    });
  }
}
