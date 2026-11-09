import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { IncomeRecordService } from '../finance/income-record.service';
import { ReferralsService } from '../referrals/referrals.service';
import { addPlanPeriod, normalizePlanPeriod } from '../common/plan-period';
import { mesContable } from '../common/periodo-contable';
import { marcaClubify } from '../finance/alcance-de-marca';
import { CONCEPTOS } from '../finance/ingresos-de-marcas';
import { precioDePackUsd } from './precio-de-pack';
import { nombreDelServicio } from './servicio-adicional-hotmart';

export type PendingGateway = 'HOTMART' | 'STRIPE' | 'CROSS';

/**
 * Asigna un "pago sin activar" (Pending*Payment) a un negocio que YA existe.
 *
 * Existe por el caso MOTILART (2026-08-22): el comprador paga con un correo
 * distinto al de su cuenta (paga el contador, el socio, la empresa) o el
 * identificador guardado no coincide (código de suscriptor truncado), y el
 * pago recurrente cae como «comprador sin cuenta». La alerta interna dice
 * «nueva compra», al cliente le llega «crea tu cuenta» en su tercer mes, y el
 * ciclo del negocio no avanza. Esto va a seguir pasando: no es un caso raro.
 *
 * Qué hace al asignar: deja al negocio COMO SI el pago se hubiera reconocido
 * bien — enlaza los identificadores de la pasarela (el próximo cobro se
 * reconoce como RENOVACIÓN), avanza el ciclo por la periodicidad real del
 * plan y limpia los avisos del ciclo viejo.
 *
 * Y deja el DINERO enlazado (Javier, 2026-10-02 — caso El Regio, pagó con
 * otro correo y quedó activo sin ingreso con nombre ni comisión): el ingreso
 * que el conciliador apuntó sin dueño pasa al negocio, y se genera la comisión
 * del cobro por el mismo camino que «Generar comisión ahora». Antes la
 * comisión quedaba fuera «por decisión de negocio aparte»; la decisión ya está
 * tomada: un pago confirmado lleva su comisión.
 *
 * Qué NO hace, a propósito:
 *  - No envía NINGÚN mensaje al cliente: ya recibió lo que tenía que recibir
 *    (o de más); una «bienvenida» aquí sería otro mensaje equivocado.
 *  - No activa con un pago VIEJO (Javier, 2026-11-09). Un pago se asigna
 *    como HISTORIAL —queda enlazado al negocio, con su dinero, sin tocar ni el
 *    estado ni las fechas ni el correo/código de la suscripción— cuando:
 *      · el ciclo que pagó ya terminó (DINOROLLS: se asignó el pago de su
 *        primera suscripción, de meses atrás, y el negocio que había decidido
 *        no renovar quedó activo), o
 *      · el negocio ya está cubierto más allá por renovaciones posteriores
 *        (RICURAS: el primer pago llegó con otro correo; sus renovaciones ya
 *        están aplicadas y siguen con el correo nuevo).
 *    Ver `modoDeLaAsignacion`.
 */
