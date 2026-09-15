import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { PreregAlertsService } from '../auth/prereg-alerts.service';
import { telefonoDeAviso } from './telefono-de-aviso';

/** Desde cuándo se avisa. Se escribe una sola vez, la primera vez que corre. */
const CLAVE_DESDE = 'afiliados.avisoVentas.desde';

/**
 * Quién recibe copia de cada venta o renovación hecha con enlace de afiliado.
 * JSON: `[{ "name": "Javier", "phone": "+57…", "whiteLabelId": "…" }]`. Sin
 * `whiteLabelId` recibe las de todas las marcas.
 *
 * Lo pidió Javier el 15-09-2026: Javier y Jhon se enteran de cada pago y
 * renovación de la campaña de influencers sin esperar a que el influencer se
 * lo cuente. Es un ajuste y no código para cambiar a las personas sin desplegar.
 */
const CLAVE_COPIAS = 'afiliados.avisoVentas.copias';

/** Tope por pasada. Un pico raro no se convierte en una ráfaga de SMS. */
const MAX_POR_PASADA = 50;

/**
 * Cuántas comisiones de la ventana se miran para encontrar las pendientes. En
 * 24 h no se llega ni de lejos; es el techo de una consulta que solo trae ids.
 */
const MAX_CANDIDATAS = 1000;

/**
 * Cuánto reposa una comisión antes de avisarla. Una venta repartida crea una
 * comisión por persona, una detrás de otra: si la pasada cae entre dos, la
 * copia de esa venta saldría partida en dos SMS.
 */
const REPOSO_MS = 2 * 60 * 1000;

const CODIGO = {
  id: true,
  ownerName: true,
  ownerWhatsapp: true,
  role: true,
} as const;

const ROLES: Record<string, string> = {
  INFLUENCER: 'influencer',
  AMBASSADOR: 'embajador',
  VENDOR: 'vendedor',
  SOCIO: 'socio',
};

/** Una comisión de la venta, tal como la lee quien recibe la copia. */
export type ComisionDeLaVenta = {
  nombre: string;
  rol: string;
  monto: string;
  /** null = le llegó su SMS; si no, por qué no. */
  fallo: string | null;
  /** El número al que SÍ le llegó, para no mandarle también la copia. */
  telefono: string | null;
};

/** Una venta o renovación: un enlace usado, un periodo, una o más comisiones. */
export type Venta = {
  negocio: string;
  whiteLabelId: string | null;
  /** «Nicolas Quintero (influencer)»: el dueño del enlace que se usó. */
  enlace: string;
  esRenovacion: boolean;
  comisiones: ComisionDeLaVenta[];
};

type Copia = { name?: string; phone: string; whiteLabelId?: string | null };

