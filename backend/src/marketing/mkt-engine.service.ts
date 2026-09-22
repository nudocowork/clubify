import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../common/prisma/prisma.service';
import { MktActionService } from './mkt-action.service';
import {
  casoQueCasa,
  resolveMerge,
  evalWF,
  sinAcentos,
  MKT_CAMPOS_EDITABLES,
  MKT_MAX_SALTOS,
  WFCaso,
  WFGraph,
  WFNode,
  WFTrigger,
  WFDrip,
  WFSendWindow,
  WFCondition,
} from './mkt-workflow.util';
// El guardián de la red interna vive en el motor de MARCA y se importa, no se
// copia: dos copias de una comprobación de seguridad se separan a la primera
// corrección y una de las dos se queda vieja. Es un archivo de helpers puros,
// sin Nest, así que importarlo no crea ninguna dependencia entre módulos.
import { destinoInterno } from '../superadmin/brand-workflows/brand-workflow.util';

type NodeResult =
  | { kind: 'continue'; next: string | null }
  | { kind: 'wait'; resumeAt: Date; waitKind: string; resumeNodeId: string | null }
  | { kind: 'waitReply'; nodeId: string; resumeAt: Date }
  | { kind: 'complete' }
  | { kind: 'removed' };

// Timeout por defecto de "esperar respuesta" (si nadie interactúa) — 3 días.
const WAIT_REPLY_TIMEOUT_MS = 3 * 86400000;

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
    return {
      nombre: c?.name ?? '',
      email: c?.email ?? '',
      telefono: c?.phone ?? '',
      empresa: c?.company ?? '',
      tags: (c?.tags ?? []).join(', '),
      marca,
    };
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
        await this.actions.dispatch({
          workflowId: wf.id,
          enrollmentId: enr.id,
          contactId: enr.contactId,
          whiteLabelId: wf.whiteLabelId,
          nodeId: node.id,
          channel: 'email',
          to: c?.email ?? '',
          subject: resolveMerge(String(cfg.subject || ''), ctx),
          body: resolveMerge(String(cfg.body || ''), ctx),
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
        return {
          kind: 'waitReply',
          nodeId: node.id,
          resumeAt: new Date(Date.now() + WAIT_REPLY_TIMEOUT_MS),
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
  private async publishedByTrigger(type: string, whiteLabelId: string) {
    const all = await this.prisma.mktWorkflow.findMany({
      where: { whiteLabelId, status: 'published', rootId: { not: null } },
    });
    return all.filter((wf) => ((wf.trigger as WFTrigger) || {}).type === type);
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
      for (const wf of wfs) {
        const trig = (wf.trigger as WFTrigger) || {};
        // La etiqueta del disparador NO es un filtro: es parte de la identidad
        // del disparador. Un flujo configurado para «cliente-vip» no puede
        // arrancar porque se haya puesto cualquier otra etiqueta. Vacía = todas.
        if (type === 'tag_added' || type === 'tag_removed') {
          const pedida = sinAcentos(String(trig.tag ?? '')).trim();
          if (pedida && pedida !== sinAcentos(String(extra?.etiqueta ?? '')).trim()) continue;
        }
        if (!evalWF(trig.filters, ctx, 'all')) continue;
        await this.enroll(wf.id, contactId, {
          ...(extra ?? {}),
          ...(saltos ? { saltos } : {}),
        });
      }
    } catch (e) {
      this.log.warn(`fireTrigger(${type}) falló: ${(e as Error).message}`);
    }
  }

  // Escaneo horario: contactos nuevos (catch-up del trigger contact_created).
  @Cron(CronExpression.EVERY_HOUR)
  async scanTriggers(): Promise<void> {
    try {
      const wfs = await this.prisma.mktWorkflow.findMany({
        where: { status: 'published', rootId: { not: null } },
      });
      const created = wfs.filter((wf) => ((wf.trigger as WFTrigger) || {}).type === 'contact_created');
      const floor = new Date(Date.now() - 7 * 86400000);
      for (const wf of created) {
        const since = wf.createdAt > floor ? wf.createdAt : floor;
        const contacts = await this.prisma.mktContact.findMany({
          where: { whiteLabelId: wf.whiteLabelId, deleted: false, createdAt: { gte: since } },
          select: { id: true },
          take: 500,
        });
        for (const c of contacts) await this.enroll(wf.id, c.id);
      }
    } catch (e) {
      this.log.warn(`scanTriggers falló: ${(e as Error).message}`);
    }
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
