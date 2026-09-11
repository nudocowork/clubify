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
   * Los pases a los que va este envío, con lo que hace falta para contar
   * destinos: una sola consulta, no una por pase.
   */
  private async pasesDestino(f: {
    tenantId: string;
    cardId?: string | null;
    customerId?: string | null;
  }) {
    return this.prisma.pass.findMany({
      where: {
        tenantId: f.tenantId,
        ...(f.cardId ? { cardId: f.cardId } : {}),
        // PDF 2026-06-30: si la notificación es individual (automatizaciones:
        // cumpleaños, bienvenida...) DEBE ir solo al pase de ESE cliente. Sin
        // este filtro se emitiría a todos los pases del negocio.
        ...(f.customerId ? { customerId: f.customerId } : {}),
        status: 'ACTIVE',
      },
      select: {
        id: true,
        googleObjectId: true,
        // Solo Apple: es a lo que se le manda APNs. Contar también los
        // registros de Google inflaba el «destinatarios» del panel.
        walletDevices: { where: { platform: 'APPLE' }, select: { id: true } },
      },
    });
  }

  /**
   * A cuántos dispositivos llega. Apple cuenta por registro; de Google hay uno
   * por pase.
   *
   * FIX 2026-08-28: los dos contadores miraban SOLO Apple, y de 5.083 pases
   * 3.579 son de Google. El push le salía al cliente de Android y el panel
   * informaba «0 destinatarios» — que el negocio leía como que ese cliente no
   * tenía la tarjeta.
   */
  private alcanzables(p: {
    googleObjectId: string | null;
    walletDevices: unknown[];
  }) {
    return p.walletDevices.length + (p.googleObjectId ? 1 : 0);
  }

  /** De cuántos en cuántos se despacha. Ver `enTandas`. */
  private static readonly CONCURRENCIA = 8;

  /**
   * Recorre los pases de a `CONCURRENCIA` en vez de uno detrás de otro.
   *
   * El push de un pase es casi todo espera de red (PATCH a Google + APNs), así
   * que en serie el tiempo total era la SUMA de todas. Un negocio de 500
   * clientes tardaba minutos.
   */
  private async enTandas<T>(items: T[], fn: (item: T) => Promise<void>) {
    const n = NotificationsService.CONCURRENCIA;
    for (let i = 0; i < items.length; i += n) {
      await Promise.all(items.slice(i, i + n).map(fn));
    }
  }

  /**
   * Hace el push real a los pases y deja el resultado en `stats`.
   *
   * **No se espera desde la petición HTTP.** El envío a un negocio grande dura
   * lo que dure aunque vaya en paralelo, y antes el POST /notifications no
   * respondía hasta terminarlo: el panel se quedaba en «Enviando…» hasta que
   * el navegador cortaba, y el negocio le daba otra vez — así salieron dos
   * envíos idénticos a Fusion sushi el 2026-09-11 con 4 minutos de diferencia.
   * Ahora la notificación se crea, se responde, y esto sigue por detrás
   * actualizando `stats`.
   */
  private async despachar(n: {
    id: string;
    tenantId: string;
    cardId: string | null;
    customerId?: string | null;
    title: string;
    body: string;
  }) {
    const passes = await this.pasesDestino(n);
    const targeted = passes.reduce((acc, p) => acc + this.alcanzables(p), 0);

    // `lastActivityAt` de todos de una vez: era una escritura por pase dentro
    // del bucle, y no aportaba nada al push.
    await this.prisma.pass
      .updateMany({
        where: { id: { in: passes.map((p) => p.id) } },
        data: { lastActivityAt: new Date() },
      })
      .catch(() => null);

    let delivered = 0;
    let hechos = 0;
    await this.enTandas(passes, async (p) => {
      try {
        // Pasamos el texto real → Apple (lastMessage) + Google (addMessage) lo
        // muestran, en vez del genérico de sellos.
        const r = await this.wallet.pushPassUpdate(p.id, {
          message: { header: n.title, body: n.body },
        });
        // `sent` son los de Apple; Google va aparte y solo cuenta si de verdad
        // salió (`ok`), no si simplemente se intentó.
        delivered += (r?.sent ?? 0) + (r?.google?.ok ? 1 : 0);
      } catch (e) {
        this.logger.warn(
          `Push pass ${p.id} (${n.id}) falló: ${(e as Error).message}`,
        );
      }
      hechos += 1;
      // Progreso cada varias tandas: el panel enseña por dónde va un envío
      // largo, en vez de un cero hasta el final.
      if (hechos % 40 === 0) {
        await this.prisma.notification
          .update({
            where: { id: n.id },
            data: { stats: { targeted, delivered, opened: 0, enCurso: true } },
          })
          .catch(() => null);
      }
    });

    this.logger.log(
      `Notification "${n.title}" → ${targeted} devices targeted, ${delivered} delivered`,
    );

    return this.prisma.notification.update({
      where: { id: n.id },
      data: { stats: { targeted, delivered, opened: 0 } },
    });
  }

  /**
   * Crea la Notification y arranca el envío, sin esperarlo.
   *
   * La Notification se crea ANTES del push (broadcast → customerId null = la ve
   * todo el negocio). Apple lee este texto vía el backField `lastMessage` al
   * re-fetchear el .pkpass; antes se creaba DESPUÉS del push → Apple mostraba
   * el mensaje anterior. A Google se le pasa el texto en opts.message
   * (addMessage TEXT_AND_NOTIFY); antes iba sin mensaje → caía al genérico
   * «Sellos: 0/10».
   */
  private async dispatchNow(tid: string, dto: NotificationDto) {
    // Se cuenta antes para poder decirle al negocio a cuántos va ya en la
    // respuesta. Es una consulta, no una por pase.
    const passes = await this.pasesDestino({
      tenantId: tid,
      cardId: dto.cardId,
      customerId: dto.customerId,
    });
    const targeted = passes.reduce((acc, p) => acc + this.alcanzables(p), 0);

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
        stats: { targeted, delivered: 0, opened: 0, enCurso: true },
      },
    });

    // Sin `await`: el panel no puede quedarse esperando a cientos de pushes. Si
    // el proceso se reinicia a mitad, el envío queda incompleto y
    // `stats.enCurso` se queda en true — que es justo lo que hay que ver.
    void this.despachar({
      id: notif.id,
      tenantId: tid,
      cardId: dto.cardId ?? null,
      customerId: dto.customerId ?? null,
      title: dto.title,
      body: dto.body,
    }).catch((e) =>
      this.logger.error(
        `Despacho ${notif.id} falló entero: ${(e as Error).message}`,
      ),
    );

    return notif;
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
        await this.despachar(n);
      } catch (e) {
        this.logger.warn(
          `Despacho programado ${n.id} falló: ${(e as Error).message}`,
        );
      }
    }
  }
}
