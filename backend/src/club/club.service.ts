import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
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

  constructor(private prisma: PrismaService) {}

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

    return this.prisma.clubPlan.create({
      data: {
        tenantId,
        name: dto.name.trim(),
        slug: slug || `plan-${Date.now()}`,
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
    if (existente) return existente;

    const ahora = new Date();
    const cupo = cupoDeAlta(
      diaDelMes(ahora),
      plan.beneficiosPorMes,
      plan.tramos,
    );

    try {
      return await this.prisma.clubMembresia.create({
        data: {
          planId,
          customerId,
          saldo: cupo,
          cupoDelPeriodo: cupo,
          periodo: periodoDe(ahora),
        },
      });
    } catch (e: any) {
      // Dos altas simultáneas: la segunda choca con el índice único. Se
      // devuelve la que ganó en vez de un error que nadie sabría interpretar.
      if (e?.code === 'P2002') {
        return this.prisma.clubMembresia.findUniqueOrThrow({
          where: { planId_customerId: { planId, customerId } },
        });
      }
      throw e;
    }
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

  /** Lo que ve el cajero al escanear. */
  async resolverParaCaja(user: AuthUser, passId: string) {
    const m = await this.prisma.clubMembresia.findFirst({
      where: { passId },
      include: {
        plan: { select: { id: true, tenantId: true, name: true, unidad: true } },
        customer: { select: { fullName: true } },
      },
    });
    if (!m) throw new NotFoundException('Esta tarjeta no es de un club.');
    if (user.role !== 'SUPER_ADMIN' && m.plan.tenantId !== user.tenantId) {
      throw new ForbiddenException();
    }
    return {
      membresiaId: m.id,
      titular: m.customer?.fullName ?? '—',
      plan: m.plan.name,
      unidad: m.plan.unidad,
      status: m.status,
      saldo: m.saldo,
      cupoDelPeriodo: m.cupoDelPeriodo,
      periodo: m.periodo,
      puedeConsumir: m.status === 'ACTIVA' && m.saldo > 0,
    };
  }

  /**
   * Descuenta del cupo.
   *
   * El descuento es un UPDATE CONDICIONAL: solo toca la fila si el saldo
   * alcanza, y se mira cuántas filas cambió. Sin eso, dos cajeros escaneando a
   * la vez leerían saldo 1 los dos, los dos pasarían el `if`, y el cliente se
   * llevaría dos cafés con uno solo de cupo. Es el bug más repetido de este
   * repo y aquí no puede ocurrir: Postgres serializa el UPDATE sobre la fila.
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
      include: { plan: { select: { tenantId: true, unidad: true } } },
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

    return this.prisma.$transaction(async (tx) => {
      const bajada = await tx.clubMembresia.updateMany({
        where: { id: membresiaId, status: 'ACTIVA', saldo: { gte: cantidad } },
        data: { saldo: { decrement: cantidad } },
      });
      if (bajada.count === 0) {
        // O se quedó sin cupo entre la lectura y el descuento, o alguien la
        // pausó. Se relee para decir cuál de las dos.
        const ahora = await tx.clubMembresia.findUnique({
          where: { id: membresiaId },
          select: { saldo: true, status: true },
        });
        if (ahora?.status !== 'ACTIVA') {
          throw new ConflictException('La membresía dejó de estar activa.');
        }
        throw new ConflictException(
          `Sin cupo: le ${ahora.saldo === 1 ? 'queda 1' : `quedan ${ahora.saldo}`} de ${m.cupoDelPeriodo}.`,
        );
      }

      const tras = await tx.clubMembresia.findUniqueOrThrow({
        where: { id: membresiaId },
        select: { saldo: true, periodo: true },
      });

      const consumo = await tx.clubConsumo.create({
        data: {
          membresiaId,
          cantidad,
          saldoResultante: tras.saldo,
          periodo: tras.periodo,
          actorId: user.id ?? null,
          locationId: locationId ?? null,
        },
      });

      return {
        ok: true,
        consumoId: consumo.id,
        saldo: tras.saldo,
        cupoDelPeriodo: m.cupoDelPeriodo,
        unidad: m.plan.unidad,
      };
    });
  }

  /**
   * Deshace un consumo mal registrado.
   *
   * Se marca, no se borra: el histórico no se reescribe. Y la marca se pone
   * con un UPDATE condicional sobre `revertedAt: null`, así el doble clic del
   * cajero no devuelve el cupo dos veces — que es exactamente el fallo que
   * tiene hoy el módulo de Convenios.
   */
  async anularConsumo(user: AuthUser, consumoId: string) {
    const c = await this.prisma.clubConsumo.findUnique({
      where: { id: consumoId },
      include: {
        membresia: { include: { plan: { select: { tenantId: true } } } },
      },
    });
    if (!c) throw new NotFoundException('Consumo no encontrado.');
    if (
      user.role !== 'SUPER_ADMIN' &&
      c.membresia.plan.tenantId !== user.tenantId
    ) {
      throw new ForbiddenException();
    }

    return this.prisma.$transaction(async (tx) => {
      const marcado = await tx.clubConsumo.updateMany({
        where: { id: consumoId, revertedAt: null },
        data: { revertedAt: new Date(), revertedBy: user.id ?? null },
      });
      if (marcado.count === 0) {
        throw new ConflictException('Este consumo ya estaba anulado.');
      }
      // Solo se devuelve el cupo si sigue siendo del mismo período: anular en
      // octubre un consumo de septiembre no puede regalar saldo del mes nuevo.
      const m = await tx.clubMembresia.findUniqueOrThrow({
        where: { id: c.membresiaId },
        select: { periodo: true, cupoDelPeriodo: true },
      });
      if (m.periodo !== c.periodo) {
        return { ok: true, devuelto: 0, motivo: 'consumo de un período anterior' };
      }
      const tras = await tx.clubMembresia.update({
        where: { id: c.membresiaId },
        data: { saldo: { increment: c.cantidad } },
        select: { saldo: true },
      });
      return { ok: true, devuelto: c.cantidad, saldo: tras.saldo };
    });
  }

  // ── Reinicio mensual ────────────────────────────────────────────────────

  /**
   * Devuelve el cupo del mes a todas las membresías activas.
   *
   * ASIGNA, no suma: quien consumió 3 de 10 empieza con 10, no con 17. Y solo
   * actúa si el período guardado es distinto del actual, así que correrlo cien
   * veces el mismo mes no regala nada.
   *
   * Cada hora y no una vez al día: si el proceso se cae a medianoche, a la
   * siguiente hora se recupera solo y nadie se queda sin su cupo.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async reiniciarCupos() {
    const periodo = periodoDe(new Date());
    const pendientes = await this.prisma.clubMembresia.findMany({
      where: { status: 'ACTIVA', periodo: { not: periodo } },
      select: { id: true, status: true, periodo: true, plan: { select: { beneficiosPorMes: true } } },
      take: 5000,
    });
    if (!pendientes.length) return { periodo, reiniciadas: 0 };

    let reiniciadas = 0;
    for (const m of pendientes) {
      if (!tocaReiniciar(m, periodo)) continue;
      // Condicionado al período viejo: si otra pasada del cron ya la reinició,
      // esta no cuenta y no vuelve a asignar.
      const r = await this.prisma.clubMembresia.updateMany({
        where: { id: m.id, periodo: m.periodo },
        data: {
          saldo: m.plan.beneficiosPorMes,
          cupoDelPeriodo: m.plan.beneficiosPorMes,
          periodo,
        },
      });
      reiniciadas += r.count;
    }
    if (reiniciadas > 0) {
      this.logger.log(`Club: ${reiniciadas} membresías reiniciadas para ${periodo}.`);
    }
    return { periodo, reiniciadas };
  }
}
