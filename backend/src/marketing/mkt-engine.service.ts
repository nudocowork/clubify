import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../common/prisma/prisma.service';
import { MktActionService } from './mkt-action.service';
import {
  resolveMerge,
  evalWF,
  WFGraph,
  WFNode,
  WFTrigger,
  WFDrip,
  WFSendWindow,
  WFCondition,
} from './mkt-workflow.util';

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
        const at = cfg.at ? new Date(String(cfg.at)) : null;
        if (at && at.getTime() > Date.now()) {
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
      case 'add_tag': {
        const tag = String(cfg.tag || '').trim();
        if (tag) {
          const c = await this.prisma.mktContact.findUnique({
            where: { id: enr.contactId },
            select: { tags: true },
          });
          const tags = new Set([...(c?.tags ?? []), tag]);
          await this.prisma.mktContact.update({
            where: { id: enr.contactId },
            data: { tags: { set: [...tags] } },
          });
        }
        return { kind: 'continue', next: node.next ?? null };
      }
      case 'webhook': {
        const url = String(cfg.url || '').trim();
        if (url) {
          try {
            await fetch(url, {
              method: 'POST',
              signal: AbortSignal.timeout(8000),
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ contactId: enr.contactId, ...ctx }),
            });
          } catch {
            /* el webhook es best-effort; no frena la cadena */
          }
        }
        return { kind: 'continue', next: node.next ?? null };
      }
      case 'end':
        return { kind: 'removed' };
      default:
        return { kind: 'continue', next: node.next ?? null };
    }
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
  async enroll(workflowId: string, contactId: string): Promise<void> {
    try {
      const wf = await this.prisma.mktWorkflow.findUnique({ where: { id: workflowId } });
      if (!wf || wf.status !== 'published' || !wf.rootId) return;
      const contact = await this.prisma.mktContact.findUnique({
        where: { id: contactId },
        select: { deleted: true, optOut: true },
      });
      if (!contact || contact.deleted || contact.optOut) return;
      if (!wf.reentry) {
        const existing = await this.prisma.mktEnrollment.findFirst({
          where: { workflowId, contactId },
          select: { id: true },
        });
        if (existing) return;
      } else {
        const active = await this.prisma.mktEnrollment.findFirst({
          where: { workflowId, contactId, status: { in: ['active', 'waiting'] } },
          select: { id: true },
        });
        if (active) return;
      }
      const enr = await this.prisma.mktEnrollment.create({
        data: {
          workflowId,
          contactId,
          whiteLabelId: wf.whiteLabelId,
          status: 'active',
          currentNodeId: wf.rootId,
          resumeAt: new Date(),
        },
      });
      await this.advance(enr);
    } catch (e) {
      this.log.warn(`mkt enroll falló: ${(e as Error).message}`);
    }
  }

  /**
   * Una INTERACCIÓN del contacto (reply/open/click) reanuda sus nodos wait_reply
   * (rama 'yes'/next) y dispara el trigger email_reply. Lo llama el webhook (Fase 5).
   */
  async onContactInteraction(contactId: string, whiteLabelId: string): Promise<void> {
    try {
      const waiting = await this.prisma.mktEnrollment.findMany({
        where: { contactId, status: 'waiting', waitKind: 'reply' },
      });
      for (const enr of waiting) {
        const wf = await this.prisma.mktWorkflow.findUnique({ where: { id: enr.workflowId } });
        const graph = ((wf?.nodes as WFGraph) || {}) as WFGraph;
        const node = enr.waitingNodeId ? graph[enr.waitingNodeId] : null;
        const nextId = (node?.yes ?? node?.next) ?? null;
        await this.prisma.mktEnrollment.update({
          where: { id: enr.id },
          data: {
            status: 'active',
            currentNodeId: nextId,
            resumeAt: new Date(),
            waitKind: null,
            waitingNodeId: null,
            waitingSince: null,
          },
        });
        await this.advance({ ...enr, currentNodeId: nextId, waitingNodeId: null });
      }
      await this.fireTrigger('email_reply', contactId, whiteLabelId);
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

  /** Disparo en tiempo real (contact_created, tag_added, email_reply). Idempotente. */
  async fireTrigger(type: string, contactId: string, whiteLabelId: string): Promise<void> {
    try {
      const wfs = await this.publishedByTrigger(type, whiteLabelId);
      if (!wfs.length) return;
      const ctx = await this.ctxFor(contactId);
      for (const wf of wfs) {
        const filters = ((wf.trigger as WFTrigger) || {}).filters;
        if (!evalWF(filters, ctx, 'all')) continue;
        await this.enroll(wf.id, contactId);
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
