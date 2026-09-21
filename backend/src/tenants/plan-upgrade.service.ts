import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { PaymentGateway } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ReferralsService } from '../referrals/referrals.service';
import { CommissionRecalcService } from '../referrals/commission-recalc.service';
import { CommissionExceptionsService } from '../admin/commission-exceptions.service';
import { IncomeRecordService } from '../finance/income-record.service';
import { COMMISSION_DEFAULTS } from '../common/commission-defaults';
import { DIAS_DE_HOLD } from '../referrals/rango-de-fechas';
import {
  addPlanPeriod,
  normalizePlanPeriod,
  parsePlanPeriodLabel,
} from '../common/plan-period';
import { resolveManualPaymentPeriod } from '../common/manual-payment-period';
import { mesContable } from '../common/periodo-contable';
import { invalidateTenantStatusCache } from '../common/guards/tenant-status.guard';
import { esDeMontoLibre } from '../referrals/comisiones-de-monto-libre';
import {
  filasDeComisionDelUpgrade,
  periodKeyDelUpgrade,
  type FilaDeComision,
  type ModoDeReparto,
} from './comision-del-upgrade';

const UN_DIA_MS = 86_400_000;

/**
 * Cuánto tiene que haber reposado un aviso de la pasarela antes de que el
 * barrido lo dé por bueno.
 *
 * LA CARRERA QUE EVITA: el aviso se GUARDA (`HotmartWebhookEvent`) al principio
 * del webhook —es el `claimEvent` que evita procesarlo dos veces— y la comisión
 * de ese cobro la crea el webhook varios pasos DESPUÉS. Si el barrido de los 30
 * minutos cae en medio, no ve ninguna comisión de esa transacción, crea la suya,
 * y acto seguido el webhook crea la de él: el afiliado cobra dos veces por un
 * solo cobro. Cinco minutos es más de lo que tarda el webhook entero y menos de
 * lo que tarda en volver a pasar el barrido, así que no retrasa nada.
 */
const MINUTOS_DE_REPOSO_DEL_AVISO = 5;

/**
 * Motivos que hay que MIRAR A MANO. El prefijo no es decorativo: es lo que el
 * endpoint de pendientes filtra para sacarlos a una pantalla. Un upgrade que
 * acaba raro y solo lo cuenta un campo que no sale en ningún listado es lo
 * mismo que no contarlo.
 */
/**
 * Cuánto se le deja a la transacción del upgrade.
 *
 * El default de Prisma son 5 s, y este backend habla con Postgres por el proxy
 * PÚBLICO de Railway: ~140 ms por consulta. La transacción ya hacía ocho, y
 * ahora hace hasta cinco más (congelar bases, revivir referidos, buscar y
 * corregir la comisión de la pasarela, corregir el ingreso). Con 5 s el margen
 * era de un par de consultas, y pasarse no falla «a medias» —el rollback es
 * entero— pero deja el acta en FALLIDO por un motivo que no es el suyo.
 */
const OPCIONES_DE_TRANSACCION = { timeout: 20_000, maxWait: 10_000 } as const;

const REVISAR = 'REVISAR:' as const;
/** Se completó con 0 comisiones TENIENDO el negocio un afiliado. */
const REVISAR_SIN_COMISION = `${REVISAR}sin-comision-con-afiliado`;
/** La comisión la creó la pasarela y ya estaba PAGADA: no se puede corregir. */
const REVISAR_COMISION_PAGADA = `${REVISAR}comision-de-pasarela-ya-pagada`;

/**
 * Cuánto hacia atrás se acepta la fecha efectiva del upgrade.
 *
 * El año se cuenta DESDE `effectiveAt`, no desde hoy: con una fecha de hace
 * cuatro meses el negocio nacería con el anual ya consumido en un tercio, y con
 * una de hace más de un año nacería vencido y el cron de mora lo suspendería
 * esa misma noche. 30 días cubre el caso real (el cobro entró la semana pasada
 * y se registra hoy) sin dejar pasar un error de tecleo.
 */
const DIAS_HACIA_ATRAS_MAX = 30;

/** Redondeo a céntimos. El dinero se compara y se reparte ya redondeado. */
const centavos = (n: number) => Math.round(n * 100) / 100;

/** Métodos de pago del upgrade. */
export type MetodoDeUpgrade = 'MANUAL' | 'PASARELA';

export type CrearUpgradeDto = {
  /** Referencia de la operación. La manda quien llama: mata el doble clic. */
  operationRef: string;
  /** Lo que el negocio pagó DE VERDAD, en USD. */
  paidAmountUsd: number;
  currency?: string;
  metodo?: MetodoDeUpgrade;
  /** Método del cobro por fuera (Nequi/efectivo/…). Solo para metodo=MANUAL. */
  metodoDePago?: 'NEQUI' | 'EFECTIVO' | 'TRANSFERENCIA' | 'OTRO';
  /** Comprobante / referencia del cobro. */
  reference?: string;
  /** Cuándo se cobró y desde cuándo vale el anual. Default: ahora. */
  effectiveAt?: string;
  notas?: string;
  /**
   * El administrador confirma que YA canceló la suscripción anterior en el
   * panel de la pasarela. Obligatorio cuando el negocio tiene una suscripción
   * viva: ver el bloque «EL COBRO VIEJO» de la cabecera de la clase.
   */
  suscripcionAnteriorCancelada?: boolean;
};

/** El sello de cancelación que se escribe en el acta al crearla. */
type SelloDeCancelacion = {
  cancelacionEstado: string;
  cancelacionRef: string | null;
  cancelacionAt: Date | null;
  cancelacionActorId: string | null;
  cancelacionMotivo: string | null;
};

/** El cobro que el barrido encontró en los avisos ya guardados. */
type CobroDeLaPasarela = {
  gateway: PaymentGateway;
  txId: string;
  montoUsd: number;
  cuando: Date;
  fuente: string;
};

/**
 * Lo que pasa al cancelar en la pasarela, que no es solo «dejar de cobrar».
 *
 * Se dice en la previsualización Y en el 400 del POST porque es la única
 * ventana en la que todavía se puede evitar: quien cancela tiene que avisarle
 * al cliente ANTES, o el cliente recibe un «se canceló tu suscripción» minutos
 * después de haber pagado un año por adelantado.
 */
const AVISO_DEL_CORREO_DE_CANCELACION =
  'Ojo con lo que dispara cancelar: Hotmart avisa de la cancelación y, con ese aviso, ' +
  'al cliente le sale el CORREO DE CANCELACIÓN de su marca y al equipo un SMS de «cancelado». ' +
  'Avísale tú antes, o va a leer «se canceló tu suscripción» justo después de pagar el año. ' +
  '(Lo demás que deja ese aviso —la fecha de cancelación del negocio y la baja de sus ' +
  'afiliados— lo repara este upgrade al aplicarse.)';

const ADVERTENCIA_DE_ANULACION =
  'Anular es un acta administrativa: libera el candado para poder volver a subir ' +
  'este negocio a anual. NO revierte el plan, NO devuelve el cobro y NO anula la ' +
  'comisión del afiliado. Lo que haya que deshacer se hace a mano.';

/**
 * UPGRADE A PLAN ANUAL
 * ════════════════════
 *
 * Un administrador pasa un negocio de mensual / trimestral / semestral a ANUAL
 * cobrándole una sola vez. En una transacción queda todo o no queda nada:
 *
 *   1. el acta del cambio (`PlanUpgrade`),
 *   2. el cobro (`ManualPayment`, solo en el camino MANUAL),
 *   3. el negocio en ANUAL con su nueva fecha de renovación,
 *   4. el ingreso en Contabilidad con categoría UPGRADE,
 *   5. la comisión del afiliado **sobre el monto realmente pagado**.
 *
 * ── LOS DOS CAMINOS ─────────────────────────────────────────────────────
 *
 * **MANUAL** — el negocio pagó por fuera (Nequi, efectivo, transferencia). El
 * POST cobra y aplica en el acto; es la única prueba de que ese dinero entró.
 *
 * **PASARELA** — el administrador le manda al cliente el enlace de pago del
 * plan ANUAL de su marca. El acta nace en PENDIENTE y **no mueve nada**: ni
 * plan, ni comisión, ni ingreso, ni renovación. Cuando el pago entra, el
 * barrido (`completarUpgradesPorPasarela`) lo encuentra en los avisos que las
 * pasarelas YA guardan (`HotmartWebhookEvent` / `StripeWebhookEvent`) y
 * completa el acta por el mismo camino transaccional, con el monto que traiga
 * el aviso. Si el pago no llega, el acta se queda en PENDIENTE y sale en el
 * endpoint de pendientes. **Este servicio no toca el código de cobro.**
 *
 * Si un cliente paga el plan anual por su cuenta y NO hay acta, eso no es un
 * upgrade: es un cobro normal, y lo procesa el webhook de la pasarela como
 * siempre. El barrido no inventa actas — solo completa las que alguien abrió.
 *
 * ── EL COBRO VIEJO, QUE ES LO QUE MÁS DUELE ─────────────────────────────
 *
 * 62 de los 67 negocios candidatos tienen suscripción viva en Hotmart. Si no se
 * cancela, el siguiente cobro del ciclo ANTERIOR entra por el webhook y:
 *
 *   · pisa `currentPeriodEnd` con la fecha del ciclo viejo → un negocio con el
 *     año pagado aparece vencido y el cron de mora lo suspende;
 *   · crea OTRA comisión al afiliado, que habrá que devolver;
 *   · mete un ingreso de RENOVACIÓN.
 *
 * Contra eso hay dos frenos, y ninguno toca `hotmart.service` ni `stripe.service`:
 *
 *   1. **Antes**: si el negocio tiene suscripción viva, el upgrade solo se
 *      acepta con `suscripcionAnteriorCancelada: true` — el administrador
 *      afirma que ya la canceló en el panel de la pasarela. Queda sellado
 *      `MANUAL_CONFIRMADA` con quién y cuándo, en el mismo acto.
 *   2. **Después**: el guardián (`vigilarCobrosViejos`) detecta a diario que a
 *      un negocio con upgrade COMPLETADO le movieron `currentPeriodEnd` por
 *      debajo de `nextRenewalAt`, lo restaura, lo audita y lo deja visible. Si
 *      además encuentra una comisión nueva posterior al upgrade **no la toca**:
 *      la deja señalada para que la revise una persona.
 *
 * ── LO QUE ROMPE NUESTRA PROPIA INSTRUCCIÓN, Y HAY QUE REPARAR ──────────
 *
 * Cancelar en la pasarela —que es lo que este servicio EXIGE antes de cobrar—
 * hace que Hotmart mande `SUBSCRIPTION_CANCELLATION`, y ese webhook
 * (`hotmart.service.ts`) deja tres cosas hechas que el upgrade tiene que
 * deshacer, porque el negocio no se está yendo: está pagando un año por
 * adelantado.
 *
 *   1. `Tenant.canceledAt` queda con fecha. Con eso,
 *      `BillingService.suspendCanceledAtPeriodEnd` suspende al negocio en
 *      cuanto le venza el período —dentro de un año, pero lo suspende— aunque
 *      tenga el año pagado. **El upgrade lo pone a NULL en su transacción.**
 *   2. `churnReferral` pone en CHURNED **todos** los `ReferralUse` del negocio,
 *      y la cadena de atribución solo mira SIGNED_UP/ACTIVE/PAYING. Sin
 *      reparar esto, el upgrade se completaría con **0 comisiones y HTTP 200**:
 *      el afiliado se queda sin cobrar y nadie se entera. **El upgrade
 *      resuelve la cadena incluyendo CHURNED y los devuelve a PAYING en su
 *      transacción.**
 *   3. Al cliente le sale el correo de cancelación de su marca y al equipo un
 *      SMS de «cancelado». Eso no se puede deshacer desde aquí: se AVISA, en
 *      la previsualización y en el mensaje de error del POST, para que quien
 *      cancele se lo diga antes al cliente.
 *
 * Y, por si algo de esto vuelve a fallar: si el upgrade termina con **0
 * comisiones teniendo el negocio un afiliado**, el acta queda marcada
 * `REVISAR:…` y sale en el endpoint de pendientes. Un cobro sin comisión no
 * puede terminar en silencio.
 *
 * ── LA BASE CONGELADA DE LAS COMISIONES QUE YA ESTABAN ──────────────────
 *
 * El upgrade cambia la base de comisión del negocio (de los $68 del mensual a
 * los $500 del anual). Tres caminos del motor recalculan `amount = base ×
 * pct` sobre las comisiones PENDING/APPROVED que **no tienen
 * `baseAmountUsd`** y caen al precio ACTUAL: una mensual de $15 pasaría a
 * $50. En producción 16 de los 29 candidatos no tienen NINGUNA fila con base
 * congelada.
 *
 * Por eso el upgrade, en la misma transacción, **congela la base PRE-upgrade**
 * en las comisiones vivas del negocio que no la tengan. No cambia ni un
 * importe: escribe el número que el sistema ya asume hoy, antes de que el
 * upgrade lo cambie. Cubre el arqueo y «Corregir todo»
 * (`recalcCommissionToExpected`, que sí lee `baseAmountUsd`).
 *
 * **Lo que NO cubre, y hay que saberlo:** `recalcTenantSplit` y
 * `recalcForRecipientCode` **ignoran `baseAmountUsd`** — siempre hacen
 * `getCommissionBase(negocio)`. Congelar no los frena. Arreglarlos es tocar el
 * motor de comisiones, que no es de este servicio.
 *
 * ── POR QUÉ NO PASA POR EL CAMINO NORMAL ────────────────────────────────
 *
 * `PATCH /tenants/:id` con `planPeriodicity` **no sirve** y es peligroso: ese
 * camino pisa `subscriptionPriceUsd` y llama a `recalcTenantSplit`, que
 * reescribe el importe de TODAS las comisiones PENDING y APPROVED del negocio.
 * Un upgrade no puede tocar comisiones que ya estaban calculadas.
 *
 * `POST /tenants/:id/change-plan-period` sí cambia la periodicidad sin tocar
 * comisiones, pero no cobra, no contabiliza y calcula la fecha con un
 * `setMonth` sin acotar el fin de mes (31-ene + 1 mes le daba 3-mar). Aquí la
 * fecha sale de `addPlanPeriod`, que sí lo acota y tiene prueba.
 *
 * ── EL PRECIO PACTADO SÍ SE RETIRA, Y ES A PROPÓSITO ────────────────────
 *
 * **No escribe `Tenant.subscriptionPriceUsd` con lo pagado**: lo que se pagó
 * por el upgrade no es el precio futuro del negocio. Pero sí lo pone a NULL
 * cuando había un override viejo ($50 mensual, $135 trimestral, $250
 * semestral): ese override gana en `getCommissionBase` y en el webhook, así que
 * dejarlo haría que la renovación ANUAL del año que viene se comisionara sobre
 * $50. El valor anterior queda congelado en el acta y en la auditoría.
 *
 * Escribirlo desde aquí NO dispara `recalcTenantSplit`: ese recálculo solo vive
 * en `TenantsService.update`, y este servicio escribe con su propia transacción.
 */
