import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { phoneKeyOf } from '../marketing/identity';
import { MktProviderService } from '../marketing/provider/mkt-provider.service';
import { exigirEscritura, moduloEncendido, resolveTeamAccess } from './team-access';
import { asegurarColumnas } from './sales-columnas';
import { leerAjustes } from './configuracion-de-equipo';

/**
 * La conversación con un lead — fase 5.
 *
 * Lo que faltaba no era saber QUIÉN escribe: el webhook de GoHighLevel ya
 * resolvía el teléfono desde la fase de marketing. Lo que faltaba era guardar
 * QUÉ dijo. Sin eso, el vendedor veía «respondió» y tenía que salir a
 * GoHighLevel a enterarse del resto.
 *
 * TRES DECISIONES QUE NO SON OBVIAS
 * ---------------------------------
 * 1. **Un mensaje entrante se guarda en TODOS los leads que casen**, no en uno.
 *    La misma persona puede estar trabajada por dos equipos de la misma marca
 *    —es legal, y por eso el índice `[whiteLabelId, phoneKey]` de `SalesLead`
 *    no es único—. Guardarlo solo en el «más reciente» dejaría al otro equipo
 *    creyendo que nunca contestó.
 *
 * 2. **Se deduplica por `providerMessageId`.** GoHighLevel reintenta cuando
 *    tarda la respuesta, y sin esto el mismo «sí me interesa» sale tres veces
 *    en la conversación.
 *
 * 3. **Un lead que se dio de baja no recibe nada.** El opt-out vive en
 *    `MktContact` y es de la persona, no del canal: respetarlo solo en las
 *    campañas y saltárselo en el chat es la forma de que una queja legal entre
 *    por la puerta de al lado.
 */

/** Cuántos mensajes se pintan en la ficha. Más no cabe ni se lee. */
const TOPE_HISTORIAL = 200;

/** Un SMS de verdad no llega a esto; el tope evita un cuerpo absurdo. */
const MAX_SMS = 1200;

/** Contactos NUEVOS que el webhook puede crear por marca y hora. */
const TOPE_DESCONOCIDOS_POR_HORA = 30;

/** Lo que se guarda del teléfono que llega en un payload ajeno. */
const MAX_TELEFONO = 40;

/**
 * Lo que ENTRA por el webhook.
 *
 * Vive en su propia clase, y con Prisma como única dependencia, por una razón
 * de fontanería que conviene dejar escrita: el webhook de marketing tiene que
 * llamar aquí, y este módulo ya importa el de marketing para poder ENVIAR. Si
 * las dos mitades vivieran juntas, los módulos se importarían en círculo y Nest
 * se niega a arrancar. Partirlo por «lo que entra» y «lo que sale» rompe el
 * ciclo sin `forwardRef`, que es la otra salida y envejece peor.
 */
