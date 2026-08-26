import { describe, it, expect } from 'vitest';

/**
 * Aislamiento por marca del panel de comisiones.
 *
 * El fallo que esto impide (26-08-2026): `listAdminCommissions` solo
 * comprobaba `user.role !== 'SUPER_ADMIN'`. Pero ese rol lo tienen TAMBIÉN los
 * administradores de cada marca blanca, así que el admin de Sellea abría su
 * panel y veía las comisiones de toda la plataforma — los 71 afiliados de
 * Clubify con sus importes y sus negocios.
 *
 * Copias fieles de la lógica de `referrals.service`; el módulo arrastra NestJS
 * y no se puede importar sin base de datos.
 */

const CLUBIFY = 'wl-clubify';
const SELLEA = 'wl-sellea';

/** Gemelo de `brandCommissionWhere`. */
function marcaWhere(
  sessionWlId: string | null,
  clubifyId: string | null = CLUBIFY,
): Record<string, any> {
  const wlId = sessionWlId ?? clubifyId;
  if (!wlId) return {};
  if (wlId === clubifyId) {
    return { OR: [{ whiteLabelId: clubifyId }, { whiteLabelId: null }] };
  }
  return { whiteLabelId: wlId };
}

/** Gemelo del armado de `baseWhere.recipientCode`. */
function construirWhere(opts: {
  whiteLabelId?: string | null;
  role?: string;
  todasLasMarcas?: boolean;
}): Record<string, any> {
  const base: any = {};
  const m = opts.todasLasMarcas ? {} : marcaWhere(opts.whiteLabelId ?? null);
  const recipiente: any = { ...m };
  if (opts.role) recipiente.role = opts.role;
  if (Object.keys(recipiente).length) base.recipientCode = recipiente;
  return base;
}

describe('cada marca ve solo lo suyo', () => {
  it('el admin de Sellea queda acotado a Sellea', () => {
    const w = construirWhere({ whiteLabelId: SELLEA });
    expect(w.recipientCode).toEqual({ whiteLabelId: SELLEA });
  });

  it('el admin de Clubify ve lo suyo Y lo legacy sin marca', () => {
    const w = construirWhere({ whiteLabelId: CLUBIFY });
    expect(w.recipientCode.OR).toEqual([
      { whiteLabelId: CLUBIFY },
      { whiteLabelId: null },
    ]);
  });

  it('sin marca en sesión se cae a Clubify, NUNCA a ver todo', () => {
    const w = construirWhere({ whiteLabelId: null });
    // Lo importante: que exista filtro. Un {} aquí es la fuga.
    expect(w.recipientCode).toBeDefined();
    expect(w.recipientCode.OR).toBeDefined();
  });
});

describe('el filtro de rol NO puede borrar el de marca', () => {
  // Era el riesgo real: `baseWhere.recipientCode = { role }` asignaba en vez
  // de fusionar, así que la fuga habría vuelto sola en cuanto alguien tocara
  // el desplegable de rol — y solo a veces, que es lo peor.
  it('con rol Y marca, sobreviven los dos', () => {
    const w = construirWhere({ whiteLabelId: SELLEA, role: 'INFLUENCER' });
    expect(w.recipientCode).toEqual({
      whiteLabelId: SELLEA,
      role: 'INFLUENCER',
    });
  });

  it('en Clubify, el rol convive con el OR de marca', () => {
    const w = construirWhere({ whiteLabelId: CLUBIFY, role: 'VENDOR' });
    expect(w.recipientCode.role).toBe('VENDOR');
    expect(w.recipientCode.OR).toHaveLength(2);
  });

  it('filtrar por rol nunca deja el where sin marca', () => {
    for (const role of ['INFLUENCER', 'AMBASSADOR', 'VENDOR', 'SOCIO']) {
      const w = construirWhere({ whiteLabelId: SELLEA, role });
      expect(w.recipientCode.whiteLabelId).toBe(SELLEA);
    }
  });
});

describe('la excepción de TeamClubify', () => {
  it('con todasLasMarcas no se filtra por marca', () => {
    const w = construirWhere({ whiteLabelId: null, todasLasMarcas: true });
    expect(w.recipientCode).toBeUndefined();
  });

  it('aun sin filtro de marca, el de rol sigue funcionando', () => {
    const w = construirWhere({ todasLasMarcas: true, role: 'SOCIO' });
    expect(w.recipientCode).toEqual({ role: 'SOCIO' });
  });

  it('hay que PEDIRLO: no se hereda de ser administrador', () => {
    // Un SUPER_ADMIN de marca blanca sin `todasLasMarcas` queda acotado.
    const w = construirWhere({ whiteLabelId: SELLEA });
    expect(w.recipientCode.whiteLabelId).toBe(SELLEA);
  });
});

describe('entorno de desarrollo', () => {
  it('sin marca clubify configurada no se filtra, para no dejar el panel vacío', () => {
    expect(marcaWhere(null, null)).toEqual({});
  });
});
