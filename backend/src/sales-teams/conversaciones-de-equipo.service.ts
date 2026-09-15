import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { resolveTeamAccess } from './team-access';
import {
  POR_PAGINA_BANDEJA,
  normalizarBandeja,
  vistaPrevia,
} from './conversaciones-de-equipo';

/**
 * «Conversaciones» del equipo: la bandeja de chats, como en TeamClubify.
 *
 * Los mensajes ya se guardaban —entran por el webhook en `SalesInboxService` y
 * salen por `SalesChatService`—, pero solo se veían dentro de la ficha de cada
 * lead: para saber quién había escrito había que abrir los leads uno a uno.
 * Esto es la lista: un hilo por lead, el más reciente arriba, con cuántos
 * mensajes entraron desde la última vez que alguien del equipo lo leyó.
 *
 * No lee ni envía mensajes por su cuenta: el hilo y el envío siguen siendo los
 * de `SalesChatService` (baja del contacto, subcuenta de la marca, notas
 * internas). Aquí solo se añade la lista y la marca de leído.
 */

type FilaDeHilo = {
  leadId: string;
  body: string | null;
  direction: string;
  createdAt: Date;
  name: string | null;
  phone: string | null;
  company: string | null;
  noLeidos: number;
};

/**
 * Los hilos del equipo. `$1` equipo, `$2` texto (ya escapado para LIKE), `$3`
 * dígitos del teléfono.
 *
 * El último mensaje sale de `DISTINCT ON`, que con el índice
 * `(salesTeamId, leadId, createdAt)` no recorre la tabla. Las notas internas no
 * cuentan como último mensaje: no son conversación con el cliente.
 */
const HILOS = `
  WITH ultimos AS (
    SELECT DISTINCT ON (m."leadId") m."leadId", m."body", m."direction", m."createdAt"
      FROM "SalesMessage" m
     WHERE m."salesTeamId" = $1
       AND m."direction" IN ('in', 'out')
     ORDER BY m."leadId", m."createdAt" DESC
  ),
  hilos AS (
    SELECT u."leadId", u."body", u."direction", u."createdAt",
           l."name", l."phone", l."company",
           (SELECT COUNT(*)::int
              FROM "SalesMessage" x
             WHERE x."leadId" = u."leadId"
               AND x."salesTeamId" = $1
               AND x."direction" = 'in'
               AND (l."chatReadAt" IS NULL OR x."createdAt" > l."chatReadAt")) AS "noLeidos"
      FROM ultimos u
      JOIN "SalesLead" l ON l."id" = u."leadId" AND l."salesTeamId" = $1
     WHERE $2::text = ''
        OR l."name" ILIKE '%' || $2 || '%'
        OR l."company" ILIKE '%' || $2 || '%'
        OR ($3::text <> '' AND l."phoneKey" LIKE '%' || $3 || '%')
        OR EXISTS (SELECT 1 FROM "SalesMessage" s
                    WHERE s."leadId" = l."id"
                      AND s."salesTeamId" = $1
                      AND s."body" ILIKE '%' || $2 || '%')
  )`;

@Injectable()
export class ConversacionesDeEquipoService {
  constructor(private prisma: PrismaService) {}

  async bandeja(user: AuthUser, teamId: string, raw: { filtro?: string; q?: string; pagina?: string }) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    const f = normalizarBandeja(raw);
    const soloNoLeidos = f.filtro === 'no_leidos';

    const [filas, cuentas] = await Promise.all([
      this.prisma.$queryRawUnsafe<FilaDeHilo[]>(
        `${HILOS}
         SELECT * FROM hilos
          WHERE $4::boolean = false OR "noLeidos" > 0
          ORDER BY "createdAt" DESC
          LIMIT $5 OFFSET $6`,
        teamId,
        f.patron,
        f.digitos,
        soloNoLeidos,
        POR_PAGINA_BANDEJA,
        (f.pagina - 1) * POR_PAGINA_BANDEJA,
      ),
      this.prisma.$queryRawUnsafe<Array<{ total: number; conNoLeidos: number }>>(
        `${HILOS}
         SELECT COUNT(*)::int AS "total",
                COUNT(*) FILTER (WHERE "noLeidos" > 0)::int AS "conNoLeidos"
           FROM hilos`,
        teamId,
        f.patron,
        f.digitos,
      ),
    ]);

    return {
      team: acceso.team,
      puedeEscribir: acceso.puedeEscribir,
      filtro: f.filtro,
      q: f.texto,
      pagina: f.pagina,
      porPagina: POR_PAGINA_BANDEJA,
      // Bajo «No leídos» el total es el de ese filtro: «3 de 40» con 3 sin leer
      // hacía creer que faltaban 37 por cargar (Fable, 2026-09-14).
      total: soloNoLeidos ? (cuentas[0]?.conNoLeidos ?? 0) : (cuentas[0]?.total ?? 0),
      conNoLeidos: cuentas[0]?.conNoLeidos ?? 0,
      hayMas: filas.length === POR_PAGINA_BANDEJA,
      hilos: filas.map((h) => ({
        leadId: h.leadId,
        nombre: h.name,
        telefono: h.phone,
        empresa: h.company,
        ultimo: vistaPrevia(h.body),
        direccion: h.direction,
        fecha: h.createdAt,
        noLeidos: h.noLeidos,
      })),
    };
  }

  /**
   * Marca la conversación como leída hasta ahora.
   *
   * Basta con poder ver el equipo: abrir el chat ES leerlo, también para quien
   * tiene rol de solo lectura. La marca es del equipo, no de la persona, como en
   * la referencia.
   */
  async marcarLeido(user: AuthUser, teamId: string, leadId: string) {
    await resolveTeamAccess(this.prisma, user, teamId);
    const r = await this.prisma.salesLead.updateMany({
      where: { id: leadId, salesTeamId: teamId },
      data: { chatReadAt: new Date() },
    });
    if (!r.count) throw new NotFoundException('Lead no encontrado');
    return { ok: true };
  }
}
