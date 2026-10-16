import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantContext } from '../common/tenant/tenant-context';
import { PreregAlertsService } from '../auth/prereg-alerts.service';
import { fechaLocal, horaLocal } from '../automations/hora-local';
import {
  AlertaDeSuscripcion,
  DIAS_DE_VENTANA,
  EVENTOS_QUE_MIRA,
  alertasNuevas,
  detectarAlertasDeSuscripcion,
  textoDelResumen,
} from './alertas-de-suscripcion';

/** Ids marcados como revisados desde el panel: `{ [id]: ISO de cuándo }`. */
const CLAVE_REVISADAS = 'billing.alertasSuscripcion.revisadas';
/** Ids ya avisados por SMS: `{ [id]: ISO }`. Separado de «revisadas»: que
 *  ya se avisara no quiere decir que alguien lo haya mirado. */
const CLAVE_AVISADAS = 'billing.alertasSuscripcion.avisadas';
/** Candado del resumen diario: el día local de la última pasada. */
const CLAVE_ULTIMO_RESUMEN = 'billing.alertasSuscripcion.ultimoResumen';

const ZONA = 'America/Bogota';
/** 9:00-11:59 de Bogotá: hay alguien para actuar y no es de madrugada. Una
 *  ventana y no una hora exacta: si justo a esa hora cae un despliegue, el
 *  tick siguiente lo recoge. */
const DESDE_HORA = 9;
const HASTA_HORA = 12;
/** Los ids avisados que ya no aparecen se olvidan pasado este tiempo, para que el JSON
 *  del Setting no crezca para siempre. */
const OLVIDAR_TRAS_DIAS = 120;

const ENLACE_DEL_PANEL = 'https://app.soyclubify.com/admin';

/**
 * Las alertas de suscripciones de Hotmart (ver `alertas-de-suscripcion.ts`):
 * las lista para el panel, guarda cuáles se revisaron y avisa al equipo una vez
 * al día de las NUEVAS.
 *
 * Sin esquema nuevo: lo revisado y lo avisado viven en `Setting` como JSON.
 */
@Injectable()
export class AlertasDeSuscripcionService {
  private readonly logger = new Logger(AlertasDeSuscripcionService.name);

  constructor(
    private prisma: PrismaService,
    private alerts: PreregAlertsService,
  ) {}

  /** Todas las alertas de hoy, sin mirar lo revisado. */
  async detectar(ahora: Date = new Date()): Promise<AlertaDeSuscripcion[]> {
    // Sin el filtro de negocio: `HotmartWebhookEvent` tiene `tenantId` y el
    // middleware lo filtraría, y lo que buscamos son justo los avisos SIN
    // negocio. El `await` va DENTRO: Prisma es perezoso y la promesa devuelta
    // sin esperar se ejecutaría fuera del contexto.
    return TenantContext.runWithoutTenant(async () => {
      const desde = new Date(ahora.getTime() - DIAS_DE_VENTANA * 86_400_000);
      const [eventos, negocios, duenos, creditos, planes, grupos, pendientes] =
        await Promise.all([
          this.prisma.hotmartWebhookEvent.findMany({
            where: { processedAt: { gte: desde }, eventType: { in: EVENTOS_QUE_MIRA } },
            select: { eventType: true, tenantId: true, processedAt: true, payload: true },
          }),
          this.prisma.tenant.findMany({
            select: {
              id: true,
              brandName: true,
              email: true,
              phone: true,
              whatsappPhone: true,
              hotmartSubscriberCode: true,
              deletedAt: true,
            },
          }),
          this.prisma.user.findMany({
            where: { role: 'TENANT_OWNER', tenantId: { not: null } },
            select: { email: true, tenantId: true },
          }),
          this.prisma.hotmartCreditLink.findMany({
            where: { hotmartProductId: { not: null } },
            select: { hotmartProductId: true },
          }),
          this.prisma.membershipPlan.findMany({
            where: { hotmartProductId: { not: null } },
            select: { hotmartProductId: true },
          }),
          this.prisma.businessGroup.findMany({
            where: { hotmartSubscriberCode: { not: null } },
            select: { hotmartSubscriberCode: true },
          }),
          this.prisma.pendingHotmartPayment.findMany({
            where: { consumedAt: null, subscriberCode: { not: null } },
            select: { subscriberCode: true },
          }),
        ]);

      const correosPorNegocio = new Map<string, string[]>();
      for (const u of duenos) {
        if (!u.tenantId) continue;
        correosPorNegocio.set(u.tenantId, [...(correosPorNegocio.get(u.tenantId) ?? []), u.email]);
      }
      const productosDelEntorno = Object.entries(process.env)
        .filter(([k, v]) => k.startsWith('HOTMART_PRODUCT_ID') && !!v)
        .map(([, v]) => String(v));

      return detectarAlertasDeSuscripcion({
        eventos,
        negocios: negocios.map((n) => ({ ...n, correosDeDuenos: correosPorNegocio.get(n.id) ?? [] })),
        ahora,
        productosAjenos: [...creditos, ...planes]
          .map((p) => p.hotmartProductId)
          .filter((x): x is string => !!x),
        productosDeNegocio: productosDelEntorno,
        codigosDeGrupos: grupos.map((g) => g.hotmartSubscriberCode).filter((x): x is string => !!x),
        codigosPendientesDeActivar: pendientes
          .map((p) => p.subscriberCode)
          .filter((x): x is string => !!x),
      });
    });
  }

