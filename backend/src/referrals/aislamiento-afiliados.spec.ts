import { describe, it, expect } from 'vitest';

/**
 * Un admin de marca blanca solo puede tocar afiliados de SU marca.
 *
 * Por qué hace falta comprobarlo a mano en cada método:
 *
 *   1. El middleware de Prisma solo cubre modelos que tienen `tenantId`
 *      (`MODELS_WITH_TENANT_ID` se construye filtrando por ese campo).
 *      `ReferralCode` NO lo tiene — lleva `whiteLabelId`. Sus consultas pasan
 *      sin filtro ninguno.
 *   2. El rol tampoco separa: `SUPER_ADMIN` lo tienen también los
 *      administradores de cada marca blanca.
 *
 * Sin las guardas, el admin de Sellea podía cambiarle la CONTRASEÑA a un
 * afiliado de Clubify, borrarle el código, reorganizarle el árbol o marcarle
 * comisiones como pagadas — con solo conocer el id.
 *
 * Copias fieles de `assertCodigoDeSuMarca` / `assertComisionDeSuMarca`.
 */

const CLUBIFY = 'wl-clubify';
const SELLEA = 'wl-sellea';

class Prohibido extends Error {}

/** Espejo de `assertCodigoDeSuMarca`. */
function puedeTocarCodigo(
  sesionWl: string | null,
  codigoWl: string | null | undefined,
): boolean {
  if (!sesionWl) return true; // plataforma: administra a todos
  if (codigoWl === undefined) throw new Prohibido('no existe');
  return codigoWl === sesionWl;
}

/** Espejo de `assertComisionDeSuMarca`: se mira quien COBRA. */
function puedeTocarComision(
  sesionWl: string | null,
  destinatarioWl: string | null | undefined,
): boolean {
  if (!sesionWl) return true;
  if (destinatarioWl === undefined) return false; // sin destinatario, no
  return destinatarioWl === sesionWl;
}

describe('afiliados de otra marca', () => {
  it('el admin de Sellea NO puede tocar un afiliado de Clubify', () => {
    expect(puedeTocarCodigo(SELLEA, CLUBIFY)).toBe(false);
  });

  it('el admin de Sellea SÍ puede tocar los suyos', () => {
    expect(puedeTocarCodigo(SELLEA, SELLEA)).toBe(true);
  });

  it('tampoco puede tocar los legacy sin marca', () => {
    // Un código sin marca es de Clubify por convención: no es suyo.
    expect(puedeTocarCodigo(SELLEA, null)).toBe(false);
  });

  it('un código inexistente se rechaza, no se ignora', () => {
    expect(() => puedeTocarCodigo(SELLEA, undefined)).toThrow(Prohibido);
  });
});

describe('la plataforma sigue administrando a todos', () => {
  it('sin marca en sesión se puede tocar cualquier código', () => {
    expect(puedeTocarCodigo(null, SELLEA)).toBe(true);
    expect(puedeTocarCodigo(null, CLUBIFY)).toBe(true);
    expect(puedeTocarCodigo(null, null)).toBe(true);
  });
});

describe('comisiones: manda la marca de quien cobra', () => {
  it('Sellea no puede marcar como pagada una comisión de Clubify', () => {
    expect(puedeTocarComision(SELLEA, CLUBIFY)).toBe(false);
  });

  it('Sellea sí puede con las suyas', () => {
    expect(puedeTocarComision(SELLEA, SELLEA)).toBe(true);
  });

  it('una comisión sin destinatario no la toca ninguna marca', () => {
    // Rows viejas sin `recipientCode`: mejor que no se puedan tocar a que se
    // puedan tocar desde la marca equivocada.
    expect(puedeTocarComision(SELLEA, undefined)).toBe(false);
  });

  it('la plataforma sí puede con las huérfanas', () => {
    expect(puedeTocarComision(null, undefined)).toBe(true);
  });
});
