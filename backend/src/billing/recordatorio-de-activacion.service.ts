import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../common/prisma/prisma.service';
import { PreregAlertsService } from '../auth/prereg-alerts.service';
import { enlaceDeActivacion } from './pending-activation.service';
import {
  AVISAN_AL_EQUIPO,
  PRIMERO_A,
  Recordatorio,
  TERCERO_HASTA,
  datosDelComprador,
  enHorarioDeSilencio,
  queRecordatorioToca,
  textoAvisoAlEquipo,
  textoDelRecordatorio,
} from './recordatorio-de-activacion';

type Pasarela = 'HOTMART' | 'STRIPE';

type Fila = {
  id: string;
  email: string;
  whiteLabelId: string | null;
  /** Solo Hotmart: para saber si el pago se devolvió. */
  transactionId?: string | null;
  rawPayload: unknown;
  createdAt: Date;
  buyerReminder1At: Date | null;
  buyerReminder2At: Date | null;
  buyerReminder3At: Date | null;
};

const SELECT = {
  id: true,
  email: true,
  whiteLabelId: true,
  rawPayload: true,
  createdAt: true,
  buyerReminder1At: true,
  buyerReminder2At: true,
  buyerReminder3At: true,
} as const;

/**
 * Un comprador sin cuenta al que le devuelven el dinero no tiene ningún negocio
 * donde anotarlo (el webhook acaba en `tenant_not_found`) y su fila pendiente
 * sigue abierta: sin esto, el recordatorio de las 24 h le diría «seguimos
 * guardando tu pago» a alguien que ya lo recuperó.
 */
const DEVOLUCIONES = ['PURCHASE_REFUNDED', 'PURCHASE_CHARGEBACK'];

/**
 * Seguimiento al comprador que pagó y no creó su cuenta. Hotmart y Stripe
 * (Cross no tiene aviso automático ni teléfono fiable).
 *
 *  - Al comprador: SMS a los 30 min, a las 24 h y a las 48 h.
 *  - Al equipo de implementación (avisos tipo `implementacion` de
 *    `prereg.alertPhones`, editables en Integraciones SMS): a los 30 min y a
 *    las 24 h, con los datos para llamarlo y su enlace de activación.
 *
 * El candado es `buyerReminder{1,2,3}At`, reclamado con un UPDATE condicional
 * ANTES de enviar: dos vueltas del cron que se pisen, o dos réplicas, no
 * pueden mandar el mismo recordatorio dos veces. Si el envío revienta se
 * devuelve, y la vuelta siguiente lo reintenta. El aviso al equipo va atado al
 * mismo candado: sale una vez por recordatorio.
 *
 * El reclamo abarca TODAS las filas sin consumir de ese comprador en esa
 * marca: Hotmart manda una fila por transacción, y un comprador con dos no
 * puede recibir dos recordatorios iguales.
 */
@Injectable()
export class RecordatorioDeActivacionService {
  private readonly logger = new Logger(RecordatorioDeActivacionService.name);

  constructor(
    private prisma: PrismaService,
    private alerts: PreregAlertsService,
  ) {}

  // El cron no recibe la hora como parámetro: la librería `cron` llama al
  // método con su propio argumento (el callback de fin), que ocuparía el lugar
  // de `ahora`. Por eso el método del cron no lleva parámetros.
  @Cron(CronExpression.EVERY_10_MINUTES)
  async tick(): Promise<void> {
    await this.recordar(new Date()).catch((e) =>
      this.logger.warn(`Recordatorios de activación: ${(e as Error).message}`),
    );
  }

  async recordar(ahora: Date): Promise<number> {
    if (enHorarioDeSilencio(ahora)) return 0;
    const where = {
      consumedAt: null,
      createdAt: {
        gte: new Date(ahora.getTime() - TERCERO_HASTA),
        lte: new Date(ahora.getTime() - PRIMERO_A),
      },
    };
    const [hotmart, stripe] = await Promise.all([
      this.prisma.pendingHotmartPayment.findMany({
        where,
        select: { ...SELECT, transactionId: true },
        orderBy: { createdAt: 'asc' },
        take: 200,
      }),
      this.prisma.pendingStripePayment.findMany({
        where,
        select: SELECT,
        orderBy: { createdAt: 'asc' },
        take: 200,
      }),
    ]);

    let enviados = 0;
    const filas: Array<[Pasarela, Fila]> = [
      ...hotmart.map((f) => ['HOTMART', f] as [Pasarela, Fila]),
      ...stripe.map((f) => ['STRIPE', f] as [Pasarela, Fila]),
    ];
    for (const [pasarela, fila] of filas) {
      const cual = queRecordatorioToca(fila, ahora);
      if (!cual) continue;
      const ok = await this.recordarUno(pasarela, fila, cual).catch((e) => {
        this.logger.warn(
          `Recordatorio ${cual} falló para ${fila.email}: ${(e as Error).message}`,
        );
        return false;
      });
      if (ok) enviados++;
    }
    if (enviados) {
      this.logger.log(`Recordatorios de activación enviados: ${enviados}`);
    }
    return enviados;
  }

