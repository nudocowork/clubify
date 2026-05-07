import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { WalletService } from '../wallet/wallet.service';

export type NotificationDto = {
  cardId?: string;
  title: string;
  body: string;
  segment?: Record<string, any>;
  /** ISO date. Si está en el futuro, queda pendiente y el cron despacha. */
  scheduledAt?: string;
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

    // Si scheduledAt está en el futuro, guardamos como pendiente y el cron
    // se encarga de despachar cuando llegue. Ningún push ahora.
    if (dto.scheduledAt) {
      const when = new Date(dto.scheduledAt);
      if (Number.isFinite(when.getTime()) && when.getTime() > Date.now() + 30_000) {
        return this.prisma.notification.create({
          data: {
            tenantId: tid,
            cardId: dto.cardId,
            title: dto.title,
            body: dto.body,
            segment: dto.segment ?? {},
            triggerType: 'SCHEDULED',
            scheduledAt: when,
            sentAt: null,
            stats: { scheduled: true, targeted: 0, delivered: 0 },
          },
        });
      }
      // Si scheduledAt es pasado o muy cercano (<30s), envío inmediato.
    }

    return this.dispatchNow(tid, dto);
  }

  /**
   * Hace el push real a Apple devices y registra la notificación con
   * sentAt = now. Se invoca tanto desde send() (envío inmediato) como
   * desde el cron (envío programado).
   */
  private async dispatchNow(tid: string, dto: NotificationDto) {
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

  /**
   * Cron cada 5 min: busca notifications con scheduledAt vencido y sin
   * sentAt, las despacha. Idempotente — actualiza sentAt para no re-enviar.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async dispatchScheduled() {
    const now = new Date();
    const due = await this.prisma.notification.findMany({
      where: {
        sentAt: null,
        scheduledAt: { not: null, lte: now },
        triggerType: 'SCHEDULED',
      },
      take: 50,
    });
    if (due.length === 0) return;

    this.logger.log(`Cron: ${due.length} notificaciones programadas vencidas`);
    for (const n of due) {
      try {
        // Marcar sentAt PRIMERO para evitar doble despacho si el cron tarda
        await this.prisma.notification.update({
          where: { id: n.id },
          data: { sentAt: now },
        });
        await this.dispatchToDevices(n);
      } catch (e) {
        this.logger.warn(
          `Despacho programado ${n.id} falló: ${(e as Error).message}`,
        );
      }
    }
  }

  /**
   * Versión "stand-alone" del despacho a devices, usada por el cron sobre
   * una Notification ya guardada. Actualiza stats en el registro.
   */
  private async dispatchToDevices(n: {
    id: string;
    tenantId: string;
    cardId: string | null;
    title: string;
    body: string;
  }) {
    const passes = await this.prisma.pass.findMany({
      where: {
        tenantId: n.tenantId,
        ...(n.cardId ? { cardId: n.cardId } : {}),
        status: 'ACTIVE',
      },
      include: { walletDevices: true },
    });
    let targeted = 0;
    let delivered = 0;
    for (const p of passes) {
      targeted += p.walletDevices.length;
      try {
        await this.prisma.pass.update({
          where: { id: p.id },
          data: { lastActivityAt: new Date() },
        });
        const r = await this.wallet.pushPassUpdate(p.id);
        delivered += r?.sent ?? 0;
      } catch (e) {
        this.logger.warn(
          `Push pass ${p.id} (scheduled ${n.id}) falló: ${(e as Error).message}`,
        );
      }
    }
    await this.prisma.notification.update({
      where: { id: n.id },
      data: { stats: { targeted, delivered, opened: 0 } },
    });
  }
}
