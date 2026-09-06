import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../common/prisma/prisma.service';
import { PreregAlertsService } from '../auth/prereg-alerts.service';

/** Un problema encontrado. `detalle` es lo que se pega en el aviso. */
type Hallazgo = {
  titulo: string;
  cuantos: number;
  detalle: string;
  /** Qué hacer. Sin esto, un aviso solo genera preguntas. */
  queHacer: string;
};

/**
 * El vigilante: revisa cada día lo que se rompe en silencio.
 *
 * Nace de un día entero (2026-09-06) en el que TODO lo que encontramos lo
 * encontramos porque un cliente escribió:
 *
 *  · las copias de seguridad llevaban DOS MESES fallando cada noche, y el aviso
 *    de fallo tampoco salía porque su Sentry estaba sin configurar;
 *  · un negocio estaba en mora real en Hotmart y aquí figuraba al día, porque
 *    un gate le borró la marca del fallo;
 *  · diecinueve negocios con la fecha de cobro distinta de la de Hotmart;
 *  · pedidos que entraban sin que al negocio le llegara nada.
 *
 * Ninguna de esas cosas da error en ningún sitio. No hay excepción, no hay 500,
 * no hay nada en los logs: simplemente el número está mal y nadie mira.
 *
 * Por eso esto NO busca errores. Busca INCOHERENCIAS: dos sitios que deberían
 * decir lo mismo y no lo dicen. Es la única forma de cazar un fallo silencioso.
 *
 * Reglas que lo mantienen útil y no wallpaper:
 *  · UN mensaje al día con todo junto, no uno por hallazgo.
 *  · Si no hay nada, NO se manda nada. El silencio significa que está bien.
 *  · Cada hallazgo dice QUÉ HACER, no solo qué pasa.
 */
@Injectable()
export class VigilanteService {
  private logger = new Logger(VigilanteService.name);

  constructor(
    private prisma: PrismaService,
    private alerts: PreregAlertsService,
  ) {}

  /** 13:00 UTC = 8 de la mañana en Bogotá. A esa hora hay alguien para actuar. */
  @Cron('0 13 * * *', { name: 'vigilancia.diaria' })
  async revisionDiaria() {
    try {
      const hallazgos = (
        await Promise.all([
          this.moraQueNadieVio(),
          this.fechasQueNoCuadranConHotmart(),
          this.pedidosSinAvisar(),
          this.negociosSinTelefono(),
        ])
      ).filter((h): h is Hallazgo => h !== null);

      if (!hallazgos.length) {
        this.logger.log('Vigilancia: todo en orden.');
        return;
      }

      const cuerpo = [
        `Clubify - revision diaria: ${hallazgos.length} cosa(s) que mirar.`,
        '',
        ...hallazgos.map((h) => `${h.titulo} (${h.cuantos}): ${h.detalle} -> ${h.queHacer}`),
      ].join('\n');

      this.logger.warn(`Vigilancia:\n${cuerpo}`);
      for (const tel of await this.telefonosDelEquipo()) {
        await this.alerts.sendInternalAlert(tel, cuerpo).catch(() => null);
      }
    } catch (e) {
      this.logger.error(`la vigilancia falló: ${(e as Error).message}`);
    }
  }

  /**
   * Un cobro que falló en Hotmart y aquí no está marcado.
   *
   * Es el caso MYKOZ: Hotmart mandó `PURCHASE_DELAYED`, se marcó el fallo, y
   * después un gate lo borró porque nuestra fecha de cobro estaba en el futuro.
   * Resultado: en mora en Hotmart, al día en Clubify, y nadie enterado. Ese
   * negocio no recibe ni un solo aviso de la secuencia de cobro.
   */
  private async moraQueNadieVio(): Promise<Hallazgo | null> {
    const desde = new Date(Date.now() - 30 * 86400000);
    const fallos = await this.prisma.hotmartWebhookEvent.findMany({
      where: {
        eventType: { in: ['PURCHASE_DELAYED', 'PURCHASE_PROTEST'] },
        processedAt: { gte: desde },
        tenantId: { not: null },
      },
      select: { tenantId: true, processedAt: true },
      orderBy: { processedAt: 'desc' },
    });
    if (!fallos.length) return null;

    // El más reciente por negocio.
    const ultimoFallo = new Map<string, Date>();
    for (const f of fallos) {
      if (!ultimoFallo.has(f.tenantId!)) ultimoFallo.set(f.tenantId!, f.processedAt);
    }

    const sospechosos = await this.prisma.tenant.findMany({
      where: {
        id: { in: [...ultimoFallo.keys()] },
        status: 'ACTIVE',
        failedPaymentCount: 0,
      },
      select: { id: true, name: true, lastChargeAt: true },
    });

    // Si pagó DESPUÉS del fallo, está resuelto de verdad: no es un hallazgo.
    const rotos = sospechosos.filter((t) => {
      const fallo = ultimoFallo.get(t.id)!;
      return !t.lastChargeAt || t.lastChargeAt < fallo;
    });
    if (!rotos.length) return null;

    return {
      titulo: 'Mora invisible',
      cuantos: rotos.length,
      detalle: rotos.map((t) => t.name).slice(0, 5).join(', '),
      queHacer: 'Hotmart dice que el cobro fallo y aqui figuran al dia: no reciben ningun aviso',
    };
  }

