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
import { AuditService } from '../audit/audit.service';
import { AutomationsService } from '../automations/automations.service';
import { WhitelabelBrandService } from '../whitelabel/whitelabel-brand.service';
import { GrowBusinessService } from '../integrations/grow-business.service';
import {
  brandGrowCreds,
  BRAND_GROW_SELECT,
} from '../integrations/brand-sms-creds.util';
import { brandAppUrl } from '../email/brand-email-creds.util';
import { maquetarCorreo } from '../email/maquetador';
import { normalizePassLocale } from '../wallet/pass-labels';
import { sinSecretosDelNegocio } from '../tenants/sin-secretos';

/** Lo que hay que saber del negocio (y su marca) para avisar de una emisión. */
type NegocioParaAvisar = {
  brandName: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
  growBusinessLocationId: string | null;
  growBusinessApiKey: string | null;
  growBusinessSwitchNumber: number | null;
  whiteLabel: {
    name: string | null;
    domain: string | null;
    appDomain: string | null;
    growBusinessLocationId: string | null;
    growBusinessApiKey: string | null;
    growBusinessSwitchNumber: number | null;
  } | null;
};

/** La verdad de la entrega, canal por canal, tal como la enseña el panel. */
type EntregaDeTarjeta = (
  | { via: 'sms'; telefono: string }
  | { via: 'bienvenida' }
  | { via: 'sin-telefono' }
  | { via: 'sin-credenciales' }
  | { via: 'fallo'; detalle: string }
) & { correo?: 'enviado' | 'fallo' | 'sin-conexion'; email?: string };

/**
 * De los clientes que Postgres encontró por un trozo del número, los que
 * tienen DE VERDAD el teléfono tecleado.
 *
 * Existe porque las búsquedas públicas por teléfono («Mi tarjeta» de la
 * tienda y de la Cuponera) pedían `phone CONTAINS últimos10` con solo 7
 * dígitos y devolvían el `passId` de todo el que casara. Con siete cifras
 * cualquiera sacaba tarjetas ajenas; con el número exacto de un cliente salían
 * también las de quien lo llevara dentro (otro prefijo de país).
 *
 * `CONTAINS` (con `colaParaBuscar`) se queda como filtro barato en la base; la
 * decisión la toma `mismoNumeroDeCliente`: dígitos idénticos, o uno terminado
 * en el otro con al menos 8 dígitos — la ficha guardada sin `+57` sigue
 * apareciendo al buscar con el prefijo que pone el selector de país.
 *
 * 8 y no 10 (el umbral de Equipos de Ventas): hay clientes de Chile, Perú y
 * Ecuador (móvil de 9) y de Panamá y Bolivia (8), y con 10 una ficha suya
 * guardada sin indicativo dejaba de encontrar su tarjeta. Lo que cierra la
 * fuga no es el umbral —conocer 8 de 10 cifras son 100 intentos— sino dejar de
 * devolver a TODO el que contenga las cifras: ahora sale solo ese número.
 *
 * Lo que esto NO separa: dos fichas con el MISMO número (en producción hay
 * familias y números duplicados con otro formato). Con el teléfono como única
 * prueba no hay forma de saber cuál es quién.
 */
export function soloElMismoTelefono<T extends { phone: string | null }>(
  tecleado: string,
  candidatos: T[],
): T[] {
  if (!telefonoBuscable(tecleado)) return [];
  return candidatos.filter((c) => mismoNumeroDeCliente(tecleado, c.phone));
}

/** Mínimo de dígitos para buscar a un cliente por su teléfono. Ver arriba. */
const MIN_DIGITOS_CLIENTE = 8;

const soloDigitos = (v?: string | null) => (v || '').replace(/\D/g, '');

