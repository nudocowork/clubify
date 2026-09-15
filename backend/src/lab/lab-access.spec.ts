/**
 * Quién usa el Lab y de qué marca. NO necesita base de datos.
 *
 * Por qué. El Lab se abrió a las marcas blancas y el panel de un afiliado de
 * Sellea enseñaba «Sellea Lab» con «Clubify Lab» dentro. Javier decidió
 * (2026-09-15) que en una marca blanca solo lo use su administrador general, y
 * que la plataforma vea las propuestas de todas las marcas, con etiqueta. Si
 * estas reglas se aflojan, un afiliado de la marca vuelve a entrar, o el admin
 * de una marca lee y modera las propuestas de Clubify.
 */
import { describe, it, expect } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import {
  FILTRO_PLATAFORMA,
  LAB_MODERACION_SOLO_PLATAFORMA,
  LAB_SOLO_ADMIN_DE_MARCA,
  LAB_SUPLANTACION_SOLO_LECTURA,
  conEtiquetaDeMarca,
  exigirModeracion,
  exigirParticipacion,
  filtroAdminPorMarca,
  filtroDeMarca,
  mismaMarca,
  puedeParticipar,
  puedeVerPropuesta,
  resolverVisorLab,
  type DatosDelVisor,
} from './lab-access';

const CLUBIFY = 'wl-clubify';
const SELLEA = 'wl-sellea';
const OTRA = 'wl-otra';

function visor(datos: Omit<DatosDelVisor, 'clubifyId'>) {
  return resolverVisorLab({ clubifyId: CLUBIFY, ...datos });
}