@Injectable()
export class SalesInboxService {
  private logger = new Logger(SalesInboxService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Guarda un mensaje entrante en la conversación de cada lead que casa.
   *
   * Lo llama el webhook de marketing, en modo best-effort: si esto falla, el
   * webhook sigue reanudando automatizaciones igual. Nunca lanza.
   *
   * Devuelve cuántas conversaciones lo recibieron, para el log.
   */
  async guardarEntrante(entrada: {
    whiteLabelId: string;
    phone?: string | null;
    body?: string | null;
    providerMessageId?: string | null;
    canal?: string;
    /** false = solo se guarda en quien ya está en el tablero; no se crea ficha. */
    puedeCrear?: boolean;
  }): Promise<number> {
    try {
      const phoneKey = phoneKeyOf(entrada.phone);
      const texto = (entrada.body ?? '').trim();
      // Sin teléfono no hay a quién atribuirlo, y sin texto no hay nada que
      // enseñar: un «respondió» vacío ya lo cuenta la actividad del lead.
      if (!phoneKey || !texto) return 0;

      let leads = await this.prisma.salesLead.findMany({
        where: { whiteLabelId: entrada.whiteLabelId, phoneKey },
        select: { id: true, salesTeamId: true },
        take: 20,
      });
      if (!leads.length) {
        // QUIEN ESCRIBE SIN ESTAR EN EL TABLERO ENTRA COMO CONTACTO NUEVO.
        // Antes el mensaje se descartaba y el equipo no se enteraba de que
        // alguien había escrito: el contacto solo podía llegar reservando en la
        // agenda o a mano (decisión de Javier, 2026-09-15).
        if (entrada.puedeCrear === false) return 0;
        const creado = await this.crearDesconocido(entrada.whiteLabelId, phoneKey, entrada.phone);
        if (!creado) return 0;
        leads = [creado];
      }

      const providerMessageId = (entrada.providerMessageId ?? '').trim() || null;
      let guardados = 0;
      for (const lead of leads) {
        if (providerMessageId) {
          const repetido = await this.prisma.salesMessage.findFirst({
            where: { leadId: lead.id, providerMessageId },
            select: { id: true },
          });
          if (repetido) continue;
        }
        await this.prisma.salesMessage.create({
          data: {
            salesTeamId: lead.salesTeamId,
            leadId: lead.id,
            direction: 'in',
            channel: entrada.canal ?? 'sms',
            body: texto,
            providerMessageId,
            status: 'recibido',
          },
        });
        // Contestar ES actividad. Sin esto el lead parecía abandonado en el
        // tablero justo cuando acababa de dar señales de vida — que es el peor
        // momento para que un vendedor lo dé por perdido.
        await this.prisma.salesLead.update({
          where: { id: lead.id },
          data: { lastActivityAt: new Date() },
        });
        guardados++;
      }
      if (guardados) {
        this.logger.log(
          `[CHAT] entrante guardado en ${guardados} conversación(es) · marca=${entrada.whiteLabelId}`,
        );
      }
      return guardados;
    } catch (e) {
      this.logger.warn(`[CHAT] no se pudo guardar el entrante: ${(e as Error).message}`);
      return 0;
    }
  }

  /**
   * A qué equipo entra un desconocido que escribe.
   *
   * Manda el equipo marcado como bandeja en «Configuración». Si no hay ninguno
   * marcado y la marca tiene UN solo equipo activo, entra ahí: es lo que espera
   * cualquiera con un equipo. Con varios y ninguno marcado no se adivina
   * —repartir mal un contacto es peor que no crearlo— y queda el aviso en los
   * logs. Con el módulo apagado, nada: esa marca no usa equipos de ventas.
   */
  private async equipoQueRecibe(whiteLabelId: string): Promise<string | null> {
    if (!(await moduloEncendido(this.prisma, whiteLabelId))) return null;
    const equipos = await this.prisma.salesTeam.findMany({
      where: { whiteLabelId, isActive: true },
      select: { id: true, settings: true },
      orderBy: { createdAt: 'asc' },
    });
    const marcado = equipos.find((e) => leerAjustes(e.settings).recibeDesconocidos);
    if (marcado) return marcado.id;
    if (equipos.length === 1) return equipos[0].id;
    if (equipos.length > 1) {
      this.logger.warn(
        `[CHAT] la marca ${whiteLabelId} tiene ${equipos.length} equipos y ninguno marcado como bandeja: el desconocido no entra`,
      );
    }
    return null;
  }

  /**
   * Contactos creados por marca y hora. En memoria a propósito, como el tope del
   * webhook de marketing: es una mitigación, no contabilidad.
   *
   * Ese webhook es PÚBLICO y no verifica la firma del proveedor: con el slug de
   * la marca —que va en la URL y no es secreto— cualquiera podría crear fichas a
   * mansalva con números inventados (Fable, 2026-09-15). Pasado el tope se
   * siguen guardando los mensajes de quien YA está en el tablero; solo se deja
   * de crear.
   */
  private readonly creados = new Map<string, { veces: number; hasta: number }>();

  private demasiadosDesconocidos(whiteLabelId: string): boolean {
    const marca = this.creados.get(whiteLabelId);
    const ahora = Date.now();
    if (!marca || marca.hasta < ahora) {
      this.creados.set(whiteLabelId, { veces: 1, hasta: ahora + 60 * 60 * 1000 });
      return false;
    }
    marca.veces += 1;
    if (marca.veces > TOPE_DESCONOCIDOS_POR_HORA) {
      this.logger.warn(
        `[CHAT] marca ${whiteLabelId}: ${marca.veces} desconocidos en una hora. No se crean más fichas; ` +
          'lo de quien ya está en el tablero sigue entrando.',
      );
      return true;
    }
    return false;
  }

  /** Quien se dio de baja de los mensajes de la marca NO entra como contacto. */
  private async estaDeBajaEnLaMarca(whiteLabelId: string, phoneKey: string): Promise<boolean> {
    const c = await this.prisma.mktContact.findFirst({
      where: { whiteLabelId, phoneKey, deleted: false, optOut: true },
      select: { id: true },
    });
    return !!c;
  }

  /** El contacto nuevo de quien escribió sin estar en ningún tablero. */
  private async crearDesconocido(
    whiteLabelId: string,
    phoneKey: string,
    phone?: string | null,
  ): Promise<{ id: string; salesTeamId: string } | null> {
    const teamId = await this.equipoQueRecibe(whiteLabelId);
    if (!teamId) return null;
    // La baja es de la persona, no del canal: si se dio de baja, su número no
    // vuelve al tablero por haber escrito (Fable, 2026-09-15).
    if (await this.estaDeBajaEnLaMarca(whiteLabelId, phoneKey)) return null;
    if (this.demasiadosDesconocidos(whiteLabelId)) return null;
    const columnas = await asegurarColumnas(this.prisma, teamId);
    const primera = columnas[0];
    if (!primera) return null;
    return this.prisma.$transaction(async (tx) => {
      // Dos mensajes a la vez del mismo desconocido crearían dos fichas: el
      // candado los pone en fila, igual que al sembrar las columnas.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${teamId}:${phoneKey}`}))`;
      const ya = await tx.salesLead.findFirst({
        where: { salesTeamId: teamId, phoneKey },
        select: { id: true, salesTeamId: true },
      });
      if (ya) return ya;
      return tx.salesLead.create({
        data: {
          salesTeamId: teamId,
          whiteLabelId,
          stageId: primera.id,
          // Acotado: el teléfono viene de un payload ajeno y sin tope.
          phone: (phone ?? '').trim().slice(0, MAX_TELEFONO) || null,
          phoneKey,
          source: 'chat',
          lastActivityAt: new Date(),
        },
        select: { id: true, salesTeamId: true },
      });
    });
  }

}

@Injectable()
export class SalesChatService {
  private logger = new Logger(SalesChatService.name);

