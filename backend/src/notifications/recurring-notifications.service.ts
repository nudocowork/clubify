import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { WalletService } from '../wallet/wallet.service';
import { CONCURRENCIA_DEL_PUSH, enTandas, entregadosDelPush } from './envio-en-tandas';

export type RecurringNotificationDto = {
  cardId?: string | null;
  title: string;
  body: string;
  segment?: Record<string, any>;
  daysOfWeek: number[];
  timeOfDay: string; // "HH:MM"
  timezone?: string;
  isActive?: boolean;
};

/**
 * Notificaciones PUSH RECURRENTES (#1 spec 2026-06-12).
 *
 * Modelo distinto a Notification (one-shot): el dueño guarda una
 * plantilla con días + hora y el cron la dispara N veces a la semana
 * en la zona horaria configurada.
 *
 * Cuando dispara crea una fila `Notification` con triggerType=SCHEDULED
 * como audit trail del envío real — así el dueño ve en el historial
 * cada disparo individual de la recurrencia.
 */
@Injectable()
export class RecurringNotificationsService {
  private logger = new Logger(RecurringNotificationsService.name);
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
    return this.prisma.recurringNotification.findMany({
      where: { tenantId: tid },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(user: AuthUser, dto: RecurringNotificationDto, override?: string) {
    const tid = this.tid(user, override);
    this.assertValidDto(dto);
    // La del negocio, no la de Bogotá: el panel no manda zona y el dueño
    // escribe la hora de su reloj. El cron también la lee del negocio
    // (`zonaDe`); esto deja la fila coherente con lo que de verdad pasa.
    const negocio = dto.timezone
      ? null
      : await this.prisma.tenant.findUnique({
          where: { id: tid },
          select: { timezone: true },
        });
    return this.prisma.recurringNotification.create({
      data: {
        tenantId: tid,
        cardId: dto.cardId ?? null,
        title: dto.title.trim(),
        body: dto.body.trim(),
        segment: dto.segment ?? undefined,
        daysOfWeek: Array.from(new Set(dto.daysOfWeek)).filter((d) => d >= 0 && d <= 6),
        timeOfDay: dto.timeOfDay,
        timezone: dto.timezone || negocio?.timezone || 'America/Bogota',
        isActive: dto.isActive ?? true,
      },
    });
  }

  async update(user: AuthUser, id: string, patch: Partial<RecurringNotificationDto>) {
    const existing = await this.requireOwned(user, id);
    if (patch.daysOfWeek || patch.timeOfDay || patch.title || patch.body) {
      this.assertValidDto({
        title: patch.title ?? existing.title,
        body: patch.body ?? existing.body,
        daysOfWeek: patch.daysOfWeek ?? existing.daysOfWeek,
        timeOfDay: patch.timeOfDay ?? existing.timeOfDay,
      });
    }
    return this.prisma.recurringNotification.update({
      where: { id },
      data: {
        cardId: patch.cardId === undefined ? undefined : patch.cardId ?? null,
        title: patch.title?.trim(),
        body: patch.body?.trim(),
        segment: patch.segment,
        daysOfWeek: patch.daysOfWeek
          ? Array.from(new Set(patch.daysOfWeek)).filter((d) => d >= 0 && d <= 6)
          : undefined,
        timeOfDay: patch.timeOfDay,
        timezone: patch.timezone,
        isActive: patch.isActive,
      },
    });
  }

  async remove(user: AuthUser, id: string) {
    await this.requireOwned(user, id);
    await this.prisma.recurringNotification.delete({ where: { id } });
    return { ok: true };
  }

  private async requireOwned(user: AuthUser, id: string) {
    const r = await this.prisma.recurringNotification.findUnique({ where: { id } });
    if (!r) throw new NotFoundException();
    if (user.role !== 'SUPER_ADMIN' && r.tenantId !== user.tenantId) {
      throw new ForbiddenException();
    }
    return r;
  }

  private assertValidDto(dto: {
    title: string;
    body: string;
    daysOfWeek: number[];
    timeOfDay: string;
  }) {
    if (!dto.title?.trim()) throw new ForbiddenException('Título requerido');
    if (!dto.body?.trim()) throw new ForbiddenException('Mensaje requerido');
    if (!Array.isArray(dto.daysOfWeek) || dto.daysOfWeek.length === 0) {
      throw new ForbiddenException('Elegí al menos un día de la semana');
    }
    if (!/^\d{2}:\d{2}$/.test(dto.timeOfDay)) {
      throw new ForbiddenException('Hora inválida (esperado HH:MM)');
    }
    const [h, m] = dto.timeOfDay.split(':').map(Number);
    if (h < 0 || h > 23 || m < 0 || m > 59) {
      throw new ForbiddenException('Hora fuera de rango');
    }
  }

  // ============================================================
  //                       CRON DISPATCH
  // ============================================================

  /**
   * Cron cada 5 min: para cada RecurringNotification activa, calcula
   * si en ESTE momento (en su timezone) toca disparar y no se disparó
   * todavía hoy. Window de tolerancia: 5min después de la hora exacta.
   *
   * Idempotency:
   *  - lastDispatchedAt se actualiza PRIMERO antes del dispatch real
   *    para que dos pods concurrentes no se pisen.
   *  - Comparamos lastDispatchedAt vs "fecha local de hoy en TZ" — si
   *    ya hay un dispatch hoy, skip.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async dispatchDue() {
    const schedules = await this.prisma.recurringNotification.findMany({
      where: { isActive: true },
      include: { tenant: { select: { timezone: true } } },
    });
    if (schedules.length === 0) return;

    const now = new Date();
    const reclamadas: typeof schedules = [];
    for (const s of schedules) {
      try {
        const tz = this.zonaDe(s);
        const fire = this.shouldFire({ ...s, timezone: tz }, now);
        if (!fire) continue;
        // Claim atómico: solo actualizamos si lastDispatchedAt NO está
        // dentro del mismo día local (race contra otro pod).
        const cutoff = this.startOfDayInTz(now, tz);
        const claim = await this.prisma.recurringNotification.updateMany({
          where: {
            id: s.id,
            OR: [
              { lastDispatchedAt: null },
              { lastDispatchedAt: { lt: cutoff } },
            ],
          },
          data: { lastDispatchedAt: now },
        });
        if (claim.count === 0) continue; // otro pod ganó
        reclamadas.push(s);
      } catch (e) {
        this.logger.warn(
          `RecurringNotification ${s.id} claim falló: ${(e as Error).message}`,
        );
      }
    }

    // TODAS A LA VEZ, no en fila. Antes se despachaban una detrás de otra y el
    // negocio pequeño esperaba a que acabaran los grandes que tocaban a la
    // misma hora: «GASEOSA GRATIS» de Hacienda Don Antonio salía a las
    // 12:04–12:09 los días que Jamarea y Marea Místika también enviaban a las
    // 12:00, y a las 12:00 en punto los días que no (2026-10-01).
    await Promise.all(
      reclamadas.map((s) =>
        this.dispatch(s).catch((e) =>
          this.logger.warn(
            `RecurringNotification ${s.id} dispatch falló: ${(e as Error).message}`,
          ),
        ),
      ),
    );
  }

  /**
   * La zona en la que se lee «a las 12:00»: la DEL NEGOCIO.
   *
   * El panel nunca ha mandado zona, así que todas las recurrencias se
   * guardaban con la de Bogotá por defecto. Para Perú no se nota (misma hora),
   * pero a los negocios de Nueva York les llegaba una hora tarde todo el
   * horario de verano. El dueño escribe la hora de SU reloj.
   */
  private zonaDe(s: { timezone: string; tenant?: { timezone: string | null } | null }) {
    const delNegocio = s.tenant?.timezone?.trim();
    return delNegocio || s.timezone || 'America/Bogota';
  }

  /** Cuánto después de la hora todavía se envía si el tick se perdió. */
  private static readonly VENTANA_MIN = 30;

  /**
   * Determina si la recurrencia debería disparar AHORA mismo:
   *  - Hoy (en su zona) está incluido en daysOfWeek.
   *  - La hora actual está entre [timeOfDay, timeOfDay + VENTANA_MIN].
   *
   * La ventana era de 5 minutos, igual que el cron: si se perdía UN tick (un
   * despliegue, un reinicio), ese envío no salía ese día, ni tarde. Ahora se
   * recupera dentro de la media hora. No puede salir dos veces: el claim es
   * por día local.
   *
   * Implementación: usa Intl.DateTimeFormat para obtener weekday + HH:mm
   * en la zona sin depender de date-fns-tz.
   */
  private shouldFire(
    s: {
      daysOfWeek: number[];
      timeOfDay: string;
      timezone: string;
      updatedAt?: Date;
    },
    now: Date,
  ): boolean {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: s.timezone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = fmt.formatToParts(now);
    const weekdayStr = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun';
    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
    const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');

    const weekdayMap: Record<string, number> = {
      Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
    };
    const today = weekdayMap[weekdayStr] ?? 0;
    if (!s.daysOfWeek.includes(today)) return false;

    const [schH, schM] = s.timeOfDay.split(':').map(Number);
    const nowMinutes = hour * 60 + minute;
    const schedMinutes = schH * 60 + schM;
    const delta = nowMinutes - schedMinutes;
    if (delta < 0 || delta > RecurringNotificationsService.VENTANA_MIN) return false;
    if (delta <= 5) return true;
    // Fuera del tick normal, solo se RECUPERA un envío perdido. Si la
    // recurrencia se creó o se editó después de la hora de hoy, no hay nada
    // que recuperar: crear a las 12:10 algo «para las 12:00» no debe salir ya.
    // (`updatedAt` también lo mueve el propio claim de ayer, que es anterior.)
    const instanteDeHoy = now.getTime() - (delta * 60 + now.getUTCSeconds()) * 1000;
    if (s.updatedAt && s.updatedAt.getTime() > instanteDeHoy) return false;
    return true;
  }

  /**
   * Devuelve el instante UTC que corresponde a las 00:00 de "hoy" en la
   * timezone dada. Sirve como cutoff para detectar si ya hubo dispatch
   * hoy (lastDispatchedAt < cutoff = no dispatch hoy todavía).
   */
  private startOfDayInTz(now: Date, timezone: string): Date {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = fmt.formatToParts(now);
    const y = parts.find((p) => p.type === 'year')?.value;
    const m = parts.find((p) => p.type === 'month')?.value;
    const d = parts.find((p) => p.type === 'day')?.value;
    // Construímos "YYYY-MM-DDT00:00:00" interpretado en la TZ y lo
    // convertimos a UTC. Hack: usar la TZ ofst via second pass.
    const localMidnight = new Date(`${y}-${m}-${d}T00:00:00Z`);
    // localMidnight ahora está en UTC con esos componentes. Para
    // ajustar al ofst de la TZ, calculamos el delta entre el "now" UTC
    // y como Intl lo presenta en TZ.
    const tzNow = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
    const utcNow = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
    const offset = tzNow.getTime() - utcNow.getTime();
    return new Date(localMidnight.getTime() - offset);
  }

  /**
   * Dispatch real: crea una Notification con triggerType=SCHEDULED y
   * empuja a todos los wallet passes del tenant filtrando por cardId
   * si está set.
   */
  private async dispatch(s: {
    id: string;
    tenantId: string;
    cardId: string | null;
    title: string;
    body: string;
    segment: any;
  }) {
    // Notification PRIMERO (broadcast: customerId null → la ve todo el tenant):
    // así el pase Apple, al re-armarse en el push, ya lee este texto en
    // lastMessage. Stats se actualizan después con los conteos reales.
    const notif = await this.prisma.notification.create({
      data: {
        tenantId: s.tenantId,
        cardId: s.cardId,
        title: s.title,
        body: s.body,
        segment: s.segment ?? {},
        triggerType: 'SCHEDULED',
        sentAt: new Date(),
        stats: { source: 'recurring', recurringId: s.id },
      },
    });

    const inicio = Date.now();
    const passes = await this.prisma.pass.findMany({
      where: {
        tenantId: s.tenantId,
        ...(s.cardId ? { cardId: s.cardId } : {}),
        status: 'ACTIVE',
      },
      select: {
        id: true,
        googleObjectId: true,
        walletDevices: { where: { platform: 'APPLE' }, select: { id: true } },
      },
    });
    // Apple + Google. Contar solo los dispositivos de Apple decía «0
    // destinatarios» en un envío que sí salía: el 70% de los pases están en
    // Google, donde no hay «dispositivos» sino un objeto.
    const targeted = passes.reduce(
      (acc, p) => acc + p.walletDevices.length + (p.googleObjectId ? 1 : 0),
      0,
    );
    // Una escritura para todos, no una por pase dentro del bucle.
    await this.prisma.pass
      .updateMany({
        where: { id: { in: passes.map((p) => p.id) } },
        data: { lastActivityAt: new Date() },
      })
      .catch(() => null);

    let delivered = 0;
    await enTandas(passes, CONCURRENCIA_DEL_PUSH, async (p) => {
      try {
        const r = await this.wallet.pushPassUpdate(p.id, {
          message: { header: s.title, body: s.body },
        });
        delivered += entregadosDelPush(r);
      } catch (e) {
        this.logger.warn(
          `Push pass ${p.id} (recurring ${s.id}) falló: ${(e as Error).message}`,
        );
      }
    });
    await this.prisma.notification.update({
      where: { id: notif.id },
      data: {
        stats: { targeted, delivered, opened: 0, source: 'recurring', recurringId: s.id },
      },
    });
    this.logger.log(
      `Recurring ${s.id} disparado: ${targeted} devices, ${delivered} delivered, ${passes.length} pases en ${Math.round((Date.now() - inicio) / 1000)} s`,
    );
  }
}
