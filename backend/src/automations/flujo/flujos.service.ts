import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { AutomationsService, ResultadoEnvio } from '../automations.service';
import { momentoLocal } from '../hora-local';
import {
  CAMPOS_CONDICION,
  DISPARADORES,
  DISPARADORES_SOLO_PUSH,
  DefinicionFlujo,
  Grafo,
  HORARIO,
  LIMITES,
  MS_UNIDAD,
  Nodo,
  OPERADORES,
  Problema,
  TIPOS_DE_CUPON,
  VARIABLES,
  VERSION_GRAFO,
  campoCondicion,
  evaluarCondicion,
  grafoDelFlujo,
  msDeEspera,
  msHastaHorario,
  nodoActual,
  problemasDeForma,
  problemasParaActivar,
} from './grafo';
import {
  PLANTILLAS_FLUJO,
  contarPasos,
  grafoDePlantilla,
  idiomaDe,
} from './plantillas-flujo';

const MIN = 60_000;
const DIA = 86_400_000;
/** Un tick que muere a mitad deja la fila `running`; pasado esto se retoma. */
const CANDADO_CADUCA_MS = 10 * MIN;
/** Si a ese cliente le llegó otra automatización hace menos de esto, se espera. */
const ESPACIO_ENTRE_AVISOS_MS = 5 * MIN;
const REINTENTOS = 3;
const TERMINADOS = ['done', 'cancelled', 'error', 'stopped'];

type PaseSellos = {
  id: string;
  status: string;
  stampsCount: number | null;
  visitsCount: number | null;
  card: {
    name: string;
    type: string;
    rewardText: string | null;
    stampsRequired: number | null;
    visitsRequired: number | null;
  } | null;
};

const nuevoId = () => randomUUID().replace(/-/g, '').slice(0, 10);

/** Lo que se guarda del evento que inscribió: solo lo que el motor usa. */
function contextoDelEvento(eventType: string, payload: any) {
  const out: Record<string, any> = { evento: eventType };
  for (const k of [
    'cardId',
    'passId',
    'couponCardId',
    'couponPassId',
    'orderId',
    'remaining',
    'stampsCount',
    'rewardText',
    'cardName',
    'daysSinceLastVisit',
  ]) {
    if (payload?.[k] !== undefined && payload?.[k] !== null) out[k] = payload[k];
  }
  return out;
}

export function renderizar(texto: string, vars: Record<string, any>): string {
  return String(texto ?? '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (raw, k: string) => {
    const v = vars[k];
    return v === undefined || v === null ? '' : String(v);
  });
}

