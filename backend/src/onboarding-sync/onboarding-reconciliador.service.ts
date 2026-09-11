import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../common/prisma/prisma.service';
import { OnboardingWebhookService } from './onboarding-webhook.service';

/**
 * Da de alta el onboarding de los negocios que se quedaron sin él.
 *
 * POR QUÉ UN RECONCILIADOR Y NO UNA LLAMADA MÁS
 * ---------------------------------------------
 * `crearClienteEnOnboarding` se llama desde UN sitio: el botón «crear negocio»
 * del panel. Pero un negocio nace por CINCO caminos —ese, el auto-registro del
 * cliente, la prueba gratis, el alta de InfoLink y la activación por Hotmart—
 * y los otros cuatro no llaman a nadie.
 *
 * Así se perdió Laly.com el 2026-09-11: la clienta compró, se registró sola, y
 * su onboarding no existió nunca. Nadie se enteró hasta que Javier lo vio en el
 * panel.
 *
 * Añadir la llamada a cada camino es exactamente cómo se llega a este bug: hay
 * que acordarse cinco veces, y el sexto camino que alguien añada empezará
 * roto. Esto no se olvida, y además **repara lo ya pasado**.
 *
 * SE APOYA EN LOS CANDADOS QUE YA HAY, no los repite:
 *  - `createToken` se niega en negocios de marca blanca (el onboarding sync es
 *    interno de Clubify), así que un negocio de Sellea ni se intenta.
 *  - Sin `onboarding.api.url`/`key` configuradas no hace nada: queda inerte.
 */
@Injectable()
export class OnboardingReconciliadorService {
  private readonly logger = new Logger('OnboardingReconciliador');

  constructor(
    private readonly prisma: PrismaService,
    private readonly onboardingWebhook: OnboardingWebhookService,
  ) {}

  /**
   * Solo negocios del ÚLTIMO DÍA.
   *
   * Sin ventana, la primera pasada daría de alta decenas de onboardings de
   * negocios que llevan semanas trabajando y que casi seguro ya se
   * configuraron a mano: los implementadores verían clientes nuevos que no lo
   * son. Con 30 días salían 6, y solo 1 era el del problema.
   *
   * Un día basta y sobra para lo que esto arregla: el cron pasa cada media
   * hora, así que un alta se recoge en 30 minutos. La ventana solo tiene que
   * cubrir una caída, no un historial.
   *
   * Decisión de Javier, 2026-09-11: «por ahora solo me interesa el de hoy».
   * Para dar de alta uno viejo, se hace a mano desde el panel.
   */
  private static readonly DIAS = 1;
  /** Pocos por pasada: cada uno es un POST a otra app. */
  private static readonly TOPE = 10;

  @Cron(CronExpression.EVERY_30_MINUTES)
  async reconciliar(): Promise<{ revisados: number; dadosDeAlta: number }> {
    const desde = new Date(
      Date.now() - OnboardingReconciliadorService.DIAS * 86400000,
    );
    const recientes = await this.prisma.tenant
      .findMany({
        where: {
          createdAt: { gte: desde },
          // Un negocio suspendido no necesita formulario.
          status: { in: ['ACTIVE', 'TRIAL'] },
          isCampaignHost: false,
          // Marca blanca fuera: `createToken` se negaría igual, pero pedirlo
          // aquí evita intentarlo y llenar el log de avisos.
          OR: [{ whiteLabelId: null }, { whiteLabel: { slug: 'clubify' } }],
        },
        select: { id: true, slug: true },
        orderBy: { createdAt: 'desc' },
      })
      .catch((e) => {
        this.logger.warn(`No se pudo listar candidatos: ${e?.message}`);
        return [] as Array<{ id: string; slug: string }>;
      });
    if (!recientes.length) return { revisados: 0, dadosDeAlta: 0 };

    // `OnboardingToken` NO tiene relación con `Tenant` —solo la columna— así
    // que el «sin token» no se puede pedir en el `where`. Se resuelve con una
    // segunda consulta en vez de con un `none`, que Prisma aquí no ofrece.
    //
    // La huella del alta es un token VIVO: uno revocado significa que el alta
    // falló y hay que reintentarla.
    const conToken = new Set(
      (
        await this.prisma.onboardingToken.findMany({
          where: { tenantId: { in: recientes.map((t) => t.id) }, revokedAt: null },
          select: { tenantId: true },
        })
      ).map((x) => x.tenantId),
    );
    const candidatos = recientes
      .filter((t) => !conToken.has(t.id))
      .slice(0, OnboardingReconciliadorService.TOPE);

    if (!candidatos.length) return { revisados: 0, dadosDeAlta: 0 };

    let dadosDeAlta = 0;
    for (const t of candidatos) {
      await this.onboardingWebhook.crearClienteEnOnboarding(t.id);
      // Se vuelve a mirar: `crearClienteEnOnboarding` no lanza —es
      // best-effort— así que lo único que dice si entró es la huella.
      if (await this.onboardingWebhook.tieneOnboarding(t.id)) {
        dadosDeAlta++;
        this.logger.log(`Onboarding dado de alta para ${t.slug}`);
      } else {
        this.logger.warn(
          `Onboarding NO se pudo dar de alta para ${t.slug} — se reintenta en la proxima pasada`,
        );
      }
    }
    return { revisados: candidatos.length, dadosDeAlta };
  }
}
