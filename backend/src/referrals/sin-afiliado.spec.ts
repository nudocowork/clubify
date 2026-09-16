import { describe, it, expect } from 'vitest';
import {
  quedaSinAfiliado,
  tieneAfiliadoQueCobra,
  type NegocioParaAtribucion,
} from './sin-afiliado';

/**
 * El aviso "⚠ Negocios sin afiliado" de /admin/commissions.
 *
 * EL FALLO (16-09-2026, Javier): listaba "Cevichería Marea Místika", que
 * pertenece al grupo empresarial "Aldehir - Grupo Mistika" — grupo que tiene
 * afiliado (TAFMPWK5) y que ya generó $15 pagada en julio y $15 aprobada en
 * agosto. La consulta sólo miraba el `ReferralUse` del negocio suelto.
 *
 * Fixtures tomadas de producción en solo lectura el 16-09-2026.
 */

// Grupo real CON afiliado activo: 3 miembros, 2 comisiones generadas.
const GRUPO_MISTIKA = {
  referralCodeId: 'code-TAFMPWK5',
  referralCode: { isActive: true },
};
// Grupos reales que existen en producción vacíos y SIN afiliado.
const GRUPO_SIN_AFILIADO = { referralCodeId: null };

describe('el negocio de un grupo que ya tiene afiliado no está huérfano', () => {
  it('Cevichería Marea Místika NO debe aparecer en el aviso', () => {
    // Sin ReferralUse propio: su comisión se genera por el grupo.
    const cevicheria: NegocioParaAtribucion = {
      atribuidoDirecto: false,
      grupo: GRUPO_MISTIKA,
    };
    expect(tieneAfiliadoQueCobra(cevicheria)).toBe(true);
    expect(quedaSinAfiliado(cevicheria)).toBe(false);
  });
});

describe('el aviso sigue avisando de los que de verdad no pagan a nadie', () => {
  it('El Tiros Club (sin grupo y sin atribución) SÍ aparece', () => {
    const tiros: NegocioParaAtribucion = {
      atribuidoDirecto: false,
      grupo: null,
    };
    expect(quedaSinAfiliado(tiros)).toBe(true);
  });

  it('un negocio de un grupo SIN afiliado SÍ aparece', () => {
    // EL PELIGRO del arreglo: si el candado fuera "pertenece a un grupo" en
    // vez de "el grupo tiene afiliado", este negocio desaparecería del aviso
    // aunque nadie cobre un peso por él. En producción hay 3 grupos así.
    const huerfanoEnGrupo: NegocioParaAtribucion = {
      atribuidoDirecto: false,
      grupo: GRUPO_SIN_AFILIADO,
    };
    expect(tieneAfiliadoQueCobra(huerfanoEnGrupo)).toBe(false);
    expect(quedaSinAfiliado(huerfanoEnGrupo)).toBe(true);
  });

  it('un grupo con referralCodeId vacío tampoco cuenta como afiliado', () => {
    expect(
      quedaSinAfiliado({ atribuidoDirecto: false, grupo: { referralCodeId: '' } }),
    ).toBe(true);
  });

  it('un grupo con el código DESACTIVADO SÍ aparece', () => {
    // La segunda puerta al mismo peligro: el grupo tiene `referralCodeId`,
    // pero el código está inactivo y `generateGroupCommission` aborta con
    // 'code-inactivo'. Nadie cobra → el aviso tiene que verlo. Si mañana se
    // desactiva TAFMPWK5, los 3 negocios de Mistika entran aquí.
    const grupoDesactivado: NegocioParaAtribucion = {
      atribuidoDirecto: false,
      grupo: {
        referralCodeId: 'code-TAFMPWK5',
        referralCode: { isActive: false },
      },
    };
    expect(tieneAfiliadoQueCobra(grupoDesactivado)).toBe(false);
    expect(quedaSinAfiliado(grupoDesactivado)).toBe(true);
  });

  it('si el código del grupo no se seleccionó, no se da por inactivo', () => {
    // Tolerancia deliberada: `isActive !== false`, igual que el generador. Sin
    // esto, olvidar el `select` escondería el grupo entero al revés.
    expect(
      quedaSinAfiliado({
        atribuidoDirecto: false,
        grupo: { referralCodeId: 'code-X' },
      }),
    ).toBe(false);
  });
});

describe('la atribución directa sigue mandando', () => {
  it('con ReferralUse propio no aparece, tenga grupo o no', () => {
    for (const grupo of [null, GRUPO_SIN_AFILIADO, GRUPO_MISTIKA]) {
      expect(quedaSinAfiliado({ atribuidoDirecto: true, grupo })).toBe(false);
    }
  });
});
