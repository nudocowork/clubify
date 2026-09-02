import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { nanoid } from 'nanoid';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { WalletService } from '../wallet/wallet.service';
import { QueueService } from '../jobs/queue.service';
import { genQrToken } from '../passes/passes.service';
import {
  cupoDeAlta,
  diaDelMes,
  errorDeTramos,
  periodoDe,
  tocaReiniciar,
  type TramoAlta,
} from './club-periodo';

/**
 * Tarjeta de Club: el cliente le paga una suscripción AL NEGOCIO y recibe un
 * cupo mensual de beneficios que va gastando.
 *
 * El cobro es MANUAL: el negocio cobra por fuera y pausa o reactiva la
 * membresía a mano. Aquí no se toca ninguna pasarela.
 */
@Injectable()
export class ClubService {
  private logger = new Logger(ClubService.name);

  constructor(
    private prisma: PrismaService,
    private wallet: WalletService,
    private jobs: QueueService,
  ) {}

  /**
   * Empuja el pase actualizado a la billetera del cliente.
   *
   * Copiado tal cual de `stamps.service`: si BullMQ tiene Redis, el worker lo
   * consume; si no, se cae al push directo. Llamar a los dos siempre mandaba
   * el pase dos veces al iPhone.
   *
   * Sin esto el cliente consume un café y su tarjeta sigue diciendo lo mismo.
   */
  private empujarPase(passId: string, motivo: string) {
    this.jobs
      .enqueue('wallet.push', { passId, reason: motivo })
      .catch(() => {
        this.wallet.pushPassUpdate(passId).catch(() => null);
      });
  }

  private tid(user: AuthUser, override?: string): string {
    const id = user.role === 'SUPER_ADMIN' && override ? override : user.tenantId;
    if (!id) throw new ForbiddenException('Sin negocio asociado.');
    return id;
  }

  /** El plan, comprobando que es de este negocio. */
  private async planDelNegocio(planId: string, tenantId: string) {
    const plan = await this.prisma.clubPlan.findFirst({
      where: { id: planId, tenantId },
      include: { tramos: { orderBy: { desdeDia: 'asc' } } },
    });
    if (!plan) throw new NotFoundException('Plan no encontrado.');
    return plan;
  }

  // ── Planes ──────────────────────────────────────────────────────────────