@Injectable()
export class FlujosService {
  private logger = new Logger(FlujosService.name);

  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => AutomationsService))
    private automations: AutomationsService,
  ) {}

  // ═══════════════════════════ Acceso ═══════════════════════════

  /** El negocio del que se habla. Nunca se fía de un id que mande el front. */
  private tid(user: AuthUser, override?: string) {
    if (user.role === 'SUPER_ADMIN') {
      if (!override) throw new ForbiddenException('tenantId required');
      return override;
    }
    if (!user.tenantId) throw new ForbiddenException();
    return user.tenantId;
  }

  private async propio(user: AuthUser, id: string, override?: string) {
    const tid = this.tid(user, override);
    // findFirst con el negocio en el WHERE: un id de otro negocio da 404, igual
    // que uno que no existe. No se le confirma a nadie que ese flujo existe.
    const wf = await this.prisma.automationWorkflow.findFirst({ where: { id, tenantId: tid } });
    if (!wf) throw new NotFoundException();
    return { wf, tid };
  }

  // ═══════════════════════════ Catálogo ═══════════════════════════

  async catalogo(user: AuthUser, override?: string) {
    const tid = this.tid(user, override);
    const [tenant, tarjetas, smsDisponible, predeterminadas] = await Promise.all([
      this.prisma.tenant.findUnique({ where: { id: tid }, select: { locale: true, timezone: true, brandName: true } }),
      this.prisma.card.findMany({
        where: { tenantId: tid, isActive: true, clubPlanId: null, convenioId: null },
        select: { id: true, name: true, type: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.automations.tieneLineaSms(tid),
      this.prisma.automationRule.count({ where: { tenantId: tid, isActive: true } }),
    ]);
    const idioma = idiomaDe(tenant?.locale);
    return {
      disparadores: DISPARADORES,
      campos: CAMPOS_CONDICION.map((c) => ({ ...c, operadores: OPERADORES[c.tipo] })),
      variables: VARIABLES.filter((v) => v !== 'nombre'),
      limites: LIMITES,
      horario: HORARIO,
      zonaHoraria: tenant?.timezone ?? 'America/Bogota',
      negocio: tenant?.brandName ?? '',
      canales: { push: true, sms: smsDisponible, whatsapp: smsDisponible },
      tarjetas,
      predeterminadasActivas: predeterminadas,
      plantillas: PLANTILLAS_FLUJO.map((p) => ({
        key: p.key,
        categoria: p.categoria,
        icono: p.icono,
        nombre: p.nombre[idioma],
        descripcion: p.descripcion[idioma],
        objetivo: p.objetivo[idioma],
        triggerType: p.triggerType,
        pasos: contarPasos(p),
      })),
    };
  }

  // ═══════════════════════════ CRUD ═══════════════════════════

  async listar(user: AuthUser, override?: string) {
    const tid = this.tid(user, override);
    const flujos = await this.prisma.automationWorkflow.findMany({
      where: { tenantId: tid },
      orderBy: { createdAt: 'desc' },
    });
    const ids = flujos.map((f) => f.id);
    const [porEstado, envios] = ids.length
      ? await Promise.all([
          this.prisma.automationEnrollment.groupBy({
            by: ['workflowId', 'status'],
            where: { workflowId: { in: ids } },
            _count: { _all: true },
          }),
          this.prisma.automationStepLog.groupBy({
            by: ['workflowId', 'status'],
            where: { workflowId: { in: ids }, status: { in: ['sent', 'scheduled', 'failed'] } },
            _count: { _all: true },
          }),
        ])
      : [[], []];
    return flujos.map((f) => {
      const cuenta = (estados: string[]) =>
        (porEstado as any[])
          .filter((r) => r.workflowId === f.id && estados.includes(r.status))
          .reduce((a, r) => a + r._count._all, 0);
      const envio = (estados: string[]) =>
        (envios as any[])
          .filter((r) => r.workflowId === f.id && estados.includes(r.status))
          .reduce((a, r) => a + r._count._all, 0);
      const g = grafoDelFlujo(f);
      return {
        id: f.id,
        name: f.name,
        description: f.description,
        status: f.status,
        triggerType: f.triggerType,
        triggerDays: f.triggerDays,
        schemaVersion: f.schemaVersion,
        pasos: Object.keys(g.nodes).length,
        createdAt: f.createdAt,
        updatedAt: f.updatedAt,
        lastActivityAt: f.lastActivityAt,
        stats: {
          inscritos: cuenta(['active', 'running', ...TERMINADOS]),
          enCurso: cuenta(['active', 'running']),
          completados: cuenta(['done']),
          cancelados: cuenta(['cancelled', 'stopped']),
          errores: cuenta(['error']),
          enviados: envio(['sent', 'scheduled']),
          fallidos: envio(['failed']),
        },
      };
    });
  }

  async obtener(user: AuthUser, id: string, override?: string) {
    const { wf } = await this.propio(user, id, override);
    return this.vista(wf);
  }

  private vista(wf: any) {
    return {
      id: wf.id,
      name: wf.name,
      description: wf.description,
      status: wf.status,
      triggerType: wf.triggerType,
      triggerDays: wf.triggerDays,
      triggerConfig: wf.triggerConfig ?? {},
      reentry: wf.reentry,
      templateKey: wf.templateKey,
      schemaVersion: wf.schemaVersion,
      graph: grafoDelFlujo(wf),
      createdAt: wf.createdAt,
      updatedAt: wf.updatedAt,
    };
  }

  async crear(user: AuthUser, body: { plantilla?: string; name?: string }, override?: string) {
    const tid = this.tid(user, override);
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tid }, select: { locale: true } });
    const idioma = idiomaDe(tenant?.locale);
    const p = PLANTILLAS_FLUJO.find((x) => x.key === (body?.plantilla ?? 'vacio'));
    if (!p) throw new BadRequestException('plantilla_desconocida');
    const graph = grafoDePlantilla(p, idioma, nuevoId);
    const wf = await this.prisma.automationWorkflow.create({
      data: {
        tenantId: tid,
        name: (body?.name ?? '').trim() || p.nombre[idioma],
        description: p.key === 'vacio' ? '' : p.descripcion[idioma],
        triggerType: p.triggerType,
        triggerDays: p.triggerDays ?? null,
        steps: [],
        schemaVersion: VERSION_GRAFO,
        graph: graph as any,
        status: 'draft',
        isActive: false,
        reentry: p.reentry,
        templateKey: p.key,
      },
    });
    return this.vista(wf);
  }

  async guardar(
    user: AuthUser,
    id: string,
    body: Partial<DefinicionFlujo> & { description?: string },
    override?: string,
  ) {
    const { wf, tid } = await this.propio(user, id, override);
    const graph = this.limpiarGrafo(body.graph ?? grafoDelFlujo(wf));
    const forma = problemasDeForma(graph);
    if (forma.length) throw new BadRequestException({ message: 'El flujo tiene conexiones rotas.', code: 'grafo_invalido', problemas: forma });
    const def: DefinicionFlujo = {
      name: String(body.name ?? wf.name).slice(0, 120),
      triggerType: String(body.triggerType ?? wf.triggerType ?? ''),
      triggerDays: body.triggerDays === undefined ? wf.triggerDays : body.triggerDays,
      triggerConfig: this.limpiarConfig(body.triggerConfig ?? (wf.triggerConfig as any)),
      graph,
      reentry: body.reentry ?? wf.reentry,
    };
    // Un flujo ACTIVO no puede quedar roto: estaría inscribiendo clientes en un
    // camino que el motor no sabe recorrer. Se pausa, se arregla y se activa.
    if (wf.status === 'active') {
      const ps = problemasParaActivar(def, await this.ctxValidacion(tid));
      if (ps.length) {
        throw new BadRequestException({ message: 'Un flujo activo no puede quedar con pasos incompletos.', code: 'activo_invalido', problemas: ps });
      }
    }
    const guardado = await this.prisma.automationWorkflow.update({
      where: { id: wf.id },
      data: {
        name: def.name,
        description: body.description === undefined ? undefined : String(body.description).slice(0, 500),
        triggerType: def.triggerType,
        triggerDays: def.triggerDays ?? null,
        triggerConfig: def.triggerConfig as any,
        reentry: def.reentry === 'after_finish' ? 'after_finish' : 'once',
        schemaVersion: VERSION_GRAFO,
        graph: graph as any,
      },
    });
    // Recorridos parados en un paso que se acaba de borrar: se avisan al
    // guardar; el motor los cierra como «cancelado» en su próximo paso.
    const enCurso = await this.prisma.automationEnrollment.findMany({
      where: { workflowId: wf.id, status: { in: ['active', 'running'] } },
      select: { currentNodeId: true, stepIndex: true },
    });
    const huerfanos = enCurso.filter((e) => !graph.nodes[nodoActual(e)]).length;
    return { ...this.vista(guardado), huerfanos };
  }

  async validar(user: AuthUser, id: string, override?: string) {
    const { wf, tid } = await this.propio(user, id, override);
    const def = this.definicion(wf);
    const errores = problemasParaActivar(def, await this.ctxValidacion(tid));
    return { errores, avisos: await this.avisos(tid, def) };
  }

  async activar(user: AuthUser, id: string, override?: string) {
    const { wf, tid } = await this.propio(user, id, override);
    const def = this.definicion(wf);
    const errores = problemasParaActivar(def, await this.ctxValidacion(tid));
    if (errores.length) {
      throw new BadRequestException({ message: 'Hay pasos por completar antes de activar.', code: 'no_se_puede_activar', problemas: errores });
    }
    const r = await this.prisma.automationWorkflow.update({
      where: { id: wf.id },
      // Se guarda como grafo aunque fuera de la versión 1: a partir de aquí
      // el horario de envío y los topes aplican también a él.
      data: { status: 'active', isActive: true, schemaVersion: VERSION_GRAFO, graph: def.graph as any },
    });
    return this.vista(r);
  }

  /**
   * Pausar: no entra nadie nuevo y los que están dentro se quedan quietos en su
   * paso. Al reactivar siguen desde ahí; si su espera venció durante la pausa,
   * el siguiente paso sale en el primer minuto.
   */
  async pausar(user: AuthUser, id: string, override?: string) {
    const { wf } = await this.propio(user, id, override);
    const r = await this.prisma.automationWorkflow.update({
      where: { id: wf.id },
      data: { status: 'paused', isActive: false },
    });
    return this.vista(r);
  }

  async duplicar(user: AuthUser, id: string, override?: string) {
    const { wf, tid } = await this.propio(user, id, override);
    const g = grafoDelFlujo(wf);
    // Ids nuevos: los historiales de un flujo y su copia no se cruzan nunca.
    const mapa = new Map(Object.keys(g.nodes).map((k) => [k, nuevoId()]));
    const nodes: Record<string, Nodo> = {};
    for (const n of Object.values(g.nodes)) {
      const m = (x?: string | null) => (x ? mapa.get(x) ?? null : null);
      nodes[mapa.get(n.id)!] = { ...n, id: mapa.get(n.id)!, next: m(n.next), yes: m(n.yes), no: m(n.no) };
    }
    const copia = await this.prisma.automationWorkflow.create({
      data: {
        tenantId: tid,
        name: `${wf.name} (copia)`.slice(0, 120),
        description: wf.description,
        triggerType: wf.triggerType,
        triggerDays: wf.triggerDays,
        triggerConfig: (wf.triggerConfig ?? {}) as any,
        reentry: wf.reentry,
        templateKey: wf.templateKey,
        steps: [],
        schemaVersion: VERSION_GRAFO,
        graph: { rootId: g.rootId ? mapa.get(g.rootId) : null, nodes } as any,
        status: 'draft',
        isActive: false,
      },
    });
    return this.vista(copia);
  }

  async eliminar(user: AuthUser, id: string, override?: string) {
    const { wf } = await this.propio(user, id, override);
    await this.prisma.$transaction([
      this.prisma.automationStepLog.deleteMany({ where: { workflowId: wf.id } }),
      // Las inscripciones caen en cascada con el flujo.
      this.prisma.automationWorkflow.delete({ where: { id: wf.id } }),
    ]);
    return { ok: true };
  }

  // ═══════════════════════════ Historial ═══════════════════════════

  async ejecuciones(
    user: AuthUser,
    id: string,
    q: { estado?: string; pagina?: string },
    override?: string,
  ) {
    const { wf } = await this.propio(user, id, override);
    const ahora = new Date();
    const where: any = { workflowId: wf.id };
    switch (q.estado) {
      case 'waiting':
        Object.assign(where, { status: 'active', nextRunAt: { gt: ahora } });
        break;
      case 'running':
        Object.assign(where, { OR: [{ status: 'running' }, { status: 'active', nextRunAt: { lte: ahora } }] });
        break;
      case 'done':
        where.status = 'done';
        break;
      case 'cancelled':
        where.status = { in: ['cancelled', 'stopped'] };
        break;
      case 'error':
        where.status = 'error';
        break;
    }
    const pagina = Math.max(0, Number(q.pagina) || 0);
    const [filas, total] = await Promise.all([
      this.prisma.automationEnrollment.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: pagina * 50,
        take: 50,
      }),
      this.prisma.automationEnrollment.count({ where }),
    ]);
    const clientes = await this.prisma.customer.findMany({
      where: { id: { in: filas.map((f) => f.customerId) }, tenantId: wf.tenantId },
      select: { id: true, fullName: true },
    });
    const g = grafoDelFlujo(wf);
    return {
      total,
      pagina,
      filas: filas.map((f) => ({
        id: f.id,
        cliente: clientes.find((c) => c.id === f.customerId)?.fullName ?? '—',
        estado: this.estadoVisible(f, ahora),
        nodoActual: TERMINADOS.includes(f.status) ? null : nodoActual(f),
        tipoNodoActual: TERMINADOS.includes(f.status) ? null : g.nodes[nodoActual(f)]?.type ?? null,
        proximaAccion: TERMINADOS.includes(f.status) ? null : f.nextRunAt,
        recorrido: f.runNumber,
        entro: f.enteredAt ?? f.createdAt,
        termino: f.completedAt,
      })),
    };
  }

  async lineaDeTiempo(user: AuthUser, id: string, enrId: string, override?: string) {
    const { wf } = await this.propio(user, id, override);
    const enr = await this.prisma.automationEnrollment.findFirst({ where: { id: enrId, workflowId: wf.id } });
    if (!enr) throw new NotFoundException();
    const [cliente, pasos] = await Promise.all([
      this.prisma.customer.findFirst({ where: { id: enr.customerId, tenantId: wf.tenantId }, select: { fullName: true } }),
      this.prisma.automationStepLog.findMany({
        where: { enrollmentId: enr.id },
        orderBy: { createdAt: 'asc' },
        take: 500,
      }),
    ]);
    return {
      id: enr.id,
      cliente: cliente?.fullName ?? '—',
      estado: this.estadoVisible(enr, new Date()),
      recorrido: enr.runNumber,
      proximaAccion: TERMINADOS.includes(enr.status) ? null : enr.nextRunAt,
      pasos: pasos.map((p) => ({
        id: p.id,
        recorrido: p.runNumber,
        nodeId: p.nodeId,
        tipo: p.nodeType,
        estado: p.status,
        // Solo códigos y el texto que se le mandó al cliente: nada de trazas.
        motivo: (p.detail as any)?.motivo ?? null,
        texto: (p.detail as any)?.texto ?? null,
        hasta: (p.detail as any)?.hasta ?? null,
        resultado: (p.detail as any)?.resultado ?? null,
        fecha: p.createdAt,
      })),
    };
  }

  async cancelarEjecucion(user: AuthUser, id: string, enrId: string, override?: string) {
    const { wf } = await this.propio(user, id, override);
    const r = await this.prisma.automationEnrollment.updateMany({
      where: { id: enrId, workflowId: wf.id, status: { in: ['active', 'running'] } },
      data: { status: 'cancelled', completedAt: new Date(), lockedAt: null },
    });
    if (!r.count) throw new BadRequestException('no_esta_en_curso');
    const enr = await this.prisma.automationEnrollment.findUnique({ where: { id: enrId } });
    if (enr) await this.log(enr, null, 'end', 'cancelled', { motivo: 'cancelado_a_mano' });
    return { ok: true };
  }

  private estadoVisible(e: { status: string; nextRunAt: Date }, ahora: Date) {
    if (e.status === 'active') return e.nextRunAt > ahora ? 'waiting' : 'running';
    if (e.status === 'stopped') return 'cancelled';
    return e.status;
  }

  // ═══════════════════════════ Validación ═══════════════════════════

  private definicion(wf: any): DefinicionFlujo {
    return {
      name: wf.name,
      triggerType: wf.triggerType,
      triggerDays: wf.triggerDays,
      triggerConfig: (wf.triggerConfig as any) ?? {},
      graph: grafoDelFlujo(wf),
      reentry: wf.reentry,
    };
  }

  private async ctxValidacion(tid: string) {
    const [sms, tarjetas] = await Promise.all([
      this.automations.tieneLineaSms(tid),
      this.prisma.card.findMany({ where: { tenantId: tid }, select: { id: true } }),
    ]);
    return { smsDisponible: sms, tarjetas: tarjetas.map((t) => t.id) };
  }

  /**
   * Lo que no impide activar pero el negocio debe saber. El caso que importa:
   * una predeterminada con el MISMO evento que también escribe. No se apaga
   * sola (no se le apaga nada a nadie sin que lo pida); se le avisa de que el
   * cliente recibiría los dos mensajes.
   */
  private async avisos(tid: string, def: DefinicionFlujo): Promise<Problema[]> {
    const out: Problema[] = [];
    const evento = def.triggerType === 'COUPON_ISSUED' ? 'PASS_CREATED' : def.triggerType;
    const reglas = await this.prisma.automationRule.findMany({
      where: { tenantId: tid, isActive: true },
      select: { name: true, trigger: true, actions: true },
    });
    const choques = reglas.filter(
      (r) =>
        (r.trigger as any)?.type === evento &&
        ((r.actions as any[]) ?? []).some((a) => ['SEND_PUSH', 'SEND_SMS', 'SEND_WHATSAPP'].includes(a?.type)),
    );
    if (choques.length) {
      out.push({ codigo: 'choca_con_predeterminada', extra: { nombres: choques.map((c) => c.name) } });
    }
    if (DISPARADORES_SOLO_PUSH.includes(def.triggerType)) out.push({ codigo: 'alta_espera_wallet' });
    return out;
  }

  /** Solo los campos que el motor conoce: nada de JSON arbitrario en la base. */
  private limpiarGrafo(g: any): Grafo {
    const nodes: Record<string, Nodo> = {};
    const entrada = g?.nodes && typeof g.nodes === 'object' ? g.nodes : {};
    for (const [k, n] of Object.entries<any>(entrada).slice(0, LIMITES.nodos + 1)) {
      if (!n || typeof n !== 'object') continue;
      const id = String(n.id ?? k).slice(0, 40);
      const c = n.config && typeof n.config === 'object' ? n.config : {};
      let config: Record<string, any> = {};
      if (n.type === 'wait') config = { amount: Math.round(Number(c.amount) || 0), unit: String(c.unit ?? '') };
      else if (n.type === 'push') config = { title: String(c.title ?? '').slice(0, 200), body: String(c.body ?? '').slice(0, 1000) };
      else if (n.type === 'sms' || n.type === 'whatsapp') config = { body: String(c.body ?? '').slice(0, 2000) };
      else if (n.type === 'condition') {
        config = { field: String(c.field ?? ''), op: String(c.op ?? '') };
        if (c.value !== undefined && c.value !== null && c.value !== '') config.value = Number(c.value);
      }
      const ref = (x: any) => (x ? String(x).slice(0, 40) : null);
      nodes[id] = {
        id,
        type: n.type,
        config,
        ...(n.type === 'condition' ? { yes: ref(n.yes), no: ref(n.no) } : n.type === 'end' ? {} : { next: ref(n.next) }),
      };
    }
    return { rootId: g?.rootId ? String(g.rootId).slice(0, 40) : null, nodes };
  }

  private limpiarConfig(c: any) {
    return c?.cardId ? { cardId: String(c.cardId) } : {};
  }

  // ═══════════════════════════ Inscripción ═══════════════════════════

  /**
   * Llamado desde `AutomationsService.emit` (además de las predeterminadas, que
   * van por su lado). `dias` solo lo pasa el cron de inactividad: un flujo de
   * «7 días sin venir» no debe entrar con el aviso de los 30.
   */
  async inscribirPorEvento(eventType: string, payload: any, opts: { dias?: number } = {}) {
    const tenantId = payload?.tenantId;
    const customerId = payload?.customerId;
    if (!tenantId || !customerId) return; // los flujos son de CLIENTES

    const tipos = [eventType];
    if (eventType === 'PASS_CREATED' && payload.cardId) {
      const card = await this.prisma.card.findFirst({
        where: { id: payload.cardId, tenantId },
        select: { type: true },
      });
      if (card && TIPOS_DE_CUPON.includes(String(card.type))) tipos.push('COUPON_ISSUED');
    }
    const flujos = await this.prisma.automationWorkflow.findMany({
      where: { tenantId, isActive: true, triggerType: { in: tipos } },
    });
    if (!flujos.length) return;

    // El cliente tiene que ser de ESTE negocio. Hoy siempre lo es (lo pone el
    // código que emite), pero un flujo escribe a una persona: se comprueba.
    const cliente = await this.prisma.customer.findFirst({
      where: { id: customerId, tenantId },
      select: { id: true },
    });
    if (!cliente) return;

    const ahora = new Date();
    const context = contextoDelEvento(eventType, payload);
    for (const wf of flujos) {
      if (wf.triggerType === 'INACTIVITY' && (wf.triggerDays ?? 30) !== (opts.dias ?? 30)) continue;
      const filtro = (wf.triggerConfig as any)?.cardId;
      if (filtro && filtro !== (payload.cardId ?? payload.couponCardId)) continue;
      const g = grafoDelFlujo(wf);
      if (!g.rootId) continue;
      try {
        const enr = await this.prisma.automationEnrollment.create({
          data: {
            workflowId: wf.id,
            tenantId,
            customerId,
            stepIndex: 0,
            currentNodeId: g.rootId,
            status: 'active',
            nextRunAt: ahora,
            enteredAt: ahora,
            context: context as any,
          },
        });
        await this.log(enr, null, 'trigger', 'entered', { resultado: eventType });
      } catch (e: any) {
        if (e?.code !== 'P2002') throw e;
        // Ya tiene fila. Re-entrada solo si el flujo lo permite y su recorrido
        // anterior TERMINÓ: el WHERE con el estado hace que dos eventos a la
        // vez no abran dos recorridos (solo uno pasa el UPDATE).
        if (wf.reentry !== 'after_finish') continue;
        const r = await this.prisma.automationEnrollment.updateMany({
          where: { workflowId: wf.id, customerId, status: { in: TERMINADOS } },
          data: {
            status: 'active',
            currentNodeId: g.rootId,
            stepIndex: 0,
            nextRunAt: ahora,
            runNumber: { increment: 1 },
            attempts: 0,
            lastError: null,
            lockedAt: null,
            completedAt: null,
            enteredAt: ahora,
            context: context as any,
          },
        });
        if (r.count) {
          const enr = await this.prisma.automationEnrollment.findUnique({
            where: { workflowId_customerId: { workflowId: wf.id, customerId } },
          });
          if (enr) await this.log(enr, null, 'trigger', 'entered', { resultado: eventType });
        }
      }
    }
  }

  /** Los días de inactividad que piden los flujos activos de un negocio, salvo los 30 de siempre. */
  async diasDeInactividadExtra(tenantId: string): Promise<number[]> {
    const fs = await this.prisma.automationWorkflow.findMany({
      where: { tenantId, isActive: true, triggerType: 'INACTIVITY' },
      select: { triggerDays: true },
    });
    return [...new Set(fs.map((f) => f.triggerDays ?? 30))].filter((d) => d !== 30);
  }

  // ═══════════════════════════ Motor ═══════════════════════════

  /**
   * Cada minuto: avanza los recorridos que vencieron. Todo el estado vive en la
   * base (nodo actual + `nextRunAt`), así que un reinicio o un despliegue solo
   * retrasan, no pierden: no hay nada esperando en memoria.
   *
   * Cada fila se RECLAMA con un UPDATE condicional antes de tocarla: durante un
   * despliegue corren dos procesos con el cron armado y sin el reclamo los dos
   * avanzarían el mismo recorrido.
   */
  @Cron('* * * * *')
  async tick(ahora: Date = new Date()) {
    await this.prisma.automationEnrollment.updateMany({
      where: { status: 'running', lockedAt: { lt: new Date(ahora.getTime() - CANDADO_CADUCA_MS) } },
      data: { status: 'active', lockedAt: null },
    });
    const vencidas = await this.prisma.automationEnrollment.findMany({
      where: { status: 'active', nextRunAt: { lte: ahora }, workflow: { isActive: true } },
      select: { id: true, nextRunAt: true },
      orderBy: { nextRunAt: 'asc' },
      take: 200,
    });
    for (const v of vencidas) {
      const claim = await this.prisma.automationEnrollment.updateMany({
        where: { id: v.id, status: 'active', nextRunAt: v.nextRunAt },
        data: { status: 'running', lockedAt: ahora },
      });
      if (claim.count !== 1) continue;
      try {
        await this.avanzar(v.id, ahora);
      } catch (e: any) {
        await this.fallo(v.id, e).catch(() => null);
      }
    }
  }

  async avanzar(enrId: string, ahora: Date) {
    const enr = await this.prisma.automationEnrollment.findUnique({
      where: { id: enrId },
      include: { workflow: true },
    });
    if (!enr) return;
    const wf = enr.workflow;
    const g = grafoDelFlujo(wf);
    const v2 = (wf.schemaVersion ?? 1) >= VERSION_GRAFO;
    const soloPush = DISPARADORES_SOLO_PUSH.includes(wf.triggerType);
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: enr.tenantId },
      select: { timezone: true, brandName: true },
    });
    let nodeId: string | null | undefined = nodoActual(enr);

    for (let i = 0; i < LIMITES.pasosPorTick; i++) {
      if (!nodeId) return this.terminar(enr, 'done');
      const n: Nodo | undefined = g.nodes[nodeId];
      if (!n) {
        await this.log(enr, nodeId, 'unknown', 'cancelled', { motivo: 'paso_eliminado' });
        return this.terminar(enr, 'cancelled', true);
      }

      if (n.type === 'end') return this.terminar(enr, 'done');

      if (n.type === 'wait') {
        if (!n.next) return this.terminar(enr, 'done');
        // Los flujos viejos admitían cualquier número de 1 a 365: se respeta.
        const ms =
          msDeEspera(n.config) ??
          Math.max(1, Math.min(365, Number(n.config?.amount) || 1)) *
            (MS_UNIDAD[n.config?.unit as keyof typeof MS_UNIDAD] ?? MIN);
        const hasta = new Date(ahora.getTime() + ms);
        await this.log(enr, n.id, 'wait', 'waited', { hasta: hasta.toISOString() });
        await this.prisma.automationEnrollment.update({
          where: { id: enr.id },
          data: { status: 'active', currentNodeId: n.next, nextRunAt: hasta, lockedAt: null, attempts: 0 },
        });
        return;
      }

      if (n.type === 'condition') {
        const valor = await this.valorDeCampo(String(n.config?.field), enr);
        const ok: boolean = campoCondicion(String(n.config?.field))
          ? evaluarCondicion(String(n.config?.op), valor, n.config?.value)
          : false;
        await this.log(enr, n.id, 'condition', 'branch', { resultado: ok ? 'yes' : 'no', valor });
        nodeId = ok ? n.yes : n.no;
        continue;
      }

      // ── Envío (push / sms / whatsapp) ──
      const clave = `${enr.id}:${enr.runNumber}:${n.id}`;
      const ya = await this.prisma.automationStepLog.findUnique({ where: { dedupKey: clave }, select: { id: true } });
      if (ya) {
        // Este paso ya se intentó en este recorrido (un tick que murió después
        // de enviar). Se sigue de largo: repetirlo sería el push doble.
        nodeId = n.next;
        continue;
      }

      if (v2) {
        // Horario: a las 3 de la mañana no se le escribe a nadie. Se espera a
        // las 8 de SU negocio, en el mismo paso.
        const m = momentoLocal(ahora, tenant?.timezone ?? 'America/Bogota');
        const espera = msHastaHorario(m.minutos / 60);
        if (espera > 0) {
          const hasta = new Date(ahora.getTime() + espera);
          await this.log(enr, n.id, n.type, 'info', { motivo: 'fuera_de_horario', hasta: hasta.toISOString() });
          return this.reprogramar(enr.id, n.id, hasta);
        }
        // Dos automatizaciones al mismo cliente en el mismo minuto (p. ej. la
        // predeterminada de «sello» y este flujo): en el iPhone el segundo
        // mensaje pisa al primero en la tarjeta. Se separan unos minutos.
        if (n.type === 'push') {
          const reciente = await this.prisma.notification.findFirst({
            where: {
              tenantId: enr.tenantId,
              customerId: enr.customerId,
              triggerType: 'AUTOMATION',
              sentAt: { gte: new Date(ahora.getTime() - ESPACIO_ENTRE_AVISOS_MS) },
            },
            select: { id: true },
          });
          if (reciente) return this.reprogramar(enr.id, n.id, new Date(ahora.getTime() + 2 * ESPACIO_ENTRE_AVISOS_MS));
        }
      }

      const vars = await this.variablesDelCliente(enr, tenant?.brandName ?? '');
      const titulo = renderizar(n.config?.title ?? '', vars).trim();
      const cuerpo = renderizar(n.config?.body ?? '', vars).trim();
      const texto = n.type === 'push' ? `${titulo} — ${cuerpo}` : cuerpo;

      if (v2) {
        const desde = new Date(ahora.getTime() - DIA);
        const [hoy, repetido] = await Promise.all([
          this.prisma.automationStepLog.count({
            where: {
              tenantId: enr.tenantId,
              customerId: enr.customerId,
              status: { in: ['sent', 'scheduled'] },
              createdAt: { gte: desde },
            },
          }),
          this.prisma.automationStepLog.findFirst({
            where: {
              tenantId: enr.tenantId,
              customerId: enr.customerId,
              status: { in: ['sent', 'scheduled'] },
              createdAt: { gte: desde },
              detail: { path: ['texto'], equals: texto },
            },
            select: { id: true },
          }),
        ]);
        const motivo = hoy >= LIMITES.mensajesPorClienteDia ? 'tope_diario' : repetido ? 'repetido' : null;
        if (motivo) {
          await this.log(enr, n.id, n.type, 'skipped', { motivo, texto }, clave);
          nodeId = n.next;
          continue;
        }
      }

      // El registro se crea ANTES de enviar y con clave única: si dos procesos
      // llegan aquí a la vez, solo uno lo crea y solo ese envía.
      const fila = await this.log(enr, n.id, n.type, 'sending', { texto }, clave);
      if (!fila) {
        nodeId = n.next;
        continue;
      }
      const action: any =
        n.type === 'push'
          ? { type: 'SEND_PUSH', title: titulo, body: cuerpo }
          : { type: n.type === 'sms' ? 'SEND_SMS' : 'SEND_WHATSAPP', body: cuerpo };
      let r: ResultadoEnvio;
      try {
        r = await this.automations.enviarDesdeFlujo(
          action,
          { ...((enr.context as any) ?? {}), ...vars, tenantId: enr.tenantId, customerId: enr.customerId },
          `wf:${wf.id}`,
          { soloPush },
        );
      } catch (e: any) {
        this.logger.warn(`flujo ${wf.id} nodo ${n.id}: ${e?.message}`);
        r = { estado: 'failed', motivo: 'error_de_envio' };
      }
      await this.prisma.automationStepLog.update({
        where: { id: fila.id },
        data: {
          status: r.estado,
          detail: {
            texto,
            motivo: r.motivo ?? null,
            entregados: r.entregados ?? null,
            // El teléfono se guarda enmascarado: el historial lo ve el negocio,
            // pero no hace falta el número entero para saber a quién fue.
            destinatario: r.destinatario ? `•••${String(r.destinatario).slice(-4)}` : null,
          } as any,
        },
      });
      await this.prisma.automationWorkflow
        .update({ where: { id: wf.id }, data: { lastActivityAt: ahora } })
        .catch(() => null);
      nodeId = n.next;
    }
    // Demasiados pasos seguidos sin una espera: se suelta y sigue en el próximo
    // minuto. Con el grafo sin ciclos esto no debería pasar; es el seguro.
    await this.reprogramar(enr.id, nodeId ?? null, new Date(ahora.getTime() + MIN));
  }

  private async reprogramar(enrId: string, nodeId: string | null, cuando: Date) {
    await this.prisma.automationEnrollment.update({
      where: { id: enrId },
      data: { status: 'active', currentNodeId: nodeId, nextRunAt: cuando, lockedAt: null },
    });
  }

  private async terminar(
    enr: { id: string; workflowId: string; tenantId: string; customerId: string; runNumber: number },
    estado: 'done' | 'cancelled',
    yaRegistrado = false,
  ) {
    await this.prisma.automationEnrollment.update({
      where: { id: enr.id },
      data: { status: estado, completedAt: new Date(), lockedAt: null, currentNodeId: null },
    });
    if (!yaRegistrado) await this.log(enr, null, 'end', estado, {});
  }

  /** Un error inesperado (no un envío fallido): se reintenta 3 veces con pausa. */
  private async fallo(enrId: string, e: any) {
    const enr = await this.prisma.automationEnrollment.findUnique({ where: { id: enrId } });
    if (!enr) return;
    const intentos = enr.attempts + 1;
    this.logger.warn(`flujo enr ${enrId} intento ${intentos}: ${e?.message}`);
    const final = intentos >= REINTENTOS;
    await this.prisma.automationEnrollment.update({
      where: { id: enrId },
      data: {
        attempts: intentos,
        lastError: String(e?.message ?? e).slice(0, 500),
        lockedAt: null,
        status: final ? 'error' : 'active',
        nextRunAt: new Date(Date.now() + 5 * MIN * intentos),
        ...(final ? { completedAt: new Date() } : {}),
      },
    });
    if (final) await this.log(enr, enr.currentNodeId, 'end', 'failed', { motivo: 'error_interno' });
  }

  private async log(
    enr: { id: string; workflowId: string; tenantId: string; customerId: string; runNumber: number },
    nodeId: string | null,
    nodeType: string,
    status: string,
    detail: Record<string, any>,
    dedupKey?: string,
  ) {
    try {
      return await this.prisma.automationStepLog.create({
        data: {
          tenantId: enr.tenantId,
          workflowId: enr.workflowId,
          enrollmentId: enr.id,
          customerId: enr.customerId,
          runNumber: enr.runNumber,
          nodeId,
          nodeType,
          status,
          detail: detail as any,
          dedupKey: dedupKey ?? null,
        },
      });
    } catch (e: any) {
      if (e?.code === 'P2002') return null;
      throw e;
    }
  }

  // ═══════════════════════════ Datos del cliente ═══════════════════════════

  /** El pase de sellos/visitas del recorrido: el del evento o el primero activo. */
  private async paseDeSellos(enr: { tenantId: string; customerId: string; context: any }): Promise<PaseSellos | null> {
    const ctx = (enr.context as any) ?? {};
    const sel = {
      id: true,
      status: true,
      stampsCount: true,
      visitsCount: true,
      card: { select: { name: true, type: true, rewardText: true, stampsRequired: true, visitsRequired: true } },
    } as const;
    const delEvento = (ctx.passId
      ? await this.prisma.pass.findFirst({ where: { id: ctx.passId, tenantId: enr.tenantId, customerId: enr.customerId }, select: sel })
      : null) as PaseSellos | null;
    if (delEvento && ['STAMPS', 'VISITS'].includes(String(delEvento.card?.type))) return delEvento;
    return (await this.prisma.pass.findFirst({
      where: {
        tenantId: enr.tenantId,
        customerId: enr.customerId,
        status: { in: ['ACTIVE', 'COMPLETED'] },
        card: { type: { in: ['STAMPS', 'VISITS'] }, clubPlanId: null, convenioId: null },
      },
      orderBy: { issuedAt: 'asc' },
      select: sel,
    })) as PaseSellos | null;
  }

  private progreso(p: PaseSellos | null) {
    if (!p) return { actuales: null as number | null, faltan: null as number | null };
    const visitas = p.card?.type === 'VISITS';
    const actuales = visitas ? p.visitsCount ?? 0 : p.stampsCount ?? 0;
    const req = visitas ? p.card?.visitsRequired : p.card?.stampsRequired;
    return { actuales, faltan: req ? Math.max(0, req - actuales) : null };
  }

  private async variablesDelCliente(
    enr: { tenantId: string; customerId: string; context: any },
    businessName: string,
  ) {
    const [c, p] = await Promise.all([
      this.prisma.customer.findFirst({ where: { id: enr.customerId, tenantId: enr.tenantId }, select: { fullName: true } }),
      this.paseDeSellos(enr),
    ]);
    const { actuales, faltan } = this.progreso(p);
    const ctx = (enr.context as any) ?? {};
    const nombre = (c?.fullName ?? '').trim().split(/\s+/)[0] ?? '';
    return {
      customerName: nombre,
      nombre,
      businessName,
      cardName: p?.card?.name ?? ctx.cardName ?? '',
      rewardText: p?.card?.rewardText || ctx.rewardText || '',
      stampsCount: actuales ?? '',
      remaining: faltan ?? '',
    };
  }

  /** El valor de un campo de condición, calculado ahora. null = no hay dato. */
  async valorDeCampo(
    campo: string,
    enr: { tenantId: string; customerId: string; context: any; enteredAt: Date },
  ): Promise<number | boolean | null> {
    const base = { tenantId: enr.tenantId, customerId: enr.customerId };
    const visitas = { ...base, action: { in: ['STAMP', 'VISIT'] as any } };
    switch (campo) {
      case 'sellos_actuales':
        return this.progreso(await this.paseDeSellos(enr)).actuales;
      case 'sellos_faltantes':
        return this.progreso(await this.paseDeSellos(enr)).faltan;
      case 'dias_desde_ultima_visita': {
        const s = await this.prisma.stamp.findFirst({ where: visitas, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
        return s ? Math.floor((Date.now() - s.createdAt.getTime()) / DIA) : null;
      }
      case 'dias_desde_visita_anterior': {
        // Entre la última visita y la de antes: «volvió tras N días».
        const ss = await this.prisma.stamp.findMany({ where: visitas, orderBy: { createdAt: 'desc' }, take: 2, select: { createdAt: true } });
        return ss.length < 2 ? null : Math.floor((ss[0].createdAt.getTime() - ss[1].createdAt.getTime()) / DIA);
      }
      case 'visitas_totales':
        return this.prisma.stamp.count({ where: visitas });
      case 'pedidos_totales':
        return this.prisma.order.count({ where: { ...base, status: { not: 'CANCELLED' } } });
      case 'tuvo_sello_desde_que_entro':
        return (await this.prisma.stamp.count({ where: { ...visitas, createdAt: { gt: enr.enteredAt } } })) > 0;
      case 'canjeo_desde_que_entro':
        return (await this.prisma.stamp.count({ where: { ...base, action: 'REDEEM', createdAt: { gt: enr.enteredAt } } })) > 0;
      case 'premio_disponible':
        return this.premioDisponible(enr);
      case 'cupon_activo':
        return this.cuponActivo(enr);
      case 'beneficio_disponible':
        return (await this.premioDisponible(enr)) || (await this.cuponActivo(enr));
      case 'tiene_cumpleanos': {
        const c = await this.prisma.customer.findFirst({ where: { id: enr.customerId, tenantId: enr.tenantId }, select: { birthday: true } });
        return !!c?.birthday;
      }
      default:
        return null;
    }
  }

  private async premioDisponible(enr: { tenantId: string; customerId: string }) {
    const n = await this.prisma.pass.count({
      where: {
        tenantId: enr.tenantId,
        customerId: enr.customerId,
        status: 'COMPLETED',
        card: { type: { in: ['STAMPS', 'VISITS'] } },
      },
    });
    return n > 0;
  }

  private async cuponActivo(enr: { tenantId: string; customerId: string }) {
    const n = await this.prisma.pass.count({
      where: {
        tenantId: enr.tenantId,
        customerId: enr.customerId,
        status: 'ACTIVE',
        card: { type: { in: TIPOS_DE_CUPON as any } },
      },
    });
    return n > 0;
  }
}
