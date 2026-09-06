import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../common/prisma/prisma.service';
import { PreregAlertsService } from '../auth/prereg-alerts.service';

/** Desde cuándo se avisa. Se escribe una sola vez, la primera vez que corre. */
const CLAVE_DESDE = 'afiliados.avisoVentas.desde';

/** Tope por pasada. Un pico raro no se convierte en una ráfaga de SMS. */
const MAX_POR_PASADA = 50;

/**
 * SMS al influencer o embajador cuando entra una venta por SU enlace.
 *
 * Va colgado de las COMISIONES y no del cobro, y por dos razones:
 *
 *  1. Una comisión es la prueba de que la venta se atribuyó de verdad. Avisar
 *     antes sería avisar de algo que todavía puede no cuadrar.
 *  2. Las comisiones se crean por cinco caminos distintos (webhook de Hotmart,
 *     alta manual del super admin, el reparto a tres bandas…) y ese motor lo
 *     lleva otra persona. Mirando la tabla en vez de meter mano en cada camino,
 *     esto funciona con todos y no se cruza con su trabajo.
 *
 * El precio de hacerlo así es que el aviso no es instantáneo: llega en la
 * siguiente pasada, como mucho cinco minutos después. Para un «vendiste» es de
 * sobra.
 *
 * **Solo al afiliado que corresponde.** Cada comisión sabe de quién es
 * (`referralUse.referralCode`), así que el reparto a tres bandas manda dos SMS
 * distintos: uno al embajador y otro a su influencer, cada uno por lo suyo.
 */
@Injectable()
export class AffiliateSaleAlertsService {
  private logger = new Logger(AffiliateSaleAlertsService.name);

  constructor(
    private prisma: PrismaService,
    private alerts: PreregAlertsService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async pasada() {
    try {
      const desde = await this.desdeCuando();
      // Ventana de 24 h hacia atrás: si el servicio estuvo caído un rato, al
      // volver recupera lo de ese rato. Más atrás no, porque un aviso de una
      // venta de la semana pasada ya no es un aviso, es ruido.
      const ventana = new Date(Date.now() - 24 * 3600 * 1000);
      const corte = desde > ventana ? desde : ventana;

      const comisiones = await this.prisma.commission.findMany({
        where: {
          createdAt: { gt: corte },
          // Las comisiones de GRUPO EMPRESARIAL no cuelgan de un enlace de
          // afiliado: no hay a quién avisarle.
          referralUseId: { not: null },
        },
        select: {
          id: true,
          referralUseId: true,
          createdAt: true,
          referralUse: {
            select: {
              id: true,
              tenant: { select: { name: true, brandName: true } },
              referralCode: {
                select: {
                  id: true,
                  ownerName: true,
                  ownerWhatsapp: true,
                  role: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
        take: MAX_POR_PASADA,
      });
      if (!comisiones.length) return;

      // De una sola consulta, cuáles ya se avisaron. Preguntar una por una
      // serían cincuenta viajes a la base cada cinco minutos.
      const yaAvisadas = new Set(
        (
          await this.prisma.affiliateSaleAlert.findMany({
            where: { commissionId: { in: comisiones.map((c) => c.id) } },
            select: { commissionId: true },
          })
        ).map((a) => a.commissionId),
      );

      let enviados = 0;
      for (const c of comisiones) {
        if (yaAvisadas.has(c.id)) continue;
        const code = c.referralUse?.referralCode;
        const telefono = code?.ownerWhatsapp?.trim();
        if (!code || !telefono) continue;

        const negocio =
          c.referralUse?.tenant?.brandName?.trim() ||
          c.referralUse?.tenant?.name?.trim() ||
          'un negocio';

        // ¿Primera compra de ese negocio, o una renovación suya? Se mira si ya
        // hubo una comisión anterior por el MISMO enlace usado. Decirle «nueva
        // venta» por una renovación le haría creer que consiguió un cliente
        // nuevo, y a la tercera vez deja de creerse el aviso.
        const anteriores = await this.prisma.commission.count({
          where: {
            referralUseId: c.referralUseId,
            createdAt: { lt: c.createdAt },
          },
        });
        const esRenovacion = anteriores > 0;

        // La fila ANTES del envío: es el candado. Si dos pasadas se cruzan, la
        // segunda choca con el índice único y no manda un SMS repetido.
        try {
          await this.prisma.affiliateSaleAlert.create({
            data: {
              commissionId: c.id,
              referralCodeId: code.id,
              phone: telefono,
              esRenovacion,
            },
          });
        } catch (e: any) {
          if (e?.code === 'P2002') continue; // otra pasada se le adelantó
          throw e;
        }

        const texto = esRenovacion
          ? `${negocio} renovó su plan con tu enlace. Míralo en tu panel de afiliado.`
          : `Tienes una nueva venta con tu enlace: ${negocio}. Míralo en tu panel de afiliado.`;

        const r = await this.alerts
          .sendInternalAlert(telefono, texto)
          .catch((e) => ({ ok: false, message: (e as Error).message }));

        await this.prisma.affiliateSaleAlert.update({
          where: { commissionId: c.id },
          data: {
            ok: r.ok,
            sentAt: new Date(),
            error: r.ok ? null : ((r as any).message ?? 'sin detalle'),
          },
        });
        if (r.ok) enviados++;
      }

      if (enviados) {
        this.logger.log(`Avisos de venta a afiliados: ${enviados} enviados.`);
      }
    } catch (e) {
      // Nunca tumbar el cron por esto: es un aviso, no un cobro.
      this.logger.warn(`avisoVentas falló: ${(e as Error).message}`);
    }
  }

  /**
   * Desde qué momento se avisa.
   *
   * La primera vez que corre se guarda AHORA. Sin esto, el estreno mandaría un
   * SMS por cada comisión histórica: miles de mensajes a gente que hizo esa
   * venta hace meses.
   */
  private async desdeCuando(): Promise<Date> {
    const guardado = await this.prisma.setting.findUnique({
      where: { key: CLAVE_DESDE },
    });
    if (guardado?.value) {
      const d = new Date(guardado.value);
      if (!Number.isNaN(d.getTime())) return d;
    }
    const ahora = new Date();
    await this.prisma.setting.upsert({
      where: { key: CLAVE_DESDE },
      create: { key: CLAVE_DESDE, value: ahora.toISOString() },
      update: { value: ahora.toISOString() },
    });
    this.logger.log(
      `Avisos de venta a afiliados: arrancan desde ${ahora.toISOString()}. ` +
        'Las comisiones anteriores no se avisan.',
    );
    return ahora;
  }
}
