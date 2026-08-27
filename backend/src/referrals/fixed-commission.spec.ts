import { describe, it, expect } from 'vitest';

/**
 * Invariantes de la COMISIÓN FIJA de referidos (EXCLUSIVO marcas FIXED_ONCE,
 * hoy Sellea). Espeja la decisión que hace el motor en
 * `billing/hotmart.service.ts` → generateReferralCommission (bloque de la
 * comisión directa). Si tocás esa lógica, actualizá esta función.
 *
 * Reglas:
 *  - Marca NO fija → monto = %·base, periodKey = mes (recurrente), permite indirecta.
 *  - Marca fija → monto FIJO, periodKey = 'ONCE' (una sola vez para siempre; la
 *    @@unique([referralUseId,recipientCodeId,periodKey]) bloquea renovaciones),
 *    sin indirecta. El monto sale del código (negocio lo trae) o, si es null,
 *    por rol de la config de la marca (influencer / embajador).
 */
type Input = {
  fixedOnceBrand: boolean;
  codeFixedUsd: number | null;
  role: 'INFLUENCER' | 'AMBASSADOR';
  fixedInfluencer: number;
  fixedEmbajador: number;
  percentAmount: number;
};
type Result = { amount: number; periodKey: string; indirect: boolean; socio: boolean };

function resolveDirect(i: Input): Result {
  if (!i.fixedOnceBrand) {
    return { amount: i.percentAmount, periodKey: '2026-08', indirect: true, socio: true };
  }
  const amount =
    i.codeFixedUsd != null
      ? i.codeFixedUsd
      : i.role === 'AMBASSADOR'
        ? i.fixedEmbajador
        : i.fixedInfluencer;
  return { amount, periodKey: 'ONCE', indirect: false, socio: false };
}

const SELLEA = { fixedInfluencer: 80, fixedEmbajador: 40 };

describe('comisión fija de referidos (FIXED_ONCE)', () => {
  it('marca NORMAL (Clubify): % recurrente, con indirecta y socio — sin cambios', () => {
    const r = resolveDirect({
      fixedOnceBrand: false,
      codeFixedUsd: null,
      role: 'AMBASSADOR',
      ...SELLEA,
      percentAmount: 17,
    });
    expect(r.amount).toBe(17);
    expect(r.periodKey).not.toBe('ONCE'); // recurrente (mes)
    expect(r.indirect).toBe(true);
    expect(r.socio).toBe(true);
  });

  it('negocio-cliente (Sellea): el código trae $30 → paga $30 una sola vez', () => {
    const r = resolveDirect({
      fixedOnceBrand: true,
      codeFixedUsd: 30,
      role: 'INFLUENCER',
      ...SELLEA,
      percentAmount: 999, // el % se IGNORA por completo
    });
    expect(r.amount).toBe(30);
    expect(r.periodKey).toBe('ONCE');
    expect(r.indirect).toBe(false);
    expect(r.socio).toBe(false); // socio apagado para Sellea
  });

  it('influencer creado por admin (Sellea): código sin monto → $80 por rol', () => {
    const r = resolveDirect({
      fixedOnceBrand: true,
      codeFixedUsd: null,
      role: 'INFLUENCER',
      ...SELLEA,
      percentAmount: 999,
    });
    expect(r.amount).toBe(80);
    expect(r.periodKey).toBe('ONCE');
  });

  it('embajador (Sellea): código sin monto → $40 por rol', () => {
    const r = resolveDirect({
      fixedOnceBrand: true,
      codeFixedUsd: null,
      role: 'AMBASSADOR',
      ...SELLEA,
      percentAmount: 999,
    });
    expect(r.amount).toBe(40);
    expect(r.periodKey).toBe('ONCE');
  });

  it('renovación en Sellea: periodKey SIEMPRE "ONCE" → la constraint impide 2º pago', () => {
    // Primer cobro y una supuesta "renovación" resuelven el MISMO periodKey.
    const primero = resolveDirect({ fixedOnceBrand: true, codeFixedUsd: 30, role: 'INFLUENCER', ...SELLEA, percentAmount: 0 });
    const renovacion = resolveDirect({ fixedOnceBrand: true, codeFixedUsd: 30, role: 'INFLUENCER', ...SELLEA, percentAmount: 0 });
    expect(primero.periodKey).toBe('ONCE');
    expect(renovacion.periodKey).toBe('ONCE'); // misma clave → @@unique bloquea el duplicado
  });
});
