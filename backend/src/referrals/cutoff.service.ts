import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CommissionStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import {
  resolveBrandScope,
  brandWhiteLabelWhere,
} from '../common/white-label/brand-scope.util';
import { AuditService } from '../audit/audit.service';
import { ReferralsService } from './referrals.service';
import { batchTotal, recalcBatchTotal } from './payout-batch.util';
import { nombreDePlan } from './plan-label';
import { revisarComprobante } from './comprobante-de-pago';
import {
  addDaysYmd,
  bogotaDayEndUtc,
  bogotaHour,
  bogotaNoonUtc,
  bogotaYmd,
  cutoffCode,
  cutoffDaysInRange,
  cutoffLabel,
  cutoffPeriod,
  daysBetweenYmd,
  isCutoffDay,
  nextCutoffYmd,
  ymdFromCutoffCode,
} from './cutoff-calendar';
import { PreregAlertsService } from '../auth/prereg-alerts.service';

// Mismo hold que referrals.service (COMMISSION_HOLD_DAYS). Solo se usa para el
// fallback legacy de comisiones sin `availableAt`.
const COMMISSION_HOLD_DAYS = 15;

// Un corte ABIERTO más de estos días es una alerta en el panel: alguien
// transfirió y no lo registró (o nadie transfirió). Es exactamente el caso del
// 31/07 que estuvo semanas mostrándose como pendiente.
const STALE_OPEN_BATCH_DAYS = 5;

// Cuántos días atrás barre el cron buscando cortes que nunca se generaron
// (deploy caído, DB en mantenimiento). Idempotente: los que ya existen se saltan.
const CATCHUP_LOOKBACK_DAYS = 45;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Comisiones que un corte puede liquidar: desbloqueadas, sin pagar y con dueño. */
const PAYABLE_BASE = {
  status: CommissionStatus.APPROVED,
  paymentStatus: { in: ['PENDING', 'PARTIAL'] },
  recipientCodeId: { not: null },
} satisfies Prisma.CommissionWhereInput;

/**
 * Qué comisiones PERTENECEN a un corte por fecha — se hayan pagado ya o no.
 *
 * Un corte es un período contable, no una cola de pago: dice qué se devengó en
 * esa ventana. Que ya se haya transferido no la saca del período.
 *
 * FIX 2026-08-31: se usaba `PAYABLE_BASE` también para enganchar, y ese exige
 * «aprobada y pendiente de pago». Así que una comisión pagada ANTES de que su
 * corte se generara quedaba fuera para siempre — el corte, cuando nacía, ya no
 * la veía.
 *
 * Pasó de verdad: 9 comisiones de Nicolás Quintero, creadas entre el 1 y el 13
 * de agosto y pagadas todas el 24, pertenecían al corte del 31. Ese corte se
 * generó una semana después de cobrarlas y no las miró. El historial mostraba
 * 17 comisiones por $205.40 cuando en realidad se habían pagado 21 por $303.85.
 *
 * Se excluyen las que siguen retenidas (PENDING) — esas pertenecen a un corte
 * posterior — y las anuladas (REJECTED).
 */
const ATTACHABLE_BASE = {
  status: { in: [CommissionStatus.APPROVED, CommissionStatus.PAID] },
  recipientCodeId: { not: null },
} satisfies Prisma.CommissionWhereInput;

/** Campos que necesita la vista del corte (mismos para lo pagable y lo en hold). */
const CUTOFF_ROW_SELECT = {
  id: true,
  amount: true,
  amountPaid: true,
  businessDate: true,
  createdAt: true,
  availableAt: true,
  payoutBatchId: true,
  payoutBatch: { select: { code: true } },
  recipientCode: {
    select: {
      id: true,
      code: true,
      ownerName: true,
      ownerEmail: true,
      role: true,
      ownerUserId: true,
    },
  },
  referralUse: {
    select: {
      tenant: {
        select: {
          id: true,
          brandName: true,
          planPeriodicity: true,
          plan: { select: { name: true } },
        },
      },
    },
  },
  businessGroup: { select: { id: true, name: true } },
} satisfies Prisma.CommissionSelect;

type CutoffRow = Prisma.CommissionGetPayload<{
  select: typeof CUTOFF_ROW_SELECT;
}>;

type PersonBucket = {
  codeId: string;
  code: string;
  ownerName: string;
  ownerEmail: string;
  role: string;
  paymentMethod: string | null;
  // APPROVED = puede cobrar hoy · el resto = falta completar/aprobar datos.
  profileStatus: string;
  canTransfer: boolean;
  commissionsCount: number;
  totalUsd: number;
  commissions: Array<{
    id: string;
    amount: number;
    date: Date;
    availableAt: Date;
    daysRemaining: number;
    businessName: string;
    planName: string | null;
    // A qué corte pertenece (importa cuando hay más de uno abierto).
    batchCode: string | null;
  }>;
};

/**
 * CORTES AUTOMÁTICOS DE COMISIONES.
 *
 * El corte se ABRE solo (cron de calendario: día 15 y último de cada mes en
 * hora Bogotá) y lo CIERRA una persona cuando confirma que la transferencia
 * salió del banco. Nunca se cierra automático: el sistema no sabe si el dinero
 * se movió, y un corte marcado "pagado" sobre plata que sigue en la cuenta
 * esconde la deuda con el afiliado. El error al revés (corte abierto que ya se
 * pagó) es visible y molesto — que es lo que uno quiere de un error.
 */
