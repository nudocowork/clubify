import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { WalletService } from '../wallet/wallet.service';

export type NotificationDto = {
  cardId?: string;
  /** Si viene, el push va SOLO a los pases de ese cliente (envío individual
   *  desde la ficha del cliente). Sin él, es broadcast al tenant/card. */
  customerId?: string;
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
   * Busca un envío programado (fecha única) del tenant que AÚN esté pendiente.
   * Un pendiente = triggerType SCHEDULED + scheduledAt seteado + sentAt null.
   * Lanza si no existe, si es de otro tenant o si ya se despachó.
   */
  private async requireScheduledPending(tid: string, id: string) {
    const n = await this.prisma.notification.findUnique({ where: { id } });
    if (!n || n.tenantId !== tid) {
      throw new NotFoundException('Envío no encontrado');
    }
    if (n.sentAt) {
      throw new BadRequestException(
        'Este envío ya se realizó y no se puede modificar ni cancelar.',
      );
    }
    if (!n.scheduledAt) {
      throw new BadRequestException(
        'Solo se pueden modificar o cancelar los envíos programados a una fecha.',
      );
    }
    return n;
  }

  /** Cancela un envío programado (fecha única) que aún no se ha enviado. */
  async cancelScheduled(user: AuthUser, id: string, override?: string) {
    const tid = this.tid(user, override);
    // Valida existencia/tenant/tipo y da un error claro si ya se envió.
    await this.requireScheduledPending(tid, id);
    // Borrado ATÓMICO con guard sentAt:null: si el cron (cada 5 min) marcó
    // sentAt entre el check y este delete, count=0 → NO borramos un envío que
    // ya salió y avisamos. Evita la carrera del check-then-act.
    const res = await this.prisma.notification.deleteMany({
      where: { id, tenantId: tid, sentAt: null },
    });
    if (res.count === 0) {
      throw new BadRequestException(
        'Este envío ya se realizó y no se pudo cancelar.',
      );
    }
    return { ok: true };
  }

  /** Edita título/cuerpo/fecha de un envío programado aún no enviado. */
  async updateScheduled(
    user: AuthUser,
    id: string,
    dto: { title?: string; body?: string; scheduledAt?: string },
    override?: string,
  ) {
    const tid = this.tid(user, override);
    await this.requireScheduledPending(tid, id);
    const data: any = {};
    if (typeof dto.title === 'string' && dto.title.trim()) {
      data.title = dto.title.trim();
    }
    if (typeof dto.body === 'string' && dto.body.trim()) {
      data.body = dto.body.trim();
    }
    if (dto.scheduledAt) {
      const when = new Date(dto.scheduledAt);
      if (
        !Number.isFinite(when.getTime()) ||
        when.getTime() <= Date.now() + 30_000
      ) {
        throw new BadRequestException('La nueva fecha debe estar en el futuro.');
      }
      data.scheduledAt = when;
    }
    // Edición ATÓMICA con guard sentAt:null (misma carrera con el cron que en
    // cancelScheduled): si ya se despachó, count=0 → avisamos y no editamos.
    const res = await this.prisma.notification.updateMany({
      where: { id, tenantId: tid, sentAt: null },
      data,
    });
    if (res.count === 0) {
      throw new BadRequestException(
        'Este envío ya se realizó y no se pudo editar.',
      );
    }
    return this.prisma.notification.findUnique({ where: { id } });
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
        // Envío individual: solo los pases del cliente indicado.
        ...(dto.customerId ? { customerId: dto.customerId } : {}),
        status: 'ACTIVE',
      },
      include: { walletDevices: true },
    });

    // Crear la Notification ANTES del push (broadcast → customerId null = la ve
    // todo el tenant). Apple lee este texto vía el backField `lastMessage` al
    // re-fetchear el .pkpass; antes se creaba DESPUÉS del push → Apple mostraba
    // el mensaje anterior. A Google se le pasa el texto en opts.message
    // (addMessage TEXT_AND_NOTIFY); antes iba sin mensaje → caía al genérico
    // "Sellos: 0/10".
    const notif = await this.prisma.notification.create({
      data: {
        tenantId: tid,
        cardId: dto.cardId,
        // Envío individual → customerId set: Apple filtra el lastMessage por
        // cliente (no le muestra a otros el mensaje ajeno).
        customerId: dto.customerId ?? null,
        title: dto.title,
        body: dto.body,
        segment: dto.segment ?? {},
        triggerType: 'MANUAL',
        sentAt: new Date(),
        stats: { targeted: 0, delivered: 0, opened: 0 },
      },
    });

    let targeted = 0;
    let delivered = 0;
    for (const p of passes) {
      // FIX 2026-08-28: los dos contadores miraban SOLO Apple.
      //
      // `walletDevices` es la tabla de registros de Apple, y `pushPassUpdate`
      // devuelve el resultado de Google aparte, en `.google`. Así que a un
      // cliente de Google Wallet el push SÍ le salía, pero el panel informaba
      // «0 destinatarios» — y el negocio lo leía como que ese cliente no tenía
      // la tarjeta.
      //
      // No es un caso raro: de 5.083 pases, 3.579 son de Google y 1.276 de
      // Apple. O sea que el contador mentía para la mayoría.
      const tieneGoogle = !!p.googleObjectId;
      const alcanzables = p.walletDevices.length + (tieneGoogle ? 1 : 0);
      targeted += alcanzables;
      this.logger.log(
        `Push to pass ${p.id} (${p.walletDevices.length} Apple + ${tieneGoogle ? 1 : 0} Google)`,
      );
      try {
        await this.prisma.pass.update({
          where: { id: p.id },
          data: { lastActivityAt: new Date() },
        });
        // Pasamos el texto real → Apple (lastMessage) + Google (addMessage) lo
        // muestran, en vez del genérico de sellos.
        const r = await this.wallet.pushPassUpdate(p.id, {
          message: { header: dto.title, body: dto.body },
        });
        // `sent` son los de Apple; Google va aparte y solo cuenta si de verdad
        // salió (`ok`), no si simplemente se intentó.
        delivered += (r?.sent ?? 0) + (r?.google?.ok ? 1 : 0);
      } catch (e) {
        this.logger.warn(`Push pass ${p.id} falló: ${(e as Error).message}`);
      }
    }

    this.logger.log(
      `Notification "${dto.title}" → ${targeted} devices targeted, ${delivered} delivered`,
    );

    return this.prisma.notification.update({
      where: { id: notif.id },
      data: { stats: { targeted, delivered, opened: 0 } },
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
    customerId?: string | null;
    title: string;
    body: string;
  }) {
    const passes = await this.prisma.pass.findMany({
      where: {
        tenantId: n.tenantId,
        ...(n.cardId ? { cardId: n.cardId } : {}),
        // PDF 2026-06-30: si la notificación es individual (automatizaciones:
        // cumpleaños, bienvenida, etc.) DEBE ir solo al pase de ESE cliente.
        // Sin este filtro, una notificación programada con customerId se
        // emitiría a todos los pases del tenant (broadcast no deseado).
        ...(n.customerId ? { customerId: n.customerId } : {}),
        status: 'ACTIVE',
      },
      include: { walletDevices: true },
    });
    let targeted = 0;
    let delivered = 0;
    for (const p of passes) {
      // Apple + Google. Contar solo los dispositivos de Apple decía «0
      // destinatarios» en un envío que sí salía: el 70% de los pases están en
      // Google, donde no hay «dispositivos» sino un objeto. El arreglo se hizo
      // en el envío inmediato y se quedó sin aplicar en esta ruta.
      const tieneGoogle = !!p.googleObjectId;
      targeted += p.walletDevices.length + (tieneGoogle ? 1 : 0);
      try {
        await this.prisma.pass.update({
          where: { id: p.id },
          data: { lastActivityAt: new Date() },
        });
        const r = await this.wallet.pushPassUpdate(p.id, {
          message: { header: n.title, body: n.body },
        });
        // `sent` son los de Apple; Google va aparte y solo cuenta si de
        // verdad salió (`ok`), no si simplemente se intentó.
        delivered += (r?.sent ?? 0) + (r?.google?.ok ? 1 : 0);
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
