import { describe, it, expect } from 'vitest';
import { equipoDeColaborador, etiquetaDeColaborador, type MarcasDeEquipo } from './equipos';

const marcas = (p: Partial<MarcasDeEquipo> = {}): MarcasDeEquipo => ({
  socioCodeIds: new Set(),
  comisionDeEquipoCodeIds: new Set(),
  participacionesGlobales: new Set(),
  miembrosDeEquiposDeVenta: new Set(),
  ...p,
});

describe('a qué equipo va cada colaborador', () => {
  it.each(['INFLUENCER', 'AMBASSADOR', 'VENDOR'])('%s → closers', (role) => {
    expect(equipoDeColaborador({ codeId: 'x', role }, marcas())).toBe('CLOSERS');
  });

  it('rol SOCIO → socios comerciales', () => {
    expect(equipoDeColaborador({ codeId: 'x', role: 'SOCIO' }, marcas())).toBe('SOCIOS');
  });

  it('el socio de plataforma (ajuste) es socio aunque su código tenga otro rol', () => {
    expect(
      equipoDeColaborador({ codeId: 'javier', role: 'INFLUENCER' }, marcas({ socioCodeIds: new Set(['javier']) })),
    ).toBe('SOCIOS');
  });

  it('una participación global del motor nuevo es socio', () => {
    expect(
      equipoDeColaborador({ codeId: 'p', role: 'INFLUENCER' }, marcas({ participacionesGlobales: new Set(['p']) })),
    ).toBe('SOCIOS');
  });

  it('la comisión de equipo va a Administración aunque el código sea de influencer', () => {
    // El rol por defecto de ReferralCode es INFLUENCER: sin esta regla, la PM
    // saldría entre los closers.
    expect(
      equipoDeColaborador({ codeId: 'sara', role: 'INFLUENCER' }, marcas({ comisionDeEquipoCodeIds: new Set(['sara']) })),
    ).toBe('ADMINISTRACION');
  });

  it('un miembro de un equipo de ventas sin rol de afiliado es closer', () => {
    expect(
      equipoDeColaborador({ codeId: 'm', role: null }, marcas({ miembrosDeEquiposDeVenta: new Set(['m']) })),
    ).toBe('CLOSERS');
  });

  it('lo demás → Administración y otros', () => {
    expect(equipoDeColaborador({ codeId: 'z', role: null }, marcas())).toBe('ADMINISTRACION');
  });

  it('la etiqueta del desplegable: nombre — rol / equipo', () => {
    expect(etiquetaDeColaborador({ nombre: 'Ana', role: 'AMBASSADOR', equipo: 'CLOSERS' })).toBe(
      'Ana — Embajador / Equipo de closers',
    );
    expect(
      etiquetaDeColaborador({ nombre: 'Luis', role: 'VENDOR', equipo: 'CLOSERS', equipoDeVenta: 'Equipo Norte' }),
    ).toBe('Luis — Vendedor / Equipo Norte');
  });
});
