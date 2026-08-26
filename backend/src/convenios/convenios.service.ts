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
  inicioDelPeriodo,
  describirTope,

  ZONA_POR_DEFECTO,
  type ConvenioPeriodo,
} from './periodos';

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
  endsAt?: string | null;
  sedeIds?: string[] | null;
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
    return this.prisma.convenio.create({
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
        endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
        reportToken: nanoid(24),
        ...(dto.sedeIds?.length
          ? { sedes: { create: dto.sedeIds.map((locationId) => ({ locationId })) } }
          : {}),
      },
    });
  }

  async update(user: AuthUser, id: string, dto: ConvenioDto, override?: string) {
    const tenantId = this.tid(user, override);
    const actual = await this.prisma.convenio.findFirst({
      where: { id, tenantId },
      select: { id: true, verificacion: true, codigo: true },
    });
    if (!actual) throw new NotFoundException('Convenio no encontrado');

    const verificacion = dto.verificacion ?? actual.verificacion;
    const data: any = {
      ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
      ...(dto.logoUrl !== undefined ? { logoUrl: dto.logoUrl } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.contactName !== undefined ? { contactName: dto.contactName } : {}),
      ...(dto.contactEmail !== undefined ? { contactEmail: dto.contactEmail } : {}),
      ...(dto.contactPhone !== undefined ? { contactPhone: dto.contactPhone } : {}),
      ...(dto.status !== undefined ? { status: dto.status } : {}),
      ...(dto.endsAt !== undefined
        ? { endsAt: dto.endsAt ? new Date(dto.endsAt) : null }
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
      data.codigo = dto.codigo.trim().toUpperCase() || null;
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
    }
    return actualizado;
  }

  /**
   * Refresca los pases de billetera del convenio.
   *
   * Una tarjeta ya instalada no se puede borrar a distancia, así que tiene que
   * COMUNICAR su estado: cuando el cupón se apaga, el pase se actualiza y se
   * ve inactivo. Es best-effort — el bloqueo de verdad es el del servidor, que
   * es inmediato; esto es lo que ve el cliente.
   */
  private async avisarPases(convenioId: string) {
    const tarjetas = await this.prisma.convenioTarjeta.findMany({
      where: { convenioId, passId: { not: null } },
      select: { passId: true },
      take: 5000,
    });
    for (const t of tarjetas) {
      if (!t.passId) continue;
      await this.queue
        .enqueue('wallet.push', {
          passId: t.passId,
          reason: 'convenio_estado',
        } as any)
        .catch(() => null);
    }
  }

  // ─────────────────────────────── Cupones ───────────────────────────────

  async crearCupon(user: AuthUser, convenioId: string, dto: CuponDto, override?: string) {
    const tenantId = this.tid(user, override);
    const convenio = await this.prisma.convenio.findFirst({
      where: { id: convenioId, tenantId },
      select: { id: true },
    });
    if (!convenio) throw new NotFoundException('Convenio no encontrado');
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
        endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
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
    const cupon = await this.prisma.convenioCupon.findFirst({
      where: { id: cuponId, convenio: { tenantId } },
      select: { id: true, convenioId: true, isActive: true },
    });
    if (!cupon) throw new NotFoundException('Cupón no encontrado');
    this.validarCupon(dto as CuponDto);

    const data: any = {};
    for (const k of [
      'name', 'tipo', 'valor', 'description', 'terms', 'isActive',
      'maxPorPersona', 'periodo', 'maxTotal', 'compraMinima', 'topeDescuento',
    ] as const) {
      if (dto[k] !== undefined) data[k] = dto[k];
    }
    if (dto.endsAt !== undefined) {
      data.endsAt = dto.endsAt ? new Date(dto.endsAt) : null;
    }

    const actualizado = await this.prisma.convenioCupon.update({
      where: { id: cuponId },
      data,
    });

    // El interruptor cambió: hay que refrescar lo que ve el cliente en su
    // billetera. Encender vuelve a activar la MISMA tarjeta — no se reemite.
    if (dto.isActive !== undefined && dto.isActive !== cupon.isActive) {
      await this.avisarPases(cupon.convenioId);
    }
    return actualizado;
  }

  async borrarCupon(user: AuthUser, cuponId: string, override?: string) {
    const tenantId = this.tid(user, override);
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
}
