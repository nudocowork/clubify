import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../common/prisma/prisma.service';
import { MktActionService } from './mkt-action.service';
import {
  casoQueCasa,
  resolveMerge,
  evalWF,
  msDeEsperaDeRespuesta,
  sinAcentos,
  ESTADOS_DE_CITA,
  ESTADOS_DE_CITA_VIVA,
  ESTADOS_DE_OPORTUNIDAD,
  ESTADOS_DE_OPORTUNIDAD_DEL_FLUJO,
  MKT_CAMPOS_EDITABLES,
  MKT_MAX_SALTOS,
  MKT_MAX_SALTOS_DE_PASO,
  MKT_TRIGGERS,
  WFCaso,
  WFGraph,
  WFNode,
  WFTrigger,
  WFDrip,
  WFSendWindow,
  WFCondition,
} from './mkt-workflow.util';
import { correoDelPaso } from './prueba-y-plantilla.util';
import {
  claveDeEvento,
  diaEnBogota,
  elegirCitaDeReferencia,
  elegirPorNombre,
  horaEnBogota,
  mismoNombre,
  momentoDeLaCita,
  queHacerSiYaPaso,
  refDeEvento,
  VENTANA_DEL_BARRIDO_MS,
} from './mkt-ventas.util';
// El guardián de la red interna vive en el motor de MARCA y se importa, no se
// copia: dos copias de una comprobación de seguridad se separan a la primera
// corrección y una de las dos se queda vieja. Es un archivo de helpers puros,
// sin Nest, así que importarlo no crea ninguna dependencia entre módulos.
import { destinoInterno } from '../superadmin/brand-workflows/brand-workflow.util';
import {
  disparadoresDe,
  disparadorQueCasa,
  escuchaEl,
  etiquetaDeDisparador,
} from '../superadmin/brand-workflows/wf-filtros.util';

type NodeResult =
  | { kind: 'continue'; next: string | null }
  | { kind: 'wait'; resumeAt: Date; waitKind: string; resumeNodeId: string | null }
  | { kind: 'waitReply'; nodeId: string; resumeAt: Date }
  | { kind: 'complete' }
  | { kind: 'removed' };

/** Los datos de un contacto tal como los ven las condiciones y los {{merge}}. */
function ctxDeContacto(
  c: { name?: string | null; email?: string | null; phone?: string | null; company?: string | null; tags?: string[] | null } | null,
  marca: string,
): Record<string, string> {
  return {
    nombre: c?.name ?? '',
    email: c?.email ?? '',
    telefono: c?.phone ?? '',
    empresa: c?.company ?? '',
    tags: (c?.tags ?? []).join(', '),
    marca,
  };
}

/**
 * Lo que la inscripción recuerda del disparador por el que entró. Con varios
 * disparadores por flujo, sin esto no hay forma de saber —en el registro o en
 * un paso posterior— si llegó por la etiqueta o por la respuesta.
 */
function contextoDeEntrada(t: WFTrigger, indice: number): Record<string, string> {
  return { disparador: etiquetaDeDisparador(t, indice, MKT_TRIGGERS), disparadorTipo: t.type };
}

@Injectable()
export class MktEngineService {
  private readonly log = new Logger('MktEngine');

  constructor(
    private prisma: PrismaService,
    private actions: MktActionService,
  ) {}

  // ── Contexto del contacto (merge + condiciones) ──
  private async ctxFor(contactId: string): Promise<Record<string, string>> {
    const c = await this.prisma.mktContact.findUnique({
      where: { id: contactId },
      select: { name: true, email: true, phone: true, company: true, tags: true, whiteLabelId: true },
    });
    let marca = 'Clubify';
    if (c?.whiteLabelId) {
      const wl = await this.prisma.whiteLabel.findUnique({
        where: { id: c.whiteLabelId },
        select: { name: true },
      });
      marca = wl?.name ?? 'Clubify';
    }
    return ctxDeContacto(c, marca);
  }

