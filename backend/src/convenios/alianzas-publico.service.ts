import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { nanoid } from 'nanoid';
import { PrismaService } from '../common/prisma/prisma.service';
import { genQrToken } from '../passes/passes.service';
import {
  admiteActivaciones,
  motivoDelConvenio,
  motivoDelCupon,
  describirBeneficio,
  normalizarCodigo,
  normalizarDocumento,
  normalizarEmail,
} from './alianzas-estado';

export type ActivacionDto = {
  fullName: string;
  phone: string;
  documento: string;
  email?: string | null;
  codigo?: string | null;
  /** Por dónde llegó (qr, whatsapp, correo…). Mide qué canal del aliado funciona. */
  via?: string | null;
  dataPolicyAccepted?: boolean;
};

/** Intentos fallidos de código antes de cerrar la puerta un rato. */
const MAX_INTENTOS = 5;
const VENTANA_INTENTOS_MS = 15 * 60_000;

/**
 * La puerta de entrada del empleado: el enlace único que la empresa aliada
 * reparte entre su gente.
 *
 * Es lo único que faltaba para que las alianzas existieran de verdad. Hasta
 * ahora `ConvenioTarjeta` no se creaba en ningún sitio, `Card.convenioId` no se
 * escribía nunca y `Convenio.codigo` se guardaba sin que nadie lo comprobara:
 * el módulo entero era una casa sin puerta.
 *
 * Molde copiado de `passes.service.enrollPublic`, que es el camino real por el
 * que se dan de alta los clientes y ya sobrevivió producción —incluidos sus
 * manejadores de P2002 por doble envío, que aquí hacen la misma falta.
 */
@Injectable()
export class AlianzasPublicoService {
  private logger = new Logger(AlianzasPublicoService.name);

  /**
   * Intentos fallidos de código, en memoria.
   *
   * En memoria y no en la base a propósito: un código son 8 caracteres de un
   * alfabeto de 31 (~8·10¹¹ combinaciones), así que la fuerza bruta por HTTP no
   * es la amenaza real —lo es un código filtrado, y contra eso lo que sirve es
   * rotarlo—. Esto solo corta el ruido. Se pierde al reiniciar y no se comparte
   * entre instancias, y es aceptable por lo mismo.
   *
   * Los `@Throttle` de este backend no protegen: falta `trust proxy` y todas
   * las peticiones se ven con la misma IP. Por eso hay un contador propio.
   */
  private intentos = new Map<string, { n: number; hasta: number }>();

  constructor(private prisma: PrismaService) {}

  // ─────────────────────────── La página pública ───────────────────────────

  /**
   * Qué pintar en la página del enlace.
   *
   * Devuelve la marca del NEGOCIO y el logo del ALIADO. Sin negocio resuelto no
   * se devuelve nada: pintar un «Clubify» por defecto en la página de una marca
   * blanca delata la plataforma, que es el bug que más veces se ha repetido en
   * este producto.
   */
  async info(tenantSlug: string, convenioSlug: string) {
    const { tenant, convenio } = await this.resolver(tenantSlug, convenioSlug);
    const ahora = new Date();

    // Motivo por el que no se puede activar, en el orden de la especificación.
    // El primero que aplica gana y los de abajo ni se miran.
    let cerrado: string | null = null;
    if (convenio.status === 'FINISHED') {
      cerrado = 'Este convenio finalizó. Gracias por tu interés.';
    } else if (convenio.status === 'PAUSED') {
      cerrado = 'Este convenio está en pausa por ahora. Inténtalo de nuevo más adelante.';
    } else if (convenio.endsAt && convenio.endsAt <= ahora) {
      cerrado = 'Este convenio ya terminó.';
    } else if (convenio.cupones.length === 0) {
      // Se PUEDE activar con todos los cupones apagados —la tarjeta nace y
      // comunica «en pausa»—, pero no si no hay ninguno: una tarjeta que nunca
      // tuvo contenido no es una pausa, es un enlace repartido antes de tiempo.
      cerrado = 'Este convenio aún no está disponible. Inténtalo más tarde.';
    }

    const motivoGlobal = motivoDelConvenio(convenio, ahora);
    return {
      negocio: {
        nombre: tenant.brandName,
        logoUrl: tenant.logoUrl,
        color: tenant.primaryColor,
      },
      aliado: {
        nombre: convenio.name,
        logoUrl: convenio.logoUrl,
        descripcion: convenio.description,
      },
      verificacion: convenio.verificacion,
      /** Qué pedirle a la persona. El servidor lo vuelve a exigir al activar. */
      pide: {
        codigo: convenio.verificacion === 'CODIGO',
        documento: true,
        // Se guarda documento de identidad: aquí la política de datos no es
        // opcional como en el alta normal, donde depende de `card.dataPolicyEnabled`.
        politicaDatos: true,
      },
      politicaDatosUrl: tenant.dataPolicyUrl || '/legal/tratamiento-datos',
      cerrado,
      /** Los beneficios, para que la persona sepa qué gana antes de dar sus datos. */
      beneficios: convenio.cupones
        .filter((c) => motivoDelCupon(c, ahora, motivoGlobal) === null)
        .map((c) => ({
          nombre: c.name,
          descripcion: c.description,
          resumen: describirBeneficio(c.tipo, c.valor, c.name),
        })),
    };
  }

