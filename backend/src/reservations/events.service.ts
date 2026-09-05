import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AttendeeStatus, EventStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { GrowBusinessService } from '../integrations/grow-business.service';

export type EventDto = {
  name: string;
  description?: string;
  coverImageUrl?: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  capacity: number;
  price?: number | null;
  priceCurrency?: string;
  status?: EventStatus;
  locationId?: string | null;
};

export type AttendeeDto = {
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  party?: number;
  notes?: string;
  status?: AttendeeStatus;
};

@Injectable()
export class EventsService {
  private logger = new Logger(EventsService.name);
  constructor(
    private prisma: PrismaService,
    private growBusiness: GrowBusinessService,
  ) {}

  private tid(user: AuthUser, override?: string) {
    if (user.role === 'SUPER_ADMIN') {
      if (!override) throw new ForbiddenException('tenantId required');
      return override;
    }
    if (!user.tenantId) throw new ForbiddenException();
    return user.tenantId;
  }

  // ============================================================
  //                          EVENTS
  // ============================================================

  list(user: AuthUser, filters: { status?: EventStatus; from?: string; to?: string; locationId?: string } = {}, override?: string) {
    const tid = this.tid(user, override);
    const where: any = { tenantId: tid };
    if (filters.status) where.status = filters.status;
    if (filters.locationId) where.locationId = filters.locationId;
    if (filters.from || filters.to) {
      where.date = {};
      if (filters.from) {
        const [y, m, d] = filters.from.split('-').map(Number);
        where.date.gte = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
      }
      if (filters.to) {
        const [y, m, d] = filters.to.split('-').map(Number);
        where.date.lte = new Date(Date.UTC(y, m - 1, d, 23, 59, 59));
      }
    }
    return this.prisma.reservationEvent.findMany({
      where,
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
      include: {
        location: { select: { id: true, name: true } },
        _count: { select: { attendees: true } },
      },
    });
  }

