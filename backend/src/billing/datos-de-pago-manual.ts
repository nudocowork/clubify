/**
 * «Datos de pago» que acompañan a los recordatorios de cobro de los negocios
 * que pagan POR FUERA de la pasarela (`Tenant.manualPayment = true`).
 *
 * EL PORQUÉ (pedido del dueño, 2026-10-15): a quien paga por transferencia o
 * Nequi le llegaba el mismo «te cobramos en 3 días» que a quien tiene la
 * tarjeta en Hotmart. Para él ese texto no sirve: no hay nada que se cobre
 * solo, y no sabe a dónde pagar ni cuánto. Ahora, justo después del aviso de
 * cobro, sale un segundo mensaje con la imagen de las cuentas y la indicación
 * de consultar la tasa del día ANTES de pagar (el plan está en dólares y el
 * valor en pesos cambia cada día: pagar «a ojo» deja saldos pendientes).
 *
 * Vive en `Setting` (key/value String) y no en una tabla propia a propósito:
 * es UNA fila de configuración de plataforma y no justifica un cambio de
 * esquema en producción.
 *
 * Este archivo es puro (sin Prisma ni Nest) para poder probar el saneado y la
 * decisión de envío sin base de datos.
 */

export const CLAVE_DATOS_DE_PAGO = 'cobros.manual.datosDePago';

/** templateId propio: así el envío se distingue en «Mensajes enviados». */
export const TEMPLATE_DATOS_DE_PAGO = 'datos_de_pago_manual';

export type DatosDePagoManual = {
  /** Interruptor general. Apagado = los de pago manual reciben solo el aviso. */
  activo: boolean;
  /** Imagen con las cuentas. Siempre https: GHL la descarga para adjuntarla. */
  imagenUrl: string;
  /** Texto que acompaña a la imagen. */
  mensaje: string;
};

export const DATOS_DE_PAGO_POR_DEFECTO: DatosDePagoManual = Object.freeze({
  activo: true,
  imagenUrl: 'https://app.soyclubify.com/cobros/metodos-de-pago-clubify.jpg',
  mensaje:
    'Estos son nuestros datos para que realices el pago. Antes de pagar, ' +
    'consulta con nuestro equipo la tasa del día para confirmar el valor exacto.',
}) as DatosDePagoManual;

/** Tope del texto: sale como SMS/WhatsApp, no como correo. */
export const MAX_MENSAJE = 600;
export const MAX_URL = 1000;

/**
 * Solo https y con host. Un `http://` lo rechazan los proveedores de MMS/
 * WhatsApp, y un `javascript:` o `data:` no tiene nada que hacer aquí (además,
 * `data:` sería meter la imagen en base64 en la base, que es justo lo que no
 * se hace: ver la política de subidas).
 */
export function urlDeImagenValida(v: unknown): string | null {
  const s = String(v ?? '').trim();
  if (!s || s.length > MAX_URL) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' || !u.hostname) return null;
    return u.toString();
  } catch {
    return null;
  }
}

function mensajeLimpio(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v
    .replace(/\r\n?/g, '\n')
    // Caracteres de control fuera (menos el salto de línea): llegan pegando
    // desde Word o WhatsApp Web y en el teléfono se ven como cuadritos.
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!s) return null;
  return s.length > MAX_MENSAJE ? s.slice(0, MAX_MENSAJE).trim() : s;
}

/**
 * Sanea lo que llegue (del panel o de la base). Nunca lanza: lo que no se
 * entiende cae al valor por defecto, porque una fila corrupta no puede dejar a
 * los negocios sin los datos para pagar. El mensaje vacío también cae al de
 * fábrica: el envío de un cuerpo vacío lo corta `sendSmsWithCreds`, y la
 * advertencia de la tasa es justo lo que no se puede perder.
 */
export function normalizarDatosDePago(entrada: unknown): DatosDePagoManual {
  const obj =
    entrada && typeof entrada === 'object' ? (entrada as Record<string, unknown>) : {};
  return {
    activo: typeof obj.activo === 'boolean' ? obj.activo : DATOS_DE_PAGO_POR_DEFECTO.activo,
    imagenUrl: urlDeImagenValida(obj.imagenUrl) ?? DATOS_DE_PAGO_POR_DEFECTO.imagenUrl,
    mensaje: mensajeLimpio(obj.mensaje) ?? DATOS_DE_PAGO_POR_DEFECTO.mensaje,
  };
}

/** Lee el valor guardado (texto JSON). Sin fila o ilegible → el de fábrica. */
export function leerDatosDePago(valor: string | null | undefined): DatosDePagoManual {
  if (!valor) return { ...DATOS_DE_PAGO_POR_DEFECTO };
  try {
    return normalizarDatosDePago(JSON.parse(valor));
  } catch {
    return { ...DATOS_DE_PAGO_POR_DEFECTO };
  }
}

/**
 * ¿Toca mandar los datos de pago después de este aviso?
 *
 * - Solo a `manualPayment`: al de Hotmart o Stripe la pasarela le cobra sola, y
 *   mandarle cuentas bancarias lo invitaría a pagar DOS veces.
 * - Solo a negocios de la PLATAFORMA: la imagen son las cuentas de Clubify. A
 *   un negocio de una marca blanca (las de Stripe también reciben avisos de
 *   cobro) le estaríamos pidiendo que le pague a otro, y delatando la
 *   plataforma detrás de su marca.
 * - Solo si el aviso de cobro SALIÓ: un «estos son nuestros datos» suelto, sin
 *   el mensaje que dice qué se paga y cuándo, no se entiende.
 */
export function debeEnviarDatosDePago(p: {
  manualPayment: boolean | null | undefined;
  esPlataforma: boolean;
  config: DatosDePagoManual;
  avisoDeCobroSalio: boolean;
}): boolean {
  return (
    p.manualPayment === true &&
    p.esPlataforma &&
    p.config.activo &&
    p.avisoDeCobroSalio &&
    !!p.config.mensaje.trim()
  );
}