  constructor(
    private prisma: PrismaService,
    private mkt: MktProviderService,
  ) {}

  // ── Lo que se lee ───────────────────────────────────────────────────────

  async conversacion(user: AuthUser, teamId: string, leadId: string) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    const lead = await this.leadDelEquipo(teamId, leadId);
    // LOS 200 MÁS NUEVOS, no los 200 más viejos.
    //
    // Estaba en `asc` con el mismo tope: pasada esa cifra el vendedor veía el
    // PRINCIPIO de la conversación y nunca lo último — justo al revés de lo
    // que hace falta en un chat. Se piden en `desc` y se le da la vuelta para
    // pintarlos en orden.
    const recientes = await this.prisma.salesMessage.findMany({
      where: { leadId },
      orderBy: { createdAt: 'desc' },
      take: TOPE_HISTORIAL,
    });
    const mensajes = recientes.reverse();
    const optOut = await this.estaDeBaja(acceso.team.whiteLabelId, lead.phone);
    return {
      puedeEscribir: acceso.puedeEscribir,
      // Sin teléfono no hay a dónde escribir. La pantalla lo usa para explicar
      // por qué el cuadro de texto está apagado, en vez de dejarlo mudo.
      telefono: lead.phone,
      optOut,
      mensajes,
    };
  }

  private async leadDelEquipo(teamId: string, leadId: string) {
    const l = await this.prisma.salesLead.findFirst({
      where: { id: leadId, salesTeamId: teamId },
      select: { id: true, phone: true, name: true },
    });
    if (!l) throw new NotFoundException('Lead no encontrado');
    return l;
  }

  /**
   * ¿Esta persona se dio de baja?
   *
   * Se mira por teléfono en `MktContact`, que es donde vive el opt-out de la
   * marca. Ante la duda —error de base, contacto que no existe— se responde
   * `false`: bloquear a quien no se dio de baja rompe el trabajo del vendedor,
   * y quien sí lo hizo está en la tabla.
   */
  private async estaDeBaja(
    whiteLabelId: string | null,
    phone: string | null,
  ): Promise<boolean> {
    const phoneKey = phoneKeyOf(phone);
    if (!whiteLabelId || !phoneKey) return false;
    try {
      const c = await this.prisma.mktContact.findFirst({
        where: { whiteLabelId, phoneKey, deleted: false, optOut: true },
        select: { id: true },
      });
      return !!c;
    } catch {
      return false;
    }
  }

  // ── Lo que sale ─────────────────────────────────────────────────────────

