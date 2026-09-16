import type { Prisma, SalesTeamSale } from '@prisma/client';
import type { PrismaService } from '../common/prisma/prisma.service';
import type { CitaParaPrecarga } from './ventas-de-equipo';

/**
 * El acceso a lo que añade `scripts/apply-sales-team-sales-migration.cjs`: la
 * tabla `SalesTeamSale` y la columna `SalesMeeting.agendadaPorUserId`.
 *
 * ⚠️ ORDEN AL DESPLEGAR: PRIMERO LA MIGRACIÓN, DESPUÉS EL BACKEND. El esquema
 * ya las declara, pero en producción no existen hasta correr la migración con
 * `--aplicar`, y al revés no se cae solo esto: Prisma pide las columnas que
 * declara el modelo, así que sin `SalesMeeting.agendadaPorUserId` revienta con
 * P2022 toda consulta de citas que devuelva la fila entera —casi todas las de
 * `sales-agenda.service.ts`, que además ya la ESCRIBE al crear la cita—. Con el
 * backend por delante de la migración se cae la agenda del equipo y la reserva
 * por el enlace público, no solo vincular un negocio.
 *
 * Está en su propio archivo para tener UN sitio donde mirar qué toca de lo
 * nuevo, y para que la precarga del setter no repita el `select` de la cita.
 */

export type FilaDeVenta = SalesTeamSale;
export type NuevaVenta = Prisma.SalesTeamSaleUncheckedCreateInput;

export function tablaDeVentas(prisma: PrismaService) {
  return prisma.salesTeamSale;
}

/** Las últimas citas del lead, con quién las agendó (el «setter»). */
export function citasDelLead(prisma: PrismaService, teamId: string, leadId: string): Promise<CitaParaPrecarga[]> {
  return prisma.salesMeeting.findMany({
    where: { salesTeamId: teamId, leadId },
    orderBy: { startAt: 'desc' },
    take: 20,
    select: { status: true, hostUserId: true, agendadaPorUserId: true, startAt: true },
  });
}
