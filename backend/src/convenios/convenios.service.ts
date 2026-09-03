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
  finDelDia,
  ZONA_POR_DEFECTO,
  type ConvenioPeriodo,
} from './periodos';
import {
  cambiaLoQueSeVe,
  estaAgotado,
  normalizarDocumento,
  normalizarEmail,
  quienApago,
} from './alianzas-estado';
import { avisarPasesDeAlianza, avisarUnPase } from './alianzas-pase.util';
import {
  cambiosDelDiseno,
  datosDeLaPlantilla,
  tituloPorDefecto,
  type DisenoDeLaAlianza,
} from './alianzas-plantilla';

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
  private parsearVigencia(valor: string | null | undefined, zona: string): Date | null {
    if (!valor) return null;
    const limpio = valor.trim();
    const d = new Date(limpio);
    if (Number.isNaN(d.getTime())) {
      throw new BadRequestException('La fecha de fin no es válida.');
    }
    // Solo se estira al final del día cuando viene en formato de fecha suelta
    // (YYYY-MM-DD), que es lo que manda un <input type="date">. Si llega un
    // instante completo, se respeta tal cual.
    //
    // El fin del día se calcula en la zona DEL NEGOCIO. Con `setHours` se usaba
    // la del proceso —UTC en Railway—, así que «hasta el 31 de diciembre» se
    // apagaba a las 18:59 hora de Bogotá: en plena noche de servicio y con un
    // cliente delante, que es justo lo que estirar la fecha quería evitar.
    const soloFecha = /^(\d{4})-(\d{2})-(\d{2})$/.exec(limpio);
    if (soloFecha) {
      return finDelDia(
        Number(soloFecha[1]),
        Number(soloFecha[2]),
        Number(soloFecha[3]),
        zona,
      );
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
    // La zona se resuelve una vez y se usa para las dos fechas: la del convenio
    // y la del beneficio. Dentro de la transacción no se puede consultar otra
    // vez sin alargarla sin motivo.
    const zonaNegocio = await this.zona(tenantId);
    const finVigencia = this.parsearVigencia(dto.endsAt, zonaNegocio);
    // La marca se lee fuera de la transacción por lo mismo que la zona: dentro
    // solo deben quedar escrituras.
    const negocio = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        brandName: true,
        primaryColor: true,
        secondaryColor: true,
        logoUrl: true,
      },
    });

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
            endsAt: this.parsearVigencia(dto.beneficio.endsAt, zonaNegocio),
            position: 1,
          },
        });
      }

      // La tarjeta nace CON la alianza, no con el primer empleado que activa.
      //
      // Perezosa tenía dos problemas. Uno de cara: el dueño no podía ver ni
      // retocar la tarjeta antes de repartir el enlace, porque no existía —
      // y él quería «optimizarla más bonita antes de crearse». Otro de fondo:
      // el primer empleado la creaba, así que fijaba para siempre unos colores
      // que nadie había elegido, y dos activaciones simultáneas podían crear
      // dos plantillas para la misma alianza.
      //
      // Va dentro de la transacción: una alianza sin tarjeta es una alianza
      // cuyo enlace falla, así que o están las dos o no está ninguna.
      await tx.card.create({
        data: datosDeLaPlantilla(
          tenantId,
          { id: convenio.id, name: convenio.name, logoUrl: convenio.logoUrl },
          negocio,
        ),
      });

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
        ? { endsAt: this.parsearVigencia(dto.endsAt, await this.zona(tenantId)) }
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
        endsAt: this.parsearVigencia(dto.endsAt, await this.zona(tenantId)),
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
      data.endsAt = this.parsearVigencia(dto.endsAt, await this.zona(tenantId));
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

  // ──────────────────────────── Lista blanca ────────────────────────────

  /**
   * Carga la lista de quién puede activar (modo LISTA).
   *
   * Sin esto, elegir «solo quien esté en la lista» dejaba la alianza inservible:
   * no había NINGUNA ruta que escribiera en `ConvenioListaBlanca`, así que todos
   * los empleados recibían «no encontramos tu documento en la lista de tu
   * empresa» — un fallo del producto redactado como culpa del usuario.
   *
   * Se AÑADE, no se reemplaza: sustituir la lista entera borraría el `usedAt`
   * de quien ya activó y le dejaría el cupo libre a otro.
   */
  async cargarLista(user: AuthUser, id: string, texto: string, override?: string) {
    const tenantId = this.tid(user, override);
    await this.assertHabilitado(tenantId);
    const convenio = await this.prisma.convenio.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!convenio) throw new NotFoundException('Convenio no encontrado');

    // Una entrada por línea. También se parte por comas, puntos y coma y
    // TABULADOR: pegar dos columnas de Excel («Ana Pérez⇥1020304050») sin el
    // tabulador producía una sola fila «ANAPÉREZ1020304050» que no casaría
    // jamás, y el dueño vería «120 en la lista» mientras a sus 120 empleados
    // les sale «no encontramos tu documento».
    const crudas = (texto ?? '')
      .split(/[\n\r,;\t]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (crudas.length === 0) {
      throw new BadRequestException('Pega al menos un documento o un correo.');
    }
    const TOPE = 5000;
    const recortadas = crudas.slice(0, TOPE);

    // Cada entrada se VALIDA, no solo se normaliza.
    //
    // Sin esto, pegar el Excel con su cabecera («Documento», «Correo»,
    // «Nombre») metía esas palabras como documentos válidos, y entonces
    // cualquiera escribía «documento» en el formulario público y se llevaba el
    // beneficio del aliado sin trabajar allí. Una lista blanca cuya credencial
    // se adivina no es una lista blanca.
    const filas: { documento: string | null; email: string | null }[] = [];
    const descartadas: string[] = [];
    for (const cruda of recortadas) {
      if (cruda.includes('@')) {
        const email = normalizarEmail(cruda);
        // Forma mínima de correo: algo, arroba, algo, punto, algo.
        if (email && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
          filas.push({ email, documento: null });
        } else {
          descartadas.push(cruda);
        }
        continue;
      }
      const documento = normalizarDocumento(cruda);
      // Un documento tiene al menos 4 dígitos y nada de espacios internos. Eso
      // deja fuera las cabeceras, los nombres y las notas sueltas, y admite los
      // formatos con letra (pasaportes, NIE) que sí son documentos.
      const digitos = (documento ?? '').replace(/\D/g, '').length;
      if (documento && documento.length >= 4 && digitos >= 4) {
        filas.push({ documento, email: null });
      } else {
        descartadas.push(cruda);
      }
    }

    const antes = await this.prisma.convenioListaBlanca.count({
      where: { convenioId: id },
    });
    // `skipDuplicates` no basta —no hay índice único aquí— así que se filtra
    // contra lo que ya está antes de insertar.
    const existentes = await this.prisma.convenioListaBlanca.findMany({
      where: { convenioId: id },
      select: { documento: true, email: true },
    });
    const yaHay = new Set(
      existentes.map((e) => `${e.documento ?? ''}|${e.email ?? ''}`),
    );
    // El Set se va alimentando dentro del filtro: si no, dos líneas iguales
    // DENTRO del mismo pegado se insertaban las dos y el contador mentía.
    const nuevas = filas.filter((f) => {
      const clave = `${f.documento ?? ''}|${f.email ?? ''}`;
      if (yaHay.has(clave)) return false;
      yaHay.add(clave);
      return true;
    });
    if (nuevas.length > 0) {
      await this.prisma.convenioListaBlanca.createMany({
        data: nuevas.map((f) => ({ convenioId: id, ...f })),
      });
    }
    return {
      agregadas: nuevas.length,
      yaEstaban: filas.length - nuevas.length,
      // Lo descartado se DEVUELVE, no se traga en silencio: si el dueño pega
      // 6.000 empleados y solo entran 5.000, tiene que enterarse ahora y no
      // cuando los otros 1.000 empiecen a reclamar.
      descartadas,
      recortadas: crudas.length > TOPE ? crudas.length - TOPE : 0,
      total: antes + nuevas.length,
    };
  }

  /** Quién está en la lista y quién ya la usó. Solo para el panel del negocio. */
  async verLista(user: AuthUser, id: string, override?: string) {
    const tenantId = this.tid(user, override);
    // La lista son datos personales de los empleados del aliado: con el módulo
    // apagado no se leen. Faltaba aquí y sí estaba en los otros dos métodos.
    await this.assertHabilitado(tenantId);
    const convenio = await this.prisma.convenio.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!convenio) throw new NotFoundException('Convenio no encontrado');
    // Los PENDIENTES primero. `usedAt: 'asc'` ponía los NULL al final en
    // Postgres, así que el panel enseñaba primero a quien ya activó —lo que ya
    // no hay que hacer— y dejaba al fondo justo a los que faltan.
    return this.prisma.convenioListaBlanca.findMany({
      where: { convenioId: id },
      orderBy: [{ usedAt: 'desc' }, { createdAt: 'asc' }],
      take: 1000,
      select: { id: true, documento: true, email: true, usedAt: true },
    });
  }

  /** Quita a alguien de la lista. No toca su tarjeta si ya la activó. */
  async quitarDeLista(user: AuthUser, filaId: string, override?: string) {
    const tenantId = this.tid(user, override);
    await this.assertHabilitado(tenantId);
    const fila = await this.prisma.convenioListaBlanca.findFirst({
      where: { id: filaId, convenio: { tenantId } },
      select: { id: true },
    });
    if (!fila) throw new NotFoundException('No encontrado');
    await this.prisma.convenioListaBlanca.delete({ where: { id: filaId } });
    // Quitar de la lista NO bloquea a quien ya activó: la lista solo se mira al
    // activar. Para retirarle el beneficio hay que bloquear su tarjeta.
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

  /**
   * El diseño de la tarjeta de la alianza, para el editor del panel.
   *
   * Devuelve también los valores por defecto: el editor los enseña como
   * marcador de posición, para que el dueño vea qué va a salir si deja la caja
   * vacía en vez de un hueco.
   */
  async diseno(user: AuthUser, id: string, override?: string) {
    const tenantId = this.tid(user, override);
    const convenio = await this.prisma.convenio.findFirst({
      where: { id, tenantId },
      select: { id: true, name: true, logoUrl: true },
    });
    if (!convenio) throw new NotFoundException('Convenio no encontrado');

    const card = await this.prisma.card.findFirst({
      where: { tenantId, convenioId: id },
      select: {
        id: true,
        name: true,
        rewardText: true,
        primaryColor: true,
        secondaryColor: true,
        logoUrl: true,
        businessName: true,
      },
    });

    return {
      // `null` significa «esta alianza es anterior a la plantilla temprana».
      // El panel lo usa para avisar de que el diseño se fija al activar el
      // primer empleado, en vez de enseñar un editor que no guarda nada.
      card,
      // Solo el título: el texto de recompensa no se edita en una alianza
      // porque el pase lo pisa con los beneficios vivos. Ver `textoPorDefecto`.
      porDefecto: { name: tituloPorDefecto(convenio.name) },
      logoDelAliado: convenio.logoUrl,
    };
  }

  /**
   * Guarda el diseño y avisa a las billeteras ya instaladas.
   *
   * Lo segundo no es un extra: cambiar el color de una tarjeta que ya está en
   * el teléfono de cien empleados y no notificarlo deja el panel diciendo una
   * cosa y los teléfonos enseñando otra durante días — Apple solo se vuelve a
   * bajar el pase cuando se le avisa.
   */
  async guardarDiseno(
    user: AuthUser,
    id: string,
    dto: DisenoDeLaAlianza,
    override?: string,
  ) {
    const tenantId = this.tid(user, override);
    await this.assertHabilitado(tenantId);
    const convenio = await this.prisma.convenio.findFirst({
      where: { id, tenantId },
      select: { id: true, name: true },
    });
    if (!convenio) throw new NotFoundException('Convenio no encontrado');

    const card = await this.prisma.card.findFirst({
      where: { tenantId, convenioId: id },
      select: { id: true },
    });
    if (!card) {
      throw new BadRequestException(
        'Esta alianza todavía no tiene tarjeta: se crea con el primer empleado que active. Cuando la haya, podrás editarla aquí.',
      );
    }

    const cambios = cambiosDelDiseno(dto, convenio.name);
    if (!Object.keys(cambios).length) return { ok: true, cambio: false };

    await this.prisma.card.update({ where: { id: card.id }, data: cambios });
    // El logo del aliado se guarda además en el convenio: es de la empresa, no
    // de la tarjeta, y de ahí lo lee la franja del pase y el portal del aliado.
    if (cambios.logoUrl !== undefined) {
      await this.prisma.convenio.update({
        where: { id },
        data: { logoUrl: cambios.logoUrl },
      });
    }

    await avisarPasesDeAlianza(this.prisma, this.queue, id, 'convenio_diseno');
    return { ok: true, cambio: true };
  }
}
