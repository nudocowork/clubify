import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../common/prisma/prisma.service';
import { GrowBusinessService } from '../../integrations/grow-business.service';
import { brandGrowCreds, BRAND_GROW_SELECT } from '../../integrations/brand-sms-creds.util';
import {
  destinoInterno,
  evalWF,
  resolveMerge,
  WFCondition,
  WFDrip,
  WFGraph,
  WFNode,
  WFSendWindow,
  WFTrigger,
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

  // Email del dueño (para el nodo de correo): owner(TENANT_OWNER).email.
  private async ownerEmail(tenantId: string): Promise<string | null> {
    const owner = await this.prisma.user.findFirst({
      where: { tenantId, role: 'TENANT_OWNER', isActive: true },
      select: { email: true },
      orderBy: { createdAt: 'asc' },
    });
    return owner?.email ?? null;
  }

  /**
   * Los datos del negocio que se usan en las condiciones y en los {{merge}}.
   *
   * `plan` venía FIJO EN BLANCO: la pantalla ofrecía la condición «plan es X»,
   * que no casaba nunca, y {{plan}} salía vacío en el mensaje. Ahora sale del
   * plan de verdad (2026-09-21).
   */
  private async ctxFor(tenantId: string): Promise<Record<string, string>> {
    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        name: true,
        status: true,
        planPeriodicity: true,
        currentPeriodEnd: true,
        trialEndsAt: true,
        businessCategorySlug: true,
        plan: { select: { name: true } },
        whiteLabel: { select: { name: true } },
      },
    });
    const owner = await this.prisma.user.findFirst({
      where: { tenantId, role: 'TENANT_OWNER', isActive: true },
      select: { fullName: true },
      orderBy: { createdAt: 'asc' },
    });
    // Se cuenta una vez por paso, no por condición: es una consulta barata y
    // permite «llegó a N pedidos» sin pedirle al usuario que la entienda.
    const pedidos = await this.prisma.order.count({ where: { tenantId } }).catch(() => 0);
    const statusEs: Record<string, string> = { ACTIVE: 'activo', SUSPENDED: 'suspendido', TRIAL: 'prueba' };
    const fecha = (d: Date | null | undefined) =>
      d ? new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Bogota' }).format(d) : '';
    return {
      negocio: t?.name ?? '',
      owner: owner?.fullName ?? '',
      platform: t?.whiteLabel?.name ?? 'Clubify',
      plan: t?.plan?.name ?? '',
      periodicidad: t?.planPeriodicity ?? '',
      vence: fecha(t?.currentPeriodEnd),
      prueba_termina: fecha(t?.trialEndsAt),
      categoria: t?.businessCategorySlug ?? '',
      pedidos: String(pedidos),
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
      // Los DOS canales: contando solo el SMS, un flujo de puro correo no
      // goteaba nunca por mucho que el usuario activara el goteo.
      where: {
        workflowId: wf.id,
        nodeType: { in: ['send_sms', 'send_email', 'notify_brand'] },
        status: 'sent',
        createdAt: { gte: since },
      },
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
        // Con `ctx`: si no, el envío queda en el registro SIN marca ni negocio,
        // y un `whiteLabelId` nulo se lee como Clubify (la fuga de siempre).
        const res = await this.grow.sendSmsWithCreds(creds, phone, message, {
          tenantId: enr.tenantId,
          whiteLabelId: wf.whiteLabelId,
          feature: 'flujo-de-marca',
        });
        await this.log_({ ...base, message, status: res.ok ? 'sent' : 'failed', result: res.ok ? null : res.message ?? 'error' });
        return { kind: 'continue', next: node.next ?? null };
      }
      case 'send_email': {
        const subject = resolveMerge(String(cfg.subject || ''), ctx);
        const bodyText = resolveMerge(String(cfg.body || ''), ctx);
        const html = /<[a-z][\s\S]*>/i.test(bodyText) ? bodyText : bodyText.replace(/\n/g, '<br>');
        const winAt = this.nextSendTime(wf.sendWindow as WFSendWindow, Date.now());
        if (winAt) return { kind: 'wait', resumeAt: winAt, waitKind: 'window', resumeNodeId: node.id };
        const dripAt = await this.dripDefer(wf);
        if (dripAt) return { kind: 'wait', resumeAt: dripAt, waitKind: 'drip', resumeNodeId: node.id };
        // Subcuenta de la marca (mismas creds que el SMS) + email del dueño.
        const tenant = await this.prisma.tenant.findUnique({
          where: { id: enr.tenantId },
          select: { whiteLabel: { select: BRAND_GROW_SELECT } },
        });
        const creds = brandGrowCreds(tenant?.whiteLabel);
        if (!creds) {
          await this.log_({ ...base, message: subject, status: 'skipped', result: 'La marca no tiene subcuenta de correo' });
          return { kind: 'continue', next: node.next ?? null };
        }
        const email = await this.ownerEmail(enr.tenantId);
        if (!email) {
          await this.log_({ ...base, message: subject, status: 'skipped', result: 'Negocio sin email' });
          return { kind: 'continue', next: node.next ?? null };
        }
        const res = await this.grow.sendEmailWithCreds(creds, email, subject, html, {
          ctx: { tenantId: enr.tenantId, whiteLabelId: wf.whiteLabelId, feature: 'flujo-de-marca' },
        });
        await this.log_({ ...base, message: subject, status: res.ok ? 'sent' : 'failed', result: res.ok ? null : res.message ?? 'error' });
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
      case 'notify_brand': {
        // Al EQUIPO de la marca, no al negocio: «a Mauricio le falló el pago».
        // Sale por la misma subcuenta, así que no hace falta nada nuevo.
        const message = resolveMerge(String(cfg.message || ''), ctx);
        const destino = String(cfg.to || '').trim();
        const canal = String(cfg.canal || 'sms');
        if (!destino) {
          await this.log_({ ...base, message, status: 'skipped', result: 'Sin destinatario del equipo' });
          return { kind: 'continue', next: node.next ?? null };
        }
        const tenant = await this.prisma.tenant.findUnique({
          where: { id: enr.tenantId },
          select: { whiteLabel: { select: BRAND_GROW_SELECT } },
        });
        const creds = brandGrowCreds(tenant?.whiteLabel);
        if (!creds) {
          await this.log_({ ...base, message, status: 'skipped', result: 'La marca no tiene subcuenta' });
          return { kind: 'continue', next: node.next ?? null };
        }
        const res =
          canal === 'email'
            ? await this.grow.sendEmailWithCreds(creds, destino, `Aviso de ${ctx.platform}`, message.replace(/\n/g, '<br>'), {
                ctx: { tenantId: enr.tenantId, whiteLabelId: wf.whiteLabelId, feature: 'flujo-de-marca' },
              })
            : await this.grow.sendSmsWithCreds(creds, destino, message, {
                tenantId: enr.tenantId,
                whiteLabelId: wf.whiteLabelId,
                feature: 'flujo-de-marca',
              });
        await this.log_({ ...base, message, status: res.ok ? 'sent' : 'failed', result: res.ok ? null : res.message ?? 'error' });
        return { kind: 'continue', next: node.next ?? null };
      }
      case 'wait_datetime': {
        // Fecha fija, hora de Bogotá. Si ya pasó, no se queda colgado: sigue.
        const raw = String(cfg.datetime || '').trim();
        const at = raw ? new Date(/[zZ]|[+-]\d{2}:\d{2}$/.test(raw) ? raw : `${raw}:00-05:00`) : null;
        if (!at || Number.isNaN(at.getTime()) || at.getTime() <= Date.now()) {
          await this.log_({ ...base, status: 'info', result: at ? 'La fecha ya pasó: sigue de largo' : 'Sin fecha' });
          return { kind: 'continue', next: node.next ?? null };
        }
        await this.log_({ ...base, status: 'info', result: `Espera hasta ${at.toISOString()}` });
        return { kind: 'wait', resumeAt: at, waitKind: 'datetime', resumeNodeId: node.next ?? null };
      }
      case 'split': {
        // Reparto ponderado al azar. Sirve para probar dos mensajes.
        const rutas = (cfg.routes as { id: string; label?: string; percent?: number }[]) || [];
        const validas = rutas.filter((r) => r && r.id);
        if (!validas.length) return { kind: 'continue', next: node.next ?? null };
        const total = validas.reduce((s, r) => s + (Number(r.percent) || 0), 0) || validas.length;
        let tiro = Math.random() * total;
        let elegida = validas[validas.length - 1];
        for (const r of validas) {
          tiro -= Number(r.percent) || total / validas.length;
          if (tiro <= 0) {
            elegida = r;
            break;
          }
        }
        await this.log_({ ...base, status: 'info', result: `Ruta ${elegida.label || elegida.id}` });
        return { kind: 'continue', next: (node.branches || {})[elegida.id] ?? null };
      }
      case 'webhook': {
        // Avisar a otro sistema. Nunca rompe el flujo: si falla, se anota y sigue.
        const url = String(cfg.url || '').trim();
        if (!/^https?:\/\//i.test(url) || destinoInterno(url)) {
          await this.log_({
            ...base,
            status: 'skipped',
            result: destinoInterno(url) ? 'La URL apunta a la red interna' : 'URL inválida',
          });
          return { kind: 'continue', next: node.next ?? null };
        }
        const method = String(cfg.method || 'POST').toUpperCase();
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        for (const h of (cfg.headers as { key: string; value: string }[]) || []) {
          if (h?.key) headers[h.key] = resolveMerge(String(h.value ?? ''), ctx);
        }
        const cuerpo = String(cfg.body || '').trim()
          ? resolveMerge(String(cfg.body), ctx)
          : JSON.stringify({ tenantId: enr.tenantId, ...ctx });
        try {
          const ctrl = new AbortController();
          const corte = setTimeout(() => ctrl.abort(), 12000);
          const r = await fetch(url, {
            method,
            headers,
            body: method === 'GET' ? undefined : cuerpo,
            signal: ctrl.signal,
            // Sin seguir redirecciones: si no, una URL pública puede reenviar a
            // la red interna y saltarse la comprobación de arriba.
            redirect: 'manual',
          });
          clearTimeout(corte);
          await this.log_({ ...base, message: url, status: r.ok ? 'sent' : 'failed', result: `HTTP ${r.status}` });
        } catch (e) {
          await this.log_({ ...base, message: url, status: 'failed', result: (e as Error).message });
        }
        return { kind: 'continue', next: node.next ?? null };
      }
      case 'goto_workflow': {
        // Lo mete en otro flujo y lo saca de este. El destino tiene que ser de
        // la MISMA marca: si no, un flujo movería negocios de otra.
        const destino = String(cfg.workflowId || '').trim();
        const otro = destino
          ? await this.prisma.brandWorkflow.findFirst({
              where: { id: destino, whiteLabelId: wf.whiteLabelId, status: 'published' },
              select: { id: true, name: true },
            })
          : null;
        if (!otro) {
          await this.log_({ ...base, status: 'skipped', result: 'El flujo destino no existe o no está publicado' });
          return { kind: 'continue', next: node.next ?? null };
        }
        // Tope de saltos: dos flujos que se apunten el uno al otro, ambos con
        // re-entrada, se pasarían el negocio para siempre —y cada vuelta manda
        // los mensajes de en medio—. El tope de 60 nodos no cubre esto porque
        // solo acota UNA pasada.
        const saltos = Number((ctx as Record<string, unknown>).saltos ?? 0) + 1;
        if (saltos > 10) {
          await this.log_({ ...base, status: 'skipped', result: `Demasiados saltos entre flujos (${saltos}): se detiene aquí` });
          return { kind: 'removed' };
        }
        await this.enroll(otro.id, enr.tenantId, { ...(enr.context as Record<string, unknown>), saltos });
        await this.log_({ ...base, status: 'info', result: `Pasa a «${otro.name}»` });
        return { kind: 'removed' };
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
  async enroll(workflowId: string, tenantId: string, context?: Record<string, unknown>): Promise<void> {
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
      // Nace ya RECLAMADA (resumeAt a 5 min): el `advance` de aquí abajo la
      // pisa en cuanto espera o termina. Sin esto, si el primer envío tarda,
      // el tick de los 5 minutos agarra la misma fila y repite el primer paso.
      const enr = await this.prisma.brandWorkflowEnrollment.create({
        data: {
          workflowId,
          tenantId,
          status: 'active',
          currentNodeId: wf.rootId,
          resumeAt: new Date(Date.now() + 5 * 60000),
          ...(context ? { context: context as Prisma.InputJsonValue } : {}),
        },
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
      await this.scanTrialEnding();
      await this.scanPedidos();
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

  /**
   * Cobros y suspensiones, cada 5 minutos.
   *
   * NO se engancha en el código de cobro a propósito: ese camino mueve dinero y
   * no se toca para esto. Se leen los avisos de la pasarela que ya quedan
   * guardados (`HotmartWebhookEvent`) y la fecha de suspensión del negocio, en
   * una ventana de 6 minutos —una más que el propio cron, para no perder nada
   * si una pasada se retrasa—. El solape solo puede repetir la inscripción en
   * flujos con re-entrada activada; sin ella, `enroll` la frena.
   */
  private static readonly EVENTOS_DE_COBRO: Record<string, string> = {
    PURCHASE_APPROVED: 'payment_approved',
    PURCHASE_COMPLETE: 'payment_approved',
    PURCHASE_DELAYED: 'payment_failed',
    PURCHASE_REFUNDED: 'payment_refunded',
    PURCHASE_CHARGEBACK: 'payment_refunded',
    SUBSCRIPTION_CANCELLATION: 'subscription_cancelled',
  };

  /**
   * Stripe es la pasarela de Sellea, y sus avisos se guardan SIN negocio
   * (`StripeWebhookEvent.tenantId` es null en los 369 de producción). Así que
   * el negocio se resuelve aquí por el cliente de Stripe del payload. Sin esto,
   * los cuatro disparadores de cobro no se activarían jamás para Sellea —
   * justo la marca que los pidió.
   */
  private static readonly EVENTOS_STRIPE: Record<string, string> = {
    'invoice.paid': 'payment_approved',
    'invoice.payment_succeeded': 'payment_approved',
    'invoice.payment_failed': 'payment_failed',
    'charge.failed': 'payment_failed',
    'charge.refunded': 'payment_refunded',
    'charge.dispute.created': 'payment_refunded',
    'customer.subscription.deleted': 'subscription_cancelled',
  };

  /**
   * Hasta dónde miró el último barrido. Sin esta marca, la ventana de 6 minutos
   * con un cron de 5 hace que un aviso lo vean DOS pasadas, y en un flujo con
   * re-entrada eso es el mismo SMS dos veces.
   */
  private ultimoBarridoDeCobros: Date | null = null;

  @Cron(CronExpression.EVERY_5_MINUTES)
  async scanCobros(): Promise<void> {
    const ahora = new Date();
    try {
      // La primera pasada mira 6 minutos atrás; las siguientes, desde donde
      // terminó la anterior, así no se solapan ni se pierde nada si una tardó.
      const desde = this.ultimoBarridoDeCobros ?? new Date(ahora.getTime() - 6 * 60000);

      const hotmart = await this.prisma.hotmartWebhookEvent.findMany({
        where: {
          processedAt: { gte: desde, lt: ahora },
          eventType: { in: Object.keys(BrandWorkflowEngineService.EVENTOS_DE_COBRO) },
          tenantId: { not: null },
        },
        select: { eventType: true, tenantId: true },
        take: 500,
      });
      for (const e of hotmart) {
        const tipo = BrandWorkflowEngineService.EVENTOS_DE_COBRO[e.eventType];
        if (tipo && e.tenantId) await this.fireTrigger(tipo, e.tenantId);
      }

      const stripe = await this.prisma.stripeWebhookEvent.findMany({
        where: {
          processedAt: { gte: desde, lt: ahora },
          eventType: { in: Object.keys(BrandWorkflowEngineService.EVENTOS_STRIPE) },
        },
        select: { eventType: true, tenantId: true, payload: true },
        take: 500,
      });
      for (const e of stripe) {
        const tipo = BrandWorkflowEngineService.EVENTOS_STRIPE[e.eventType];
        if (!tipo) continue;
        const tenantId = e.tenantId ?? (await this.negocioDeStripe(e.payload));
        if (tenantId) await this.fireTrigger(tipo, tenantId);
      }

      // Suspensiones: la fecha la escribe quien pausa la cuenta, venga de donde venga.
      const suspendidos = await this.prisma.tenant.findMany({
        where: { suspendedAt: { gte: desde, lt: ahora } },
        select: { id: true },
        take: 500,
      });
      for (const t of suspendidos) await this.fireTrigger('business_suspended', t.id);

      this.ultimoBarridoDeCobros = ahora;
    } catch (e) {
      // Sin mover la marca: lo que no se pudo mirar se mira en la siguiente.
      this.log.warn(`scanCobros falló: ${(e as Error).message}`);
    }
  }

  /** El negocio de un aviso de Stripe: por su cliente o por su suscripción. */
  private async negocioDeStripe(payload: unknown): Promise<string | null> {
    const obj = ((payload as any)?.data?.object ?? {}) as Record<string, unknown>;
    const customer = typeof obj.customer === 'string' ? obj.customer : null;
    const sub =
      typeof obj.subscription === 'string'
        ? obj.subscription
        : typeof obj.object === 'string' && obj.object === 'subscription' && typeof obj.id === 'string'
          ? obj.id
          : null;
    if (!customer && !sub) return null;
    const t = await this.prisma.tenant.findFirst({
      where: {
        OR: [
          ...(customer ? [{ stripeCustomerId: customer }] : []),
          ...(sub ? [{ stripeSubscriptionId: sub }] : []),
        ],
      },
      select: { id: true },
    });
    return t?.id ?? null;
  }

  /** Prueba por terminar: el momento de empujar al que aún no ha pagado. */
  private async scanTrialEnding(): Promise<void> {
    const wfs = await this.publishedByTrigger('trial_ending');
    const now = new Date();
    for (const wf of wfs) {
      const days = Number(((wf.trigger as WFTrigger) || {}).daysBefore) || 2;
      const horizon = new Date(now.getTime() + days * 86400000);
      const where = await this.brandTenantWhere(wf.whiteLabelId);
      const tenants = await this.prisma.tenant.findMany({
        where: { ...where, status: 'TRIAL', trialEndsAt: { gte: now, lte: horizon } },
        select: { id: true },
        take: 500,
      });
      for (const t of tenants) await this.fireEnroll(wf, t.id);
    }
  }

  /**
   * Primer pedido y «llegó a N pedidos».
   *
   * Los dos salen del mismo conteo, así que se hace UNA agrupación por negocio
   * en vez de una consulta por flujo. La re-entrada la frena `enroll`: un
   * negocio que ya entró no vuelve a entrar aunque siga contando pedidos.
   */
  private async scanPedidos(): Promise<void> {
    const wfs = [...(await this.publishedByTrigger('first_order')), ...(await this.publishedByTrigger('orders_milestone'))];
    if (!wfs.length) return;
    for (const wf of wfs) {
      const tipo = ((wf.trigger as WFTrigger) || {}).type;
      const meta = tipo === 'first_order' ? 1 : Number(((wf.trigger as WFTrigger) || {}).orders) || 100;
      const where = await this.brandTenantWhere(wf.whiteLabelId);
      const tenants = await this.prisma.tenant.findMany({ where, select: { id: true }, take: 2000 });
      if (!tenants.length) continue;
      const cuenta = await this.prisma.order.groupBy({
        by: ['tenantId'],
        where: { tenantId: { in: tenants.map((t) => t.id) } },
        _count: { _all: true },
      });
      for (const c of cuenta) {
        if ((c._count?._all ?? 0) < meta) continue;
        await this.fireEnroll(wf, c.tenantId);
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