  private async recordarUno(
    pasarela: Pasarela,
    fila: Fila,
    cual: Recordatorio,
  ): Promise<boolean> {
    // Quien ya tiene cuenta no tiene nada que activar. Por el mismo producto
    // de Hotmart se cobran subproductos que caen aquí como huérfanos: sin
    // este filtro, un cliente de hace meses recibiría «crea tu cuenta».
    // Sin distinguir mayúsculas: un usuario creado desde el panel de admin
    // puede no haber pasado por el `toLowerCase()` del registro.
    const yaTieneCuenta = await this.prisma.user.findFirst({
      where: { email: { equals: fila.email.trim(), mode: 'insensitive' } },
      select: { id: true },
    });
    if (yaTieneCuenta) return false;

    if (pasarela === 'HOTMART' && fila.transactionId) {
      // Todo evento de Hotmart queda en HotmartWebhookEvent antes de buscar
      // el negocio, así que la devolución está aunque no haya cuenta.
      const devuelto = await this.prisma.hotmartWebhookEvent.findFirst({
        where: {
          eventType: { in: DEVOLUCIONES },
          payload: {
            path: ['data', 'purchase', 'transaction'],
            equals: fila.transactionId,
          },
        },
        select: { id: true },
      });
      if (devuelto) return false;
    }

    const campo = `buyerReminder${cual}At` as const;
    const delComprador = {
      email: fila.email,
      whiteLabelId: fila.whiteLabelId,
      consumedAt: null,
    };
    // Las dos tablas tienen las mismas columnas del candado, pero Prisma les
    // da tipos distintos: se escoge el delegado una vez y se usa igual.
    const tabla = (
      pasarela === 'HOTMART'
        ? this.prisma.pendingHotmartPayment
        : this.prisma.pendingStripePayment
    ) as unknown as {
      updateMany(args: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }): Promise<{ count: number }>;
    };

    const sello = new Date();
    const reclamo = await tabla.updateMany({
      where: { ...delComprador, [campo]: null },
      data: { [campo]: sello },
    });
    if (reclamo.count === 0) return false;

    const wl = await this.prisma.whiteLabel
      .findFirst({
        where: fila.whiteLabelId
          ? { id: fila.whiteLabelId }
          : { slug: 'clubify' },
        select: { id: true, name: true, domain: true, appDomain: true },
      })
      .catch(() => null);
    const { nombre, telefono, negocio } = datosDelComprador(
      pasarela,
      fila.rawPayload,
    );
    const enlace = enlaceDeActivacion(wl, fila.email);
    const body = textoDelRecordatorio({
      cual,
      nombre,
      marca: wl?.name ?? null,
      enlace,
      email: fila.email,
    });

    const r = await this.alerts
      .sendBuyerActivationReminder({
        email: fila.email,
        name: nombre,
        phone: telefono,
        body,
        whiteLabelId: fila.whiteLabelId ?? wl?.id ?? null,
      })
      .catch(() => ({ ok: false, permanente: false }));

    if (!r.ok && !r.permanente) {
      // Solo se devuelve lo que reclamó ESTA vuelta (mismo sello): si otra ya
      // lo había reclamado y enviado, no se toca. El aviso al equipo espera a
      // la vuelta que lo resuelva, o le llegaría dos veces.
      await tabla
        .updateMany({
          where: { ...delComprador, [campo]: sello },
          data: { [campo]: null },
        })
        .catch(() => null);
      return false;
    }

    if (AVISAN_AL_EQUIPO.has(cual)) {
      // También cuando nuestro SMS no le llegó (teléfono inválido, lista de no
      // molestar): ahí el equipo es lo único que queda, y el aviso lo dice.
      await this.alerts
        .sendTeamAlert(
          textoAvisoAlEquipo({
            cual,
            marca: wl?.name ?? null,
            nombre,
            negocio,
            telefono,
            email: fila.email,
            enlace,
            llegoAlCliente: r.ok,
          }),
          'implementacion',
        )
        .catch((e) =>
          this.logger.warn(
            `Aviso a implementación no salió para ${fila.email}: ${(e as Error).message}`,
          ),
        );
    }
    return r.ok;
  }
}
