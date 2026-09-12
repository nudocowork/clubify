import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { limitesDelMes, mesContableActual } from '../common/periodo-contable';
import { resolveTeamAccess } from './team-access';

/**
 * El Resumen de un equipo: la pantalla que junta lo que ya existe.
 *
 * El módulo tenía tablero, agenda, chat, seguimientos y automatizaciones, pero
 * no una pantalla que dijera cómo va el equipo. Eran dos botones sueltos.
 *
 * Responde, en este orden: qué hay HOY encima de la mesa, cuántos leads
 * entraron y por dónde, cómo va cada persona del equipo, y qué está pidiendo
 * atención. Todo derivado en lectura — no persiste nada.
 *
 * Empieza por `resolveTeamAccess`, como TODO servicio de este módulo: es la
 * única red que hay contra mirar el equipo de otra marca.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Bordes de un día en hora de Bogotá (UTC-5 todo el año). */
function limitesDelDia(d: Date): { from: Date; to: Date } {
  const OFFSET = 5;
  const b = new Date(d.getTime() - OFFSET * 3600 * 1000);
  const [y, m, dia] = [b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate()];
  return {
    from: new Date(Date.UTC(y, m, dia, OFFSET, 0, 0, 0)),
    to: new Date(Date.UTC(y, m, dia, 23 + OFFSET, 59, 59, 999)),
  };
}

