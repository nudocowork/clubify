import { PrismaService } from '../common/prisma/prisma.service';
import { limitesDelMes, mesContableActual } from '../common/periodo-contable';

/**
 * Las cifras que resumen un equipo de ventas, para la pantalla de entrada.
 *
 * POR QUÉ EXISTE. La lista de equipos enseñaba el nombre, el líder y «0
 * miembros»: no decía si el equipo está trabajando. La referencia que pidió
 * Javier (TeamClubify) enseña en cada tarjeta citas de hoy, banco, chats,
 * leads y ventas, y permite comparar equipos en una tabla. Sin esos números la
 * pantalla no sirve para decidir nada.
 *
 * TODO SE CALCULA EN CONSULTAS AGRUPADAS, no una por equipo: con cuatro
 * equipos da igual, pero esta pantalla es la que se abre primero y crece con
 * cada equipo que se cree.
 *
 * LO QUE NO SE PUEDE CALCULAR, Y NO SE INVENTA:
 *  - El número de WhatsApp del equipo y su estado de conexión. En Clubify PRO
 *    el canal no se conecta por equipo; los mensajes salen por la subcuenta de
 *    la marca. No hay campo que leer, así que no se pinta.
 *  - Los mensajes «sin leer». `SalesMessage` no guarda cuándo se leyó una
 *    conversación. Inventar el dato a partir de la fecha del último mensaje
 *    daría un número que parece real y no lo es.
 */

export interface MetricasDeEquipo {
  /** Citas con hora de hoy (Bogotá) que no se han cancelado. */
  citasHoy: number;
  /** Leads sin vendedor asignado: el «banco» del que se reparte. */
  banco: number;
  /** Conversaciones abiertas: leads con al menos un mensaje. */
  chats: number;
  /** Leads del equipo, en cualquier etapa. */
  leads: number;
  /** Leads ganados dentro del mes contable en curso. */
  ventas: number;
  /** Lo que suman esas ventas, cuando el lead trae importe. */
  ventasUsd: number;
  /** Leads enlazados a una persona conocida del CRM. */
  contactos: number;
  /** Último movimiento de cualquier lead del equipo. */
  ultimaActividad: Date | null;
}

export const METRICAS_EN_CERO: MetricasDeEquipo = {
  citasHoy: 0,
  banco: 0,
  chats: 0,
  leads: 0,
  ventas: 0,
  ventasUsd: 0,
  contactos: 0,
  ultimaActividad: null,
};

/** El día de hoy en hora de Bogotá, como instantes UTC. */
function limitesDeHoy(ahora: Date = new Date()): { from: Date; to: Date } {
  // Mismo criterio que `periodo-contable.ts`: Bogotá es UTC-5 todo el año.
  const OFFSET = 5;
  const enBogota = new Date(ahora.getTime() - OFFSET * 3600 * 1000);
  const y = enBogota.getUTCFullYear();
  const m = enBogota.getUTCMonth();
  const d = enBogota.getUTCDate();
  return {
    from: new Date(Date.UTC(y, m, d, OFFSET, 0, 0, 0)),
    to: new Date(Date.UTC(y, m, d, 23 + OFFSET, 59, 59, 999)),
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Las métricas de varios equipos de una vez.
 *
 * Devuelve un mapa por id de equipo. Un equipo sin nada devuelve ceros, no se
 * queda fuera: una tarjeta sin cifras se lee como «no cargó», y un cero se lee
 * como un cero.
 */
export async function metricasDeEquipos(
  prisma: PrismaService,
  teamIds: string[],
  ahora: Date = new Date(),
): Promise<Map<string, MetricasDeEquipo>> {
  const salida = new Map<string, MetricasDeEquipo>(
    teamIds.map((id) => [id, { ...METRICAS_EN_CERO }]),
  );
  if (teamIds.length === 0) return salida;

  const hoy = limitesDeHoy(ahora);
  const mes = limitesDelMes(mesContableActual(ahora))!;
  const deEstosEquipos = { salesTeamId: { in: teamIds } };

  const [citas, leads, ganados, hilos] = await Promise.all([
    prisma.salesMeeting.groupBy({
      by: ['salesTeamId'],
      where: {
        ...deEstosEquipos,
        startAt: { gte: hoy.from, lte: hoy.to },
        status: { notIn: ['CANCELADA', 'CANCELADO'] },
      },
      _count: { _all: true },
    }),
    // Un solo viaje para leads, banco, contactos y última actividad: son
    // recuentos distintos sobre la MISMA tabla y traerlos por separado serían
    // cuatro escaneos del mismo índice.
    prisma.salesLead.findMany({
      where: deEstosEquipos,
      select: {
        salesTeamId: true,
        assignedUserId: true,
        mktContactId: true,
        lastActivityAt: true,
      },
    }),
    prisma.salesLead.findMany({
      where: { ...deEstosEquipos, wonAt: { gte: mes.from, lte: mes.to } },
      select: { salesTeamId: true, value: true },
    }),
    // Conversaciones abiertas = leads DISTINTOS con mensajes. Agrupar por
    // (equipo, lead) y contar los grupos es la forma de sacar un «distinct»
    // por equipo sin una consulta por equipo.
    prisma.salesMessage.groupBy({
      by: ['salesTeamId', 'leadId'],
      where: deEstosEquipos,
      _count: { _all: true },
    }),
  ]);

  for (const c of citas) {
    const m = salida.get(c.salesTeamId);
    if (m) m.citasHoy = c._count._all;
  }
  for (const l of leads) {
    const m = salida.get(l.salesTeamId);
    if (!m) continue;
    m.leads += 1;
    if (!l.assignedUserId) m.banco += 1;
    if (l.mktContactId) m.contactos += 1;
    if (!m.ultimaActividad || l.lastActivityAt > m.ultimaActividad) {
      m.ultimaActividad = l.lastActivityAt;
    }
  }
  for (const g of ganados) {
    const m = salida.get(g.salesTeamId);
    if (!m) continue;
    m.ventas += 1;
    m.ventasUsd = round2(m.ventasUsd + Number(g.value ?? 0));
  }
  for (const h of hilos) {
    const m = salida.get(h.salesTeamId);
    if (m) m.chats += 1;
  }

  return salida;
}
