import { describe, it, expect } from 'vitest';
import { respaldoVencido } from './frescura-del-respaldo';

/**
 * El antecedente que esto vigila: 135 noches seguidas sin respaldo y ni un
 * aviso. Se prueba tanto que suene cuando falta como que CALLE cuando está
 * bien — una alarma que suena sin motivo se ignora, y entonces no hay alarma.
 */
const h = (n: number) => new Date(Date.parse('2026-09-28T13:00:00Z') - n * 3_600_000);
const AHORA = new Date('2026-09-28T13:00:00Z');

describe('respaldoVencido', () => {
  it('sin ningún respaldo, suena con el motivo más serio', () => {
    const v = respaldoVencido(null, AHORA);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.motivo).toMatch(/NINGÚN respaldo/);
  });

  it('el respaldo de esta madrugada (10 h) NO suena', () => {
    expect(respaldoVencido(h(10), AHORA).ok).toBe(true);
  });

  it('un job que un día se retrasa unas horas tampoco suena: 25 h pasa', () => {
    // El tope es 26 y no 24 a propósito: con 24 justas, cualquier reintento
    // tardío sonaría sin motivo.
    expect(respaldoVencido(h(25), AHORA).ok).toBe(true);
  });

  it('27 horas ya es una noche perdida: suena', () => {
    const v = respaldoVencido(h(27), AHORA);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.motivo).toMatch(/27 horas/);
  });

  it('tres días sin respaldo lo dice en días, que se lee de un vistazo', () => {
    const v = respaldoVencido(h(75), AHORA);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.motivo).toMatch(/3 día\(s\)/);
  });
});