/** "2026-09-12" del instante, en Bogotá. */
function diaBogota(d: Date): string {
  return new Date(d.getTime() - 5 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * De dónde vino el lead, agrupado como lo mira el equipo.
 *
 * `source` es texto libre: lo escribe quien crea el lead, el formulario público
 * o el webhook. Se agrupa por lo que contiene y lo que no casa va a «otros» en
 * vez de inventarse una categoría — así el total siempre cuadra.
 */
function origenDe(source: string | null): 'whatsapp' | 'agenda' | 'otros' {
  const s = (source ?? '').toLowerCase();
  if (s.includes('whats') || s.includes('wa')) return 'whatsapp';
  if (s.includes('agenda') || s.includes('booking') || s.includes('cita')) {
    return 'agenda';
  }
  return 'otros';
}

@Injectable()
export class ResumenDeEquipoService {
  constructor(private prisma: PrismaService) {}

  async resumen(
    user: AuthUser,
    teamId: string,
    opts: { desde?: Date; hasta?: Date } = {},
  ) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    const ahora = new Date();
    const hoy = limitesDelDia(ahora);
    const mes = limitesDelMes(mesContableActual(ahora))!;

    // Por defecto, el mes contable en curso: es el período con el que se habla
    // en el resto del panel, y mezclarlo con otro aquí sería otra fuente de
    // números que no cuadran entre pantallas.
    const desde = opts.desde ?? mes.from;
    const hasta = opts.hasta ?? mes.to;
    const delEquipo = { salesTeamId: teamId };

    const [
      equipo,
      miembros,
      leads,
      leadsDelPeriodo,
      citasHoy,
      citasDelMes,
      seguimientos,
      hilos,
    ] = await Promise.all([
      this.prisma.salesTeam.findUnique({
        where: { id: teamId },
        select: {
          id: true, name: true, slug: true, color: true, isActive: true,
          leadUser: { select: { id: true, fullName: true, email: true } },
        },
      }),
      this.prisma.salesTeamMember.findMany({
        where: { teamId },
        select: {
          userId: true, roles: true, isActive: true,
          user: { select: { id: true, fullName: true, email: true } },
        },
      }),
      this.prisma.salesLead.findMany({
        where: delEquipo,
        select: {
          id: true, assignedUserId: true, mktContactId: true,
          wonAt: true, value: true, stageId: true,
        },
      }),
      this.prisma.salesLead.findMany({
        where: { ...delEquipo, createdAt: { gte: desde, lte: hasta } },
        select: { createdAt: true, source: true },
      }),
      this.prisma.salesMeeting.count({
        where: {
          ...delEquipo,
          startAt: { gte: hoy.from, lte: hoy.to },
          status: { notIn: ['CANCELADA', 'CANCELADO'] },
        },
      }),
      this.prisma.salesMeeting.findMany({
        where: { ...delEquipo, startAt: { gte: mes.from, lte: mes.to } },
        select: { hostUserId: true, status: true },
      }),
      this.prisma.salesFollowup.findMany({
        where: { ...delEquipo, done: false },
        select: { assignedUserId: true, dueAt: true },
      }),
      this.prisma.salesMessage.groupBy({
        by: ['leadId'],
        where: delEquipo,
        _count: { _all: true },
      }),
    ]);

    // ── Lo de hoy ──────────────────────────────────────────────────────────
    const banco = leads.filter((l) => !l.assignedUserId).length;
    const contactos = leads.filter((l) => l.mktContactId).length;
    const ganadosDelMes = leads.filter(
      (l) => l.wonAt && l.wonAt >= mes.from && l.wonAt <= mes.to,
    );
    const vencidos = seguimientos.filter((s) => s.dueAt < ahora).length;

    // ── Los leads que llegaron ─────────────────────────────────────────────
    const porOrigen = { whatsapp: 0, agenda: 0, otros: 0 };
    const porDia = new Map<string, number>();
    for (const l of leadsDelPeriodo) {
      porOrigen[origenDe(l.source)] += 1;
      const d = diaBogota(l.createdAt);
      porDia.set(d, (porDia.get(d) ?? 0) + 1);
    }

    // ── Cómo va cada persona ───────────────────────────────────────────────
    // El líder entra aunque no esté como miembro: manda en el equipo y sus
    // citas son del equipo. Sin esto, su fila desaparecía de la tabla.
    const personas = new Map<
      string,
      { userId: string; nombre: string; rol: string }
    >();
    if (equipo?.leadUser) {
      personas.set(equipo.leadUser.id, {
        userId: equipo.leadUser.id,
        nombre: equipo.leadUser.fullName,
        rol: 'Líder del equipo',
      });
    }
    for (const m of miembros) {
      const yaEsta = personas.get(m.userId);
      const rol = etiquetaDeRol(m.roles, !!yaEsta);
      personas.set(m.userId, {
        userId: m.userId,
        nombre: m.user?.fullName ?? m.user?.email ?? '—',
        rol: yaEsta ? yaEsta.rol : rol,
      });
    }

    const colaboradores = [...personas.values()].map((p) => {
      const citas = citasDelMes.filter((c) => c.hostUserId === p.userId);
      const suyos = ganadosDelMes.filter((l) => l.assignedUserId === p.userId);
      return {
        ...p,
        citas: citas.length,
        realizadas: citas.filter((c) => /REALIZ|COMPLET|ASIST/i.test(c.status))
          .length,
        ventas: suyos.length,
        ventasUsd: round2(suyos.reduce((a, l) => a + Number(l.value ?? 0), 0)),
        seguimientos: seguimientos.filter((s) => s.assignedUserId === p.userId)
          .length,
      };
    });

    // ── Qué pide atención ──────────────────────────────────────────────────
    const atencion: Array<{ tipo: string; n: number; texto: string }> = [];
    if (banco > 0) {
      atencion.push({
        tipo: 'banco',
        n: banco,
        texto: `${banco} ${banco === 1 ? 'lead espera' : 'leads esperan'} vendedor asignado`,
      });
    }
    if (vencidos > 0) {
      atencion.push({
        tipo: 'seguimientos',
        n: vencidos,
        texto: `${vencidos} ${vencidos === 1 ? 'seguimiento vencido' : 'seguimientos vencidos'}`,
      });
    }
    const sinLider = !equipo?.leadUser;
    if (sinLider) {
      atencion.push({
        tipo: 'lider',
        n: 1,
        texto: 'El equipo no tiene líder asignado',
      });
    }
    if (!equipo?.slug) {
      atencion.push({
        tipo: 'agenda',
        n: 1,
        texto: 'Todavía no hay enlace público de agenda: nadie puede reservar solo',
      });
    }

    return {
      team: equipo,
      puedeEscribir: acceso.puedeEscribir,
      esAdminDeMarca: acceso.esAdminDeMarca,
      kpis: {
        citasHoy,
        banco,
        chatsAbiertos: hilos.length,
        seguimientos: seguimientos.length,
        seguimientosVencidos: vencidos,
        ventasMes: ganadosDelMes.length,
        ventasMesUsd: round2(
          ganadosDelMes.reduce((a, l) => a + Number(l.value ?? 0), 0),
        ),
        contactos,
        leads: leads.length,
      },
      leadsQueLlegaron: {
        desde: desde.toISOString(),
        hasta: hasta.toISOString(),
        total: leadsDelPeriodo.length,
        porOrigen,
        porDia: [...porDia.entries()]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([dia, n]) => ({ dia, n })),
      },
      colaboradores: colaboradores.sort((a, b) => b.ventas - a.ventas),
      requiereAtencion: atencion,
    };
  }
}

/** El rol legible de un miembro. `lectura` a secas es «solo lectura». */
function etiquetaDeRol(roles: string[], esLider: boolean): string {
  if (esLider) return 'Líder del equipo';
  const r = new Set((roles ?? []).map((x) => String(x).toLowerCase()));
  if (r.has('lider')) return 'Líder del equipo';
  if (r.has('closer')) return 'Closer';
  if (r.has('setter')) return 'Setter';
  if (r.has('lectura')) return 'Solo lectura';
  return 'Sin rol';
}
