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
import {
  describirBeneficio,
  motivoDelConvenio,
  motivoDelCupon,
} from './alianzas-estado';

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
   * En qué sede está ocurriendo esto.
   *
   * El filtro por sedes de un convenio estaba escrito pero **muerto**: la
   * condición exigía un `locationId` que nadie mandaba nunca —el escáner no
   * tiene selector de sede— así que un beneficio pactado solo para una sucursal
   * se podía canjear en cualquiera. El dueño elegía las sedes al crear la
   * alianza y el producto no cumplía esa promesa.
   *
   * Se cae a la sede del CAJERO, que ya existe en la base desde junio
   * («cada staff puede estar asociado a una sede», `User.locationId`) pero no
   * viaja en el token. Se lee aquí y no se mete en el JWT para no tocar la
   * autenticación de todo el producto por un caso de un módulo.
   *
   * Si el cajero no tiene sede asignada —o es el dueño, que no la tiene— se
   * queda como hasta ahora y no se aplica: no se inventa una restricción que
   * nadie configuró, que sería peor que no tenerla.
   */
  private async sedeDelCanje(user: AuthUser, pedida?: string | null) {
    if (pedida) return pedida;
    const cajero = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { locationId: true },
    });
    return cajero?.locationId ?? null;
  }

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
    const sede = await this.sedeDelCanje(user, locationId);

    // Motivos que tumban el convenio ENTERO. Se comprueban una vez y el
    // mensaje es el mismo para todos los cupones: repetir «Convenio en pausa»
    // una vez por beneficio hace pensar al cajero que cada uno falló aparte.
    //
    // El interruptor del MÓDULO va el primero. Antes solo se comprobaba al
    // crear un convenio, así que apagarlo desde el panel de admin no impedía
    // seguir canjeando: el negocio creía haberlo apagado y no lo había hecho.
    let motivoGlobal: string | null = (await this.moduloApagado(convenio.tenantId))
      ? 'Los convenios de este negocio están desactivados.'
      : motivoDelConvenio(convenio, ahora);
    if (!motivoGlobal) {
      if (tarjeta.status === 'BLOCKED') {
        motivoGlobal = 'Esta persona tiene el beneficio bloqueado.';
      } else if (
        convenio.sedes.length > 0 &&
        sede &&
        !convenio.sedes.some((s) => s.locationId === sede)
      ) {
        motivoGlobal = 'Este convenio no aplica en esta sede.';
      }
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

  /**
   * ¿El negocio tiene los convenios apagados desde el panel de admin?
   *
   * Apagar un módulo tiene que apagarlo de verdad: bloquear el canje, la
   * edición y las activaciones nuevas. Sin tocar un solo dato, para que
   * volver a encenderlo lo devuelva todo tal cual estaba.
   */
  private async moduloApagado(tenantId: string): Promise<boolean> {
    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { conveniosEnabled: true },
    });
    return !t?.conveniosEnabled;
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
      aplicar: describirBeneficio(c.tipo, c.valor, c.name),
      topeTexto: describirTope(c.maxPorPersona, c.periodo as ConvenioPeriodo),
      compraMinima: c.compraMinima ?? null,
    };

    // Todo lo que se puede decidir sin contar en la base —los dos
    // interruptores, la fecha, el tope global— sale del motor puro, el mismo
    // que usan la página de activación y el portal del aliado.
    const motivo = motivoDelCupon(c, ahora, motivoGlobal);
    if (motivo) return { ...base, disponible: false, motivo };

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

    if (await this.moduloApagado(convenio.tenantId)) {
      throw new BadRequestException(
        'Los convenios de este negocio están desactivados.',
      );
    }
    const motivoConvenio = motivoDelConvenio(convenio, ahora);
    if (motivoConvenio) throw new BadRequestException(motivoConvenio);
    if (tarjeta.status === 'BLOCKED') {
      throw new BadRequestException('Esta persona tiene el beneficio bloqueado.');
    }
    const sede = await this.sedeDelCanje(user, dto.locationId);
    if (
      convenio.sedes.length > 0 &&
      sede &&
      !convenio.sedes.some((s) => s.locationId === sede)
    ) {
      throw new BadRequestException('Este convenio no aplica en esta sede.');
    }

    const cupon = await this.prisma.convenioCupon.findFirst({
      where: { id: dto.cuponId, convenioId: convenio.id },
    });
    if (!cupon) throw new NotFoundException('Cupón no encontrado');
    // Los dos interruptores, la fecha y el tope global, por el mismo motor que
    // pintó la pantalla. Se repite aquí a propósito: entre que el cajero mira y
    // pulsa, el dueño o el aliado pudieron apagar el cupón.
    const motivoCupon = motivoDelCupon(cupon, ahora, null);
    if (motivoCupon) throw new BadRequestException(motivoCupon);
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
          // La sede EFECTIVA, no solo la que mandó el escáner: si salió de
          // la ficha del cajero, el informe por sede tiene que verla igual.
          locationId: sede,
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

    // NO se apaga el cupón al llegar al tope. Antes se escribía
    // `isActive = false` aquí y salía caro por partida doble: el cajero leía
    // «apagado por el negocio» —que es falso, se agotó— y subir el tope no
    // reabría el cupón, sin que nadie entendiera por qué. «Agotado» es un
    // estado CALCULADO (`estaAgotado`), no una bandera guardada.

    return {
      ok: true,
      canjeId: canje.id,
      titular: tarjeta.customer.fullName,
      aplicar: describirBeneficio(cupon.tipo, cupon.valor, cupon.name),
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

    // La comprobación de arriba NO basta: leer-decidir-escribir es la clase de
    // bug más repetida de este producto. Un doble clic del cajero pasaba dos
    // veces por el `if (canje.revertedAt)` antes de que ninguna escribiera, y
    // el contador del cupón se descontaba DOS veces por una sola anulación —
    // regalando un canje del tope global.
    //
    // El arreglo es el de siempre: UPDATE condicional y mirar el `count`. Solo
    // quien de verdad cambió la fila toca el contador.
    const ganada = await this.prisma.$transaction(async (tx) => {
      const r = await tx.convenioCanje.updateMany({
        where: { id: canjeId, revertedAt: null },
        data: { revertedAt: new Date(), revertedBy: user.id },
      });
      if (r.count === 0) return false;
      await tx.convenioCupon.update({
        where: { id: canje.cuponId },
        data: { canjesCount: { decrement: 1 } },
      });
      return true;
    });
    if (!ganada) {
      throw new BadRequestException('Este canje ya estaba anulado.');
    }
    return { ok: true };
  }
}
