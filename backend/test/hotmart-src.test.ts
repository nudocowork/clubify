import { describe, expect, it } from 'vitest';
import { parseWlIdFromSrc, parseAffiliateRawFromSrc } from '../src/billing/hotmart-src';

const UUID = 'dfd3cdff-7836-4aee-96a4-d7fa2b2907be';

describe('parseWlIdFromSrc — token de marca', () => {
  it('wl_<uuid> → uuid', () => {
    expect(parseWlIdFromSrc(`wl_${UUID}`)).toBe(UUID);
  });
  it('wl-<uuid> (guion) → uuid', () => {
    expect(parseWlIdFromSrc(`wl-${UUID}`)).toBe(UUID);
  });
  it('uuid pelado → uuid', () => {
    expect(parseWlIdFromSrc(UUID)).toBe(UUID);
  });
  it('combinado <CODE>-wl_<uuid> → uuid (ruteo de créditos sigue andando)', () => {
    expect(parseWlIdFromSrc(`TAFMPWK5-wl_${UUID}`)).toBe(UUID);
  });
  it('solo código de afiliado → null (no hay marca)', () => {
    expect(parseWlIdFromSrc('TAFMPWK5')).toBeNull();
  });
  it('vacío/null → null', () => {
    expect(parseWlIdFromSrc('')).toBeNull();
    expect(parseWlIdFromSrc(null)).toBeNull();
  });
});

describe('parseAffiliateRawFromSrc — código de afiliado', () => {
  it('solo código → el código', () => {
    expect(parseAffiliateRawFromSrc('TAFMPWK5')).toBe('TAFMPWK5');
  });
  it('combinado <CODE>-wl_<uuid> → el código (¡el fix!)', () => {
    expect(parseAffiliateRawFromSrc(`TAFMPWK5-wl_${UUID}`)).toBe('TAFMPWK5');
  });
  it('combinado wl_<uuid>-<CODE> (orden inverso) → el código', () => {
    expect(parseAffiliateRawFromSrc(`wl_${UUID}-TAFMPWK5`)).toBe('TAFMPWK5');
  });
  it('solo marca wl_<uuid> → null (no hay afiliado)', () => {
    expect(parseAffiliateRawFromSrc(`wl_${UUID}`)).toBeNull();
  });
  it('uuid pelado (marca) → null', () => {
    expect(parseAffiliateRawFromSrc(UUID)).toBeNull();
  });
  it('slug de afiliado (minúsculas) → se preserva', () => {
    expect(parseAffiliateRawFromSrc('nicolas-quintero')).toBe('nicolas-quintero');
  });
  it('vacío/null → null', () => {
    expect(parseAffiliateRawFromSrc('')).toBeNull();
    expect(parseAffiliateRawFromSrc(null)).toBeNull();
  });
});
