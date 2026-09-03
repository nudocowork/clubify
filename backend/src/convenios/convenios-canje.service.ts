import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import {
  inicioDelPeriodo,
  describirTope,
  cuandoVuelve,
  ZONA_POR_DEFECTO,
  type ConvenioPeriodo,
} from './periodos';

/** Ventana para anular un canje mal registrado en la caja. */
const MINUTOS_PARA_ANULAR = 10;

type EstadoCupon = {
  id: string;
  name: string;
  tipo: string;
  valor: number;
  description: string;
  /** Lo que el cajero tiene que aplicar, en grande y en una línea. */
  aplicar: string;
  disponible: boolean;
  /** Si no está disponible, POR QUÉ. En castellano y accionable. */
  motivo: string | null;
  topeTexto: string;
  compraMinima: number | null;
};

/**
 * El canje de un convenio en el punto de venta.
 *
 * Vive aparte del servicio de administración porque es lo único que corre con
 * un cliente delante del mostrador: aquí importan la concurrencia, los
 * mensajes de rechazo y no cobrar de más.
 *
 * Un canje de convenio NO suma sellos ni convierte la tarjeta en nada. Son
 * sistemas separados y tienen que seguir siéndolo.
 */
@Injectable()
export class ConveniosCanjeService {
  private logger = new Logger(ConveniosCanjeService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Qué ve el cajero al escanear una tarjeta de convenio.
   *
   * Devuelve TODOS los cupones encendidos con su estado, no solo los
   * disponibles: si uno está agotado hay que decir por qué, no esconderlo —
   * si no, el cajero cree que el escáner falla.
   *
   * Si hay varios encendidos, el cajero elige. Nunca se asume el primero.
   */
  async resolverParaCaja(
    user: AuthUser,
    passId: string,
    locationId?: string | null,
  ) {
    const tarjeta = await this.prisma.convenioTarjeta.findFirst({
      where: { passId },
      include: {
        customer: { select: { id: true, fullName: true } },
        convenio: {
          include: {
            cupones: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] },
            sedes: { select: { locationId: true } },
          },
        },
      },
    });
    if (!tarjeta) throw new NotFoundException('Esta tarjeta no es de un convenio.');

    const convenio = tarjeta.convenio;
    if (user.role !== 'SUPER_ADMIN' && user.tenantId !== convenio.tenantId) {
      throw new ForbiddenException(
        'Esta tarjeta pertenece a otro negocio. Verifica que iniciaste sesión con la cuenta correcta.',
      );
    }

    const ahora = new Date();
    const zona = await this.zona(convenio.tenantId);

    // Motivos que tumban el convenio ENTERO. Se comprueban una vez y el
    // mensaje es el mismo para todos los cupones.
    let motivoGlobal: string | null = null;
    if (convenio.status === 'FINISHED') motivoGlobal = 'Convenio finalizado.';
    else if (convenio.status === 'PAUSED') motivoGlobal = 'Convenio en pausa.';
    else if (convenio.endsAt && convenio.endsAt <= ahora) {
      motivoGlobal = 'El convenio llegó a su fecha de fin.';
    } else if (tarjeta.status === 'BLOCKED') {
      motivoGlobal = 'Esta persona tiene el beneficio bloqueado.';
    } else if (
      convenio.sedes.length > 0 &&
      locationId &&
      !convenio.sedes.some((s) => s.locationId === locationId)
    ) {
      motivoGlobal = 'Este convenio no aplica en esta sede.';
    }

    const cupones: EstadoCupon[] = [];
    for (const c of convenio.cupones) {
      const estado = await this.estadoDelCupon(c, tarjeta.id, ahora, zona, motivoGlobal);
      cupones.push(estado);
    }

