import { PrismaService } from '../common/prisma/prisma.service';

/**
 * Las columnas del embudo de un equipo, y cómo se siembran.
 *
 * Vive aparte porque hacen falta en DOS sitios y eso no era evidente: el
 * tablero las crea al abrirse, pero una reserva pública también necesita una
 * para meter al prospecto que acaba de agendar.
 *
 * POR QUÉ ESTÁ ESTE FICHERO
 * -------------------------
 * La primera versión daba por hecho que el tablero ya se había abierto alguna
 * vez. Una prueba de punta a punta contra producción (2026-09-09, «Equipo
 * Ecuador») lo desmintió: el equipo se creó en agosto, nadie había abierto su
 * tablero, y el prospecto que reservó por el enlace público **desapareció**.
 * La cita quedó guardada y la persona no, que es la peor combinación posible —
 * el vendedor ve un hueco ocupado sin saber de quién.
 *
 * La prueba unitaria no lo cazó porque su base falsa ya traía una columna
 * puesta. De ahí la regla: sembrar donde se necesita, no donde se supone.
 */

export const COLUMNAS_INICIALES: Array<{
  name: string;
  kind: string;
  color: string;
}> = [
  { name: 'Contactos', kind: 'CONTACTS', color: '#64748b' },
  { name: 'Interesados', kind: 'INTERESTED', color: '#0ea5e9' },
  { name: 'Seguimiento', kind: 'FOLLOWUP', color: '#f59e0b' },
  { name: 'Clientes', kind: 'CLIENT', color: '#22c55e' },
  { name: 'No interesados', kind: 'NOT_INTERESTED', color: '#ef4444' },
];

/**
 * Las columnas del equipo, creándolas si no las tiene.
 *
 * Se lee, se siembra y **se vuelve a leer**: dos personas abriendo el tablero a
 * la vez podrían sembrar dos juegos, y releyendo el segundo se encuentra las
 * del primero en vez de duplicarlas.
 */
export async function asegurarColumnas(
  prisma: PrismaService,
  salesTeamId: string,
) {
  const hay = await prisma.salesStage.findMany({
    where: { salesTeamId },
    orderBy: { position: 'asc' },
  });
  if (hay.length) return hay;

  await prisma.salesStage.createMany({
    data: COLUMNAS_INICIALES.map((c, i) => ({
      salesTeamId,
      name: c.name,
      kind: c.kind,
      color: c.color,
      position: i,
    })),
  });
  return prisma.salesStage.findMany({
    where: { salesTeamId },
    orderBy: { position: 'asc' },
  });
}