  /** Lo que pinta el panel: las pendientes y, aparte, las ya revisadas. */
  async listar() {
    const [alertas, revisadas] = await Promise.all([
      this.detectar(),
      this.leerMapa(CLAVE_REVISADAS),
    ]);
    return {
      ventanaDias: DIAS_DE_VENTANA,
      pendientes: alertas.filter((a) => !revisadas[a.id]),
      revisadas: alertas
        .filter((a) => revisadas[a.id])
        .map((a) => ({ ...a, revisadaEl: revisadas[a.id] })),
    };
  }

  async marcarRevisada(id: string, revisada: boolean) {
    // Leer-modificar-escribir sin candado: es un panel de pocas personas y lo
    // peor que pasa si dos marcan a la vez es que una alerta vuelva a salir.
    const mapa = await this.leerMapa(CLAVE_REVISADAS);
    if (revisada) mapa[id] = new Date().toISOString();
    else delete mapa[id];
    await this.guardarMapa(CLAVE_REVISADAS, mapa);
    return { ok: true, id, revisada };
  }

  /**
   * El resumen diario por SMS al equipo, solo con lo NUEVO.
   *
   * El servidor va en UTC: por eso corre cada hora y decide con la hora de
   * Bogotá, y el día se reclama en la BASE con un UPDATE condicional (durante
   * un despliegue hay dos procesos con el cron armado, y en memoria los dos
   * creerían ser el primero). Como el cron es nuevo, no hay uno viejo con el
   * que duplicarse al desplegar.
   */
  @Cron('25 * * * *', { name: 'billing.alertas-de-suscripcion' })
  async tick(): Promise<void> {
    await this.resumenDiario(new Date()).catch((e) =>
      this.logger.warn(`Alertas de suscripción: ${(e as Error).message}`),
    );
  }

  async resumenDiario(ahora: Date): Promise<number> {
    const hora = horaLocal(ahora, ZONA);
    if (hora < DESDE_HORA || hora >= HASTA_HORA) return 0;
    if (!(await this.reclamarElDia(fechaLocal(ahora, ZONA)))) return 0;

    const [alertas, revisadas, avisadas] = await Promise.all([
      this.detectar(ahora),
      this.leerMapa(CLAVE_REVISADAS),
      this.leerMapa(CLAVE_AVISADAS),
    ]);
    const nuevas = alertasNuevas(alertas, [...Object.keys(revisadas), ...Object.keys(avisadas)]);
    if (!nuevas.length) return 0;

    // Tipo `pago_sin_cuenta`: es el aviso de «Avisos al equipo» que ya recibe
    // quien sigue el dinero que entra sin negocio, y una suscripción huérfana
    // es exactamente eso. Un tipo propio obligaría a tocar `auth/` y la
    // pantalla de Avisos, que hoy tienen trabajo sin subir de otra máquina.
    const r = await this.alerts.sendTeamAlert(
      textoDelResumen(nuevas, ENLACE_DEL_PANEL),
      'pago_sin_cuenta',
    );
    if (!r.ok) {
      // No se apuntan como avisadas: mañana se reintenta. Siguen en el panel.
      this.logger.warn(`Resumen de suscripciones no salió (${r.sent}/${r.total}).`);
      return 0;
    }
    const sello = ahora.toISOString();
    for (const a of nuevas) avisadas[a.id] = sello;
    await this.guardarMapa(
      CLAVE_AVISADAS,
      this.podar(avisadas, ahora, new Set(alertas.map((a) => a.id))),
    );
    this.logger.log(`Resumen de suscripciones avisado: ${nuevas.length} nueva(s).`);
    return nuevas.length;
  }

  /** Igual que `BillingService.reclamarElDia`: el upsert crea la fila (el
   *  `updateMany` no crea) y `count` decide quién se lleva el día. */
  private async reclamarElDia(dia: string): Promise<boolean> {
    await this.prisma.setting
      .upsert({
        where: { key: CLAVE_ULTIMO_RESUMEN },
        update: {},
        create: { key: CLAVE_ULTIMO_RESUMEN, value: '' },
      })
      .catch(() => null);
    const claim = await this.prisma.setting.updateMany({
      where: { key: CLAVE_ULTIMO_RESUMEN, value: { not: dia } },
      data: { value: dia },
    });
    return claim.count === 1;
  }

  /** Solo se olvida lo que YA no aparece: una alerta viva de hace meses
   *  olvidada volvería a avisarse como nueva. */
  private podar(
    mapa: Record<string, string>,
    ahora: Date,
    vivas: Set<string>,
  ): Record<string, string> {
    const limite = ahora.getTime() - OLVIDAR_TRAS_DIAS * 86_400_000;
    return Object.fromEntries(
      Object.entries(mapa).filter(
        ([id, iso]) => vivas.has(id) || new Date(iso).getTime() >= limite,
      ),
    );
  }

  private async leerMapa(clave: string): Promise<Record<string, string>> {
    const row = await this.prisma.setting.findUnique({ where: { key: clave } }).catch(() => null);
    try {
      const v = JSON.parse(row?.value ?? '{}');
      return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, string>) : {};
    } catch {
      // Mal formado: se empieza de cero. Lo peor es que se vuelva a avisar.
      return {};
    }
  }

  private async guardarMapa(clave: string, mapa: Record<string, string>) {
    const value = JSON.stringify(mapa);
    await this.prisma.setting.upsert({
      where: { key: clave },
      update: { value },
      create: { key: clave, value },
    });
  }
}