  /**
   * Nuestra fecha de cobro contra la última que mandó Hotmart.
   *
   * Si no coinciden, los avisos previos salen el día equivocado o no salen. Y
   * si el cobro real falla, el gate anti-mora-fantasma le borra el fallo.
   */
  private async fechasQueNoCuadranConHotmart(): Promise<Hallazgo | null> {
    const tenants = await this.prisma.tenant.findMany({
      where: {
        status: 'ACTIVE',
        hotmartSubscriberCode: { not: null },
        currentPeriodEnd: { not: null },
      },
      select: { id: true, name: true, currentPeriodEnd: true },
    });
    if (!tenants.length) return null;

    const eventos = await this.prisma.hotmartWebhookEvent.findMany({
      where: {
        tenantId: { in: tenants.map((t) => t.id) },
        eventType: { in: ['PURCHASE_APPROVED', 'PURCHASE_COMPLETE'] },
      },
      select: { tenantId: true, payload: true, processedAt: true },
      orderBy: { processedAt: 'desc' },
    });

    const fechaHotmart = new Map<string, Date>();
    for (const e of eventos) {
      if (fechaHotmart.has(e.tenantId!)) continue;
      const ms = (e.payload as any)?.data?.purchase?.date_next_charge;
      if (typeof ms === 'number') fechaHotmart.set(e.tenantId!, new Date(ms));
    }

    // Dos días de margen: las horas y los husos no tienen por qué cuadrar al
    // minuto, y avisar por eso seria ruido.
    const dia = 86400000;
    const desviados = tenants.filter((t) => {
      const hm = fechaHotmart.get(t.id);
      if (!hm || !t.currentPeriodEnd) return false;
      return Math.abs(hm.getTime() - t.currentPeriodEnd.getTime()) > 2 * dia;
    });
    if (!desviados.length) return null;

    return {
      titulo: 'Fecha de cobro distinta de Hotmart',
      cuantos: desviados.length,
      detalle: desviados.map((t) => t.name).slice(0, 5).join(', '),
      queHacer: 'Los avisos previos saldran en fecha equivocada',
    };
  }

  /**
   * Pedidos de ayer sin aviso al negocio.
   *
   * El aviso deja siempre su `Event`, salga o no. Que falte significa que ni
   * siquiera se intentó — y eso es un pedido que entró sin que nadie del
   * negocio se enterara.
   */
  private async pedidosSinAvisar(): Promise<Hallazgo | null> {
    const desde = new Date(Date.now() - 36 * 3600 * 1000);
    const pedidos = await this.prisma.order.findMany({
      where: { createdAt: { gte: desde } },
      select: { id: true, code: true, tenantId: true },
    });
    if (!pedidos.length) return null;

    const avisados = await this.prisma.event.findMany({
      where: {
        type: 'order.owner_alert_sent',
        createdAt: { gte: desde },
      },
      select: { payload: true },
    });
    const ids = new Set(
      avisados.map((e) => (e.payload as any)?.orderId).filter(Boolean),
    );
    const sinAviso = pedidos.filter((o) => !ids.has(o.id));
    // Menos del 10% se explica por negocios sin teléfono o sin credenciales.
    // Solo interesa si es masivo: eso ya es que algo se rompió.
    if (sinAviso.length < Math.max(3, pedidos.length * 0.1)) return null;

    return {
      titulo: 'Pedidos sin aviso al negocio',
      cuantos: sinAviso.length,
      detalle: `de ${pedidos.length} pedidos en 36h`,
      queHacer: 'Revisar el servicio de avisos: puede que no se este disparando',
    };
  }

  /** Un negocio sin teléfono no puede recibir NADA: ni pedidos ni cobros. */
  private async negociosSinTelefono(): Promise<Hallazgo | null> {
    const tenants = await this.prisma.tenant.findMany({
      where: {
        status: 'ACTIVE',
        phone: null,
        whatsappPhone: null,
        whatsappOrdersPhone: null,
      },
      select: { id: true, name: true },
    });
    if (!tenants.length) return null;

    // Si el dueño tiene móvil, el aviso igual llega: no es un hallazgo.
    const conDueno = await this.prisma.user.findMany({
      where: {
        tenantId: { in: tenants.map((t) => t.id) },
        role: 'TENANT_OWNER',
        isActive: true,
        phone: { not: null },
      },
      select: { tenantId: true },
    });
    const cubiertos = new Set(conDueno.map((u) => u.tenantId));
    const huerfanos = tenants.filter((t) => !cubiertos.has(t.id));
    if (!huerfanos.length) return null;

    return {
      titulo: 'Negocios sin ningun telefono',
      cuantos: huerfanos.length,
      detalle: huerfanos.map((t) => t.name).slice(0, 5).join(', '),
      queHacer: 'No pueden recibir avisos de pedidos ni de cobro',
    };
  }

  /** A quién se avisa. Reutiliza la lista del equipo, sin duplicar config. */
  private async telefonosDelEquipo(): Promise<string[]> {
    const s = await this.prisma.setting.findUnique({
      where: { key: 'prereg.alertPhones' },
    });
    try {
      const lista = JSON.parse(s?.value ?? '[]') as Array<{ phone?: string }>;
      const tel = lista.map((x) => x.phone).filter((x): x is string => !!x);
      if (tel.length) return tel;
    } catch {
      /* mal formado: se cae al de siempre */
    }
    return ['+573248088401'];
  }
}