@Injectable()
export class PlanUpgradeService {
  private readonly logger = new Logger(PlanUpgradeService.name);

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    @Inject(forwardRef(() => ReferralsService))
    private referrals: ReferralsService,
    private recalc: CommissionRecalcService,
    private excepciones: CommissionExceptionsService,
    private income: IncomeRecordService,
  ) {}

  // ─────────────────────────── Previsualización ───────────────────────────

  /**
   * Lo que la pantalla necesita para el resumen ANTES de cobrar. No escribe
   * nada: se puede pedir las veces que haga falta.
   */
  async previsualizar(tenantId: string, ahora = new Date()) {
    const t = await this.cargarNegocio(tenantId);
    const periodicidadActual = normalizePlanPeriod(t.planPeriodicity);
    const standardPriceUsd = await this.recalc.getBundlePrice('ANUAL');
    const effectiveAt = ahora;
    const nextRenewalAt = addPlanPeriod(effectiveAt, 'ANUAL');
    const cancelacion = this.refDeCancelacion(t);
    const vivo = await this.upgradeVivo(tenantId);
    const motivo = this.porQueNoSePuede(t, periodicidadActual, vivo);
    const precioPactado =
      t.subscriptionPriceUsd == null ? null : Number(t.subscriptionPriceUsd);

    const avisos: string[] = [];
    if (cancelacion.estado === 'PENDIENTE') {
      avisos.push(
        `Este negocio tiene una suscripción viva en la pasarela (${cancelacion.ref}). ` +
          'Cancélala primero en su panel: si no, el próximo cobro del plan anterior ' +
          'le acorta la fecha de renovación y le genera otra comisión al afiliado.',
      );
      avisos.push(AVISO_DEL_CORREO_DE_CANCELACION);
    }
    if (precioPactado != null) {
      avisos.push(
        `Este negocio tenía un precio pactado de $${precioPactado.toFixed(2)}; ` +
          'al pasar a anual se usará el precio estándar del anual ' +
          `($${standardPriceUsd}) para la renovación y sus comisiones.`,
      );
    }

    return {
      tenantId: t.id,
      brandName: t.brandName,
      estadoDelNegocio: t.status,
      plan: t.plan ? { id: t.plan.id, nombre: t.plan.name } : null,
      periodicidadActual,
      periodicidadDestino: 'ANUAL' as const,
      /** Precio estándar del anual HOY. Es lo que se sugiere cobrar. */
      standardPriceUsd,
      currency: 'USD',
      coberturaActualHasta: t.currentPeriodEnd,
      effectiveAt,
      nextRenewalAt,
      /** Si el nuevo ciclo termina antes que la cobertura que ya tenía. */
      acortaCoberturaPrevia: !!(
        t.currentPeriodEnd && nextRenewalAt.getTime() < t.currentPeriodEnd.getTime()
      ),
      /** El override de precio que el upgrade va a retirar (null = no hay). */
      precioPactadoUsd: precioPactado,
      cancelacionEnPasarela: {
        estado: cancelacion.estado,
        referencia: cancelacion.ref,
        /** Hoy SIEMPRE hay que cancelar a mano: no hay credenciales de API. */
        automatica: false,
        /** Si es true, el POST exige `suscripcionAnteriorCancelada`. */
        requiereConfirmacion: cancelacion.estado === 'PENDIENTE',
      },
      /** El enlace del plan anual de su marca, para el cobro por pasarela. */
      enlaceDePago: await this.enlaceAnualDeLaMarca(t.whiteLabelId),
      avisos,
      sePuede: motivo == null,
      motivo,
      upgradeVivo: vivo
        ? { id: vivo.id, estado: vivo.estado, createdAt: vivo.createdAt }
        : null,
    };
  }

  // ─────────────────────────── Crear / ejecutar ───────────────────────────

  /**
   * Cobra el upgrade y lo aplica. Idempotente por `operationRef`.
   *
   * ORDEN, que aquí no es cosmético:
   *
   *  · **Todo lo que se lee, se lee antes de abrir la transacción.** Los
   *    precios, la cadena de atribución y los porcentajes son consultas que no
   *    tienen por qué correr dentro de una transacción abierta (Prisma la corta
   *    a los 5 s y se cae con «Transaction already closed»).
   *  · **El acta se crea ANTES**, fuera de la transacción, en estado PENDIENTE.
   *    Es el patrón `claimEvent` del webhook de Hotmart: se reserva primero y se
   *    captura el P2002. Si estuviera dentro, un fallo la borraría con el
   *    rollback y no quedaría constancia de que se intentó.
   *  · **Si la transacción se cae, el acta pasa a FALLIDO con el motivo.** No
   *    queda nada aplicado a medias: ni cobro, ni periodicidad, ni comisión.
   */
  async crear(tenantId: string, dto: CrearUpgradeDto, actorId: string) {
    const operationRef = (dto.operationRef ?? '').trim();
    if (!operationRef) {
      throw new BadRequestException(
        'Falta la referencia de la operación (operationRef): es lo que evita cobrar dos veces por un doble clic.',
      );
    }
    // El camino POR PASARELA está construido y probado con dobles, pero nunca
    // se ha ejecutado contra un cobro real: corrige filas que crea el webhook
    // (comisión e ingreso) y depende de cómo llegue cada aviso. Se estrena
    // cuando se pruebe con un cobro de verdad; hasta entonces, manual
    // (Javier, 2026-09-21: «suelta solo el manual»). Para abrirlo basta con
    // poner `UPGRADE_POR_PASARELA=1` en Railway: el código ya está entero.
    if (dto.metodo === 'PASARELA' && process.env.UPGRADE_POR_PASARELA !== '1') {
      throw new BadRequestException(
        'El upgrade por pasarela todavía no está abierto: cóbralo y regístralo como manual. ' +
          'Se activará cuando se pruebe con un cobro real.',
      );
    }

    const ahora = new Date();
    const effectiveAt = dto.effectiveAt ? new Date(dto.effectiveAt) : ahora;
    if (Number.isNaN(effectiveAt.getTime())) {
      throw new BadRequestException('La fecha del upgrade no es válida.');
    }
    // Margen de 1 día por zonas horarias, igual que el pago manual. Una fecha
    // futura de verdad correría mal el ciclo y la renovación.
    if (effectiveAt.getTime() > ahora.getTime() + UN_DIA_MS) {
      throw new BadRequestException('La fecha del upgrade no puede ser futura.');
    }
    // Cota por abajo: el año se cuenta DESDE esta fecha, no desde hoy.
    if (
      effectiveAt.getTime() <
      ahora.getTime() - DIAS_HACIA_ATRAS_MAX * UN_DIA_MS
    ) {
      throw new BadRequestException(
        `La fecha del upgrade no puede ser de hace más de ${DIAS_HACIA_ATRAS_MAX} días: ` +
          'el año de cobertura se cuenta desde esa fecha, así que el negocio nacería ' +
          'con buena parte del plan anual ya consumida. Si el cobro es realmente más ' +
          'antiguo, regístralo con «Registrar pago» y súbelo a anual aparte.',
      );
    }

    const metodo: MetodoDeUpgrade = dto.metodo ?? 'MANUAL';

    // Redondeo a céntimos ANTES de validar y de repartir: el monto llega de un
    // formulario y un 349.999999 se convertiría en una base de comisión con
    // seis decimales que nadie puede cuadrar contra el comprobante.
    const paid = centavos(Number(dto.paidAmountUsd));
    if (!Number.isFinite(paid) || paid <= 0) {
      throw new BadRequestException(
        'El monto cobrado por el upgrade tiene que ser mayor que cero.',
      );
    }
    const currency = (dto.currency ?? 'USD').toUpperCase();
    if (currency !== 'USD') {
      throw new BadRequestException(
        `El upgrade solo se registra en USD (llegó ${currency}). Un cobro en moneda local mezclaría monedas en el libro de Contabilidad, que está en dólares.`,
      );
    }

    const t = await this.cargarNegocio(tenantId);
    const periodicidadOrigen = normalizePlanPeriod(t.planPeriodicity);

    // ── Doble clic: el MISMO operationRef no cobra dos veces ──────────────
    const previo = await this.prisma.planUpgrade.findUnique({
      where: { operationRef },
    });
    if (previo) {
      if (previo.tenantId !== tenantId) {
        throw new BadRequestException(
          'Esa referencia de operación ya se usó en otro negocio. Usa una nueva.',
        );
      }
      if (previo.estado === 'COMPLETADO') {
        // El caso normal del doble clic: devolvemos lo que ya se hizo.
        return this.respuesta(previo, { repetido: true });
      }
      if (previo.estado === 'CANCELADO') {
        throw new BadRequestException(
          'Ese upgrade se anuló. Si hay que rehacerlo, usa otra referencia de operación.',
        );
      }
      if (
        previo.metodo === 'PASARELA' &&
        (previo.estado === 'PENDIENTE' || previo.estado === 'FALLIDO')
      ) {
        // El acta por pasarela vive en PENDIENTE hasta que entre el pago. Un
        // segundo POST con la misma referencia no la reabre: devuelve el acta y
        // el enlace, que es lo que la pantalla necesita para reenviarlo. (Si se
        // cayó al aplicarse, el barrido la reintenta solo.)
        return this.respuesta(previo, {
          repetido: true,
          enlaceDePago: await this.enlaceAnualDeLaMarca(t.whiteLabelId),
        });
      }
      // PENDIENTE (manual) o FALLIDO: el intento anterior NO aplicó nada (la
      // transacción hizo rollback entero), así que se reintenta sobre la misma
      // acta.
    } else {
      const vivo = await this.upgradeVivo(tenantId);
      if (vivo) {
        throw new BadRequestException(
          vivo.estado === 'COMPLETADO'
            ? `Este negocio ya tiene un upgrade a anual aplicado (${vivo.createdAt.toISOString().slice(0, 10)}). Si hay que rehacerlo, primero hay que anular el anterior.`
            : `Este negocio tiene un upgrade a medias (${vivo.id}). Revísalo antes de crear otro.`,
        );
      }
    }

    const noSePuede = this.porQueNoSePuede(t, periodicidadOrigen, null);
    if (noSePuede) throw new BadRequestException(noSePuede);

    // ── La suscripción vieja: se exige la confirmación ANTES de cobrar ────
    const cancelacion = this.refDeCancelacion(t);
    if (
      cancelacion.estado === 'PENDIENTE' &&
      dto.suscripcionAnteriorCancelada !== true
    ) {
      throw new BadRequestException(
        `Este negocio todavía tiene una suscripción viva en la pasarela (${cancelacion.ref}). ` +
          'Cancélala primero en el panel de la pasarela y vuelve marcando «ya cancelé la ' +
          'suscripción anterior». Si no se cancela, el próximo cobro del plan anterior le ' +
          'acorta la fecha de renovación —el negocio aparece vencido y el cron de mora lo ' +
          'suspende aunque tenga el año pagado— y le genera al afiliado otra comisión que ' +
          `habrá que devolver. ${AVISO_DEL_CORREO_DE_CANCELACION}`,
      );
    }
    const sello = this.selloDeCancelacion(cancelacion, actorId, ahora);

    // ── Lo que se lee, antes de abrir nada ────────────────────────────────
    const standardPriceUsd = await this.recalc.getBundlePrice('ANUAL');
    const nextRenewalAt = addPlanPeriod(effectiveAt, 'ANUAL');

    // ── El acta: se reserva primero (patrón claimEvent) ───────────────────
    let upgrade = previo;
    if (!upgrade) {
      try {
        upgrade = await this.prisma.planUpgrade.create({
          data: {
            tenantId: t.id,
            whiteLabelId: t.whiteLabelId,
            operationRef,
            periodicidadOrigen,
            periodicidadDestino: 'ANUAL',
            planIdOrigen: t.planId ?? null,
            planNombreOrigen: t.plan?.name ?? null,
            planIdDestino: t.planId ?? null,
            planNombreDestino: t.plan?.name ?? null,
            standardPriceUsd,
            paidAmountUsd: paid,
            currency,
            metodo,
            estado: 'PENDIENTE',
            effectiveAt,
            nextRenewalAt,
            actorId,
            notas: dto.notas ?? null,
            ...sello,
          },
        });
      } catch (e: any) {
        if (e?.code === 'P2002') {
          // Carrera real: dos POST a la vez. El que perdió busca lo que escribió
          // el que ganó — por referencia o por el único parcial de «vivo».
          const ganador =
            (await this.prisma.planUpgrade.findUnique({ where: { operationRef } })) ??
            (await this.upgradeVivo(tenantId));
          if (ganador) return this.respuesta(ganador, { repetido: true });
          throw new BadRequestException(
            'Ya hay un upgrade en curso para este negocio. Espera a que termine.',
          );
        }
        throw e;
      }
    }

    // ── PASARELA: el acta queda abierta y NO se mueve nada ────────────────
    if (metodo === 'PASARELA') {
      const enlaceDePago = await this.enlaceAnualDeLaMarca(t.whiteLabelId);
      this.audit.log({
        actorId,
        tenantId: t.id,
        action: 'tenant.plan_upgrade_por_pasarela_abierto',
        resource: `plan_upgrade:${upgrade.id}`,
        metadata: {
          brandName: t.brandName,
          operationRef,
          de: periodicidadOrigen,
          paidAmountUsd: paid,
          standardPriceUsd,
          enlaceDePago: enlaceDePago?.url ?? null,
          cancelacionEstado: sello.cancelacionEstado,
          cancelacionRef: sello.cancelacionRef,
        },
      });
      return this.respuesta(upgrade, {
        repetido: false,
        enlaceDePago,
        aviso: enlaceDePago
          ? 'El upgrade queda PENDIENTE hasta que entre el pago. Mándale este enlace al cliente: ' +
            'cuando la pasarela avise del cobro, el upgrade se completa solo (plan, ingreso y comisión).'
          : 'El upgrade queda PENDIENTE hasta que entre el pago. Aquí no hay ningún enlace de pago ' +
            'del plan ANUAL configurado para este negocio: mándale el que uses tú, créalo en la ' +
            'marca, o cóbralo por fuera con el método MANUAL. El barrido reconoce el pago igual, ' +
            'venga del enlace que venga, mientras sea del plan anual.',
      });
    }

    // ── MANUAL: se cobra y se aplica ahora ────────────────────────────────
    return this.aplicar({
      t,
      upgrade,
      periodicidadOrigen,
      paid,
      currency,
      effectiveAt,
      nextRenewalAt,
      standardPriceUsd,
      actorId,
      sello,
      notas: dto.notas ?? null,
      cobro: {
        via: 'MANUAL',
        metodoDePago: dto.metodoDePago ?? 'OTRO',
        reference: dto.reference ?? operationRef,
      },
      operationRef,
    });
  }

  // ───────────────────── El camino transaccional común ─────────────────────

  /**
   * Aplica el upgrade sobre un acta ya reservada. Lo usan los DOS caminos: el
   * POST manual y el barrido de la pasarela. Es una sola copia a propósito —
   * dos habrían divergido en el primer arreglo.
   *
   * La única diferencia entre caminos es de dónde salió el dinero:
   *
   *  · MANUAL   → crea el `ManualPayment` (es la única prueba de ese cobro) y
   *               el ingreso con `gateway=MANUAL`, referencia = id del pago.
   *  · PASARELA → **no** crea `ManualPayment`: el dinero entró por Hotmart o
   *               Stripe y ese camino ya registra su propio ingreso. Si el
   *               ingreso de esa transacción ya existe, se enlaza; si no, se
   *               crea con categoría UPGRADE.
   */
  private async aplicar(args: {
    t: NegocioDeUpgrade;
    upgrade: any;
    periodicidadOrigen: string;
    paid: number;
    currency: string;
    effectiveAt: Date;
    nextRenewalAt: Date;
    standardPriceUsd: number;
    actorId: string | null;
    sello: SelloDeCancelacion;
    notas: string | null;
    operationRef: string;
    cobro:
      | {
          via: 'MANUAL';
          metodoDePago: 'NEQUI' | 'EFECTIVO' | 'TRANSFERENCIA' | 'OTRO';
          reference: string;
        }
      | { via: 'PASARELA'; gateway: PaymentGateway; txId: string; fuente: string };
  }) {
    const {
      t,
      periodicidadOrigen,
      paid,
      currency,
      effectiveAt,
      nextRenewalAt,
      standardPriceUsd,
      actorId,
      sello,
      cobro,
      operationRef,
    } = args;
    const upgradeId = args.upgrade.id;

    // TRAMPA: `resolveManualPaymentPeriod` lee la periodicidad DEL NEGOCIO, y
    // el negocio TODAVÍA es mensual/trimestral. Si no se le pasa ANUAL a mano,
    // el ManualPayment sale cubriendo un mes. Por eso va explícita.
    const periodoDelCobro = resolveManualPaymentPeriod(
      effectiveAt,
      t.currentPeriodEnd,
      'ANUAL',
    );
    const gatewayDelIngreso: PaymentGateway =
      cobro.via === 'MANUAL' ? 'MANUAL' : cobro.gateway;
    const desglose = await this.income.desglose(gatewayDelIngreso, paid);
    const plan = await this.comisionDelUpgrade(t, paid);
    const precioPactadoAnterior =
      t.subscriptionPriceUsd == null ? null : Number(t.subscriptionPriceUsd);

    // ── La base que las comisiones YA CREADAS dan por supuesta hoy ─────────
    //
    // Es el mismo número que `recalcTenantSplit`, `recalcForRecipientCode` y el
    // arqueo calcularían AHORA MISMO para este negocio. Dentro de un segundo
    // deja de serlo —el upgrade lo sube a los $500 del anual— y las filas que
    // no lo tengan congelado se recalcularían sobre el precio nuevo: una
    // mensual de $15 pasaría a $50. Se lee ANTES de tocar nada, que es la única
    // forma de que sea el valor PRE-upgrade.
    const basePreUpgrade = await this.recalc.getCommissionBase(
      t.subscriptionPriceUsd ?? null,
      periodicidadOrigen,
    );
    // Las de MONTO LIBRE (IMPL-…, UPG-…) se quedan fuera: su base no es el
    // precio del plan, así que escribirles ésta sería inventarles un número
    // que nunca tuvieron — y convertiría una fila que el arqueo hoy deja en paz
    // en una fila que declara «importe equivocado».
    const vivasSinBase = await this.prisma.commission.findMany({
      where: {
        referralUse: { tenantId: t.id },
        status: { in: ['PENDING', 'APPROVED'] },
        baseAmountUsd: null,
      },
      select: { id: true, periodKey: true },
    });
    const aCongelar = vivasSinBase
      .filter((c) => !esDeMontoLibre(c.periodKey))
      .map((c) => c.id);

    const periodKey = periodKeyDelUpgrade(effectiveAt, upgradeId);
    // El hold del afiliado se cuenta desde el COBRO, igual que en el resto del
    // motor: 15 días después de la fecha efectiva, no desde hoy.
    const availableAt = new Date(effectiveAt.getTime() + DIAS_DE_HOLD * UN_DIA_MS);

    try {
      const aplicado = await this.prisma.$transaction(async (tx) => {
        // 0) CONGELAR LA BASE de las comisiones que ya estaban.
        //
        //    No cambia NINGÚN importe: escribe en `baseAmountUsd` el número que
        //    el motor ya asume hoy para este negocio. Lo que evita es que, en
        //    cuanto alguien toque un %, una excepción o pulse «Corregir todo»,
        //    esas filas se recalculen sobre la base NUEVA (los $500 del anual)
        //    y una mensual de $15 amanezca en $50.
        //
        //    `baseAmountUsd: null` se repite en el WHERE: si entre la lectura y
        //    esto alguien le congeló la base, la suya manda y ésta no la pisa.
        let basesCongeladas = 0;
        if (aCongelar.length && basePreUpgrade > 0) {
          const r = await tx.commission.updateMany({
            where: { id: { in: aCongelar }, baseAmountUsd: null },
            data: { baseAmountUsd: basePreUpgrade },
          });
          basesCongeladas = r.count;
        }

        // 0.bis) DESHACER LO QUE DEJÓ LA CANCELACIÓN EN LA PASARELA.
        //
        //    Para llegar aquí hubo que cancelar la suscripción vieja, y ese
        //    aviso puso en CHURNED todos los `ReferralUse` del negocio. El
        //    negocio no se va: acaba de pagar un año. Si se quedan en CHURNED,
        //    el motor deja de generarle comisiones recurrentes al afiliado en
        //    silencio. (La cadena de ESTE upgrade ya se resolvió mirando
        //    también los CHURNED, ver `comisionDelUpgrade`.)
        const revividos = await tx.referralUse.updateMany({
          where: { tenantId: t.id, status: 'CHURNED' },
          data: { status: 'PAYING' },
        });

        // 1) El cobro. Solo en MANUAL: es la única prueba de que este dinero
        //    entró, porque ninguna pasarela lo va a confirmar. En PASARELA el
        //    dinero SÍ tiene respaldo (el aviso) y un ManualPayment diría que
        //    «pagó por fuera», que no es lo que pasó.
        let pagoId: string | null = null;
        if (cobro.via === 'MANUAL') {
          const pago = await tx.manualPayment.create({
            data: {
              tenantId: t.id,
              whiteLabelId: t.whiteLabelId,
              method: cobro.metodoDePago,
              amount: paid,
              currency,
              reference: cobro.reference,
              note:
                args.notas ??
                `Upgrade a plan anual desde ${periodicidadOrigen} (precio estándar $${standardPriceUsd}).`,
              paidAt: effectiveAt,
              periodStart: periodoDelCobro.periodStart,
              periodEnd: periodoDelCobro.periodEnd,
              periodicity: 'ANUAL',
              actorId,
            },
          });
          pagoId = pago.id;
        }

        // 2) El negocio pasa a ANUAL.
        await tx.tenant.update({
          where: { id: t.id },
          data: {
            planPeriodicity: 'ANUAL',
            currentPeriodEnd: nextRenewalAt,
            // Fecha del cobro REAL: de aquí salen los informes por rango y el
            // «último cobro» del panel.
            lastChargeAt: effectiveAt,
            failedPaymentCount: 0,
            firstFailedAt: null,
            // La cancelación que EXIGIMOS antes de cobrar dejó este campo con
            // fecha, y `BillingService.suspendCanceledAtPeriodEnd` suspende a
            // todo ACTIVE con `canceledAt` en cuanto le vence el período. Sin
            // limpiarlo, este negocio queda condenado a que lo apaguen al
            // acabar el año que acaba de pagar (o antes, si le entra un cobro
            // fallido: ese cron también mira `failedPaymentCount`).
            canceledAt: null,
            // Dedup por ciclo: los crons de aviso comparan estos campos contra
            // `currentPeriodEnd`. Al moverla un año, si no se limpian, el
            // negocio NO recibe NINGÚN aviso del ciclo nuevo — el fallo
            // silencioso más probable de este flujo. Mismo reset que hace el
            // pago manual.
            preReminder7dSentFor: null,
            preReminder3dSentFor: null,
            preReminderTodaySentFor: null,
            paymentReminderSentFor: null,
            paymentFailureNoticeSentAt: null,
            pausePendingNoticeSentAt: null,
            // El precio PACTADO viejo se retira. No se escribe lo pagado hoy
            // —eso no es el precio del año que viene—, pero dejar el override
            // ($50 mensual, $135 trimestral…) haría que la renovación ANUAL se
            // comisionara sobre él: `getCommissionBase` le da prioridad al
            // override sobre el canónico del plan. Solo se toca si lo había.
            ...(precioPactadoAnterior != null
              ? { subscriptionPriceUsd: null }
              : {}),
          },
        });

        // 3) Contabilidad. La categoría UPGRADE existe desde el principio y no
        //    la usaba nadie: no se puede adivinar, hay que pasarla a mano.
        //
        //    MANUAL: la referencia es el id del ManualPayment A PROPÓSITO — el
        //    conciliador nocturno recorre los pagos manuales y, al que no
        //    encuentra en el libro como `MANUAL|<id>`, le crea un ingreso de
        //    categoría RENOVACIÓN. Con otra referencia, este upgrade se contaría
        //    DOS veces y la segunda con la categoría equivocada.
        //
        //    PASARELA: la referencia es la transacción. Si el camino de cobro ya
        //    escribió el ingreso, se ENLAZA el que hay; duplicarlo sumaría el
        //    mismo dinero dos veces en Contabilidad.
        const refDelIngreso = cobro.via === 'MANUAL' ? pagoId! : cobro.txId;
        const yaEstaba = await tx.incomeRecord.findUnique({
          where: {
            gateway_externalTxId: {
              gateway: gatewayDelIngreso,
              externalTxId: refDelIngreso,
            },
          },
          select: {
            id: true,
            grossUsd: true,
            category: true,
            planPeriodicity: true,
          },
        });
        // El ingreso que escribió el camino de cobro es del CICLO VIEJO: lo
        // guarda como RENOVACION y, de propósito, por el precio del PLAN (los
        // $68 del mensual), no por lo que entró. Enlazarlo sin corregirlo deja
        // el upgrade contado como una renovación de $68 en Contabilidad.
        // Se corrige, no se duplica: duplicarlo sumaría el dinero dos veces.
        let ingresoCorregido: { de: number; a: number } | null = null;
        if (yaEstaba && cobro.via === 'PASARELA') {
          const antes = Number(yaEstaba.grossUsd);
          if (
            antes !== paid ||
            yaEstaba.category !== 'UPGRADE' ||
            yaEstaba.planPeriodicity !== 'ANUAL'
          ) {
            await tx.incomeRecord.update({
              where: { id: yaEstaba.id },
              data: {
                category: 'UPGRADE',
                planPeriodicity: 'ANUAL',
                grossUsd: paid,
                gatewayFeeUsd: desglose.fee,
                taxUsd: desglose.tax,
                netExpectedUsd: desglose.netExpected,
                note:
                  `Corregido por el upgrade a plan anual: el camino de cobro lo había ` +
                  `registrado como ${yaEstaba.category ?? 'RENOVACION'} por $${antes.toFixed(2)} ` +
                  `(el precio del plan viejo). El cobro real del upgrade fue $${paid.toFixed(2)}.`,
              },
            });
            ingresoCorregido = { de: antes, a: paid };
          }
        }
        const ingresoId =
          yaEstaba?.id ??
          (
            await tx.incomeRecord.create({
              data: {
                gateway: gatewayDelIngreso,
                externalTxId: refDelIngreso,
                tenantId: t.id,
                whiteLabelId: t.whiteLabelId,
                brandName: t.brandName,
                planId: t.planId ?? null,
                category: 'UPGRADE',
                planPeriodicity: 'ANUAL',
                currency: 'USD',
                grossUsd: paid,
                gatewayFeeUsd: desglose.fee,
                taxUsd: desglose.tax,
                otherDiscountUsd: 0,
                netExpectedUsd: desglose.netExpected,
                isFirstPayment: false,
                // Mes contable en hora de Bogotá: una venta del 31 por la noche
                // pertenece a ESE mes, no al siguiente.
                periodKey: mesContable(effectiveAt),
                saleDate: effectiveAt,
                reconStatus: 'PENDING',
              },
              select: { id: true },
            })
          ).id;

        // 4) La comisión. NO es «fire and forget»: si el afiliado existe y su
        //    comisión no se puede crear, el upgrade entero se deshace. Un cobro
        //    sin comisión es dinero que alguien deja de recibir sin que nadie se
        //    entere, y eso ya pasó con los pagos por fuera.
        //
        //    En PASARELA hay una puerta más: el webhook de la pasarela YA creó
        //    su propia comisión por ese cobro, y la calculó con la periodicidad
        //    VIEJA (el canónico del mensual, $68 → $13,50 al 20 %) cuando lo que
        //    el negocio pagó fueron los $350/$500 del anual. Crear OTRA sería
        //    pagarle dos veces al afiliado por un mismo cobro; dejarla como
        //    está es pagarle de menos. Así que **no se crea otra: se CORRIGE la
        //    suya** —importe sobre lo realmente pagado, base, %, periodKey de
        //    upgrade y una nota que explica por qué— dentro de esta misma
        //    transacción.
        //
        //    Si ya está PAGADA no se toca: lo pagado no se retracta (regla de
        //    Javier y Sara). Se saca al endpoint de pendientes como «comisión a
        //    revisar», que es dinero que alguien tiene que mirar.
        const comisionesDeLaPasarela =
          cobro.via === 'PASARELA'
            ? await tx.commission.findMany({
                where: {
                  externalTxId: cobro.txId,
                  status: { notIn: ['REJECTED', 'ADJUSTMENT'] },
                },
                select: {
                  id: true,
                  amount: true,
                  status: true,
                  recipientCodeId: true,
                  referralUseId: true,
                },
              })
            : [];
        const comisionDeLaPasarela = comisionesDeLaPasarela[0] ?? null;

        // Qué se pudo corregir y qué se quedó como estaba.
        const corregidas: Array<{ id: string; de: number; a: number }> = [];
        const pagadasSinTocar: Array<{ id: string; monto: number }> = [];
        for (const c of comisionesDeLaPasarela) {
          if (c.status === 'PAID' || c.status === 'RETAINED') {
            pagadasSinTocar.push({ id: c.id, monto: Number(c.amount) });
            continue;
          }
          // El importe bueno es el de la fila de ESTE beneficiario calculada
          // sobre lo que se pagó de verdad. Si el beneficiario no está en la
          // cadena que resolvimos (se reasignó el afiliado entre el cobro y el
          // barrido), no se inventa nada: se deja y se manda a revisar.
          const fila = plan.filas.find(
            (f) => f.recipientCodeId === c.recipientCodeId,
          );
          if (!fila) {
            pagadasSinTocar.push({ id: c.id, monto: Number(c.amount) });
            continue;
          }
          const antes = Number(c.amount);
          await tx.commission.update({
            where: { id: c.id },
            data: {
              amount: fila.amount,
              baseAmountUsd: plan.base,
              appliedPercent: fila.appliedPercent,
              distributionMode: plan.modo,
              // La clave del upgrade, no la del mes: además de explicar de qué
              // es la comisión, la saca del recálculo por base del negocio
              // (`NO_ES_DEL_UPGRADE`), que la devolvería a los $500 del anual.
              periodKey,
              availableAt,
              businessDate: effectiveAt,
              notes:
                `Corregida por el upgrade a plan anual: la creó la pasarela por ` +
                `$${antes.toFixed(2)} sobre el precio del plan VIEJO. La base buena es ` +
                `$${plan.base.toFixed(2)} (el monto realmente pagado por el upgrade).`,
            },
          });
          corregidas.push({ id: c.id, de: antes, a: fila.amount });
        }

        const comisiones: Array<{ id: string; amount: number }> = [];
        if (plan.filas.length && !comisionDeLaPasarela) {
          const useId = plan.referralUseId;
          if (!useId) {
            throw new Error(
              'El negocio tiene afiliado pero no se encontró su ReferralUse.',
            );
          }
          for (const fila of plan.filas) {
            const c = await tx.commission.create({
              data: {
                referralUseId: useId,
                amount: fila.amount,
                status: 'PENDING',
                paymentStatus: 'PENDING',
                amountPaid: 0,
                recipientCodeId: fila.recipientCodeId,
                vendorCodeId: fila.vendorCodeId,
                externalTxId: `upgrade:${upgradeId}`,
                periodKey,
                availableAt,
                businessDate: effectiveAt,
                distributionMode: plan.modo,
                baseAmountUsd: plan.base,
                appliedPercent: fila.appliedPercent,
                notes: `Upgrade a plan anual · base $${plan.base.toFixed(2)} (monto realmente pagado)`,
              },
              select: { id: true },
            });
            comisiones.push({ id: c.id, amount: fila.amount });
          }
          // El socio (10 % de toda venta) solo si está configurado — hoy no lo
          // está. Misma regla que el resto de los caminos de cobro.
          if (plan.socio) {
            let socioUseId = plan.socio.referralUseId;
            if (!socioUseId) {
              const nuevo = await tx.referralUse.create({
                data: {
                  referralCodeId: plan.socio.codeId,
                  tenantId: t.id,
                  status: 'PAYING',
                  convertedAt: new Date(),
                },
                select: { id: true },
              });
              socioUseId = nuevo.id;
            }
            const c = await tx.commission.create({
              data: {
                referralUseId: socioUseId,
                amount: plan.socio.amount,
                status: 'PENDING',
                paymentStatus: 'PENDING',
                amountPaid: 0,
                recipientCodeId: plan.socio.codeId,
                externalTxId: `upgrade:${upgradeId}`,
                periodKey,
                availableAt,
                businessDate: effectiveAt,
                baseAmountUsd: plan.base,
                appliedPercent: plan.socio.pct,
                notes: `Upgrade a plan anual (socio) · base $${plan.base.toFixed(2)}`,
              },
              select: { id: true },
            });
            comisiones.push({ id: c.id, amount: plan.socio.amount });
          }
        }
        const totalComision = centavos(
          comisiones.reduce((s, c) => s + c.amount, 0),
        );
        const totalDeLaPasarela = centavos(
          corregidas.reduce((s, c) => s + c.a, 0) +
            pagadasSinTocar.reduce((s, c) => s + c.monto, 0),
        );
        // ¿Terminó este upgrade sin pagarle a nadie, TENIENDO el negocio un
        // afiliado? Eso no puede pasar en silencio: el acta se marca `REVISAR:`
        // y con esa marca sale en el endpoint de pendientes.
        const nadieCobro = !comisiones.length && !comisionesDeLaPasarela.length;
        const omitida = nadieCobro
          ? plan.tieneAfiliado
            ? // El motivo de fondo va PEGADO a la marca: sin él, el acta dice
              // «hay que mirarlo» pero no por dónde empezar, y en un upgrade
              // MANUAL no hay `barridoNota` donde contarlo.
              `${REVISAR_SIN_COMISION}:${plan.motivo ?? 'sin-motivo'}`
            : plan.motivo
          : comisionesDeLaPasarela.length
            ? pagadasSinTocar.length
              ? REVISAR_COMISION_PAGADA
              : 'la-creo-la-pasarela-y-la-corrigio-el-upgrade'
            : null;

        // 5) El acta queda sellada COMPLETADO dentro de la MISMA transacción.
        //    Si algo de lo anterior falla, esto tampoco ocurre.
        //
        //    `updateMany` con el estado en el WHERE, no `update`: es un UPDATE
        //    condicional, y el `count` dice si de verdad ganamos nosotros. Sin
        //    eso, dos barridos solapados —o un barrido y una anulación— se
        //    pisarían y el upgrade se aplicaría dos veces. `gatewayTxId` es
        //    ÚNICO: un aviso reenviado choca aquí y hace rollback de todo.
        const sellado = await tx.planUpgrade.updateMany({
          where: { id: upgradeId, estado: { in: ['PENDIENTE', 'FALLIDO'] } },
          data: {
            estado: 'COMPLETADO',
            motivoDeFallo: null,
            periodicidadOrigen,
            standardPriceUsd,
            paidAmountUsd: paid,
            currency,
            metodo: cobro.via,
            effectiveAt,
            nextRenewalAt,
            manualPaymentId: pagoId,
            gatewayTxId: cobro.via === 'PASARELA' ? cobro.txId : null,
            incomeRecordId: ingresoId,
            commissionId:
              comisiones[0]?.id ?? comisionDeLaPasarela?.id ?? null,
            commissionAmount: comisiones.length
              ? totalComision
              : comisionesDeLaPasarela.length
                ? totalDeLaPasarela
                : null,
            comisionesCreadas: comisiones.length,
            comisionOmitidaMotivo: omitida,
            precioPactadoAnterior,
            barridoAt: cobro.via === 'PASARELA' ? new Date() : null,
            barridoNota:
              cobro.via === 'PASARELA'
                ? `Completado con ${cobro.fuente} · transacción ${cobro.txId}` +
                  (corregidas.length
                    ? ` · la comisión la había creado la pasarela sobre el plan viejo y se CORRIGIÓ: ` +
                      corregidas
                        .map(
                          (c) =>
                            `${c.id} $${c.de.toFixed(2)} → $${c.a.toFixed(2)}`,
                        )
                        .join(', ') +
                      '.'
                    : '') +
                  (pagadasSinTocar.length
                    ? ` · ⚠️ ${pagadasSinTocar.length} comisión(es) de la pasarela NO se tocaron (ya pagadas, o de un beneficiario fuera de la cadena): ` +
                      pagadasSinTocar
                        .map((c) => `${c.id} $${c.monto.toFixed(2)}`)
                        .join(', ') +
                      `. Habría que pagarle sobre $${plan.base.toFixed(2)}: REVISAR A MANO.`
                    : '') +
                  (ingresoCorregido
                    ? ` · el ingreso ya estaba en Contabilidad y se CORRIGIÓ (de $${ingresoCorregido.de.toFixed(2)} a $${ingresoCorregido.a.toFixed(2)}, categoría UPGRADE, periodicidad ANUAL): se enlazó, no se duplicó.`
                    : yaEstaba
                      ? ' · el ingreso ya estaba en Contabilidad y ya era correcto: se enlazó, no se duplicó.'
                      : '') +
                  (nadieCobro && plan.tieneAfiliado
                    ? ' · ⚠️ se completó SIN NINGUNA COMISIÓN teniendo el negocio afiliado: REVISAR A MANO.'
                    : '')
                : null,
            ...sello,
          },
        });
        if (sellado.count !== 1) {
          throw new Error(
            'El acta dejó de estar pendiente mientras se aplicaba el upgrade (¿se anuló, o entró otro proceso?): no se aplicó nada.',
          );
        }
        const fila = await tx.planUpgrade.findUnique({ where: { id: upgradeId } });
        return {
          sellado: fila,
          pagoId,
          ingresoId,
          comisiones,
          totalComision,
          comisionDeLaPasarela,
          corregidas,
          pagadasSinTocar,
          ingresoCorregido,
          basesCongeladas,
          referidosRevividos: revividos.count,
          omitida,
        };
      }, OPCIONES_DE_TRANSACCION);

      invalidateTenantStatusCache(t.id);

      this.audit.log({
        actorId,
        tenantId: t.id,
        action: 'tenant.plan_upgraded',
        resource: `plan_upgrade:${upgradeId}`,
        metadata: {
          brandName: t.brandName,
          operationRef,
          via: cobro.via,
          de: periodicidadOrigen,
          a: 'ANUAL',
          paidAmountUsd: paid,
          standardPriceUsd,
          effectiveAt: effectiveAt.toISOString(),
          nextRenewalAt: nextRenewalAt.toISOString(),
          previousPeriodEnd: t.currentPeriodEnd?.toISOString() ?? null,
          acortaCoberturaPrevia: periodoDelCobro.acorta,
          manualPaymentId: aplicado.pagoId,
          incomeRecordId: aplicado.ingresoId,
          gatewayTxId: cobro.via === 'PASARELA' ? cobro.txId : null,
          comisiones: aplicado.comisiones.length,
          comisionTotalUsd: aplicado.totalComision,
          comisionOmitidaMotivo: aplicado.omitida,
          // La comisión que había creado la pasarela sobre el plan VIEJO, y
          // qué se pudo hacer con ella. Lo que queda en `pagadasSinTocar` es
          // dinero mal pagado que hay que mirar a mano.
          comisionesDeLaPasarelaCorregidas: aplicado.corregidas,
          comisionesDeLaPasarelaSinTocar: aplicado.pagadasSinTocar,
          ingresoCorregido: aplicado.ingresoCorregido,
          // Cuántas comisiones vivas del negocio se quedaron con la base
          // PRE-upgrade congelada. No cambia ningún importe: es lo que evita
          // que el arqueo y «Corregir todo» las suban al precio del anual.
          basesCongeladas: aplicado.basesCongeladas,
          baseCongeladaUsd: basePreUpgrade,
          // Afiliados que la cancelación en la pasarela había dado de baja y
          // el upgrade devolvió a PAYING.
          referidosRevividos: aplicado.referidosRevividos,
          // Qué precio pactado se retiró del negocio (null = no tenía).
          precioPactadoAnterior,
          cancelacionEstado: sello.cancelacionEstado,
          cancelacionRef: sello.cancelacionRef,
        },
      });

      if (aplicado.omitida?.startsWith(REVISAR)) {
        // A gritos: un upgrade cobrado que deja al afiliado sin su comisión no
        // se puede quedar en un campo de la tabla. Además del log, el acta va
        // marcada y sale en `GET /tenants/upgrades/cancelaciones-pendientes`.
        this.logger.warn(
          `UPGRADE ${upgradeId} de «${t.brandName}» COBRADO ($${paid}) y con la comisión SIN RESOLVER ` +
            `(${aplicado.omitida}). Sale en el endpoint de pendientes: hay que mirarlo a mano.`,
        );
      }

      return this.respuesta(aplicado.sellado, {
        repetido: false,
        revisar: aplicado.omitida?.startsWith(REVISAR)
          ? {
              motivo: aplicado.omitida,
              comisionesSinTocar: aplicado.pagadasSinTocar,
              baseQueCorresponde: plan.base,
            }
          : undefined,
      });
    } catch (e: any) {
      const motivo = (e as Error)?.message ?? 'error desconocido';
      // El rollback dejó al negocio como estaba. El acta se queda para que se
      // vea que se intentó y por qué no salió.
      //
      // `updateMany` CONDICIONAL, no `update`: la causa más probable de llegar
      // aquí es justamente que alguien ANULÓ el acta mientras se aplicaba (el
      // sello de arriba tira con `count !== 1`). Un `update` a secas le pisaría
      // el CANCELADO con FALLIDO… y el barrido reintenta los FALLIDO de
      // pasarela cada 30 minutos, así que un upgrade anulado acabaría
      // aplicándose solo. El estado en el WHERE lo hace imposible.
      await this.prisma.planUpgrade
        .updateMany({
          where: { id: upgradeId, estado: { in: ['PENDIENTE', 'FALLIDO'] } },
          data: { estado: 'FALLIDO', motivoDeFallo: motivo.slice(0, 2000) },
        })
        .catch(() => null);
      this.audit.log({
        actorId,
        tenantId: t.id,
        action: 'tenant.plan_upgrade_failed',
        resource: `plan_upgrade:${upgradeId}`,
        metadata: { brandName: t.brandName, operationRef, via: cobro.via, motivo },
      });
      this.logger.error(
        `Upgrade a anual FALLIDO para ${t.brandName} (${t.id}): ${motivo}`,
      );
      if (e instanceof BadRequestException || e instanceof NotFoundException) throw e;
      throw new BadRequestException(
        `No se pudo aplicar el upgrade y no quedó nada a medias: ${motivo}`,
      );
    }
  }

  // ─────────────────────────────── Historial ───────────────────────────────

  async historial(tenantId: string) {
    const t = await this.cargarNegocio(tenantId);
    const upgrades = await this.prisma.planUpgrade.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
    return {
      tenantId: t.id,
      brandName: t.brandName,
      periodicidadActual: normalizePlanPeriod(t.planPeriodicity),
      upgrades: upgrades.map((u) => this.respuesta(u, { repetido: false })),
    };
  }

  // ──────────────────────────────── Anular ────────────────────────────────

  /**
   * Anula un upgrade. Es un acta ADMINISTRATIVA, no una reversión.
   *
   * Para qué existe:
   *
   *  · Si el proceso muere entre la reserva del acta y la transacción, queda un
   *    PENDIENTE que **bloquea para siempre** cualquier upgrade futuro de ese
   *    negocio (el único parcial solo deja uno vivo) y nadie puede cerrarlo.
   *  · Y porque un upgrade se puede hacer al negocio equivocado o con el monto
   *    equivocado, y hace falta poder rehacerlo.
   *
   * **Lo que NO hace, y la respuesta lo dice con estas palabras:** no devuelve
   * el plan a su periodicidad anterior, no deshace el cobro y no anula la
   * comisión del afiliado. Deshacer dinero desde aquí sería peor: el ingreso ya
   * está cuadrado en Contabilidad y la comisión puede estar pagada. Lo que haya
   * que arreglar a mano queda listado en la respuesta y en la auditoría.
   */
  async anular(
    tenantId: string,
    upgradeId: string,
    actorId: string,
    motivo: string,
  ) {
    const t = await this.cargarNegocio(tenantId);
    const razon = (motivo ?? '').trim();
    if (razon.length < 5) {
      throw new BadRequestException(
        'Anular un upgrade exige un motivo: es lo único que explica, dentro de seis meses, por qué se liberó el candado de este negocio.',
      );
    }
    const u = await this.prisma.planUpgrade.findFirst({
      where: { id: upgradeId, tenantId },
    });
    if (!u) throw new NotFoundException('Upgrade no encontrado para este negocio.');
    if (u.estado === 'CANCELADO') {
      // Idempotente: anularlo dos veces no reescribe quién lo anuló ni por qué.
      return {
        ...this.respuesta(u, { repetido: true }),
        advertencia: ADVERTENCIA_DE_ANULACION,
        quedaPorArreglarAMano: this.loQueNoRevierteLaAnulacion(u),
      };
    }

    const ahora = new Date();
    const estadoAlAnular = u.estado;
    // UPDATE condicional: si otro proceso lo anuló o lo completó entre el
    // findFirst y esto, el `count` viene en 0 y no pisamos su acta.
    const r = await this.prisma.planUpgrade.updateMany({
      where: { id: u.id, estado: { not: 'CANCELADO' } },
      data: {
        estado: 'CANCELADO',
        estadoAlAnular,
        anuladoAt: ahora,
        anuladoActorId: actorId,
        anuladoMotivo: razon,
      },
    });
    const fresca = await this.prisma.planUpgrade.findUnique({ where: { id: u.id } });
    if (!r.count) {
      return {
        ...this.respuesta(fresca ?? u, { repetido: true }),
        advertencia: ADVERTENCIA_DE_ANULACION,
        quedaPorArreglarAMano: this.loQueNoRevierteLaAnulacion(fresca ?? u),
      };
    }

    const pendiente = this.loQueNoRevierteLaAnulacion(fresca ?? u);
    this.audit.log({
      actorId,
      tenantId,
      action: 'tenant.plan_upgrade_anulado',
      resource: `plan_upgrade:${u.id}`,
      metadata: {
        brandName: t.brandName,
        motivo: razon,
        estadoAlAnular,
        // Lo que SIGUE aplicado en producción después de anular. Es el dato que
        // hace falta para arreglarlo a mano, y el que se pierde si solo se
        // guarda «anulado».
        periodicidadDelNegocio: normalizePlanPeriod(t.planPeriodicity),
        nextRenewalAt: u.nextRenewalAt?.toISOString() ?? null,
        manualPaymentId: u.manualPaymentId,
        gatewayTxId: u.gatewayTxId,
        incomeRecordId: u.incomeRecordId,
        comisionesCreadas: u.comisionesCreadas,
        commissionAmount:
          u.commissionAmount == null ? null : Number(u.commissionAmount),
        precioPactadoAnterior:
          u.precioPactadoAnterior == null ? null : Number(u.precioPactadoAnterior),
        quedaPorArreglarAMano: pendiente,
      },
    });

    return {
      ...this.respuesta(fresca ?? u, { repetido: false }),
      advertencia: ADVERTENCIA_DE_ANULACION,
      quedaPorArreglarAMano: pendiente,
    };
  }

  /** Qué sigue aplicado tras anular. Vacío si el acta nunca llegó a aplicar. */
  private loQueNoRevierteLaAnulacion(u: any): string[] {
    const aplicado = u.estadoAlAnular === 'COMPLETADO' || u.estado === 'COMPLETADO';
    if (!aplicado) return [];
    const lista: string[] = [
      `El negocio SIGUE en plan ANUAL con renovación el ${u.nextRenewalAt?.toISOString().slice(0, 10) ?? '(?)'}. ` +
        `Si hay que devolverlo a ${u.periodicidadOrigen}, hazlo desde «Cambiar periodicidad».`,
    ];
    if (u.manualPaymentId) {
      lista.push(
        `El cobro de $${Number(u.paidAmountUsd).toFixed(2)} sigue registrado como pago manual (${u.manualPaymentId}). ` +
          'Si el dinero se devolvió, anúlalo también ahí.',
      );
    }
    if (u.gatewayTxId) {
      lista.push(
        `El cobro entró por la pasarela (transacción ${u.gatewayTxId}). La devolución se hace en el panel de la pasarela, no aquí.`,
      );
    }
    if (u.incomeRecordId) {
      lista.push(
        `El ingreso ${u.incomeRecordId} sigue en Contabilidad con categoría UPGRADE.`,
      );
    }
    if (u.comisionesCreadas > 0) {
      lista.push(
        `Se crearon ${u.comisionesCreadas} comisión(es) por $${Number(u.commissionAmount ?? 0).toFixed(2)} ` +
          `(periodKey UPG-…-${String(u.id).slice(0, 8)}). Si el upgrade no debía existir, recházalas a mano.`,
      );
    }
    if (u.precioPactadoAnterior != null) {
      lista.push(
        `El negocio tenía un precio pactado de $${Number(u.precioPactadoAnterior).toFixed(2)} y el upgrade lo dejó vacío. ` +
          'Si el acuerdo sigue en pie, vuelve a ponérselo.',
      );
    }
    return lista;
  }

  // ──────────────────── Cancelación en la pasarela ────────────────────────

  /**
   * Qué se escribe en el acta sobre la suscripción vieja.
   *
   * Desde que la confirmación es OBLIGATORIA para crear el upgrade (ver la
   * cabecera de la clase), un acta nueva nunca nace con la cancelación
   * PENDIENTE: o no había nada que cancelar (`NO_APLICA`), o quien lo creó
   * afirmó que ya la canceló (`MANUAL_CONFIRMADA`, con actor y fecha).
   *
   * Aquí ya no hay hueco para una cancelación automática, y es deliberado: en
   * Railway solo existe `HOTMART_HOTTOK` (el token con el que se VERIFICAN los
   * webhooks que llegan), no hay client id/secret para llamar a la API de
   * Hotmart, y de Stripe no hay clave de plataforma. Una «cancelación
   * automática» sería mentira, y el guardián (`vigilarCobrosViejos`) cubre el
   * caso de que la confirmación no fuera cierta.
   */
  private selloDeCancelacion(
    cancelacion: { estado: 'PENDIENTE' | 'NO_APLICA'; ref: string | null },
    actorId: string | null,
    ahora: Date,
  ): SelloDeCancelacion {
    if (cancelacion.estado === 'NO_APLICA') {
      return {
        cancelacionEstado: 'NO_APLICA',
        cancelacionRef: null,
        cancelacionAt: null,
        cancelacionActorId: null,
        cancelacionMotivo: null,
      };
    }
    return {
      cancelacionEstado: 'MANUAL_CONFIRMADA',
      cancelacionRef: cancelacion.ref,
      cancelacionAt: ahora,
      cancelacionActorId: actorId,
      cancelacionMotivo:
        'Quien creó el upgrade confirmó que ya había cancelado la suscripción anterior en el panel de la pasarela.',
    };
  }

  /**
   * Un humano canceló la suscripción vieja en el panel de la pasarela y lo
   * confirma aquí. Queda quién y cuándo.
   *
   * Sigue existiendo para las actas de antes de que la confirmación fuera
   * obligatoria: son las únicas que pueden estar en PENDIENTE o FALLIDA.
   */
  async confirmarCancelacionManual(
    tenantId: string,
    upgradeId: string,
    actorId: string,
    nota?: string,
  ) {
    const t = await this.cargarNegocio(tenantId);
    const u = await this.prisma.planUpgrade.findFirst({
      where: { id: upgradeId, tenantId },
    });
    if (!u) throw new NotFoundException('Upgrade no encontrado para este negocio.');
    if (u.cancelacionEstado === 'NO_APLICA') {
      throw new BadRequestException(
        'Este negocio no tenía suscripción que cancelar en la pasarela.',
      );
    }
    // Idempotente: confirmarlo dos veces no reescribe quién lo hizo ni cuándo.
    if (
      u.cancelacionEstado === 'MANUAL_CONFIRMADA' ||
      u.cancelacionEstado === 'HECHA'
    ) {
      return this.respuesta(u, { repetido: true });
    }
    const actualizado = await this.prisma.planUpgrade.update({
      where: { id: u.id },
      data: {
        cancelacionEstado: 'MANUAL_CONFIRMADA',
        cancelacionAt: new Date(),
        cancelacionActorId: actorId,
        cancelacionMotivo: nota ?? 'Cancelada a mano en el panel de la pasarela.',
      },
    });
    this.audit.log({
      actorId,
      tenantId,
      action: 'tenant.plan_upgrade_cancelacion_confirmada',
      resource: `plan_upgrade:${u.id}`,
      metadata: {
        brandName: t.brandName,
        cancelacionRef: u.cancelacionRef,
        nota: nota ?? null,
      },
    });
    return this.respuesta(actualizado, { repetido: false });
  }

  /**
   * La pantalla del pendiente: todo lo que un upgrade dejó a medias.
   *
   *  · `items` — suscripciones viejas que siguen vivas en la pasarela (solo
   *    actas anteriores a que la confirmación fuera obligatoria).
   *  · `cobrosViejos` — negocios a los que el guardián tuvo que restaurar la
   *    fecha de renovación porque entró un cobro del ciclo anterior. Aquí es
   *    donde aparece la comisión nueva que hay que revisar a mano.
   *  · `porPasarela` — actas esperando a que entre el pago del plan anual.
   *  · `comisionesARevisar` — upgrades COBRADOS cuya comisión quedó sin
   *    resolver: o se completó con 0 comisiones teniendo el negocio un
   *    afiliado, o la comisión que creó la pasarela ya estaba PAGADA (por el
   *    plan viejo) y no se puede retractar. Es dinero de alguien; lo tiene que
   *    mirar una persona. Sin este bloque el aviso vivía solo en un campo de la
   *    tabla que no sale en ningún listado.
   */
  async cancelacionesPendientes(horas = 24) {
    const limite = new Date(Date.now() - horas * 3_600_000);
    const filas = await this.prisma.planUpgrade.findMany({
      where: {
        estado: 'COMPLETADO',
        cancelacionEstado: { in: ['PENDIENTE', 'FALLIDA'] },
      },
      orderBy: { createdAt: 'asc' },
    });
    const conCobroViejo = await this.prisma.planUpgrade.findMany({
      where: { estado: 'COMPLETADO', cobroViejoDetectadoAt: { not: null } },
      orderBy: { cobroViejoUltimoAt: 'desc' },
    });
    const porPasarela = await this.prisma.planUpgrade.findMany({
      where: { estado: { in: ['PENDIENTE', 'FALLIDO'] }, metodo: 'PASARELA' },
      orderBy: { createdAt: 'asc' },
    });
    const comisionesARevisar = await this.prisma.planUpgrade.findMany({
      where: {
        estado: 'COMPLETADO',
        comisionOmitidaMotivo: { startsWith: REVISAR },
      },
      orderBy: { createdAt: 'desc' },
    });
    const vencidas = filas.filter((f) => f.createdAt.getTime() <= limite.getTime());
    return {
      total: filas.length,
      vencidas: vencidas.length,
      horas,
      comisionesARevisar: comisionesARevisar.map((f) => ({
        id: f.id,
        tenantId: f.tenantId,
        createdAt: f.createdAt,
        motivo: f.comisionOmitidaMotivo,
        /** Qué pasó, en una frase que se puede leer en el panel. */
        queHayQueMirar:
          f.comisionOmitidaMotivo?.startsWith(REVISAR_SIN_COMISION)
            ? 'El upgrade se cobró pero NO generó ninguna comisión, y el negocio SÍ tiene afiliado. ' +
              'Hay alguien sin cobrar: revisa la cadena de atribución y créala a mano si procede.'
            : 'La comisión de este cobro la creó la pasarela sobre el precio del plan VIEJO y ya ' +
              'estaba PAGADA (o es de un beneficiario fuera de la cadena), así que el upgrade NO la ' +
              'tocó. Se le pagó de menos al afiliado: decide a mano si se le compensa.',
        paidAmountUsd: Number(f.paidAmountUsd),
        commissionId: f.commissionId,
        commissionAmount:
          f.commissionAmount == null ? null : Number(f.commissionAmount),
        gatewayTxId: f.gatewayTxId,
        metodo: f.metodo,
        /** El detalle largo: qué se corrigió y qué no. */
        barridoNota: f.barridoNota,
      })),
      items: filas.map((f) => ({
        id: f.id,
        tenantId: f.tenantId,
        createdAt: f.createdAt,
        horasSinCerrar: Math.floor((Date.now() - f.createdAt.getTime()) / 3_600_000),
        cancelacionEstado: f.cancelacionEstado,
        cancelacionRef: f.cancelacionRef,
        cancelacionMotivo: f.cancelacionMotivo,
        avisadaEl: f.cancelacionAlertaAt,
        vencida: f.createdAt.getTime() <= limite.getTime(),
      })),
      cobrosViejos: conCobroViejo.map((f) => ({
        id: f.id,
        tenantId: f.tenantId,
        detectadoEl: f.cobroViejoDetectadoAt,
        ultimaVez: f.cobroViejoUltimoAt,
        veces: f.cobroViejoVeces,
        /** La fecha corta que había escrito el cobro viejo. */
        renovacionPisada: f.cobroViejoPeriodEnd,
        /** A la que se restauró (la del upgrade). */
        renovacionRestaurada: f.nextRenewalAt,
        /** Comisiones posteriores al upgrade: NO se tocaron. Revisar a mano. */
        comisionesParaRevisar: (f.cobroViejoComisiones ?? '')
          .split(',')
          .filter(Boolean),
        cancelacionRef: f.cancelacionRef,
      })),
      porPasarela: porPasarela.map((f) => ({
        id: f.id,
        tenantId: f.tenantId,
        estado: f.estado,
        createdAt: f.createdAt,
        horasEsperando: Math.floor(
          (Date.now() - f.createdAt.getTime()) / 3_600_000,
        ),
        paidAmountUsd: Number(f.paidAmountUsd),
        barridoAt: f.barridoAt,
        barridoNota: f.barridoNota,
      })),
    };
  }

  /**
   * Aviso diario: qué upgrades llevan más de 24 h con la suscripción vieja sin
   * cancelar.
   *
   * Deja MARCA EN LA BASE (`cancelacionAlertaAt`) además del log y la
   * auditoría, a propósito: el fallo que no queremos repetir es el
   * `logger.warn` que no lee nadie. Con la columna, el pendiente se puede
   * consultar desde el panel y desde SQL, y no depende de que alguien mire los
   * logs del día correcto.
   *
   * **Se conserva la fecha del PRIMER aviso.** Antes se reescribía cada día, y
   * el dato que importa —«esto lleva sin cerrar desde el 3»— se perdía: la
   * columna acababa diciendo siempre «hoy», que es justo lo que no hace falta
   * saber. El `updateMany` filtra por `cancelacionAlertaAt: null`.
   *
   * A las 5 UTC = medianoche en Bogotá, después del conciliador de las 4.
   * (El servidor va en UTC y ningún `@Cron` del repo fija zona.)
   */
  @Cron(CronExpression.EVERY_DAY_AT_5AM, { name: 'upgrades.cancelaciones-pendientes' })
  async avisarCancelacionesPendientes() {
    const informe = await this.cancelacionesPendientes(24);
    if (!informe.vencidas) return informe;
    const ahora = new Date();
    const ids = informe.items.filter((i) => i.vencida).map((i) => i.id);
    await this.prisma.planUpgrade.updateMany({
      where: { id: { in: ids }, cancelacionAlertaAt: null },
      data: { cancelacionAlertaAt: ahora },
    });
    this.logger.warn(
      `UPGRADES: ${informe.vencidas} suscripción(es) vieja(s) sin cancelar en la pasarela más de 24 h. ` +
        `Se les puede estar cobrando el plan anterior ADEMÁS del anual: ` +
        ids.map((id) => id.slice(0, 8)).join(', '),
    );
    this.audit.log({
      actorId: null,
      action: 'tenant.plan_upgrade_cancelacion_pendiente',
      resource: 'plan_upgrade',
      metadata: {
        vencidas: informe.vencidas,
        total: informe.total,
        ids,
      },
    });
    return informe;
  }

  // ───────────────────── Guardián del cobro viejo ─────────────────────────

  /**
   * EL GUARDIÁN. Arregla el síntoma del cobro viejo sin tocar el código de
   * cobro.
   *
   * Qué mira: un negocio con upgrade COMPLETADO cuyo `currentPeriodEnd` quedó
   * POR DEBAJO del `nextRenewalAt` que escribió el upgrade. Eso solo puede
   * pasar de una manera: entró un cobro del ciclo ANTERIOR (Hotmart
   * `date_next_charge` del mensual, Stripe el fin del período de la suscripción
   * vieja) y pisó la fecha. El negocio tiene el año pagado y sin embargo
   * aparece vencido; el cron de mora lo suspendería.
   *
   * Qué hace: lo restaura a `nextRenewalAt` con un UPDATE CONDICIONAL —el
   * `where` repite la comparación y el `count` dice si de verdad lo movimos
   * nosotros—, limpia los dedup de aviso (si no, el negocio no recibe ningún
   * recordatorio del ciclo bueno) y lo deja anotado en el acta y en la
   * auditoría, visible en el endpoint de pendientes.
   *
   * Qué NO hace:
   *
   *  · **No toca las comisiones.** Si encuentra una comisión del negocio
   *    posterior al upgrade —muy probablemente la que generó ese cobro viejo,
   *    y que habrá que devolver— la deja señalada. Anularla sola sería mover
   *    dinero de un afiliado sin que nadie lo haya mirado.
   *  · **No reactiva un negocio suspendido.** Activar consume el crédito de la
   *    marca y dispara el webhook de activación; eso lo decide una persona por
   *    el camino que ya existe. Se avisa a gritos en el log y en el informe.
   *
   * A las 6 UTC = 1 de la madrugada en Bogotá, después del conciliador (4 UTC)
   * y del aviso de cancelaciones (5 UTC), y ANTES del cron de mora.
   */
  @Cron(CronExpression.EVERY_DAY_AT_6AM, { name: 'upgrades.guardian-cobro-viejo' })
  async vigilarCobrosViejos(opts: { simular?: boolean } = {}) {
    const simular = opts.simular === true;
    const ahora = new Date();
    const upgrades = await this.prisma.planUpgrade.findMany({
      where: { estado: 'COMPLETADO' },
      orderBy: { createdAt: 'asc' },
    });

    const restaurados: Array<{
      upgradeId: string;
      tenantId: string;
      brandName: string | null;
      estadoDelNegocio: string;
      renovacionPisada: string;
      renovacionRestaurada: string;
      comisionesParaRevisar: string[];
    }> = [];

    for (const u of upgrades) {
      const t = await this.prisma.tenant.findUnique({
        where: { id: u.tenantId },
        select: {
          id: true,
          brandName: true,
          status: true,
          deletedAt: true,
          planPeriodicity: true,
          currentPeriodEnd: true,
        },
      });
      if (!t || t.deletedAt) continue;
      // Si a alguien le bajaron el plan a mano después del upgrade, la fecha
      // del acta ya no manda: restaurarla sería pelearse cada noche con la
      // decisión de una persona. El guardián solo cuida negocios que SIGUEN en
      // anual — que son en los que el cobro viejo hace daño.
      if (normalizePlanPeriod(t.planPeriodicity) !== 'ANUAL') continue;
      if (
        !t.currentPeriodEnd ||
        t.currentPeriodEnd.getTime() >= u.nextRenewalAt.getTime()
      ) {
        continue;
      }
      const pisada = t.currentPeriodEnd;

      if (!simular) {
        // UPDATE condicional: si entre la lectura y ahora alguien ya la
        // arregló (o entró un cobro BUENO que la adelantó), el `count` viene en
        // 0 y no pisamos nada. Es el patrón contra leer-decidir-escribir.
        const r = await this.prisma.tenant.updateMany({
          where: { id: t.id, currentPeriodEnd: { lt: u.nextRenewalAt } },
          data: {
            currentPeriodEnd: u.nextRenewalAt,
            failedPaymentCount: 0,
            firstFailedAt: null,
            // Los dedup de aviso se comparan contra `currentPeriodEnd`: si el
            // cobro viejo ya disparó los recordatorios de la fecha corta, sin
            // limpiarlos el negocio no recibiría ninguno del ciclo bueno.
            preReminder7dSentFor: null,
            preReminder3dSentFor: null,
            preReminderTodaySentFor: null,
            paymentReminderSentFor: null,
            paymentFailureNoticeSentAt: null,
            pausePendingNoticeSentAt: null,
          },
        });
        if (!r.count) continue;
        invalidateTenantStatusCache(t.id);
      }

      // La comisión que el cobro viejo pudo haber creado. NO se toca.
      //
      // Las del PROPIO upgrade no cuentan, y son dos clases: la que crea este
      // servicio (`upgrade:<id>`) y —cuando el upgrade se cobró por pasarela—
      // la que había creado la pasarela por esa misma transacción y el upgrade
      // corrigió. Sin excluir la segunda, el guardián la listaba cada noche
      // como «comisión posterior sospechosa» y mandaba a revisar a mano la
      // comisión buena del upgrade.
      const delPropioUpgrade = [`upgrade:${u.id}`];
      if (u.gatewayTxId) delPropioUpgrade.push(u.gatewayTxId);
      const comisiones = await this.prisma.commission.findMany({
        where: {
          referralUse: { tenantId: t.id },
          createdAt: { gt: u.createdAt },
          status: { notIn: ['REJECTED', 'ADJUSTMENT'] },
          // El OR es necesario: un `NOT { externalTxId: { in: [...] } }` a
          // secas deja fuera las filas con `externalTxId` NULL, que en SQL no
          // son «distintas de» nada.
          OR: [
            { externalTxId: null },
            { NOT: { externalTxId: { in: delPropioUpgrade } } },
          ],
        },
        select: { id: true, amount: true, periodKey: true, createdAt: true },
      });
      const idsComisiones = comisiones.map((c) => c.id);

      if (!simular) {
        // La PRIMERA detección se conserva: «esto viene pasando desde el 3» es
        // el dato útil, no «lo vi hoy».
        await this.prisma.planUpgrade.updateMany({
          where: { id: u.id, cobroViejoDetectadoAt: null },
          data: { cobroViejoDetectadoAt: ahora },
        });
        await this.prisma.planUpgrade.update({
          where: { id: u.id },
          data: {
            cobroViejoUltimoAt: ahora,
            cobroViejoVeces: { increment: 1 },
            cobroViejoPeriodEnd: pisada,
            cobroViejoComisiones: idsComisiones.join(',') || null,
          },
        });
        this.audit.log({
          actorId: null,
          tenantId: t.id,
          action: 'tenant.plan_upgrade_cobro_viejo_restaurado',
          resource: `plan_upgrade:${u.id}`,
          metadata: {
            brandName: t.brandName,
            estadoDelNegocio: t.status,
            renovacionPisada: pisada.toISOString(),
            renovacionRestaurada: u.nextRenewalAt.toISOString(),
            cancelacionRef: u.cancelacionRef,
            // Se listan, no se tocan: las revisa una persona.
            comisionesParaRevisar: comisiones.map((c) => ({
              id: c.id,
              monto: Number(c.amount),
              periodKey: c.periodKey,
              creada: c.createdAt.toISOString(),
            })),
          },
        });
        this.logger.warn(
          `UPGRADE: a «${t.brandName}» le entró un cobro del ciclo viejo — la renovación ` +
            `había bajado a ${pisada.toISOString().slice(0, 10)} y se restauró a ` +
            `${u.nextRenewalAt.toISOString().slice(0, 10)}. ` +
            (idsComisiones.length
              ? `Hay ${idsComisiones.length} comisión(es) posterior(es) al upgrade SIN TOCAR: revisar si hay que devolverlas.`
              : 'Sin comisiones nuevas.') +
            (t.status !== 'ACTIVE'
              ? ` ⚠️ El negocio está en ${t.status}: el guardián NO lo reactiva, hay que hacerlo a mano.`
              : ''),
        );
      }

      restaurados.push({
        upgradeId: u.id,
        tenantId: t.id,
        brandName: t.brandName,
        estadoDelNegocio: t.status,
        renovacionPisada: pisada.toISOString(),
        renovacionRestaurada: u.nextRenewalAt.toISOString(),
        comisionesParaRevisar: idsComisiones,
      });
    }

    return { simulado: simular, revisados: upgrades.length, restaurados };
  }

  // ─────────────────── Barrido del cobro por pasarela ─────────────────────

  /**
   * Completa los upgrades por PASARELA cuando entra el pago.
   *
   * NO llama a Hotmart ni a Stripe y NO toca sus servicios: lee los avisos que
   * esas pasarelas YA guardaron (`HotmartWebhookEvent`, `StripeWebhookEvent`),
   * igual que el conciliador de ingresos. Si el aviso no está, no hay pago que
   * valga: el acta se queda en PENDIENTE y sale en el endpoint de pendientes
   * con la razón escrita en `barridoNota`.
   *
   * QUÉ EXIGE PARA COMPLETAR, y por qué tanto:
   *
   *  1. **Que el cobro sea del negocio del acta** — por `tenantId` del aviso,
   *     por el código de suscriptor / suscripción, o por el correo.
   *  2. **Que sea posterior al acta.** Un cobro de antes es del plan viejo.
   *  3. **Que sea del plan ANUAL.** Esto es lo importante: el negocio puede
   *     tener todavía viva la suscripción mensual, y su renovación entraría por
   *     aquí igual de «suya» y «posterior». Completar el upgrade con el cobro
   *     del mensual sería pasarlo a anual por $17. Hotmart se comprueba por el
   *     nombre del plan (`parsePlanPeriodLabel`); Stripe, por el intervalo del
   *     precio (`recurring.interval === 'year'`) o por el `stripePriceId` del
   *     enlace anual de la marca. Si no se puede afirmar, NO se completa: se
   *     anota y lo mira una persona.
   *  4. **Que el aviso haya reposado.** Al menos
   *     `MINUTOS_DE_REPOSO_DEL_AVISO`: el webhook guarda el aviso ANTES de
   *     crear su comisión, y completar en medio crea una comisión aquí y otra
   *     allí por el mismo cobro.
   *  5. **Que se pueda poner un importe en USD.** El del aviso si lo trae
   *     (`price`, `full_price` o `original_offer_price`, que es el que salva el
   *     caso real: 157 de 213 compras llegan en moneda local y ése viene en USD
   *     en 213 de 213). Si no, el `paidAmountUsd` del acta —lo que el
   *     administrador dijo que iba a cobrar—, y queda escrito en `barridoNota`
   *     de dónde salió el número. Lo que NO se hace es mandar a completarlo
   *     como MANUAL: eso crearía un pago manual y una comisión ADEMÁS de las
   *     que ya generó la pasarela por el mismo cobro.
   *
   * El acta se sella con `gatewayTxId` = la transacción, que es ÚNICO: un aviso
   * reenviado no puede completar dos veces.
   */
  @Cron(CronExpression.EVERY_30_MINUTES, { name: 'upgrades.barrido-pasarela' })
  async completarUpgradesPorPasarela(opts: { simular?: boolean } = {}) {
    const simular = opts.simular === true;
    // Apagado mientras el camino por pasarela no se estrene (ver `crear`). Sin
    // esto, el cron seguiría vivo aunque nadie pueda abrir un acta por esa vía:
    // un barrido que corrige comisiones ajenas no puede estar suelto «por si
    // acaso». La simulación sí se deja: sirve para probarlo sin escribir.
    if (!simular && process.env.UPGRADE_POR_PASARELA !== '1') {
      return { completados: [], revisados: 0, apagado: true as const };
    }
    // FALLIDO entra también: un acta por pasarela que se cayó al aplicarse no
    // la reintenta nadie —el POST original ya terminó hace días— y se quedaría
    // atascada para siempre con el dinero ya cobrado. El sello es condicional
    // sobre estos dos estados, así que reintentar es seguro.
    const pendientes = await this.prisma.planUpgrade.findMany({
      where: { estado: { in: ['PENDIENTE', 'FALLIDO'] }, metodo: 'PASARELA' },
      orderBy: { createdAt: 'asc' },
    });

    const completados: Array<{
      upgradeId: string;
      tenantId: string;
      txId: string;
      montoUsd: number;
    }> = [];
    const esperando: Array<{ upgradeId: string; tenantId: string; nota: string }> = [];

    for (const u of pendientes) {
      const t = await this.cargarNegocio(u.tenantId).catch(() => null);
      if (!t) {
        esperando.push({
          upgradeId: u.id,
          tenantId: u.tenantId,
          nota: 'El negocio ya no existe (borrado): anula el acta.',
        });
        continue;
      }

      const hallazgo = await this.cobroDelPlanAnual(t, u);
      if (!hallazgo || 'nota' in hallazgo) {
        const nota =
          hallazgo?.nota ??
          'Todavía no ha llegado ningún aviso de pago del plan anual para este negocio.';
        if (!simular) {
          await this.prisma.planUpgrade.update({
            where: { id: u.id },
            data: { barridoAt: new Date(), barridoNota: nota.slice(0, 2000) },
          });
        }
        esperando.push({ upgradeId: u.id, tenantId: t.id, nota });
        continue;
      }

      if (simular) {
        completados.push({
          upgradeId: u.id,
          tenantId: t.id,
          txId: hallazgo.txId,
          montoUsd: hallazgo.montoUsd,
        });
        continue;
      }

      // Desde aquí, EXACTAMENTE el mismo camino transaccional que el manual,
      // pero sin `ManualPayment`. La fecha efectiva es la del COBRO, no la de
      // la reserva del acta: el año se cuenta desde que el cliente pagó.
      const effectiveAt = hallazgo.cuando;
      try {
        const r = await this.aplicar({
          t,
          upgrade: u,
          periodicidadOrigen: normalizePlanPeriod(t.planPeriodicity),
          paid: hallazgo.montoUsd,
          currency: 'USD',
          effectiveAt,
          nextRenewalAt: addPlanPeriod(effectiveAt, 'ANUAL'),
          standardPriceUsd: Number(u.standardPriceUsd),
          actorId: u.actorId ?? null,
          sello: {
            cancelacionEstado: u.cancelacionEstado,
            cancelacionRef: u.cancelacionRef,
            cancelacionAt: u.cancelacionAt,
            cancelacionActorId: u.cancelacionActorId,
            cancelacionMotivo: u.cancelacionMotivo,
          },
          notas: u.notas ?? null,
          operationRef: u.operationRef,
          cobro: {
            via: 'PASARELA',
            gateway: hallazgo.gateway,
            txId: hallazgo.txId,
            fuente: hallazgo.fuente,
          },
        });
        completados.push({
          upgradeId: r.id,
          tenantId: t.id,
          txId: hallazgo.txId,
          montoUsd: hallazgo.montoUsd,
        });
        this.logger.log(
          `UPGRADE por pasarela COMPLETADO: «${t.brandName}» pagó $${hallazgo.montoUsd} (${hallazgo.txId}).`,
        );
      } catch (e) {
        // `aplicar` ya dejó el acta en FALLIDO con el motivo. El barrido sigue
        // con las demás: un acta rota no puede parar la cola.
        const motivo = (e as Error)?.message ?? 'error desconocido';
        esperando.push({ upgradeId: u.id, tenantId: t.id, nota: motivo });
        this.logger.error(
          `UPGRADE por pasarela de «${t.brandName}» no se pudo completar: ${motivo}`,
        );
      }
    }

    return {
      simulado: simular,
      revisados: pendientes.length,
      completados,
      esperando,
    };
  }

  /**
   * Busca en los avisos ya guardados el pago del plan ANUAL de este negocio.
   *
   * Devuelve el cobro, o `{ nota }` con lo que hay que contarle a la persona
   * que mire el pendiente, o `null` si sencillamente no ha llegado nada.
   */
  private async cobroDelPlanAnual(
    t: NegocioDeUpgrade,
    u: {
      id: string;
      createdAt: Date;
      whiteLabelId: string | null;
      /** Lo que el administrador dijo que se iba a cobrar. Es el respaldo
       *  cuando el aviso no trae ningún importe en dólares. */
      paidAmountUsd: unknown;
    },
  ): Promise<CobroDeLaPasarela | { nota: string } | null> {
    const correoDelNegocio = (t.email ?? '').toLowerCase();
    const montoDelActa = Number(u.paidAmountUsd);
    // El aviso tiene que haber REPOSADO. Ver `MINUTOS_DE_REPOSO_DEL_AVISO`: el
    // webhook guarda el aviso al principio y crea su comisión al final, así que
    // completar demasiado pronto nos hace crear una comisión y al webhook otra.
    const tope = new Date(Date.now() - MINUTOS_DE_REPOSO_DEL_AVISO * 60_000);
    const demasiadoReciente = (cuando: Date, tx: string) => ({
      nota:
        `Llegó el cobro del plan anual (${tx}) hace menos de ${MINUTOS_DE_REPOSO_DEL_AVISO} minutos ` +
        `(${cuando.toISOString()}). Se espera a que el webhook de la pasarela acabe de crear ` +
        'su comisión: completar ahora crearía una comisión aquí y otra allí por el mismo cobro. ' +
        'El barrido lo recoge en la pasada siguiente.',
    });

    // ── Hotmart ────────────────────────────────────────────────────────────
    const hot = await this.prisma.hotmartWebhookEvent.findMany({
      where: {
        processedAt: { gte: u.createdAt },
        eventType: { in: ['PURCHASE_APPROVED', 'PURCHASE_COMPLETE'] },
        // Acotado a los avisos que PUEDEN ser suyos: los que el webhook ya
        // resolvió a este negocio, y los que no resolvió a ninguno (ahí es
        // donde hace falta mirar el código de suscriptor o el correo). Uno
        // resuelto a OTRO negocio no es su pago, y sin este filtro habría que
        // traerse el payload entero de todas las compras de la plataforma.
        OR: [{ tenantId: t.id }, { tenantId: null }],
      },
      orderBy: { processedAt: 'asc' },
      take: 500,
      select: { eventType: true, tenantId: true, payload: true, processedAt: true },
    });
    let cobroViejoVisto: string | null = null;
    for (const e of hot) {
      const p = (e.payload ?? {}) as any;
      const compra = p?.data?.purchase ?? {};
      const tx: string | null = compra?.transaction ?? null;
      if (!tx) continue;
      const codigo: string | null = p?.data?.subscription?.subscriber?.code ?? null;
      const correo = String(p?.data?.buyer?.email ?? '').toLowerCase();
      const esDelNegocio =
        e.tenantId === t.id ||
        (!!codigo && codigo === t.hotmartSubscriberCode) ||
        (!!correoDelNegocio && correo === correoDelNegocio);
      if (!esDelNegocio) continue;

      const periodicidad = parsePlanPeriodLabel(p?.data?.subscription?.plan?.name);
      if (periodicidad !== 'ANUAL') {
        // Casi seguro el cobro del ciclo ANTERIOR, que es justo lo que no puede
        // completar el upgrade.
        cobroViejoVisto = `Entró un cobro de este negocio (${tx}${periodicidad ? `, plan ${periodicidad}` : ', plan sin identificar'}) pero NO es del plan anual: no completa el upgrade.`;
        continue;
      }
      if (e.processedAt.getTime() > tope.getTime()) {
        return demasiadoReciente(e.processedAt, tx);
      }
      const monto = this.montoEnUsdDeHotmart(compra);
      // Sin ningún importe en dólares queda el del acta: es lo que el
      // administrador dijo que iba a cobrar, y para eso lo pidió el POST. NO se
      // manda «complétalo como MANUAL» — eso crearía un `ManualPayment` y otra
      // comisión ADEMÁS de las que la pasarela ya generó por este mismo cobro.
      if (monto == null && !(montoDelActa > 0)) {
        return {
          nota:
            `Llegó el cobro del plan anual (${tx}) pero el aviso no trae ningún importe en USD ` +
            `(moneda: ${compra?.price?.currency_value ?? '?'}) y el acta tampoco tiene monto esperado. ` +
            'No se inventa un cambio. Corrige el monto del acta y el barrido la completa sola.',
        };
      }
      // MANDA EL MONTO DEL ACTA (Javier, 2026-09-21). El aviso de Hotmart llega
      // casi siempre en moneda local y el único dólar que trae es el «precio de
      // oferta original», que es una conversión suya: en un caso real dio
      // 522,38 por un plan de lista de 500. Se comisiona sobre lo que el
      // administrador registró, que es lo que se pactó con el cliente, y la
      // cifra de la pasarela queda anotada como referencia.
      return {
        gateway: 'HOTMART',
        txId: tx,
        montoUsd: montoDelActa > 0 ? centavos(montoDelActa) : (monto?.usd ?? 0),
        cuando: compra?.approved_date
          ? new Date(compra.approved_date)
          : e.processedAt,
        fuente:
          `HotmartWebhookEvent · ${e.eventType} · importe DEL ACTA ($${centavos(montoDelActa)})` +
          (monto ? `; la pasarela dijo $${monto.usd} en \`purchase.${monto.campo}\`` : '') +
          (montoDelActa > 0 ? '' : ' — el acta no traía monto, se usa el de la pasarela'),
      };
    }

    // ── Stripe ─────────────────────────────────────────────────────────────
    const enlace = await this.enlaceAnualDeLaMarca(u.whiteLabelId ?? t.whiteLabelId);
    const priceAnual = enlace?.stripePriceId ?? null;
    const str = await this.prisma.stripeWebhookEvent.findMany({
      where: {
        eventType: 'invoice.payment_succeeded',
        processedAt: { gte: u.createdAt },
        // Misma acotación que en Hotmart, y por lo mismo.
        OR: [{ tenantId: t.id }, { tenantId: null }],
      },
      orderBy: { processedAt: 'asc' },
      take: 500,
      select: { tenantId: true, payload: true, processedAt: true },
    });
    for (const e of str) {
      const o = (e.payload as any)?.data?.object ?? {};
      const id: string | null = o?.id ?? null;
      if (!id) continue;
      const correo = String(o?.customer_email ?? '').toLowerCase();
      const esDelNegocio =
        e.tenantId === t.id ||
        (!!t.stripeCustomerId && o?.customer === t.stripeCustomerId) ||
        (!!t.stripeSubscriptionId && o?.subscription === t.stripeSubscriptionId) ||
        (!!correoDelNegocio && correo === correoDelNegocio);
      if (!esDelNegocio) continue;

      const lineas: any[] = o?.lines?.data ?? [];
      const esAnual =
        lineas.some((l) => l?.price?.recurring?.interval === 'year') ||
        (!!priceAnual && lineas.some((l) => l?.price?.id === priceAnual));
      if (!esAnual) {
        cobroViejoVisto = `Entró un cobro de este negocio en Stripe (${id}) pero no es de un precio ANUAL: no completa el upgrade.`;
        continue;
      }
      if (e.processedAt.getTime() > tope.getTime()) {
        return demasiadoReciente(e.processedAt, id);
      }
      // Moneda local: `amount_paid` está en la unidad mínima de ESA moneda, así
      // que dividir entre 100 daría un número sin sentido. Queda el monto del
      // acta, igual que en Hotmart.
      const enUsd = String(o?.currency ?? 'usd').toLowerCase() === 'usd';
      const bruto = enUsd
        ? centavos(Number(o?.amount_paid ?? o?.amount ?? 0) / 100)
        : 0;
      if (!enUsd && !(montoDelActa > 0)) {
        return {
          nota:
            `Llegó el cobro anual de Stripe (${id}) en ${String(o?.currency).toUpperCase()} y el acta ` +
            'no tiene monto esperado. No se inventa un cambio: corrige el monto del acta y el ' +
            'barrido la completa sola.',
        };
      }
      if (enUsd && !(bruto > 0)) continue; // factura de $0: el día 0 de una prueba
      return {
        gateway: 'STRIPE',
        txId: id,
        montoUsd: enUsd ? bruto : centavos(montoDelActa),
        cuando: o?.status_transitions?.paid_at
          ? new Date(o.status_transitions.paid_at * 1000)
          : e.processedAt,
        fuente:
          'StripeWebhookEvent · invoice.payment_succeeded · importe ' +
          (enUsd
            ? `de la factura ($${bruto})`
            : `DEL ACTA ($${centavos(montoDelActa)}): la factura vino en ${String(o?.currency).toUpperCase()}`),
      };
    }

    return cobroViejoVisto ? { nota: cobroViejoVisto } : null;
  }

  /**
   * Cuánto se cobró DE VERDAD, en USD, según el aviso de Hotmart.
   *
   * Aquí sí manda el payload —al revés que en el conciliador, que refleja el
   * PLAN— porque este monto es la base de la comisión del upgrade: al afiliado
   * se le paga sobre lo que el negocio pagó.
   *
   * **`original_offer_price` es el campo que salva esto.** `price` y
   * `full_price` vienen en la moneda del COMPRADOR, y en producción eso es la
   * mayoría: de 213 compras de 90 días, 157 llegaron en moneda local (COP, PAB,
   * PEN, MXN, CLP, ARS, GTQ) — los 6 avisos de «Plan Anual», en COP. Con solo
   * esos dos campos el barrido NO completaba casi nunca.
   * `original_offer_price` trae el importe en la moneda de la OFERTA, y la
   * nuestra está en dólares: viene en USD en **213 de 213**. No es un cambio
   * inventado, lo calcula Hotmart (un cobro de 1.800.745,68 COP sale como
   * 522,38 USD).
   *
   * `currency_value`, no `currency_code`: es el campo que Hotmart rellena de
   * verdad en estos avisos.
   */
  private montoEnUsdDeHotmart(
    compra: any,
  ): { usd: number; campo: string } | null {
    const candidatos: Array<[string, any]> = [
      ['price', compra?.price],
      ['full_price', compra?.full_price],
      ['original_offer_price', compra?.original_offer_price],
    ];
    for (const [campo, precio] of candidatos) {
      const moneda = precio?.currency_value ?? precio?.currency_code ?? null;
      const valor = Number(precio?.value);
      if (moneda === 'USD' && Number.isFinite(valor) && valor > 0) {
        return { usd: centavos(valor), campo };
      }
    }
    return null;
  }

  /** El enlace de pago del plan ANUAL de la marca del negocio, si lo hay. */
  private async enlaceAnualDeLaMarca(whiteLabelId: string | null) {
    if (!whiteLabelId) return null;
    const l = await this.prisma.whiteLabelPaymentLink
      .findFirst({
        where: { whiteLabelId, periodicity: 'ANUAL', active: true },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          name: true,
          url: true,
          amountUsd: true,
          gateway: true,
          stripePriceId: true,
        },
      })
      .catch(() => null);
    if (!l) return null;
    return {
      id: l.id,
      nombre: l.name,
      url: l.url,
      montoUsd: Number(l.amountUsd),
      pasarela: l.gateway,
      stripePriceId: l.stripePriceId,
    };
  }

  // ─────────────────────────────── Internos ───────────────────────────────

  private async cargarNegocio(tenantId: string) {
    const t = await this.prisma.tenant.findFirst({
      where: { id: tenantId }, // aislado por marca (middleware)
      select: {
        id: true,
        brandName: true,
        email: true,
        status: true,
        deletedAt: true,
        whiteLabelId: true,
        planId: true,
        plan: { select: { id: true, name: true } },
        planPeriodicity: true,
        subscriptionPriceUsd: true,
        currentPeriodEnd: true,
        commissionDistributionMode: true,
        hotmartSubscriberCode: true,
        stripeCustomerId: true,
        stripeSubscriptionId: true,
      },
    });
    if (!t || t.deletedAt) throw new NotFoundException('Negocio no encontrado.');
    return t as NegocioDeUpgrade;
  }

  /** El upgrade «vivo» del negocio (el que bloquea el único parcial). */
  private upgradeVivo(tenantId: string) {
    return this.prisma.planUpgrade.findFirst({
      where: { tenantId, estado: { in: ['PENDIENTE', 'COMPLETADO'] } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Por qué este negocio no se puede pasar a anual. `null` = sí se puede.
   * Los mensajes los lee un humano en el panel: dicen qué hacer, no un código.
   */
  private porQueNoSePuede(
    t: {
      status: string;
      plan: { name: string } | null;
    },
    periodicidadActual: string,
    vivo: { estado: string } | null,
  ): string | null {
    if (periodicidadActual === 'ANUAL') {
      return 'Este negocio ya está en plan ANUAL: no hay nada que subir. Si lo que hace falta es cobrarle la renovación, usa «Registrar pago».';
    }
    if (!t.plan || t.plan.name === 'Sin plan') {
      return 'Este negocio no tiene un plan asignado. Asígnale el plan antes de pasarlo a anual.';
    }
    // SUSPENDIDO o en PRUEBA no entran por aquí a propósito: los dos necesitan
    // ACTIVAR el negocio, y activar consume el crédito de la marca blanca y
    // dispara el webhook de activación. Ese camino ya existe y lo hace bien
    // («Registrar pago» / «Marcar como pagado»). Un upgrade que activara por la
    // puerta de atrás se saltaría el cobro del crédito.
    if (t.status !== 'ACTIVE') {
      return t.status === 'SUSPENDED'
        ? 'El negocio está suspendido. Reactívalo con «Registrar pago» (eso consume el crédito de la marca) y después súbelo a anual.'
        : 'El negocio todavía está en prueba. Actívalo con «Registrar pago» o «Marcar como pagado» y después súbelo a anual.';
    }
    if (vivo) {
      return vivo.estado === 'COMPLETADO'
        ? 'Este negocio ya tiene un upgrade a anual aplicado.'
        : 'Este negocio tiene un upgrade a medias.';
    }
    return null;
  }

  /**
   * Qué suscripción habría que cancelar en la pasarela, si es que hay alguna.
   *
   * Los códigos `manual-…` y `trial-…` NO son suscripciones: se los inventa el
   * panel al crear un negocio a mano para que no salte el bloqueo de cobro.
   * Tratarlos como cancelables dejaría un pendiente eterno que nadie puede
   * cerrar porque no existe — y, ahora que la confirmación es obligatoria,
   * bloquearía el upgrade de un negocio que no tiene nada que cancelar.
   */
  private refDeCancelacion(t: {
    hotmartSubscriberCode: string | null;
    stripeSubscriptionId: string | null;
  }): { estado: 'PENDIENTE' | 'NO_APLICA'; ref: string | null } {
    const hot = (t.hotmartSubscriberCode ?? '').trim();
    const esReal = hot && !/^(manual|trial)-/i.test(hot);
    const ref = esReal ? hot : (t.stripeSubscriptionId ?? '').trim() || null;
    return ref ? { estado: 'PENDIENTE', ref } : { estado: 'NO_APLICA', ref: null };
  }

  /**
   * Prepara la comisión del upgrade: base, cadena, porcentajes y filas.
   *
   * **La base es el monto REALMENTE PAGADO**, no el canónico del anual. Es la
   * única diferencia de fondo con el motor de siempre, y es la decisión del
   * negocio: si alguien pagó 350 por pasar a anual, al afiliado se le paga
   * sobre 350, no sobre los 500 de la lista.
   *
   * Los porcentajes salen de los MISMOS sitios que usa el motor —la excepción
   * por negocio (`CommissionExceptionsService.resolvePercent`) y el Setting
   * `referrals.indirectPercent`—, así que una excepción configurada se respeta
   * igual aquí.
   */
  private async comisionDelUpgrade(
    t: {
      id: string;
      whiteLabelId: string | null;
      commissionDistributionMode: string;
    },
    base: number,
  ): Promise<{
    base: number;
    modo: ModoDeReparto;
    filas: FilaDeComision[];
    referralUseId: string | null;
    motivo: string | null;
    /**
     * El negocio tiene afiliado, dé o no dé filas este reparto. Es lo que
     * distingue «no le toca comisión a nadie» de «alguien se está quedando sin
     * cobrar»: con esto en true y 0 comisiones, el acta se marca para revisar.
     */
    tieneAfiliado: boolean;
    socio: { codeId: string; pct: number; amount: number; referralUseId: string | null } | null;
  }> {
    // ¿Hay ALGUIEN detrás de este negocio? Sin filtro de estado a propósito:
    // un use CHURNED —el que deja la cancelación que exigimos antes de
    // cobrar— sigue siendo un afiliado al que hay que pagarle.
    const tieneAfiliado =
      (await this.prisma.referralUse.count({ where: { tenantId: t.id } })) > 0;

    const vacio = {
      base,
      modo: (t.commissionDistributionMode ?? 'DISCOUNT_FROM_INFLUENCER') as ModoDeReparto,
      filas: [] as FilaDeComision[],
      referralUseId: null,
      tieneAfiliado,
      socio: null,
    };

    // Marcas de PAGO ÚNICO (Sellea): pagan un monto fijo UNA vez por referido.
    // Un upgrade no es un referido nuevo, así que no genera otro pago fijo —
    // misma regla que la comisión de implementación, que las bloquea.
    const modoDeMarca = await this.referrals.getBrandCommissionModeByWhiteLabelId(
      t.whiteLabelId ?? null,
    );
    if (modoDeMarca === 'FIXED_ONCE') {
      // Aquí NO hay nada que revisar: que no haya comisión es la regla de la
      // marca, no un fallo. Por eso se declara «sin afiliado» a estos efectos.
      return { ...vacio, tieneAfiliado: false, motivo: 'marca-pago-unico' };
    }

    // Primero la cadena normal. Si sale vacía, se vuelve a mirar incluyendo los
    // CHURNED: para subir a anual hay que cancelar la suscripción vieja en la
    // pasarela, y ese aviso da de baja TODOS los `ReferralUse` del negocio.
    // Sin este segundo intento, el upgrade se completaría con 0 comisiones
    // justo después de que el administrador hiciera lo que le pedimos. El
    // `updateMany` de la transacción los devuelve a PAYING.
    let cadena = await this.referrals.getAttributionChain(t.id);
    if (!cadena.sourceCodeId) {
      const conChurned = await this.referrals.getAttributionChain(t.id, {
        incluirChurned: true,
      });
      if (conChurned.sourceCodeId) cadena = conChurned;
    }
    if (!cadena.sourceCodeId) return { ...vacio, motivo: 'sin-afiliado' };

    const use = await this.prisma.referralUse.findFirst({
      where: { tenantId: t.id, referralCodeId: cadena.sourceCodeId },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (!use) return { ...vacio, motivo: 'sin-afiliado' };

    // El influencer cobra su % completo solo si la venta la hizo ÉL directo. Si
    // entró por un embajador es INDIRECTO y cobra `referrals.indirectPercent`.
    const esIndirecto =
      !!cadena.influencer && cadena.influencer.id !== cadena.sourceCodeId;
    const influencerFallback = esIndirecto
      ? await this.pctIndirecto()
      : (cadena.influencer?.commissionPercent ?? 0);
    const influencerPct = cadena.influencer
      ? await this.excepciones.resolvePercent(
          t.id,
          cadena.influencer.id,
          influencerFallback,
        )
      : 0;
    const embajadorPct = cadena.embajador
      ? await this.excepciones.resolvePercent(
          t.id,
          cadena.embajador.id,
          cadena.embajador.commissionPercent,
        )
      : 0;
    const vendorPctCrudo = cadena.vendor
      ? await this.excepciones.resolvePercent(
          t.id,
          cadena.vendor.id,
          cadena.vendor.commissionPercent,
        )
      : 0;

    const modo = vacio.modo;
    const filas = filasDeComisionDelUpgrade({
      base,
      cadena,
      influencerPct,
      embajadorPct,
      vendorPctCrudo,
      modo,
    });
    if (!filas.length) return { ...vacio, motivo: 'base-o-pct-0' };

    return {
      base,
      modo,
      filas,
      referralUseId: use.id,
      motivo: null,
      tieneAfiliado,
      socio: await this.socio(t.id, base),
    };
  }

  /** % indirecto del influencer (Setting `referrals.indirectPercent`, def. 5). */
  private async pctIndirecto(): Promise<number> {
    const row = await this.prisma.setting.findUnique({
      where: { key: 'referrals.indirectPercent' },
    });
    const n = row?.value != null ? Number(row.value) : NaN;
    return Number.isFinite(n) && n >= 0 ? n : 5;
  }

  /** El socio de la plataforma, si está configurado (hoy no lo está). */
  private async socio(tenantId: string, base: number) {
    const row = await this.prisma.setting.findUnique({
      where: { key: 'referrals.socioCodeId' },
    });
    if (!row?.value) return null;
    const code = await this.prisma.referralCode.findUnique({
      where: { id: row.value },
      select: { id: true, role: true, isActive: true, commissionPercent: true },
    });
    if (!code || code.role !== 'SOCIO' || !code.isActive) return null;
    const pct = Number(code.commissionPercent ?? COMMISSION_DEFAULTS.socioPct);
    const amount = Math.round(base * pct) / 100;
    if (!(amount > 0)) return null;
    const use = await this.prisma.referralUse.findFirst({
      where: { referralCodeId: code.id, tenantId },
      select: { id: true },
    });
    return { codeId: code.id, pct, amount, referralUseId: use?.id ?? null };
  }

  /** Forma única de devolver un upgrade (los Decimal salen como número). */
  private respuesta(
    u: any,
    opts: {
      repetido: boolean;
      enlaceDePago?: Awaited<ReturnType<PlanUpgradeService['enlaceAnualDeLaMarca']>>;
      aviso?: string;
      /** El upgrade se cobró pero la comisión quedó sin resolver. */
      revisar?: {
        motivo: string;
        comisionesSinTocar: Array<{ id: string; monto: number }>;
        baseQueCorresponde: number;
      };
    },
  ) {
    return {
      id: u.id,
      tenantId: u.tenantId,
      operationRef: u.operationRef,
      estado: u.estado,
      de: u.periodicidadOrigen,
      a: u.periodicidadDestino,
      standardPriceUsd: Number(u.standardPriceUsd),
      paidAmountUsd: Number(u.paidAmountUsd),
      currency: u.currency,
      metodo: u.metodo,
      effectiveAt: u.effectiveAt,
      nextRenewalAt: u.nextRenewalAt,
      manualPaymentId: u.manualPaymentId,
      incomeRecordId: u.incomeRecordId,
      gatewayTxId: u.gatewayTxId,
      commissionId: u.commissionId,
      commissionAmount:
        u.commissionAmount == null ? null : Number(u.commissionAmount),
      comisionesCreadas: u.comisionesCreadas,
      comisionOmitidaMotivo: u.comisionOmitidaMotivo,
      motivoDeFallo: u.motivoDeFallo,
      notas: u.notas,
      /** El override de precio que el upgrade retiró del negocio. */
      precioPactadoAnterior:
        u.precioPactadoAnterior == null ? null : Number(u.precioPactadoAnterior),
      cancelacion: {
        estado: u.cancelacionEstado,
        referencia: u.cancelacionRef,
        cuando: u.cancelacionAt,
        quien: u.cancelacionActorId,
        motivo: u.cancelacionMotivo,
        avisadaEl: u.cancelacionAlertaAt,
      },
      /** Qué encontró el barrido de la pasarela la última vez que pasó. */
      barrido: {
        cuando: u.barridoAt ?? null,
        nota: u.barridoNota ?? null,
      },
      /** Si le entró un cobro del ciclo viejo y el guardián lo restauró. */
      cobroViejo: u.cobroViejoDetectadoAt
        ? {
            detectadoEl: u.cobroViejoDetectadoAt,
            ultimaVez: u.cobroViejoUltimoAt,
            veces: u.cobroViejoVeces,
            renovacionPisada: u.cobroViejoPeriodEnd,
            comisionesParaRevisar: (u.cobroViejoComisiones ?? '')
              .split(',')
              .filter(Boolean),
          }
        : null,
      anulacion: u.anuladoAt
        ? {
            cuando: u.anuladoAt,
            quien: u.anuladoActorId,
            motivo: u.anuladoMotivo,
            estadoAlAnular: u.estadoAlAnular,
          }
        : null,
      createdAt: u.createdAt,
      /** true = este POST no cobró nada: devolvió lo que ya existía. */
      repetido: opts.repetido,
      ...(opts.enlaceDePago !== undefined
        ? { enlaceDePago: opts.enlaceDePago }
        : {}),
      ...(opts.aviso ? { aviso: opts.aviso } : {}),
      /**
       * El upgrade SE APLICÓ, pero la comisión quedó sin resolver. Va en la
       * RESPUESTA además de en el acta y en el endpoint de pendientes: quien
       * pulsó el botón tiene que enterarse ahí mismo, no dentro de un mes.
       */
      ...(opts.revisar
        ? {
            revisarComision: {
              ...opts.revisar,
              advertencia:
                opts.revisar.motivo.startsWith(REVISAR_SIN_COMISION)
                  ? 'El cobro se aplicó pero NO se generó ninguna comisión, y este negocio SÍ tiene ' +
                    'afiliado. Revisa su cadena de atribución: hay alguien que se queda sin cobrar.'
                  : `La comisión de este cobro la había creado la pasarela sobre el precio del plan VIEJO ` +
                    `y no se pudo corregir (ya estaba pagada, o su beneficiario está fuera de la cadena). ` +
                    `Le correspondía sobre $${opts.revisar.baseQueCorresponde.toFixed(2)}.`,
            },
          }
        : {}),
    };
  }
}

/** El negocio, tal como lo lee este servicio. */
type NegocioDeUpgrade = {
  id: string;
  brandName: string;
  email: string;
  status: string;
  deletedAt: Date | null;
  whiteLabelId: string | null;
  planId: string | null;
  plan: { id: string; name: string } | null;
  planPeriodicity: string | null;
  subscriptionPriceUsd: unknown;
  currentPeriodEnd: Date | null;
  commissionDistributionMode: string;
  hotmartSubscriberCode: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
};