    return {
      tipo: 'CONVENIO' as const,
      convenio: {
        id: convenio.id,
        name: convenio.name,
        logoUrl: convenio.logoUrl,
        status: convenio.status,
      },
      titular: {
        nombre: tarjeta.customer.fullName,
        // Solo los últimos 4 del documento: basta para cotejar con la cédula
        // que muestre la persona, y no expone el número entero en pantalla.
        documento4: tarjeta.documento
          ? tarjeta.documento.slice(-4).padStart(4, '•')
          : null,
      },
      tarjetaId: tarjeta.id,
      motivoGlobal,
      cupones,
    };
  }

  private async zona(tenantId: string): Promise<string> {
    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { timezone: true },
    });
    return t?.timezone || ZONA_POR_DEFECTO;
  }

  /** Texto de lo que hay que aplicar en la caja. */
  private describirBeneficio(tipo: string, valor: number, nombre: string) {
    switch (tipo) {
      case 'PERCENT_OFF':
        return `Aplicar ${valor}% de descuento`;
      case 'AMOUNT_OFF':
        return `Aplicar $${valor.toLocaleString('es-CO')} de descuento`;
      case 'FREEBIE':
        return `Entregar gratis: ${nombre}`;
      case 'TWO_FOR_ONE':
        return `2x1 en: ${nombre}`;
      default:
        return nombre;
    }
  }

  private async estadoDelCupon(
    c: any,
    tarjetaId: string,
    ahora: Date,
    zona: string,
    motivoGlobal: string | null,
  ): Promise<EstadoCupon> {
    const base = {
      id: c.id,
      name: c.name,
      tipo: c.tipo,
      valor: c.valor,
      description: c.description,
      aplicar: this.describirBeneficio(c.tipo, c.valor, c.name),
      topeTexto: describirTope(c.maxPorPersona, c.periodo as ConvenioPeriodo),
      compraMinima: c.compraMinima ?? null,
    };

    if (motivoGlobal) {
      return { ...base, disponible: false, motivo: motivoGlobal };
    }
    if (!c.isActive) {
      return { ...base, disponible: false, motivo: 'Beneficio no disponible.' };
    }
    if (c.endsAt && c.endsAt <= ahora) {
      return { ...base, disponible: false, motivo: 'Este cupón ya venció.' };
    }
    if (c.maxTotal != null && c.canjesCount >= c.maxTotal) {
      return { ...base, disponible: false, motivo: 'Se agotaron los canjes de este cupón.' };
    }
    if (c.maxPorPersona != null) {
      const desde = inicioDelPeriodo(c.periodo as ConvenioPeriodo, ahora, zona);
      const usados = await this.prisma.convenioCanje.count({
        where: {
          cuponId: c.id,
          tarjetaId,
          revertedAt: null,
          ...(desde ? { createdAt: { gte: desde } } : {}),
        },
      });
      if (usados >= c.maxPorPersona) {
        return {
          ...base,
          disponible: false,
          motivo: cuandoVuelve(c.periodo as ConvenioPeriodo),
        };
      }
    }
    return { ...base, disponible: true, motivo: null };
  }

  /**
   * Registra el canje.
   *
   * TODA la validación se repite aquí dentro del candado, aunque
   * `resolverParaCaja` ya la haya hecho: entre que el cajero ve la pantalla y
   * pulsa, el dueño pudo apagar el cupón, y dos cajas pueden escanear la
   * misma tarjeta a la vez. Lo que se ve en pantalla nunca es la autorización.
   */
  async canjear(
    user: AuthUser,
    dto: {
      tarjetaId: string;
      cuponId: string;
      locationId?: string | null;
      compraMonto?: number | null;
    },
  ) {
    const tarjeta = await this.prisma.convenioTarjeta.findUnique({
      where: { id: dto.tarjetaId },
      include: {
        convenio: { include: { sedes: { select: { locationId: true } } } },
        customer: { select: { fullName: true } },
      },
    });
    if (!tarjeta) throw new NotFoundException('Tarjeta no encontrada');
    const convenio = tarjeta.convenio;
    if (user.role !== 'SUPER_ADMIN' && user.tenantId !== convenio.tenantId) {
      throw new ForbiddenException('Esta tarjeta pertenece a otro negocio.');
    }

    const ahora = new Date();
    const zona = await this.zona(convenio.tenantId);

    if (convenio.status !== 'ACTIVE') {
      throw new BadRequestException(
        convenio.status === 'FINISHED' ? 'Convenio finalizado.' : 'Convenio en pausa.',
      );
    }
    if (convenio.endsAt && convenio.endsAt <= ahora) {
      throw new BadRequestException('El convenio llegó a su fecha de fin.');
    }
    if (tarjeta.status === 'BLOCKED') {
      throw new BadRequestException('Esta persona tiene el beneficio bloqueado.');
    }
    if (
      convenio.sedes.length > 0 &&
      dto.locationId &&
      !convenio.sedes.some((s) => s.locationId === dto.locationId)
    ) {
      throw new BadRequestException('Este convenio no aplica en esta sede.');
    }

    const cupon = await this.prisma.convenioCupon.findFirst({
      where: { id: dto.cuponId, convenioId: convenio.id },
    });
    if (!cupon) throw new NotFoundException('Cupón no encontrado');
    if (!cupon.isActive) throw new BadRequestException('Beneficio no disponible.');
    if (cupon.endsAt && cupon.endsAt <= ahora) {
      throw new BadRequestException('Este cupón ya venció.');
    }
    if (cupon.compraMinima != null) {
      if (dto.compraMonto == null) {
        throw new BadRequestException(
          `Este cupón pide compra mínima de $${cupon.compraMinima.toLocaleString('es-CO')}. Escribe el total del tiquete.`,
        );
      }
      if (dto.compraMonto < cupon.compraMinima) {
        throw new BadRequestException(
          `La compra mínima es $${cupon.compraMinima.toLocaleString('es-CO')}.`,
        );
      }
    }

    const descuento = this.calcularDescuento(cupon, dto.compraMonto ?? null);

    const canje = await this.prisma.$transaction(async (tx) => {
      // Candado por cupón: serializa los canjes concurrentes. Sin esto, dos
      // cajas escaneando a la vez leen el mismo conteo y las dos pasan — que
      // es exactamente lo que un tope de "1 por día" tiene que impedir.
      // Copiado de la cuponera, donde ya resolvió este mismo problema.
      await tx.$executeRawUnsafe(
        `SELECT pg_advisory_xact_lock(hashtext($1))`,
        `convenio-canje:${cupon.id}`,
      );

      if (cupon.maxTotal != null) {
        const total = await tx.convenioCanje.count({
          where: { cuponId: cupon.id, revertedAt: null },
        });
        if (total >= cupon.maxTotal) {
          throw new BadRequestException('Se agotaron los canjes de este cupón.');
        }
      }
      if (cupon.maxPorPersona != null) {
        const desde = inicioDelPeriodo(cupon.periodo as ConvenioPeriodo, ahora, zona);
        const mios = await tx.convenioCanje.count({
          where: {
            cuponId: cupon.id,
            tarjetaId: tarjeta.id,
            revertedAt: null,
            ...(desde ? { createdAt: { gte: desde } } : {}),
          },
        });
        if (mios >= cupon.maxPorPersona) {
          throw new BadRequestException(cuandoVuelve(cupon.periodo as ConvenioPeriodo));
        }
      }

      const creado = await tx.convenioCanje.create({
        data: {
          convenioId: convenio.id,
          cuponId: cupon.id,
          tarjetaId: tarjeta.id,
          locationId: dto.locationId ?? null,
          operatorUserId: user.id,
          compraMonto: dto.compraMonto ?? null,
          descuentoMonto: descuento,
        },
      });
      await tx.convenioCupon.update({
        where: { id: cupon.id },
        data: { canjesCount: { increment: 1 } },
      });
      return creado;
    });

    // Tope global alcanzado: el cupón se apaga solo. Así el siguiente cliente
    // recibe "no disponible" en vez de que el cajero lo intente y falle.
    if (cupon.maxTotal != null && cupon.canjesCount + 1 >= cupon.maxTotal) {
      await this.prisma.convenioCupon
        .update({ where: { id: cupon.id }, data: { isActive: false } })
        .catch(() => null);
    }

    return {
      ok: true,
      canjeId: canje.id,
      titular: tarjeta.customer.fullName,
      aplicar: this.describirBeneficio(cupon.tipo, cupon.valor, cupon.name),
      descuentoMonto: descuento,
      anulableHasta: new Date(canje.createdAt.getTime() + MINUTOS_PARA_ANULAR * 60_000),
    };
  }

  /**
   * Descuento en dinero, calculado SIEMPRE en el servidor.
   *
   * Solo se puede saber si el cajero escribió el total del tiquete. Sin eso
   * queda null y el informe cuenta canjes, no pesos — que es el motivo por el
   * que pedir el monto vale la pena.
   */
  private calcularDescuento(cupon: any, compra: number | null): number | null {
    if (cupon.tipo === 'AMOUNT_OFF') {
      // Nunca descontar más que el total de la compra.
      return compra != null ? Math.min(cupon.valor, compra) : cupon.valor;
    }
    if (cupon.tipo === 'PERCENT_OFF') {
      if (compra == null) return null;
      const bruto = Math.round((compra * cupon.valor) / 100);
      return cupon.topeDescuento != null
        ? Math.min(bruto, cupon.topeDescuento)
        : bruto;
    }
    // FREEBIE / TWO_FOR_ONE: el valor depende del producto, no se calcula.
    return null;
  }

  /**
   * Anula un canje recién hecho.
   *
   * No se borra: se marca. El canje anulado deja de contar para los topes y
   * para el informe, pero queda el rastro de quién lo anuló y cuándo.
   */
  async anular(user: AuthUser, canjeId: string) {
    const canje = await this.prisma.convenioCanje.findUnique({
      where: { id: canjeId },
      include: { convenio: { select: { tenantId: true } } },
    });
    if (!canje) throw new NotFoundException('Canje no encontrado');
    if (user.role !== 'SUPER_ADMIN' && user.tenantId !== canje.convenio.tenantId) {
      throw new ForbiddenException();
    }
    if (canje.revertedAt) {
      throw new BadRequestException('Este canje ya estaba anulado.');
    }
    const minutos = (Date.now() - canje.createdAt.getTime()) / 60_000;
    if (minutos > MINUTOS_PARA_ANULAR && user.role !== 'SUPER_ADMIN') {
      throw new BadRequestException(
        `Solo se puede anular dentro de los ${MINUTOS_PARA_ANULAR} minutos. Este canje ya lleva ${Math.floor(minutos)}.`,
      );
    }

    await this.prisma.$transaction([
      this.prisma.convenioCanje.update({
        where: { id: canjeId },
        data: { revertedAt: new Date(), revertedBy: user.id },
      }),
      this.prisma.convenioCupon.update({
        where: { id: canje.cuponId },
        data: { canjesCount: { decrement: 1 } },
      }),
    ]);
    return { ok: true };
  }
}
