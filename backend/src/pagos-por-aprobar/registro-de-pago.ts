import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Reglas puras del registro de pagos por fuera que hacen los closers.
 * Sin base de datos, para poder probarlas solas.
 */

export const METODOS = ['NEQUI', 'TRANSFERENCIA', 'EFECTIVO', 'OTRO'] as const;
export type Metodo = (typeof METODOS)[number];
export const PERIODICIDADES = ['MENSUAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL'] as const;
export type Periodicidad = (typeof PERIODICIDADES)[number];
export const MONEDAS = ['USD', 'COP', 'MXN', 'PEN', 'CLP', 'EUR'] as const;

export const ESTADOS = ['PENDIENTE', 'APROBANDO', 'APROBADO', 'RECHAZADO'] as const;
export type Estado = (typeof ESTADOS)[number];

// ── El enlace de cada closer ────────────────────────────────────────────────
//
// `<CÓDIGO>-<firma>`. El código dice QUIÉN es el closer y la firma impide que
// alguien cambie el código del enlace por el de otro: así el afiliado del pago
// sale del enlace y no de un selector que se pueda olvidar o equivocar, que es
// justo el error que esto viene a quitar. La firma depende del id del código,
// no del texto, y no caduca: el enlace sirve mientras el código esté activo.

function secreto(): string {
  const s = process.env.REGISTRO_PAGO_SECRET || process.env.JWT_SECRET;
  // Sin secreto no hay enlace: firmar con una cadena vacía haría que cualquiera
  // pudiera fabricar el enlace de cualquier closer.
  if (!s) throw new Error('Falta el secreto para firmar los enlaces de registro de pago');
  return s;
}

function firma(codeId: string): string {
  return createHmac('sha256', secreto())
    .update(`registro-pago:${codeId}`)
    // Hex y no base64url: base64url usa guiones, y el guion separa el código
    // de la firma.
    .digest('hex')
    .slice(0, 20);
}

export function tokenDelCloser(code: { id: string; code: string }): string {
  return `${code.code}-${firma(code.id)}`;
}

/** Separa el código de la firma. La firma (hex) no lleva guiones; el código sí puede. */
export function partirToken(token: string): { code: string; sig: string } | null {
  const i = token.lastIndexOf('-');
  if (i <= 0 || i === token.length - 1) return null;
  return { code: token.slice(0, i), sig: token.slice(i + 1) };
}

export function firmaValida(codeId: string, sig: string): boolean {
  const buena = Buffer.from(firma(codeId));
  const dada = Buffer.from(sig);
  return buena.length === dada.length && timingSafeEqual(buena, dada);
}

// ── El formulario ──────────────────────────────────────────────────────────

export type FormularioCrudo = Record<string, unknown>;

export type FormularioLimpio = {
  brandName: string;
  ownerEmail: string;
  ownerPhone: string | null;
  ownerFullName: string;
  planPeriodicity: Periodicidad;
  businessType: 'FULL' | 'INFOLINK';
  businessCategorySlug: string | null;
  method: Metodo;
  amount: number;
  currency: string;
  paidAt: Date;
  reference: string | null;
  note: string | null;
};

const texto = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim().replace(/\s+/g, ' ');
  return t ? t.slice(0, max) : null;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Valida lo que manda el closer. Devuelve el formulario limpio o la lista de
 * errores, en español y por campo, para pintarlos tal cual.
 */