/**
 * SMS al afiliado cuando entra una venta o una renovación que le deja comisión,
 * y copia de cada una a quien lleve la campaña (`CLAVE_COPIAS`).
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
 * El precio de hacerlo así es que el aviso no es instantáneo: llega entre dos y
 * siete minutos después. Para un «vendiste» es de sobra.
 *
 * **A quien le toca la comisión, no al dueño del enlace.** En una venta
 * repartida el enlace es de uno y las comisiones de varios
 * (`Commission.recipientCode`). Hasta el 15-09-2026 cada comisión se avisaba
 * al dueño del enlace: el vendedor recibía dos SMS y su influencer ninguno
 * (Urban Café, 11-09-2026).
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

      // Primero solo los ids de la ventana, para quedarse con las PENDIENTES
      // antes de cortar a 50. Pedir directamente 50 filas devolvía siempre las
      // 50 más viejas: con 50 ya avisadas en 24 h, las nuevas no entraban nunca
      // a la pasada (Fable, 15-09-2026).
      const candidatas = await this.prisma.commission.findMany({
        where: {
          createdAt: { gt: corte, lt: new Date(Date.now() - REPOSO_MS) },
          // Las comisiones de GRUPO EMPRESARIAL no cuelgan de un enlace de
          // afiliado: no hay a quién avisarle.
          referralUseId: { not: null },
          // Un reembolso o contracargo crea una comisión NEGATIVA de ajuste
          // sobre la misma venta: no es una venta ni una renovación.
          amount: { gt: 0 },
        },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
        take: MAX_CANDIDATAS,
      });
      if (!candidatas.length) return;

      // De una sola consulta, cuáles ya se avisaron. Preguntar una por una
      // serían cientos de viajes a la base cada cinco minutos.
      const yaAvisadas = new Set(
        (
          await this.prisma.affiliateSaleAlert.findMany({
            where: { commissionId: { in: candidatas.map((c) => c.id) } },
            select: { commissionId: true },
          })
        ).map((a) => a.commissionId),
      );
      const pendientes = candidatas
        .map((c) => c.id)
        .filter((id) => !yaAvisadas.has(id))
        .slice(0, MAX_POR_PASADA);
      if (!pendientes.length) return;

      let comisiones = await this.prisma.commission.findMany({
        where: { id: { in: pendientes } },
        select: {
          id: true,
          referralUseId: true,
          periodKey: true,
          amount: true,
          currency: true,
          createdAt: true,
          recipientCode: { select: CODIGO },
          referralUse: {
            select: {
              referralCode: { select: CODIGO },
              tenant: {
                select: { name: true, brandName: true, whiteLabelId: true },
              },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      });
      if (!comisiones.length) return;

      // Pasada llena: la última venta puede haber entrado a medias (una
      // comisión dentro y su hermana fuera). Se deja entera para la siguiente,
      // salvo que no haya nada más.
      if (pendientes.length === MAX_POR_PASADA) {
        const ultima = ventaDe(comisiones[comisiones.length - 1]);
        const resto = comisiones.filter((c) => ventaDe(c) !== ultima);
        if (resto.length) comisiones = resto;
      }

      const ventas = new Map<string, Venta>();
      let enviados = 0;
      for (const c of comisiones) {
        if (yaAvisadas.has(c.id)) continue;
        const enlace = c.referralUse?.referralCode;
        // Las comisiones viejas no tienen `recipientCode`: esas son del dueño
        // del enlace, como se avisó siempre.
        const destinatario = c.recipientCode ?? enlace;
        if (!enlace || !destinatario) continue;

        const tenant = c.referralUse?.tenant;
        const negocio =
          tenant?.brandName?.trim() || tenant?.name?.trim() || 'un negocio';

        // ¿Primera compra o renovación? Decirle «nueva venta» por una
        // renovación le haría creer que consiguió un cliente nuevo, y a la
        // tercera vez deja de creerse el aviso.
        const esRenovacion =
          (await this.prisma.commission.count({ where: anterioresA(c) })) > 0;

        const escrito = (destinatario.ownerWhatsapp ?? '').trim();
        const telefono = telefonoDeAviso(escrito);

        // La fila ANTES del envío: es el candado. Si dos pasadas se cruzan, la
        // segunda choca con el índice único y no manda un SMS repetido.
        try {
          await this.prisma.affiliateSaleAlert.create({
            data: {
              commissionId: c.id,
              referralCodeId: destinatario.id,
              // Si el número no sirve se guarda tal como está escrito: es lo
              // que hay que ver para corregirlo.
              phone: telefono ?? escrito,
              esRenovacion,
            },
          });
        } catch (e: any) {
          if (e?.code === 'P2002') continue; // otra pasada se le adelantó
          throw e;
        }

        let fallo: string | null = null;
        if (!telefono) {
          // Nunca «enviado» a un número imposible: Grow Business lo acepta sin
          // quejarse y el aviso se pierde sin que nadie lo sepa.
          fallo = escrito
            ? `su teléfono (${escrito}) no es válido`
            : 'no tiene teléfono';
          await this.prisma.affiliateSaleAlert.update({
            where: { commissionId: c.id },
            data: { ok: false, error: fallo },
          });
        } else {
          const r = await this.alerts
            .sendInternalAlert(
              telefono,
              textoParaAfiliado({
                negocio,
                esRenovacion,
                esSuEnlace: destinatario.id === enlace.id,
                duenoDelEnlace: enlace.ownerName,
              }),
            )
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
          else fallo = 'el SMS no salió';
        }

        const clave = ventaDe(c);
        const venta = ventas.get(clave) ?? {
          negocio,
          whiteLabelId: tenant?.whiteLabelId ?? null,
          enlace: `${enlace.ownerName.trim()} (${rolDe(enlace.role)})`,
          esRenovacion,
          comisiones: [],
        };
        venta.comisiones.push({
          nombre: destinatario.ownerName.trim(),
          rol: rolDe(destinatario.role),
          monto: `${Number(c.amount)} ${c.currency}`,
          fallo,
          telefono: fallo ? null : telefono,
        });
        ventas.set(clave, venta);
      }

      if (ventas.size) await this.mandarCopias([...ventas.values()]);

      if (enviados) {
        this.logger.log(`Avisos de venta a afiliados: ${enviados} enviados.`);
      }
    } catch (e) {
      // Nunca tumbar el cron por esto: es un aviso, no un cobro.
      this.logger.warn(`avisoVentas falló: ${(e as Error).message}`);
    }
  }

  /**
   * Una copia por venta, no por comisión: una venta repartida es UN pago, y
   * quien lleva la campaña la lee entera en un solo SMS.
   */
  private async mandarCopias(ventas: Venta[]) {
    const copias = await this.copias();
    if (!copias.length) return;
    // Los negocios históricos de Clubify no tienen marca (`whiteLabelId` null)
    // y el resto del código los trata como de Clubify. Sin esto, la copia «solo
    // Clubify» se saltaba justo a los clientes más antiguos (Fable, 15-09-2026).
    const clubify = ventas.some((v) => !v.whiteLabelId)
      ? ((
          await this.prisma.whiteLabel.findFirst({
            where: { slug: 'clubify' },
            select: { id: true },
          })
        )?.id ?? null)
      : null;
    for (const venta of ventas) {
      const marca = venta.whiteLabelId ?? clubify;
      // A quien ya le llegó el SMS de su comisión no se le repite como copia.
      const yaAvisados = new Set(venta.comisiones.map((c) => c.telefono));
      for (const copia of copias) {
        if (copia.whiteLabelId && copia.whiteLabelId !== marca) continue;
        const telefono = telefonoDeAviso(copia.phone);
        if (!telefono || yaAvisados.has(telefono)) continue;
        await this.alerts
          .sendInternalAlert(telefono, textoDeCopia(venta))
          .catch(() => null);
      }
    }
  }

  private async copias(): Promise<Copia[]> {
    const fila = await this.prisma.setting.findUnique({
      where: { key: CLAVE_COPIAS },
    });
    if (!fila?.value) return [];
    try {
      const lista = JSON.parse(fila.value);
      return Array.isArray(lista)
        ? lista.filter((x) => x && typeof x.phone === 'string')
        : [];
    } catch {
      this.logger.warn(`${CLAVE_COPIAS} no es JSON válido: no salen copias.`);
      return [];
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

/** La venta a la que pertenece una comisión: mismo enlace usado, mismo periodo. */
function ventaDe(c: {
  id: string;
  referralUseId: string | null;
  periodKey: string | null;
}): string {
  return `${c.referralUseId}|${c.periodKey ?? c.id}`;
}

function rolDe(role: string | null | undefined): string {
  return (role && ROLES[role]) || 'afiliado';
}

/**
 * Las comisiones que convierten esta en una renovación: del mismo enlace usado
 * y de un periodo ANTERIOR. Antes bastaba «una comisión previa del mismo
 * enlace», y en una venta repartida la segunda comisión del primer pago —creada
 * un instante después que su hermana— salía como renovación.
 */
export function anterioresA(c: {
  referralUseId: string | null;
  periodKey: string | null;
  createdAt: Date;
}): Prisma.CommissionWhereInput {
  return {
    referralUseId: c.referralUseId,
    createdAt: { lt: c.createdAt },
    // Las filas viejas no tienen periodo: cuentan como anteriores.
    ...(c.periodKey
      ? { OR: [{ periodKey: null }, { periodKey: { not: c.periodKey } }] }
      : {}),
  };
}

export function textoParaAfiliado(o: {
  negocio: string;
  esRenovacion: boolean;
  esSuEnlace: boolean;
  duenoDelEnlace: string;
}): string {
  if (o.esSuEnlace) {
    return o.esRenovacion
      ? `${o.negocio} renovó su plan con tu enlace. Míralo en tu panel de afiliado.`
      : `Tienes una nueva venta con tu enlace: ${o.negocio}. Míralo en tu panel de afiliado.`;
  }
  // La comisión es suya pero el enlace es de alguien de su equipo.
  const quien = o.duenoDelEnlace.trim();
  return o.esRenovacion
    ? `${o.negocio} renovó su plan con el enlace de ${quien}, de tu equipo. Tu comisión está en tu panel de afiliado.`
    : `Nueva venta en tu equipo: ${o.negocio}, con el enlace de ${quien}. Tu comisión está en tu panel de afiliado.`;
}

export function textoDeCopia(v: Venta): string {
  const lineas = [
    v.esRenovacion
      ? `📣 Renovación: ${v.negocio} renovó su plan con el enlace de ${v.enlace}.`
      : `📣 Nueva venta: ${v.negocio}, con el enlace de ${v.enlace}.`,
    ...v.comisiones.map((c) => `• Comisión de ${c.nombre} (${c.rol}): ${c.monto}`),
  ];
  for (const c of v.comisiones) {
    if (c.fallo) lineas.push(`⚠️ A ${c.nombre} no le llegó el aviso: ${c.fallo}.`);
  }
  return lineas.join('\n');
}
