import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { nanoid } from 'nanoid';
import { PrismaService } from '../common/prisma/prisma.service';
import { clubDelPase } from '../club/club-pase.util';
import { alianzaDelPase } from '../convenios/alianzas-pase.util';
import { AppConfigService } from '../common/config/app-config.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { AutomationsService } from '../automations/automations.service';
import { WhitelabelBrandService } from '../whitelabel/whitelabel-brand.service';
import { normalizePassLocale } from '../wallet/pass-labels';

/**
 * Token que va dentro del barcode (PDF417) del pase de wallet.
 *
 * FIX 2026-06-17: token corto, aleatorio e inforjable (~23 chars). Reemplaza
 * al JWT firmado del fix #1 (2026-06-16), que medía ~200 chars y dejaba el
 * PDF417 tan denso que costaba escanearlo. Un token aleatorio mantiene la
 * seguridad (no se puede adivinar; el scanner lo busca por `qrToken` @unique)
 * pero deja el código tan limpio como el modelo original con serial.
 */
export function genQrToken(): string {
  return `QR-${nanoid(20)}`;
}

@Injectable()
export class PassesService {
  constructor(
    private prisma: PrismaService,
    private automations: AutomationsService,
    private appConfig: AppConfigService,
    private brand: WhitelabelBrandService,
  ) {}

  private guardTenant(user: AuthUser, tenantId: string) {
    if (user.role !== 'SUPER_ADMIN' && user.tenantId !== tenantId) {
      throw new ForbiddenException();
    }
  }

  async issue(user: AuthUser, cardId: string, customerId: string) {
    const card = await this.prisma.card.findUnique({ where: { id: cardId } });
    if (!card) throw new NotFoundException('Card');
    this.guardTenant(user, card.tenantId);
    return this.issueInternal(cardId, customerId);
  }

  /** Emite un pass sin auth check — uso interno desde otros módulos
   *  (Reservations, automations, backfills). Misma lógica que issue()
   *  pero saltea guardTenant porque el caller ya validó el contexto. */
  async issueInternal(cardId: string, customerId: string) {
    const card = await this.prisma.card.findUnique({ where: { id: cardId } });
    if (!card) throw new NotFoundException('Card');

    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer || customer.tenantId !== card.tenantId) {
      throw new NotFoundException('Customer not in this tenant');
    }

    const existing = await this.prisma.pass.findUnique({
      where: { cardId_customerId: { cardId, customerId } },
    });
    if (existing) return existing;

    const serial = `CLB-${nanoid(10).toUpperCase()}`;
    const authToken = nanoid(32);
    const qrToken = genQrToken();

    let pass;
    try {
      pass = await this.prisma.pass.create({
        data: {
          tenantId: card.tenantId,
          cardId,
          customerId,
          serialNumber: serial,
          qrToken,
          authToken,
        },
      });
    } catch (e: any) {
      if (e?.code === 'P2002') {
        // Race con otro caller que creó el mismo pass — devolvemos el suyo.
        const winner = await this.prisma.pass.findUnique({
          where: { cardId_customerId: { cardId, customerId } },
        });
        if (winner) return winner;
      }
      throw e;
    }

    // Hook PASS_CREATED — dispara mensaje de bienvenida si hay regla activa.
    this.automations
      .emit('PASS_CREATED', {
        tenantId: card.tenantId,
        customerId,
        cardId,
        passId: pass.id,
        customerName: customer.fullName,
        cardName: card.name,
      })
      .catch(() => null);

