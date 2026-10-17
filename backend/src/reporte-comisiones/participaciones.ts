import { Prisma } from '@prisma/client';

/**
 * PUENTE con el motor de PARTICIPACIONES GLOBALES (socio 10 %, PM 2 %…), que se
 * está construyendo en paralelo dentro de `referrals/`.
 *
 * El reporte solo necesita LEER dos cosas de ese motor: quiénes son
 * beneficiarios (para ponerlos en «Socios comerciales») y de qué negocio es una
 * fila de participación (nace sin `referralUseId`; el negocio va en
 * `Commission.ventaTenantId`).
 *
 * Todo pasa por aquí y nada más lo toca, a propósito: si el motor cambia un
 * nombre, se ajusta este archivo y el resto del reporte no se entera. Y se lee
 * del DMMF si la columna existe, para que el reporte compile y funcione con o
 * sin el motor desplegado (si no existe, simplemente no hay participaciones).
 */

function campoDeComision(nombre: string): boolean {
  const m = Prisma.dmmf.datamodel.models.find((x) => x.name === 'Commission');
  return !!m?.fields.some((f) => f.name === nombre);
}

export const HAY_VENTA_TENANT_ID = campoDeComision('ventaTenantId');
export const HAY_PARTICIPACION_ID = campoDeComision('participacionId');

/** Negocio de una fila de participación, o null. */
export function negocioDeParticipacion(c: unknown): string | null {
  const v = (c as Record<string, unknown> | null)?.ventaTenantId;
  return typeof v === 'string' && v ? v : null;
}

/** ¿Es la parte de un beneficiario global y no la comisión de quien vendió? */
export function esParticipacion(c: unknown): boolean {
  const v = (c as Record<string, unknown> | null)?.participacionId;
  return typeof v === 'string' && v.length > 0;
}

/** Id del ingreso que originó la participación (su clave de venta). */
export function ingresoDeParticipacion(c: unknown): string | null {
  const v = (c as Record<string, unknown> | null)?.ingresoId;
  return typeof v === 'string' && v ? v : null;
}

/**
 * Códigos beneficiarios de alguna participación global. Vacío si el modelo no
 * existe todavía o la tabla no está migrada: el reporte sigue funcionando.
 */
export async function beneficiariosDeParticipaciones(prisma: unknown): Promise<Set<string>> {
  const modelo = (prisma as Record<string, any>)?.participacionGlobal;
  if (!modelo?.findMany) return new Set();
  try {
    const filas: Array<{ beneficiarioCodeId: string }> = await modelo.findMany({
      select: { beneficiarioCodeId: true },
    });
    return new Set(filas.map((f) => f.beneficiarioCodeId));
  } catch {
    return new Set();
  }
}