  async listarPlanes(user: AuthUser, override?: string) {
    const tenantId = this.tid(user, override);
    const planes = await this.prisma.clubPlan.findMany({
      where: { tenantId },
      include: { tramos: { orderBy: { desdeDia: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
    const conteos = await this.prisma.clubMembresia.groupBy({
      by: ['planId', 'status'],
      where: { plan: { tenantId } },
      _count: { _all: true },
    });
    return planes.map((p) => ({
      ...p,
      miembrosActivos:
        conteos.find((c) => c.planId === p.id && c.status === 'ACTIVA')?._count._all ?? 0,
      miembrosPausados:
        conteos.find((c) => c.planId === p.id && c.status === 'PAUSADA')?._count._all ?? 0,
    }));
  }

  async crearPlan(
    user: AuthUser,
    dto: {
      name: string;
      beneficiosPorMes: number;
      unidad?: string;
      precioCents?: number;
      currency?: string;
      description?: string;
      tramos?: TramoAlta[];
    },
    override?: string,
  ) {
    const tenantId = this.tid(user, override);
    if (!dto.name?.trim()) throw new BadRequestException('Falta el nombre del plan.');
    if (!Number.isInteger(dto.beneficiosPorMes) || dto.beneficiosPorMes < 1) {
      throw new BadRequestException('Los beneficios al mes deben ser 1 o más.');
    }
    const errTramos = errorDeTramos(dto.tramos ?? []);
    if (errTramos) throw new BadRequestException(errTramos);

    const slug = dto.name
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40);

    // El slug sale del nombre, así que dos planes llamados igual chocaban con
    // el índice único y Prisma devolvía un P2002 crudo: el negocio veía un 500
    // sin saber qué había hecho mal. Se le añade sufijo hasta que entre.
    const base = slug || 'plan';
    let libre = base;
    for (let i = 2; i <= 50; i++) {
      const choca = await this.prisma.clubPlan.findFirst({
        where: { tenantId, slug: libre },
        select: { id: true },
      });
      if (!choca) break;
      libre = `${base}-${i}`;
    }

    return this.prisma.clubPlan.create({
      data: {
        tenantId,
        name: dto.name.trim(),
        slug: libre,
        description: dto.description?.trim() ?? '',
        beneficiosPorMes: dto.beneficiosPorMes,
        unidad: dto.unidad?.trim() || 'beneficio',
        precioCents: dto.precioCents ?? 0,
        currency: dto.currency ?? 'COP',
        tramos: { create: dto.tramos ?? [] },
      },
      include: { tramos: true },
    });
  }

  async actualizarPlan(
    user: AuthUser,
    planId: string,
    dto: {
      name?: string;
      beneficiosPorMes?: number;
      unidad?: string;
      precioCents?: number;
      description?: string;
      isActive?: boolean;
      tramos?: TramoAlta[];
    },
    override?: string,
  ) {
    const tenantId = this.tid(user, override);
    await this.planDelNegocio(planId, tenantId);

    if (dto.beneficiosPorMes != null) {
      if (!Number.isInteger(dto.beneficiosPorMes) || dto.beneficiosPorMes < 1) {
        throw new BadRequestException('Los beneficios al mes deben ser 1 o más.');
      }
    }
    if (dto.tramos) {
      const err = errorDeTramos(dto.tramos);
      if (err) throw new BadRequestException(err);
    }

    return this.prisma.$transaction(async (tx) => {
      // Los tramos se reemplazan enteros: es más simple de razonar que
      // diferenciar altas y bajas, y son pocas filas.
      if (dto.tramos) {
        await tx.clubTramoAlta.deleteMany({ where: { planId } });
        if (dto.tramos.length) {
          await tx.clubTramoAlta.createMany({
            data: dto.tramos.map((t) => ({ ...t, planId })),
          });
        }
      }
      return tx.clubPlan.update({
        where: { id: planId },
        data: {
          name: dto.name?.trim(),
          description: dto.description?.trim(),
          beneficiosPorMes: dto.beneficiosPorMes,
          unidad: dto.unidad?.trim(),
          precioCents: dto.precioCents,
          isActive: dto.isActive,
        },
        include: { tramos: { orderBy: { desdeDia: 'asc' } } },
      });
    });
  }

  // ── Membresías ──────────────────────────────────────────────────────────

  /**
   * Da de alta a un cliente. El cupo del primer mes sale del tramo que
   * contenga el día de hoy.
   *
   * Si ya tenía membresía en este plan, NO se crea otra: se devuelve la suya.
   * El índice único es la red de verdad —un doble clic no puede duplicarle el
   * cupo— y esto evita que el segundo clic le reviente en la cara al negocio.
   */
  async darDeAlta(
    user: AuthUser,
    planId: string,
    customerId: string,
    override?: string,
  ) {
    const tenantId = this.tid(user, override);
    const plan = await this.planDelNegocio(planId, tenantId);
    if (!plan.isActive) throw new BadRequestException('El plan está apagado.');

    const cliente = await this.prisma.customer.findFirst({
      where: { id: customerId, tenantId },
      select: { id: true },
    });
    if (!cliente) throw new NotFoundException('Cliente no encontrado.');

    const existente = await this.prisma.clubMembresia.findUnique({
      where: { planId_customerId: { planId, customerId } },
    });
    // Devolver la suya tal cual dejaba FUERA PARA SIEMPRE a quien se dio de
    // baja: el índice único impide crear otra, así que un cancelado no podía
    // volver a entrar nunca. Si vuelve, se reactiva con el cupo que le toque
    // por el día de hoy.
    if (existente && existente.status !== 'CANCELADA') {
      // Misma forma que el alta nueva, siempre. Devolver aquí la fila pelada
      // y allá una con `saldo` obligaba a quien llama a distinguir dos casos
      // que para él son el mismo: «este cliente ya está dentro, con esto».
      const suPase = existente.passId
        ? await this.prisma.pass.findUnique({
            where: { id: existente.passId },
            select: { stampsCount: true },
          })
        : null;
      return { ...existente, saldo: suPase?.stampsCount ?? 0 };
    }

    const ahora = new Date();
    const cupo = cupoDeAlta(diaDelMes(ahora), plan.beneficiosPorMes, plan.tramos);

    // La tarjeta del plan. Una por plan, compartida por todos sus socios: es
    // la PLANTILLA del pase (colores, logo, nombre), no la tarjeta de nadie.
    // Se crea con `type: STAMPS` porque el saldo vive en `Pass.stampsCount`
    // como en el resto — así hereda gratis el pintado, el push y la
    // geolocalización. Lo que la distingue es `clubPlanId`, y por eso los
    // resolutores de "primera tarjeta de sellos del negocio" la excluyen.
    const card =
      (await this.prisma.card.findFirst({ where: { tenantId, clubPlanId: planId } })) ??
      (await this.prisma.card.create({
        data: {
          tenantId,
          clubPlanId: planId,
          name: plan.name,
          type: 'STAMPS',
          stampsRequired: plan.beneficiosPorMes,
          rewardText: `${plan.beneficiosPorMes} ${plan.unidad} al mes`,
          isActive: true,
        },
      }));

    return this.prisma.$transaction(async (tx) => {
      // El pase nace CON el cupo dentro. Es lo contrario de una tarjeta de
      // sellos, que nace en cero: aquí el cliente ya pagó.
      let pass;
      try {
        pass = await tx.pass.create({
          data: {
            tenantId,
            cardId: card.id,
            customerId,
            serialNumber: `CLB-${nanoid(10).toUpperCase()}`,
            qrToken: genQrToken(),
            authToken: nanoid(32),
            stampsCount: cupo,
          },
        });
      } catch (e: any) {
        // Ya tenía pase de esta tarjeta (se dio de baja y vuelve). Se reutiliza
        // y se le repone el cupo: el cliente conserva el pase instalado.
        if (e?.code !== 'P2002') throw e;
        pass = await tx.pass.update({
          where: { cardId_customerId: { cardId: card.id, customerId } },
          data: { stampsCount: cupo, status: 'ACTIVE', lastActivityAt: new Date() },
        });
      }

      const datos = {
        passId: pass.id,
        status: 'ACTIVA' as const,
        cupoDelPeriodo: cupo,
        periodo: periodoDe(ahora),
        pausedAt: null,
      };
      // Dos altas simultáneas: la segunda choca con el índice único. Se
      // devuelve la que ganó en vez de un P2002 crudo que el negocio vería
      // como un 500 sin explicación.
      let m;
      if (existente) {
        m = await tx.clubMembresia.update({ where: { id: existente.id }, data: datos });
      } else {
        try {
          m = await tx.clubMembresia.create({ data: { planId, customerId, ...datos } });
        } catch (e: any) {
          if (e?.code !== 'P2002') throw e;
          m = await tx.clubMembresia.findUniqueOrThrow({
            where: { planId_customerId: { planId, customerId } },
          });
        }
      }
      return { ...m, passId: pass.id, saldo: cupo };
    });
  }

  /**
   * Pausa o reactiva. Es el interruptor manual del negocio mientras no haya
   * pasarela: si el cliente no pagó, se pausa y deja de consumir.
   *
   * Al pausar NO se toca el saldo. Vuelve con lo que tenía, y no se le
   * reinicia hasta que cambie el mes — `tocaReiniciar` ignora las pausadas,
   * así que tres meses de pausa no acumulan tres cupos.
   */
  async cambiarEstado(
    user: AuthUser,
    membresiaId: string,
    status: 'ACTIVA' | 'PAUSADA' | 'CANCELADA',
    override?: string,
  ) {
    const tenantId = this.tid(user, override);
    const m = await this.prisma.clubMembresia.findFirst({
      where: { id: membresiaId, plan: { tenantId } },
      select: { id: true, status: true },
    });
    if (!m) throw new NotFoundException('Membresía no encontrada.');
    if (m.status === 'CANCELADA') {
      throw new BadRequestException('Una membresía cancelada no se reactiva.');
    }
    return this.prisma.clubMembresia.update({
      where: { id: membresiaId },
      data: {
        status,
        pausedAt: status === 'PAUSADA' ? new Date() : null,
      },
    });
  }

  // ── Caja ────────────────────────────────────────────────────────────────

  /** Lo que ve el cajero al escanear. El saldo sale del PASE. */
  async resolverParaCaja(user: AuthUser, passId: string) {
    const m = await this.prisma.clubMembresia.findFirst({
      where: { passId },
      include: {
        plan: { select: { tenantId: true, name: true, unidad: true } },
        customer: { select: { fullName: true } },
        pass: { select: { stampsCount: true } },
      },
    });
    if (!m) throw new NotFoundException('Esta tarjeta no es de un club.');
    if (user.role !== 'SUPER_ADMIN' && m.plan.tenantId !== user.tenantId) {
      throw new ForbiddenException();
    }
    const saldo = m.pass?.stampsCount ?? 0;
    return {
      membresiaId: m.id,
      titular: m.customer?.fullName ?? '—',
      plan: m.plan.name,
      unidad: m.plan.unidad,
      status: m.status,
      saldo,
      cupoDelPeriodo: m.cupoDelPeriodo,
      periodo: m.periodo,
      puedeConsumir: m.status === 'ACTIVA' && saldo > 0,
    };
  }

  /**
   * Descuenta del cupo, que vive en `Pass.stampsCount` — el mismo contador que
   * usan todas las tarjetas.
   *
   * Vive ahí y no en una tabla aparte porque así el pase se pinta, se empuja y
   * recibe la geolocalización sin código nuevo: toda esa maquinaria opera
   * sobre `Pass` y no mira de qué tipo es la tarjeta.
   *
   * El descuento es un UPDATE CONDICIONAL: solo toca la fila si el saldo
   * alcanza, y se mira cuántas cambió. Sin eso, dos cajeros escaneando a la
   * vez leerían saldo 1 los dos, pasarían los dos el `if`, y el cliente se
   * llevaría dos cafés con uno de cupo.
   */
  async consumir(
    user: AuthUser,
    membresiaId: string,
    cantidad = 1,
    locationId?: string | null,
  ) {
    if (!Number.isInteger(cantidad) || cantidad < 1) {
      throw new BadRequestException('La cantidad debe ser 1 o más.');
    }
    const m = await this.prisma.clubMembresia.findUnique({
      where: { id: membresiaId },
      include: {
        plan: {
          select: { tenantId: true, unidad: true, beneficiosPorMes: true },
        },
      },
    });
    if (!m) throw new NotFoundException('Membresía no encontrada.');
    if (user.role !== 'SUPER_ADMIN' && m.plan.tenantId !== user.tenantId) {
      throw new ForbiddenException();
    }
    if (m.status !== 'ACTIVA') {
      throw new BadRequestException(
        m.status === 'PAUSADA'
          ? 'Esta membresía está pausada.'
          : 'Esta membresía está cancelada.',
      );
    }
    if (!m.passId) {
      throw new BadRequestException('Esta membresía todavía no tiene tarjeta.');
    }

    const passId = m.passId;
    const periodoActual = periodoDe(new Date());
    // El cron de reinicio es HORARIO, así que entre las 00:00 del día 1 y su
    // primera pasada hay hasta una hora en la que la membresía sigue marcada
    // en el mes viejo. Sin esto, un cliente con 7 sobrantes de septiembre se
    // los gastaba el 1 de octubre y ese mes se llevaba 17 con un plan de 10.
    // Se reinicia AQUÍ mismo; el cron queda como red de seguridad.
    const tocaReinicio = m.periodo !== periodoActual;
    const cupoVigente = tocaReinicio
      ? m.plan.beneficiosPorMes
      : m.cupoDelPeriodo;

    const resultado = await this.prisma.$transaction(async (tx) => {
      // Reclamo CONDICIONAL de la membresía: si alguien la pausó entre la
      // lectura de arriba y esto, `count` es 0 y no se descuenta nada. Sin
      // este candado el `if` de arriba decidía con una foto vieja y una
      // membresía pausada a medio escaneo se llevaba igual el beneficio.
      const reclamo = await tx.clubMembresia.updateMany({
        where: {
          id: membresiaId,
          status: 'ACTIVA',
          ...(tocaReinicio ? { periodo: m.periodo } : {}),
        },
        data: tocaReinicio
          ? { periodo: periodoActual, cupoDelPeriodo: cupoVigente }
          : { updatedAt: new Date() },
      });
      if (reclamo.count === 0) {
        throw new ConflictException(
          'La membresía cambió de estado mientras se cobraba. Volvé a escanear.',
        );
      }

      // Con reinicio, el pase vuelve al cupo del mes ANTES de descontar.
      if (tocaReinicio) {
        await tx.pass.update({
          where: { id: passId },
          data: { stampsCount: cupoVigente, lastActivityAt: new Date() },
        });
      }

      // `lastActivityAt` en el mismo UPDATE: sin bumpearlo, el webservice de
      // Apple compara `If-Modified-Since` y responde 304, así que el push
      // llegaría pero el pase no se refrescaría.
      const bajada = await tx.pass.updateMany({
        where: { id: passId, stampsCount: { gte: cantidad } },
        data: {
          stampsCount: { decrement: cantidad },
          lastActivityAt: new Date(),
        },
      });
      if (bajada.count === 0) {
        const ahora = await tx.pass.findUnique({
          where: { id: passId },
          select: { stampsCount: true },
        });
        const q = ahora?.stampsCount ?? 0;
        throw new ConflictException(
          `Sin cupo: le ${q === 1 ? 'queda 1' : `quedan ${q}`} de ${cupoVigente}.`,
        );
      }

      // Segunda comprobación del estado, ya con el cupo descontado y dentro de
      // la transacción: si la membresía se pausó entre el reclamo de arriba y
      // esto, lanzar aquí deshace el descuento entero. Barato, y cierra la
      // única rendija que quedaba.
      const sigueViva = await tx.clubMembresia.findUnique({
        where: { id: membresiaId },
        select: { status: true },
      });
      if (sigueViva?.status !== 'ACTIVA') {
        throw new ConflictException(
          'La membresía dejó de estar activa mientras se cobraba.',
        );
      }

      const tras = await tx.pass.findUniqueOrThrow({
        where: { id: passId },
        select: { stampsCount: true },
      });

      const consumo = await tx.clubConsumo.create({
        data: {
          membresiaId,
          cantidad,
          saldoResultante: tras.stampsCount,
          // El período del consumo sale de la FECHA REAL, no de la membresía:
          // con la membresía sin reiniciar, un café del 1 de octubre quedaba
          // contado en septiembre y los informes por mes salían mal.
          periodo: periodoActual,
          actorId: user.id ?? null,
          locationId: locationId ?? null,
        },
      });

      return { consumoId: consumo.id, saldo: tras.stampsCount };
    });

    this.empujarPase(passId, 'club.consumo');

    return {
      ok: true,
      ...resultado,
      cupoDelPeriodo: cupoVigente,
      unidad: m.plan.unidad,
    };
  }

  /**
   * Deshace un consumo mal registrado.
   *
   * Se marca, no se borra: el histórico no se reescribe. Y la marca va con un
   * UPDATE condicional sobre `revertedAt: null`, así el doble clic del cajero
   * no devuelve el cupo dos veces.
   */
  async anularConsumo(user: AuthUser, consumoId: string) {
    const c = await this.prisma.clubConsumo.findUnique({
      where: { id: consumoId },
      include: {
        membresia: {
          include: { plan: { select: { tenantId: true } } },
        },
      },
    });
    if (!c) throw new NotFoundException('Consumo no encontrado.');
    if (
      user.role !== 'SUPER_ADMIN' &&
      c.membresia.plan.tenantId !== user.tenantId
    ) {
      throw new ForbiddenException();
    }

    const r = await this.prisma.$transaction(async (tx) => {
      const marcado = await tx.clubConsumo.updateMany({
        where: { id: consumoId, revertedAt: null },
        data: { revertedAt: new Date(), revertedBy: user.id ?? null },
      });
      if (marcado.count === 0) {
        throw new ConflictException('Este consumo ya estaba anulado.');
      }
      // Solo se devuelve el cupo si sigue siendo del mismo período: anular en
      // octubre un consumo de septiembre regalaría saldo del mes nuevo.
      //
      // El período se relee DENTRO de la transacción: leerlo de la foto de
      // arriba dejaba que el cron reiniciara en medio y se devolviera cupo
      // del mes nuevo por un consumo del viejo.
      const viva = await tx.clubMembresia.findUnique({
        where: { id: c.membresiaId },
        select: { periodo: true, passId: true },
      });
      if (!viva?.passId || viva.periodo !== c.periodo) {
        return { devuelto: 0, motivo: 'consumo de un período anterior' as const };
      }
      const tras = await tx.pass.update({
        where: { id: viva.passId },
        data: {
          stampsCount: { increment: c.cantidad },
          lastActivityAt: new Date(),
        },
        select: { stampsCount: true },
      });
      return { devuelto: c.cantidad, saldo: tras.stampsCount };
    });

    if (r.devuelto > 0 && c.membresia.passId) {
      this.empujarPase(c.membresia.passId, 'club.anulacion');
    }
    return { ok: true, ...r };
  }

  // ── Reinicio mensual ────────────────────────────────────────────────────

  /**
   * Devuelve el cupo del mes a todas las membresías activas.
   *
   * ASIGNA, no suma: quien consumió 3 de 10 empieza con 10, no con 17. Y solo
   * actúa si el período guardado difiere del actual, así que correrlo cien
   * veces el mismo mes no regala nada.
   *
   * Cada hora y no una vez al día: si el proceso se cae a medianoche, a la
   * siguiente hora se recupera solo y nadie se queda sin su cupo.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async reiniciarCupos() {
    const periodo = periodoDe(new Date());
    const pendientes = await this.prisma.clubMembresia.findMany({
      where: { status: 'ACTIVA', periodo: { not: periodo }, passId: { not: null } },
      select: {
        id: true,
        status: true,
        periodo: true,
        passId: true,
        plan: { select: { beneficiosPorMes: true } },
      },
      take: 5000,
    });
    if (!pendientes.length) return { periodo, reiniciadas: 0 };

    let reiniciadas = 0;
    for (const m of pendientes) {
      if (!tocaReiniciar(m, periodo)) continue;
      // Condicionado al período viejo: si otra pasada del cron ya la reinició,
      // esta no cuenta y no vuelve a asignar.
      // Las dos escrituras van en UNA transacción: sueltas, entre marcar el
      // período nuevo y reponer el pase cabe un consumo del cliente, y el
      // reinicio se lo comería. Y `updateMany` en vez de `update` porque si la
      // membresía apunta a un pase que ya no existe, `update` lanza y se lleva
      // por delante el reinicio del MES ENTERO para todos los demás.
      const hecho = await this.prisma.$transaction(async (tx) => {
        const r = await tx.clubMembresia.updateMany({
          where: { id: m.id, periodo: m.periodo },
          data: { cupoDelPeriodo: m.plan.beneficiosPorMes, periodo },
        });
        if (r.count === 0) return false;

        const puesto = await tx.pass.updateMany({
          where: { id: m.passId! },
          data: {
            stampsCount: m.plan.beneficiosPorMes,
            lastActivityAt: new Date(),
          },
        });
        if (puesto.count === 0) {
          this.logger.warn(
            `Club: membresía ${m.id} apunta a un pase inexistente (${m.passId}) — se salta.`,
          );
          return false;
        }
        return true;
      });
      if (!hecho) continue;

      this.empujarPase(m.passId!, 'club.reinicio');
      reiniciadas += 1;
    }
    if (reiniciadas > 0) {
      this.logger.log(`Club: ${reiniciadas} membresías reiniciadas para ${periodo}.`);
    }
    return { periodo, reiniciadas };
  }
}