    return pass;
  }

  async get(user: AuthUser, id: string) {
    const pass = await this.prisma.pass.findUnique({
      where: { id },
      include: { card: true, customer: true, tenant: true },
    });
    if (!pass) throw new NotFoundException('Pass');
    if (user.role !== 'SUPER_ADMIN' && pass.tenantId !== user.tenantId) {
      throw new ForbiddenException();
    }
    return pass;
  }

  async getPublic(id: string) {
    const pass = await this.prisma.pass.findUnique({
      where: { id },
      include: {
        card: true,
        customer: {
          select: {
            id: true,
            fullName: true,
            email: true,
            birthday: true,
            phone: true,
          },
        },
        tenant: {
          select: {
            brandName: true,
            logoUrl: true,
            primaryColor: true,
            // Marca blanca del negocio: el pase muestra "Hecho con {marca}".
            whiteLabelId: true,
          },
        },
      },
    });
    if (!pass) throw new NotFoundException('Pass');
    // Marca blanca del negocio (atribución/web/inicial). Nunca Clubify por
    // defecto: legacy sin marca cae al row real `clubify`.
    const b = await this.brand.resolveByWhiteLabelId(pass.tenant.whiteLabelId);
    // Tarjeta de CLUB. Sin esto, la página que el negocio le manda al socio
    // para instalarla la pintaba como un cartón de sellos: «SELLOS 7/10», con
    // el número contando lo contrario de lo que significa. Solo se consulta
    // cuando la tarjeta es de un plan; el resto no paga nada.
    const club = pass.card.clubPlanId
      ? await clubDelPase(this.prisma, pass.card.clubPlanId, pass.id)
      : null;
    // Lo mismo para la ALIANZA, y por el mismo motivo: sin esto la tarjeta web
    // caía al render de sellos y le enseñaba «SELLOS 0 / 1» al empleado — y es
    // justo la página que el negocio le manda para instalarla.
    const alianza = pass.card.convenioId
      ? await alianzaDelPase(this.prisma, pass.card.convenioId, pass.id)
      : null;
    // Qué le falta al socio por rellenar. Se mandan BANDERAS y no los datos:
    // la página es pública por `passId`, y aunque quien la abre sea el propio
    // cliente, devolver su correo permitiría leerlo con solo tener el enlace.
    //
    // El nombre cuenta como pendiente si no tiene ni una letra: el alta rápida
    // del club deja el teléfono como nombre —la base exige uno— y ese hay que
    // pedirlo de verdad.
    //
    // SOLO EN EL CLUB. El socio del club es el único que llega aquí sin haber
    // pasado por un formulario: se dio de alta en el mostrador con un dato. En
    // las demás tarjetas el cliente YA rellenó lo que su negocio le pidió —y lo
    // que no le pidió, no lo quiere—, así que ponerle una ficha delante le tapa
    // los botones de instalar, que es lo único que vino a hacer.
    const c = pass.customer;
    const registro = club
      ? {
          faltaNombre: !c?.fullName || !/\p{L}/u.test(c.fullName),
          faltaEmail: !c?.email?.trim(),
          faltaCumple: !c?.birthday,
        }
      : null;

    return {
      ...pass,
      // El cliente se recorta a lo que la página necesita pintar.
      customer: c ? { id: c.id, fullName: c.fullName } : null,
      registro,
      club,
      alianza,
      brand: {
        name: b.name,
        slug: b.slug,
        websiteUrl: b.websiteUrl,
        logoUrl: b.logoUrl,
        iconUrl: b.iconUrl,
        faviconUrl: b.faviconUrl,
        primaryColor: b.primaryColor,
        initial: b.initial,
        attribution: b.attribution,
      },
    };
  }

  /**
   * Búsqueda pública desde el storefront: dado un slug de tenant y un teléfono,
   * devuelve los pases activos del cliente. Usado por el tab "Mi tarjeta".
   * Normaliza el teléfono a últimos dígitos para tolerar variaciones de formato.
   */
  async findByPhonePublic(slug: string, phoneRaw: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { slug } });
    if (!tenant) throw new NotFoundException('Tenant');

    const digits = (phoneRaw || '').replace(/\D/g, '');
    if (digits.length < 7) {
      return { passes: [] };
    }

    const tail = digits.slice(-10);

    const customers = await this.prisma.customer.findMany({
      where: {
        tenantId: tenant.id,
        phone: { contains: tail },
      },
      select: { id: true, fullName: true },
    });

    if (customers.length === 0) return { passes: [] };

    const passes = await this.prisma.pass.findMany({
      where: {
        tenantId: tenant.id,
        customerId: { in: customers.map((c) => c.id) },
        status: 'ACTIVE',
      },
      include: {
        card: {
          select: {
            id: true,
            name: true,
            type: true,
            stampsRequired: true,
            primaryColor: true,
            // Sin esto la tienda no sabe que es de club y la pinta como un
            // cartón: «SELLOS 7/10», con el número contando lo contrario de lo
            // que significa. Es el mismo fallo que ya se corrigió en el pase de
            // Apple, en el de Google y en la página de instalación — este era
            // el cuarto sitio, y el que ve el cliente final.
            clubPlanId: true,
          },
        },
        customer: { select: { id: true, fullName: true } },
      },
      orderBy: { issuedAt: 'desc' },
    });

    // Los datos de club de TODOS los pases de club en una sola consulta. Uno
    // por pase sería un N+1 en una ruta pública que un cliente abre con varias
    // tarjetas; y son pocos, casi siempre cero.
    const idsDeClub = passes
      .filter((p) => p.card.clubPlanId)
      .map((p) => p.id);
    const membresias = idsDeClub.length
      ? await this.prisma.clubMembresia.findMany({
          where: { passId: { in: idsDeClub } },
          select: {
            passId: true,
            status: true,
            cupoDelPeriodo: true,
            plan: { select: { unidad: true, beneficiosPorMes: true } },
          },
        })
      : [];
    const clubPorPase = new Map(
      membresias.map((m) => [
        m.passId!,
        {
          unidad: m.plan.unidad,
          cupo: m.cupoDelPeriodo || m.plan.beneficiosPorMes,
          detenida: m.status !== 'ACTIVA',
        },
      ]),
    );

    return {
      passes: passes.map((p) => ({
        id: p.id,
        serialNumber: p.serialNumber,
        stampsCount: p.stampsCount,
        pointsBalance: Number(p.pointsBalance ?? 0),
        card: p.card,
        customer: p.customer,
        club: clubPorPase.get(p.id) ?? null,
      })),
    };
  }

  /**
   * El socio completa su registro desde la página de su propia tarjeta.
   *
   * Existe porque el club se da de alta desde el mostrador con un solo dato
   * —el teléfono— y ese cliente nunca pasa por el formulario que rellenan los
   * demás: se quedaba sin correo, sin cumpleaños y con el número por nombre.
   * Sin correo no le llega nada de lo que el negocio manda, y sin cumpleaños
   * se queda fuera de la automatización que más se usa.
   *
   * Es público por `passId`, igual que descargar el pase. Quien tiene ese
   * enlace ES el cliente: se lo acaba de mandar su negocio.
   *
   * Solo RELLENA huecos, nunca pisa lo que ya había: si el negocio ya le puso
   * el correo, el cliente no puede cambiárselo desde aquí — eso se pide en el
   * mostrador, y así un enlace reenviado no puede secuestrar una ficha.
   */
  async completarRegistro(
    id: string,
    dto: { fullName?: string; email?: string; birthday?: string },
  ) {
    const pass = await this.prisma.pass.findUnique({
      where: { id },
      select: {
        customer: {
          select: { id: true, fullName: true, email: true, birthday: true },
        },
      },
    });
    if (!pass?.customer) throw new NotFoundException('Pass');
    const c = pass.customer;

    const nombre = dto.fullName?.trim();
    const correo = dto.email?.trim().toLowerCase();
    const sinNombreDeVerdad = !c.fullName || !/\p{L}/u.test(c.fullName);

    const data: {
      fullName?: string;
      email?: string;
      birthday?: Date;
    } = {};
    if (sinNombreDeVerdad && nombre && /\p{L}/u.test(nombre)) {
      data.fullName = nombre.slice(0, 80);
    }
    if (!c.email?.trim() && correo && /.+@.+\..+/.test(correo)) {
      data.email = correo.slice(0, 160);
    }
    if (!c.birthday && dto.birthday) {
      const d = new Date(dto.birthday);
      if (!Number.isNaN(d.getTime())) data.birthday = d;
    }

    if (Object.keys(data).length) {
      await this.prisma.customer.update({ where: { id: c.id }, data });
    }
    return { ok: true, actualizados: Object.keys(data) };
  }

  /**
   * Auto-enrollment público: el cliente final escanea el QR genérico de la
   * tarjeta, llena form (nombre + email + teléfono con código país) y queda
   * con un pase emitido. Si ya tiene pase para esta tarjeta, lo retorna sin
   * crear duplicado (match por teléfono normalizado).
   */
  async enrollPublic(
    cardId: string,
    dto: {
      fullName: string;
      email?: string;
      phone: string;
      birthday?: string;
      utmSlug?: string;
      locale?: string;
      // PDF Software(8): el cliente marcó la casilla de políticas de datos.
      dataPolicyAccepted?: boolean;
    },
  ) {
    const localeNorm = normalizePassLocale(dto.locale);
    const card = await this.prisma.card.findUnique({
      where: { id: cardId },
      include: {
        tenant: {
          select: {
            id: true,
            status: true,
            dataPolicyUrl: true,
            whiteLabelId: true,
          },
        },
      },
    });
    if (!card || !card.isActive)
      throw new NotFoundException('Tarjeta no disponible');
    if (card.tenant.status === 'SUSPENDED')
      throw new NotFoundException('Negocio no disponible');

    // La tarjeta de un plan de club no se reparte por QR público: el club se
    // paga y el negocio da de alta a mano. Quien se enrolaba aquí recibía un
    // pase SIN membresía, y al escanearlo el club respondía «esta tarjeta no
    // es de un club» — el cajero leía que el escáner estaba roto.
    if (card.clubPlanId) {
      throw new NotFoundException('Tarjeta no disponible');
    }

    // Ni la de una ALIANZA, y aquí es peor que una molestia: esta puerta se
    // salta el documento, el código de la empresa y la lista blanca. Cualquiera
    // con el enlace `/c/<cardId>` se emitía la tarjeta del convenio sin
    // pertenecer a la empresa. Y encima nacía sin `ConvenioTarjeta`, así que en
    // caja respondía «esta tarjeta no es de un convenio» y el cajero leía que
    // el escáner estaba roto. Su alta es `/alianza/<negocio>/<empresa>`.
    if (card.convenioId) {
      throw new NotFoundException('Tarjeta no disponible');
    }

    // Sellea: correo y cumpleaños son OBLIGATORIOS en el registro de la tarjeta
    // (decisión del dueño, 2026-08-30). Defensa en profundidad: el formulario
    // ya lo valida, pero acá lo exigimos para que un POST directo no lo evada.
    // SOLO Sellea — el resto de marcas mantiene ambos campos opcionales.
    const brand = await this.brand.resolveByWhiteLabelId(
      card.tenant.whiteLabelId,
    );
    const requireContactFields =
      brand.slug === 'sellea' || brand.slug === 'selleala';
    if (requireContactFields) {
      if (!dto.email?.trim()) {
        throw new BadRequestException('El correo electrónico es obligatorio');
      }
      const bday = dto.birthday ? new Date(dto.birthday) : null;
      if (!bday || Number.isNaN(bday.getTime())) {
        throw new BadRequestException('La fecha de cumpleaños es obligatoria');
      }
    }

    const phoneNorm = (dto.phone || '').replace(/\s/g, '').trim();
    if (phoneNorm.length < 8) {
      throw new ForbiddenException('Teléfono inválido');
    }

    const email = dto.email?.trim().toLowerCase() || null;

    // Match-or-create customer por teléfono. Primero match EXACTO (rápido, usa
    // el índice único). Si no, match por los ÚLTIMOS 10 DÍGITOS para no
    // duplicar al cliente cuando vuelve con el número en otro formato (con/sin
    // +57, con/sin código de país). Así, si ya tenía tarjeta y la borró del
    // wallet, al reinstalar recupera SU pase con los sellos que tenía (el Pass
    // nunca se borra; abajo se devuelve el existente).
    const last10 = phoneNorm.replace(/\D/g, '').slice(-10);
    let customer = await this.prisma.customer
      .findUnique({
        where: { tenantId_phone: { tenantId: card.tenantId, phone: phoneNorm } },
      })
      .catch(() => null);
    if (!customer && last10.length >= 8) {
      customer = await this.prisma.customer
        .findFirst({
          where: { tenantId: card.tenantId, phone: { endsWith: last10 } },
        })
        .catch(() => null);
    }
    // Birthday: aceptamos YYYY-MM-DD. El año es ficticio (2000), solo
    // usamos día/mes para el cron BIRTHDAY que filtra por extract().
    const birthdayDate = dto.birthday ? new Date(dto.birthday) : null;
    const validBday =
      birthdayDate && !Number.isNaN(birthdayDate.getTime()) ? birthdayDate : null;

    if (!customer) {
      // HOTFIX 2026-06-05 (bug D): el match-or-create de customer no
      // estaba en transacción. Dos POST simultáneos del mismo teléfono
      // pasaban ambos por el findUnique → ambos llegaban al create →
      // uno tiraba P2002 sin handler → 500 al cliente. Con el catch
      // P2002 re-leemos el customer existente (lo creó el otro request)
      // y seguimos con ese.
      try {
        customer = await this.prisma.customer.create({
          data: {
            tenantId: card.tenantId,
            fullName: dto.fullName.trim(),
            phone: phoneNorm,
            email: email ?? undefined,
            birthday: validBday ?? undefined,
            locale: localeNorm,
          },
        });
      } catch (e: any) {
        if (e?.code === 'P2002') {
          customer = await this.prisma.customer.findUnique({
            where: {
              tenantId_phone: { tenantId: card.tenantId, phone: phoneNorm },
            },
          });
          if (!customer) throw e;
        } else {
          throw e;
        }
      }
    } else if (
      customer.fullName !== dto.fullName.trim() ||
      (email && !customer.email) ||
      (validBday && !customer.birthday) ||
      (customer as { locale?: string }).locale !== localeNorm
    ) {
      // Actualizar nombre si cambió, email si lo deja por primera vez,
      // birthday si lo deja por primera vez (no sobreescribe si ya estaba),
      // y el idioma al que el cliente eligió ahora (para localizar el pase).
      customer = await this.prisma.customer.update({
        where: { id: customer.id },
        data: {
          fullName: dto.fullName.trim(),
          email: email ?? customer.email,
          birthday: validBday ?? customer.birthday,
          locale: localeNorm,
        },
      });
    }

    // Si ya tiene pase para esta tarjeta, devolverlo (no duplicar)
    const existing = await this.prisma.pass.findUnique({
      where: { cardId_customerId: { cardId, customerId: customer.id } },
    });
    if (existing) {
      return { passId: existing.id, customerId: customer.id, isNew: false };
    }

    // Aplicamos bonus de bienvenida si vino vía link UTM con bonus activo.
    let bonusStamps = 0;
    let bonusPoints = 0;
    if (dto.utmSlug) {
      const utm = await this.prisma.cardUtmLink.findUnique({
        where: { slug: dto.utmSlug },
      });
      if (utm && utm.cardId === cardId) {
        const bonusActive =
          !utm.bonusExpiresAt || utm.bonusExpiresAt.getTime() > Date.now();
        if (bonusActive) {
          bonusStamps = utm.welcomeStamps ?? 0;
          bonusPoints = utm.welcomePoints ? Number(utm.welcomePoints) : 0;
          await this.prisma.cardUtmLink.update({
            where: { id: utm.id },
            data: { useCount: { increment: 1 } },
          });
        }
      }
    }

    // Crear pass nuevo (mismo flujo que issue() pero sin auth check).
    // Mismo handler P2002 que customer.create: si dos enrollments
    // simultáneos pasan por el findUnique y ambos llegan al create, el
    // 2do tira P2002 — devolvemos el pass que creó el primero.
    const serial = `CLB-${nanoid(10).toUpperCase()}`;
    const authToken = nanoid(32);
    // PDF Software(8): evidencia de aceptación de la política de tratamiento de
    // datos. Solo si la tarjeta tiene la casilla activa y el cliente la marcó.
    // Guardamos la URL exacta del documento que se le mostró (doc del negocio
    // o el default brand-aware /legal/privacy) + el timestamp.
    const dataPolicyAccepted =
      card.dataPolicyEnabled && dto.dataPolicyAccepted === true;
    const dataPolicyAcceptedAt = dataPolicyAccepted ? new Date() : null;
    const dataPolicyUrlShown = dataPolicyAccepted
      ? card.tenant.dataPolicyUrl || '/legal/tratamiento-datos'
      : null;
    let tmp;
    try {
      tmp = await this.prisma.pass.create({
        data: {
          tenantId: card.tenantId,
          cardId,
          customerId: customer.id,
          serialNumber: serial,
          qrToken: genQrToken(),
          authToken,
          stampsCount: bonusStamps,
          pointsBalance: bonusPoints,
          dataPolicyAcceptedAt,
          dataPolicyUrl: dataPolicyUrlShown,
        },
      });
    } catch (e: any) {
      if (e?.code === 'P2002') {
        const winner = await this.prisma.pass.findUnique({
          where: { cardId_customerId: { cardId, customerId: customer.id } },
        });
        if (winner) {
          return { passId: winner.id, customerId: customer.id, isNew: false };
        }
      }
      throw e;
    }

    // Hook PASS_CREATED — dispara el mensaje de bienvenida (automatización).
    // BUG PDF734: la auto-inscripción del storefront (enrollPublic) es el
    // camino REAL del cliente y NO emitía el evento → la regla "Bienvenida"
    // marcaba 0 ejecuciones y el push nunca llegaba (Android e iOS). Solo en
    // pase NUEVO: los existentes ya hicieron return arriba (no re-saludar en
    // reinstalaciones).
    this.automations
      .emit('PASS_CREATED', {
        tenantId: card.tenantId,
        customerId: customer.id,
        cardId,
        passId: tmp.id,
        customerName: customer.fullName,
        cardName: card.name,
      })
      .catch(() => null);

    return { passId: tmp.id, customerId: customer.id, isNew: true };
  }

  /**
   * Demo wallet flow — el prospect entra a /demo-wallet, completa nombre +
   * whatsapp, y recibe un pase real para su iPhone/Android. Internamente
   * reusa enrollPublic con la card configurada via Setting `demo.cardId`.
   *
   * Pensado para que afiliados/embajadores compartan el link y el prospect
   * tenga un "aha moment" de tener la tarjeta de fidelización Clubify en
   * SU teléfono — sin que el negocio tenga que hacer setup.
   */
  async enrollDemoWallet(dto: {
    fullName: string;
    phone: string;
    email?: string;
    ref?: string;
  }) {
    const setting = await this.prisma.setting.findUnique({
      where: { key: 'demo.cardId' },
    });
    const demoCardId = setting?.value?.trim();
    if (!demoCardId) {
      throw new ServiceUnavailableException(
        'El modo demo no está configurado todavía. Pídele al super admin que asigne una tarjeta demo desde el panel.',
      );
    }
    // Pasamos el ref como utmSlug para que enrollPublic lo guarde como
    // atribución del customer creado. Si después ese prospect compra
    // Clubify, podemos hacer follow-up al afiliado que lo trajo.
    const result = await this.enrollPublic(demoCardId, {
      fullName: dto.fullName,
      phone: dto.phone,
      email: dto.email,
      utmSlug: dto.ref,
    });
    return { ...result, cardId: demoCardId };
  }

  list(user: AuthUser, tenantId?: string, locationId?: string) {
    const tid = user.role === 'SUPER_ADMIN' ? tenantId : user.tenantId ?? undefined;
    return this.prisma.pass.findMany({
      where: {
        ...(tid ? { tenantId: tid } : {}),
        ...(locationId ? { card: { locationId } } : {}),
      },
      include: { card: true, customer: true },
      orderBy: { issuedAt: 'desc' },
      take: 200,
    });
  }
}