  private async resolver(tenantSlug: string, convenioSlug: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug: tenantSlug },
      select: {
        id: true,
        brandName: true,
        logoUrl: true,
        primaryColor: true,
        status: true,
        conveniosEnabled: true,
        dataPolicyUrl: true,
      },
    });
    // Módulo apagado o negocio suspendido: se responde como si el enlace no
    // existiera. Decir «este negocio tiene los convenios desactivados» filtra
    // que el negocio existe y en qué estado está.
    if (!tenant || tenant.status === 'SUSPENDED' || !tenant.conveniosEnabled) {
      throw new NotFoundException('Este enlace no está disponible.');
    }
    const convenio = await this.prisma.convenio.findFirst({
      where: { tenantId: tenant.id, slug: convenioSlug },
      include: {
        cupones: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] },
      },
    });
    if (!convenio) throw new NotFoundException('Este enlace no está disponible.');
    return { tenant, convenio };
  }

  // ───────────────────────────── La activación ─────────────────────────────

  async activar(tenantSlug: string, convenioSlug: string, dto: ActivacionDto) {
    const { tenant, convenio } = await this.resolver(tenantSlug, convenioSlug);
    const ahora = new Date();

    // Las mismas puertas que en `info`, repetidas en el servidor: el formulario
    // nunca es la autorización.
    if (!admiteActivaciones(convenio, ahora)) {
      throw new BadRequestException(
        motivoDelConvenio(convenio, ahora) ?? 'Este convenio no está disponible.',
      );
    }
    if (convenio.cupones.length === 0) {
      throw new BadRequestException(
        'Este convenio aún no está disponible. Inténtalo más tarde.',
      );
    }

    const nombre = (dto.fullName ?? '').trim();
    if (nombre.length < 2) {
      throw new BadRequestException('Escribe tu nombre completo.');
    }
    const phoneNorm = (dto.phone || '').replace(/\s/g, '').trim();
    if (phoneNorm.length < 8) {
      throw new BadRequestException('Escribe un teléfono válido con indicativo.');
    }
    const documento = normalizarDocumento(dto.documento);
    if (!documento || documento.length < 4) {
      throw new BadRequestException('Escribe tu documento de identidad.');
    }
    if (dto.dataPolicyAccepted !== true) {
      throw new BadRequestException(
        'Necesitamos que aceptes la política de tratamiento de datos para emitir tu tarjeta.',
      );
    }
    const email = normalizarEmail(dto.email);

    // ── Cliente: match-or-create por teléfono, igual que el alta normal ──
    const customer = await this.buscarOCrearCliente(
      tenant.id,
      nombre,
      phoneNorm,
      email,
    );

    // ── Idempotencia ANTES de verificar ──
    // Quien ya demostró una vez que pertenece a la empresa no tiene que volver
    // a hacerlo: pudo perder el código, o borrar el pase del móvil y volver al
    // enlace. Devolverle SU tarjeta con su historial intacto es lo correcto.
    const previa = await this.prisma.convenioTarjeta.findUnique({
      where: {
        convenioId_customerId: { convenioId: convenio.id, customerId: customer.id },
      },
    });
    if (previa) {
      if (previa.status === 'BLOCKED') {
        // Nunca se desbloquea sola por volver a activar: sería la puerta de
        // atrás que anula el bloqueo del negocio.
        throw new ForbiddenException(
          'Tu tarjeta de este convenio está desactivada. Habla con tu empresa.',
        );
      }
      if (!previa.passId) {
        // Caso raro: la tarjeta existe pero se quedó sin pase (una fusión de
        // clientes pudo dejarlo en null). Se le emite uno nuevo en vez de
        // devolverle una tarjeta que no se puede escanear.
        const card = await this.plantilla(tenant.id, convenio);
        const pass = await this.emitirPase(tenant.id, card.id, customer.id);
        await this.prisma.convenioTarjeta.update({
          where: { id: previa.id },
          data: { passId: pass.id },
        });
        return { passId: pass.id, customerId: customer.id, isNew: false };
      }
      return { passId: previa.passId, customerId: customer.id, isNew: false };
    }

    // ── Verificación ──
    await this.verificar(convenio, dto, documento, email, phoneNorm);

    // ── Documento único dentro del convenio ──
    // Se comprueba aquí para dar un mensaje humano, pero quien MANDA es el
    // índice único parcial de la base: esto solo es leer-decidir-escribir y dos
    // envíos a la vez lo atraviesan. Por eso abajo se captura el P2002.
    const conEseDocumento = await this.prisma.convenioTarjeta.findFirst({
      where: { convenioId: convenio.id, documento },
      select: { id: true },
    });
    if (conEseDocumento) {
      throw new BadRequestException(
        'Ya existe una tarjeta de este convenio con ese documento. Si es tuya y cambiaste de teléfono, escríbele al negocio.',
      );
    }

    // ── Emisión ──
    // El pase se crea ANTES que la tarjeta y fuera de la transacción. Si la
    // creación de la tarjeta pierde la carrera del documento, queda un pase
    // suelto — y es a propósito: ese pase es exactamente el que esa misma
    // persona reutilizaría al reintentar (`emitirPase` lo devuelve), no se
    // puede escanear como convenio mientras no exista su `ConvenioTarjeta`
    // («Esta tarjeta no es de un convenio»), y `cleanupOrphanStampsPass` tiene
    // prohibido borrarlo. Nada se filtra y nada se pierde.
    const card = await this.plantilla(tenant.id, convenio);
    const pass = await this.emitirPase(tenant.id, card.id, customer.id);

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.convenioTarjeta.create({
          data: {
            convenioId: convenio.id,
            customerId: customer.id,
            passId: pass.id,
            documento,
            origen: dto.via?.slice(0, 40) ?? null,
            dataPolicyAcceptedAt: ahora,
            dataPolicyUrl: tenant.dataPolicyUrl || '/legal/tratamiento-datos',
          },
        });
        // Marcar la fila de la lista blanca DENTRO de la misma transacción: si
        // se marcara fuera y la creación fallara, el cupo quedaría gastado sin
        // tarjeta y esa persona no podría volver a entrar.
        if (convenio.verificacion === 'LISTA') {
          await tx.convenioListaBlanca.updateMany({
            where: {
              convenioId: convenio.id,
              usedAt: null,
              OR: [
                ...(documento ? [{ documento }] : []),
                ...(email ? [{ email }] : []),
              ],
            },
            data: { usedAt: ahora },
          });
        }
      });
    } catch (e: any) {
      // P2002: otro envío simultáneo ganó (mismo cliente o mismo documento).
      // Devolvemos lo que creó el ganador en vez de un 500, igual que hace el
      // alta normal desde que costó un incidente en producción.
      if (e?.code === 'P2002') {
        const ganadora = await this.prisma.convenioTarjeta.findUnique({
          where: {
            convenioId_customerId: {
              convenioId: convenio.id,
              customerId: customer.id,
            },
          },
        });
        if (ganadora?.passId) {
          return { passId: ganadora.passId, customerId: customer.id, isNew: false };
        }
        throw new BadRequestException(
          'Ya existe una tarjeta de este convenio con ese documento.',
        );
      }
      throw e;
    }

    this.logger.log(
      `Alianza ${convenio.slug} · tarjeta nueva para customer ${customer.id} (origen ${dto.via ?? 'directo'})`,
    );
    return { passId: pass.id, customerId: customer.id, isNew: true };
  }

  // ────────────────────────────── Piezas ──────────────────────────────

  /**
   * Verifica que quien activa pertenece a la empresa aliada.
   *
   * Hasta ahora no se comprobaba nada: `Convenio.codigo` se guardaba y se
   * editaba pero no se leía jamás, y `ConvenioListaBlanca` no tenía ni una
   * referencia en el código. Los tres modos existían solo en el enum.
   */
  private async verificar(
    convenio: { id: string; verificacion: string; codigo: string | null },
    dto: ActivacionDto,
    documento: string,
    email: string | null,
    phone: string,
  ) {
    if (convenio.verificacion === 'ABIERTO') return;

    if (convenio.verificacion === 'CODIGO') {
      const esperado = normalizarCodigo(convenio.codigo);
      if (!esperado) {
        // Un convenio en modo CODIGO sin código tendría la puerta abierta de
        // par en par sin que nadie se diera cuenta. Se cierra, no se abre.
        this.logger.error(
          `Convenio ${convenio.id} está en modo CODIGO pero no tiene código — activación rechazada`,
        );
        throw new BadRequestException(
          'Este convenio no está listo todavía. Avísale al negocio.',
        );
      }
      const clave = `${convenio.id}:${phone}`;
      this.assertPuedeIntentar(clave);
      if (normalizarCodigo(dto.codigo) !== esperado) {
        this.anotarFallo(clave);
        throw new BadRequestException(
          'Ese código no corresponde a este convenio. Pídele el código vigente a tu empresa.',
        );
      }
      this.intentos.delete(clave);
      return;
    }

    // LISTA: el aliado cargó documentos o correos. Se busca por documento y, si
    // no casa, por correo.
    const fila = await this.prisma.convenioListaBlanca.findFirst({
      where: {
        convenioId: convenio.id,
        OR: [{ documento }, ...(email ? [{ email }] : [])],
      },
    });
    if (!fila) {
      // Mensaje neutro: no se revela si el documento está o no en la lista.
      throw new ForbiddenException(
        'No encontramos tu documento en la lista de tu empresa. Si crees que es un error, habla con recursos humanos.',
      );
    }
    if (fila.usedAt) {
      // Aquí SÍ se revela, a propósito: si alguien usó tu cupo, quieres
      // enterarte. Es una alerta de suplantación, no una fuga.
      throw new ForbiddenException(
        'Ese cupo ya fue utilizado. Si tú no activaste esta tarjeta, avisa a tu empresa.',
      );
    }
  }

  private assertPuedeIntentar(clave: string) {
    const v = this.intentos.get(clave);
    if (v && v.n >= MAX_INTENTOS && v.hasta > Date.now()) {
      throw new ForbiddenException(
        'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.',
      );
    }
  }

  private anotarFallo(clave: string) {
    const v = this.intentos.get(clave);
    const vigente = v && v.hasta > Date.now();
    this.intentos.set(clave, {
      n: vigente ? v!.n + 1 : 1,
      hasta: Date.now() + VENTANA_INTENTOS_MS,
    });
    // Poda barata: sin esto el mapa crece sin techo en un proceso longevo.
    if (this.intentos.size > 5000) {
      const ahora = Date.now();
      for (const [k, val] of this.intentos) {
        if (val.hasta <= ahora) this.intentos.delete(k);
      }
    }
  }

  /**
   * Match-or-create del cliente por teléfono.
   *
   * Copiado de `enrollPublic`, incluido el match por los últimos 10 dígitos:
   * la misma persona vuelve con el número en otro formato (con o sin +57) y no
   * hay que duplicarla. Si ya es cliente del negocio con tarjeta de sellos, es
   * el MISMO `Customer` — lo que va aparte son la `Card` y el `Pass`.
   */
  private async buscarOCrearCliente(
    tenantId: string,
    fullName: string,
    phone: string,
    email: string | null,
  ) {
    const last10 = phone.replace(/\D/g, '').slice(-10);
    let customer = await this.prisma.customer
      .findUnique({ where: { tenantId_phone: { tenantId, phone } } })
      .catch(() => null);
    if (!customer && last10.length >= 8) {
      customer = await this.prisma.customer
        .findFirst({ where: { tenantId, phone: { endsWith: last10 } } })
        .catch(() => null);
    }
    if (customer) {
      if (email && !customer.email) {
        customer = await this.prisma.customer.update({
          where: { id: customer.id },
          data: { email },
        });
      }
      return customer;
    }
    try {
      return await this.prisma.customer.create({
        data: { tenantId, fullName, phone, email: email ?? undefined },
      });
    } catch (e: any) {
      // Dos envíos simultáneos del mismo teléfono: el segundo relee el que
      // creó el primero. Sin esto es un 500 en la cara del cliente.
      if (e?.code === 'P2002') {
        const ganador = await this.prisma.customer.findUnique({
          where: { tenantId_phone: { tenantId, phone } },
        });
        if (ganador) return ganador;
      }
      throw e;
    }
  }

  /**
   * La plantilla de pase del convenio: un `Card` normal del negocio marcado con
   * `convenioId`, que es lo que el escáner lee para desviarse.
   *
   * Se crea perezosamente con la primera tarjeta, como dice el esquema
   * («vacío hasta que se emite la primera tarjeta»). `type: 'STAMPS'` por lo
   * mismo que la tarjeta de club: toda la maquinaria de billetera —render,
   * push, geolocalización— opera sobre pases de sellos y así se hereda sin
   * código nuevo. Los resolutores de «primera tarjeta de sellos del negocio»
   * filtran `convenioId: null` para no confundirla con la de fidelización.
   */
  private async plantilla(
    tenantId: string,
    convenio: { id: string; name: string; logoUrl: string | null },
  ) {
    const existente = await this.prisma.card.findFirst({
      where: { tenantId, convenioId: convenio.id },
    });
    if (existente) return existente;
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        brandName: true,
        primaryColor: true,
        secondaryColor: true,
        logoUrl: true,
      },
    });
    return this.prisma.card.create({
      data: {
        tenantId,
        convenioId: convenio.id,
        name: `Convenio ${convenio.name}`,
        type: 'STAMPS',
        // Los colores DEL NEGOCIO, explícitos. `Card.primaryColor` trae por
        // defecto el verde de Clubify (#22C55E), así que no escribirlos dejaría
        // la tarjeta de una marca blanca pintada con el color de la plataforma
        // — y esta `Card` se crea una sola vez y se queda, así que el primer
        // empleado que active la fija para siempre.
        primaryColor: tenant?.primaryColor ?? undefined,
        secondaryColor: tenant?.secondaryColor ?? undefined,
        // La tarjeta de alianza no cuenta nada: es un vale permanente. Se pone
        // 1 porque la columna es opcional pero el render de sellos cae al
        // default 10 si va en null, y «0 / 10» encima de un descuento del 15%
        // no significa nada para nadie.
        stampsRequired: 1,
        rewardText: `Beneficios de ${convenio.name}`,
        businessName: tenant?.brandName ?? '',
        // El logo del ALIADO manda en su tarjeta; si no cargó ninguno, el del
        // negocio. Nunca uno de la plataforma.
        logoUrl: convenio.logoUrl ?? tenant?.logoUrl ?? null,
        isActive: true,
      },
    });
  }

  private async emitirPase(tenantId: string, cardId: string, customerId: string) {
    try {
      return await this.prisma.pass.create({
        data: {
          tenantId,
          cardId,
          customerId,
          serialNumber: `CLB-${nanoid(10).toUpperCase()}`,
          qrToken: genQrToken(),
          authToken: nanoid(32),
        },
      });
    } catch (e: any) {
      if (e?.code === 'P2002') {
        const previo = await this.prisma.pass.findUnique({
          where: { cardId_customerId: { cardId, customerId } },
        });
        if (previo) return previo;
      }
      throw e;
    }
  }
}
