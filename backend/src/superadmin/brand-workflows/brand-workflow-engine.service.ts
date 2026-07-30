import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../common/prisma/prisma.service';
import { GrowBusinessService } from '../../integrations/grow-business.service';
import { brandGrowCreds, BRAND_GROW_SELECT } from '../../integrations/brand-sms-creds.util';
import {
  resolveMerge,
  evalWF,
  WFGraph,
  WFNode,
  WFTrigger,
  WFDrip,
  WFSendWindow,
  WFCondition,
} from './brand-workflow.util';

type NodeResult =
  | { kind: 'continue'; next: string | null }
  | { kind: 'wait'; resumeAt: Date; waitKind: string; resumeNodeId: string | null }
  | { kind: 'complete' }
  | { kind: 'removed' };

@Injectable()
export class BrandWorkflowEngineService {
  private readonly log = new Logger(BrandWorkflowEngineService.name);

  constructor(
    private prisma: PrismaService,
    private grow: GrowBusinessService,
  ) {}

  // Teléfono del dueño: owner(TENANT_OWNER).phone → whatsappPhone → phone.
  private async ownerPhone(tenantId: string): Promise<string | null> {
    const owner = await this.prisma.user.findFirst({
      where: { tenantId, role: 'TENANT_OWNER', isActive: true },
      select: { phone: true, fullName: true },
      orderBy: { createdAt: 'asc' },
    });
    if (owner?.phone) return owner.phone;
    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { whatsappPhone: true, phone: true },
    });
    return t?.whatsappPhone ?? t?.phone ?? null;
  }

  private async ctxFor(tenantId: string): Promise<Record<string, string>> {
    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true, status: true, whiteLabel: { select: { name: true } } },
    });
    const owner = await this.prisma.user.findFirst({
      where: { tenantId, role: 'TENANT_OWNER', isActive: true },
      select: { fullName: true },
      orderBy: { createdAt: 'asc' },
    });
    const statusEs: Record<string, string> = { ACTIVE: 'activo', SUSPENDED: 'suspendido', TRIAL: 'prueba' };
    return {
      negocio: t?.name ?? '',
      owner: owner?.fullName ?? '',
      platform: t?.whiteLabel?.name ?? 'Clubify',
      plan: '',
      status: statusEs[String(t?.status ?? '')] ?? String(t?.status ?? '').toLowerCase(),
    };
  }

  private async log_(entry: {
    workflowId: string;
    whiteLabelId: string;
    tenantId?: string | null;
    nodeId?: string | null;
    nodeType: string;
    message?: string;
    status: string;
    result?: string | null;
  }) {
    try {
      await this.prisma.brandWorkflowLog.create({ data: { message: '', ...entry } });
    } catch {
      /* nunca romper por el log */
    }
  }

  // ── Ventana de envío (tz de la marca; default Bogota UTC-5) ──
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
    const sends = await this.prisma.brandWorkflowLog.findMany({
      where: { workflowId: wf.id, nodeType: 'send_sms', status: 'sent', createdAt: { gte: since } },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    });
    if (sends.length < batch) return null;
    return new Date(sends[0].createdAt.getTime() + interval * 60000);
  }

  private async runNode(
    wf: { id: string; whiteLabelId: string; drip: unknown; sendWindow: unknown },
    node: WFNode,
    enr: { id: string; tenantId: string; context: unknown },
  ): Promise<NodeResult> {
    const ctx = { ...(await this.ctxFor(enr.tenantId)), ...((enr.context as Record<string, string>) || {}) };
    const cfg = node.config || {};
    const base = { workflowId: wf.id, whiteLabelId: wf.whiteLabelId, tenantId: enr.tenantId, nodeId: node.id, nodeType: node.type };

    switch (node.type) {
      case 'send_sms': {
        const message = resolveMerge(String(cfg.message || ''), ctx);
        const winAt = this.nextSendTime(wf.sendWindow as WFSendWindow, Date.now());
        if (winAt) return { kind: 'wait', resumeAt: winAt, waitKind: 'window', resumeNodeId: node.id };
        const dripAt = await this.dripDefer(wf);
        if (dripAt) return { kind: 'wait', resumeAt: dripAt, waitKind: 'drip', resumeNodeId: node.id };
        // Subcuenta de la marca + teléfono del dueño.
        const tenant = await this.prisma.tenant.findUnique({
          where: { id: enr.tenantId },
          select: { whiteLabel: { select: BRAND_GROW_SELECT } },
        });
        const creds = brandGrowCreds(tenant?.whiteLabel);
        if (!creds) {
          await this.log_({ ...base, message, status: 'skipped', result: 'La marca no tiene subcuenta de SMS' });
          return { kind: 'continue', next: node.next ?? null };
        }
        const phone = await this.ownerPhone(enr.tenantId);
        if (!phone) {
          await this.log_({ ...base, message, status: 'skipped', result: 'Negocio sin teléfono' });
          return { kind: 'continue', next: node.next ?? null };
        }
        const res = await this.grow.sendSmsWithCreds(creds, phone, message);
        await this.log_({ ...base, message, status: res.ok ? 'sent' : 'failed', result: res.ok ? null : res.message ?? 'error' });
        return { kind: 'continue', next: node.next ?? null };
      }
      case 'wait_delay': {
        const amount = Number(cfg.amount) || 1;
        const unitMs: Record<string, number> = { minutes: 60000, hours: 3600000, days: 86400000, weeks: 604800000 };
        const ms = amount * (unitMs[String(cfg.unit || 'days')] ?? 86400000);
        await this.log_({ ...base, status: 'info', result: `Espera ${amount} ${cfg.unit || 'días'}` });
        return { kind: 'wait', resumeAt: new Date(Date.now() + ms), waitKind: 'delay', resumeNodeId: node.next ?? null };
      }
      case 'if_else': {
        const conds = (cfg.conditions as WFCondition[]) || [];
        const match = (cfg.match as 'all' | 'any') || 'all';
        const ok = evalWF(conds, ctx, match);
        await this.log_({ ...base, status: 'info', result: `Condición → ${ok ? 'Sí' : 'No'}` });
        return { kind: 'continue', next: (ok ? node.yes : node.no) ?? null };
      }
      case 'end':
        return { kind: 'removed' };
      default:
        return { kind: 'continue', next: node.next ?? null };
    }
  }

  private async complete(enrId: string, status: 'completed' | 'removed') {
    await this.prisma.brandWorkflowEnrollment
      .update({ where: { id: enrId }, data: { status, completedAt: new Date(), resumeAt: null } })
      .catch(() => {});
  }

  private async advance(enr: {
    id: string;
    workflowId: string;
    tenantId: string;
    currentNodeId: string | null;
    context: unknown;
  }) {
    const wf = await this.prisma.brandWorkflow.findUnique({ where: { id: enr.workflowId } });
    if (!wf || wf.status !== 'published') {
      await this.complete(enr.id, 'removed');
      return;
    }
    const graph = (wf.nodes as WFGraph) || {};
    let nodeId = enr.currentNodeId;
    let guard = 0;
    while (nodeId && guard++ < 60) {
      const node = graph[nodeId];
      if (!node) break;
      const res = await this.runNode(wf, node, enr);
      if (res.kind === 'wait') {
        await this.prisma.brandWorkflowEnrollment.update({
          where: { id: enr.id },
          data: { status: 'waiting', currentNodeId: res.resumeNodeId, resumeAt: res.resumeAt, waitKind: res.waitKind },
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
  async enroll(workflowId: string, tenantId: string): Promise<void> {
    try {
      const wf = await this.prisma.brandWorkflow.findUnique({ where: { id: workflowId } });
      if (!wf || wf.status !== 'published' || !wf.rootId) return;
      if (!wf.reentry) {
        const existing = await this.prisma.brandWorkflowEnrollment.findFirst({
          where: { workflowId, tenantId },
          select: { id: true },
        });
        if (existing) return;
      } else {
        const active = await this.prisma.brandWorkflowEnrollment.findFirst({
          where: { workflowId, tenantId, status: { in: ['active', 'waiting'] } },
          select: { id: true },
        });
        if (active) return;
      }
      const enr = await this.prisma.brandWorkflowEnrollment.create({
        data: { workflowId, tenantId, status: 'active', currentNodeId: wf.rootId, resumeAt: new Date() },
      });
      await this.advance(enr);
    } catch (e) {
      this.log.warn(`brand-workflow enroll falló: ${(e as Error).message}`);
    }
  }

  // ── Disparadores automáticos (Fase 3) ──
  private _clubifyWlId: string | null | undefined;
  private async clubifyWlId(): Promise<string | null> {
    if (this._clubifyWlId !== undefined) return this._clubifyWlId;
    const wl = await this.prisma.whiteLabel.findFirst({ where: { slug: 'clubify' }, select: { id: true } });
    this._clubifyWlId = wl?.id ?? null;
    return this._clubifyWlId;
  }

  // Los negocios de "Clubify" incluyen los legacy con whiteLabelId null.
  private async brandTenantWhere(whiteLabelId: string): Promise<Record<string, unknown>> {
    const clubify = await this.clubifyWlId();
    return whiteLabelId === clubify ? { OR: [{ whiteLabelId }, { whiteLabelId: null }] } : { whiteLabelId };
  }

  // Workflows publicados de una marca cuyo disparador coincide.
  private async publishedByTrigger(type: string) {
    const all = await this.prisma.brandWorkflow.findMany({
      where: { status: 'published', rootId: { not: null } },
    });
    return all.filter((wf) => ((wf.trigger as WFTrigger) || {}).type === type);
  }

  // Disparo en tiempo real (p. ej. al crear un negocio). Idempotente.
  async fireTrigger(type: string, tenantId: string): Promise<void> {
    try {
      const t = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { whiteLabelId: true } });
      if (!t) return;
      const clubify = await this.clubifyWlId();
      const brand = t.whiteLabelId ?? clubify;
      if (!brand) return;
      const wfs = (await this.publishedByTrigger(type)).filter((wf) => wf.whiteLabelId === brand);
      if (!wfs.length) return;
      const ctx = await this.ctxFor(tenantId);
      for (const wf of wfs) {
        const filters = ((wf.trigger as WFTrigger) || {}).filters;
        if (!evalWF(filters, ctx, 'all')) continue;
        await this.enroll(wf.id, tenantId);
      }
    } catch (e) {
      this.log.warn(`fireTrigger(${type}) falló: ${(e as Error).message}`);
    }
  }

  // Escaneo horario: negocios nuevos + suscripciones por vencer + inactivos.
  @Cron(CronExpression.EVERY_HOUR)
  async scanTriggers(): Promise<void> {
    try {
      await this.scanBusinessCreated();
      await this.scanSubscriptionExpiring();
      await this.scanBusinessInactive();
    } catch (e) {
      this.log.warn(`scanTriggers falló: ${(e as Error).message}`);
    }
  }

  private async scanBusinessCreated(): Promise<void> {
    const wfs = await this.publishedByTrigger('business_created');
    const floor = new Date(Date.now() - 7 * 86400000); // ventana de seguridad de 7 días
    for (const wf of wfs) {
      const since = wf.createdAt > floor ? wf.createdAt : floor;
      const where = await this.brandTenantWhere(wf.whiteLabelId);
      const tenants = await this.prisma.tenant.findMany({
        where: { ...where, createdAt: { gte: since } },
        select: { id: true },
        take: 500,
      });
      for (const t of tenants) await this.fireEnroll(wf, t.id);
    }
  }

  private async scanSubscriptionExpiring(): Promise<void> {
    const wfs = await this.publishedByTrigger('subscription_expiring');
    const now = new Date();
    for (const wf of wfs) {
      const days = Number(((wf.trigger as WFTrigger) || {}).daysBefore) || 3;
      const horizon = new Date(now.getTime() + days * 86400000);
      const where = await this.brandTenantWhere(wf.whiteLabelId);
      const tenants = await this.prisma.tenant.findMany({
        where: { ...where, status: 'ACTIVE', currentPeriodEnd: { gte: now, lte: horizon } },
        select: { id: true },
        take: 500,
      });
      for (const t of tenants) await this.fireEnroll(wf, t.id);
    }
  }

  private async scanBusinessInactive(): Promise<void> {
    const wfs = await this.publishedByTrigger('business_inactive');
    const now = Date.now();
    for (const wf of wfs) {
      const days = Number(((wf.trigger as WFTrigger) || {}).daysInactive) || 30;
      const cutoff = new Date(now - days * 86400000);
      const where = await this.brandTenantWhere(wf.whiteLabelId);
      // Candidatos: ACTIVE que existan desde hace al menos `days`.
      const candidates = await this.prisma.tenant.findMany({
        where: { ...where, status: 'ACTIVE', createdAt: { lte: cutoff } },
        select: { id: true },
        take: 1000,
      });
      if (!candidates.length) continue;
      const ids = candidates.map((c) => c.id);
      // Negocios con pedidos recientes → NO están inactivos.
      const active = await this.prisma.order.groupBy({
        by: ['tenantId'],
        where: { tenantId: { in: ids }, createdAt: { gte: cutoff } },
      });
      const activeSet = new Set(active.map((a) => a.tenantId));
      for (const id of ids) {
        if (activeSet.has(id)) continue;
        await this.fireEnroll(wf, id);
      }
    }
  }

  // Evalúa filtros del disparador contra el negocio y, si pasan, inscribe.
  private async fireEnroll(wf: { id: string; trigger: unknown }, tenantId: string): Promise<void> {
    const filters = ((wf.trigger as WFTrigger) || {}).filters;
    if (filters && filters.length) {
      const ctx = await this.ctxFor(tenantId);
      if (!evalWF(filters, ctx, 'all')) return;
    }
    await this.enroll(wf.id, tenantId);
  }

  // Motor durable: cada 5 min procesa las inscripciones que ya tocan.
  @Cron(CronExpression.EVERY_5_MINUTES)
  async tick(): Promise<void> {
    try {
      const due = await this.prisma.brandWorkflowEnrollment.findMany({
        where: { status: { in: ['active', 'waiting'] }, resumeAt: { lte: new Date() } },
        orderBy: { resumeAt: 'asc' },
        take: 200,
      });
      for (const e of due) {
        // Claim atómico (evita doble proceso entre pods): empuja resumeAt 5 min.
        const claim = await this.prisma.brandWorkflowEnrollment.updateMany({
          where: { id: e.id, status: { in: ['active', 'waiting'] }, resumeAt: { lte: new Date() } },
          data: { resumeAt: new Date(Date.now() + 5 * 60000) },
        });
        if (claim.count === 0) continue;
        try {
          await this.advance(e);
        } catch {
          await this.prisma.brandWorkflowEnrollment.update({ where: { id: e.id }, data: { status: 'error' } }).catch(() => {});
        }
      }
    } catch (e) {
      this.log.warn(`brand-workflow tick falló: ${(e as Error).message}`);
    }
  }
}
