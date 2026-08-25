import { describe, it, expect } from 'vitest';
import {
  getCanonicalBundlePrice,
  CANONICAL_BUNDLE_PRICES,
  SettingLookup,
} from './plan-pricing';

/** Stub mínimo de prisma.setting con los overrides que queramos simular. */
function dbWith(settings: Record<string, string | null> = {}): SettingLookup & {
  keysConsultadas: string[];
} {
  const keysConsultadas: string[] = [];
  return {
    keysConsultadas,
    setting: {
      async findUnique({ where }: { where: { key: string } }) {
        keysConsultadas.push(where.key);
        return where.key in settings ? { value: settings[where.key] } : null;
      },
    },
  };
}

describe('getCanonicalBundlePrice', () => {
  it('sin Setting devuelve los canónicos 68/150/278/500 según periodicidad', async () => {
    const db = dbWith();
    expect(await getCanonicalBundlePrice(db, 'MENSUAL')).toBe(68);
    expect(await getCanonicalBundlePrice(db, 'TRIMESTRAL')).toBe(150);
    expect(await getCanonicalBundlePrice(db, 'SEMESTRAL')).toBe(278);
    expect(await getCanonicalBundlePrice(db, 'ANUAL')).toBe(500);
  });

  it('el override por Setting landing.plans.<period>.price manda sobre el canónico', async () => {
    const db = dbWith({ 'landing.plans.trimestral.price': '199' });
    expect(await getCanonicalBundlePrice(db, 'TRIMESTRAL')).toBe(199);
    // La key consultada es exactamente la del panel de landing (en minúscula).
    expect(db.keysConsultadas).toEqual(['landing.plans.trimestral.price']);
  });

  it('un Setting inválido (no numérico, cero o negativo) cae al canónico', async () => {
    expect(
      await getCanonicalBundlePrice(
        dbWith({ 'landing.plans.mensual.price': 'abc' }),
        'MENSUAL',
      ),
    ).toBe(68);
    expect(
      await getCanonicalBundlePrice(
        dbWith({ 'landing.plans.anual.price': '0' }),
        'ANUAL',
      ),
    ).toBe(500);
    expect(
      await getCanonicalBundlePrice(
        dbWith({ 'landing.plans.anual.price': null }),
        'ANUAL',
      ),
    ).toBe(500);
  });

  it('periodicidad null o desconocida → MENSUAL (convención global), nunca 0', async () => {
    const db = dbWith();
    expect(await getCanonicalBundlePrice(db, null)).toBe(68);
    expect(await getCanonicalBundlePrice(db, undefined)).toBe(68);
    expect(await getCanonicalBundlePrice(db, 'SEMANAL')).toBe(68);
    // Consulta siempre una key válida (mensual), no landing.plans.semanal.price.
    expect(db.keysConsultadas.every((k) => k === 'landing.plans.mensual.price')).toBe(true);
  });

  it('acepta minúsculas en la periodicidad (normaliza antes del lookup)', async () => {
    expect(await getCanonicalBundlePrice(dbWith(), 'trimestral')).toBe(150);
  });

  it('la tabla canónica cubre exactamente las 4 periodicidades', () => {
    expect(Object.keys(CANONICAL_BUNDLE_PRICES).sort()).toEqual([
      'ANUAL',
      'MENSUAL',
      'SEMESTRAL',
      'TRIMESTRAL',
    ]);
  });
});