  async get(user: AuthUser, id: string) {
    const event = await this.prisma.reservationEvent.findUnique({
      where: { id },
      include: {
        location: true,
        attendees: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!event) throw new NotFoundException('Evento no encontrado');
    if (user.role !== 'SUPER_ADMIN' && event.tenantId !== user.tenantId) {
      throw new ForbiddenException();
    }
    // Cómputo del cupo restante
    const occupied = event.attendees
      .filter((a) => ['CONFIRMED', 'CHECKED_IN'].includes(a.status))
      .reduce((s, a) => s + a.party, 0);
    return {
      ...event,
      remaining: Math.max(0, event.capacity - occupied),
      occupied,
    };
  }

  async create(user: AuthUser, dto: EventDto, override?: string) {
    const tid = this.tid(user, override);
    this.validateDto(dto);
    const [y, m, d] = dto.date.split('-').map(Number);
    return this.prisma.reservationEvent.create({
      data: {
        tenantId: tid,
        locationId: dto.locationId ?? null,
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        coverImageUrl: dto.coverImageUrl?.trim() || null,
        date: new Date(Date.UTC(y, m - 1, d, 12, 0, 0)),
        startTime: dto.startTime,
        endTime: dto.endTime,
        capacity: dto.capacity,
        price: dto.price !== null && dto.price !== undefined ? new Prisma.Decimal(dto.price) : null,
        priceCurrency: dto.priceCurrency ?? 'MXN',
        status: dto.status ?? 'DRAFT',
      },
    });
  }

  async update(user: AuthUser, id: string, patch: Partial<EventDto>) {
    const existing = await this.prisma.reservationEvent.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException();
    if (user.role !== 'SUPER_ADMIN' && existing.tenantId !== user.tenantId) {
      throw new ForbiddenException();
    }
    const data: any = {
      name: patch.name?.trim(),
      description: patch.description?.trim(),
      coverImageUrl: patch.coverImageUrl?.trim(),
      startTime: patch.startTime,
      endTime: patch.endTime,
      capacity: patch.capacity,
      priceCurrency: patch.priceCurrency,
      status: patch.status,
      locationId: patch.locationId === null ? null : patch.locationId,
    };
    if (patch.price !== undefined) {
      data.price = patch.price === null ? null : new Prisma.Decimal(patch.price);
    }
    if (patch.date) {
      const [y, m, d] = patch.date.split('-').map(Number);
      data.date = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    }
    return this.prisma.reservationEvent.update({ where: { id }, data });
  }

  async remove(user: AuthUser, id: string) {
    const existing = await this.prisma.reservationEvent.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException();
    if (user.role !== 'SUPER_ADMIN' && existing.tenantId !== user.tenantId) {
      throw new ForbiddenException();
    }
    await this.prisma.reservationEvent.delete({ where: { id } });
    return { ok: true };
  }

  // ============================================================
  //                          ATTENDEES
  // ============================================================

  async addAttendee(user: AuthUser, eventId: string, dto: AttendeeDto) {
    const event = await this.prisma.reservationEvent.findUnique({
      where: { id: eventId },
      include: { attendees: true },
    });
    if (!event) throw new NotFoundException('Evento no encontrado');
    if (user.role !== 'SUPER_ADMIN' && event.tenantId !== user.tenantId) {
      throw new ForbiddenException();
    }
    if (!dto.customerName?.trim()) throw new BadRequestException('Nombre requerido');
    if (!dto.customerPhone?.trim()) throw new BadRequestException('Teléfono requerido');
    const party = dto.party ?? 1;
    if (party < 1) throw new BadRequestException('party >= 1');

    // Chequeo de capacidad
    const occupied = event.attendees
      .filter((a) => ['CONFIRMED', 'CHECKED_IN'].includes(a.status))
      .reduce((s, a) => s + a.party, 0);
    if (occupied + party > event.capacity) {
      throw new ConflictException(
        `Solo quedan ${Math.max(0, event.capacity - occupied)} cupos disponibles`,
      );
    }

    // Customer lookup (sin crear si phone es placeholder)
    const phone = dto.customerPhone.trim();
    const isPlaceholder = !phone || phone.startsWith('walkin-') || phone.length < 5;
    let customerId: string | null = null;
    if (!isPlaceholder) {
      const existing = await this.prisma.customer.findUnique({
        where: { tenantId_phone: { tenantId: event.tenantId, phone } },
      });
      if (existing) {
        customerId = existing.id;
      } else {
        try {
          const c = await this.prisma.customer.create({
            data: {
              tenantId: event.tenantId,
              phone,
              fullName: dto.customerName.trim(),
              email: dto.customerEmail?.trim() || null,
              tags: ['evento'],
            },
          });
          customerId = c.id;
        } catch (e: any) {
          if (e?.code === 'P2002') {
            const c = await this.prisma.customer.findUnique({
              where: { tenantId_phone: { tenantId: event.tenantId, phone } },
            });
            customerId = c?.id ?? null;
          } else {
            throw e;
          }
        }
      }
    }

    return this.prisma.eventAttendee.create({
      data: {
        tenantId: event.tenantId,
        eventId,
        customerId,
        customerName: dto.customerName.trim(),
        customerPhone: phone,
        customerEmail: dto.customerEmail?.trim() || null,
        party,
        notes: dto.notes?.trim() || null,
        status: dto.status ?? 'CONFIRMED',
      },
    });
  }

  /**
   * Lo que ve el cliente al abrir el enlace del evento.
   *
   * Publico a proposito y por `id`: el enlace ES la invitacion, igual que el de
   * una tarjeta. No devuelve la lista de asistentes —quien mas va no es asunto
   * de quien entra—, solo cuantos cupos quedan.
   */
  async eventoPublico(eventId: string) {
    const e = await this.prisma.reservationEvent.findUnique({
      where: { id: eventId },
      include: {
        attendees: { select: { party: true, status: true } },
        tenant: {
          select: {
            name: true,
            brandName: true,
            logoUrl: true,
            primaryColor: true,
          },
        },
        location: { select: { name: true, address: true } },
      },
    });
    if (!e) throw new NotFoundException('Evento no encontrado');
    // Un borrador no se ensena: el negocio todavia lo esta armando. Uno
    // cancelado SI se ensena, pero diciendo que se cancelo — quien tenga el
    // enlace merece enterarse en vez de encontrarse un 404.
    if (e.status === 'DRAFT') throw new NotFoundException('Evento no encontrado');

    const ocupados = ocupacion(e.attendees);
    return {
      id: e.id,
      nombre: e.name,
      descripcion: e.description,
      portada: e.coverImageUrl,
      fecha: e.date,
      horaInicio: e.startTime,
      horaFin: e.endTime,
      precio: e.price ? Number(e.price) : null,
      moneda: e.priceCurrency,
      cancelado: e.status === 'CANCELLED',
      terminado: e.status === 'COMPLETED',
      capacidad: e.capacity,
      disponibles: Math.max(0, e.capacity - ocupados),
      sede: e.location
        ? { nombre: e.location.name, direccion: e.location.address }
        : null,
      negocio: {
        nombre: e.tenant.brandName || e.tenant.name,
        logoUrl: e.tenant.logoUrl,
        color: e.tenant.primaryColor,
      },
    };
  }

  /**
   * El cliente aparta su cupo desde el enlace del evento.
   *
   * La diferencia con `addAttendee` no es el formulario, es la CONCURRENCIA: en
   * el mostrador reserva una persona a la vez; por un enlace que se manda a un
   * grupo de WhatsApp entran treinta a la vez. Leer el cupo, decidir y escribir
   * sin bloquear reparte mas entradas que sillas hay, y eso el negocio lo
   * descubre en la puerta.
   *
   * Por eso la fila del evento se bloquea (`FOR UPDATE`) durante la
   * transaccion: las reservas simultaneas del MISMO evento se ponen en fila una
   * detras de otra. Eventos distintos no se estorban.
   */
  async reservarPublico(eventId: string, dto: AttendeeDto) {
    const nombre = dto.customerName?.trim();
    const telefono = dto.customerPhone?.replace(/\s+/g, ' ').trim();
    const party = dto.party ?? 1;
    if (!nombre) throw new BadRequestException('Escribe tu nombre.');
    if (!telefono || telefono.replace(/\D/g, '').length < 7) {
      throw new BadRequestException(
        'Escribe tu numero de WhatsApp para que el negocio pueda confirmarte.',
      );
    }
    if (!Number.isInteger(party) || party < 1 || party > 20) {
      throw new BadRequestException('Indica cuantas personas van (de 1 a 20).');
    }

    const evento = await this.prisma.reservationEvent.findUnique({
      where: { id: eventId },
      select: { id: true, tenantId: true, status: true, capacity: true },
    });
    if (!evento) throw new NotFoundException('Evento no encontrado');
    if (evento.status !== 'PUBLISHED') {
      throw new BadRequestException('Este evento no esta abierto a reservas.');
    }

    return this.prisma.$transaction(async (tx) => {
      // El candado. Nada de lo de abajo sirve sin esta linea.
      await tx.$queryRaw`SELECT id FROM "ReservationEvent" WHERE id = ${eventId} FOR UPDATE`;

      // Doble toque en el boton, o el cliente que abre el enlace dos veces: se
      // le devuelve la reserva que YA tiene en vez de restarle otro cupo.
      const yaEsta = await tx.eventAttendee.findFirst({
        where: {
          eventId,
          customerPhone: telefono,
          status: { in: ['CONFIRMED', 'CHECKED_IN'] },
        },
      });
      if (yaEsta) return { attendee: yaEsta, yaEstaba: true };

      const dentro = await tx.eventAttendee.findMany({
        where: { eventId, status: { in: ['CONFIRMED', 'CHECKED_IN'] } },
        select: { party: true, status: true },
      });
      const quedan = evento.capacity - ocupacion(dentro);
      if (party > quedan) {
        throw new ConflictException(
          quedan <= 0
            ? 'Se agotaron los cupos para este evento.'
            : `Solo quedan ${quedan} cupos y estas pidiendo ${party}.`,
        );
      }

      // Ficha del cliente: se busca por telefono y se crea si no existe, igual
      // que en el alta del mostrador. Asi el asistente queda en la base del
      // negocio y no solo en la lista del evento.
      let customerId: string | null = null;
      const existente = await tx.customer.findUnique({
        where: { tenantId_phone: { tenantId: evento.tenantId, phone: telefono } },
        select: { id: true },
      });
      if (existente) {
        customerId = existente.id;
      } else {
        try {
          const c = await tx.customer.create({
            data: {
              tenantId: evento.tenantId,
              phone: telefono,
              fullName: nombre,
              email: dto.customerEmail?.trim() || null,
              tags: ['evento'],
            },
            select: { id: true },
          });
          customerId = c.id;
        } catch (e: any) {
          // Alguien creo esa ficha entre la consulta y el insert.
          if (e?.code !== 'P2002') throw e;
          const c = await tx.customer.findUnique({
            where: {
              tenantId_phone: { tenantId: evento.tenantId, phone: telefono },
            },
            select: { id: true },
          });
          customerId = c?.id ?? null;
        }
      }

      const attendee = await tx.eventAttendee.create({
        data: {
          tenantId: evento.tenantId,
          eventId,
          customerId,
          customerName: nombre,
          customerPhone: telefono,
          customerEmail: dto.customerEmail?.trim() || null,
          party,
          notes: dto.notes?.trim() || null,
          status: 'CONFIRMED',
        },
      });
      return { attendee, yaEstaba: false };
    });
  }

  async updateAttendee(
    user: AuthUser,
    attendeeId: string,
    patch: Partial<AttendeeDto>,
  ) {
    const a = await this.prisma.eventAttendee.findUnique({ where: { id: attendeeId } });
    if (!a) throw new NotFoundException();
    if (user.role !== 'SUPER_ADMIN' && a.tenantId !== user.tenantId) {
      throw new ForbiddenException();
    }
    const data: any = {
      customerName: patch.customerName?.trim(),
      customerPhone: patch.customerPhone?.trim(),
      customerEmail: patch.customerEmail?.trim(),
      party: patch.party,
      notes: patch.notes?.trim(),
      status: patch.status,
    };
    if (patch.status === 'CHECKED_IN' && !a.checkInAt) {
      data.checkInAt = new Date();
    }
    return this.prisma.eventAttendee.update({ where: { id: attendeeId }, data });
  }

  async removeAttendee(user: AuthUser, attendeeId: string) {
    const a = await this.prisma.eventAttendee.findUnique({ where: { id: attendeeId } });
    if (!a) throw new NotFoundException();
    if (user.role !== 'SUPER_ADMIN' && a.tenantId !== user.tenantId) {
      throw new ForbiddenException();
    }
    await this.prisma.eventAttendee.delete({ where: { id: attendeeId } });
    return { ok: true };
  }

  private validateDto(dto: EventDto) {
    if (!dto.name?.trim()) throw new BadRequestException('Nombre requerido');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dto.date)) throw new BadRequestException('date YYYY-MM-DD');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(dto.startTime)) throw new BadRequestException('startTime HH:MM');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(dto.endTime)) throw new BadRequestException('endTime HH:MM');
    if (!dto.capacity || dto.capacity < 1) throw new BadRequestException('capacity >= 1');
  }
}

/**
 * Cuantas sillas hay ocupadas. Cuenta PERSONAS (`party`), no reservas: una
 * reserva de cuatro ocupa cuatro. Las canceladas y los no-show no ocupan.
 */
function ocupacion(
  attendees: Array<{ party: number; status: AttendeeStatus | string }>,
): number {
  return attendees
    .filter((a) => a.status === 'CONFIRMED' || a.status === 'CHECKED_IN')
    .reduce((n, a) => n + a.party, 0);
}
