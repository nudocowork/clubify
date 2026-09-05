import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { nanoid } from 'nanoid';
import type { Prisma, ClubMembresiaStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { WalletService } from '../wallet/wallet.service';
import { QueueService } from '../jobs/queue.service';
import { AutomationsService } from '../automations/automations.service';
import { genQrToken } from '../passes/passes.service';
import {
  cupoDeAlta,
  diaDelMes,
  errorDeTramos,
  periodicidadValida,
  periodoDe,
  tocaReiniciar,
  type TramoAlta,
} from './club-periodo';

/**
 * Tarjeta de Club: el cliente le paga una suscripción AL NEGOCIO y recibe un
 * cupo mensual de beneficios que va gastando.
 *
 * El cobro es MANUAL: el negocio cobra por fuera y pausa o reactiva la
 * membresía a mano. Aquí no se toca ninguna pasarela.
 */
@Injectable()
export class ClubService {
  private logger = new Logger(ClubService.name);

  constructor(
    private prisma: PrismaService,
    private wallet: WalletService,
    private jobs: QueueService,
    private automations: AutomationsService,
  ) {}

  /**
   * Empuja el pase actualizado a la billetera del cliente.
   *
   * Copiado tal cual de `stamps.service`: si BullMQ tiene Redis, el worker lo
   * consume; si no, se cae al push directo. Llamar a los dos siempre mandaba
   * el pase dos veces al iPhone.
   *
   * Sin esto el cliente consume un café y su tarjeta sigue diciendo lo mismo.
   */
  private empujarPase(passId: string, motivo: string) {
    this.jobs
      .enqueue('wallet.push', { passId, reason: motivo })
      .catch(() => {
        this.wallet.pushPassUpdate(passId).catch(() => null);
      });
  }

  private tid(user: AuthUser, override?: string): string {
    const id = user.role === 'SUPER_ADMIN' && override ? override : user.tenantId;
    if (!id) throw new ForbiddenException('Sin negocio asociado.');
    return id;
  }

  /**
   * El módulo tiene que estar encendido para este negocio.
   *
   * Se comprueba solo al CREAR —plan nuevo o socio nuevo—, no al consumir. Si
   * el módulo se apaga a mitad de mes, quien ya pagó su suscripción sigue
   * gastando lo suyo: apagar un módulo es una decisión sobre el negocio, no una
   * excusa para quedarse con lo que un cliente pagó. Convenios lo bloquea
   * también al canjear, y ahí tiene sentido porque el beneficio es gratis.
   */
  private async assertHabilitado(tenantId: string) {
    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { clubEnabled: true },
    });
    if (!t?.clubEnabled) {
      throw new ForbiddenException(
        'La Tarjeta de Club no está habilitada para este negocio.',
      );
    }
  }

  /** El plan, comprobando que es de este negocio. */
  private async planDelNegocio(planId: string, tenantId: string) {
    const plan = await this.prisma.clubPlan.findFirst({
      where: { id: planId, tenantId },
      include: { tramos: { orderBy: { desdeDia: 'asc' } } },
    });
    if (!plan) throw new NotFoundException('Plan no encontrado.');
    return plan;
  }

  // ── Planes ──────────────────────────────────────────────────────────────

  /**
   * ¿Está encendido el módulo para este negocio? Lo consulta el panel para
   * pintar «pídelo» en vez de un formulario que va a dar 403 al guardar.
   */
  async estadoDelModulo(user: AuthUser, override?: string) {
    const tenantId = this.tid(user, override);
    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { clubEnabled: true },
    });
    return { habilitado: Boolean(t?.clubEnabled) };
  }

  async listarPlanes(user: AuthUser, override?: string) {
    const tenantId = this.tid(user, override);
    const planes = await this.prisma.clubPlan.findMany({
      where: { tenantId },
      include: { tramos: { orderBy: { desdeDia: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
    const conteos = await this.prisma.clubMembresia.groupBy({
      by: ['planId', 'status'],
      where: { plan: { tenantId } },
      _count: { _all: true },
    });
    return planes.map((p) => ({
      ...p,
      miembrosActivos:
        conteos.find((c) => c.planId === p.id && c.status === 'ACTIVA')?._count._all ?? 0,
      miembrosPausados:
        conteos.find((c) => c.planId === p.id && c.status === 'PAUSADA')?._count._all ?? 0,
    }));
  }

  async crearPlan(
    user: AuthUser,
    dto: {
      name: string;
      beneficiosPorMes: number;
      unidad?: string;
      precioCents?: number;
      currency?: string;
      periodicidad?: string;
      description?: string;
      tramos?: TramoAlta[];
    },
    override?: string,
  ) {
    const tenantId = this.tid(user, override);
    await this.assertHabilitado(tenantId);
    if (!dto.name?.trim()) throw new BadRequestException('Falta el nombre del plan.');
    if (!Number.isInteger(dto.beneficiosPorMes) || dto.beneficiosPorMes < 1) {
      throw new BadRequestException('Los beneficios al mes deben ser 1 o más.');
    }
    const errTramos = errorDeTramos(dto.tramos ?? []);
    if (errTramos) throw new BadRequestException(errTramos);

    const slug = dto.name
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40);

    // El slug sale del nombre, así que dos planes llamados igual chocaban con
    // el índice único y Prisma devolvía un P2002 crudo: el negocio veía un 500
    // sin saber qué había hecho mal. Se le añade sufijo hasta que entre.
    const base = slug || 'plan';
    // Una consulta y el hueco se busca en memoria. Antes eran hasta cincuenta
    // `findFirst` seguidos, uno por intento.
    const ocupados = new Set(
      (
        await this.prisma.clubPlan.findMany({
          where: { tenantId, slug: { startsWith: base } },
          select: { slug: true },
        })
      ).map((p) => p.slug),
    );
    let libre = base;
    for (let i = 2; ocupados.has(libre) && i <= 50; i++) libre = `${base}-${i}`;

    const plan = await this.prisma.clubPlan.create({
      data: {
        tenantId,
        name: dto.name.trim(),
        slug: libre,
        description: dto.description?.trim() ?? '',
        beneficiosPorMes: dto.beneficiosPorMes,
        unidad: dto.unidad?.trim() || 'beneficio',
        precioCents: dto.precioCents ?? 0,
        currency: dto.currency ?? 'COP',
        periodicidad: periodicidadValida(dto.periodicidad),
        tramos: { create: dto.tramos ?? [] },
      },
      include: { tramos: true },
    });

    // La tarjeta se crea AQUÍ y no al dar de alta al primer socio. Antes nacía
    // con el primer alta, así que un plan recién creado no tenía nada que
    // diseñar: el negocio no podía ver ni tocar los colores, el logo o el icono
    // hasta que alguien se hiciera socio — y entonces ya era tarde, porque ese
    // primero se llevaba la tarjeta con el aspecto por defecto.
    await this.tarjetaDelPlan(tenantId, plan);
    return plan;
  }

  async actualizarPlan(
    user: AuthUser,
    planId: string,
    dto: {
      name?: string;
      beneficiosPorMes?: number;
      unidad?: string;
      precioCents?: number;
      periodicidad?: string;
      description?: string;
      isActive?: boolean;
      tramos?: TramoAlta[];
    },
    override?: string,
  ) {
    const tenantId = this.tid(user, override);
    const previo = await this.planDelNegocio(planId, tenantId);

    if (dto.beneficiosPorMes != null) {
      if (!Number.isInteger(dto.beneficiosPorMes) || dto.beneficiosPorMes < 1) {
        throw new BadRequestException('Los beneficios al mes deben ser 1 o más.');
      }
    }
    if (dto.tramos) {
      const err = errorDeTramos(dto.tramos);
      if (err) throw new BadRequestException(err);
    }

    const plan = await this.prisma.$transaction(async (tx) => {
      // Los tramos se reemplazan enteros: es más simple de razonar que
      // diferenciar altas y bajas, y son pocas filas.
      if (dto.tramos) {
        await tx.clubTramoAlta.deleteMany({ where: { planId } });
        if (dto.tramos.length) {
          await tx.clubTramoAlta.createMany({
            data: dto.tramos.map((t) => ({ ...t, planId })),
          });
        }
      }
      const actualizado = await tx.clubPlan.update({
        where: { id: planId },
        data: {
          name: dto.name?.trim(),
          description: dto.description?.trim(),
          beneficiosPorMes: dto.beneficiosPorMes,
          // `|| undefined` y no el valor recortado a secas: mandar espacios
          // dejaba la unidad vacía y el `rewardText` de la tarjeta en «10  al
          // mes». Igual que en `crearPlan`.
          unidad: dto.unidad?.trim() || undefined,
          precioCents: dto.precioCents,
          // `undefined` cuando no viene, para no pisar el valor guardado: el
          // panel manda el plan entero, pero la API la usa también el que
          // solo cambia el cupo.
          periodicidad: dto.periodicidad
            ? periodicidadValida(dto.periodicidad)
            : undefined,
          isActive: dto.isActive,
        },
        include: { tramos: { orderBy: { desdeDia: 'asc' } } },
      });

      // La tarjeta-plantilla lleva el nombre y el denominador del pase. Sin
      // sincronizarla, subir el cupo de 10 a 15 dejaba la billetera diciendo
      // «15 / 10» —el reinicio reparte 15 pero `stampsRequired` seguía en 10—
      // y el texto del premio mintiendo con el cupo viejo.
      await tx.card.updateMany({
        where: { tenantId, clubPlanId: planId },
        data: {
          name: actualizado.name,
          stampsRequired: actualizado.beneficiosPorMes,
          rewardText: `${actualizado.beneficiosPorMes} ${actualizado.unidad} al mes`,
        },
      });

      return actualizado;
    });

    // Solo se reenvían los pases si cambió algo que SE VE en ellos. El pase
    // imprime el nombre, el cupo y la unidad; nada más. Sin este filtro,
    // corregir una errata de la descripción o togglear el interruptor mandaba
    // un push a cada socio: con 3000, tres mil trabajos y tres mil llamadas a
    // Apple y Google por un cambio que nadie iba a notar.
    //
    // Fuera de la transacción a propósito: encolar pushes dentro alargaría el
    // bloqueo de las filas por algo que no tiene que ser atómico.
    const cambioVisible =
      (dto.name != null && dto.name.trim() !== previo.name) ||
      (dto.beneficiosPorMes != null &&
        dto.beneficiosPorMes !== previo.beneficiosPorMes) ||
      (!!dto.unidad?.trim() && dto.unidad.trim() !== previo.unidad);
    if (cambioVisible) await this.empujarPasesDelPlan(planId);
    return plan;
  }

  /**
   * Reenvía a la billetera todos los pases vivos de un plan.
   *
   * Se llama al editar el plan: el cupo y el nombre están impresos en el pase,
   * y sin push el socio sigue viendo los de antes hasta su próximo consumo.
   * En trozos porque un plan de gimnasio puede tener miles.
   */
  private async empujarPasesDelPlan(planId: string) {
    const filas = await this.prisma.clubMembresia.findMany({
      where: { planId, passId: { not: null }, status: { not: 'CANCELADA' } },
      select: { passId: true },
      take: 5000,
    });
    if (filas.length === 5000) {
      this.logger.warn(
        `Club: el plan ${planId} tiene 5000 socios o más — los que pasen de ahí se quedan con el pase viejo hasta su próximo consumo.`,
      );
    }
    for (const f of filas) this.empujarPase(f.passId!, 'club.plan.editado');
    return filas.length;
  }

  /**
   * El aspecto de la tarjeta del plan: lo que el socio ve en el móvil.
   *
   * Es un endpoint acotado a propósito, en vez de mandar al negocio al editor
   * general de tarjetas. Ahí saldrían campos que en un club no significan nada
   * —cuántos sellos, el premio, la conversión a otra tarjeta— y uno que además
   * ROMPE: `stampsRequired` es el cupo del mes y lo reescribe el plan, así que
   * tocarlo a mano se pierde en el siguiente guardado.
   */
  async disenoDelPlan(user: AuthUser, planId: string, override?: string) {
    const tenantId = this.tid(user, override);
    const plan = await this.planDelNegocio(planId, tenantId);
    const card = await this.tarjetaDelPlan(tenantId, plan);
    return this.prisma.card.findUniqueOrThrow({
      where: { id: card.id },
      select: {
        id: true,
        primaryColor: true,
        secondaryColor: true,
        logoUrl: true,
        stampIcon: true,
        stampIconImageUrl: true,
        stampBgType: true,
        stampBgImageUrl: true,
        // El nombre que sale ARRIBA en el pase. La vista previa del panel lo
        // necesita o pinta otra cosa en su lugar: enseñaba el nombre del plan
        // donde el socio ve el del negocio, así que el negocio estaba
        // decidiendo colores mirando una tarjeta que no es la suya.
        businessName: true,
      },
    });
  }

  async guardarDiseno(
    user: AuthUser,
    planId: string,
    dto: {
      primaryColor?: string;
      secondaryColor?: string;
      logoUrl?: string | null;
      stampIcon?: string;
      stampIconImageUrl?: string | null;
      stampBgType?: 'GRADIENT' | 'SOLID' | 'IMAGE';
      stampBgImageUrl?: string | null;
    },
    override?: string,
  ) {
    const tenantId = this.tid(user, override);
    const plan = await this.planDelNegocio(planId, tenantId);
    const card = await this.tarjetaDelPlan(tenantId, plan);

    await this.prisma.card.update({
      where: { id: card.id },
      data: {
        primaryColor: dto.primaryColor,
        secondaryColor: dto.secondaryColor,
        logoUrl: dto.logoUrl,
        stampIcon: dto.stampIcon,
        stampIconImageUrl: dto.stampIconImageUrl,
        stampBgType: dto.stampBgType,
        stampBgImageUrl: dto.stampBgImageUrl,
      },
    });

    // Los pases ya instalados llevan el diseño DENTRO: sin empujarlos, los
    // socios que ya tienen la tarjeta seguirían viendo los colores viejos para
    // siempre y solo los nuevos verían el cambio.
    await this.empujarPasesDelPlan(planId);
    return this.disenoDelPlan(user, planId, override);
  }

  // ── Membresías ──────────────────────────────────────────────────────────

  /**
   * Da de alta a un cliente. El cupo del primer mes sale del tramo que
   * contenga el día de hoy.
   *
   * Si ya tenía membresía en este plan, NO se crea otra: se devuelve la suya.
   * El índice único es la red de verdad —un doble clic no puede duplicarle el
   * cupo— y esto evita que el segundo clic le reviente en la cara al negocio.
   */
  /**
   * La tarjeta-plantilla del plan. Una por plan, compartida por todos sus
   * socios: define colores, logo y nombre del pase, no el saldo de nadie.
   *
   * Los colores del NEGOCIO van explícitos. `Card.primaryColor` trae por
   * defecto el verde de Clubify, así que no escribirlos deja la tarjeta de una
   * marca blanca pintada con el color de la plataforma — y esta fila se crea
   * una sola vez y se queda, así que el primer socio que se dé de alta fija el
   * aspecto para siempre. Es la fuga de marca de siempre; Convenios ya la pagó.
   */
  /**
   * La tarjeta-plantilla del plan: la de siempre, o una nueva si es el primer
   * socio.
   *
   * El «buscar o crear» pasa FUERA de la transacción del alta, así que dos
   * primeros socios a la vez encontraban las dos que no había y creaban DOS
   * plantillas. La segunda dejaba huérfano el pase que el cliente ya tenía
   * instalado: al escanearlo respondía que la tarjeta no tiene socio.
   *
   * Lo arregla el índice único `[tenantId, clubPlanId]`, y aquí se recoge su
   * P2002 para devolver la que ganó en vez de un 500.
   */
  private async tarjetaDelPlan(
    tenantId: string,
    plan: { id: string; name: string; beneficiosPorMes: number; unidad: string },
  ): Promise<{ id: string }> {
    // `select` acotado: sin él traía la fila entera —los JSON de la billetera,
    // los premios— para quedarse solo con el id.
    const suya = await this.prisma.card.findFirst({
      where: { tenantId, clubPlanId: plan.id },
      select: { id: true },
    });
    if (suya) return suya;

    try {
      return await this.crearTarjetaDelPlan(tenantId, plan);
    } catch (e: any) {
      if (e?.code !== 'P2002') throw e;
      return this.prisma.card.findFirstOrThrow({
        where: { tenantId, clubPlanId: plan.id },
        select: { id: true },
      });
    }
  }

  private async crearTarjetaDelPlan(
    tenantId: string,
    plan: { id: string; name: string; beneficiosPorMes: number; unidad: string },
  ) {
    const negocio = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        primaryColor: true,
        secondaryColor: true,
        logoUrl: true,
        brandName: true,
      },
    });
    return this.prisma.card.create({
      data: {
        tenantId,
        clubPlanId: plan.id,
        name: plan.name,
        // `STAMPS` porque el saldo vive en `Pass.stampsCount` como en el resto
        // — así hereda gratis el pintado, el push y la geolocalización. Lo que
        // la distingue es `clubPlanId`, y por eso los resolutores de «primera
        // tarjeta de sellos del negocio» la excluyen.
        type: 'STAMPS',
        stampsRequired: plan.beneficiosPorMes,
        rewardText: `${plan.beneficiosPorMes} ${plan.unidad} al mes`,
        primaryColor: negocio?.primaryColor ?? undefined,
        secondaryColor: negocio?.secondaryColor ?? undefined,
        businessName: negocio?.brandName ?? '',
        logoUrl: negocio?.logoUrl ?? null,
        isActive: true,
      },
    });
  }

  async darDeAlta(
    user: AuthUser,
    planId: string,
    customerId: string,
    override?: string,
  ) {
    const tenantId = this.tid(user, override);
    await this.assertHabilitado(tenantId);
    const plan = await this.planDelNegocio(planId, tenantId);
    if (!plan.isActive) throw new BadRequestException('El plan está apagado.');

    const cliente = await this.prisma.customer.findFirst({
      where: { id: customerId, tenantId },
      select: { id: true },
    });
    if (!cliente) throw new NotFoundException('Cliente no encontrado.');

    const existente = await this.prisma.clubMembresia.findUnique({
      where: { planId_customerId: { planId, customerId } },
    });
    // Devolver la suya tal cual dejaba FUERA PARA SIEMPRE a quien se dio de
    // baja: el índice único impide crear otra, así que un cancelado no podía
    // volver a entrar nunca. Si vuelve, se reactiva con el cupo que le toque
    // por el día de hoy.
    // Sin `passId` la membresía está viva pero sin tarjeta, y así no se puede
    // consumir nada: cada escaneo respondía «esta membresía todavía no tiene
    // tarjeta», sin salida. Pasa si alguien borró la tarjeta del plan (ahora
    // bloqueado) o si el pase se perdió por otra vía. Se deja caer al alta de
    // abajo, que emite pase nuevo y repone el cupo que le toca por hoy.
    if (existente && existente.status !== 'CANCELADA' && existente.passId) {
      // Misma forma que el alta nueva, siempre. Devolver aquí la fila pelada
      // y allá una con `saldo` obligaba a quien llama a distinguir dos casos
      // que para él son el mismo: «este cliente ya está dentro, con esto».
      const suPase = await this.prisma.pass.findUnique({
        where: { id: existente.passId },
        select: { stampsCount: true },
      });
      // El `passId` puede apuntar a una fila que ya no existe. Si es así se
      // trata igual que si no tuviera: se le emite uno nuevo abajo.
      if (suPase) return { ...existente, saldo: suPase.stampsCount };
    }

    const ahora = new Date();
    const periodoActual = periodoDe(ahora);
    // `cupoDeAlta` es el precio del socio NUEVO: lo que le toca por el día en
    // que entra. Aplicárselo también al que VUELVE dentro del mismo mes abría
    // una recarga infinita —cancelar y readmitir devolvía el cupo entero, las
    // veces que hiciera falta, con una sola cuota pagada— y, al revés, a quien
    // se canceló por error el día 20 le recortaba a 3 los 8 que le quedaban.
    //
    // Volver dentro del mismo período conserva lo que tenía. En un mes
    // posterior sí entra como nuevo, que es lo que es.
    const vuelveEsteMes =
      !!existente && existente.periodo === periodoActual && !!existente.passId;
    const cupo = vuelveEsteMes
      ? existente!.cupoDelPeriodo
      : cupoDeAlta(diaDelMes(ahora), plan.beneficiosPorMes, plan.tramos);

    // La tarjeta del plan. Una por plan, compartida por todos sus socios: es
    // la PLANTILLA del pase (colores, logo, nombre), no la tarjeta de nadie.
    // Se crea con `type: STAMPS` porque el saldo vive en `Pass.stampsCount`
    // como en el resto — así hereda gratis el pintado, el push y la
    // geolocalización. Lo que la distingue es `clubPlanId`, y por eso los
    // resolutores de "primera tarjeta de sellos del negocio" la excluyen.
    const card = await this.tarjetaDelPlan(tenantId, plan);

    const alta = await this.prisma.$transaction(async (tx) => {
      // El pase nace CON el cupo dentro. Es lo contrario de una tarjeta de
      // sellos, que nace en cero: aquí el cliente ya pagó.
      // Si vuelve este mes, el saldo del pase NO se toca: es lo que le quedaba.
      // Es además el único camino que escribía un saldo sin dejar
      // `ClubConsumo`, así que en el histórico no se veía.
      let pass;
      try {
        pass = await tx.pass.create({
          data: {
            tenantId,
            cardId: card.id,
            customerId,
            serialNumber: `CLB-${nanoid(10).toUpperCase()}`,
            qrToken: genQrToken(),
            authToken: nanoid(32),
            stampsCount: cupo,
          },
        });
      } catch (e: any) {
        // Ya tenía pase de esta tarjeta (se dio de baja y vuelve). Se reutiliza
        // y se le repone el cupo: el cliente conserva el pase instalado.
        if (e?.code !== 'P2002') throw e;
        pass = await tx.pass.update({
          where: { cardId_customerId: { cardId: card.id, customerId } },
          data: {
            ...(vuelveEsteMes ? {} : { stampsCount: cupo }),
            status: 'ACTIVE',
            lastActivityAt: new Date(),
          },
        });
      }

      const datos = {
        passId: pass.id,
        status: 'ACTIVA' as const,
        cupoDelPeriodo: cupo,
        periodo: periodoActual,
        pausedAt: null,
      };
      // Dos altas simultáneas: la segunda choca con el índice único. Se
      // devuelve la que ganó en vez de un P2002 crudo que el negocio vería
      // como un 500 sin explicación.
      let m;
      if (existente) {
        m = await tx.clubMembresia.update({ where: { id: existente.id }, data: datos });
      } else {
        try {
          m = await tx.clubMembresia.create({ data: { planId, customerId, ...datos } });
        } catch (e: any) {
          if (e?.code !== 'P2002') throw e;
          m = await tx.clubMembresia.findUniqueOrThrow({
            where: { planId_customerId: { planId, customerId } },
          });
        }
      }
      return {
        ...m,
        passId: pass.id,
        saldo: vuelveEsteMes ? pass.stampsCount : cupo,
        // Para saber fuera si esto fue un alta DE VERDAD o alguien que ya
        // estaba: el mensaje de bienvenida solo se manda la primera vez.
        esNuevo: !vuelveEsteMes,
      };
    });

    // El mismo aviso de bienvenida que dispara cualquier otra tarjeta al
    // emitirse. Sin esto, el socio que acaba de PAGAR era el único cliente del
    // negocio que no recibía nada: el club no llamaba a las automatizaciones
    // en ningún sitio.
    //
    // Solo en el alta real. A quien vuelve dentro del mismo mes no se le da la
    // bienvenida otra vez, o le llegaría cada vez que lo readmiten.
    if (alta.esNuevo) {
      this.automations
        .emit('PASS_CREATED', {
          tenantId,
          customerId,
          cardId: card.id,
          passId: alta.passId,
        })
        .catch(() => null);
    }

    return alta;
  }

  /**
   * Pausa o reactiva. Es el interruptor manual del negocio mientras no haya
   * pasarela: si el cliente no pagó, se pausa y deja de consumir.
   *
   * Al pausar NO se toca el saldo. Vuelve con lo que tenía, y no se le
   * reinicia hasta que cambie el mes — `tocaReiniciar` ignora las pausadas,
   * así que tres meses de pausa no acumulan tres cupos.
   */
  async cambiarEstado(
    user: AuthUser,
    membresiaId: string,
    status: 'ACTIVA' | 'PAUSADA' | 'CANCELADA',
    override?: string,
  ) {
    const tenantId = this.tid(user, override);
    const m = await this.prisma.clubMembresia.findFirst({
      where: { id: membresiaId, plan: { tenantId } },
      select: { id: true, status: true },
    });
    if (!m) throw new NotFoundException('Membresía no encontrada.');
    if (m.status === 'CANCELADA') {
      throw new BadRequestException('Una membresía cancelada no se reactiva.');
    }
    const actualizada = await this.prisma.clubMembresia.update({
      where: { id: membresiaId },
      data: {
        status,
        pausedAt: status === 'PAUSADA' ? new Date() : null,
      },
    });

    // Sin este push el socio pausado sigue viendo su saldo intacto en el móvil
    // y llega al mostrador convencido de que puede consumir. La caja lo frena
    // bien, así que no se pierde dinero: se pierde la discusión en el
    // mostrador, que para el negocio es peor.
    if (actualizada.passId) this.empujarPase(actualizada.passId, 'club.estado');

    return actualizada;
  }

  /**
   * Los socios de un plan, para el panel del negocio.
   *
   * El saldo se lee del PASE, no de la membresía: es donde vive. Y se pagina
   * de verdad porque un plan de un gimnasio puede tener miles de socios y el
   * panel los pinta en una tabla.
   */
  async listarMiembros(
    user: AuthUser,
    planId: string,
    opciones: { q?: string; estado?: string; pagina?: number } = {},
    override?: string,
  ) {
    const tenantId = this.tid(user, override);
    await this.planDelNegocio(planId, tenantId);

    const porPagina = 50;
    const pagina = Math.max(1, opciones.pagina ?? 1);
    const q = opciones.q?.trim();

    const where: Prisma.ClubMembresiaWhereInput = {
      planId,
      // Lista blanca explícita: cualquier otro valor se ignora y devuelve
      // todas, en vez de dejar que Prisma lance por un enum inválido.
      ...(opciones.estado === 'ACTIVA' ||
      opciones.estado === 'PAUSADA' ||
      opciones.estado === 'CANCELADA'
        ? { status: opciones.estado as ClubMembresiaStatus }
        : {}),
      ...(q
        ? {
            customer: {
              // `tenantId` no es decorativo: sin él, Prisma compila el filtro a
              // un subselect sobre `Customer` sin acotar y Postgres recorre la
              // tabla de los 168 negocios con tres ILIKE por fila — dos veces
              // (el `count` y el `findMany` van en paralelo), en cada tecla que
              // el negocio pulsa en el buscador. Con esto entra por
              // `@@index([tenantId])`.
              tenantId,
              OR: [
                { fullName: { contains: q, mode: 'insensitive' as const } },
                { email: { contains: q, mode: 'insensitive' as const } },
                { phone: { contains: q } },
              ],
            },
          }
        : {}),
    };

    const [total, filas] = await Promise.all([
      this.prisma.clubMembresia.count({ where }),
      this.prisma.clubMembresia.findMany({
        where,
        include: {
          customer: {
            select: { id: true, fullName: true, email: true, phone: true },
          },
          pass: {
            select: {
              stampsCount: true,
              serialNumber: true,
              // El dato ya se guardaba en cada descarga del pase y no lo leía
              // nadie: el negocio veía a sus 40 socios idénticos sin saber
              // cuáles cobraron y nunca llegaron a instalar la tarjeta.
              walletInstalledAt: true,
              walletPlatform: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (pagina - 1) * porPagina,
        take: porPagina,
      }),
    ]);

    return {
      total,
      pagina,
      porPagina,
      miembros: filas.map((m) => ({
        id: m.id,
        status: m.status,
        periodo: m.periodo,
        cupoDelPeriodo: m.cupoDelPeriodo,
        saldo: m.pass?.stampsCount ?? 0,
        // El pase se emite en el alta; lo que falta es que el cliente lo
        // INSTALE. El panel necesita su id para poder darle el enlace: sin él,
        // el negocio daba de alta a alguien y no tenía cómo entregarle la
        // tarjeta.
        passId: m.passId,
        serial: m.pass?.serialNumber ?? null,
        instaladaEn: m.pass?.walletInstalledAt ?? null,
        plataforma: m.pass?.walletPlatform ?? null,
        altaEn: m.createdAt,
        cliente: {
          id: m.customer?.id ?? '',
          nombre: m.customer?.fullName ?? '—',
          email: m.customer?.email ?? null,
          telefono: m.customer?.phone ?? null,
        },
      })),
    };
  }

  /**
   * Da de alta con UN SOLO dato: el teléfono o el nombre.
   *
   * El alta anterior exigía buscar al socio entre los clientes que el negocio
   * ya tenía, y eso invertía el caso normal: alguien acaba de pagar en el
   * mostrador y **no existe todavía**. Obligaba a ir a Clientes, crearlo,
   * volver aquí y buscarlo por su nombre, con el cliente esperando delante.
   *
   * Aquí se escribe lo que se tenga y el resto se resuelve solo:
   *
   *  · Si lo que llega son dígitos, es un teléfono. Se busca por los últimos
   *    diez, que es como se compara en el resto del producto: da igual que se
   *    escriba con indicativo o sin él, con espacios o sin ellos. Lo que NO
   *    tolera —y le pasa igual al resto del producto— es que sea el GUARDADO el
   *    que lleve separadores: un teléfono tecleado a mano en Clientes como
   *    «300 111 2233» no encaja, y el alta acabaría creando un repetido.
   *  · Si lleva letras, es un nombre.
   *  · Si no hay nadie así, se crea. Si hay varios, se devuelven para que el
   *    negocio elija: dar de alta al que no era es peor que un clic más.
   *
   * `fullName` es obligatorio en la base, así que cuando solo hay teléfono se
   * usa el propio número como nombre. Se ve en el pase hasta que alguien lo
   * cambie, y es preferible a inventarse un «Cliente nuevo» que luego nadie
   * distingue de los otros veinte.
   */
  async altaRapida(
    user: AuthUser,
    planId: string,
    identificador: string,
    /**
     * `true` cuando el negocio ya vio la lista de parecidos y dijo que no es
     * ninguno. Sin esto la pantalla se quedaba sin salida: dos clientes que se
     * llaman Javier y un tercer Javier al que no se podía dar de alta.
     */
    forzarNuevo = false,
    override?: string,
  ) {
    const tenantId = this.tid(user, override);
    await this.assertHabilitado(tenantId);
    const texto = (identificador ?? '').trim();
    if (texto.length < 2) {
      throw new BadRequestException('Escribe el teléfono o el nombre del socio.');
    }

    const digitos = texto.replace(/\D/g, '');
    const esTelefono = !/\p{L}/u.test(texto) && digitos.length >= 7;

    const candidatos = forzarNuevo
      ? []
      : await this.prisma.customer.findMany({
          where: {
            tenantId,
            ...(esTelefono
              ? { phone: { contains: digitos.slice(-10) } }
              : { fullName: { contains: texto, mode: 'insensitive' as const } }),
          },
          select: { id: true, fullName: true, phone: true, email: true },
          take: 6,
        });

    if (candidatos.length > 1) {
      return { ambiguos: candidatos };
    }

    const cliente =
      candidatos[0] ??
      (await this.prisma.customer.create({
        data: {
          tenantId,
          fullName: texto,
          ...(esTelefono ? { phone: texto } : {}),
        },
        select: { id: true, fullName: true, phone: true, email: true },
      }));

    const membresia = await this.darDeAlta(user, planId, cliente.id, override);
    return { ...membresia, cliente };
  }

  /**
   * Da de baja a TODOS los socios de un plan. Es la salida para cerrar el club.
   *
   * Hacía falta porque apagar el plan no cierra nada: solo impide altas nuevas,
   * y a los que quedan dentro se les sigue repartiendo el cupo cada mes —lo que
   * es correcto mientras paguen, y un regalo perpetuo cuando el negocio ya
   * cerró—. Sin esto, la única salida era entrar socio por socio.
   *
   * No se borra nada: quedan en CANCELADA, con su historial, y se les puede
   * readmitir. Y se les repinta el pase para que no sigan viendo un saldo que
   * la caja ya no les va a aceptar.
   */
  async darDeBajaATodos(user: AuthUser, planId: string, override?: string) {
    const tenantId = this.tid(user, override);
    await this.planDelNegocio(planId, tenantId);

    const afectadas = await this.prisma.clubMembresia.findMany({
      where: { planId, status: { in: ['ACTIVA', 'PAUSADA'] } },
      select: { id: true, passId: true },
      take: 5000,
    });
    if (!afectadas.length) return { dadasDeBaja: 0 };

    await this.prisma.clubMembresia.updateMany({
      where: { id: { in: afectadas.map((m) => m.id) } },
      data: { status: 'CANCELADA', pausedAt: null },
    });

    for (const m of afectadas) {
      if (m.passId) this.empujarPase(m.passId, 'club.baja.masiva');
    }
    this.logger.log(
      `Club: ${afectadas.length} socios dados de baja en el plan ${planId}.`,
    );
    return { dadasDeBaja: afectadas.length };
  }

  // ── Historial ───────────────────────────────────────────────────────────

  /**
   * Los consumos de un plan, con el total del período.
   *
   * `ClubConsumo` se escribía desde el primer día y no lo leía nadie: el
   * negocio no podía ver qué se llevó cada socio, ni cruzar lo que cobra contra
   * lo que entrega —que es LA pregunta de este producto—, ni auditar a sus
   * cajeros pese a que `actorId` y `locationId` se guardan en cada línea.
   */
  async consumosDelPlan(
    user: AuthUser,
    planId: string,
    opciones: { periodo?: string; membresiaId?: string; pagina?: number } = {},
    override?: string,
  ) {
    const tenantId = this.tid(user, override);
    const plan = await this.planDelNegocio(planId, tenantId);

    const porPagina = 100;
    const pagina = Math.max(1, opciones.pagina ?? 1);
    // Por defecto el mes en curso: es lo que el negocio quiere saber al abrir.
    const periodo = opciones.periodo?.trim() || periodoDe(new Date());

    const where: Prisma.ClubConsumoWhereInput = {
      membresia: { planId },
      periodo,
      ...(opciones.membresiaId ? { membresiaId: opciones.membresiaId } : {}),
    };

    // Las unidades entregadas NO cuentan las líneas anuladas. Es LA pregunta
    // del producto —cuántos cafés entregué por los 60.000 que cobro— y sumarlo
    // todo inflaba el número dos veces por cada corrección del cajero: la línea
    // mala y la buena. Cuanto más cuidadoso era corrigiendo, peor le salía la
    // cuenta. Las líneas anuladas sí se siguen LISTANDO, marcadas: el histórico
    // no se esconde, solo deja de sumar.
    const whereEntregadas: Prisma.ClubConsumoWhereInput = {
      ...where,
      revertedAt: null,
    };

    const [total, unidades, filas] = await Promise.all([
      this.prisma.clubConsumo.count({ where }),
      // Las unidades, no las líneas: un consumo puede llevarse más de una.
      this.prisma.clubConsumo.aggregate({
        where: whereEntregadas,
        _sum: { cantidad: true },
      }),
      this.prisma.clubConsumo.findMany({
        where,
        include: {
          membresia: {
            select: {
              id: true,
              customer: { select: { id: true, fullName: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (pagina - 1) * porPagina,
        take: porPagina,
      }),
    ]);

    const entregadas = unidades._sum.cantidad ?? 0;
    return {
      periodo,
      total,
      pagina,
      porPagina,
      entregadas,
      unidad: plan.unidad,
      // Lo que el negocio le cobra a cada socio, para que pueda comparar. Va
      // con la periodicidad al lado porque el mismo número significa cosas
      // distintas: 60.000 al mes o 60.000 al año no se comparan igual contra
      // los cafés de UN mes. No se calcula aquí la rentabilidad: el coste de un
      // café lo sabe él, no nosotros, e inventarlo sería peor que callar.
      precioCents: plan.precioCents,
      currency: plan.currency,
      periodicidad: plan.periodicidad,
      consumos: filas.map((c) => ({
        id: c.id,
        cantidad: c.cantidad,
        saldoResultante: c.saldoResultante,
        cuando: c.createdAt,
        anuladoEn: c.revertedAt,
        membresiaId: c.membresiaId,
        cliente: {
          id: c.membresia?.customer?.id ?? '',
          nombre: c.membresia?.customer?.fullName ?? '\u2014',
        },
      })),
    };
  }

  // ── Caja ────────────────────────────────────────────────────────────────

  /** Lo que ve el cajero al escanear. El saldo sale del PASE. */
  async resolverParaCaja(user: AuthUser, passId: string) {
    const m = await this.prisma.clubMembresia.findFirst({
      where: { passId },
      include: {
        plan: {
          select: {
            tenantId: true,
            name: true,
            unidad: true,
            beneficiosPorMes: true,
          },
        },
        customer: { select: { fullName: true } },
        pass: { select: { stampsCount: true } },
      },
    });
    if (!m) {
      // Aquí solo se llega desviado por `card.clubPlanId`, así que la tarjeta
      // SÍ es de un club: lo que falta es la membresía. Decirle al cajero «esta
      // tarjeta no es de un club» le hace pensar que el escáner está roto, y en
      // realidad el socio perdió su vínculo —`ClubMembresia.pass` es
      // `onDelete: SetNull`, así que rehacerle el pase deja la membresía sin
      // `passId`. La salida es volver a darlo de alta, y eso es lo que se dice.
      throw new NotFoundException(
        'Esta tarjeta de club no tiene socio asignado. Vuelve a darlo de alta desde Tarjeta de Club.',
      );
    }
    if (user.role !== 'SUPER_ADMIN' && m.plan.tenantId !== user.tenantId) {
      throw new ForbiddenException();
    }
    // El mismo reinicio perezoso que hace `consumir`, pero SIN escribir: esto
    // es la pantalla de lectura del cajero. Sin él, el socio que terminó
    // septiembre en cero y llega el 1 de octubre antes de que pase el cron
    // —hasta una hora, más si el tope de 5000 muerde— veía «sin cupo» y el
    // botón de consumir NI SE PINTABA. `consumir` habría funcionado: el que
    // sabía reiniciar era el backend, y la pantalla que decidía no.
    //
    // El sesgo era feo además: al que le sobraba cupo del mes viejo sí le
    // dejaba pasar, y al que había llegado a cero no. El caso que favorece al
    // negocio funcionaba y el que favorece al cliente, no.
    const periodoActual = periodoDe(new Date());
    // Solo se anticipa el reinicio a quien lo va a recibir. Una membresía
    // PAUSADA no se reinicia —`tocaReiniciar` las ignora—, así que pintarle el
    // cupo entero le enseñaba al cajero «10 / 10» de un socio que no tiene
    // nada: el número decía una cosa y el botón, que no aparece, otra.
    const tocaReinicio = m.periodo < periodoActual && m.status === 'ACTIVA';
    const saldo = tocaReinicio
      ? m.plan.beneficiosPorMes
      : (m.pass?.stampsCount ?? 0);
    const cupo = tocaReinicio ? m.plan.beneficiosPorMes : m.cupoDelPeriodo;

    return {
      membresiaId: m.id,
      titular: m.customer?.fullName ?? '—',
      plan: m.plan.name,
      unidad: m.plan.unidad,
      status: m.status,
      saldo,
      cupoDelPeriodo: cupo,
      periodo: periodoActual,
      puedeConsumir: m.status === 'ACTIVA' && saldo > 0,
    };
  }

  /**
   * Descuenta del cupo, que vive en `Pass.stampsCount` — el mismo contador que
   * usan todas las tarjetas.
   *
   * Vive ahí y no en una tabla aparte porque así el pase se pinta, se empuja y
   * recibe la geolocalización sin código nuevo: toda esa maquinaria opera
   * sobre `Pass` y no mira de qué tipo es la tarjeta.
   *
   * El descuento es un UPDATE CONDICIONAL: solo toca la fila si el saldo
   * alcanza, y se mira cuántas cambió. Sin eso, dos cajeros escaneando a la
   * vez leerían saldo 1 los dos, pasarían los dos el `if`, y el cliente se
   * llevaría dos cafés con uno de cupo.
   */
  async consumir(
    user: AuthUser,
    membresiaId: string,
    cantidad = 1,
    locationId?: string | null,
  ) {
    if (!Number.isInteger(cantidad) || cantidad < 1) {
      throw new BadRequestException('La cantidad debe ser 1 o más.');
    }
    const m = await this.prisma.clubMembresia.findUnique({
      where: { id: membresiaId },
      include: {
        plan: {
          select: { tenantId: true, unidad: true, beneficiosPorMes: true },
        },
      },
    });
    if (!m) throw new NotFoundException('Membresía no encontrada.');
    if (user.role !== 'SUPER_ADMIN' && m.plan.tenantId !== user.tenantId) {
      throw new ForbiddenException();
    }
    if (m.status !== 'ACTIVA') {
      throw new BadRequestException(
        m.status === 'PAUSADA'
          ? 'Esta membresía está pausada.'
          : 'Esta membresía está cancelada.',
      );
    }
    if (!m.passId) {
      throw new BadRequestException('Esta membresía todavía no tiene tarjeta.');
    }

    const passId = m.passId;
    const periodoActual = periodoDe(new Date());

    // NO hay ventana de idempotencia por tiempo, y se probó: descartar un
    // consumo «igual al anterior» dentro de unos segundos se traga el caso
    // normal del mostrador —dos cafés pedidos seguidos, escaneados uno detrás
    // de otro— que es indistinguible del doble toque salvo por la intención.
    //
    // El doble toque se ataja donde no hay ambigüedad: el botón de la caja se
    // desactiva mientras la petición está en vuelo, y si aun así se cuela,
    // «Deshacer el último» está ahí mismo.

    // El cron de reinicio es HORARIO, así que entre las 00:00 del día 1 y su
    // primera pasada hay hasta una hora en la que la membresía sigue marcada
    // en el mes viejo. Sin esto, un cliente con 7 sobrantes de septiembre se
    // los gastaba el 1 de octubre y ese mes se llevaba 17 con un plan de 10.
    // Se reinicia AQUÍ mismo; el cron queda como red de seguridad.
    // `<` y no `!==`, el mismo criterio que el cron. Con `!==`, un período
        // FUTURO —el reloj del servidor adelantado, y luego corregido— contaba
        // como «atrasado» y disparaba un reinicio hacia atrás: el socio recibía
        // el cupo de noviembre y otra vez el de septiembre.
    const tocaReinicio = m.periodo < periodoActual;
    const cupoVigente = tocaReinicio
      ? m.plan.beneficiosPorMes
      : m.cupoDelPeriodo;

    const resultado = await this.prisma.$transaction(async (tx) => {
      // Reclamo CONDICIONAL de la membresía: si alguien la pausó entre la
      // lectura de arriba y esto, `count` es 0 y no se descuenta nada. Sin
      // este candado el `if` de arriba decidía con una foto vieja y una
      // membresía pausada a medio escaneo se llevaba igual el beneficio.
      const reclamo = await tx.clubMembresia.updateMany({
        where: {
          id: membresiaId,
          status: 'ACTIVA',
          ...(tocaReinicio ? { periodo: m.periodo } : {}),
        },
        data: tocaReinicio
          ? { periodo: periodoActual, cupoDelPeriodo: cupoVigente }
          : { updatedAt: new Date() },
      });
      if (reclamo.count === 0) {
        throw new ConflictException(
          'La membresía cambió de estado mientras se cobraba. Volvé a escanear.',
        );
      }

      // Con reinicio, el pase vuelve al cupo del mes ANTES de descontar.
      if (tocaReinicio) {
        await tx.pass.update({
          where: { id: passId },
          data: { stampsCount: cupoVigente, lastActivityAt: new Date() },
        });
      }

      // `lastActivityAt` en el mismo UPDATE: sin bumpearlo, el webservice de
      // Apple compara `If-Modified-Since` y responde 304, así que el push
      // llegaría pero el pase no se refrescaría.
      const bajada = await tx.pass.updateMany({
        where: { id: passId, stampsCount: { gte: cantidad } },
        data: {
          stampsCount: { decrement: cantidad },
          lastActivityAt: new Date(),
        },
      });
      if (bajada.count === 0) {
        const ahora = await tx.pass.findUnique({
          where: { id: passId },
          select: { stampsCount: true },
        });
        const q = ahora?.stampsCount ?? 0;
        throw new ConflictException(
          `Sin cupo: le ${q === 1 ? 'queda 1' : `quedan ${q}`} de ${cupoVigente}.`,
        );
      }

      // Segunda comprobación del estado, ya con el cupo descontado y dentro de
      // la transacción: si la membresía se pausó entre el reclamo de arriba y
      // esto, lanzar aquí deshace el descuento entero. Barato, y cierra la
      // única rendija que quedaba.
      const sigueViva = await tx.clubMembresia.findUnique({
        where: { id: membresiaId },
        select: { status: true },
      });
      if (sigueViva?.status !== 'ACTIVA') {
        throw new ConflictException(
          'La membresía dejó de estar activa mientras se cobraba.',
        );
      }

      const tras = await tx.pass.findUniqueOrThrow({
        where: { id: passId },
        select: { stampsCount: true },
      });

      const consumo = await tx.clubConsumo.create({
        data: {
          membresiaId,
          cantidad,
          saldoResultante: tras.stampsCount,
          // El período del consumo sale de la FECHA REAL, no de la membresía:
          // con la membresía sin reiniciar, un café del 1 de octubre quedaba
          // contado en septiembre y los informes por mes salían mal.
          periodo: periodoActual,
          actorId: user.id ?? null,
          locationId: locationId ?? null,
        },
      });

      return { consumoId: consumo.id, saldo: tras.stampsCount };
    });

    this.empujarPase(passId, 'club.consumo');

    // Venir a por su café ES una visita. `lastVisitDay` solo lo escribía el
    // escaneo de sellos, así que un socio del club quedaba en dos estados, los
    // dos malos: si nunca tuvo tarjeta de sellos, la automatización de
    // inactividad no le llegaba JAMÁS; y si la tuvo una vez, le llegaba «te
    // extrañamos, hace tiempo no te vemos» estando yendo a diario.
    //
    // Fuera de la transacción y sin esperar: que falle esto no puede tumbar un
    // consumo que ya está cobrado.
    this.prisma.customer
      .update({
        where: { id: m.customerId },
        // Es TEXTO «YYYY-MM-DD», no una fecha, y así lo escribe el escaneo de
        // sellos en `gamification.service`. La automatización compara ese día
        // con igualdad exacta, así que el formato tiene que ser el mismo.
        data: { lastVisitDay: new Date().toISOString().slice(0, 10) },
      })
      .catch(() => null);

    return {
      ok: true,
      ...resultado,
      cupoDelPeriodo: cupoVigente,
      unidad: m.plan.unidad,
    };
  }

  /**
   * Deshace un consumo mal registrado.
   *
   * Se marca, no se borra: el histórico no se reescribe. Y la marca va con un
   * UPDATE condicional sobre `revertedAt: null`, así el doble clic del cajero
   * no devuelve el cupo dos veces.
   */
  async anularConsumo(user: AuthUser, consumoId: string) {
    const c = await this.prisma.clubConsumo.findUnique({
      where: { id: consumoId },
      include: {
        membresia: {
          include: { plan: { select: { tenantId: true } } },
        },
      },
    });
    if (!c) throw new NotFoundException('Consumo no encontrado.');
    if (
      user.role !== 'SUPER_ADMIN' &&
      c.membresia.plan.tenantId !== user.tenantId
    ) {
      throw new ForbiddenException();
    }

    const r = await this.prisma.$transaction(async (tx) => {
      // El período se comprueba ANTES de marcar. Al revés, un consumo de un
      // mes anterior quedaba marcado como anulado sin haberle devuelto nada al
      // cliente: contaba como anulado en cualquier informe, no se podía
      // reintentar nunca —«ya estaba anulado»— y al cajero se le decía después
      // que no se podía deshacer.
      const viva = await tx.clubMembresia.findUnique({
        where: { id: c.membresiaId },
        select: { periodo: true, passId: true },
      });
      if (!viva?.passId || viva.periodo !== c.periodo) {
        return { devuelto: 0, motivo: 'consumo de un período anterior' as const };
      }

      const marcado = await tx.clubConsumo.updateMany({
        where: { id: consumoId, revertedAt: null },
        data: { revertedAt: new Date(), revertedBy: user.id ?? null },
      });
      if (marcado.count === 0) {
        throw new ConflictException('Este consumo ya estaba anulado.');
      }
      const tras = await tx.pass.update({
        where: { id: viva.passId },
        data: {
          stampsCount: { increment: c.cantidad },
          lastActivityAt: new Date(),
        },
        select: { stampsCount: true },
      });

      // Y se vuelve a mirar el período DESPUÉS de tomar el candado del pase.
      // La lectura de arriba no bloquea nada: el reinicio del mes podía estar a
      // medias, sin haber comiteado, y entonces se devolvía un beneficio del
      // mes viejo encima del cupo recién repuesto. Al llegar aquí ese reinicio
      // ya terminó —el `update` esperó a su candado—, así que si el período
      // cambió, lanzar deshace la transacción entera.
      const despues = await tx.clubMembresia.findUnique({
        where: { id: c.membresiaId },
        select: { periodo: true },
      });
      if (despues?.periodo !== c.periodo) {
        throw new ConflictException(
          'Empezó un mes nuevo mientras se deshacía. Vuelve a intentarlo.',
        );
      }

      return { devuelto: c.cantidad, saldo: tras.stampsCount };
    });

    if (r.devuelto > 0 && c.membresia.passId) {
      this.empujarPase(c.membresia.passId, 'club.anulacion');
    }
    return { ok: true, ...r };
  }

  // ── Reinicio mensual ────────────────────────────────────────────────────

  /**
   * Devuelve el cupo del mes a todas las membresías activas.
   *
   * ASIGNA, no suma: quien consumió 3 de 10 empieza con 10, no con 17. Y solo
   * actúa si el período guardado difiere del actual, así que correrlo cien
   * veces el mismo mes no regala nada.
   *
   * Cada hora y no una vez al día: si el proceso se cae a medianoche, a la
   * siguiente hora se recupera solo y nadie se queda sin su cupo.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async reiniciarCupos() {
    const periodo = periodoDe(new Date());
    const pendientes = await this.prisma.clubMembresia.findMany({
      where: {
        status: 'ACTIVA',
        // `lt` y no `not`: los períodos son «YYYY-MM» y ordenan como texto, así
        // que «atrasado» es literalmente «menor». Con `not` no hay rango que
        // recorrer y el índice no sirve: 23 de las 24 pasadas diarias leían
        // todas las membresías activas del sistema para devolver cero filas.
        // Y de paso es más seguro: una fila con un período FUTURO —reloj
        // desajustado— ya no se «reinicia» hacia atrás.
        periodo: { lt: periodo },
        passId: { not: null },
        // NO se filtra por `plan.isActive` a propósito, y cuesta creerlo:
        // apagar el plan solo cierra las altas nuevas, así que a los socios que
        // siguen pagando se les sigue repartiendo. Cortarles el cupo aquí les
        // quitaría en silencio lo que compraron, y el negocio no se enteraría
        // hasta que se quejaran.
        //
        // Para cerrar un club de verdad está «Dar de baja a todos los socios»,
        // que es explícito y avisa de a cuántos afecta.
      },
      select: {
        id: true,
        status: true,
        periodo: true,
        passId: true,
        plan: { select: { beneficiosPorMes: true } },
      },
      take: 5000,
    });
    // Los que se quedan fuera del reinicio por no tener pase. La consulta de
        // arriba los excluye —no hay nada que reponer— pero eso los deja SIN
        // CUPO para siempre y sin que nadie se entere: siguen ACTIVA, el
        // negocio los ve normales en su lista y el socio no recibe nada mes
        // tras mes. Se avisa para que se les pueda reemitir la tarjeta.
    const sinPase = await this.prisma.clubMembresia.count({
      where: { status: 'ACTIVA', periodo: { lt: periodo }, passId: null },
    });
    if (sinPase > 0) {
      this.logger.warn(
        `Club: ${sinPase} socios ACTIVOS sin tarjeta se quedan sin el cupo de ${periodo} — hay que volver a darlos de alta.`,
      );
    }

    if (!pendientes.length) return { periodo, reiniciadas: 0 };
    // El cron es horario, así que un tope alcanzado se recupera en las horas
    // siguientes. Pero si nadie lo dice, un negocio grande empieza el mes a
    // medias y nos enteramos por el cliente.
    if (pendientes.length === 5000) {
      this.logger.warn(
        `Club: el reinicio de ${periodo} tocó el tope de 5000 — quedan membresías para la próxima pasada.`,
      );
    }

    let reiniciadas = 0;
    for (const m of pendientes) {
      if (!tocaReiniciar(m, periodo)) continue;
      // Condicionado al período viejo: si otra pasada del cron ya la reinició,
      // esta no cuenta y no vuelve a asignar.
      // Las dos escrituras van en UNA transacción: sueltas, entre marcar el
      // período nuevo y reponer el pase cabe un consumo del cliente, y el
      // reinicio se lo comería. Y `updateMany` en vez de `update` porque si la
      // membresía apunta a un pase que ya no existe, `update` lanza y se lleva
      // por delante el reinicio del MES ENTERO para todos los demás.
      // Envuelto: sin esto, un solo fallo —un timeout del pool a las 00:00, un
      // interbloqueo contra un consumo simultáneo— salía del bucle y dejaba
      // SIN REINICIAR a todos los que faltaban. Con 5000 intentos, que uno
      // falle no es una rareza. El que falla se recupera a la hora siguiente.
      let hecho = false;
      try {
        hecho = await this.prisma.$transaction(async (tx) => {
        const r = await tx.clubMembresia.updateMany({
          where: { id: m.id, periodo: m.periodo },
          data: { cupoDelPeriodo: m.plan.beneficiosPorMes, periodo },
        });
        if (r.count === 0) return false;

        const puesto = await tx.pass.updateMany({
          where: { id: m.passId! },
          data: {
            stampsCount: m.plan.beneficiosPorMes,
            lastActivityAt: new Date(),
          },
        });
        if (puesto.count === 0) {
          // `throw` y no `return false`: al retornar, Prisma COMITEA. El
          // `updateMany` de arriba ya había avanzado el período y el cupo, así
          // que la membresía quedaba marcada como reiniciada con el pase sin
          // tocar — y ni el cron ni el reinicio perezoso volvían a mirarla
          // jamás, porque los dos comparan el período. Lanzar la deshace
          // entera y el `catch` de fuera la salta de verdad.
          throw new Error(
            `membresía ${m.id} apunta a un pase inexistente (${m.passId})`,
          );
        }
          return true;
        });
      } catch (e) {
        this.logger.error(
          `Club: falló el reinicio de la membresía ${m.id}, sigue el resto: ${e}`,
        );
        continue;
      }
      if (!hecho) continue;

      this.empujarPase(m.passId!, 'club.reinicio');
      reiniciadas += 1;
    }
    if (reiniciadas > 0) {
      this.logger.log(`Club: ${reiniciadas} membresías reiniciadas para ${periodo}.`);
    }
    return { periodo, reiniciadas };
  }
}
