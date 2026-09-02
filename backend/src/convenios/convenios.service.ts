import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { customAlphabet, nanoid } from 'nanoid';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { QueueService } from '../jobs/queue.service';
import {
  BRAND_DOMAIN_SELECT,
  brandBaseUrl,
} from '../email/brand-email-creds.util';
import {
  inicioDelPeriodo,
  describirTope,

  ZONA_POR_DEFECTO,
  type ConvenioPeriodo,
} from './periodos';
import { cambiaLoQueSeVe, estaAgotado, quienApago } from './alianzas-estado';
import { avisarPasesDeAlianza, avisarUnPase } from './alianzas-pase.util';

/** Sin vocales ni caracteres que se confunden al dictarlo por teléfono. */
const generarCodigo = customAlphabet('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 8);


export type ConvenioDto = {
  name: string;
  logoUrl?: string | null;
  description?: string;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  verificacion?: 'ABIERTO' | 'CODIGO' | 'LISTA';
  codigo?: string | null;
  status?: 'ACTIVE' | 'PAUSED' | 'FINISHED';
  /**
   * Hasta cuándo dura. `null` = ILIMITADA, que es una opción de primera y no
   * un descuido: hay convenios marco que no se renuevan cada año.
   *
   * No hace falta columna nueva —`null` ya significaba eso— pero sí que el
   * panel lo diga: hasta ahora la opción existía y nadie sabía que estaba ahí,
   * así que el dueño se inventaba una fecha lejana.
   */
  endsAt?: string | null;
  sedeIds?: string[] | null;
  /**
   * Primer beneficio, opcional, para crear la alianza de una sola vez.
   *
   * Existe porque una alianza sin ningún beneficio NO deja activar a nadie: su
   * enlace responde «este convenio aún no está disponible». Crear las dos cosas
   * en dos llamadas deja esa ventana abierta si la segunda falla o si el dueño
   * cierra el navegador entre medias.
   */
  beneficio?: CuponDto | null;
};

export type CuponDto = {
  name: string;
  tipo?: 'PERCENT_OFF' | 'AMOUNT_OFF' | 'FREEBIE' | 'TWO_FOR_ONE' | 'OTHER';
  valor?: number;
  description?: string;
  terms?: string;
  isActive?: boolean;
  maxPorPersona?: number | null;
  periodo?: ConvenioPeriodo;
  maxTotal?: number | null;
  compraMinima?: number | null;
  topeDescuento?: number | null;
  endsAt?: string | null;
};

/**
 * Convenios: beneficios para los empleados de una empresa aliada.
 *
 * El negocio (Nudo Cowork) monta un convenio con una empresa (Confenalco) y
 * su gente recibe un descuento permanente. No hay venta, no hay saldo, no hay
 * sellos — un canje de convenio NO suma sellos ni convierte la tarjeta.
 *
 * Se le copiaron las formas a la cuponera (`cuponera.service`), que resuelve
 * un problema parecido del revés y ya sobrevivió producción: los tipos de
 * beneficio, los topes, el candado del canje y el contador denormalizado. Lo
 * que NO se comparte son las tablas — ver el comentario del esquema.
 */
@Injectable()
export class ConveniosService {
  private logger = new Logger(ConveniosService.name);

  constructor(
    private prisma: PrismaService,
    private queue: QueueService,
  ) {}

  private tid(user: AuthUser, override?: string) {
    if (user.role === 'SUPER_ADMIN') {
      if (!override) throw new ForbiddenException('tenantId required');
      return override;
    }
    if (!user.tenantId) throw new ForbiddenException();
    return user.tenantId;
  }

  /**
   * El negocio tiene la función habilitada y le queda cupo.
   *
   * Mismo patrón que las cartas por sede: se enciende negocio por negocio
   * desde el panel de admin. La mayoría no monta convenios y no tiene por qué
   * ver la complejidad.
   */
  private async assertHabilitado(tenantId: string, contarCupo = false) {
    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { conveniosEnabled: true, maxConvenios: true },
    });
    if (!t?.conveniosEnabled) {
      throw new ForbiddenException(
        'Este negocio no tiene convenios habilitados.',
      );
    }
    if (!contarCupo) return;
    const tope = t.maxConvenios ?? 3;
    const usados = await this.prisma.convenio.count({
      where: { tenantId, status: { not: 'FINISHED' } },
    });
    if (usados >= tope) {
      throw new ForbiddenException(
        `Este negocio tiene permitidos ${tope} convenios a la vez, y ya los tiene. ` +
          `Cierra uno o pídenos ampliar el límite.`,
      );
    }
  }

  /**
   * Interpreta «hasta cuándo dura».
   *
   *   null / '' / undefined → ILIMITADA. Es una opción de primera, no un
   *   descuido: hay convenios marco que no se renuevan cada año, y hasta ahora
   *   el panel no ofrecía la opción, así que el dueño se inventaba una fecha
   *   lejana —2099— que luego nadie entendía.
   *
   * La fecha se toma al FINAL del día elegido. Si el dueño escribe «31 de
   * diciembre» espera que ese día todavía valga; guardarla a las 00:00 apagaría
   * el convenio un día antes de lo que él cree, y eso se descubre con un
   * cliente delante.
   */
  private parsearVigencia(valor?: string | null): Date | null {
    if (!valor) return null;
    const d = new Date(valor);
    if (Number.isNaN(d.getTime())) {
      throw new BadRequestException('La fecha de fin no es válida.');
    }
    // Solo se estira al final del día cuando viene en formato de fecha suelta
    // (YYYY-MM-DD), que es lo que manda un <input type="date">. Si llega un
    // instante completo, se respeta tal cual.
    if (/^\d{4}-\d{2}-\d{2}$/.test(valor.trim())) {
      d.setHours(23, 59, 59, 999);
    }
    return d;
  }

  private slugify(s: string) {
    return (
      s
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')
        .slice(0, 50) || `convenio-${nanoid(6).toLowerCase()}`
    );
  }

  // ───────────────────────────── Convenios ─────────────────────────────

  async list(user: AuthUser, override?: string) {
    const tenantId = this.tid(user, override);
    const [tenant, convenios] = await Promise.all([
      this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { conveniosEnabled: true, maxConvenios: true },
      }),
      this.prisma.convenio.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        include: {
          _count: { select: { tarjetas: true, cupones: true } },
          cupones: { select: { id: true, name: true, isActive: true } },
        },
      }),
    ]);

    // Canjes del mes en curso, de todos los convenios de una sola consulta.
    const desde = inicioDelPeriodo('MES', new Date(), await this.zona(tenantId));
    const canjesMes = await this.prisma.convenioCanje.groupBy({
      by: ['convenioId'],
      where: {
        convenio: { tenantId },
        revertedAt: null,
        ...(desde ? { createdAt: { gte: desde } } : {}),
      },
      _count: true,
    });
    const porConvenio = new Map(canjesMes.map((c) => [c.convenioId, c._count]));

    const activos = convenios.filter((c) => c.status !== 'FINISHED').length;
    return {
      habilitado: !!tenant?.conveniosEnabled,
      tope: tenant?.maxConvenios ?? 3,
      cupoLibre: Math.max(0, (tenant?.maxConvenios ?? 3) - activos),
      convenios: convenios.map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        logoUrl: c.logoUrl,
        status: c.status,
        verificacion: c.verificacion,
        codigo: c.codigo,
        endsAt: c.endsAt,
        tarjetas: c._count.tarjetas,
        cupones: c._count.cupones,
        cuponesEncendidos: c.cupones.filter((x) => x.isActive).length,
        canjesDelMes: porConvenio.get(c.id) ?? 0,
      })),
    };
  }

  /** Zona horaria del negocio. Los períodos de los topes se cortan ahí. */
  private async zona(tenantId: string): Promise<string> {
    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { timezone: true },
    });
    return t?.timezone || ZONA_POR_DEFECTO;
  }

  async get(user: AuthUser, id: string, override?: string) {
    const tenantId = this.tid(user, override);
    const c = await this.prisma.convenio.findFirst({
      where: { id, tenantId },
      include: {
        cupones: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] },
        sedes: { include: { location: { select: { id: true, name: true } } } },
        _count: { select: { tarjetas: true, lista: true } },
      },
    });
    if (!c) throw new NotFoundException('Convenio no encontrado');
    return {
      ...c,
      cupones: c.cupones.map((x) => ({
        ...x,
        topeTexto: describirTope(x.maxPorPersona, x.periodo as ConvenioPeriodo),
        // «Agotado» se CALCULA, no se guarda: antes se escribía isActive=false
        // al llegar al tope y el panel decía «apagado por el negocio», que era
        // mentira, y subir el tope no lo reabría.
        agotado: estaAgotado(x),
        // Quién lo tiene apagado, para que el panel no diga «apagado» a secas
        // cuando fue la empresa aliada y el dueño no puede hacer nada.
        apagadoPor: quienApago(x),
      })),
    };
  }

  async create(user: AuthUser, dto: ConvenioDto, override?: string) {
    const tenantId = this.tid(user, override);
    await this.assertHabilitado(tenantId, true);

    const name = (dto.name ?? '').trim();
    if (name.length < 2) {
      throw new BadRequestException('Ponle el nombre de la empresa aliada.');
    }

    // Slug único dentro del negocio: es parte del enlace que se reparte.
    let slug = this.slugify(name);
    let n = 0;
    while (
      await this.prisma.convenio.findFirst({
        where: { tenantId, slug: n === 0 ? slug : `${slug}-${n}` },
        select: { id: true },
      })
    ) {
      n++;
    }
    if (n > 0) slug = `${slug}-${n}`;

    const verificacion = dto.verificacion ?? 'CODIGO';
    // Se valida ANTES de abrir la transacción: si el beneficio viene mal, que
    // no llegue a crearse ni el convenio. Da igual el orden de las escrituras
    // si el dueño acaba con una alianza a medias que no sabe que tiene.
    if (dto.beneficio) this.validarCupon(dto.beneficio);
    const finVigencia = this.parsearVigencia(dto.endsAt);

    return this.prisma.$transaction(async (tx) => {
      const convenio = await tx.convenio.create({
        data: {
          tenantId,
          name,
          slug,
          logoUrl: dto.logoUrl ?? null,
          description: dto.description ?? '',
          contactName: dto.contactName ?? null,
          contactEmail: dto.contactEmail ?? null,
          contactPhone: dto.contactPhone ?? null,
          verificacion,
          // Con verificación por código hace falta uno desde el minuto cero: si
          // se creara vacío, el enlace quedaría abierto de par en par sin que
          // nadie se diera cuenta.
          codigo:
            verificacion === 'CODIGO'
              ? (dto.codigo?.trim().toUpperCase() || generarCodigo())
              : null,
          endsAt: finVigencia,
          reportToken: nanoid(24),
          // El token del portal del aliado se genera aquí y no perezosamente:
          // una alianza creada desde el asistente enseña sus dos enlaces en la
          // pantalla siguiente, y pedirlos por separado era una llamada más
          // que podía fallar justo cuando el dueño va a copiar el enlace.
          aliadoToken: nanoid(24),
          ...(dto.sedeIds?.length
            ? { sedes: { create: dto.sedeIds.map((locationId) => ({ locationId })) } }
            : {}),
        },
      });

      if (dto.beneficio) {
        await tx.convenioCupon.create({
          data: {
            convenioId: convenio.id,
            name: (dto.beneficio.name ?? '').trim() || name,
            tipo: dto.beneficio.tipo ?? 'PERCENT_OFF',
            valor: dto.beneficio.valor ?? 0,
            description: dto.beneficio.description ?? '',
            terms: dto.beneficio.terms ?? '',
            isActive: dto.beneficio.isActive ?? true,
            maxPorPersona: dto.beneficio.maxPorPersona ?? null,
            periodo: dto.beneficio.periodo ?? 'SIEMPRE',
            maxTotal: dto.beneficio.maxTotal ?? null,
            compraMinima: dto.beneficio.compraMinima ?? null,
            topeDescuento: dto.beneficio.topeDescuento ?? null,
            endsAt: this.parsearVigencia(dto.beneficio.endsAt),
            position: 1,
          },
        });
      }
      return convenio;
    });
  }

  async update(user: AuthUser, id: string, dto: ConvenioDto, override?: string) {
    const tenantId = this.tid(user, override);
    // Antes esto solo se comprobaba al CREAR: con el módulo apagado desde el
    // panel de admin se podía seguir editando y canjeando. Apagar algo tiene
    // que apagarlo.
    await this.assertHabilitado(tenantId);
    const actual = await this.prisma.convenio.findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        verificacion: true,
        codigo: true,
        status: true,
        endsAt: true,
      },
    });
    if (!actual) throw new NotFoundException('Convenio no encontrado');

    // FINISHED es terminal. Un convenio no «revive»: renace con términos
    // renegociados, y mezclar las dos épocas en el mismo historial rompe el
    // informe que el negocio le entrega al aliado. Para el cierre reversible
    // están la pausa y `endsAt`.
    if (actual.status === 'FINISHED' && dto.status && dto.status !== 'FINISHED') {
      throw new BadRequestException(
        'Este convenio está finalizado y no se puede reabrir. Crea uno nuevo con las condiciones que acordaron.',
      );
    }

    const verificacion = dto.verificacion ?? actual.verificacion;
    const data: any = {
      ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
      ...(dto.logoUrl !== undefined ? { logoUrl: dto.logoUrl } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.contactName !== undefined ? { contactName: dto.contactName } : {}),
      ...(dto.contactEmail !== undefined ? { contactEmail: dto.contactEmail } : {}),
      ...(dto.contactPhone !== undefined ? { contactPhone: dto.contactPhone } : {}),
      ...(dto.status !== undefined ? { status: dto.status } : {}),
      // `endsAt: null` es ILIMITADA, no «sin tocar»: por eso se mira
      // `!== undefined`. Pasar de una fecha vencida a ilimitada revive el
      // convenio, que es justo la diferencia con FINISHED.
      ...(dto.endsAt !== undefined
        ? { endsAt: this.parsearVigencia(dto.endsAt) }
        : {}),
    };
    if (dto.verificacion !== undefined) {
      data.verificacion = verificacion;
      // Al pasar a CODIGO sin código, se genera. Al salir de CODIGO se
      // conserva: si el negocio vuelve, el que ya repartió sigue sirviendo.
      if (verificacion === 'CODIGO' && !actual.codigo && !dto.codigo) {
        data.codigo = generarCodigo();
      }
    }
    if (dto.codigo !== undefined && dto.codigo !== null) {
      const limpio = dto.codigo.trim().toUpperCase();
      // Guardar vacío dejaba un convenio en modo CODIGO SIN código: la puerta
      // abierta de par en par sin que nadie se diera cuenta, porque el modo
      // seguía diciendo «por código». Si quiere quitarlo, que cambie el modo.
      if (!limpio && verificacion === 'CODIGO') {
        throw new BadRequestException(
          'Un convenio que se activa por código no puede quedarse sin código. Escribe uno o cambia la forma de verificación.',
        );
      }
      data.codigo = limpio || null;
    }

    if (dto.sedeIds !== undefined) {
      await this.prisma.convenioSede.deleteMany({ where: { convenioId: id } });
      if (dto.sedeIds?.length) {
        await this.prisma.convenioSede.createMany({
          data: dto.sedeIds.map((locationId) => ({ convenioId: id, locationId })),
          skipDuplicates: true,
        });
      }
    }

    const actualizado = await this.prisma.convenio.update({
      where: { id },
      data,
    });

    // Apagar o cerrar el convenio apaga TODOS sus cupones. Si no, quedarían
    // encendidos por dentro y al reactivar el convenio volverían solos.
    if (dto.status === 'PAUSED' || dto.status === 'FINISHED') {
      await this.prisma.convenioCupon.updateMany({
        where: { convenioId: id },
        data: { isActive: false },
      });
      await this.avisarPases(id);
    } else if (dto.endsAt !== undefined) {
      // Cambiar la vigencia también cambia lo que ve el empleado, y hay que
      // empujarlo: `endsAt` se evalúa perezosamente en el servidor, pero el
      // pase instalado no evalúa nada — si no se le avisa, seguiría prometiendo
      // el descuento el día después del fin, o seguiría diciendo «finalizado»
      // después de que el negocio renovara. Solo cuando el estado cambia de
      // verdad; cambiar una fecha futura por otra futura no mueve nada.
      const ahora = new Date();
      const vivoAntes = !actual.endsAt || actual.endsAt > ahora;
      const vivoAhora = !actualizado.endsAt || actualizado.endsAt > ahora;
      if (vivoAntes !== vivoAhora) await this.avisarPases(id);
    }
    return actualizado;
  }

  private avisarPases(convenioId: string) {
    return avisarPasesDeAlianza(
      this.prisma,
      this.queue,
      convenioId,
      'convenio_estado',
    );
  }

  // ─────────────────────────────── Cupones ───────────────────────────────

  async crearCupon(user: AuthUser, convenioId: string, dto: CuponDto, override?: string) {
    const tenantId = this.tid(user, override);
    await this.assertHabilitado(tenantId);
    const convenio = await this.prisma.convenio.findFirst({
      where: { id: convenioId, tenantId },
      select: { id: true, status: true },
    });
    if (!convenio) throw new NotFoundException('Convenio no encontrado');
    if (convenio.status === 'FINISHED') {
      throw new BadRequestException(
        'Este convenio está finalizado. No se le pueden añadir beneficios.',
      );
    }
    if (!(dto.name ?? '').trim()) {
      throw new BadRequestException('Ponle un nombre al cupón.');
    }
    this.validarCupon(dto);

    const ultimo = await this.prisma.convenioCupon.findFirst({
      where: { convenioId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });

    return this.prisma.convenioCupon.create({
      data: {
        convenioId,
        name: dto.name.trim(),
        tipo: dto.tipo ?? 'PERCENT_OFF',
        valor: dto.valor ?? 0,
        description: dto.description ?? '',
        terms: dto.terms ?? '',
        isActive: dto.isActive ?? true,
        maxPorPersona: dto.maxPorPersona ?? null,
        periodo: dto.periodo ?? 'SIEMPRE',
        maxTotal: dto.maxTotal ?? null,
        compraMinima: dto.compraMinima ?? null,
        topeDescuento: dto.topeDescuento ?? null,
        endsAt: this.parsearVigencia(dto.endsAt),
        position: (ultimo?.position ?? 0) + 1,
      },
    });
  }

  private validarCupon(dto: CuponDto) {
    if (dto.tipo === 'PERCENT_OFF' && dto.valor != null) {
      if (dto.valor <= 0 || dto.valor > 100) {
        throw new BadRequestException('El porcentaje va de 1 a 100.');
      }
    }
    if (dto.maxPorPersona != null && dto.maxPorPersona < 1) {
      throw new BadRequestException('El tope por persona es 1 o más.');
    }
    if (dto.maxTotal != null && dto.maxTotal < 1) {
      throw new BadRequestException('El tope total es 1 o más.');
    }
    // Un tope de "2 en total" sin período es distinto de "2 al mes": si el
    // negocio pone período pero no tope, el período no hace nada y es una
    // trampa silenciosa.
    if (dto.periodo && dto.periodo !== 'SIEMPRE' && dto.maxPorPersona == null) {
      throw new BadRequestException(
        'Si eliges un período (por día, por mes…), pon también cuántas veces puede usarlo cada persona.',
      );
    }
  }

  async actualizarCupon(
    user: AuthUser,
    cuponId: string,
    dto: Partial<CuponDto>,
    override?: string,
  ) {
    const tenantId = this.tid(user, override);
    await this.assertHabilitado(tenantId);
    const cupon = await this.prisma.convenioCupon.findFirst({
      where: { id: cuponId, convenio: { tenantId } },
      // Todo lo que `cambiaLoQueSeVe` necesita para comparar el ANTES con el
      // DESPUÉS: los dos interruptores, la fecha y el tope global.
      select: {
        id: true,
        convenioId: true,
        isActive: true,
        activoAliado: true,
        endsAt: true,
        maxTotal: true,
        canjesCount: true,
      },
    });
    if (!cupon) throw new NotFoundException('Cupón no encontrado');
    this.validarCupon(dto as CuponDto);

    // Lista blanca de campos, y `activoAliado` NO está en ella a propósito:
    // ese interruptor es de la empresa aliada y solo se toca desde su portal.
    // Es lo que hace que las dos partes puedan encender y apagar sin pisarse —
    // cada bandera tiene un único escritor, así que no hay nada que arbitrar.
    const data: any = {};
    for (const k of [
      'name', 'tipo', 'valor', 'description', 'terms', 'isActive',
      'maxPorPersona', 'periodo', 'maxTotal', 'compraMinima', 'topeDescuento',
    ] as const) {
      if (dto[k] !== undefined) data[k] = dto[k];
    }
    if (dto.endsAt !== undefined) {
      data.endsAt = this.parsearVigencia(dto.endsAt);
    }

    const actualizado = await this.prisma.convenioCupon.update({
      where: { id: cuponId },
      data,
    });

    // Refrescar la billetera solo si cambió lo que el empleado VE. Encender mi
    // llave con la del aliado apagada no cambia nada en su tarjeta, y empujar
    // por eso gasta cuota de Apple y Google y le hace vibrar el móvil para
    // nada. Encender de verdad reactiva la MISMA tarjeta — no se reemite.
    if (cambiaLoQueSeVe(cupon as any, actualizado, new Date())) {
      await this.avisarPases(cupon.convenioId);
    }
    return actualizado;
  }

  async borrarCupon(user: AuthUser, cuponId: string, override?: string) {
    const tenantId = this.tid(user, override);
    await this.assertHabilitado(tenantId);
    const cupon = await this.prisma.convenioCupon.findFirst({
      where: { id: cuponId, convenio: { tenantId } },
      select: { id: true, convenioId: true, canjesCount: true },
    });
    if (!cupon) throw new NotFoundException('Cupón no encontrado');
    // Con canjes hechos NO se borra: se apaga. Borrarlo se llevaría por
    // cascada el historial que sostiene el informe del aliado.
    if (cupon.canjesCount > 0) {
      throw new BadRequestException(
        'Este cupón ya tiene canjes. Apágalo en vez de borrarlo, así el historial y el informe del aliado siguen en pie.',
      );
    }
    await this.prisma.convenioCupon.delete({ where: { id: cuponId } });
    return { ok: true };
  }

  // ─────────────────────────────── Enlaces ───────────────────────────────

  /**
   * Los dos enlaces del convenio.
   *
   *  · El **de activación** es el que la empresa aliada reparte entre sus
   *    empleados. Es público y se puede reenviar sin miedo: quién puede activar
   *    lo decide la verificación, no el secreto del enlace.
   *  · El **del portal** lleva el mando del aliado (sus interruptores y la baja
   *    de quien se fue). Ese no se reenvía: se le pasa a quien lo maneja.
   *
   * Los dos salen del dominio DE LA MARCA del negocio, nunca de
   * `soyclubify.com`: un enlace de la plataforma dentro del correo de una marca
   * blanca la delata. Es la fuga de marca que más veces se ha repetido aquí.
   *
   * El `aliadoToken` se crea PEREZOSAMENTE, la primera vez que alguien pide los
   * enlaces. Generarlo para todos de golpe dejaría por ahí enlaces con mando
   * que nadie pidió, y bastaría una fuga del volcado para tenerlos todos.
   */
  async enlaces(user: AuthUser, id: string, override?: string) {
    const tenantId = this.tid(user, override);
    const convenio = await this.prisma.convenio.findFirst({
      where: { id, tenantId },
      select: { id: true, slug: true, aliadoToken: true, reportToken: true },
    });
    if (!convenio) throw new NotFoundException('Convenio no encontrado');

    let aliadoToken = convenio.aliadoToken;
    if (!aliadoToken) {
      aliadoToken = nanoid(24);
      await this.prisma.convenio.update({
        where: { id },
        data: { aliadoToken },
      });
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { slug: true, whiteLabelId: true },
    });
    const wl = tenant?.whiteLabelId
      ? await this.prisma.whiteLabel.findUnique({
          where: { id: tenant.whiteLabelId },
          select: BRAND_DOMAIN_SELECT,
        })
      : null;
    const base = brandBaseUrl(wl, process.env.APP_URL ?? 'https://soyclubify.com');

    return {
      /** Para los empleados. Se reparte por WhatsApp, correo o un QR impreso. */
      activacion: `${base}/alianza/${tenant?.slug}/${convenio.slug}`,
      /**
       * Para la empresa aliada. Lleva el mando: no se reparte.
       *
       * Cuelga de `/aliado/` y no de `/alianza/portal/` para que no compita con
       * la ruta del empleado: un negocio cuyo slug fuera «portal» haría que las
       * dos se solaparan, y ese fallo aparecería un año después sin que nadie
       * supiera de dónde salió.
       */
      portal: `${base}/aliado/${aliadoToken}`,
    };
  }

  /**
   * Rota el token del portal del aliado.
   *
   * Es la respuesta correcta a un enlace filtrado: cierra la puerta sin tocar
   * las tarjetas ya emitidas ni el historial. El aliado necesitará el enlace
   * nuevo.
   */
  async rotarTokenAliado(user: AuthUser, id: string, override?: string) {
    const tenantId = this.tid(user, override);
    await this.assertHabilitado(tenantId);
    const convenio = await this.prisma.convenio.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!convenio) throw new NotFoundException('Convenio no encontrado');
    await this.prisma.convenio.update({
      where: { id },
      data: { aliadoToken: nanoid(24) },
    });
    return this.enlaces(user, id, override);
  }

  // ───────────────────────── Tarjetas de los empleados ─────────────────────────

  /**
   * Las tarjetas emitidas del convenio, para el panel del negocio.
   *
   * El negocio SÍ ve los datos de las personas —es quien responde por el
   * documento que guardó y quien atiende cuando alguien reclama—. El aliado no:
   * en su portal solo hay agregados. La diferencia es deliberada.
   */
  async tarjetas(user: AuthUser, id: string, override?: string) {
    const tenantId = this.tid(user, override);
    const convenio = await this.prisma.convenio.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!convenio) throw new NotFoundException('Convenio no encontrado');
    const filas = await this.prisma.convenioTarjeta.findMany({
      where: { convenioId: id },
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: {
        customer: { select: { fullName: true, phone: true } },
        _count: { select: { canjes: true } },
      },
    });
    return filas.map((t) => ({
      id: t.id,
      nombre: t.customer.fullName,
      telefono: t.customer.phone,
      documento: t.documento,
      status: t.status,
      // Quién bloqueó, para que el negocio no levante un bloqueo del aliado sin
      // preguntarle antes: el aliado es quien sabe si esa persona sigue ahí.
      bloqueadaPor: t.blockedBy === 'aliado' ? 'aliado' : t.blockedBy ? 'negocio' : null,
      bloqueadaEl: t.blockedAt,
      origen: t.origen,
      canjes: t._count.canjes,
      createdAt: t.createdAt,
    }));
  }

  /** Bloquea o desbloquea a UNA persona sin apagarle el cupón a todos. */
  async bloquearTarjeta(
    user: AuthUser,
    tarjetaId: string,
    bloquear: boolean,
    override?: string,
  ) {
    const tenantId = this.tid(user, override);
    await this.assertHabilitado(tenantId);
    const tarjeta = await this.prisma.convenioTarjeta.findFirst({
      where: { id: tarjetaId, convenio: { tenantId } },
      select: { id: true, passId: true, status: true },
    });
    if (!tarjeta) throw new NotFoundException('Tarjeta no encontrada');
    const nuevo = bloquear ? 'BLOCKED' : 'ACTIVE';
    if (tarjeta.status === nuevo) return { ok: true, cambio: false };

    await this.prisma.convenioTarjeta.update({
      where: { id: tarjetaId },
      data: {
        status: nuevo,
        blockedAt: bloquear ? new Date() : null,
        blockedBy: bloquear ? `negocio:${user.id}` : null,
      },
    });
    if (tarjeta.passId) {
      await avisarUnPase(this.prisma, this.queue, tarjeta.passId, 'convenio_tarjeta');
    }
    return { ok: true, cambio: true };
  }
}
