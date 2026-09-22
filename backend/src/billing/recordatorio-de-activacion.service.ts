import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../common/prisma/prisma.service';
import { PreregAlertsService } from '../auth/prereg-alerts.service';
import { enlaceDeActivacion } from './pending-activation.service';
import {
  PRIMERO_A,
  Recordatorio,
  SEGUNDO_HASTA,
  enHorarioDeSilencio,
  queRecordatorioToca,
  telefonoDelPago,
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
};

const SELECT = {
  id: true,
  email: true,
  whiteLabelId: true,
  rawPayload: true,
  createdAt: true,
  buyerReminder1At: true,
  buyerReminder2At: true,
} as const;

/**
 * Un comprador sin cuenta al que le devuelven el dinero no tiene ningún negocio
 * donde anotarlo (el webhook acaba en `tenant_not_found`) y su fila pendiente
 * sigue abierta: sin esto, el recordatorio de las 24 h le diría «seguimos
 * guardando tu pago» a alguien que ya lo recuperó.
 */
const DEVOLUCIONES = ['PURCHASE_REFUNDED', 'PURCHASE_CHARGEBACK'];

/**
 * SMS al comprador que pagó y no creó su cuenta: a los 30 min y a las 24 h.
 * Hotmart y Stripe (Cross no tiene aviso automático ni teléfono fiable).
 *
 * El candado es `buyerReminder1At` / `buyerReminder2At`, reclamado con un
 * UPDATE condicional ANTES de enviar: dos vueltas del cron que se pisen, o dos
 * réplicas, no pueden mandar el mismo recordatorio dos veces. Si el envío
 * falla por algo pasajero se devuelve, y la vuelta siguiente lo reintenta.
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
        gte: new Date(ahora.getTime() - SEGUNDO_HASTA),
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

    const campo = cual === 1 ? 'buyerReminder1At' : 'buyerReminder2At';
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
    const { nombre, telefono } = telefonoDelPago(pasarela, fila.rawPayload);
    const body = textoDelRecordatorio({
      cual,
      nombre,
      marca: wl?.name ?? null,
      enlace: enlaceDeActivacion(wl, fila.email),
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
      // lo había reclamado y enviado, no se toca.
      await tabla
        .updateMany({
          where: { ...delComprador, [campo]: sello },
          data: { [campo]: null },
        })
        .catch(() => null);
    }
    return r.ok;
  }
}
