import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { MktContactService } from '../marketing/mkt-contact.service';
import { MktEngineService } from '../marketing/mkt-engine.service';

/**
 * El puente entre el tablero de ventas y el motor de automatizaciones — fase 6.
 *
 * EL HUECO QUE CIERRA
 * -------------------
 * El motor inscribe **contactos de marketing**, no leads. Un lead que entra al
 * tablero con un teléfono que la marca no conocía **no tiene contacto**, así
 * que ningún disparador le llegaría nunca: el flujo se publicaría, se vería
 * bien en la pantalla y no se ejecutaría para nadie nuevo. Ese es el fallo
 * silencioso que este archivo evita.
 *
 * Aquí se garantiza el contacto ANTES de disparar. Se usa el `upsert` de
 * marketing y no un `create` propio: ese método pasa por `resolveContact`, que
 * es el ÚNICO sitio del producto que decide identidad. Crear a mano duplicaría
 * personas y rompería los índices únicos parciales de la marca.
 *
 * CREAR EL CONTACTO NO DISPARA «contacto nuevo»
 * --------------------------------------------
 * `upsert` no lanza `contact_created` — eso lo hace explícitamente el
 * controlador de marketing cuando alguien da de alta un contacto desde ahí. Es
 * lo que queremos: meter un lead en el tablero no puede colar a esa persona en
 * el flujo de bienvenida de la marca, que le hablaría como si se hubiera
 * suscrito a algo.
 *
 * Todo es best-effort y nada lanza: una automatización que falla no puede
 * tumbar el alta de un lead ni el movimiento de una tarjeta.
 */
@Injectable()
export class SalesAutomationsService {
  private logger = new Logger(SalesAutomationsService.name);

  constructor(
    private prisma: PrismaService,
    private contacts: MktContactService,
    private engine: MktEngineService,
  ) {}

  /**
   * Dispara un evento de ventas para un lead.
   *
   * Devuelve `true` si llegó a disparar, para las pruebas y el log.
   */
  async disparar(
    leadId: string,
    evento: string,
    extra: Record<string, string> = {},
  ): Promise<boolean> {
    try {
      const lead = await this.prisma.salesLead.findUnique({
        where: { id: leadId },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          company: true,
          whiteLabelId: true,
          mktContactId: true,
          salesTeamId: true,
          assignedUserId: true,
        },
      });
      if (!lead?.whiteLabelId) return false;

      const contactId = await this.contactoDe(lead);
      if (!contactId) return false;

      const ctx = { ...(await this.contexto(lead)), ...extra };
      await this.engine.fireTrigger(evento, contactId, lead.whiteLabelId, ctx);
      return true;
    } catch (e) {
      this.logger.warn(
        `[VENTAS] disparador ${evento} falló para el lead ${leadId}: ${(e as Error).message}`,
      );
      return false;
    }
  }

  /**
   * El contacto de marketing del lead, creándolo si hace falta.
   *
   * Sin correo ni teléfono no hay a quién escribir, así que tampoco hay
   * contacto que crear: devolver null aquí es más honesto que fabricar una
   * ficha vacía que ensucie la lista de la marca.
   */
  private async contactoDe(lead: {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    company: string | null;
    whiteLabelId: string | null;
    mktContactId: string | null;
  }): Promise<string | null> {
    if (lead.mktContactId) return lead.mktContactId;
    if (!lead.whiteLabelId) return null;
    if (!lead.email?.trim() && !lead.phone?.trim()) return null;

    const c = await this.contacts.upsert(lead.whiteLabelId, {
      name: lead.name,
      email: lead.email,
      phone: lead.phone,
      company: lead.company,
    });
    // Se guarda para no volver a resolver identidad en cada movimiento de la
    // tarjeta, que es lo que más veces pasa.
    await this.prisma.salesLead
      .update({ where: { id: lead.id }, data: { mktContactId: c.id } })
      .catch(() => null);
    return c.id;
  }

  /** Los campos de ventas que puede mirar la condición del disparador. */
  private async contexto(lead: {
    salesTeamId: string;
    assignedUserId: string | null;
  }): Promise<Record<string, string>> {
    const [equipo, vendedor] = await Promise.all([
      this.prisma.salesTeam.findUnique({
        where: { id: lead.salesTeamId },
        select: { name: true },
      }),
      lead.assignedUserId
        ? this.prisma.user.findUnique({
            where: { id: lead.assignedUserId },
            select: { fullName: true, email: true },
          })
        : Promise.resolve(null),
    ]);
    return {
      equipo: equipo?.name ?? '',
      vendedor: vendedor?.fullName?.trim() || vendedor?.email || '',
    };
  }
}