/**
 * EL CERO QUE SOBRA CUANDO YA HAY INDICATIVO.
 *
 * En media Europa y en buena parte de Latinoamérica el móvil se escribe con un
 * 0 delante para llamar dentro del país: en Venezuela es `0424 722 4687`. Al
 * elegir el país en el formulario, ese 0 se queda **en medio**:
 * `+58` + `04247224687` → `+5804247224687`.
 *
 * Y en medio es justo donde no lo ve una comparación por el final: el número
 * guardado `+584247224687` NO es sufijo de `+5804247224687`, así que el mismo
 * cliente parecía otro. Esta función devuelve también la versión sin ese cero,
 * para poder reconocerlo.
 *
 * Se prueban las tres posiciones posibles porque los indicativos tienen entre
 * uno y tres dígitos (1 Estados Unidos, 58 Venezuela, 593 Ecuador) y aquí no se
 * sabe cuál es cuál. Es una lista corta de candidatos, no una suposición: el
 * que valga tendrá que coincidir por el final igual que siempre.
 *
 * NO SE TOCA LO QUE SE GUARDA. Esto solo sirve para RECONOCER a un cliente que
 * ya está; el teléfono de su ficha se queda como estaba. Reescribir números de
 * media base por una regla que no vale en todos los países —en Italia el 0 sí
 * es parte del número— sería otra cosa, y mucho más peligrosa.
 */
export function variantesDelNumero(digitos: string): string[] {
  // SOLO CON INDICATIVO DELANTE. Un número local de 10 cifras no tiene cero
  // de troncal que quitar: en «3101234567» (móvil colombiano tal cual) ese 0
  // es parte del número, y quitárselo lo convertía en OTRA persona
  // («3011234567» colapsaba a la misma variante — lo demostró la revisión de
  // Fable ejecutando la función). Con 11 cifras o más sí hay indicativo y el
  // 0 pegado a él sí es de marcar dentro del país.
  if (digitos.length < 11) return [digitos];
  const fuera = new Set<string>([digitos]);
  for (const corte of [1, 2, 3]) {
    if (digitos[corte] === '0' && digitos.length > corte + 1) {
      fuera.add(digitos.slice(0, corte) + digitos.slice(corte + 1));
    }
  }
  return [...fuera];
}

/** ¿El mismo número? Iguales, o uno acaba en el otro con ≥ 8 dígitos. */
export function mismoNumeroDeCliente(a?: string | null, b?: string | null): boolean {
  const da = soloDigitos(a);
  const db = soloDigitos(b);
  if (!da || !db) return false;
  if (da === db) return true;
  // El sufijo, con los números TAL CUAL: es la regla de siempre.
  const [corto, largo] = da.length <= db.length ? [da, db] : [db, da];
  if (corto.length >= MIN_DIGITOS_CLIENTE && largo.endsWith(corto)) return true;

  // Y las variantes sin el cero de troncal, pero SOLO POR IGUALDAD EXACTA.
  // Es lo que resuelve el caso real —«+5804247224687» tecleado ES
  // «+584247224687» guardado (Eudes Rincón, 2026-09-28)— sin abrir la puerta
  // que abría el sufijo: la variante de un +1 de Miami («+1 305…» sin su 0)
  // resultaba ser la COLA de un fijo de Brasil y «Mi tarjeta» le enseñaba a
  // uno los pases del otro. Lo demostró la revisión de Fable ejecutando la
  // función; con igualdad exacta ese par ya no casa.
  for (const va of variantesDelNumero(da)) {
    for (const vb of variantesDelNumero(db)) {
      if (va === vb) return true;
    }
  }
  return false;
}

/** ¿Hay dígitos suficientes para buscar? Por debajo, ni se consulta la base. */
export function telefonoBuscable(tecleado: string): boolean {
  return soloDigitos(tecleado).length >= MIN_DIGITOS_CLIENTE;
}

/**
 * El trozo con el que se pre-filtra en la base: las 8 últimas cifras. Con las
 * 10 últimas, un `912345678` guardado sin indicativo no CONTIENE
 * `6912345678` (lo que sale de `+56 912345678`) y ni llegaba a candidato.
 */