export function validarFormulario(
  f: FormularioCrudo,
  ahora = new Date(),
): { ok: true; datos: FormularioLimpio } | { ok: false; errores: Record<string, string> } {
  const errores: Record<string, string> = {};

  const brandName = texto(f.brandName, 120);
  if (!brandName) errores.brandName = 'Escribe el nombre comercial del negocio.';

  // El correo se guarda en minúsculas: el usuario del dueño es único por
  // correo, y «Ana@x.com» y «ana@x.com» chocarían al aprobar.
  const ownerEmail = texto(f.ownerEmail, 160)?.toLowerCase() ?? null;
  if (!ownerEmail || !EMAIL.test(ownerEmail)) errores.ownerEmail = 'Escribe un correo válido del dueño.';

  const ownerFullName = texto(f.ownerFullName, 120);
  if (!ownerFullName) errores.ownerFullName = 'Escribe el nombre del dueño.';

  const telefono = texto(f.ownerPhone, 30)?.replace(/[^\d+]/g, '') ?? null;
  const ownerPhone = telefono && telefono.replace(/\D/g, '').length >= 7 ? telefono : null;
  if (telefono && !ownerPhone) errores.ownerPhone = 'El teléfono parece incompleto.';

  const planPeriodicity = String(f.planPeriodicity ?? '').toUpperCase() as Periodicidad;
  if (!PERIODICIDADES.includes(planPeriodicity)) errores.planPeriodicity = 'Elige la periodicidad del plan.';

  const businessType = f.businessType === 'INFOLINK' ? 'INFOLINK' : 'FULL';
  const businessCategorySlug = texto(f.businessCategorySlug, 60);

  const method = String(f.method ?? '').toUpperCase() as Metodo;
  if (!METODOS.includes(method)) errores.method = 'Elige cómo pagó.';

  // Acepta «150», «150.5» y «150,5»; los separadores de miles no («1.500.000»
  // daría 1.5). El monto en pesos se escribe sin puntos: lo dice el formulario.
  const montoTxt = String(f.amount ?? '').trim().replace(',', '.');
  const amount = /^\d+(\.\d{1,2})?$/.test(montoTxt) ? Number(montoTxt) : NaN;
  if (!(amount > 0)) errores.amount = 'Escribe el monto pagado (solo números, sin puntos de miles).';

  const currency = String(f.currency ?? 'USD').toUpperCase();
  if (!(MONEDAS as readonly string[]).includes(currency)) errores.currency = 'Elige la moneda.';

  const fechaTxt = texto(f.paidAt, 40);
  const paidAt = fechaTxt ? fechaDelPago(fechaTxt) : null;
  if (!paidAt) errores.paidAt = 'Escribe la fecha del pago.';
  // Un día de margen por la zona horaria; más allá, el pago no ha ocurrido.
  else if (paidAt.getTime() > ahora.getTime() + 24 * 3600_000) errores.paidAt = 'La fecha del pago no puede ser futura.';
  else if (paidAt.getTime() < ahora.getTime() - 400 * 24 * 3600_000) errores.paidAt = 'La fecha del pago es de hace más de un año.';

  if (Object.keys(errores).length) return { ok: false, errores };
  return {
    ok: true,
    datos: {
      brandName: brandName!,
      ownerEmail: ownerEmail!,
      ownerPhone,
      ownerFullName: ownerFullName!,
      planPeriodicity,
      businessType,
      businessCategorySlug,
      method,
      amount,
      currency,
      paidAt: paidAt!,
      reference: texto(f.reference, 120),
      note: texto(f.note, 1000),
    },
  };
}

/**
 * «2026-10-03» es el día del pago en Colombia: se guarda al mediodía de Bogotá
 * para que ninguna zona horaria lo corra al día anterior.
 */
export function fechaDelPago(v: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  const d = m ? new Date(`${m[1]}-${m[2]}-${m[3]}T17:00:00.000Z`) : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Lo que se propone que entre a Contabilidad. El libro va en USD: si el closer
 * cobró en dólares es su monto; si cobró en otra moneda, el precio del plan,
 * que es lo que vale el ciclo (misma regla que Hotmart: el importe es el
 * precio del PLAN, no la cifra en moneda local). Quien aprueba puede cambiarlo.
 */
export function usdSugerido(amount: number, currency: string, precioDelPlan: number): number {
  return currency === 'USD' ? amount : precioDelPlan;
}