@Injectable()
export class PendingAssignmentService {
  private readonly logger = new Logger(PendingAssignmentService.name);

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private income: IncomeRecordService,
    private referrals: ReferralsService,
  ) {}

  /**
   * Buscador liviano de negocios para el modal de asignación. Busca por
   * marca, nombre, slug, correo del tenant Y correo del dueño (el caso que
   * origina todo es justamente que el correo del pago no es el de la cuenta,
   * así que el admin puede buscar por cualquiera de los dos).
   */
  /** `alcance`: WHERE de marca; cada marca busca solo entre sus negocios. */
  async searchTenants(q: string, alcance: Record<string, unknown> = {}) {
    const query = (q ?? '').trim();
    if (query.length < 2) return [];
    const contains = { contains: query, mode: 'insensitive' as const };
    const tenants = await this.prisma.tenant.findMany({
      where: {
        deletedAt: null,
        isCampaignHost: false,
        // En AND: el alcance de marca también es un OR y se pisarían.
        AND: [alcance],
        OR: [
          { brandName: contains },
          { name: contains },
          { slug: contains },
          { email: contains },
          { users: { some: { role: 'TENANT_OWNER', email: contains } } },
        ],
      },
      select: {
        id: true,
        brandName: true,
        name: true,
        slug: true,
        email: true,
        status: true,
        planPeriodicity: true,
        currentPeriodEnd: true,
        lastChargeAt: true,
        whiteLabel: { select: { slug: true, name: true } },
        users: {
          where: { role: 'TENANT_OWNER' },
          select: { email: true },
          take: 1,
        },
      },
      orderBy: { brandName: 'asc' },
      take: 20,
    });
    return tenants.map((t) => ({
      id: t.id,
      brandName: t.brandName,
      name: t.name,
      slug: t.slug,
      status: t.status,
      planPeriodicity: normalizePlanPeriod(t.planPeriodicity),
      currentPeriodEnd: t.currentPeriodEnd,
      lastChargeAt: t.lastChargeAt,
      whiteLabelName: t.whiteLabel?.name ?? null,
      // El correo "de la cuenta" es el del dueño (con el que se logea); el
      // del tenant es el de contacto. Para el contraste del modal manda el
      // del dueño y caemos al de contacto si no hay owner.
      email: t.users[0]?.email ?? t.email,
    }));
  }

  /** Vista previa: qué quedaría después de asignar, sin escribir nada. */
  async preview(gateway: PendingGateway, pendingId: string, tenantId: string) {
    const r = await this.resolve(gateway, pendingId, tenantId);
    return {
      gateway,
      paymentEmail: r.paymentEmail,
      /** Cuántos pagos sin consumir del mismo comprador se aplicarán juntos
       *  (MOTILART tenía TRES: jun, jul, ago — dejar dos sueltos seguiría
       *  disparando avisos de «comprador sin cuenta»). */
      paymentsToApply: r.pendingIds.length,
      paidAt: r.lastChargeAt.toISOString(),
      nextChargeAt: r.nextChargeAt.toISOString(),
      /** ACTIVA = el pago cubre hoy y mueve el ciclo; HISTORICO = solo se
       *  registra. El botón del panel dice una cosa u otra según esto. */
      modo: r.modo,
      motivo: r.motivo,
      tenant: {
        id: r.tenant.id,
        brandName: r.tenant.brandName,
        name: r.tenant.name,
        email: r.tenantEmail,
        status: r.tenant.status,
        planPeriodicity: normalizePlanPeriod(r.tenant.planPeriodicity),
        currentPeriodEnd: r.tenant.currentPeriodEnd,
      },
      emailsDiffer:
        r.paymentEmail.toLowerCase() !== r.tenantEmail.toLowerCase(),
      brandMismatch: r.brandMismatch,
    };
  }

  /**
   * Asigna el pago pendiente al negocio. Todo lo que escribe va en UNA
   * transacción: o el negocio queda entero (identificadores + ciclo + avisos
   * limpios + pendientes consumidos) o no queda nada a medias.
   */
  async assign(args: {
    gateway: PendingGateway;
    pendingId: string;
    tenantId: string;
    actorId: string | null;
  }) {
    const { gateway, pendingId, tenantId, actorId } = args;
    const r = await this.resolve(gateway, pendingId, tenantId);
    const now = new Date();

    // Snapshot ANTES de escribir: esto mueve dinero y fechas de cobro, el
    // audit log tiene que permitir reconstruir qué había.
    const before = {
      status: r.tenant.status,
      currentPeriodEnd: r.tenant.currentPeriodEnd,
      lastChargeAt: r.tenant.lastChargeAt,
      hotmartSubscriberCode: r.tenant.hotmartSubscriberCode,
      hotmartTransactionId: r.tenant.hotmartTransactionId,
      stripeCustomerId: r.tenant.stripeCustomerId,
      stripeSubscriptionId: r.tenant.stripeSubscriptionId,
    };

    await this.prisma.$transaction(async (tx) => {
      // Consumir primero y con guarda de carrera: si otro proceso (el signup
      // de /activar, o dos admins a la vez) ya consumió el pago elegido,
      // abortamos ANTES de tocar el negocio.
      const pendingDelegate =
        gateway === 'HOTMART'
          ? tx.pendingHotmartPayment
          : gateway === 'STRIPE'
            ? tx.pendingStripePayment
            : tx.pendingCrossPayment;
      const consumed = await (pendingDelegate as any).updateMany({
        where: { id: { in: r.pendingIds }, consumedAt: null },
        data: { consumedAt: now },
      });
      if (consumed.count === 0) {
        throw new BadRequestException(
          'Este pago ya fue aplicado por otro proceso. Actualiza la lista.',
        );
      }

      // Un pago histórico no toca el negocio: ni estado, ni fechas, ni el
      // correo/código con el que sigue renovando. Solo queda consumido (sale
      // de la lista y deja de mandar recordatorios) y, más abajo, su dinero.
      if (r.modo === 'ACTIVA') await tx.tenant.update({
        where: { id: r.tenant.id },
        data: {
          // Identificadores de la pasarela: son los que hacen que el
          // PRÓXIMO cobro del webhook matchee como RENOVACIÓN y no vuelva
          // a caer en «comprador sin cuenta».
          ...r.identifiers,
          status: 'ACTIVE',
          failedPaymentCount: 0,
          lastChargeAt: r.lastChargeAt,
          currentPeriodEnd: r.nextChargeAt,
          // Limpiar los avisos del ciclo viejo. Sin esto el negocio NO
          // recibe ningún recordatorio del ciclo siguiente (los crons
          // comparan estas marcas contra currentPeriodEnd y creen que ya
          // avisaron) — es el fallo mudo más probable de esta función.
          preReminder7dSentFor: null,
          preReminder3dSentFor: null,
          preReminderTodaySentFor: null,
          paymentReminderSentFor: null,
          paymentFailureNoticeSentAt: null,
          pausePendingNoticeSentAt: null,
        },
      });

      // Cross no guarda identificador de suscripción en Tenant: las
      // renovaciones se resuelven por CrossTransaction.tenantId o por el
      // email del dueño. Enlazar la transacción es lo único persistible.
      if (r.modo === 'ACTIVA' && gateway === 'CROSS' && r.crossProviderRef) {
        await tx.crossTransaction.updateMany({
          where: { providerRef: r.crossProviderRef },
          data: { tenantId: r.tenant.id },
        });
      }
    });

    // Fuera de la transacción: AuditService es best-effort y no debe poder
    // revertir una asignación que ya se aplicó.
    await this.audit.log({
      actorId,
      tenantId: r.tenant.id,
      action: 'pending_payment.assigned_to_tenant',
      resource: `pending_${gateway.toLowerCase()}_payment:${pendingId}`,
      metadata: {
        gateway,
        pendingIds: r.pendingIds,
        paymentEmail: r.paymentEmail,
        tenantEmail: r.tenantEmail,
        modo: r.modo,
        motivo: r.motivo,
        pagoCubreHasta: r.nextChargeAt,
        before,
        after:
          r.modo === 'ACTIVA'
            ? {
                status: 'ACTIVE',
                lastChargeAt: r.lastChargeAt,
                currentPeriodEnd: r.nextChargeAt,
                ...r.identifiers,
              }
            : before,
      },
    });
    this.logger.log(
      r.modo === 'ACTIVA'
        ? `Pago pendiente ${gateway}:${pendingId} asignado a ${r.tenant.brandName} ` +
            `(${r.tenant.id}); próximo cobro ${r.nextChargeAt.toISOString()}`
        : `Pago pendiente ${gateway}:${pendingId} registrado como HISTORIAL de ${r.tenant.brandName} ` +
            `(${r.tenant.id}, ${r.motivo}); el negocio no se toca`,
    );

    // El dinero, después de la transacción (un fallo aquí no deshace la
    // asignación, que ya es correcta) pero ESPERADO y contado en la respuesta:
    // quien asigna tiene que ver si quedó el ingreso y la comisión.
    const dinero = await this.enlazarElDinero(gateway, r, r.modo === 'ACTIVA').catch((e) => ({
      ingreso: 'error' as const,
      comision: `error: ${(e as Error).message}`,
    }));

    const activa = r.modo === 'ACTIVA';
    return {
      ok: true,
      ...dinero,
      modo: r.modo,
      motivo: r.motivo,
      tenantId: r.tenant.id,
      brandName: r.tenant.brandName,
      statusBefore: before.status,
      statusAfter: activa ? 'ACTIVE' : before.status,
      lastChargeAt: activa ? r.lastChargeAt : before.lastChargeAt,
      currentPeriodEnd: activa ? r.nextChargeAt : before.currentPeriodEnd,
      /** Hasta cuándo cubría el pago asignado (aunque sea historial). */
      pagoCubreHasta: r.nextChargeAt,
      consumedPendingIds: r.pendingIds,
      gateway,
    };
  }

  /**
   * Ingreso y comisión del pago recién asignado.
   *
   * Ingreso: el conciliador ya apuntó ese cobro SIN dueño (llegó sin negocio);
   * `record` con el negocio lo adopta. Si no hay fila todavía, la crea el
   * conciliador esta noche: el negocio ya tiene los identificadores con los
   * que reconocerlo.
   */
  private async enlazarElDinero(
    gateway: PendingGateway,
    r: { tenant: { id: string; brandName: string }; identifiers: Record<string, string>; lastChargeAt: Date },
    conComision: boolean,
  ): Promise<{ ingreso: 'enlazado' | 'pendiente-del-conciliador' | 'no-aplica'; comision: string }> {
    let ingreso: 'enlazado' | 'pendiente-del-conciliador' | 'no-aplica' = 'no-aplica';
    const tx = gateway === 'HOTMART' ? r.identifiers.hotmartTransactionId : undefined;
    if (tx) {
      const fila = await this.prisma.incomeRecord.findUnique({
        where: { gateway_externalTxId: { gateway: 'HOTMART', externalTxId: tx } },
        select: { grossUsd: true },
      });
      if (fila) {
        await this.income.record({
          gateway: 'HOTMART',
          externalTxId: tx,
          tenantId: r.tenant.id,
          brandName: r.tenant.brandName,
          subscriberCode: r.identifiers.hotmartSubscriberCode ?? null,
          grossUsd: Number(fila.grossUsd),
          saleDate: r.lastChargeAt,
        });
        ingreso = 'enlazado';
      } else {
        ingreso = 'pendiente-del-conciliador';
      }
    }
    // La comisión que genera esto es la del ciclo ACTUAL del negocio (la fecha
    // sale de `Tenant.lastChargeAt`). Con un pago histórico el negocio no se
    // movió: crearla sería pagar un ciclo que no es el de este pago.
    if (!conComision) {
      return { ingreso, comision: 'no se genera: es un pago de un ciclo pasado' };
    }
    const c = await this.referrals
      .backfillCommissionForCurrentAssignment(r.tenant.id, false)
      .catch((e) => ({ creadas: 0, motivo: (e as Error).message }));
    const creadas = (c as { creadas?: number }).creadas ?? 0;
    return {
      ingreso,
      comision: creadas > 0 ? `creada (${creadas})` : ((c as { motivo?: string }).motivo ?? 'sin comisión'),
    };
  }

  // ── Pagos que no son de un negocio ────────────────────────────────────────

  /** Marcas blancas a las que se puede asignar un pago (todas menos Clubify). */
  async marcasBlancas() {
    const clubify = await marcaClubify(this.prisma);
    return this.prisma.whiteLabel.findMany({
      where: clubify ? { id: { not: clubify } } : {},
      select: { id: true, name: true, slug: true },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Asigna un pago de Hotmart a una MARCA BLANCA (Javier, 2026-11-09): lo que
   * paga Humberto (info@medicenache.com, admin de Sellea) no es la compra de
   * un negocio, es Sellea pagándole a la plataforma —la automatización de
   * WhatsApp, créditos—. Caía en «sin activar» y no había a dónde llevarlo.
   *
   * Entra al libro como lo registra «Marcas blancas → Registrar pago»: ingreso
   * con `payerWhiteLabelId` = la marca, y un SERVICIO queda INTERMEDIADO (pasa
   * por Clubify, no es suyo). Si el conciliador ya había apuntado esa
   * transacción sin dueño, se le pone la marca en vez de duplicarla. No toca
   * ningún negocio. Se aplican todos los pendientes del mismo correo.
   */
  async assignToBrand(args: {
    pendingId: string;
    whiteLabelId: string;
    concepto: 'SERVICIO' | 'CREDITOS' | 'OTRO';
    actorId: string | null;
  }) {
    const chosen = await this.prisma.pendingHotmartPayment.findUnique({
      where: { id: args.pendingId },
    });
    if (!chosen) throw new NotFoundException('Pago pendiente no encontrado');
    if (chosen.consumedAt) throw new BadRequestException('Este pago ya fue aplicado.');
    const marcas = await this.marcasBlancas();
    const marca = marcas.find((m) => m.id === args.whiteLabelId);
    if (!marca) throw new BadRequestException('Elige la marca blanca que pagó.');
    const clubify = await marcaClubify(this.prisma);

    const filas = await this.prisma.pendingHotmartPayment.findMany({
      where: { consumedAt: null, email: chosen.email },
      orderBy: { createdAt: 'asc' },
    });
    const now = new Date();
    const consumed = await this.prisma.pendingHotmartPayment.updateMany({
      where: { id: { in: filas.map((f) => f.id) }, consumedAt: null },
      data: { consumedAt: now },
    });
    if (consumed.count === 0) {
      throw new BadRequestException('Este pago ya fue aplicado por otro proceso. Actualiza la lista.');
    }

    let enLibro = 0;
    let totalUsd = 0;
    const sinImporte: string[] = [];
    for (const f of filas) {
      const raw = (f.rawPayload as any) ?? {};
      const compra = raw?.data?.purchase;
      const aprobado = compra?.approved_date;
      const fecha = typeof aprobado === 'number' ? new Date(aprobado) : f.createdAt;
      const productName =
        args.concepto === 'SERVICIO'
          ? `${CONCEPTOS.SERVICIO}: ${nombreDelServicio(raw)}`
          : CONCEPTOS[args.concepto];
      // Un servicio pasa por Clubify pero no es suyo: fuera de todo total.
      const status = args.concepto === 'SERVICIO' ? 'INTERMEDIADO' : 'PAGADO';
      const datosDeMarca = {
        tenantId: null,
        whiteLabelId: clubify,
        payerWhiteLabelId: marca.id,
        brandName: `${marca.name} (marca blanca)`,
        productName,
        category: 'MARCA_BLANCA',
      };
      const tx = f.transactionId;
      const existente = tx
        ? await this.prisma.incomeRecord.findUnique({
            where: { gateway_externalTxId: { gateway: 'HOTMART', externalTxId: tx } },
            select: { id: true, tenantId: true, status: true, grossUsd: true },
          })
        : null;
      if (existente) {
        // Si ya es de un negocio, no es de la marca: no se le quita.
        if (!existente.tenantId) {
          await this.prisma.incomeRecord.update({
            where: { id: existente.id },
            data: {
              ...datosDeMarca,
              // Solo se mueve lo que contaba como ingreso; un reembolso se queda.
              ...(existente.status === 'PAGADO' ? { status } : {}),
            },
          });
          enLibro++;
          totalUsd += Number(existente.grossUsd);
        }
        continue;
      }
      const precio = precioDePackUsd(compra, null);
      if (!tx || precio.usd == null) {
        sinImporte.push(f.transactionId ?? f.id);
        continue;
      }
      const { fee, tax, netExpected } = await this.income.desglose('HOTMART', precio.usd);
      await this.prisma.incomeRecord.create({
        data: {
          gateway: 'HOTMART',
          externalTxId: tx,
          ...datosDeMarca,
          currency: 'USD',
          grossUsd: precio.usd,
          gatewayFeeUsd: fee,
          taxUsd: tax,
          otherDiscountUsd: 0,
          netExpectedUsd: netExpected,
          status,
          periodKey: mesContable(fecha),
          saleDate: fecha,
          reconStatus: 'PENDING',
          note: 'Pago sin activar asignado a la marca blanca desde «Pagos sin activar».',
        },
      });
      enLibro++;
      totalUsd += precio.usd;
    }

    await this.audit.log({
      actorId: args.actorId,
      tenantId: null,
      action: 'pending_payment.assigned_to_brand',
      resource: `pending_hotmart_payment:${args.pendingId}`,
      metadata: {
        whiteLabelId: marca.id,
        marca: marca.name,
        concepto: args.concepto,
        email: chosen.email,
        pendingIds: filas.map((f) => f.id),
        enLibro,
        sinImporte,
      },
    });
    return {
      ok: true,
      marca: marca.name,
      pagos: filas.length,
      enLibro,
      totalUsd: Math.round(totalUsd * 100) / 100,
      intermediado: args.concepto === 'SERVICIO',
      sinImporte,
    };
  }

  /**
   * Quita un pago de la lista sin asignarlo a nadie. Existe por los
   * REEMBOLSOS (Angelica Barrantes, 2026-11-09): Hotmart devolvió el dinero y
   * el pago seguía ahí —y, peor, si creaba la cuenta, /activar la habría
   * activado con un pago devuelto—. Queda consumido y auditado con el motivo;
   * solo esa fila, no las demás del comprador.
   */
  async discard(args: {
    gateway: PendingGateway;
    pendingId: string;
    motivo: 'REEMBOLSO' | 'DUPLICADO' | 'OTRO';
    actorId: string | null;
  }) {
    const delegate =
      args.gateway === 'HOTMART'
        ? this.prisma.pendingHotmartPayment
        : args.gateway === 'STRIPE'
          ? this.prisma.pendingStripePayment
          : this.prisma.pendingCrossPayment;
    const r = await (delegate as any).updateMany({
      where: { id: args.pendingId, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (r.count === 0) throw new BadRequestException('Este pago ya no está en la lista.');
    if (args.gateway === 'HOTMART' && args.motivo === 'REEMBOLSO') {
      const fila = await this.prisma.pendingHotmartPayment.findUnique({
        where: { id: args.pendingId },
        select: { transactionId: true },
      });
      // Si el conciliador lo apuntó como ingreso, deja de contar.
      if (fila?.transactionId) {
        await this.income
          .marcarDevuelto('HOTMART', fila.transactionId, 'REEMBOLSADO', new Date())
          .catch(() => false);
      }
    }
    await this.audit.log({
      actorId: args.actorId,
      tenantId: null,
      action: 'pending_payment.discarded',
      resource: `pending_${args.gateway.toLowerCase()}_payment:${args.pendingId}`,
      metadata: { motivo: args.motivo },
    });
    return { ok: true };
  }

  // ── Resolución compartida (preview y assign calculan EXACTAMENTE igual) ──

  private async resolve(
    gateway: PendingGateway,
    pendingId: string,
    tenantId: string,
  ) {
    const tenant = await this.prisma.tenant.findFirst({
      where: { id: tenantId, deletedAt: null },
      select: {
        id: true,
        brandName: true,
        name: true,
        email: true,
        status: true,
        planPeriodicity: true,
        currentPeriodEnd: true,
        lastChargeAt: true,
        whiteLabelId: true,
        hotmartSubscriberCode: true,
        hotmartTransactionId: true,
        stripeCustomerId: true,
        stripeSubscriptionId: true,
        users: {
          where: { role: 'TENANT_OWNER' },
          select: { email: true },
          take: 1,
        },
      },
    });
    if (!tenant) throw new NotFoundException('Negocio no encontrado');

    if (gateway === 'HOTMART') return this.resolveHotmart(pendingId, tenant);
    if (gateway === 'STRIPE') return this.resolveStripe(pendingId, tenant);
    return this.resolveCross(pendingId, tenant);
  }

  private async resolveHotmart(pendingId: string, tenant: TenantSnapshot) {
    const chosen = await this.prisma.pendingHotmartPayment.findUnique({
      where: { id: pendingId },
    });
    if (!chosen) throw new NotFoundException('Pago pendiente no encontrado');
    if (chosen.consumedAt) {
      throw new BadRequestException('Este pago ya fue aplicado.');
    }
    // Todos los pendientes del MISMO comprador (mismo código de suscriptor o
    // mismo correo): MOTILART acumuló tres meses de pagos sin aplicar; si
    // solo se consumiera la fila elegida, las otras seguirían generando
    // avisos de «comprador sin cuenta» y recordatorios al equipo.
    const siblings = await this.prisma.pendingHotmartPayment.findMany({
      where: {
        consumedAt: null,
        OR: [
          { email: chosen.email },
          ...(chosen.subscriberCode
            ? [{ subscriberCode: chosen.subscriberCode }]
            : []),
        ],
      },
      orderBy: { createdAt: 'asc' },
    });
    const paidAtOf = (p: (typeof siblings)[number]) => {
      const approved = (p.rawPayload as any)?.data?.purchase?.approved_date;
      return typeof approved === 'number' ? new Date(approved) : p.createdAt;
    };
    const newest = siblings.reduce((a, b) =>
      paidAtOf(b) > paidAtOf(a) ? b : a,
    );
    const lastChargeAt = paidAtOf(newest);
    // El código puede venir null en algún evento: usar el primero que exista
    // y NUNCA pisar el guardado con null.
    const subscriberCode =
      newest.subscriberCode ??
      siblings.find((s) => s.subscriberCode)?.subscriberCode ??
      undefined;
    return this.buildResolution({
      tenant,
      paymentEmail: chosen.email,
      pendingIds: siblings.map((s) => s.id),
      lastChargeAt,
      identifiers: {
        ...(subscriberCode ? { hotmartSubscriberCode: subscriberCode } : {}),
        ...(newest.transactionId
          ? { hotmartTransactionId: newest.transactionId }
          : {}),
      },
      brandMismatch: false,
    });
  }

  private async resolveStripe(pendingId: string, tenant: TenantSnapshot) {
    const chosen = await this.prisma.pendingStripePayment.findUnique({
      where: { id: pendingId },
    });
    if (!chosen) throw new NotFoundException('Pago pendiente no encontrado');
    if (chosen.consumedAt) {
      throw new BadRequestException('Este pago ya fue aplicado.');
    }
    const siblings = await this.prisma.pendingStripePayment.findMany({
      where: {
        consumedAt: null,
        OR: [
          { email: chosen.email },
          ...(chosen.stripeSubscriptionId
            ? [{ stripeSubscriptionId: chosen.stripeSubscriptionId }]
            : []),
        ],
      },
      orderBy: { createdAt: 'asc' },
    });
    const paidAtOf = (p: (typeof siblings)[number]) => {
      const created = (p.rawPayload as any)?.created;
      return typeof created === 'number' ? new Date(created * 1000) : p.createdAt;
    };
    const newest = siblings.reduce((a, b) =>
      paidAtOf(b) > paidAtOf(a) ? b : a,
    );
    const stripeCustomerId =
      newest.stripeCustomerId ??
      siblings.find((s) => s.stripeCustomerId)?.stripeCustomerId ??
      undefined;
    const stripeSubscriptionId =
      newest.stripeSubscriptionId ??
      siblings.find((s) => s.stripeSubscriptionId)?.stripeSubscriptionId ??
      undefined;
    return this.buildResolution({
      tenant,
      paymentEmail: chosen.email,
      pendingIds: siblings.map((s) => s.id),
      lastChargeAt: paidAtOf(newest),
      identifiers: {
        ...(stripeCustomerId ? { stripeCustomerId } : {}),
        ...(stripeSubscriptionId ? { stripeSubscriptionId } : {}),
      },
      brandMismatch:
        !!chosen.whiteLabelId &&
        !!tenant.whiteLabelId &&
        chosen.whiteLabelId !== tenant.whiteLabelId,
    });
  }

  private async resolveCross(pendingId: string, tenant: TenantSnapshot) {
    const chosen = await this.prisma.pendingCrossPayment.findUnique({
      where: { id: pendingId },
    });
    if (!chosen) throw new NotFoundException('Pago pendiente no encontrado');
    if (chosen.consumedAt) {
      throw new BadRequestException('Este pago ya fue aplicado.');
    }
    // Cross no tiene identificador de suscripción: agrupar por correo dentro
    // de la misma marca (las tablas Cross están aisladas por whiteLabelId).
    const siblings = await this.prisma.pendingCrossPayment.findMany({
      where: {
        consumedAt: null,
        email: chosen.email,
        whiteLabelId: chosen.whiteLabelId,
      },
      orderBy: { createdAt: 'asc' },
    });
    const newest = siblings.reduce((a, b) =>
      b.createdAt > a.createdAt ? b : a,
    );
    return this.buildResolution({
      tenant,
      paymentEmail: chosen.email,
      pendingIds: siblings.map((s) => s.id),
      lastChargeAt: newest.createdAt,
      identifiers: {},
      crossProviderRef: newest.providerRef ?? null,
      brandMismatch:
        !!chosen.whiteLabelId &&
        !!tenant.whiteLabelId &&
        chosen.whiteLabelId !== tenant.whiteLabelId,
    });
  }

  private buildResolution(args: {
    tenant: TenantSnapshot;
    paymentEmail: string;
    pendingIds: string[];
    lastChargeAt: Date;
    identifiers: Record<string, string>;
    crossProviderRef?: string | null;
    brandMismatch: boolean;
  }) {
    const nextChargeAt = addPlanPeriod(args.lastChargeAt, args.tenant.planPeriodicity);
    const { modo, motivo } = modoDeLaAsignacion({
      pagoCubreHasta: nextChargeAt,
      negocioCubiertoHasta: args.tenant.currentPeriodEnd,
      ahora: new Date(),
    });
    return {
      modo,
      motivo,
      tenant: args.tenant,
      tenantEmail: args.tenant.users[0]?.email ?? args.tenant.email,
      paymentEmail: args.paymentEmail,
      pendingIds: args.pendingIds,
      lastChargeAt: args.lastChargeAt,
      // Periodicidad REAL del plan (1/3/6/12 meses de calendario, fin de mes
      // acotado) — jamás 30 días fijos: un anual con +30 se suspendería con
      // once meses ya pagados.
      nextChargeAt,
      identifiers: args.identifiers,
      crossProviderRef: args.crossProviderRef ?? null,
      brandMismatch: args.brandMismatch,
    };
  }
}

export type ModoDeAsignacion = 'ACTIVA' | 'HISTORICO';
export type MotivoDeAsignacion = 'cubre_hoy' | 'ciclo_vencido' | 'ya_cubierto_por_renovacion';

/**
 * ¿El pago asignado activa el negocio o solo queda como historial?
 *
 * Activa SOLO si el ciclo que pagó sigue corriendo hoy y llega más lejos que
 * lo que el negocio ya tiene cubierto. Cualquier otra cosa es un pago del
 * pasado: activarlo resucitó a DINOROLLS (no renovó, venció en octubre) y
 * habría retrasado el ciclo de RICURAS a la fecha de su primer pago.
 */
export function modoDeLaAsignacion(args: {
  pagoCubreHasta: Date;
  negocioCubiertoHasta: Date | null;
  ahora: Date;
}): { modo: ModoDeAsignacion; motivo: MotivoDeAsignacion } {
  if (
    args.negocioCubiertoHasta &&
    args.negocioCubiertoHasta.getTime() >= args.pagoCubreHasta.getTime()
  ) {
    return { modo: 'HISTORICO', motivo: 'ya_cubierto_por_renovacion' };
  }
  if (args.pagoCubreHasta.getTime() <= args.ahora.getTime()) {
    return { modo: 'HISTORICO', motivo: 'ciclo_vencido' };
  }
  return { modo: 'ACTIVA', motivo: 'cubre_hoy' };
}

type TenantSnapshot = {
  id: string;
  brandName: string;
  name: string;
  email: string;
  status: string;
  planPeriodicity: string | null;
  currentPeriodEnd: Date | null;
  lastChargeAt: Date | null;
  whiteLabelId: string | null;
  hotmartSubscriberCode: string | null;
  hotmartTransactionId: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  users: { email: string }[];
};
