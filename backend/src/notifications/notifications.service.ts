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

/**
 * Error de despacho que además dice a cuántos pases se llegó a empujar.
 *
 * Hace falta para decidir si una programada fallida se puede reintentar: con 0
 * pases empujados no la recibió nadie y se puede devolver a pendiente; a
 * medias, reintentarla se la duplicaría a quien ya la tiene.
 */
class DespachoFallido extends Error {
  constructor(
    readonly causa: Error,
    readonly pushesHechos: number,
  ) {
    super(causa.message);
    this.name = 'DespachoFallido';
  }
}

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
    // Fuera del try: el catch necesita saber a cuántos pases se llegó a
    // empujar para decidir si la fila se puede reintentar o no.
    let delivered = 0;
    let hechos = 0;
    try {
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

      return await this.prisma.notification.update({
        where: { id: n.id },
        data: { stats: { targeted, delivered, opened: 0 } },
      });
    } catch (e) {
      // Se envuelve para que quien llamó sepa si ALGUIEN llegó a recibirlo: con
      // 0 pases empujados la fila se puede devolver a pendiente y reintentar;
      // a medias, reintentarla se la duplicaría a quien ya la tiene.
      throw new DespachoFallido(e as Error, hechos);
    }
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
   * sentAt, y las despacha UNA sola vez.
   *
   * EL BUG (reportado por varios negocios): «se deja programado el envío a una
   * hora y se repite 2 o 3 veces en lapso de minutos».
   *
   * La causa era leer-decidir-escribir sin atomicidad. Esto de abajo *parece*
   * idempotente y no lo es:
   *
   *     const due = await findMany({ sentAt: null, ... });   // (1) lee
   *     for (const n of due) {
   *       await update({ where: { id: n.id }, data: { sentAt } });  // (2) escribe
   *       await this.despachar(n);
   *     }
   *
   * `update` por id NO comprueba que la fila siguiera pendiente: pisa `sentAt`
   * y no dice si alguien se le adelantó. Y adelantarse es fácil sin necesidad
   * de dos servidores: el cron corre cada 5 minutos, se lleva hasta 50 filas y
   * las despacha **en serie**, esperando el push de cada pase. Un negocio de
   * 400 pases tarda minutos, así que el tick de las 10:05 arranca con el de
   * las 10:00 todavía a mitad de la lista; las filas que el primero aún no ha
   * tocado siguen con `sentAt: null`, el segundo tick las ve, las marca y las
   * envía, y cuando el primero llega a ellas las envía **otra vez**. De ahí el
   * «2 o 3 veces en pocos minutos», con exactamente 5 minutos entre copias.
   *
   * El arreglo es el de la casa: UPDATE condicional y mirar el `count`. Marcar
   * sentAt SOLO si seguía en null; si tocó 0 filas es que otra corrida ya se la
   * llevó, y entonces no se envía. Ante la duda, no enviar: un push repetido le
   * llega a clientes reales.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async dispatchScheduled() {
    // Cerrojo en memoria: además de la carrera por fila, evita que dos ticks
    // del mismo proceso se pisen recorriendo la misma lista. No sustituye al
    // claim atómico de abajo (eso sería volver al check-then-act), lo acompaña.
    //
    // CADUCA a propósito. Guardaba un booleano y `pushPassUpdate` no tiene
    // timeout: si un push a Apple o Google se queda colgado, `enTandas` no
    // resuelve nunca, el `finally` no llega y el cerrojo se queda cerrado para
    // siempre. Eso apagaba TODAS las programadas de TODOS los negocios hasta
    // el siguiente reinicio, con un warn cada 5 minutos que no mira nadie.
    // Antes de este cerrojo, un tick colgado perdía sus filas pero el
    // siguiente seguía trabajando; hay que conservar esa propiedad. Pasados 15
    // minutos se da por muerto y se sigue: el claim atómico por fila es quien
    // impide el doble envío, el cerrojo solo evita trabajo repetido.
    const ahora = Date.now();
    const arrancado = this.despachoProgramadasArrancadoEn;
    if (
      arrancado !== null &&
      ahora - arrancado < NotificationsService.CERROJO_CADUCA_MS
    ) {
      this.logger.warn(
        'Cron de programadas: el tick anterior sigue en curso, se salta este',
      );
      return;
    }
    if (arrancado !== null) {
      this.logger.error(
        `Cron de programadas: el tick anterior lleva ${Math.round(
          (ahora - arrancado) / 60000,
        )} min sin terminar (¿push colgado?). Se ignora el cerrojo y se sigue.`,
      );
    }
    this.despachoProgramadasArrancadoEn = ahora;
    try {
      await this.recorrerProgramadasVencidas();
    } finally {
      // Solo lo suelta quien lo cogió: si un tick zombi termina tarde, no debe
      // abrirle el cerrojo al que está trabajando ahora.
      if (this.despachoProgramadasArrancadoEn === ahora) {
        this.despachoProgramadasArrancadoEn = null;
      }
    }
  }

  /** Cuándo arrancó el tick en curso, o null. Ver `dispatchScheduled`. */
  private despachoProgramadasArrancadoEn: number | null = null;
  /** Pasado esto, un tick se da por muerto y no bloquea a los siguientes. */
  private static readonly CERROJO_CADUCA_MS = 15 * 60 * 1000;
  /** Cuántas veces se reintenta una programada que falló sin enviar a nadie. */
  private static readonly MAX_INTENTOS = 3;

  private async recorrerProgramadasVencidas() {
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
        // CLAIM ATÓMICO. `sentAt: null` en el WHERE es lo que hace que esto sea
        // una carrera con un solo ganador: Postgres resuelve el UPDATE fila a
        // fila, así que de dos corridas simultáneas una obtiene count=1 y la
        // otra count=0. Solo la que gana envía.
        const claim = await this.prisma.notification.updateMany({
          where: { id: n.id, sentAt: null },
          data: { sentAt: now },
        });
        if (claim.count !== 1) {
          // Otra corrida del cron ya se llevó este envío. No es un error.
          this.logger.log(
            `Programada ${n.id} ya la despachó otra corrida — no se reenvía`,
          );
          continue;
        }
        await this.despachar(n);
      } catch (e) {
        await this.recuperarProgramadaFallida(n, e as Error);
      }
    }
  }

  /**
   * Una programada que se marcó como enviada y después falló.
   *
   * `sentAt` se pone ANTES de despachar —es el claim que evita el doble
   * envío—, así que si `despachar` revienta la fila se queda marcada y nadie
   * la reintenta: el negocio la ve como «enviada» y al cliente no le llegó
   * nada. En 31 días de datos no ha pasado ninguna vez, pero el modo existe.
   *
   * - Si NO se empujó ningún pase, no la recibió nadie: vuelve a pendiente y
   *   el próximo tick la reintenta. Con tope, para que una fila rota no se
   *   reintente cada 5 minutos para siempre.
   * - Si se envió A MEDIAS no se reintenta, porque se la duplicaría a quien ya
   *   la recibió. Se deja el error en `stats` para que se vea en el panel.
   */
  private async recuperarProgramadaFallida(
    n: { id: string; stats?: unknown },
    e: Error,
  ) {
    const hechos = e instanceof DespachoFallido ? e.pushesHechos : 0;
    const previos = Number((n.stats as { intentos?: number })?.intentos ?? 0);
    const intento = previos + 1;

    if (hechos > 0) {
      this.logger.error(
        `Programada ${n.id} se envió a medias (${hechos} pases) y falló: ${e.message}. No se reintenta.`,
      );
      await this.prisma.notification
        .update({
          where: { id: n.id },
          data: {
            stats: { incompleto: true, pushesHechos: hechos, error: e.message },
          },
        })
        .catch(() => null);
      return;
    }

    if (intento >= NotificationsService.MAX_INTENTOS) {
      this.logger.error(
        `Programada ${n.id} falló ${intento} veces sin enviar a nadie: ${e.message}. Se abandona.`,
      );
      await this.prisma.notification
        .update({
          where: { id: n.id },
          data: { stats: { error: e.message, intentos: intento, abandonada: true } },
        })
        .catch(() => null);
      return;
    }

    // Condicional: si otra corrida ya la despachó de verdad, no la resucitamos.
    const vuelta = await this.prisma.notification
      .updateMany({
        where: { id: n.id, sentAt: { not: null } },
        data: { sentAt: null, stats: { error: e.message, intentos: intento } },
      })
      .catch(() => ({ count: 0 }));
    this.logger.warn(
      `Programada ${n.id} falló sin enviar a nadie (${e.message}) — ` +
        (vuelta.count === 1
          ? `vuelve a pendiente, intento ${intento}`
          : 'no se pudo devolver a pendiente'),
    );
  }
}