  /**
   * El vendedor le escribe.
   *
   * Sale por la subcuenta de la marca, como todo lo demás: una marca sin
   * subcuenta propia NO envía, y el proveedor lo devuelve como `skipped` con su
   * motivo — que se le enseña tal cual al vendedor en vez de un «error».
   *
   * El mensaje se guarda SIEMPRE que el proveedor lo acepte, y no antes: una
   * burbuja en la pantalla de un mensaje que nunca salió es peor que un error,
   * porque el vendedor se queda esperando una respuesta a algo que nadie leyó.
   */
  async enviar(
    user: AuthUser,
    teamId: string,
    leadId: string,
    body: { body: string; channel?: string },
  ) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    exigirEscritura(acceso);
    const lead = await this.leadDelEquipo(teamId, leadId);

    const texto = (body.body ?? '').trim();
    if (!texto) throw new BadRequestException('El mensaje está vacío.');
    if (texto.length > MAX_SMS) {
      throw new BadRequestException(
        `El mensaje no puede pasar de ${MAX_SMS} caracteres.`,
      );
    }
    if (!lead.phone?.trim()) {
      throw new BadRequestException(
        'Este lead no tiene teléfono. Añádeselo antes de escribirle.',
      );
    }
    if (await this.estaDeBaja(acceso.team.whiteLabelId, lead.phone)) {
      throw new BadRequestException(
        'Esta persona se dio de baja de los mensajes de la marca. No se le puede escribir.',
      );
    }
    if (!acceso.team.whiteLabelId) {
      throw new BadRequestException(
        'Este equipo no tiene marca, así que no hay subcuenta desde la que escribir.',
      );
    }

    // EL CANAL «WHATSAPP» NO EXISTE TODAVÍA.
    //
    // La API lo aceptaba y el mensaje se guardaba etiquetado como WhatsApp,
    // pero el proveedor de la marca solo sabe mandar SMS (`MktProviderService`
    // no tiene envío de WhatsApp): al cliente le llegaba un SMS y en el hilo
    // ponía WhatsApp. Mejor decirlo que fingirlo (arqueo del 2026-09-15).
    if (body.channel === 'whatsapp') {
      throw new BadRequestException(
        'Por ahora solo se puede escribir por SMS: la marca no tiene WhatsApp conectado para enviar.',
      );
    }

    const r = await this.mkt.sendSms({
      whiteLabelId: acceso.team.whiteLabelId,
      toPhone: lead.phone,
      message: texto,
      ctx: {
        whiteLabelId: acceso.team.whiteLabelId,
        feature: 'sales-chat',
      },
    });
    if (!r.ok) {
      // `skipped` trae el motivo real («la marca no tiene subcuenta de SMS
      // configurada»), que es accionable. Un «error al enviar» no lo es.
      throw new BadRequestException(r.error ?? 'No se pudo enviar el mensaje.');
    }

    const mensaje = await this.prisma.salesMessage.create({
      data: {
        salesTeamId: teamId,
        leadId,
        direction: 'out',
        channel: 'sms',
        body: texto,
        userId: user.id,
        providerMessageId: r.messageId ?? null,
        status: 'enviado',
      },
    });
    await this.prisma.salesLead
      .update({ where: { id: leadId }, data: { lastActivityAt: new Date() } })
      .catch(() => null);
    await this.prisma.salesLeadActivity
      .create({
        data: {
          leadId,
          salesTeamId: teamId,
          userId: user.id,
          kind: 'mensaje',
          body: texto.slice(0, 300),
        },
      })
      .catch(() => null);
    return mensaje;
  }

  /**
   * Nota interna: queda en la conversación y NO sale a ninguna parte.
   *
   * Es distinto de la nota del historial: aquí se lee en el hilo, entre los
   * mensajes, que es donde el vendedor la escribe («ojo, ya le bajamos el
   * precio una vez»).
   */
  async notaInterna(
    user: AuthUser,
    teamId: string,
    leadId: string,
    body: { body: string },
  ) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    exigirEscritura(acceso);
    await this.leadDelEquipo(teamId, leadId);
    const texto = (body.body ?? '').trim();
    if (!texto) throw new BadRequestException('La nota está vacía.');

    return this.prisma.salesMessage.create({
      data: {
        salesTeamId: teamId,
        leadId,
        direction: 'internal',
        channel: 'note',
        body: texto.slice(0, 4000),
        userId: user.id,
        status: null,
      },
    });
  }
}