  // ── Ventana de envío (tz de la marca; default Bogota) ──
  private partsIn(epoch: number, tz: string) {
    const f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(epoch));
    const g = (t: string) => f.find((p) => p.type === t)?.value ?? '';
    const ymd = `${g('year')}-${g('month')}-${g('day')}`;
    return { hour: parseInt(g('hour') || '0', 10), weekday: new Date(`${ymd}T00:00:00Z`).getUTCDay() };
  }
  private nextSendTime(win: WFSendWindow, fromMs: number): Date | null {
    if (!win?.enabled) return null;
    const tz = win.tz || 'America/Bogota';
    const start = win.startHour ?? 8;
    const end = win.endHour ?? 20;
    const skipWk = !!win.skipWeekends;
    let cur = fromMs;
    for (let i = 0; i < 400; i++) {
      const p = this.partsIn(cur, tz);
      const weekendBad = skipWk && (p.weekday === 0 || p.weekday === 6);
      if (!weekendBad && p.hour >= start && p.hour < end) return cur === fromMs ? null : new Date(cur);
      cur += 30 * 60000;
    }
    return new Date(cur);
  }
  private async dripDefer(wf: { id: string; drip: unknown }): Promise<Date | null> {
    const d = (wf.drip as WFDrip) || {};
    if (!d.enabled) return null;
    const batch = d.batchSize || 50;
    const interval = d.intervalMinutes || 10;
    const since = new Date(Date.now() - interval * 60000);
    const sends = await this.prisma.mktAction.findMany({
      where: { workflowId: wf.id, status: 'sent', createdAt: { gte: since } },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    });
    if (sends.length < batch) return null;
    return new Date(sends[0].createdAt.getTime() + interval * 60000);
  }

  private async runNode(
    wf: { id: string; whiteLabelId: string; drip: unknown; sendWindow: unknown },
    node: WFNode,
    enr: { id: string; contactId: string; context: unknown },
  ): Promise<NodeResult> {
    const ctx = { ...(await this.ctxFor(enr.contactId)), ...((enr.context as Record<string, string>) || {}) };
    const cfg = node.config || {};

    switch (node.type) {
      case 'send_email': {
        const winAt = this.nextSendTime(wf.sendWindow as WFSendWindow, Date.now());
        if (winAt) return { kind: 'wait', resumeAt: winAt, waitKind: 'window', resumeNodeId: node.id };
        const dripAt = await this.dripDefer(wf);
        if (dripAt) return { kind: 'wait', resumeAt: dripAt, waitKind: 'drip', resumeNodeId: node.id };
        const c = await this.prisma.mktContact.findUnique({
          where: { id: enr.contactId },
          select: { email: true },
        });
        // La plantilla es una REFERENCIA por id: se lee AHORA, así que el flujo
        // manda la versión que tenga el día del envío. Se busca sin filtrar por
        // marca a propósito y es `correoDelPaso` quien la rechaza si es ajena:
        // así el motivo que queda anotado distingue «ya no existe» de «es de
        // otra marca», que son dos problemas distintos para quien lo lea.
        const templateId = String(cfg.templateId || '').trim();
        const plantilla = templateId
          ? await this.prisma.mktEmailTemplate.findUnique({
              where: { id: templateId },
              select: { id: true, whiteLabelId: true, isPreset: true, subject: true, html: true },
            })
          : null;
        const correo = correoDelPaso({
          templateId,
          plantilla,
          whiteLabelId: wf.whiteLabelId,
          subject: cfg.subject,
          body: cfg.body,
          merge: (t) => resolveMerge(t, ctx),
        });
        await this.actions.dispatch({
          workflowId: wf.id,
          enrollmentId: enr.id,
          contactId: enr.contactId,
          whiteLabelId: wf.whiteLabelId,
          nodeId: node.id,
          channel: 'email',
          to: c?.email ?? '',
          subject: correo.ok ? correo.subject : null,
          body: correo.ok ? correo.html : '',
          // Fail-closed: con la plantilla rota no sale un correo en blanco; el
          // paso se salta y el motivo queda en el registro.
          omitido: correo.ok ? null : correo.motivo,
        });
        return { kind: 'continue', next: node.next ?? null };
      }
      case 'send_sms': {
        const winAt = this.nextSendTime(wf.sendWindow as WFSendWindow, Date.now());
        if (winAt) return { kind: 'wait', resumeAt: winAt, waitKind: 'window', resumeNodeId: node.id };
        const dripAt = await this.dripDefer(wf);
        if (dripAt) return { kind: 'wait', resumeAt: dripAt, waitKind: 'drip', resumeNodeId: node.id };
        const c = await this.prisma.mktContact.findUnique({
          where: { id: enr.contactId },
          select: { phone: true },
        });
        await this.actions.dispatch({
          workflowId: wf.id,
          enrollmentId: enr.id,
          contactId: enr.contactId,
          whiteLabelId: wf.whiteLabelId,
          nodeId: node.id,
          channel: 'sms',
          to: c?.phone ?? '',
          body: resolveMerge(String(cfg.message || ''), ctx),
        });
        return { kind: 'continue', next: node.next ?? null };
      }
      case 'wait_delay': {
        const amount = Number(cfg.amount) || 1;
        const unitMs: Record<string, number> = { minutes: 60000, hours: 3600000, days: 86400000, weeks: 604800000 };
        const ms = amount * (unitMs[String(cfg.unit || 'days')] ?? 86400000);
        return { kind: 'wait', resumeAt: new Date(Date.now() + ms), waitKind: 'delay', resumeNodeId: node.next ?? null };
      }
      case 'wait_datetime': {
        // La pantalla manda «2026-09-21T14:30», sin zona. Sin el `-05:00` eso
        // se lee en UTC —el servidor va en UTC— y el correo de las 2 de la
        // tarde salía a las 9 de la mañana en Bogotá.
        const raw = String(cfg.at ?? '').trim();
        const at = raw ? new Date(/[zZ]|[+-]\d{2}:\d{2}$/.test(raw) ? raw : `${raw}:00-05:00`) : null;
        if (at && !Number.isNaN(at.getTime()) && at.getTime() > Date.now()) {
          return { kind: 'wait', resumeAt: at, waitKind: 'datetime', resumeNodeId: node.next ?? null };
        }
        return { kind: 'continue', next: node.next ?? null };
      }
      case 'wait_reply': {
        // Esperar una INTERACCIÓN (reply/open/click). Timeout → sigue por 'no'/next.
        // El tiempo máximo es del paso; sin configurar, los 3 días de siempre.
        return {
          kind: 'waitReply',
          nodeId: node.id,
          resumeAt: new Date(Date.now() + msDeEsperaDeRespuesta(cfg)),
        };
      }
      case 'condition': {
        const conds = (cfg.conditions as WFCondition[]) || [];
        const match = (cfg.match as 'all' | 'any') || 'all';
        const ok = evalWF(conds, ctx, match);
        return { kind: 'continue', next: (ok ? node.yes : node.no) ?? null };
      }
      case 'branch': {
        // Bifurcación simple por probabilidad (A/B): config.percent → yes.
        const pct = Math.max(0, Math.min(100, Number(cfg.percent) || 50));
        // Determinista por id de inscripción (sin Math.random en el motor).
        const h = [...enr.id].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) % 100, 7);
        return { kind: 'continue', next: (h < pct ? node.yes : node.no) ?? null };
      }
      case 'branch_reply': {
        // Decide por LO QUE CONTESTÓ el contacto, que llega en el contexto de
        // la inscripción (lo escribe `onContactInteraction` al reanudar el
        // «esperar respuesta»). Sin texto —un clic, o el paso puesto en otro
        // sitio— se va por la salida de «cualquier otra».
        const casos = (cfg.casos as WFCaso[]) || [];
        const id = casoQueCasa(String(ctx.respuesta ?? ''), casos);
        // Un caso que casa pero sin nada colgado TERMINA ahí: si cayera en
        // `next` el contacto recibiría el mensaje del «cualquier otra», que es
        // justo el que no le corresponde.
        if (id) return { kind: 'continue', next: (node.branches || {})[id] ?? null };
        return { kind: 'continue', next: node.next ?? null };
      }
      case 'add_tag': {
        const tag = String(cfg.tag || '').trim();
        if (tag) {
          const c = await this.prisma.mktContact.findUnique({
            where: { id: enr.contactId },
            select: { tags: true },
          });
          const actuales = c?.tags ?? [];
          // Comparación sin mayúsculas ni tildes: la etiqueta se teclea a mano
          // en dos sitios (el paso y el disparador), y «VIP» y «vip» como dos
          // etiquetas distintas rompen el flujo que escucha la otra.
          const yaEsta = actuales.some((t) => sinAcentos(t) === sinAcentos(tag));
          if (!yaEsta) {
            await this.prisma.mktContact.update({
              where: { id: enr.contactId },
              data: { tags: { set: [...actuales, tag] } },
            });
            await this.fireTrigger(
              'tag_added',
              enr.contactId,
              wf.whiteLabelId,
              { etiqueta: tag },
              this.saltosDe(enr.context) + 1,
            );
          }
        }
        return { kind: 'continue', next: node.next ?? null };
      }
      case 'remove_tag': {
        const tag = String(cfg.tag || '').trim();
        if (tag) {
          const c = await this.prisma.mktContact.findUnique({
            where: { id: enr.contactId },
            select: { tags: true },
          });
          const actuales = c?.tags ?? [];
          const quedan = actuales.filter((t) => sinAcentos(t) !== sinAcentos(tag));
          // Se escribe la lista SIN la etiqueta, no una lista nueva: las demás
          // etiquetas del contacto se quedan donde estaban.
          if (quedan.length !== actuales.length) {
            await this.prisma.mktContact.update({
              where: { id: enr.contactId },
              data: { tags: { set: quedan } },
            });
            await this.fireTrigger(
              'tag_removed',
              enr.contactId,
              wf.whiteLabelId,
              { etiqueta: tag },
              this.saltosDe(enr.context) + 1,
            );
          }
        }
        return { kind: 'continue', next: node.next ?? null };
      }
      case 'update_field': {
        const campo = String(cfg.campo || '').trim();
        // Lista blanca: fuera de ella no se escribe NADA. `email` y `phone`
        // son la identidad del contacto (phoneKey/phoneNorm + índices únicos
        // parciales) y solo los toca `resolveContact`.
        if (!MKT_CAMPOS_EDITABLES.some((c) => c.value === campo)) {
          this.log.warn(`update_field con campo no permitido («${campo}»): no se escribe nada.`);
          return { kind: 'continue', next: node.next ?? null };
        }
        const valor = resolveMerge(String(cfg.valor ?? ''), ctx).trim();
        // Vacío NO borra: un {{merge}} que no trae valor dejaría al contacto
        // sin nombre y eso no se puede deshacer.
        if (valor) {
          await this.prisma.mktContact.update({
            where: { id: enr.contactId },
            data: { [campo]: valor },
          });
          // El dato cambió de verdad: se avisa. Cuenta como un salto entre
          // flujos porque puede encadenar —«contacto actualizado» → un flujo
          // que actualiza otro dato— exactamente igual que las etiquetas.
          await this.fireTrigger(
            'contact_updated',
            enr.contactId,
            wf.whiteLabelId,
            { campo, valor },
            this.saltosDe(enr.context) + 1,
          );
        }
        return { kind: 'continue', next: node.next ?? null };
      }
      case 'goto_node': {
        const destino = String(cfg.paso ?? '').trim();
        // Sin destino termina el flujo aquí: mandarlo a `next` sería seguir
        // por donde el usuario ya dijo que NO quería seguir.
        if (!destino) return { kind: 'continue', next: null };
        const saltos = this.saltosDePaso(enr.context) + 1;
        if (saltos > MKT_MAX_SALTOS_DE_PASO) {
          this.log.warn(`goto_node: ${saltos} vueltas dentro del flujo ${wf.id}; se saca al contacto para cortar el bucle.`);
          return { kind: 'removed' };
        }
        await this.guardarContexto(enr, { saltosDePaso: saltos });
        return { kind: 'continue', next: destino };
      }
      case 'remove_from_workflows': {
        const modo = String(cfg.modo ?? 'otros');
        // SIEMPRE acotado a la marca del flujo: `MktEnrollment` guarda su
        // `whiteLabelId`, y sin él un flujo de una marca podría parar las
        // secuencias que otra marca tiene en marcha con la misma persona.
        const base = {
          contactId: enr.contactId,
          whiteLabelId: wf.whiteLabelId,
          status: { in: ['active', 'waiting'] },
        };
        const fuera = { status: 'removed', resumeAt: null, completedAt: new Date() };
        if (modo === 'todos') {
          await this.prisma.mktEnrollment.updateMany({ where: base, data: fuera });
          return { kind: 'removed' };
        }
        if (modo === 'uno') {
          const pedido = String(cfg.workflowId ?? '').trim();
          const otro = pedido
            ? await this.prisma.mktWorkflow.findFirst({
                where: { id: pedido, whiteLabelId: wf.whiteLabelId },
                select: { id: true },
              })
            : null;
          if (!otro) {
            this.log.warn('remove_from_workflows: el flujo elegido no existe o no es de esta marca.');
            return { kind: 'continue', next: node.next ?? null };
          }
          await this.prisma.mktEnrollment.updateMany({ where: { ...base, workflowId: otro.id }, data: fuera });
          if (otro.id === wf.id) return { kind: 'removed' };
          return { kind: 'continue', next: node.next ?? null };
        }
        await this.prisma.mktEnrollment.updateMany({
          where: { ...base, workflowId: { not: wf.id } },
          data: fuera,
        });
        return { kind: 'continue', next: node.next ?? null };
      }
      case 'wait_appointment': {
        const cita = await this.citaDelContacto(enr.contactId, wf.whiteLabelId);
        if (!cita) {
          // Sin cita TODAVÍA se RETIENE al contacto y se vuelve a mirar en 6 h.
          // Seguir de largo soltaría de una vez todos los mensajes que hablan
          // de una reunión que aún no existe.
          if (String(cfg.sinCita ?? 'esperar') === 'seguir') {
            return { kind: 'continue', next: node.next ?? null };
          }
          return { kind: 'wait', resumeAt: new Date(Date.now() + 6 * 3600000), waitKind: 'cita', resumeNodeId: node.id };
        }
        const momento = momentoDeLaCita(cita.startAt, cfg);
        if (momento > Date.now()) {
          // Se aparca en el paso SIGUIENTE: al volver hay que enviar, no
          // recalcular la espera y descubrir que el momento «ya pasó».
          return { kind: 'wait', resumeAt: new Date(momento), waitKind: 'cita', resumeNodeId: node.next ?? null };
        }
        if (queHacerSiYaPaso(cfg) === 'salir') {
          this.log.log(`wait_appointment: el momento ya pasó y el recordatorio ya no sirve; se saca al contacto ${enr.contactId}.`);
          return { kind: 'removed' };
        }
        return { kind: 'continue', next: node.next ?? null };
      }
      case 'create_task': {
        const titulo = resolveMerge(String(cfg.titulo ?? ''), ctx).replace(/\s+/g, ' ').trim().slice(0, 40);
        if (!titulo) {
          this.log.warn('create_task sin acción configurada: no se crea nada.');
          return { kind: 'continue', next: node.next ?? null };
        }
        const lead = await this.leadDelContacto(enr.contactId, wf.whiteLabelId);
        if (!lead) return this.sinLead('create_task', node);
        // El candado va ANTES de crear: una tarea duplicada se la come el
        // vendedor y la tiene que borrar a mano, así que preferimos perder una
        // si el proceso se cae justo aquí a que salgan dos.
        if (!(await this.reservarPaso(enr, node.id))) return { kind: 'continue', next: node.next ?? null };
        const dias = Number(cfg.vence);
        const vence = String(cfg.vence ?? '') !== '' && Number.isFinite(dias)
          ? diaEnBogota(Date.now() + dias * 86400000)
          : null;
        await this.prisma.salesTask.create({
          data: {
            salesTeamId: lead.salesTeamId,
            leadId: lead.id,
            title: titulo,
            body: cfg.detalle ? resolveMerge(String(cfg.detalle), ctx).slice(0, 2000) : null,
            dueDate: vence,
            assignedUserId: await this.miembroDelEquipo(lead, cfg.asignarA),
          },
        });
        await this.anotarEnElLead(lead, `Tarea creada por un flujo: «${titulo}»`);
        return { kind: 'continue', next: node.next ?? null };
      }
      case 'create_opportunity': {
        const lead = await this.leadDelContacto(enr.contactId, wf.whiteLabelId);
        if (!lead) return this.sinLead('create_opportunity', node);
        const destino = await this.embudoYEtapa(lead.salesTeamId, cfg.embudo, cfg.etapa);
        if (!destino) {
          this.log.warn(`create_opportunity: el equipo del lead no tiene el embudo «${String(cfg.embudo ?? '')}» o su etapa «${String(cfg.etapa ?? '')}».`);
          return { kind: 'continue', next: node.next ?? null };
        }
        // Una oportunidad ABIERTA por lead y embudo: si ya la tiene, se MUEVE.
        // Crear otra dejaría al mismo lead en dos columnas del mismo tablero.
        const abierta = await this.prisma.salesOpportunity.findFirst({
          where: { leadId: lead.id, salesTeamId: lead.salesTeamId, pipelineId: destino.embudo.id, status: 'abierta' },
          orderBy: { updatedAt: 'desc' },
          select: { id: true, stageId: true },
        });
        if (abierta) {
          if (abierta.stageId !== destino.etapa.id) {
            await this.prisma.salesOpportunity.updateMany({
              where: { id: abierta.id, salesTeamId: lead.salesTeamId },
              data: { stageId: destino.etapa.id, position: await this.finDeLaEtapa(destino.etapa.id, lead.salesTeamId) },
            });
          }
          return { kind: 'continue', next: node.next ?? null };
        }
        if (!(await this.reservarPaso(enr, node.id))) return { kind: 'continue', next: node.next ?? null };
        await this.prisma.salesOpportunity.create({
          data: {
            salesTeamId: lead.salesTeamId,
            whiteLabelId: wf.whiteLabelId,
            pipelineId: destino.embudo.id,
            stageId: destino.etapa.id,
            leadId: lead.id,
            name: resolveMerge(String(cfg.nombre ?? ''), ctx).trim().slice(0, 120) || lead.name || 'Oportunidad',
            value: Math.max(0, Number(cfg.valor) || 0),
            source: 'flujo',
            assignedUserId: lead.assignedUserId,
            position: await this.finDeLaEtapa(destino.etapa.id, lead.salesTeamId),
          },
        });
        await this.anotarEnElLead(lead, `Oportunidad creada por un flujo en «${destino.embudo.name}»`);
        return { kind: 'continue', next: node.next ?? null };
      }
      case 'update_opportunity': {
        const lead = await this.leadDelContacto(enr.contactId, wf.whiteLabelId);
        if (!lead) return this.sinLead('update_opportunity', node);
        const embudoPedido = String(cfg.embudo ?? '').trim();
        let pipelineId: string | undefined;
        if (embudoPedido) {
          const embudos = await this.embudosDelEquipo(lead.salesTeamId);
          const embudo = elegirPorNombre(embudos, embudoPedido);
          if (!embudo) {
            this.log.warn(`update_opportunity: el equipo del lead no tiene el embudo «${embudoPedido}».`);
            return { kind: 'continue', next: node.next ?? null };
          }
          pipelineId = embudo.id;
        }
        const opp = await this.prisma.salesOpportunity.findFirst({
          where: { leadId: lead.id, salesTeamId: lead.salesTeamId, ...(pipelineId ? { pipelineId } : {}) },
          orderBy: { updatedAt: 'desc' },
          select: { id: true, pipelineId: true, stageId: true, status: true },
        });
        if (!opp) {
          this.log.log('update_opportunity: el lead no tiene ninguna oportunidad que actualizar.');
          return { kind: 'continue', next: node.next ?? null };
        }
        const data: Record<string, unknown> = {};
        const etapaPedida = String(cfg.etapa ?? '').trim();
        if (etapaPedida) {
          // La etapa se busca en el embudo DE LA OPORTUNIDAD: escribir una de
          // otro embudo deja la tarjeta fuera de todas las columnas.
          const etapas = await this.etapasDelEmbudo(opp.pipelineId, lead.salesTeamId);
          const etapa = etapas.find((e) => mismoNombre(e.name, etapaPedida));
          if (!etapa) {
            this.log.warn(`update_opportunity: el embudo de la oportunidad no tiene la etapa «${etapaPedida}».`);
          } else if (etapa.id !== opp.stageId) {
            data.stageId = etapa.id;
            data.position = await this.finDeLaEtapa(etapa.id, lead.salesTeamId);
          }
        }
        const estado = String(cfg.estado ?? '').trim();
        if (estado && ESTADOS_DE_OPORTUNIDAD_DEL_FLUJO.some((e) => e.value === estado) && estado !== opp.status) {
          // Una oportunidad YA GANADA no la reabre ni la pierde un flujo: al
          // ganarla, el CRM movió el lead a clientes y registró la venta. Desde
          // aquí solo se cambiaría la palabra, y quedaría una venta contada
          // sobre una oportunidad «perdida». El desenlace se respeta.
          if (opp.status === 'ganada') {
            this.log.warn('update_opportunity: la oportunidad ya está ganada; el estado se deja como está.');
          } else {
            const cierraSinVenta = estado === 'perdida' || estado === 'abandonada';
            data.status = estado;
            // `wonAt` NO se toca: el flujo no puede marcar «ganada» ni tocar una
            // que ya lo esté, así que la fecha de la venta la pone solo el CRM.
            data.lostAt = cierraSinVenta ? new Date() : null;
            // Al reabrir se limpia también el motivo: si no, queda una
            // oportunidad abierta con «no tenía presupuesto» colgando.
            if (!cierraSinVenta) data.lostReason = null;
          }
        }
        const valor = String(cfg.valor ?? '').trim();
        if (valor !== '' && Number.isFinite(Number(valor))) data.value = Math.max(0, Number(valor));
        if (Object.keys(data).length) {
          // Se exige el estado que se leyó: entre la lectura y esta línea un
          // vendedor puede haber ganado la oportunidad, y escribir «perdida»
          // encima dejaría una venta registrada sobre una tarjeta perdida.
          const escrito = await this.prisma.salesOpportunity.updateMany({
            where: { id: opp.id, salesTeamId: lead.salesTeamId, status: opp.status },
            data,
          });
          if (escrito.count === 0) {
            this.log.warn(
              'update_opportunity: alguien cambió la oportunidad mientras tanto; no se escribe encima.',
            );
          } else {
            await this.anotarEnElLead(lead, 'Un flujo actualizó una oportunidad');
          }
        }
        return { kind: 'continue', next: node.next ?? null };
      }
      case 'meeting_confirm': {
        const cita = await this.citaDelContacto(enr.contactId, wf.whiteLabelId, true);
        if (!cita) {
          this.log.log('meeting_confirm: el contacto no tiene ninguna cita viva.');
          return { kind: 'continue', next: node.next ?? null };
        }
        // `confirmedAt: null` en el where hace el paso idempotente: la segunda
        // vuelta no cuenta y no reescribe la fecha de la confirmación.
        const confirmada = await this.prisma.salesMeeting.updateMany({
          where: { id: cita.id, salesTeamId: cita.salesTeamId, status: { in: ESTADOS_DE_CITA_VIVA }, confirmedAt: null },
          data: { status: 'CONFIRMADA', confirmedAt: new Date() },
        });
        if (confirmada.count && cita.leadId) {
          await this.anotarEnElLead({ id: cita.leadId, salesTeamId: cita.salesTeamId }, 'Un flujo confirmó la cita');
        }
        return { kind: 'continue', next: node.next ?? null };
      }
      case 'meeting_cancel': {
        const cita = await this.citaDelContacto(enr.contactId, wf.whiteLabelId, true);
        if (!cita) {
          this.log.log('meeting_cancel: el contacto no tiene ninguna cita viva.');
          return { kind: 'continue', next: node.next ?? null };
        }
        // Solo desde un estado VIVO. Una cita `REALIZADA` o `NO_ASISTIO` es un
        // desenlace y voltearla escondería los plantones, que es justo lo que
        // el equipo necesita ver.
        const cancelada = await this.prisma.salesMeeting.updateMany({
          where: { id: cita.id, salesTeamId: cita.salesTeamId, status: { in: ESTADOS_DE_CITA_VIVA } },
          data: { status: 'CANCELADA' },
        });
        if (cancelada.count && cita.leadId) {
          await this.anotarEnElLead(
            { id: cita.leadId, salesTeamId: cita.salesTeamId },
            'Un flujo canceló la cita. El evento sigue en el Google Calendar del vendedor.',
          );
        }
        return { kind: 'continue', next: node.next ?? null };
      }
      case 'notify_team': {
        // Al EQUIPO de la marca, no al contacto: «Fulano acaba de responder».
        // Sale por la misma subcuenta y queda en el Registro como un envío más,
        // con sus reintentos. NO respeta la ventana de envío a propósito: es un
        // aviso interno, y de madrugada sigue siendo cuando hay que enterarse.
        const destino = String(cfg.to || '').trim();
        if (!destino) return { kind: 'continue', next: node.next ?? null };
        const canal = String(cfg.canal || 'sms') === 'email' ? 'email' : 'sms';
        const mensaje = resolveMerge(String(cfg.message || ''), ctx);
        await this.actions.dispatch({
          workflowId: wf.id,
          enrollmentId: enr.id,
          contactId: enr.contactId,
          whiteLabelId: wf.whiteLabelId,
          nodeId: node.id,
          channel: canal,
          to: destino,
          subject: canal === 'email' ? `Aviso de ${ctx.marca}` : null,
          body: canal === 'email' ? mensaje.replace(/\n/g, '<br>') : mensaje,
          // INTERNO: el aviso se guarda con el contacto (es su flujo), así que
          // sin esto, abrirlo el vendedor se leería como que respondió él.
          interno: true,
        });
        return { kind: 'continue', next: node.next ?? null };
      }
      case 'webhook': {
        const url = String(cfg.url || '').trim();
        // Quien configura el flujo es el administrador de una marca —un
        // cliente, no alguien de casa— y el servidor sí puede hablar con la red
        // interna de Railway. Sin esta comprobación, un webhook servía para
        // curiosear ahí dentro.
        if (!/^https?:\/\//i.test(url) || destinoInterno(url)) {
          this.log.warn(`webhook no llamado (URL inválida o de la red interna): ${url || '—'}`);
          return { kind: 'continue', next: node.next ?? null };
        }
        const method = String(cfg.method || 'POST').toUpperCase();
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        for (const h of (cfg.headers as { key: string; value: string }[]) || []) {
          if (h?.key) headers[h.key] = resolveMerge(String(h.value ?? ''), ctx);
        }
        const cuerpo = String(cfg.body || '').trim()
          ? resolveMerge(String(cfg.body), ctx)
          : JSON.stringify({ contactId: enr.contactId, ...ctx });
        try {
          await fetch(url, {
            method,
            signal: AbortSignal.timeout(8000),
            headers,
            body: method === 'GET' ? undefined : cuerpo,
            // Sin seguir redirecciones: si no, una URL pública puede reenviar a
            // la red interna y saltarse la comprobación de arriba.
            redirect: 'manual',
          });
        } catch {
          /* el webhook es best-effort; no frena la cadena */
        }
        return { kind: 'continue', next: node.next ?? null };
      }
      case 'goto_workflow': {
        // Lo mete en otro flujo y lo saca de este. El destino tiene que ser de
        // la MISMA marca: si no, un flujo de Sellea movería contactos de otra.
        const destino = String(cfg.workflowId || '').trim();
        const otro = destino
          ? await this.prisma.mktWorkflow.findFirst({
              where: { id: destino, whiteLabelId: wf.whiteLabelId, status: 'published' },
              select: { id: true },
            })
          : null;
        if (!otro) {
          this.log.warn('goto_workflow: el flujo destino no existe, no es de esta marca o no está publicado.');
          return { kind: 'continue', next: node.next ?? null };
        }
        const saltos = this.saltosDe(enr.context) + 1;
        if (saltos > MKT_MAX_SALTOS) {
          this.log.warn(`goto_workflow: demasiados saltos entre flujos (${saltos}); se detiene aquí.`);
          return { kind: 'removed' };
        }
        await this.enroll(otro.id, enr.contactId, {
          ...((enr.context as Record<string, unknown>) || {}),
          saltos,
        });
        return { kind: 'removed' };
      }
      case 'end':
        return { kind: 'removed' };
      default:
        return { kind: 'continue', next: node.next ?? null };
    }
  }

  /** Cuántas veces ha rebotado ya este contacto de un flujo a otro. */
  private saltosDe(context: unknown): number {
    return Number((context as Record<string, unknown> | null)?.saltos ?? 0) || 0;
  }

  /** Cuántas vueltas lleva dentro de ESTE flujo por un «Ir a un paso». */
  private saltosDePaso(context: unknown): number {
    return Number((context as Record<string, unknown> | null)?.saltosDePaso ?? 0) || 0;
  }

  /**
   * Escribe algo en el contexto de la inscripción y lo deja también en la copia
   * en memoria, que es la que sigue usando el resto de la pasada.
   */
  private async guardarContexto(
    enr: { id: string; context: unknown },
    patch: Record<string, unknown>,
  ): Promise<void> {
    const contexto = { ...((enr.context as Record<string, unknown>) || {}), ...patch };
    await this.prisma.mktEnrollment.update({
      where: { id: enr.id },
      data: { context: contexto as Prisma.InputJsonValue },
    });
    enr.context = contexto;
  }

  /**
   * Candado de «esto se hace UNA vez» para los pasos que CREAN algo.
   *
   * El motor ya reclama la inscripción antes de avanzarla (`tick`), así que dos
   * pods no la procesan a la vez; lo que queda por cubrir es el proceso que se
   * cae a mitad de un nodo: 5 minutos después la inscripción se retoma desde el
   * MISMO nodo y lo volvería a ejecutar.
   *
   * Es un UPDATE CONDICIONAL y se mira el `count`, no un «leer, decidir,
   * escribir»: la marca solo se escribe si no estaba, y quien la escribe es
   * quien puede crear. Se marca ANTES de crear a propósito — si el proceso se
   * cae entre las dos cosas se pierde una tarea, y eso se arregla; dos tareas
   * iguales en el CRM las tiene que borrar alguien a mano.
   *
   * La marca lleva la VUELTA del flujo, no solo el nodo: un «Ir a un paso» que
   * vuelve sobre un «Crear tarea» es un diseño legítimo —insistir cada día— y
   * sin el contador la segunda vuelta se quedaría sin tarea sin decir nada.
   */
  private async reservarPaso(enr: { id: string; context: unknown }, nodeId: string): Promise<boolean> {
    const marca = `hecho_${nodeId}_${this.saltosDePaso(enr.context)}`;
    const contexto = { ...((enr.context as Record<string, unknown>) || {}) };
    if (contexto[marca] === true) return false;
    // SQL crudo a propósito.
    //
    // `NOT: { context: { path: [marca], equals: true } }` se traduce a
    // `NOT (context #> '{marca}' = 'true')`, y en Postgres, la PRIMERA vez —que
    // es siempre— esa ruta no existe: NULL = 'true' da NULL, NOT NULL da NULL,
    // y la fila no se actualiza. Resultado: `count` 0 y el paso no creaba NUNCA
    // la tarea ni la oportunidad. El test no lo veía porque la base falsa
    // evalúa el NOT con la lógica de JavaScript, que no es la de SQL.
    const contextoNuevo = JSON.stringify({ ...contexto, [marca]: true });
    const filas = await this.prisma.$executeRaw`
      UPDATE "MktEnrollment"
         SET "context" = ${contextoNuevo}::jsonb, "updatedAt" = now()
       WHERE "id" = ${enr.id}
         AND COALESCE("context" ->> ${marca}, '') <> 'true'`;
    if (filas === 0) return false;
    enr.context = { ...contexto, [marca]: true };
    return true;
  }

  /**
   * Deja constancia en la ficha del lead de lo que hizo el flujo.
   *
   * El módulo de ventas lo hace en cada operación suya, y sin esto el vendedor
   * veía una tarea salida de la nada, sin saber qué la creó. Además refresca
   * `lastActivityAt`: el propio motor elige el lead más activo del contacto, y
   * un lead trabajado solo por flujos se iba quedando atrás.
   *
   * Nunca rompe el paso: si falla, el flujo sigue (la tarea ya se creó).
   */
  private async anotarEnElLead(
    lead: { id: string; salesTeamId: string },
    texto: string,
  ): Promise<void> {
    await Promise.all([
      this.prisma.salesLeadActivity
        .create({
          data: {
            leadId: lead.id,
            salesTeamId: lead.salesTeamId,
            // Sin usuario: no lo hizo una persona, lo hizo un flujo.
            userId: null,
            kind: 'sistema',
            body: texto,
          },
        })
        .catch(() => null),
      this.prisma.salesLead
        .updateMany({ where: { id: lead.id }, data: { lastActivityAt: new Date() } })
        .catch(() => null),
    ]);
  }

  /** El paso necesitaba un lead y este contacto no lo es: se dice y el flujo sigue. */
  private sinLead(paso: string, node: WFNode): NodeResult {
    this.log.log(`${paso}: el contacto no es lead de ningún equipo de esta marca; no hay sobre qué actuar.`);
    return { kind: 'continue', next: node.next ?? null };
  }

  // ── El puente con Equipos de Ventas ──
  /**
   * El lead de este contacto DENTRO de la marca del flujo.
   *
   * `SalesLead.mktContactId` es el enlace: lo escribe el propio puente de
   * ventas (`sales-automations.service.ts`) la primera vez que un lead dispara
   * algo, y el alta de leads lo resuelve por identidad. El `whiteLabelId` no es
   * decoración: sin él, un flujo de Sellea podría crear tareas en el equipo de
   * otra marca que tuviera al mismo contacto.
   *
   * Si hay varios (la misma persona en dos equipos) gana el de actividad más
   * reciente, que es donde de verdad se le está trabajando.
   */
  private async leadDelContacto(contactId: string, whiteLabelId: string) {
    return this.prisma.salesLead.findFirst({
      // La marca se comprueba por el EQUIPO del lead: `SalesLead.whiteLabelId`
      // es una copia que en los equipos antiguos está vacía, y filtrando por
      // ella todos los pasos de ventas se quedaban sin hacer nada, en silencio.
      where: { mktContactId: contactId, team: { whiteLabelId } },
      orderBy: { lastActivityAt: 'desc' },
      select: { id: true, name: true, salesTeamId: true, assignedUserId: true },
    });
  }

  /**
   * La cita de la que habla el flujo: la próxima viva o, si no queda ninguna
   * por delante, la última que tuvo.
   *
   * `soloPorDelante` es para los pasos que ESCRIBEN sobre la cita (confirmar,
   * cancelar). Una reunión que ya pasó y que nadie cerró es casi siempre un
   * plantón sin registrar: cancelarla la contaría como cancelación y escondería
   * lo que de verdad ocurrió. Se dan dos horas de gracia para que un «ahí
   * estaré» que llega con la reunión empezando siga confirmando la suya.
   */
  private async citaDelContacto(contactId: string, whiteLabelId: string, soloPorDelante = false) {
    const lead = await this.leadDelContacto(contactId, whiteLabelId);
    if (!lead) return null;
    const citas = await this.prisma.salesMeeting.findMany({
      where: {
        leadId: lead.id,
        salesTeamId: lead.salesTeamId,
        status: { in: ESTADOS_DE_CITA_VIVA },
        ...(soloPorDelante ? { startAt: { gte: new Date(Date.now() - 2 * 3600000) } } : {}),
      },
      orderBy: { startAt: 'asc' },
      take: 50,
      // `leadId` para poder dejar el rastro en la ficha del lead.
      select: { id: true, startAt: true, salesTeamId: true, leadId: true },
    });
    return elegirCitaDeReferencia(citas);
  }

  /**
   * A quién se le deja la tarea. Si la persona elegida ya no está en el equipo
   * DEL LEAD, la tarea vuelve a quien lo lleva: una tarea asignada a alguien de
   * otro equipo no la ve nadie.
   */
  private async miembroDelEquipo(
    lead: { salesTeamId: string; assignedUserId: string | null },
    pedido: unknown,
  ): Promise<string | null> {
    const userId = String(pedido ?? '').trim();
    if (!userId) return lead.assignedUserId;
    const miembro = await this.prisma.salesTeamMember.findFirst({
      where: { teamId: lead.salesTeamId, userId, isActive: true },
      select: { userId: true },
    });
    return miembro?.userId ?? lead.assignedUserId;
  }

  private async embudosDelEquipo(salesTeamId: string) {
    return this.prisma.salesPipeline.findMany({
      where: { salesTeamId },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, name: true },
    });
  }

  private async etapasDelEmbudo(pipelineId: string, salesTeamId: string) {
    return this.prisma.salesPipelineStage.findMany({
      where: { pipelineId, salesTeamId },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, name: true },
    });
  }

  /**
   * El embudo y la etapa que pide el paso, buscados POR NOMBRE en el equipo del
   * lead. Devuelve null si el nombre configurado no existe ahí: ver
   * `elegirPorNombre`.
   */
  private async embudoYEtapa(salesTeamId: string, nombreEmbudo: unknown, nombreEtapa: unknown) {
    const embudo = elegirPorNombre(await this.embudosDelEquipo(salesTeamId), nombreEmbudo);
    if (!embudo) return null;
    const etapa = elegirPorNombre(await this.etapasDelEmbudo(embudo.id, salesTeamId), nombreEtapa);
    if (!etapa) return null;
    return { embudo, etapa };
  }

  /** La posición con la que una tarjeta cae al final de su columna. */
  private async finDeLaEtapa(stageId: string, salesTeamId: string): Promise<number> {
    const ultima = await this.prisma.salesOpportunity.findFirst({
      where: { stageId, salesTeamId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    return (ultima?.position ?? -1) + 1;
  }

  private async complete(enrId: string, status: 'completed' | 'removed') {
    await this.prisma.mktEnrollment
      .update({ where: { id: enrId }, data: { status, completedAt: new Date(), resumeAt: null } })
      .catch(() => {});
  }

  private async advance(enr: {
    id: string;
    workflowId: string;
    contactId: string;
    currentNodeId: string | null;
    context: unknown;
    waitingNodeId?: string | null;
  }) {
    const wf = await this.prisma.mktWorkflow.findUnique({ where: { id: enr.workflowId } });
    if (!wf || wf.status !== 'published') {
      await this.complete(enr.id, 'removed');
      return;
    }
    // Opt-out: una baja detiene TODO.
    const contact = await this.prisma.mktContact.findUnique({
      where: { id: enr.contactId },
      select: { optOut: true, deleted: true },
    });
    if (!contact || contact.deleted || contact.optOut) {
      await this.complete(enr.id, 'removed');
      return;
    }

    const graph = (wf.nodes as WFGraph) || {};
    let nodeId = enr.currentNodeId;
    let waitingNodeId = enr.waitingNodeId ?? null;
    let guard = 0;
    while (nodeId && guard++ < 60) {
      const node = graph[nodeId];
      if (!node) break;

      // Timeout de wait_reply: si ya estábamos esperando en ESTE nodo y el cron
      // nos re-entró (venció), seguimos por la rama 'no'/next.
      if (node.type === 'wait_reply' && waitingNodeId === node.id) {
        waitingNodeId = null;
        nodeId = node.no ?? node.next ?? null;
        enr.currentNodeId = nodeId;
        continue;
      }

      const res = await this.runNode(wf, node, enr);
      if (res.kind === 'wait') {
        await this.prisma.mktEnrollment.update({
          where: { id: enr.id },
          data: {
            status: 'waiting',
            currentNodeId: res.resumeNodeId,
            resumeAt: res.resumeAt,
            waitKind: res.waitKind,
            waitingNodeId: null,
            waitingSince: null,
          },
        });
        return;
      }
      if (res.kind === 'waitReply') {
        await this.prisma.mktEnrollment.update({
          where: { id: enr.id },
          data: {
            status: 'waiting',
            currentNodeId: res.nodeId,
            resumeAt: res.resumeAt,
            waitKind: 'reply',
            waitingNodeId: res.nodeId,
            waitingSince: new Date(),
          },
        });
        return;
      }
      if (res.kind === 'complete') {
        await this.complete(enr.id, 'completed');
        return;
      }
      if (res.kind === 'removed') {
        await this.complete(enr.id, 'removed');
        return;
      }
      nodeId = res.next;
      enr.currentNodeId = nodeId;
    }
    await this.complete(enr.id, 'completed');
  }

  // ── API pública ──
  /**
   * Inscribe un contacto en un flujo publicado.
   *
   * Devuelve qué pasó, en vez de `void`: descarta EN SILENCIO al contacto que ya
   * estaba inscrito, que pidió no recibir mensajes o que fue borrado, y quien
   * inscribe a mano (Contactos → «Inscribir») necesita distinguir eso de una
   * inscripción real para no enseñar «500 inscritos» cuando no pasó nada
   * (Fable, 2026-09-14). Los llamadores que ya existían ignoran el valor.
   */
  async enroll(
    workflowId: string,
    contactId: string,
    context?: Record<string, unknown>,
  ): Promise<'inscrito' | 'omitido' | 'fallo'> {
    try {
      // Cortafuegos de los rebotes entre flujos: vale tanto para «pasar a otro
      // flujo» como para la cadena etiqueta → flujo → etiqueta → flujo.
      if (this.saltosDe(context) > MKT_MAX_SALTOS) {
        this.log.warn(`enroll: demasiados saltos entre flujos para el contacto ${contactId}; se corta.`);
        return 'omitido';
      }
      const wf = await this.prisma.mktWorkflow.findUnique({ where: { id: workflowId } });
      if (!wf || wf.status !== 'published' || !wf.rootId) return 'omitido';
      const contact = await this.prisma.mktContact.findUnique({
        where: { id: contactId },
        select: { deleted: true, optOut: true },
      });
      if (!contact || contact.deleted || contact.optOut) return 'omitido';
      if (!wf.reentry) {
        const existing = await this.prisma.mktEnrollment.findFirst({
          where: { workflowId, contactId },
          select: { id: true },
        });
        if (existing) return 'omitido';
      } else {
        const active = await this.prisma.mktEnrollment.findFirst({
          where: { workflowId, contactId, status: { in: ['active', 'waiting'] } },
          select: { id: true },
        });
        if (active) return 'omitido';
      }
      const enr = await this.prisma.mktEnrollment.create({
        data: {
          workflowId,
          contactId,
          whiteLabelId: wf.whiteLabelId,
          status: 'active',
          currentNodeId: wf.rootId,
          resumeAt: new Date(),
          // Lo que sabe el disparador viaja CON la inscripción: sin esto,
          // {{etapa}} o {{respuesta}} servían para filtrar en el disparador y
          // luego salían vacíos en el correo del paso siguiente.
          ...(context ? { context: context as Prisma.InputJsonValue } : {}),
        },
      });
      await this.advance(enr);
      return 'inscrito';
    } catch (e) {
      // El índice único parcial sobre `(workflowId, context->>'eventoRef')` es
      // el candado del barrido de ventas cuando hay más de un pod: si otro ya
      // inscribió por ESTE mismo evento, esto es lo que se ve. No es un fallo —
      // es la segunda vuelta haciendo lo correcto.
      if ((e as { code?: string })?.code === 'P2002') return 'omitido';
      this.log.warn(`mkt enroll falló: ${(e as Error).message}`);
      return 'fallo';
    }
  }

  /**
   * Una INTERACCIÓN del contacto (reply/open/click) reanuda sus nodos wait_reply
   * (rama 'yes'/next) y dispara el trigger email_reply. Lo llama el webhook (Fase 5).
   */
  async onContactInteraction(contactId: string, whiteLabelId: string, texto?: string): Promise<void> {
    try {
      const respuesta = String(texto ?? '').trim();
      const waiting = await this.prisma.mktEnrollment.findMany({
        where: { contactId, status: 'waiting', waitKind: 'reply' },
      });
      for (const enr of waiting) {
        const wf = await this.prisma.mktWorkflow.findUnique({ where: { id: enr.workflowId } });
        const graph = ((wf?.nodes as WFGraph) || {}) as WFGraph;
        const node = enr.waitingNodeId ? graph[enr.waitingNodeId] : null;
        const nextId = (node?.yes ?? node?.next) ?? null;
        // El TEXTO de la respuesta se guarda en el contexto de la inscripción:
        // es lo que mira «Ramas por respuesta» y lo que rellena {{respuesta}}.
        // Sin esto el motor solo sabía QUE respondió, no QUÉ.
        const contexto = {
          ...((enr.context as Record<string, unknown>) || {}),
          ...(respuesta ? { respuesta } : {}),
        };
        await this.prisma.mktEnrollment.update({
          where: { id: enr.id },
          data: {
            status: 'active',
            currentNodeId: nextId,
            resumeAt: new Date(),
            waitKind: null,
            waitingNodeId: null,
            waitingSince: null,
            context: contexto as Prisma.InputJsonValue,
          },
        });
        await this.advance({ ...enr, currentNodeId: nextId, waitingNodeId: null, context: contexto });
      }
      await this.fireTrigger(
        'email_reply',
        contactId,
        whiteLabelId,
        respuesta ? { respuesta } : undefined,
      );
    } catch (e) {
      this.log.warn(`onContactInteraction falló: ${(e as Error).message}`);
    }
  }

  // ── Disparadores ──
  // Un flujo escucha un tipo si CUALQUIERA de sus disparadores es de ese tipo:
  // mirar solo `trigger` dejaría fuera a quien añadió un segundo disparador.
  private async publishedByTrigger(type: string, whiteLabelId: string) {
    const all = await this.prisma.mktWorkflow.findMany({
      where: { whiteLabelId, status: 'published', rootId: { not: null } },
    });
    return all.filter((wf) => escuchaEl(wf, type));
  }

  /**
   * Disparo en tiempo real (contact_created, tag_added, email_reply y los de
   * ventas). Idempotente.
   *
   * `extra` son campos que NO viven en el contacto y que la condición del
   * disparador puede mirar igual: la etapa a la que acaba de pasar el lead, su
   * equipo, su vendedor. Sin esto, «cuando pase a Interesados» no se puede
   * expresar — el filtro solo veía nombre, correo, teléfono, empresa y
   * etiquetas.
   *
   * Va después del contacto a propósito: un campo de ventas con el mismo
   * nombre que uno del contacto gana, porque es el que describe lo que acaba
   * de pasar.
   */
  async fireTrigger(
    type: string,
    contactId: string,
    whiteLabelId: string,
    extra?: Record<string, string>,
    saltos?: number,
  ): Promise<void> {
    try {
      const wfs = await this.publishedByTrigger(type, whiteLabelId);
      if (!wfs.length) return;
      const ctx = { ...(await this.ctxFor(contactId)), ...(extra ?? {}) };
      // La etiqueta del disparador NO es un filtro: es parte de la identidad
      // del disparador. Un flujo configurado para «cliente-vip» no puede
      // arrancar porque se haya puesto cualquier otra etiqueta. Vacía = todas.
      const etiquetaPuesta = sinAcentos(String(extra?.etiqueta ?? '')).trim();
      const esLaEtiqueta = (t: WFTrigger) => {
        if (type !== 'tag_added' && type !== 'tag_removed') return true;
        const pedida = sinAcentos(String(t.tag ?? '')).trim();
        return !pedida || pedida === etiquetaPuesta;
      };
      for (const wf of wfs) {
        // Entre disparadores basta con uno; dentro de cada uno, todos sus
        // filtros. El primero que casa es el que queda en el contexto.
        const casa = disparadorQueCasa(disparadoresDe(wf), type, ctx, esLaEtiqueta);
        if (!casa) continue;
        await this.enroll(wf.id, contactId, {
          ...(extra ?? {}),
          ...contextoDeEntrada(casa.disparador, casa.indice),
          ...(saltos ? { saltos } : {}),
        });
      }
    } catch (e) {
      this.log.warn(`fireTrigger(${type}) falló: ${(e as Error).message}`);
    }
  }

  /**
   * Escaneo horario: contactos nuevos (catch-up del disparador contact_created,
   * para los que llegan por importación o desde el tablero de ventas).
   *
   * Aplica los FILTROS del disparador, igual que `fireTrigger`. Hasta el
   * 2026-09-22 no los miraba: un flujo de «Contacto nuevo» filtrado a «solo
   * los de la etiqueta vip» respetaba el filtro con el alta a mano y se lo
   * saltaba una hora después, inscribiendo a TODOS los importados.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async scanTriggers(): Promise<void> {
    try {
      const wfs = await this.prisma.mktWorkflow.findMany({
        where: { status: 'published', rootId: { not: null } },
      });
      const created = wfs.filter((wf) => escuchaEl(wf, 'contact_created'));
      const floor = new Date(Date.now() - 7 * 86400000);
      const marcas = new Map<string, string>();
      for (const wf of created) {
        const since = wf.createdAt > floor ? wf.createdAt : floor;
        const contacts = await this.prisma.mktContact.findMany({
          where: { whiteLabelId: wf.whiteLabelId, deleted: false, createdAt: { gte: since } },
          // Los datos del contexto vienen en la misma consulta: pedir la ficha
          // de cada contacto por separado serían 500 consultas por flujo y hora.
          select: { id: true, name: true, email: true, phone: true, company: true, tags: true },
          take: 500,
        });
        if (!contacts.length) continue;
        if (!marcas.has(wf.whiteLabelId)) {
          const wl = await this.prisma.whiteLabel.findUnique({ where: { id: wf.whiteLabelId }, select: { name: true } });
          marcas.set(wf.whiteLabelId, wl?.name ?? 'Clubify');
        }
        const disparadores = disparadoresDe(wf);
        for (const c of contacts) {
          const casa = disparadorQueCasa(disparadores, 'contact_created', ctxDeContacto(c, marcas.get(wf.whiteLabelId)!));
          if (!casa) continue;
          await this.enroll(wf.id, c.id, contextoDeEntrada(casa.disparador, casa.indice));
        }
      }
    } catch (e) {
      this.log.warn(`scanTriggers falló: ${(e as Error).message}`);
    }
    // Aparte, con su propio try: que el barrido de ventas falle no puede dejar
    // sin recoger a los contactos nuevos, ni al revés.
    try {
      await this.escanearVentas();
    } catch (e) {
      this.log.warn(`escanearVentas falló: ${(e as Error).message}`);
    }
  }

  // ── Barrido de cada hora: lo que pasa en Equipos de Ventas ────────────────
  //
  // POR QUÉ UN BARRIDO Y NO UN AVISO EN EL MOMENTO. Los disparadores de ventas
  // que ya había (`sales_lead_created`, `sales_stage_changed`…) los lanza el
  // propio módulo de ventas al pasar la cosa. Estos no: el estado de la cita y
  // las oportunidades se cambian desde media docena de sitios del CRM, y
  // enganchar un aviso en cada uno significa tocar ese módulo entero. El
  // barrido mira lo que cambió en la última hora y media y lo reconoce por su
  // referencia, así que llega tarde —el catálogo lo dice: «se revisa cada
  // hora»— pero no se salta ningún camino ni deja medio módulo tocado.

  /** Los flujos publicados agrupados por marca: el barrido consulta por marca. */
  private porMarca<T extends { whiteLabelId: string }>(wfs: T[]): Map<string, T[]> {
    const mapa = new Map<string, T[]>();
    for (const wf of wfs) {
      const lista = mapa.get(wf.whiteLabelId);
      if (lista) lista.push(wf);
      else mapa.set(wf.whiteLabelId, [wf]);
    }
    return mapa;
  }

  /**
   * Qué eventos ya inscribieron a alguien, para no repetirlos.
   *
   * La ventana del barrido solapa a propósito con la vuelta anterior, así que
   * el mismo cambio se ve dos veces. La referencia del evento viaja en el
   * contexto de la inscripción (`eventoRef`) y de ahí se lee: una consulta por
   * marca, no una por candidato.
   *
   * Es una comprobación en memoria, no un candado: el candado de verdad —para
   * el día que haya dos pods corriendo el cron— es el índice único parcial
   * sobre `(workflowId, context->>'eventoRef')` que instala
   * `scripts/apply-mkt-eventos-de-ventas.cjs`. Si ese índice está puesto, la
   * inscripción repetida choca y `enroll` la cuenta como omitida.
   */
  private async eventosYaDisparados(workflowIds: string[], refs: string[]): Promise<Set<string>> {
    const vistos = new Set<string>();
    const unicas = [...new Set(refs.filter(Boolean))];
    if (!workflowIds.length || !unicas.length) return vistos;
    // Se pregunta por las REFERENCIAS de este lote, sin mirar fechas.
    //
    // Antes se leían las inscripciones de las últimas horas y se comparaba en
    // memoria: pasada esa ventana, cualquier escritura sobre la cita —los
    // crons de recordatorio tocan `updatedAt` sin cambiar nada— volvía a
    // inscribir al mismo contacto por el mismo evento. Preguntando por la
    // referencia exacta, un evento entra UNA vez y punto.
    const filas = await this.prisma.$queryRaw<{ workflowId: string; ref: string | null }[]>`
      SELECT "workflowId", "context" ->> 'eventoRef' AS ref
        FROM "MktEnrollment"
       WHERE "workflowId" = ANY(${workflowIds}::text[])
         AND "context" ->> 'eventoRef' = ANY(${unicas}::text[])`;
    for (const f of filas) {
      if (f.ref) vistos.add(claveDeEvento(f.workflowId, f.ref));
    }
    return vistos;
  }

  /** Los contactos del barrido, con su contexto, en una sola consulta. */
  private async contactosDelBarrido(ids: (string | null | undefined)[], whiteLabelId: string) {
    const mapa = new Map<string, Record<string, string>>();
    const unicos = [...new Set(ids.filter((v): v is string => !!v))];
    if (!unicos.length) return mapa;
    const [marca, filas] = await Promise.all([
      this.prisma.whiteLabel.findUnique({ where: { id: whiteLabelId }, select: { name: true } }),
      this.prisma.mktContact.findMany({
        // El `whiteLabelId` aquí es el aislamiento: un `mktContactId` de un lead
        // de otra marca no devuelve fila y ese evento no inscribe a nadie.
        where: { id: { in: unicos }, whiteLabelId, deleted: false },
        select: { id: true, name: true, email: true, phone: true, company: true, tags: true },
      }),
    ]);
    // Sin nombre de marca, {{marca}} queda VACÍO. Nunca «Clubify»: un correo
    // firmado con la marca equivocada delata la plataforma.
    for (const c of filas) mapa.set(c.id, ctxDeContacto(c, marca?.name ?? ''));
    return mapa;
  }

  /** Cómo se llama cada vendedor, en una sola consulta. */
  private async nombresDeUsuario(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
    const mapa = new Map<string, string>();
    const unicos = [...new Set(ids.filter((v): v is string => !!v))];
    if (!unicos.length) return mapa;
    const users = await this.prisma.user.findMany({
      where: { id: { in: unicos } },
      select: { id: true, fullName: true, email: true },
    });
    for (const u of users) mapa.set(u.id, u.fullName?.trim() || u.email || '');
    return mapa;
  }

  /**
   * Los ajustes propios del disparador (el estado de la cita, el embudo, la
   * etapa) son parte de su IDENTIDAD, no un filtro: vacío = vale cualquiera, y
   * puesto tiene que coincidir. Es la misma regla que la etiqueta de
   * `tag_added`.
   */
  private ajustesQueCasan(valores: Record<string, string>) {
    return (t: WFTrigger) =>
      Object.entries(valores).every(([clave, valor]) => {
        const pedido = String((t as Record<string, unknown>)[clave] ?? '').trim();
        return !pedido || mismoNombre(pedido, valor);
      });
  }

  /**
   * Inscribe por un evento del barrido en los flujos que lo escuchan.
   *
   * `ref` es lo que hace que un evento visto dos veces inscriba una: viaja en
   * el contexto de la inscripción y la vuelta siguiente lo reconoce.
   */
  private async disparar(
    tipo: string,
    ev: {
      contactId: string;
      ctxContacto: Record<string, string>;
      /** Lo que pone ESTE evento y no vive en el contacto: viaja con la inscripción. */
      extra: Record<string, string>;
      /** Los ajustes del disparador contra los que se compara (valores crudos). */
      ajustes: Record<string, string>;
      ref: string;
      flujos: { id: string; trigger: unknown; triggers: unknown }[];
      yaFueron: Set<string>;
    },
  ): Promise<void> {
    const ctx = { ...ev.ctxContacto, ...ev.extra };
    const cumple = this.ajustesQueCasan(ev.ajustes);
    for (const wf of ev.flujos) {
      const clave = claveDeEvento(wf.id, ev.ref);
      if (ev.yaFueron.has(clave)) continue;
      const casa = disparadorQueCasa(disparadoresDe(wf), tipo, ctx, cumple);
      if (!casa) continue;
      ev.yaFueron.add(clave);
      await this.enroll(wf.id, ev.contactId, {
        ...ev.extra,
        eventoRef: ev.ref,
        ...contextoDeEntrada(casa.disparador, casa.indice),
      });
    }
  }

  async escanearVentas(): Promise<void> {
    const desde = new Date(Date.now() - VENTANA_DEL_BARRIDO_MS);
    const wfs = await this.prisma.mktWorkflow.findMany({
      where: { status: 'published', rootId: { not: null } },
    });
    await this.escanearCitas(desde, wfs);
    await this.escanearOportunidades(desde, wfs);
  }

  /** «Estado de la cita cambió». */
  private async escanearCitas(
    desde: Date,
    todos: { id: string; whiteLabelId: string; trigger: unknown; triggers: unknown }[],
  ): Promise<void> {
    const escuchan = todos.filter((wf) => escuchaEl(wf, 'sales_meeting_status'));
    if (!escuchan.length) return;
    for (const [marca, flujos] of this.porMarca(escuchan)) {
      const citas = await this.prisma.salesMeeting.findMany({
        // El equipo lleva la marca; la cita no. Sin este filtro el barrido de
        // una marca vería las citas de todas.
        where: {
          team: { whiteLabelId: marca },
          updatedAt: { gte: desde },
          status: { in: ESTADOS_DE_CITA.map((e) => e.value) },
          leadId: { not: null },
        },
        orderBy: { updatedAt: 'asc' },
        take: 500,
        select: {
          id: true,
          status: true,
          startAt: true,
          team: { select: { name: true } },
          lead: { select: { mktContactId: true, assignedUserId: true } },
        },
      });
      if (!citas.length) continue;
      const yaFueron = await this.eventosYaDisparados(
        flujos.map((w) => w.id),
        citas.map((c) => refDeEvento('cita', c.id, c.status)),
      );
      const contactos = await this.contactosDelBarrido(citas.map((c) => c.lead?.mktContactId), marca);
      const vendedores = await this.nombresDeUsuario(citas.map((c) => c.lead?.assignedUserId));
      for (const cita of citas) {
        const ctxContacto = contactos.get(cita.lead?.mktContactId ?? '');
        if (!ctxContacto) continue;
        await this.disparar('sales_meeting_status', {
          contactId: cita.lead!.mktContactId!,
          ctxContacto,
          extra: {
            cita_estado: ESTADOS_DE_CITA.find((e) => e.value === cita.status)?.label ?? cita.status,
            cita_fecha: diaEnBogota(cita.startAt.getTime()),
            cita_hora: horaEnBogota(cita.startAt),
            equipo: cita.team?.name ?? '',
            vendedor: vendedores.get(cita.lead?.assignedUserId ?? '') ?? '',
          },
          ajustes: { estado: cita.status },
          ref: refDeEvento('cita', cita.id, cita.status),
          flujos,
          yaFueron,
        });
      }
    }
  }

  /** «Oportunidad creada», «cambió de etapa» y «ganada o perdida». */
  private async escanearOportunidades(
    desde: Date,
    todos: { id: string; whiteLabelId: string; trigger: unknown; triggers: unknown }[],
  ): Promise<void> {
    const TIPOS = ['sales_opportunity_created', 'sales_opportunity_status'];
    const escuchan = todos.filter((wf) => TIPOS.some((t) => escuchaEl(wf, t)));
    if (!escuchan.length) return;
    for (const [marca, flujos] of this.porMarca(escuchan)) {
      const oportunidades = await this.prisma.salesOpportunity.findMany({
        // Por la RELACIÓN con el equipo, no por la columna copiada: el
        // `whiteLabelId` de la oportunidad se desnormaliza al crearla y en los
        // equipos antiguos viene vacío. Filtrando por ahí, esos disparadores no
        // se disparaban nunca y nadie se enteraba.
        where: { pipeline: { team: { whiteLabelId: marca } }, updatedAt: { gte: desde } },
        orderBy: { updatedAt: 'asc' },
        take: 500,
        select: {
          id: true,
          status: true,
          value: true,
          stageId: true,
          createdAt: true,
          // Las fechas del desenlace: son la señal de que la oportunidad se
          // cerró DE VERDAD en esta vuelta. Mirar solo `updatedAt` hacía que
          // corregir el monto de una cerrada hace semanas mandara «ganada o
          // perdida» como si acabara de pasar.
          wonAt: true,
          lostAt: true,
          salesTeamId: true,
          pipeline: { select: { name: true } },
          stage: { select: { name: true } },
          lead: { select: { mktContactId: true, assignedUserId: true } },
        },
      });
      if (!oportunidades.length) continue;
      const cerroEnEstaVuelta = (o: { status: string; wonAt: Date | null; lostAt: Date | null }) =>
        o.status !== 'abierta' &&
        ((o.wonAt != null && o.wonAt >= desde) || (o.lostAt != null && o.lostAt >= desde));
      const yaFueron = await this.eventosYaDisparados(
        flujos.map((w) => w.id),
        oportunidades.flatMap((o) => [
          refDeEvento('oportunidad', o.id, 'creada'),
          refDeEvento('oportunidad', o.id, 'estado', o.status),
        ]),
      );
      const contactos = await this.contactosDelBarrido(oportunidades.map((o) => o.lead?.mktContactId), marca);
      const vendedores = await this.nombresDeUsuario(oportunidades.map((o) => o.lead?.assignedUserId));
      const equipos = await this.nombresDeEquipo(oportunidades.map((o) => o.salesTeamId), marca);
      for (const o of oportunidades) {
        const ctxContacto = contactos.get(o.lead?.mktContactId ?? '');
        if (!ctxContacto) continue;
        const comun = {
          contactId: o.lead!.mktContactId!,
          ctxContacto,
          extra: {
            embudo: o.pipeline?.name ?? '',
            etapa_oportunidad: o.stage?.name ?? '',
            estado_oportunidad: ESTADOS_DE_OPORTUNIDAD.find((e) => e.value === o.status)?.label ?? o.status,
            valor_oportunidad: String(o.value ?? ''),
            equipo: equipos.get(o.salesTeamId) ?? '',
            vendedor: vendedores.get(o.lead?.assignedUserId ?? '') ?? '',
          },
          ajustes: { embudo: o.pipeline?.name ?? '', etapa: o.stage?.name ?? '' },
          flujos,
          yaFueron,
        };
        if (o.createdAt >= desde) {
          await this.disparar('sales_opportunity_created', {
            ...comun,
            ref: refDeEvento('oportunidad', o.id, 'creada'),
          });
        }
        // «Cambió de etapa» NO existe todavía: sin una fecha del último
        // movimiento, lo único que se ve es que la fila se tocó, y corregir el
        // monto disparaba «pasaste a Contactado» a un cliente. Vuelve cuando el
        // módulo de ventas deje constancia del movimiento.
        if (cerroEnEstaVuelta(o)) {
          await this.disparar('sales_opportunity_status', {
            ...comun,
            ajustes: { embudo: comun.ajustes.embudo, estado: o.status },
            ref: refDeEvento('oportunidad', o.id, 'estado', o.status),
          });
        }
      }
    }
  }

  /** Cómo se llama cada equipo de la marca, en una sola consulta. */
  private async nombresDeEquipo(ids: string[], whiteLabelId: string): Promise<Map<string, string>> {
    const mapa = new Map<string, string>();
    const unicos = [...new Set(ids.filter(Boolean))];
    if (!unicos.length) return mapa;
    const equipos = await this.prisma.salesTeam.findMany({
      where: { id: { in: unicos }, whiteLabelId },
      select: { id: true, name: true },
    });
    for (const t of equipos) mapa.set(t.id, t.name);
    return mapa;
  }

  // Motor durable: cada 5 min procesa inscripciones vencidas + reintentos.
  @Cron(CronExpression.EVERY_5_MINUTES)
  async tick(): Promise<void> {
    try {
      const due = await this.prisma.mktEnrollment.findMany({
        where: { status: { in: ['active', 'waiting'] }, resumeAt: { lte: new Date() } },
        orderBy: { resumeAt: 'asc' },
        take: 200,
      });
      for (const e of due) {
        // Claim atómico (evita doble proceso entre pods): empuja resumeAt 5 min.
        const claim = await this.prisma.mktEnrollment.updateMany({
          where: { id: e.id, status: { in: ['active', 'waiting'] }, resumeAt: { lte: new Date() } },
          data: { resumeAt: new Date(Date.now() + 5 * 60000) },
        });
        if (claim.count === 0) continue;
        try {
          await this.advance(e);
        } catch {
          await this.prisma.mktEnrollment.update({ where: { id: e.id }, data: { status: 'error' } }).catch(() => {});
        }
      }
    } catch (e) {
      this.log.warn(`mkt tick falló: ${(e as Error).message}`);
    }
    // Carril de reintentos (aparte, no bloquea la independencia de canales).
    try {
      const resolved = await this.actions.retryDue(100);
      if (resolved) this.log.log(`reintentos resueltos: ${resolved}`);
    } catch (e) {
      this.log.warn(`retryDue falló: ${(e as Error).message}`);
    }
  }
}
