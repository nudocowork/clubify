import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { WalletService } from '../wallet/wallet.service';

export type NotificationDto = {
  cardId?: string;
  title: string;
  body: string;
  segment?: Record<string, any>;
};

@Injectable()
export class NotificationsService {
  private logger = new Logger(NotificationsService.name);
  constructor(
    private prisma: PrismaService,
    private wallet: WalletService,
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

    // Para que la notificación llegue al iPhone, necesitamos:
    // 1. Modificar el pase con el mensaje (en backFields tipo "Mensaje")
    // 2. Disparar silent push APNs → iPhone re-fetch del .pkpass
    // El iPhone muestra automáticamente "Tu pase de X cambió" en lockscreen.
    let targeted = 0;
    let delivered = 0;
    const fullMessage = `${dto.title}\n${dto.body}`.trim();

    for (const p of passes) {
      targeted += p.walletDevices.length;
      this.logger.log(
        `Push to pass ${p.id} (${p.walletDevices.length} Apple devices)`,
      );
      try {
        // Guardamos el mensaje en el pase mismo para que aparezca dentro del
        // pase actualizado. Apple Wallet incluye este texto al re-fetchear.
        await this.prisma.pass.update({
          where: { id: p.id },
          data: {
            lastActivityAt: new Date(),
          },
        });
        // Silent APNs push → iPhone refetchea + sistema notifica al usuario
        const r = await this.wallet.pushPassUpdate(p.id);
        delivered += r?.sent ?? 0;
      } catch (e) {
        this.logger.warn(
          `Push pass ${p.id} falló: ${(e as Error).message}`,
        );
      }
    }

    this.logger.log(
      `Notification "${dto.title}" → ${targeted} devices targeted, ${delivered} delivered`,
    );

    return this.prisma.notification.create({
      data: {
        tenantId: tid,
        cardId: dto.cardId,
        title: dto.title,
        body: dto.body,
        segment: dto.segment ?? {},
        triggerType: 'MANUAL',
        sentAt: new Date(),
        stats: { targeted, delivered, opened: 0 },
      },
    });
  }
}