export function colaParaBuscar(tecleado: string): string {
  return soloDigitos(tecleado).slice(-MIN_DIGITOS_CLIENTE);
}

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
    // AuditModule es @Global(): no hay que importarlo en PassesModule.
    private audit: AuditService,
    private growBusiness: GrowBusinessService,
  ) {}

  private guardTenant(user: AuthUser, tenantId: string) {
    if (user.role !== 'SUPER_ADMIN' && user.tenantId !== tenantId) {
      throw new ForbiddenException();
    }
  }

  /**
   * EMITIR UNA TARJETA DESDE EL PANEL, y que el cliente SE ENTERE.
   *
   * Lo que «emitir» puede y no puede hacer, porque aquí estaba el
   * malentendido (reporte de Javier vía su implementador, 2026-09-29): ni
   * Apple ni Google permiten meter un pase en el teléfono de nadie — el
   * cliente tiene que abrir el enlace e instalarlo él. Emitir crea el pase y
   * lo deja listo; hasta hoy, ahí se acababa: si el negocio no copiaba el
   * enlace y se lo mandaba a mano, el cliente jamás sabía que tenía una
   * tarjeta. Medido: un pase emitido el 27-09 seguía sin instalar.
   *
   * Ahora, al emitir, se le MANDA el enlace por SMS —solo con la conexión de
   * mensajes del PROPIO negocio; sin ella no sale nada— salvo que el negocio
   * ya tenga activa una automatización de bienvenida (PASS_CREATED con
   * SMS/WhatsApp): en ese caso manda ella y no se duplica el mensaje. Y si el
   * cliente tiene correo en su ficha, le llega ADEMÁS la invitación por email,
   * transportada por la subcuenta de la marca del negocio (Javier, 2026-09-29).
   *
   * La respuesta cuenta la verdad («entrega»), y el panel la enseña: enviado a
   * tal número, o «no tiene teléfono, cópiale el enlace».
   */
  async issue(user: AuthUser, cardId: string, customerId: string) {
    const card = await this.prisma.card.findUnique({ where: { id: cardId } });
    if (!card) throw new NotFoundException('Card');
    this.guardTenant(user, card.tenantId);

    // ¿Ya la tenía? Se distingue ANTES de emitir: reemitir no debe volver a
    // mandarle el SMS a quien ya tiene su tarjeta instalada.
    const previo = await this.prisma.pass.findUnique({
      where: { cardId_customerId: { cardId, customerId } },
      select: { id: true },
    });

    const pass = await this.issueInternal(cardId, customerId);
    if (previo) {
      return { ...pass, entrega: { via: 'ya-existia' as const } };
    }
    const entrega = await this.entregarEnlaceDeTarjeta(pass.id, card, customerId);
    return { ...pass, entrega };
  }

  /**
   * El aviso con el enlace de instalación. Separado para poder razonar sus
   * salidas: cada una se devuelve al panel para que diga la verdad en vez de
   * un «emitida» a secas que no cuenta si el cliente se enteró.
   *
   * Dos canales, con reglas DISTINTAS a propósito:
   *  - SMS: SOLO la línea propia del negocio (Javier, 2026-09-29: «el negocio
   *    no puede enviar mensajes a los clientes finales» por un número ajeno).
   *  - Correo: por la subcuenta de la MARCA del negocio, que pone el
   *    remitente (Javier, mismo día: «si el cliente tiene correo, que salga
   *    un correo de Clubify con la invitación» — y de Sellea para los de
   *    Sellea: a un cliente de una marca blanca jamás le escribe Clubify).
   */
  private async entregarEnlaceDeTarjeta(
    passId: string,
    card: { tenantId: string; name: string },
    customerId: string,
  ): Promise<EntregaDeTarjeta> {
    try {
      const cliente = await this.prisma.customer.findUnique({
        where: { id: customerId },
        select: { phone: true, email: true, fullName: true },
      });
      const negocio = await this.prisma.tenant.findUnique({
        where: { id: card.tenantId },
        select: {
          brandName: true,
          logoUrl: true,
          primaryColor: true,
          growBusinessLocationId: true,
          growBusinessApiKey: true,
          growBusinessSwitchNumber: true,
          // De la marca: la subcuenta que transporta el correo, el nombre para
          // el «Hecho con…» y los dominios del enlace — sin ellos brandAppUrl
          // cae al de la plataforma y el enlace de un negocio de Sellea
          // saldría por soyclubify.com (la trampa de las fugas de marca).
          whiteLabel: {
            select: {
              ...BRAND_GROW_SELECT,
              name: true,
              domain: true,
              appDomain: true,
            },
          },
        },
      });
      const base = brandAppUrl(
        negocio?.whiteLabel ?? null,
        process.env.APP_URL ?? 'https://app.soyclubify.com',
      );
      const enlace = `${base}/w/${passId}`;

      const sms = await this.avisarPorSms(card, cliente, negocio, enlace);
      const correo = await this.avisarPorCorreo(card, cliente, negocio, enlace);
      return { ...sms, ...correo };
    } catch (e) {
      // El pase YA está emitido: un fallo del aviso no puede convertirse en un
      // fallo de la emisión. Se cuenta, y el panel ofrece copiar el enlace.
      return { via: 'fallo', detalle: (e as Error).message };
    }
  }

  private async avisarPorSms(
    card: { tenantId: string; name: string },
    cliente: { phone: string | null } | null,
    negocio: NegocioParaAvisar | null,
    enlace: string,
  ): Promise<
    | { via: 'sms'; telefono: string }
    | { via: 'bienvenida' }
    | { via: 'sin-telefono' }
    | { via: 'sin-credenciales' }
    | { via: 'fallo'; detalle: string }
  > {
    // Si el negocio tiene bienvenida automática con SMS/WhatsApp, manda ella
    // (el emit de PASS_CREATED ya salió en issueInternal). Dos SMS por la
    // misma emisión es la clase de duplicado que este repo caza.
    const reglas = await this.prisma.automationRule.findMany({
      where: { tenantId: card.tenantId, isActive: true },
      select: { trigger: true, actions: true },
    });
    const bienvenida = reglas.some((r) => {
      const t = r.trigger as { type?: string } | null;
      if (t?.type !== 'PASS_CREATED') return false;
      const acciones = (r.actions as Array<{ type?: string }> | null) ?? [];
      return acciones.some(
        (a) => a.type === 'SEND_SMS' || a.type === 'SEND_WHATSAPP',
      );
    });
    if (bienvenida) return { via: 'bienvenida' };

    const telefono = cliente?.phone?.trim();
    if (!telefono) return { via: 'sin-telefono' };

    // SOLO la conexión Grow Business del PROPIO negocio, sin respaldo a la
    // subcuenta de su marca — a propósito (Javier, 2026-09-29): el negocio
    // no le escribe a sus clientes finales por un número que no es suyo. En
    // producción 132 de 133 negocios no tienen conexión propia, así que con
    // el respaldo casi todo aviso habría salido por el número de Clubify o
    // de Sellea. Sin credenciales → no se manda, y el panel pide copiar el
    // enlace.
    const creds =
      negocio?.growBusinessLocationId && negocio.growBusinessApiKey
        ? {
            locationId: negocio.growBusinessLocationId,
            apiKey: negocio.growBusinessApiKey,
            switchNumber: negocio.growBusinessSwitchNumber ?? null,
          }
        : null;
    if (!creds) return { via: 'sin-credenciales' };

    const cuerpo =
      `${negocio?.brandName ?? ''}: tu tarjeta "${card.name}" esta lista. ` +
      `Abrela aqui para guardarla en tu telefono: ${enlace}`;

    const r = await this.growBusiness.sendSmsWithCreds(creds, telefono, cuerpo, {
      tenantId: card.tenantId,
      feature: 'tarjetas',
    });
    return r.ok
      ? { via: 'sms', telefono }
      : {
          via: 'fallo',
          detalle:
            (r as { message?: string }).message ??
            'el proveedor no aceptó el mensaje',
        };
  }

  /**
   * La invitación por CORREO (Javier, 2026-09-29): sale por la subcuenta GHL
   * de la marca del negocio — el remitente lo pone ella, así que el correo de
   * un negocio de Clubify llega «de Clubify» y el de uno de Sellea, de Sellea.
   * FIRMA el negocio (su nombre y su logo: es a quien el cliente conoce), con
   * el «Hecho con {marca}» al pie. Sin marca con subcuenta no se envía nada:
   * jamás un respaldo a otra marca ni a la plataforma.
   */
  private async avisarPorCorreo(
    card: { tenantId: string; name: string },
    cliente: { email: string | null; fullName: string | null } | null,
    negocio: NegocioParaAvisar | null,
    enlace: string,
  ): Promise<{ correo?: 'enviado' | 'fallo' | 'sin-conexion'; email?: string }> {
    const email = cliente?.email?.trim().toLowerCase();
    if (!email || !email.includes('@')) return {};
    try {
      const creds = brandGrowCreds(negocio?.whiteLabel);
      if (!creds) return { correo: 'sin-conexion' };

      const nombrePila = (cliente?.fullName ?? '').trim().split(/\s+/)[0] || '';
      const quien = negocio?.brandName?.trim() || '';
      const html = maquetarCorreo({
        identidad: quien
          ? {
              nombre: quien,
              logoUrl: negocio?.logoUrl ?? null,
              color: negocio?.primaryColor ?? null,
              sitioUrl: null,
            }
          : null,
        preheader: `Ábrela y guárdala en tu teléfono.`,
        titulo: 'Tu tarjeta está lista',
        bloques: [
          {
            tipo: 'texto',
            texto:
              `${nombrePila ? `Hola ${nombrePila}: ` : ''}` +
              `${quien || 'tu negocio de confianza'} te emitió la tarjeta ` +
              `«${card.name}». Ábrela y guárdala en tu teléfono para tenerla ` +
              `siempre a mano.`,
          },
        ],
        boton: { texto: 'Abrir mi tarjeta', url: enlace },
        enlaceVisible: true,
        motivo: quien
          ? `Recibes este correo porque ${quien} te emitió una tarjeta.`
          : null,
        credito: negocio?.whiteLabel?.name
          ? `Hecho con ${negocio.whiteLabel.name}`
          : null,
      });
      const r = await this.growBusiness.sendEmailWithCreds(
        creds,
        email,
        `${quien ? `${quien}: tu` : 'Tu'} tarjeta «${card.name}» está lista`,
        html,
        { ctx: { tenantId: card.tenantId, feature: 'tarjetas' } },
      );
      return r.ok ? { correo: 'enviado', email } : { correo: 'fallo' };
    } catch {
      // Mejor un SMS entregado y un correo caído que una emisión rota.
      return { correo: 'fallo' };
    }
  }

  /**
   * Revoca un pase: deja de valer sin borrar nada.
   *
   * `PassStatus.REVOKED` existía desde el principio y TODO el lado que lo lee
   * ya lo respetaba —el escáner se niega a sellar, el webservice de Apple lo
   * excluye, Google recibe `state: INACTIVE`, el refresco de geocerco lo salta,
   * las métricas lo cuentan aparte—, pero hasta hoy ningún camino lo escribía:
   * en producción había 0 pases revocados y 0 formas de revocar uno.
   *
   * QUÉ NO HACE, y es lo importante: no toca al cliente. Su ficha, su
   * teléfono, sus pedidos y sus demás tarjetas siguen exactamente igual.
   * Revocar una credencial es retirar una credencial, no echar a una persona.
   *
   * Por qué `updateMany` y no `update`:
   *
   *  1. El middleware de Prisma NO cubre `update`/`delete`/`upsert` singulares
   *     (`prisma-tenant-middleware.ts`), así que un `update({ where: { id } })`
   *     a secas se salta el aislamiento por negocio. `updateMany` sí pasa.
   *  2. Es atómico. Leer el estado, decidir y escribir en tres pasos es el bug
   *     más repetido de esta casa: dos clics a la vez revocan dos veces y el
   *     segundo pisa la fecha y el autor del primero. Aquí la condición viaja
   *     dentro del WHERE y lo que se mira es el `count`.
   */
  async revocar(user: AuthUser, passId: string, motivo?: string) {
    const pass = await this.prisma.pass.findFirst({
      where: { id: passId },
      select: {
        id: true,
        tenantId: true,
        serialNumber: true,
        status: true,
        customerId: true,
        card: { select: { name: true, type: true } },
      },
    });
    if (!pass) throw new NotFoundException('Pass');
    this.guardTenant(user, pass.tenantId);

    const { count } = await this.prisma.pass.updateMany({
      where: { id: passId, tenantId: pass.tenantId, status: { not: 'REVOKED' } },
      data: {
        status: 'REVOKED',
        revokedAt: new Date(),
        revokedBy: user.id,
        // Sin tocar esto, Apple sirve su copia cacheada y el pase seguiría
        // enseñándose como válido en el móvil del cliente.
        lastActivityAt: new Date(),
      },
    });
    if (count === 0) {
      throw new BadRequestException('Esta tarjeta ya estaba revocada.');
    }

    await this.audit.log({
      actorId: user.id,
      tenantId: pass.tenantId,
      action: 'pase.revocado',
      resource: `pass:${passId}`,
      metadata: {
        serialNumber: pass.serialNumber,
        customerId: pass.customerId,
        tipo: pass.card.type,
        tarjeta: pass.card.name,
        estadoAnterior: pass.status,
        motivo: motivo?.trim() || null,
        impersonadoPor: user.impersonatedBy ?? null,
      },
    });

    return { ok: true, serialNumber: pass.serialNumber };
  }

  /**
   * Devuelve un pase revocado a la vida.
   *
   * Existe porque revocar sin deshacer es una acción destructiva de un solo
   * clic, y de esas ya nos han costado datos. Vuelve a `ACTIVE` aunque
   * estuviera `COMPLETED`: el estado de un cartón lleno lo recalcula
   * `reglaDeEstado` en el siguiente sello, así que no hay nada que reconstruir.
   */
  async restaurar(user: AuthUser, passId: string) {
    const pass = await this.prisma.pass.findFirst({
      where: { id: passId },
      select: { id: true, tenantId: true, serialNumber: true, customerId: true },
    });
    if (!pass) throw new NotFoundException('Pass');
    this.guardTenant(user, pass.tenantId);

    const { count } = await this.prisma.pass.updateMany({
      where: { id: passId, tenantId: pass.tenantId, status: 'REVOKED' },
      data: {
        status: 'ACTIVE',
        revokedAt: null,
        revokedBy: null,
        lastActivityAt: new Date(),
      },
    });
    if (count === 0) {
      throw new BadRequestException('Esta tarjeta no estaba revocada.');
    }

    await this.audit.log({
      actorId: user.id,
      tenantId: pass.tenantId,
      action: 'pase.restaurado',
      resource: `pass:${passId}`,
      metadata: {
        serialNumber: pass.serialNumber,
        customerId: pass.customerId,
        impersonadoPor: user.impersonatedBy ?? null,
      },
    });

    return { ok: true, serialNumber: pass.serialNumber };
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
    // El negocio viene entero (`tenant: true`): sin esto la respuesta llevaba
    // su llave de Grow Business en claro.
    return { ...pass, tenant: sinSecretosDelNegocio(pass.tenant) };
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
   * Es PÚBLICA: ver `soloElMismoTelefono` para qué se considera el mismo número.
   */
  async findByPhonePublic(slug: string, phoneRaw: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { slug } });
    if (!tenant) throw new NotFoundException('Tenant');

    if (!telefonoBuscable(phoneRaw)) {
      return { passes: [] };
    }

    const tail = colaParaBuscar(phoneRaw);

    const candidatos = await this.prisma.customer.findMany({
      where: {
        tenantId: tenant.id,
        phone: { contains: tail },
      },
      select: { id: true, fullName: true, phone: true },
    });
    const customers = soloElMismoTelefono(phoneRaw, candidatos);

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
      // `endsWith últimos10` solo trae candidatos: `+13001112233` y
      // `+573001112233` acaban igual y son dos personas. Tomar el primero le
      // devolvía a quien se registraba el pase (y los sellos) del otro.
      const parecidos = await this.prisma.customer
        .findMany({
          where: { tenantId: card.tenantId, phone: { endsWith: last10 } },
          take: 20,
        })
        .catch(() => []);
      customer = parecidos.find((c) => mismoNumeroDeCliente(phoneNorm, c.phone)) ?? null;
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
          // HAY DOS ÍNDICES ÚNICOS, NO UNO: `[tenantId, phone]` y
          // `[tenantId, email]`. El hotfix de junio solo miraba el del
          // teléfono, porque solo pensaba en dos envíos simultáneos del mismo
          // número. Cuando el choque venía del CORREO —el cliente ya estaba,
          // con ese mismo email y el teléfono escrito de otra forma— esta
          // búsqueda no encontraba nada y el `throw` acababa en un
          // «Internal server error» delante del cliente, en el formulario de
          // alta. (Eudes Rincón, tarjeta compartida por Valmont, 2026-09-28.)
          //
          // Primero el teléfono, que identifica mejor: si el choque fue la
          // carrera de dos envíos del mismo número, se usa esa ficha y listo.
          customer = await this.prisma.customer.findUnique({
            where: {
              tenantId_phone: { tenantId: card.tenantId, phone: phoneNorm },
            },
          });
          // Si el choque vino del CORREO, la ficha existente es de OTRO
          // teléfono. NO se le entrega la tarjeta de esa ficha: el correo se
          // comparte en casa, y devolver aquí el pase del titular le daría a
          // quien teclea el correo de otro un QR canjeable ajeno — lo señaló
          // la revisión de Fable. Se contesta con un mensaje que se puede
          // obedecer, en vez del «Internal server error» de antes.
          if (!customer && email) {
            const delCorreo = await this.prisma.customer.findUnique({
              where: { tenantId_email: { tenantId: card.tenantId, email } },
              select: { id: true },
            });
            if (delCorreo) {
              throw new BadRequestException(
                'Ese correo ya está registrado en este negocio con otro ' +
                  'teléfono. Usa el mismo teléfono con el que te registraste, ' +
                  'o deja el correo vacío para crear un registro nuevo.',
              );
            }
          }
          // Si aun así no aparece, el choque es de algo que no sabemos leer y
          // relanzar es lo honesto: mejor un error que un pase mal atribuido.
          if (!customer) throw e;
        } else {
          throw e;
        }
      }
    } else {
      // La ficha YA existía. Esta ruta es pública y el `cardId` va impreso en
      // el QR del mostrador: con el teléfono de otro, cualquiera le cambiaba
      // el nombre y el idioma del pase. Aquí solo se RELLENAN huecos, igual
      // que en `completarRegistro`:
      //  · el nombre, solo si el que había no tiene ni una letra (el alta
      //    rápida deja el teléfono como nombre);
      //  · correo y cumpleaños, solo si faltaban.
      // El idioma NO se toca: el de una ficha existente lo cambia el negocio.
      const nombre = dto.fullName.trim();
      const data: { fullName?: string; email?: string; birthday?: Date } = {};
      if ((!customer.fullName || !/\p{L}/u.test(customer.fullName)) && /\p{L}/u.test(nombre)) {
        data.fullName = nombre;
      }
      if (email && !customer.email) data.email = email;
      if (validBday && !customer.birthday) data.birthday = validBday;
      if (Object.keys(data).length) {
        customer = await this.prisma.customer.update({
          where: { id: customer.id },
          data,
        });
      }
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