@Injectable()
export class CutoffService {
  private readonly logger = new Logger(CutoffService.name);

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private referrals: ReferralsService,
    private prereg: PreregAlertsService,
  ) {}

  /** Número interno que recibe los avisos del flujo de pago de cortes. */
  private static readonly PAYOUT_ALERT_PHONE = '+12125550752';

  /** Etiqueta "Corte N" del lote, para los SMS. */
  private cutoffLabelFor(code: string): string {
    const ymd = ymdFromCutoffCode(code);
    return ymd ? cutoffLabel(ymd).label : code;
  }

  // ── CRON ──────────────────────────────────────────────────────────────────

  /**
   * Tick HORARIO. Dos responsabilidades, ambas idempotentes:
   *
   *  1. **Abrir el corte apenas empieza su día.** El corte del 15 existe desde
   *     las 00:00 del 15, no del 16: durante todo el día se ve en el panel con
   *     lo que ya está disponible. (Antes se generaba "ayer fue día de corte" y
   *     el 15 entero el panel decía "sin corte abierto" — parecía que no pasaba
   *     nada justo el día que importa.)
   *  2. **Seguir absorbiendo hasta que el día cierre.** El desbloqueo del hold
   *     (`promotePendingToApproved`) corre a las 22:00 de Bogotá, así que hay
   *     comisiones que se habilitan DURANTE el día del corte. El top-up horario
   *     las mete en el corte que les corresponde. Lo que se desbloquea el 16 ya
   *     no entra: cada corte solo absorbe lo de SU ventana (ver `dayWindowWhere`).
   *
   * Se pregunta "¿hoy es día de corte?" en vez de expresarlo en sintaxis cron:
   * "último día del mes" no se puede escribir sin hardcodear 28/29/30/31.
   */
  @Cron('0 * * * *', { name: 'commissions.auto-cutoff' })
  async runCutoffTick() {
    const today = bogotaYmd();
    const isMidnightTick = bogotaHour() === 0;
    try {
      if (isMidnightTick) {
        // Desbloqueo del hold: se llama UNA vez al día para no alterar la
        // cadencia existente del cron de las 3AM UTC (idempotente, pero no
        // queremos adelantar plata respecto de cómo venía funcionando).
        await this.referrals.promotePendingToApproved();

        // Catch-up: cortes de los últimos 45 días que nunca se generaron
        // (deploy caído, DB en mantenimiento). Los que ya existen se saltan.
        const from = addDaysYmd(today, -CATCHUP_LOOKBACK_DAYS);
        for (const ymd of cutoffDaysInRange(from, addDaysYmd(today, -1))) {
          const res = await this.generateCutoff(ymd, { auto: true });
          if (res.created || res.attached > 0) {
            this.logger.log(
              `auto-cutoff catch-up ${res.code}: ${res.created ? 'creado' : 'ya existía'}, +${res.attached} comisiones, total $${res.totalUsd}`,
            );
          }
        }
      }

      // 1) El corte de HOY, si hoy toca. Nace abierto y visible de inmediato.
      if (isCutoffDay(today)) {
        const res = await this.generateCutoff(today, { auto: true });
        if (res.created) {
          this.logger.log(
            `auto-cutoff ${res.code} ABIERTO con ${res.attached} comisiones ($${res.totalUsd}).`,
          );
        }
      }

      // 2) Top-up de los cortes abiertos con lo que se haya desbloqueado
      //    dentro de su propia ventana.
      const added = await this.topUpOpenBatches();
      if (added > 0) {
        this.logger.log(`auto-cutoff top-up: +${added} comisiones a cortes abiertos.`);
      }
    } catch (e: any) {
      this.logger.error(`auto-cutoff falló (${today}): ${e?.message ?? e}`);
    }
  }

  /**
   * Mete en cada corte ABIERTO lo que se desbloqueó dentro de SU ventana y
   * todavía no tiene corte. Es lo que hace que el corte del 15 —abierto desde
   * las 00:00— termine el día conteniendo también lo que se habilitó a las
   * 22:00. Un corte nunca absorbe algo de un día posterior al suyo.
   */
  private async topUpOpenBatches(): Promise<number> {
    const open = await this.prisma.payoutBatch.findMany({
      where: { status: 'OPEN' },
      select: { id: true, code: true, cutoffDate: true },
    });
    let total = 0;
    for (const b of open) {
      const res = await this.prisma.commission.updateMany({
        where: {
          ...ATTACHABLE_BASE,
          payoutBatchId: null,
          // Un corte cuya fecha YA PASÓ no acumula: está esperando que lo
          // cierren. Solo el vigente absorbe lo adelantado.
          ...this.dayWindowWhere(
            bogotaYmd(b.cutoffDate),
            bogotaYmd(b.cutoffDate) >= bogotaYmd(new Date()),
          ),
        },
        data: { payoutBatchId: b.id },
      });
      if (res.count > 0) {
        total += res.count;
        await this.recalcBatchTotal(this.prisma, b.id);
      }
    }
    return total;
  }

  // ── GENERACIÓN ────────────────────────────────────────────────────────────

  /**
   * Genera (o completa) el corte de la fecha `ymd`. IDEMPOTENTE: el lote se
   * upsertea por `code` y las comisiones se adjuntan solo si NO tienen corte,
   * así que correrlo dos veces el mismo día no duplica nada ni mueve plata.
   *
   * Qué entra: lo DISPONIBLE para pagar (hold de 15 días cumplido) dentro de la
   * ventana de ese día y sin corte previo — ver `dayWindowWhere`. Lo que sigue
   * en hold NO entra: cae en el corte siguiente cuando se desbloquee, salvo que
   * se libere DURANTE este mismo día, en cuyo caso lo recoge el top-up horario.
   *
   * Si no hubo nada disponible el corte se crea igual en $0: un mes sin corte
   * se lee como un corte perdido, y la continuidad de la serie es justamente lo
   * que la contadora usa para saber que no falta plata.
   */
  async generateCutoff(
    ymd: string,
    opts?: { auto?: boolean; actorId?: string },
  ): Promise<{
    code: string;
    batchId: string;
    created: boolean;
    attached: number;
    totalUsd: number;
    skippedNoRecipient: number;
  }> {
    if (!isCutoffDay(ymd)) {
      throw new BadRequestException(
        `${ymd} no es día de corte (se corta el 15 y el último día de cada mes).`,
      );
    }
    const code = cutoffCode(ymd);
    const period = cutoffPeriod(ymd);

    // 1) El lote, idempotente por `code` (UNIQUE). Si dos ejecuciones corren a
    // la vez, la perdedora choca contra el unique y relee la ganadora en vez de
    // reventar: el corte del día es uno solo.
    const existing = await this.prisma.payoutBatch.findUnique({
      where: { code },
      select: { id: true, status: true },
    });
    let batch = existing;
    if (!batch) {
      try {
        batch = await this.prisma.payoutBatch.create({
          data: {
            code,
            cutoffDate: bogotaNoonUtc(ymd),
            periodStart: bogotaNoonUtc(period.start),
            periodEnd: bogotaNoonUtc(period.end),
            kind: 'CORTE',
            status: 'OPEN',
            generatedAuto: !!opts?.auto,
            paymentDate: null,
            totalUsd: 0,
          },
          select: { id: true, status: true },
        });
      } catch (e: any) {
        if (e?.code !== 'P2002') throw e;
        batch = await this.prisma.payoutBatch.findUniqueOrThrow({
          where: { code },
          select: { id: true, status: true },
        });
      }
    }
    const created = !existing;

    // Un corte ya CERRADO no vuelve a admitir comisiones (el dinero ya salió).
    if (batch.status === 'CLOSED') {
      const total = await this.batchTotal(this.prisma, batch.id);
      return {
        code,
        batchId: batch.id,
        created,
        attached: 0,
        totalUsd: total,
        skippedNoRecipient: 0,
      };
    }

    // 2) Adjuntar lo disponible de SU ventana que todavía no tiene corte.
    const attached = await this.prisma.commission.updateMany({
      where: {
        ...ATTACHABLE_BASE,
        payoutBatchId: null,
        // Generación explícita de ESTE corte: se lleva también lo habilitado
        // a mano, que es justo para lo que se habilitó.
        ...this.dayWindowWhere(ymd, true),
      },
      data: { payoutBatchId: batch.id },
    });

    // Las que no tienen destinatario no se le pueden transferir a nadie: quedan
    // fuera del corte a propósito, pero se loguean para que no desaparezcan.
    const skippedNoRecipient = await this.prisma.commission.count({
      where: {
        status: CommissionStatus.APPROVED,
        paymentStatus: { in: ['PENDING', 'PARTIAL'] },
        recipientCodeId: null,
        payoutBatchId: null,
      },
    });
    if (skippedNoRecipient > 0) {
      this.logger.warn(
        `${code}: ${skippedNoRecipient} comisiones disponibles SIN destinatario (recipientCodeId null) quedaron fuera del corte.`,
      );
    }

    const totalUsd = await this.recalcBatchTotal(this.prisma, batch.id);

    if (created || attached.count > 0) {
      await this.audit.log({
        actorId: opts?.actorId ?? null,
        action: created ? 'commission.batch_generated' : 'commission.batch_filled',
        resource: `payout_batch:${batch.id}`,
        metadata: {
          code,
          cutoffYmd: ymd,
          period,
          auto: !!opts?.auto,
          attached: attached.count,
          totalUsd,
          skippedNoRecipient,
        },
      });
    }

    return {
      code,
      batchId: batch.id,
      created,
      attached: attached.count,
      totalUsd,
      skippedNoRecipient,
    };
  }

  /** Disparo manual del generador (botón "generar corte" del panel). */
  async generateCutoffManual(user: AuthUser, ymd?: string) {
    this.assertAdmin(user);
    const target = ymd?.trim() || addDaysYmd(bogotaYmd(), -1);
    await this.referrals.promotePendingToApproved();
    return this.generateCutoff(target, { auto: false, actorId: user.id });
  }

  // ── LECTURA: EL CORTE ACTUAL ──────────────────────────────────────────────

  /**
   * Todo lo que necesita la pestaña "Corte actual" en UNA sola llamada, sin
   * filtros: cuánto hay que pagar hoy, a quién, qué entra al próximo corte y
   * cuándo. Es la respuesta a la única pregunta que se hace todos los días.
   */
  async currentCutoff(user: AuthUser) {
    this.assertAdmin(user);

    // AISLAMIENTO POR MARCA: un SUPER_ADMIN de marca blanca solo ve las
    // comisiones de SU marca (por recipientCode). PayoutBatch es global (sin
    // whiteLabelId), pero los importes/filas que muestra la vista salen de las
    // comisiones, que sí se scopean. Default a Clubify (nunca "ver todo").
    const scope = await resolveBrandScope(this.prisma, user.whiteLabelId);
    const brandCode = brandWhiteLabelWhere(scope);
    const brandCommWhere: Prisma.CommissionWhereInput = Object.keys(brandCode)
      .length
      ? { recipientCode: brandCode }
      : {};

    const today = bogotaYmd();
    const nextYmd = nextCutoffYmd(today);

    // TODOS los cortes abiertos, no solo el último: si nadie cerró el del 15 y
    // ya se generó el del 31, hay dos abiertos y la plata del primero NO puede
    // desaparecer de la vista (es el caso del 31/07 otra vez). El "principal"
    // es el MÁS VIEJO — el que urge cerrar.
    const openBatches = await this.prisma.payoutBatch.findMany({
      where: { status: 'OPEN' },
      orderBy: { cutoffDate: 'asc' },
    });
    const openIds = openBatches.map((b) => b.id);

    // Filas de los cortes abiertos (lo transferible HOY). Si todavía no hay
    // ninguno, mostramos como PREVIEW lo que ya está desbloqueado y sin corte:
    // es lo que va a contener el próximo. El panel nunca queda en blanco.
    const isPreview = openIds.length === 0;
    const [rows, holdRows] = await Promise.all([
      this.prisma.commission.findMany({
        where: openIds.length
          ? { ...PAYABLE_BASE, payoutBatchId: { in: openIds }, ...brandCommWhere }
          : { ...PAYABLE_BASE, payoutBatchId: null, ...brandCommWhere },
        select: CUTOFF_ROW_SELECT,
        orderBy: { createdAt: 'asc' },
      }),
      // Lo que sigue BLOQUEADO por el hold: no se puede seleccionar ni pagar,
      // pero se muestra para que se entienda de dónde sale el próximo corte.
      this.prisma.commission.findMany({
        where: {
          status: CommissionStatus.PENDING,
          paymentStatus: { in: ['PENDING', 'PARTIAL'] },
          recipientCodeId: { not: null },
          ...brandCommWhere,
        },
        select: CUTOFF_ROW_SELECT,
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    // Perfiles de pago: quién puede recibir la transferencia hoy y quién no.
    const userIds = Array.from(
      new Set(
        [...rows, ...holdRows]
          .map((r) => r.recipientCode?.ownerUserId)
          .filter((x): x is string => !!x),
      ),
    );
    const profiles = userIds.length
      ? await this.prisma.paymentProfile.findMany({
          where: { userId: { in: userIds } },
          select: { userId: true, status: true, method: true },
        })
      : [];
    const profileByUser = new Map(profiles.map((p) => [p.userId, p]));

    const people = this.groupByPerson(rows, profileByUser);
    const holdPeople = this.groupByPerson(holdRows, profileByUser);

    const toPayNow = round2(people.reduce((s, p) => s + p.totalUsd, 0));
    const readyToTransfer = round2(
      people.filter((p) => p.canTransfer).reduce((s, p) => s + p.totalUsd, 0),
    );
    const blockedByPaymentData = round2(toPayNow - readyToTransfer);

    // Lo que entra al PRÓXIMO corte = lo que sigue en hold + lo que ya se
    // desbloqueó DESPUÉS de generarse el corte abierto (todavía sin lote).
    const holdAmount = round2(holdPeople.reduce((s, p) => s + p.totalUsd, 0));
    const nextRelease =
      holdPeople
        .flatMap((p) => p.commissions.map((c) => c.availableAt))
        .filter((d): d is Date => !!d)
        .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

    let unbatchedAmount = 0;
    let unbatchedCount = 0;
    if (!isPreview) {
      const orphans = await this.prisma.commission.findMany({
        where: { ...PAYABLE_BASE, payoutBatchId: null, ...brandCommWhere },
        select: { amount: true, amountPaid: true },
      });
      unbatchedCount = orphans.length;
      unbatchedAmount = round2(
        orphans.reduce(
          (s, r) => s + Math.max(0, Number(r.amount) - Number(r.amountPaid)),
          0,
        ),
      );
    }

    // Totales por corte abierto (para listarlos y poder cerrar cada uno).
    const totalsByBatch = new Map<string, { amount: number; count: number }>();
    for (const c of rows) {
      const bid = c.payoutBatchId;
      if (!bid) continue;
      const cur = totalsByBatch.get(bid) ?? { amount: 0, count: 0 };
      cur.amount = round2(
        cur.amount + Math.max(0, Number(c.amount) - Number(c.amountPaid)),
      );
      cur.count += 1;
      totalsByBatch.set(bid, cur);
    }
    const openBatchesOut = openBatches.map((b) => {
      const d = daysBetweenYmd(bogotaYmd(b.cutoffDate), today);
      const tot = totalsByBatch.get(b.id) ?? { amount: 0, count: 0 };
      return {
        id: b.id,
        code: b.code,
        cutoffDate: b.cutoffDate,
        periodStart: b.periodStart,
        periodEnd: b.periodEnd,
        status: b.status,
        totalUsd: tot.amount,
        commissionsCount: tot.count,
        generatedAuto: b.generatedAuto,
        createdAt: b.createdAt,
        daysOpen: d,
        isStale: d > STALE_OPEN_BATCH_DAYS,
      };
    });

    return {
      today,
      holdDays: COMMISSION_HOLD_DAYS,
      staleAfterDays: STALE_OPEN_BATCH_DAYS,
      isPreview,
      // El corte principal = el MÁS VIEJO abierto (el que urge cerrar).
      openBatch: openBatchesOut[0] ?? null,
      // Todos los abiertos: con dos abiertos a la vez, ninguno se esconde.
      openBatches: openBatchesOut,
      nextCutoff: {
        date: nextYmd,
        daysUntil: daysBetweenYmd(today, nextYmd),
      },
      toPay: {
        amount: toPayNow,
        count: rows.length,
        people: people.length,
        readyToTransfer,
        readyPeople: people.filter((p) => p.canTransfer).length,
        blockedByPaymentData,
        blockedPeople: people.filter((p) => !p.canTransfer).length,
      },
      nextBatch: {
        // Total que caerá en el próximo corte (hold + ya desbloqueado sin lote).
        amount: round2(holdAmount + unbatchedAmount),
        holdAmount,
        holdCount: holdRows.length,
        holdPeopleCount: holdPeople.length,
        releasesAt: nextRelease,
        unbatchedAmount,
        unbatchedCount,
      },
      people,
      holdPeople,
    };
  }

  /**
   * Agrupa comisiones por AFILIADO — que es la pregunta real del día ("¿a quién
   * le giro y cuánto?"). El detalle comisión por comisión queda adentro como
   * respaldo, no como vista principal.
   */
  private groupByPerson(
    rows: CutoffRow[],
    profileByUser: Map<string, { status: string; method: string | null }>,
  ): PersonBucket[] {
    const byPerson = new Map<string, PersonBucket>();
    for (const c of rows) {
      const rc = c.recipientCode;
      if (!rc) continue;
      const outstanding = Math.max(0, Number(c.amount) - Number(c.amountPaid));
      let p = byPerson.get(rc.id);
      if (!p) {
        const prof = rc.ownerUserId ? profileByUser.get(rc.ownerUserId) : null;
        // Sin usuario vinculado no hay perfil posible: el código quedó huérfano
        // (ownerUserId null) y hay que vincularlo antes de poder pagarle. Es la
        // otra cara del "0 personas listas" con plata disponible.
        const profileStatus = !rc.ownerUserId
          ? 'MISSING_USER'
          : (prof?.status ?? 'NONE');
        p = {
          codeId: rc.id,
          code: rc.code,
          ownerName: rc.ownerName,
          ownerEmail: rc.ownerEmail,
          role: rc.role,
          paymentMethod: prof?.method ?? null,
          profileStatus,
          canTransfer: profileStatus === 'APPROVED' && !!prof?.method,
          commissionsCount: 0,
          totalUsd: 0,
          commissions: [],
        };
        byPerson.set(rc.id, p);
      }
      const availableAt =
        c.availableAt ??
        new Date(
          new Date(c.createdAt).getTime() + COMMISSION_HOLD_DAYS * 86400000,
        );
      const daysRemaining = Math.max(
        0,
        Math.ceil((availableAt.getTime() - Date.now()) / 86400000),
      );
      p.commissionsCount += 1;
      p.totalUsd = round2(p.totalUsd + outstanding);
      p.commissions.push({
        id: c.id,
        amount: outstanding,
        // FECHA del panel: businessDate (fecha de compra congelada) con
        // fallback a createdAt para filas viejas sin backfill.
        date: c.businessDate ?? c.createdAt,
        availableAt,
        daysRemaining,
        businessName:
          c.referralUse?.tenant?.brandName ?? c.businessGroup?.name ?? '—',
        // El plan ES la periodicidad. El nombre interno del `Plan` («Elite»,
        // «Pro», «Sin plan») es un SKU para el gating y Hotmart, y no debe
        // verse: aquí se mandaba en crudo, así que el CORTE mostraba «Elite»
        // mientras el «Detalle avanzado» —que sí usa el formateador— decía
        // «Plan Mensual» para el mismo negocio.
        planName: nombreDePlan(c.referralUse?.tenant?.planPeriodicity),
        batchCode: c.payoutBatch?.code ?? null,
      });
    }
    return Array.from(byPerson.values()).sort((a, b) => b.totalUsd - a.totalUsd);
  }

  // ── CIERRE / REAPERTURA ───────────────────────────────────────────────────

  /**
   * Cierra el corte: alguien confirmó que la transferencia se hizo. Marca todas
   * sus comisiones como PAGADAS con la FECHA REAL de la transferencia (que
   * puede ser distinta a la fecha del corte) y deja el rastro de quién y cuándo.
   */
  async closeBatch(
    user: AuthUser,
    batchId: string,
    body: { paymentDate: string; reference?: string; notes?: string },
  ) {
    this.assertAdmin(user);
    const batch = await this.prisma.payoutBatch.findUnique({
      where: { id: batchId },
    });
    if (!batch) throw new NotFoundException('Corte no encontrado');
    if (batch.status === 'CLOSED') {
      throw new ConflictException(`El corte ${batch.code} ya está cerrado.`);
    }
    const ymd = (body.paymentDate ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
      throw new BadRequestException(
        'Se requiere la fecha real de la transferencia (YYYY-MM-DD).',
      );
    }
    const paidAt = bogotaNoonUtc(ymd);

    const pending = await this.prisma.commission.findMany({
      where: { ...PAYABLE_BASE, payoutBatchId: batch.id },
      select: { id: true, amount: true, amountPaid: true, notes: true },
    });

    const stamp = bogotaYmd();
    const noteTxt = `[${stamp}] Corte ${batch.code} cerrado (transferencia ${ymd})${
      body.reference?.trim() ? ` · ref ${body.reference.trim()}` : ''
    }`;

    const result = await this.prisma.$transaction(async (tx) => {
      let paidTotal = 0;
      for (const c of pending) {
        const amount = Number(c.amount);
        const outstanding = Math.max(0, amount - Number(c.amountPaid));
        if (outstanding <= 0) continue;
        paidTotal += outstanding;
        await tx.commission.update({
          where: { id: c.id },
          data: {
            // Invariante de pago: "pagado" canónico = Σ amountPaid. Los dos
            // caminos de pago DEBEN setearlo o el ledger queda inflado.
            amountPaid: amount,
            paymentStatus: 'PAID',
            status: CommissionStatus.PAID,
            paidAt,
            notes: c.notes ? `${c.notes}\n${noteTxt}` : noteTxt,
          },
        });
      }
      const totalUsd = await this.recalcBatchTotal(tx, batch.id);
      await tx.payoutBatch.update({
        where: { id: batch.id },
        data: {
          status: 'CLOSED',
          paymentDate: paidAt,
          closedAt: new Date(),
          closedByUserId: user.id ?? null,
          reference: body.reference?.trim() || null,
          notes: body.notes?.trim() || batch.notes,
          totalUsd,
        },
      });
      return { paidCount: pending.length, paidTotal: round2(paidTotal), totalUsd };
    });

    await this.audit.log({
      actorId: user.id ?? null,
      action: 'commission.batch_closed',
      resource: `payout_batch:${batch.id}`,
      metadata: {
        code: batch.code,
        paymentDate: ymd,
        reference: body.reference ?? null,
        commissionIds: pending.map((c) => c.id),
        ...result,
      },
    });

    await this.prereg
      .sendInternalAlert(
        CutoffService.PAYOUT_ALERT_PHONE,
        `🔒 ${this.cutoffLabelFor(batch.code)} CERRADO · transferencia ${ymd} · $${result.totalUsd.toFixed(2)}.`,
      )
      .catch(() => null);

    return { ok: true as const, code: batch.code, ...result };
  }

  // ── Flujo de pago por persona (2026-08-31) ─────────────────────────────────

  /**
   * Marca el dinero del corte como RECIBIDO, con comprobante opcional, y avisa
   * por SMS interno. Es el 1er paso del flujo: recibir → pagar a cada persona →
   * cerrar. El comprobante llega como URL de `/media/upload`.
   */
  async markBatchReceived(
    user: AuthUser,
    batchId: string,
    body: { proofUrl?: string; proofMimeType?: string; reference?: string },
  ) {
    this.assertAdmin(user);
    const batch = await this.prisma.payoutBatch.findUnique({
      where: { id: batchId },
    });
    if (!batch) throw new NotFoundException('Corte no encontrado');
    if (batch.status === 'CLOSED')
      throw new ConflictException(`El corte ${batch.code} ya está cerrado.`);

    await this.prisma.payoutBatch.update({
      where: { id: batchId },
      data: {
        receivedAt: new Date(),
        receivedProofUrl: body.proofUrl ?? null,
        receivedProofMimeType: body.proofMimeType ?? null,
        receivedByUserId: user.id ?? null,
      },
    });
    await this.prereg
      .sendInternalAlert(
        CutoffService.PAYOUT_ALERT_PHONE,
        `💰 ${this.cutoffLabelFor(batch.code)}: dinero RECIBIDO · $${Number(batch.totalUsd).toFixed(2)}${body.reference ? ` · ref ${body.reference}` : ''}.`,
      )
      .catch(() => null);
    return { ok: true as const };
  }

  /**
   * Marca a UNA persona como pagada (con comprobante): pone sus comisiones del
   * corte en PAID, registra el BatchPersonPayment y avisa por SMS. Como los
   * giros no son instantáneos, se llama una vez por persona; el corte se cierra
   * (frontend) recién cuando todas están pagadas.
   */
  async markPersonPaid(
    user: AuthUser,
    batchId: string,
    recipientCodeId: string,
    body: {
      proofUrl?: string;
      proofMimeType?: string;
      reference?: string;
      notes?: string;
      paymentDate?: string;
    },
  ) {
    this.assertAdmin(user);
    const batch = await this.prisma.payoutBatch.findUnique({
      where: { id: batchId },
    });
    if (!batch) throw new NotFoundException('Corte no encontrado');
    if (batch.status === 'CLOSED')
      throw new ConflictException(`El corte ${batch.code} ya está cerrado.`);

    const comms = await this.prisma.commission.findMany({
      where: { ...PAYABLE_BASE, payoutBatchId: batchId, recipientCodeId },
      select: { id: true, amount: true, amountPaid: true, notes: true },
    });
    if (!comms.length)
      throw new BadRequestException(
        'Esta persona no tiene comisiones pendientes en el corte.',
      );

    const paidAt =
      body.paymentDate && /^\d{4}-\d{2}-\d{2}$/.test(body.paymentDate)
        ? bogotaNoonUtc(body.paymentDate)
        : new Date();
    const code = await this.prisma.referralCode.findUnique({
      where: { id: recipientCodeId },
      select: { ownerName: true },
    });
    const stamp = bogotaYmd();
    const note = `[${stamp}] Pagado (persona) en ${batch.code}${body.reference ? ` · ref ${body.reference}` : ''}`;

    // Mismo filtro que el pago en bloque: el comprobante se revisa antes de
    // mover plata (https, bucket propio, imagen o PDF).
    const revision = revisarComprobante(
      body.proofUrl,
      body.proofMimeType,
      process.env.S3_PUBLIC_URL,
    );
    if (!revision.ok) throw new BadRequestException(revision.motivo);
    const comprobante = revision.comprobante;

    const amount = await this.prisma.$transaction(async (tx) => {
      let paid = 0;
      for (const c of comms) {
        const a = Number(c.amount);
        const out = Math.max(0, a - Number(c.amountPaid));
        if (out <= 0) continue;
        // Condicional por lo mismo que en `payBulk`: dos clics simultáneos en
        // «Marcar pagado» sumarían dos veces el monto de la persona.
        const escrito = await tx.commission.updateMany({
          where: { id: c.id, status: CommissionStatus.APPROVED },
          data: {
            amountPaid: a,
            paymentStatus: 'PAID',
            status: CommissionStatus.PAID,
            paidAt,
            notes: c.notes ? `${c.notes}\n${note}` : note,
          },
        });
        if (escrito.count !== 1) {
          throw new ConflictException(
            'Otra persona acaba de registrar este pago. Recargá la pantalla para ver cómo quedó antes de volver a intentarlo.',
          );
        }
        paid += out;
      }
      await this.registrarMovimiento(tx, {
        batchId,
        recipientCodeId,
        monto: round2(paid),
        comprobante,
        referencia: body.reference?.trim() || null,
        nota: body.notes?.trim() || null,
        paidAt,
        paidByUserId: user.id ?? null,
        stamp,
      });
      await this.recalcBatchTotal(tx, batchId);
      return round2(paid);
    });

    await this.prereg
      .sendInternalAlert(
        CutoffService.PAYOUT_ALERT_PHONE,
        `✅ ${this.cutoffLabelFor(batch.code)}: pagado a ${code?.ownerName ?? 'afiliado'} · $${amount.toFixed(2)}.`,
      )
      .catch(() => null);
    return { ok: true as const, amountUsd: amount, count: comms.length };
  }

  /** Envío de PRUEBA del SMS interno de pagos (antes de activar el flujo). */
  async testPayoutSms(user: AuthUser) {
    this.assertAdmin(user);
    const r = await this.prereg.sendInternalAlert(
      CutoffService.PAYOUT_ALERT_PHONE,
      '🧪 Prueba · alertas del flujo de pago de cortes activas. (Clubify)',
    );
    return { ok: r.ok, toPhone: CutoffService.PAYOUT_ALERT_PHONE };
  }

  /**
   * Estado del flujo de pago de un corte para el modal de cierre: si el dinero
   * está RECIBIDO, y la lista de PERSONAS (todas, pagadas y pendientes) con su
   * monto y comprobante. `canClose` = recibido + todas pagadas.
   */
  async batchPayoutStatus(user: AuthUser, batchId: string) {
    this.assertAdmin(user);
    const batch = await this.prisma.payoutBatch.findUnique({
      where: { id: batchId },
      select: {
        id: true,
        code: true,
        status: true,
        totalUsd: true,
        receivedAt: true,
        receivedProofUrl: true,
      },
    });
    if (!batch) throw new NotFoundException('Corte no encontrado');

    // TODAS las comisiones del corte con dueño (pagadas o no), agrupadas por
    // persona. Una persona "pagada" es la que ya no tiene saldo pendiente.
    const comms = await this.prisma.commission.findMany({
      where: {
        payoutBatchId: batchId,
        status: { in: [CommissionStatus.APPROVED, CommissionStatus.PAID] },
        recipientCodeId: { not: null },
      },
      select: {
        recipientCodeId: true,
        amount: true,
        amountPaid: true,
        recipientCode: { select: { code: true, ownerName: true } },
      },
    });
    const payments = await this.prisma.batchPersonPayment.findMany({
      where: { batchId },
      select: {
        recipientCodeId: true,
        amountUsd: true,
        proofUrl: true,
        reference: true,
        paidAt: true,
      },
    });
    const payByCode = new Map(payments.map((p) => [p.recipientCodeId, p]));

    const byPerson = new Map<
      string,
      { codeId: string; code: string; ownerName: string; totalUsd: number; outstanding: number }
    >();
    for (const c of comms) {
      const id = c.recipientCodeId as string;
      const cur =
        byPerson.get(id) ??
        {
          codeId: id,
          code: c.recipientCode?.code ?? '',
          ownerName: c.recipientCode?.ownerName ?? '—',
          totalUsd: 0,
          outstanding: 0,
        };
      cur.totalUsd = round2(cur.totalUsd + Number(c.amount));
      cur.outstanding = round2(
        cur.outstanding + Math.max(0, Number(c.amount) - Number(c.amountPaid)),
      );
      byPerson.set(id, cur);
    }

    const people = [...byPerson.values()]
      .map((p) => {
        const pay = payByCode.get(p.codeId);
        const paid = p.outstanding <= 0.001;
        return {
          codeId: p.codeId,
          code: p.code,
          ownerName: p.ownerName,
          amountUsd: p.totalUsd,
          paid,
          paidAt: pay?.paidAt ?? null,
          proofUrl: pay?.proofUrl ?? null,
          reference: pay?.reference ?? null,
        };
      })
      .sort((a, b) => Number(a.paid) - Number(b.paid) || b.amountUsd - a.amountUsd);

    const allPaid = people.length > 0 && people.every((p) => p.paid);
    return {
      batch: {
        id: batch.id,
        code: batch.code,
        label: this.cutoffLabelFor(batch.code),
        status: batch.status,
        totalUsd: Number(batch.totalUsd),
        receivedAt: batch.receivedAt,
        receivedProofUrl: batch.receivedProofUrl,
      },
      people,
      allPaid,
      canClose: !!batch.receivedAt && allPaid,
    };
  }

  /**
   * Deshace el cierre (la transferencia no salió, se registró mal la fecha).
   * Las comisiones vuelven a DISPONIBLE y el corte a ABIERTO — el rastro queda
   * en AuditLog, nada se borra.
   */
  async reopenBatch(user: AuthUser, batchId: string, body?: { reason?: string }) {
    this.assertAdmin(user);
    const batch = await this.prisma.payoutBatch.findUnique({
      where: { id: batchId },
    });
    if (!batch) throw new NotFoundException('Corte no encontrado');
    if (batch.status === 'OPEN') {
      throw new ConflictException(`El corte ${batch.code} ya está abierto.`);
    }

    const paid = await this.prisma.commission.findMany({
      where: { payoutBatchId: batch.id, status: CommissionStatus.PAID },
      select: { id: true, amount: true, notes: true },
    });

    // Los MOVIMIENTOS del corte dejan de corresponder a nada: el corte se reabre
    // entero y sus comisiones vuelven a estar sin pagar. Se leen antes de
    // borrarlos porque la fila es la única copia de la URL del comprobante
    // cuando el pago entró por `markPersonPaid` (ese camino no escribe AuditLog).
    //
    // REGRESIÓN 2026-09-16: mientras el upsert PISABA el monto daba igual
    // dejarlos vivos; desde que SUMA, no. Reabrir y volver a pagar mostraba el
    // doble con el comprobante del pago viejo. Mismo agujero que `unpayBulk`,
    // por la otra puerta.
    const movimientos = await this.prisma.batchPersonPayment.findMany({
      where: { batchId: batch.id },
      select: {
        recipientCodeId: true,
        amountUsd: true,
        proofUrl: true,
        reference: true,
      },
    });

    const stamp = bogotaYmd();
    const noteTxt = `[${stamp}] Cierre REVERTIDO del corte ${batch.code}${
      body?.reason?.trim() ? `: ${body.reason.trim()}` : ''
    }`;

    await this.prisma.$transaction(async (tx) => {
      for (const c of paid) {
        await tx.commission.update({
          where: { id: c.id },
          data: {
            amountPaid: 0,
            paymentStatus: 'PENDING',
            status: CommissionStatus.APPROVED,
            paidAt: null,
            notes: c.notes ? `${c.notes}\n${noteTxt}` : noteTxt,
          },
        });
      }
      // Borrado por corte, no fila a fila: se reabre entero, así que no hay
      // nada que calcular y correrlo dos veces da lo mismo.
      await tx.batchPersonPayment.deleteMany({ where: { batchId: batch.id } });
      const totalUsd = await this.recalcBatchTotal(tx, batch.id);
      await tx.payoutBatch.update({
        where: { id: batch.id },
        data: {
          status: 'OPEN',
          paymentDate: null,
          closedAt: null,
          closedByUserId: null,
          totalUsd,
        },
      });
    });

    await this.audit.log({
      actorId: user.id ?? null,
      action: 'commission.batch_reopened',
      resource: `payout_batch:${batch.id}`,
      metadata: {
        code: batch.code,
        reason: body?.reason ?? null,
        revertedCount: paid.length,
        commissionIds: paid.map((c) => c.id),
        // Con el enlace incluido: el AuditLog es append-only y acá queda la
        // única copia de los comprobantes que se borraron con el corte.
        movimientosBorrados: movimientos.map((m) => ({
          recipientCodeId: m.recipientCodeId,
          amountUsd: Number(m.amountUsd),
          proofUrl: m.proofUrl,
          reference: m.reference,
        })),
      },
    });

    return { ok: true as const, code: batch.code, revertedCount: paid.length };
  }

  // ── PAGO EN BLOQUE ────────────────────────────────────────────────────────

  /**
   * Marca varias comisiones como pagadas en UNA acción, con la fecha real de la
   * transferencia. Solo acepta DISPONIBLES (hold cumplido): si alguna sigue
   * bloqueada, la operación falla entera y devuelve cuáles — nunca paga a medias.
   */
  async payBulk(
    user: AuthUser,
    body: {
      commissionIds: string[];
      paymentDate: string;
      note?: string;
      reference?: string;
      /** Comprobante de la transferencia: URL de `/media/upload`, no el archivo. */
      proofUrl?: string;
      proofMimeType?: string;
    },
  ) {
    this.assertAdmin(user);
    const ids = Array.from(new Set(body.commissionIds ?? [])).filter(Boolean);
    if (!ids.length) throw new BadRequestException('No se seleccionó ninguna comisión.');
    const ymd = (body.paymentDate ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
      throw new BadRequestException(
        'Se requiere la fecha real de la transferencia (YYYY-MM-DD).',
      );
    }
    const paidAt = bogotaNoonUtc(ymd);

    // El comprobante se revisa ANTES de mover plata: si el enlace no sirve, el
    // pago queda registrado igual y meses después no hay con qué demostrarlo.
    const revision = revisarComprobante(
      body.proofUrl,
      body.proofMimeType,
      process.env.S3_PUBLIC_URL,
    );
    if (!revision.ok) throw new BadRequestException(revision.motivo);
    const comprobante = revision.comprobante;

    const rows = await this.prisma.commission.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        amount: true,
        amountPaid: true,
        status: true,
        paymentStatus: true,
        payoutBatchId: true,
        notes: true,
        // Quién cobra: es la clave por la que se agrupa el movimiento (el
        // comprobante es de la transferencia a UNA persona, no de cada comisión).
        recipientCodeId: true,
        recipientCode: { select: { ownerName: true } },
      },
    });
    if (rows.length !== ids.length) {
      throw new NotFoundException('Alguna comisión seleccionada ya no existe.');
    }

    // Nada de pagos parciales del lote: si hay una bloqueada, se cancela todo.
    const blocked = rows.filter((r) => r.status !== CommissionStatus.APPROVED);
    if (blocked.length) {
      throw new BadRequestException(
        `${blocked.length} comisión(es) no están disponibles para pagar (siguen en hold o ya se pagaron): ` +
          blocked.map((b) => b.id).join(', '),
      );
    }

    // Todo pago tiene que quedar dentro de un lote reproducible (invariante del
    // brief PASO 6). Las que ya vienen en un corte se quedan en el suyo — no se
    // mueven, o vaciaríamos el corte abierto por la espalda. Las que no tienen
    // ninguno (se pagaron antes de que se generara su corte) caen en el corte
    // abierto más viejo, y si no hay ninguno, en un lote de AJUSTE del día.
    const fallbackBatch = rows.some((r) => !r.payoutBatchId)
      ? await this.resolveFallbackBatch(ymd)
      : null;

    const stamp = bogotaYmd();
    const noteTxt = body.note?.trim()
      ? `[${stamp}] Pago en bloque (${ymd}): ${body.note.trim()}`
      : `[${stamp}] Pago en bloque · transferencia ${ymd}`;

    // Plan del movimiento, resuelto antes de tocar nada: qué comisión se paga,
    // en qué corte cae y de quién es.
    const plan = rows
      .map((c) => ({
        id: c.id,
        amount: Number(c.amount),
        outstanding: Math.max(0, Number(c.amount) - Number(c.amountPaid)),
        notes: c.notes,
        recipientCodeId: c.recipientCodeId,
        targetBatchId: c.payoutBatchId ?? fallbackBatch?.id ?? null,
      }))
      .filter((p) => p.outstanding > 0);

    const totalPaid = plan.reduce((s, p) => s + p.outstanding, 0);
    const touchedBatches = new Set(
      plan.map((p) => p.targetBatchId).filter((b): b is string => !!b),
    );

    // UN movimiento = UN comprobante. Las 11 comisiones de una persona pagadas
    // con la misma transferencia se agrupan en la fila (corte, persona) que ya
    // existe para eso — `BatchPersonPayment` — en vez de repetir la URL 11
    // veces sobre las comisiones.
    const movimientos = new Map<
      string,
      { batchId: string; recipientCodeId: string; monto: number }
    >();
    for (const p of plan) {
      if (!p.targetBatchId || !p.recipientCodeId) continue;
      const clave = `${p.targetBatchId}|${p.recipientCodeId}`;
      const acc = movimientos.get(clave);
      if (acc) acc.monto = round2(acc.monto + p.outstanding);
      else
        movimientos.set(clave, {
          batchId: p.targetBatchId,
          recipientCodeId: p.recipientCodeId,
          monto: round2(p.outstanding),
        });
    }

    // Si hay comprobante y no hay a quién colgárselo (comisiones sin
    // destinatario), se para: registrar el pago y perder el comprobante en
    // silencio deja exactamente el agujero que este campo vino a tapar.
    if (comprobante && movimientos.size === 0) {
      throw new BadRequestException(
        'No se puede guardar el comprobante: ninguna de las comisiones seleccionadas tiene un afiliado destinatario.',
      );
    }

    const referencia = body.reference?.trim() || null;
    const notaDelPago = body.note?.trim() || null;

    await this.prisma.$transaction(async (tx) => {
      for (const p of plan) {
        // UPDATE CONDICIONAL, no `update` a secas. Entre la lectura de arriba y
        // esta escritura otro admin puede haber pagado la misma selección: la
        // plata no se duplicaría (`amountPaid = amount` es idempotente) pero el
        // movimiento SÍ —las dos llamadas sumarían— y la persona aparecería con
        // el DOBLE en «Comprobantes de pago». Es el fallo más repetido de esta
        // base: leer, decidir y escribir sin atomicidad. Con el `where` sobre
        // `status` la segunda escritura no encuentra fila, `count` es 0 y se
        // cae la transacción entera, comprobante incluido.
        const escrito = await tx.commission.updateMany({
          where: { id: p.id, status: CommissionStatus.APPROVED },
          data: {
            amountPaid: p.amount,
            paymentStatus: 'PAID',
            status: CommissionStatus.PAID,
            paidAt,
            payoutBatchId: p.targetBatchId,
            notes: p.notes ? `${p.notes}\n${noteTxt}` : noteTxt,
          },
        });
        if (escrito.count !== 1) {
          throw new ConflictException(
            'Otra persona acaba de registrar este pago. Recargá la pantalla para ver cómo quedó antes de volver a intentarlo.',
          );
        }
      }
      for (const m of movimientos.values()) {
        await this.registrarMovimiento(tx, {
          ...m,
          comprobante,
          referencia,
          nota: notaDelPago,
          paidAt,
          paidByUserId: user.id ?? null,
          stamp,
        });
      }
      for (const bid of touchedBatches) await this.recalcBatchTotal(tx, bid);
    });

    await this.audit.log({
      actorId: user.id ?? null,
      action: 'commission.bulk_paid',
      resource: 'commissions',
      metadata: {
        commissionIds: rows.map((r) => r.id),
        paymentDate: ymd,
        totalPaid: round2(totalPaid),
        note: body.note ?? null,
        reference: body.reference ?? null,
        // El log es append-only: aunque un pago posterior reemplace el
        // comprobante de la persona, aquí queda cuál se subió y cuándo.
        proofUrl: comprobante?.url ?? null,
        batches: Array.from(touchedBatches),
      },
    });

    return {
      ok: true as const,
      paidCount: rows.length,
      totalPaid: round2(totalPaid),
      paymentDate: ymd,
    };
  }

  /** Deshace un marcado en bloque (vuelven a DISPONIBLE). Auditado. */
  async unpayBulk(
    user: AuthUser,
    body: { commissionIds: string[]; reason?: string },
  ) {
    this.assertAdmin(user);
    const ids = Array.from(new Set(body.commissionIds ?? [])).filter(Boolean);
    if (!ids.length) throw new BadRequestException('No se seleccionó ninguna comisión.');

    const rows = await this.prisma.commission.findMany({
      where: { id: { in: ids }, status: CommissionStatus.PAID },
      select: {
        id: true,
        notes: true,
        payoutBatchId: true,
        // Lo pagado y a quién: hay que descontarlo del movimiento de la persona,
        // no solo de la comisión.
        amountPaid: true,
        recipientCodeId: true,
        payoutBatch: { select: { status: true, code: true } },
      },
    });
    if (!rows.length) {
      throw new BadRequestException('Ninguna de las comisiones seleccionadas está pagada.');
    }
    // Un corte CERRADO es histórico: para tocarlo hay que reabrirlo primero
    // (y eso queda en el log), no deshacer comisiones sueltas por debajo.
    const inClosed = rows.filter((r) => r.payoutBatch?.status === 'CLOSED');
    if (inClosed.length) {
      throw new ConflictException(
        `Hay ${inClosed.length} comisión(es) dentro de cortes ya cerrados (${Array.from(
          new Set(inClosed.map((r) => r.payoutBatch!.code)),
        ).join(', ')}). Reabrí el corte para revertirlas.`,
      );
    }

    const stamp = bogotaYmd();
    const noteTxt = `[${stamp}] Pago REVERTIDO${
      body.reason?.trim() ? `: ${body.reason.trim()}` : ''
    }`;
    const touched = new Set<string>();

    // Lo revertido tiene que salir TAMBIÉN del movimiento de la persona. Si no,
    // al volver a pagar se suma encima de lo revertido y —si el segundo pago no
    // lleva adjunto— queda colgado el comprobante de un pago que se deshizo,
    // haciéndose pasar por el del pago nuevo.
    const revertidoPorPersona = new Map<
      string,
      { batchId: string; recipientCodeId: string; monto: number }
    >();
    for (const c of rows) {
      if (!c.payoutBatchId || !c.recipientCodeId) continue;
      const clave = `${c.payoutBatchId}|${c.recipientCodeId}`;
      const acc = revertidoPorPersona.get(clave);
      if (acc) acc.monto = round2(acc.monto + Number(c.amountPaid));
      else
        revertidoPorPersona.set(clave, {
          batchId: c.payoutBatchId,
          recipientCodeId: c.recipientCodeId,
          monto: round2(Number(c.amountPaid)),
        });
    }

    // Lo que se borre se anota en el log: la fila del movimiento es la única
    // copia del comprobante cuando el pago entró por «Marcar pagado».
    const movimientosBorrados: Array<{
      batchId: string;
      recipientCodeId: string;
      amountUsd: number;
      proofUrl: string | null;
      reference: string | null;
    }> = [];

    await this.prisma.$transaction(async (tx) => {
      for (const c of rows) {
        if (c.payoutBatchId) touched.add(c.payoutBatchId);
        // Condicional igual que al pagar: si otro admin ya revirtió esta
        // comisión, restaríamos dos veces del movimiento de la persona.
        const escrito = await tx.commission.updateMany({
          where: { id: c.id, status: CommissionStatus.PAID },
          data: {
            amountPaid: 0,
            paymentStatus: 'PENDING',
            status: CommissionStatus.APPROVED,
            paidAt: null,
            notes: c.notes ? `${c.notes}\n${noteTxt}` : noteTxt,
          },
        });
        if (escrito.count !== 1) {
          throw new ConflictException(
            'Otra persona acaba de tocar este pago. Recargá la pantalla para ver cómo quedó antes de volver a intentarlo.',
          );
        }
      }
      for (const m of revertidoPorPersona.values()) {
        const borrado = await this.deshacerMovimiento(tx, {
          ...m,
          stamp,
          motivo: body.reason?.trim() || null,
        });
        if (borrado) movimientosBorrados.push({ batchId: m.batchId, ...borrado });
      }
      for (const bid of touched) await this.recalcBatchTotal(tx, bid);
    });

    await this.audit.log({
      actorId: user.id ?? null,
      action: 'commission.bulk_unpaid',
      resource: 'commissions',
      metadata: {
        commissionIds: rows.map((r) => r.id),
        reason: body.reason ?? null,
        movimientosBorrados,
      },
    });

    return { ok: true as const, revertedCount: rows.length };
  }

  // ── HISTORIAL ─────────────────────────────────────────────────────────────

  /** Detalle de un corte: cabecera + sus comisiones (para el drill-in y el CSV). */
  async batchDetail(user: AuthUser, batchId: string) {
    this.assertAdmin(user);

    // AISLAMIENTO POR MARCA: solo las comisiones de la marca del admin. El corte
    // (PayoutBatch) es global, así que las embebidas se filtran por recipientCode
    // y el total se RECALCULA desde ellas (si no, cabecera y lista se contradicen).
    const scope = await resolveBrandScope(this.prisma, user.whiteLabelId);
    const brandCode = brandWhiteLabelWhere(scope);
    const brandCommWhere: Prisma.CommissionWhereInput = Object.keys(brandCode)
      .length
      ? { recipientCode: brandCode }
      : {};

    const b = await this.prisma.payoutBatch.findUnique({
      where: { id: batchId },
      include: {
        closedBy: { select: { id: true, fullName: true, email: true } },
        commissions: {
          where: brandCommWhere,
          select: {
            id: true,
            amount: true,
            amountPaid: true,
            status: true,
            paymentStatus: true,
            businessDate: true,
            createdAt: true,
            paidAt: true,
            recipientCode: {
              select: { id: true, code: true, ownerName: true, ownerEmail: true, role: true },
            },
            referralUse: {
              select: {
                tenant: {
                  select: { brandName: true, planPeriodicity: true, plan: { select: { name: true } } },
                },
              },
            },
            businessGroup: { select: { name: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!b) throw new NotFoundException('Corte no encontrado');
    // Si el admin está scopeado a una marca y el corte no tiene NINGUNA comisión
    // suya, no debe siquiera confirmar que el corte existe.
    if (Object.keys(brandCommWhere).length && b.commissions.length === 0) {
      throw new NotFoundException('Corte no encontrado');
    }

    const today = bogotaYmd();
    const daysOpen =
      b.status === 'OPEN' ? daysBetweenYmd(bogotaYmd(b.cutoffDate), today) : 0;
    // Total RECALCULADO desde las comisiones scopeadas (no el b.totalUsd global).
    const scopedTotalUsd = round2(
      b.commissions.reduce((s, c) => s + Number(c.amount), 0),
    );

    // COMPROBANTES del corte. Se leen aquí para que el historial pueda abrir el
    // soporte de una transferencia vieja: sin esto el adjunto no sirve de nada.
    // Se limitan a los destinatarios visibles para el admin — el aislamiento
    // por marca vale también para los comprobantes y los datos de quién cobró.
    const codigosVisibles = new Map(
      b.commissions
        .filter((c) => c.recipientCode)
        .map((c) => [c.recipientCode!.id, c.recipientCode!]),
    );
    const pagosPorPersona = await this.prisma.batchPersonPayment.findMany({
      where: { batchId: b.id, recipientCodeId: { in: [...codigosVisibles.keys()] } },
      orderBy: { paidAt: 'desc' },
      select: {
        recipientCodeId: true,
        amountUsd: true,
        proofUrl: true,
        proofMimeType: true,
        reference: true,
        notes: true,
        paidAt: true,
      },
    });

    return {
      id: b.id,
      code: b.code,
      status: b.status,
      kind: b.kind,
      cutoffDate: b.cutoffDate,
      periodStart: b.periodStart,
      periodEnd: b.periodEnd,
      paymentDate: b.paymentDate,
      totalUsd: scopedTotalUsd,
      currency: b.currency,
      notes: b.notes,
      reference: b.reference,
      generatedAuto: b.generatedAuto,
      closedAt: b.closedAt,
      closedBy: b.closedBy
        ? { id: b.closedBy.id, name: b.closedBy.fullName, email: b.closedBy.email }
        : null,
      createdAt: b.createdAt,
      daysOpen,
      isStale: b.status === 'OPEN' && daysOpen > STALE_OPEN_BATCH_DAYS,
      commissionsCount: b.commissions.length,
      personPayments: pagosPorPersona.map((p) => ({
        codeId: p.recipientCodeId,
        code: codigosVisibles.get(p.recipientCodeId)?.code ?? '',
        ownerName: codigosVisibles.get(p.recipientCodeId)?.ownerName ?? '—',
        amountUsd: Number(p.amountUsd),
        proofUrl: p.proofUrl,
        proofMimeType: p.proofMimeType,
        reference: p.reference,
        notes: p.notes,
        paidAt: p.paidAt,
      })),
      commissions: b.commissions.map((c) => ({
        id: c.id,
        amount: Number(c.amount),
        amountPaid: Number(c.amountPaid),
        status: c.status,
        paymentStatus: c.paymentStatus,
        date: c.businessDate ?? c.createdAt,
        paidAt: c.paidAt,
        businessName:
          c.referralUse?.tenant?.brandName ?? c.businessGroup?.name ?? '—',
        // El plan ES la periodicidad. El nombre interno del `Plan` («Elite»,
        // «Pro», «Sin plan») es un SKU para el gating y Hotmart, y no debe
        // verse: aquí se mandaba en crudo, así que el CORTE mostraba «Elite»
        // mientras el «Detalle avanzado» —que sí usa el formateador— decía
        // «Plan Mensual» para el mismo negocio.
        planName: nombreDePlan(c.referralUse?.tenant?.planPeriodicity),
        recipient: c.recipientCode
          ? {
              id: c.recipientCode.id,
              code: c.recipientCode.code,
              ownerName: c.recipientCode.ownerName,
              ownerEmail: c.recipientCode.ownerEmail,
              role: c.recipientCode.role,
            }
          : null,
      })),
    };
  }

  // ── INTERNOS ──────────────────────────────────────────────────────────────

  private assertAdmin(user: AuthUser) {
    if (user?.role !== 'SUPER_ADMIN') throw new ForbiddenException();
  }

  /**
   * Registra (o suma a) el MOVIMIENTO de pago de una persona dentro de un corte
   * —`BatchPersonPayment`— con su comprobante.
   *
   * Único sitio donde se escribe esa fila, para que los dos caminos de pago (en
   * bloque y persona por persona) no se pisen:
   *
   *  - el monto se SUMA: pagar el resto desde «Cerrar corte» después de un pago
   *    en bloque tiene que dar el total de la persona, no el último tramo;
   *  - el comprobante solo se reemplaza si llega uno nuevo, y el anterior se
   *    anexa a la nota. Si no, la única copia del que se pisó quedaría en el
   *    JSON crudo del AuditLog, que nadie abre desde el panel.
   *
   * `tx` es el TransactionClient (o el PrismaService) — mismo `any` que usa
   * `recalcBatchTotal`, por el que no hay tipo común entre los dos.
   */
  private async registrarMovimiento(
    tx: any,
    m: {
      batchId: string;
      recipientCodeId: string;
      monto: number;
      comprobante: { url: string; mimeType: string | null } | null;
      referencia: string | null;
      nota: string | null;
      paidAt: Date;
      paidByUserId: string | null;
      stamp: string;
    },
  ) {
    const clave = {
      batchId_recipientCodeId: {
        batchId: m.batchId,
        recipientCodeId: m.recipientCodeId,
      },
    };
    const previo = await tx.batchPersonPayment.findUnique({
      where: clave,
      select: { proofUrl: true, notes: true },
    });

    const reemplazado =
      m.comprobante && previo?.proofUrl && previo.proofUrl !== m.comprobante.url
        ? `[${m.stamp}] Comprobante anterior: ${previo.proofUrl}`
        : null;
    // La nota solo se anexa si no estaba ya: pagar dos veces con la misma
    // referencia no tiene por qué dejarla repetida.
    const notaNueva =
      m.nota && !(previo?.notes ?? '').includes(m.nota) ? m.nota : null;

    await tx.batchPersonPayment.upsert({
      where: clave,
      update: {
        amountUsd: { increment: m.monto },
        paidAt: m.paidAt,
        paidByUserId: m.paidByUserId,
        ...(m.comprobante
          ? { proofUrl: m.comprobante.url, proofMimeType: m.comprobante.mimeType }
          : {}),
        ...(m.referencia ? { reference: m.referencia } : {}),
      },
      create: {
        batchId: m.batchId,
        recipientCodeId: m.recipientCodeId,
        amountUsd: m.monto,
        proofUrl: m.comprobante?.url ?? null,
        proofMimeType: m.comprobante?.mimeType ?? null,
        reference: m.referencia,
        notes: m.nota,
        paidAt: m.paidAt,
        paidByUserId: m.paidByUserId,
      },
    });

    // Las líneas de la nota se ANEXAN en la base, no se rearman desde lo que
    // leí arriba: dos pagos a la vez sobre la misma persona se comían una línea
    // —y una de esas líneas es la URL del comprobante que se acaba de pisar—.
    // En el alta ya van dentro del `create`.
    if (previo) {
      for (const linea of [reemplazado, notaNueva].filter(
        (l): l is string => !!l,
      )) {
        await this.anexarNota(tx, m.batchId, m.recipientCodeId, linea);
      }
    }
  }

  /**
   * Anexa una línea a la nota del movimiento sin releerla: `concat_ws` la pega
   * del lado de la base (y salta el NULL de la primera vez), así que dos
   * escrituras simultáneas no se pisan.
   */
  private anexarNota(
    tx: any,
    batchId: string,
    recipientCodeId: string,
    linea: string,
  ) {
    return tx.$executeRaw`UPDATE "BatchPersonPayment" SET "notes" = concat_ws(chr(10), "notes", ${linea}) WHERE "batchId" = ${batchId} AND "recipientCodeId" = ${recipientCodeId}`;
  }

  /**
   * Saca del movimiento lo que se revirtió. Si a la persona no le queda nada
   * pagado en ese corte, la fila se BORRA: dejarla en $0 con el comprobante
   * colgando es peor que no tener comprobante — es la prueba de un pago que se
   * revirtió, lista para que el siguiente pago la dé por buena.
   */
  private async deshacerMovimiento(
    tx: any,
    m: {
      batchId: string;
      recipientCodeId: string;
      monto: number;
      stamp: string;
      motivo: string | null;
    },
  ): Promise<{
    recipientCodeId: string;
    amountUsd: number;
    proofUrl: string | null;
    reference: string | null;
  } | null> {
    const filtro = {
      batchId: m.batchId,
      recipientCodeId: m.recipientCodeId,
    };
    // Esta lectura es SOLO para el registro de auditoría — no se escribe nada
    // calculado a partir de ella. Hace falta porque `markPersonPaid` no escribe
    // AuditLog: si la fila se borra, esta es la última vez que se ve la URL.
    const previo = await tx.batchPersonPayment.findUnique({
      where: {
        batchId_recipientCodeId: {
          batchId: m.batchId,
          recipientCodeId: m.recipientCodeId,
        },
      },
      select: { amountUsd: true, proofUrl: true, reference: true },
    });
    if (!previo) return null;

    // DECREMENT, no «leo 20, resto 10 y escribo 10»: si otro admin suma un pago
    // entre la lectura y la escritura, con el cálculo a mano ese pago se perdía.
    await tx.batchPersonPayment.updateMany({
      where: filtro,
      data: { amountUsd: { decrement: m.monto } },
    });

    // Y si la fila queda en cero lo decide la BASE, no el número que leí: si
    // mientras tanto entró otro pago, ya no está en cero y no se borra.
    const borrado = await tx.batchPersonPayment.deleteMany({
      where: { ...filtro, amountUsd: { lte: 0.009 } },
    });
    if (borrado.count > 0) {
      return {
        recipientCodeId: m.recipientCodeId,
        amountUsd: Number(previo.amountUsd),
        proofUrl: previo.proofUrl,
        reference: previo.reference,
      };
    }

    // Reversión PARCIAL: queda pagado algo de verdad, así que la fila se queda.
    // Pero solo cabe UNA URL por (corte, persona), y la vigente puede ser justo
    // la del giro que se revirtió — con la anterior enterrada en la nota. Se
    // dice explícito para que quien audite no se fíe del enlace de arriba.
    await this.anexarNota(
      tx,
      m.batchId,
      m.recipientCodeId,
      `[${m.stamp}] Reversión de $${m.monto.toFixed(2)}${
        m.motivo ? `: ${m.motivo}` : ''
      }. OJO: el comprobante que queda visible puede ser el de la transferencia revertida — comprobá contra las líneas anteriores de esta nota antes de darlo por bueno.`,
    );
    return null;
  }

  /**
   * VENTANA de un corte: qué comisiones le pertenecen por fecha. Un corte solo
   * puede absorber lo que se desbloqueó hasta el CIERRE de su propio día (hora
   * Bogotá) — es lo que garantiza que algo liberado el 16 nunca entre al corte
   * del 15, corra el job cuando corra.
   *
   * Las habilitadas A MANO son la excepción: `status=APPROVED` con un
   * `availableAt` todavía en el futuro solo puede venir de "Habilitar" del super
   * admin (el cron promueve únicamente cuando `availableAt <= ahora`). El punto
   * de habilitar a mano es poder pagarla ya, así que entra al corte VIGENTE.
   *
   * FIX 2026-08-31: esa excepción no tenía tope, y `topUpOpenBatches` recorre
   * los cortes abiertos del más viejo al más nuevo. Así que lo habilitado a
   * mano no caía en el corte vigente sino en el ABIERTO MÁS VIEJO — uno cuya
   * fecha ya pasó y que se está liquidando. Tres comisiones (Hydor, Quipao y
   * Monet, $25) se habilitaron para el 30 de agosto y quedaron pegadas al
   * corte del 15, que ya se había transferido: mostraba $343.15 contra una
   * transferencia de $303.85.
   *
   * Un corte cuya fecha YA PASÓ no acumula: está esperando que lo cierren.
   * Solo el vigente —fecha de hoy o posterior— absorbe lo adelantado.
   */
  private dayWindowWhere(
    ymd: string,
    /**
     * Si este corte absorbe lo HABILITADO A MANO con fecha futura.
     *
     * `topUpOpenBatches` pasa `false` cuando la fecha del corte ya pasó — ese
     * es el bug de Hydor, Quipao y Monet. Pero al GENERAR un corte concreto se
     * pasa `true` siempre: quien lo llama está liquidando ese corte a
     * propósito, y lo adelantado le pertenece. Gatearlo también ahí dejaba
     * fuera comisiones que el admin había habilitado justo para ese pago.
     */
    absorbeAdelantadas: boolean,
  ): Prisma.CommissionWhereInput {
    const dayEnd = bogotaDayEndUtc(ymd);
    const esCorteVigente = absorbeAdelantadas;
    return {
      OR: [
        { availableAt: { lt: dayEnd } },
        // Legacy sin availableAt: fallback createdAt + hold (igual que el cron
        // de promoción).
        {
          availableAt: null,
          createdAt: {
            lt: new Date(dayEnd.getTime() - COMMISSION_HOLD_DAYS * 86400000),
          },
        },
        // Habilitada a mano (desbloqueo adelantado por el super admin).
        ...(esCorteVigente
          ? [{ availableAt: { gt: new Date() } } as Prisma.CommissionWhereInput]
          : []),
      ],
    };
  }

  /**
   * Lote donde meter un pago de comisiones que todavía no tienen corte: el
   * corte ABIERTO más viejo, o —si no hay ninguno— un lote de AJUSTE del día
   * de la transferencia. Nunca queda un pago huérfano fuera de la serie.
   */
  private async resolveFallbackBatch(paymentYmd: string) {
    const open = await this.prisma.payoutBatch.findFirst({
      where: { status: 'OPEN' },
      orderBy: { cutoffDate: 'asc' },
      select: { id: true, code: true },
    });
    if (open) return open;

    const code = `AJUSTE-${paymentYmd}`;
    const existing = await this.prisma.payoutBatch.findUnique({
      where: { code },
      select: { id: true, code: true },
    });
    if (existing) return existing;
    return this.prisma.payoutBatch.create({
      data: {
        code,
        kind: 'ADJUSTMENT',
        status: 'CLOSED',
        cutoffDate: bogotaNoonUtc(paymentYmd),
        paymentDate: bogotaNoonUtc(paymentYmd),
        closedAt: new Date(),
        generatedAuto: false,
        notes: 'Pago en bloque sin corte abierto.',
      },
      select: { id: true, code: true },
    });
  }

  private batchTotal(db: any, batchId: string) {
    return batchTotal(db, batchId);
  }

  private recalcBatchTotal(db: any, batchId: string) {
    return recalcBatchTotal(db, batchId);
  }
}