function prohibido(fn: () => unknown, mensaje: string) {
  let error: unknown = null;
  try {
    fn();
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(ForbiddenException);
  expect((error as ForbiddenException).message).toBe(mensaje);
}

describe('quién entra al Lab', () => {
  it('el administrador general de Sellea entra al Lab de Sellea', () => {
    expect(
      visor({ role: 'SUPER_ADMIN', sesionWhiteLabelId: SELLEA, usuarioWhiteLabelId: SELLEA }),
    ).toEqual({
      alcance: 'MARCA_ADMIN',
      whiteLabelId: SELLEA,
      clubifyId: CLUBIFY,
      soloLectura: false,
    });
  });

  it('manda la marca de la sesión: el dueño de la plataforma que entra a Sellea es su admin', () => {
    // `impersonateWhiteLabel` puede usar una identidad sin marca propia.
    const v = visor({ role: 'SUPER_ADMIN', sesionWhiteLabelId: SELLEA, usuarioWhiteLabelId: null });
    expect(v.alcance).toBe('MARCA_ADMIN');
    expect(v.whiteLabelId).toBe(SELLEA);
  });

  it('suplantado desde el panel maestro: ve el Lab de la marca, pero en solo lectura', () => {
    // El token lleva el `sub` del administrador real: lo escrito saldría a su nombre.
    const v = visor({ role: 'SUPER_ADMIN', sesionWhiteLabelId: SELLEA, suplantadoPor: 'u-javier' });
    expect(v).toMatchObject({ alcance: 'MARCA_ADMIN', whiteLabelId: SELLEA, soloLectura: true });
    expect(puedeVerPropuesta(v, SELLEA)).toBe(true);
    expect(puedeParticipar(v, SELLEA)).toBe(false);
    prohibido(() => exigirParticipacion(v), LAB_SUPLANTACION_SOLO_LECTURA);
  });

  it('un admin de Clubify es el equipo de la plataforma, con la marca en null o con la fila Clubify', () => {
    expect(visor({ role: 'SUPER_ADMIN' }).alcance).toBe('PLATAFORMA_EQUIPO');
    expect(visor({ role: 'SUPER_ADMIN', sesionWhiteLabelId: CLUBIFY }).alcance).toBe(
      'PLATAFORMA_EQUIPO',
    );
    expect(visor({ role: 'MARKETING' }).alcance).toBe('PLATAFORMA_EQUIPO');
  });

  it('MARKETING de una marca blanca no es su administrador general', () => {
    prohibido(
      () => visor({ role: 'MARKETING', sesionWhiteLabelId: SELLEA }),
      LAB_SOLO_ADMIN_DE_MARCA,
    );
  });

  it.each([
    'AFFILIATE_INFLUENCER',
    'AFFILIATE_AMBASSADOR',
    'AFFILIATE_VENDOR',
    'AFFILIATE_SOCIO',
  ])('%s de Sellea se queda fuera, con el motivo en español', (role) => {
    prohibido(() => visor({ role, codigoWhiteLabelId: SELLEA }), LAB_SOLO_ADMIN_DE_MARCA);
  });

  it('los afiliados de Clubify siguen entrando, con código de Clubify o uno histórico sin marca', () => {
    expect(visor({ role: 'AFFILIATE_AMBASSADOR', codigoWhiteLabelId: CLUBIFY }).alcance).toBe(
      'PLATAFORMA_MIEMBRO',
    );
    expect(visor({ role: 'AFFILIATE_INFLUENCER', codigoWhiteLabelId: null }).alcance).toBe(
      'PLATAFORMA_MIEMBRO',
    );
  });

  it('el dueño de un negocio de Sellea se queda fuera; el de uno de Clubify entra', () => {
    prohibido(
      () => visor({ role: 'TENANT_OWNER', negocioWhiteLabelId: SELLEA }),
      LAB_SOLO_ADMIN_DE_MARCA,
    );
    expect(visor({ role: 'TENANT_OWNER', negocioWhiteLabelId: null }).alcance).toBe(
      'PLATAFORMA_MIEMBRO',
    );
    expect(visor({ role: 'TENANT_OWNER', negocioWhiteLabelId: CLUBIFY }).alcance).toBe(
      'PLATAFORMA_MIEMBRO',
    );
  });
});

describe('qué propuestas ve y toca cada uno', () => {
  const humberto = visor({ role: 'SUPER_ADMIN', sesionWhiteLabelId: SELLEA });
  const equipo = visor({ role: 'SUPER_ADMIN' });
  const afiliadoClubify = visor({ role: 'AFFILIATE_AMBASSADOR', codigoWhiteLabelId: CLUBIFY });

  it('el admin de Sellea no ve ni toca las de Clubify, las históricas ni las de otra marca', () => {
    for (const wl of [null, CLUBIFY, OTRA]) {
      expect(puedeVerPropuesta(humberto, wl)).toBe(false);
      expect(puedeParticipar(humberto, wl)).toBe(false);
    }
    expect(puedeVerPropuesta(humberto, SELLEA)).toBe(true);
    expect(puedeParticipar(humberto, SELLEA)).toBe(true);
    expect(() => exigirParticipacion(humberto)).not.toThrow();
  });

  it('un afiliado de Clubify ve las de Clubify y las históricas, no las de Sellea', () => {
    expect(puedeVerPropuesta(afiliadoClubify, null)).toBe(true);
    expect(puedeVerPropuesta(afiliadoClubify, CLUBIFY)).toBe(true);
    expect(puedeVerPropuesta(afiliadoClubify, SELLEA)).toBe(false);
  });

  it('el equipo de la plataforma ve las de todas las marcas, pero solo participa en las de Clubify', () => {
    expect(puedeVerPropuesta(equipo, SELLEA)).toBe(true);
    expect(puedeParticipar(equipo, SELLEA)).toBe(false);
    expect(puedeParticipar(equipo, null)).toBe(true);
    expect(puedeParticipar(equipo, CLUBIFY)).toBe(true);
  });

  it('la moderación es solo del equipo de la plataforma', () => {
    expect(() => exigirModeracion(equipo)).not.toThrow();
    prohibido(() => exigirModeracion(humberto), LAB_MODERACION_SOLO_PLATAFORMA);
    prohibido(() => exigirModeracion(afiliadoClubify), LAB_MODERACION_SOLO_PLATAFORMA);
  });

  it('el feed de la plataforma junta Clubify y las sin marca; el de Sellea es estricto', () => {
    expect(filtroDeMarca(equipo)).toEqual({
      OR: [{ whiteLabelId: null }, { whiteLabelId: CLUBIFY }],
    });
    expect(filtroDeMarca(afiliadoClubify)).toEqual(filtroDeMarca(equipo));
    expect(filtroDeMarca(humberto)).toEqual({ whiteLabelId: SELLEA });
  });

  it('el filtro por marca de la moderación', () => {
    const plataforma = { OR: [{ whiteLabelId: null }, { whiteLabelId: CLUBIFY }] };
    expect(filtroAdminPorMarca(undefined, CLUBIFY)).toBeNull();
    expect(filtroAdminPorMarca(SELLEA, CLUBIFY)).toEqual({ whiteLabelId: SELLEA });
    expect(filtroAdminPorMarca(FILTRO_PLATAFORMA, CLUBIFY)).toEqual(plataforma);
    // Pedir la fila Clubify por id no puede dejar fuera las históricas.
    expect(filtroAdminPorMarca(CLUBIFY, CLUBIFY)).toEqual(plataforma);
  });

  it('misma marca para fusionar: la misma fila, o las dos de la plataforma', () => {
    expect(mismaMarca(null, CLUBIFY, CLUBIFY)).toBe(true);
    expect(mismaMarca(SELLEA, SELLEA, CLUBIFY)).toBe(true);
    expect(mismaMarca(SELLEA, null, CLUBIFY)).toBe(false);
    expect(mismaMarca(SELLEA, OTRA, CLUBIFY)).toBe(false);
  });
});

describe('etiqueta de marca en la moderación', () => {
  const marcas = new Map([
    [SELLEA, { id: SELLEA, name: 'Sellea', primaryColor: '#ff6b57' }],
  ]);

  it('las de una marca blanca llevan nombre y color; las de Clubify o sin marca, ninguna', () => {
    const r = conEtiquetaDeMarca(
      [
        { id: 'a', whiteLabelId: SELLEA },
        { id: 'b', whiteLabelId: CLUBIFY },
        { id: 'c', whiteLabelId: null },
      ],
      marcas,
      CLUBIFY,
    );
    expect(r.map((p) => p.brand)).toEqual([
      { id: SELLEA, name: 'Sellea', primaryColor: '#ff6b57' },
      null,
      null,
    ]);
  });

  it('una marca que ya no está en la base no se hace pasar por Clubify', () => {
    const [p] = conEtiquetaDeMarca([{ id: 'a', whiteLabelId: OTRA }], marcas, CLUBIFY);
    expect(p.brand).toEqual({ id: OTRA, name: 'Marca desconocida', primaryColor: null });
  });
});
