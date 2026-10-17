import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../common/prisma/prisma.service';
import {
  anularParticipacionesDevueltas,
  cargarReglas,
  escribirParticipaciones,
  evaluarIngresos,
  SELECT_INGRESO,
} from './participaciones-motor';

/**
 * PARTICIPACIONES EN VIVO: aplica las participaciones globales a cada cobro
 * nuevo del libro de ingresos. La cuenta vive en `participaciones-motor.ts`;
 * esto solo decide CUÁNDO correrla.
 *
 *  · Al registrar un ingreso (`IncomeRecordService.record` llama a
 *    `procesarIngreso`): Hotmart, Stripe, Cross, pago manual y pendientes.
 *  · Cada 15 minutos (`ParticipacionesCron`): repasa los ingresos tocados en
 *    los últimos 7 días. Cubre los que no pasan por `record` (el upgrade
 *    escribe su ingreso dentro de su propia transacción, el conciliador adopta
 *    huérfanos y cambia estados) y cualquier fallo del primer intento.
 *
 * Las dos rutas son idempotentes por la UNIQUE (participacionId, ingresoId):
 * da igual que coincidan.
 *
 * En vivo, una regla solo cubre cobros llegados DESPUÉS de crearla. Lo
 * anterior, aunque la regla diga «desde siempre», es del backfill
 * (`scripts/backfill-participaciones.cjs`), que simula y espera a un humano.
 */
@Injectable()
export class ParticipacionesService {
  private readonly logger = new Logger(ParticipacionesService.name);

  constructor(private prisma: PrismaService) {}

  /** Best-effort: nunca lanza (lo llama la captura de un cobro). */
  async procesarIngreso(ingresoId: string): Promise<number> {
    try {
      const ingreso = await this.prisma.incomeRecord.findUnique({ where: { id: ingresoId }, select: SELECT_INGRESO });
      if (!ingreso) return 0;
      const reglas = await cargarReglas(this.prisma);
      if (!reglas.length) return 0;
      const ev = await evaluarIngresos(this.prisma, [ingreso as any], reglas, { enVivo: true });
      const { creadas } = await escribirParticipaciones(this.prisma, ev, reglas);
      if (creadas > 0) this.logger.log(`Participaciones: ${creadas} creada(s) para el ingreso ${ingresoId}`);
      return creadas;
    } catch (e) {
      this.logger.warn(`Participaciones del ingreso ${ingresoId} fallaron: ${(e as Error).message}`);
      return 0;
    }
  }

  /** Repaso: genera lo que falte de los ingresos recientes y anula lo devuelto. */
  async sincronizar(ahora = new Date(), dias = 7) {
    const desde = new Date(ahora.getTime() - dias * 86_400_000);
    const reglas = await cargarReglas(this.prisma);
    let creadas = 0;
    if (reglas.length) {
      const ingresos = await this.prisma.incomeRecord.findMany({
        where: { status: 'PAGADO', OR: [{ createdAt: { gte: desde } }, { updatedAt: { gte: desde } }] },
        select: SELECT_INGRESO,
      });
      const ev = await evaluarIngresos(this.prisma, ingresos as any, reglas, { enVivo: true });
      creadas = (await escribirParticipaciones(this.prisma, ev, reglas)).creadas;
    }
    // La anulación corre aunque hoy no haya reglas activas: una regla
    // desactivada puede tener participaciones vivas de un cobro que se devolvió.
    const anuladas = await anularParticipacionesDevueltas(this.prisma, { ahora });
    if (creadas || anuladas.length) {
      this.logger.log(`Participaciones: ${creadas} creada(s), ${anuladas.length} anulada(s) por devolución.`);
    }
    return { creadas, anuladas: anuladas.length };
  }
}

/** Separado del servicio para que el cron exista UNA vez aunque el servicio se provea en dos módulos. */
@Injectable()
export class ParticipacionesCron {
  private readonly logger = new Logger(ParticipacionesCron.name);

  constructor(private participaciones: ParticipacionesService) {}

  @Cron('*/15 * * * *', { name: 'comisiones.participaciones' })
  async tick() {
    await this.participaciones
      .sincronizar()
      .catch((e) => this.logger.error(`participaciones falló: ${(e as Error).message}`));
  }
}
