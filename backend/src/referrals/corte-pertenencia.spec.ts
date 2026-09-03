import { describe, it, expect } from 'vitest';
import { nombreDePlan } from './plan-label';

/**
 * Qué comisiones pertenecen a un corte, y cómo se nombra su plan.
 *
 * ── El fallo del dinero (31-08-2026) ──────────────────────────────────────
 *
 * Para engancharse a un corte se exigía «aprobada Y pendiente de pago». Así
 * que una comisión pagada ANTES de que su corte se generara quedaba fuera
 * para siempre: cuando el corte nacía, ya no la veía.
 *
 * Pasó de verdad. Nueve comisiones creadas entre el 1 y el 13 de agosto y
 * pagadas todas el 24 pertenecían al corte del 31, que se generó una semana
 * después de cobrarlas. El historial decía 17 comisiones por $205.40 cuando se
 * habían pagado 21 por $303.85.
 *
 * Un corte es un PERÍODO CONTABLE, no una cola de pago: que ya se haya
 * transferido no saca a la comisión de su período.
 */

type Estado = 'PENDING' | 'APPROVED' | 'PAID' | 'REJECTED';

/** Espejo de `ATTACHABLE_BASE`: ¿puede engancharse a un corte? */
function seEngancha(estado: Estado, tieneDestinatario: boolean): boolean {
  return (estado === 'APPROVED' || estado === 'PAID') && tieneDestinatario;
}

/** Espejo de `PAYABLE_BASE`: ¿queda por pagar? */
function quedaPorPagar(estado: Estado, pago: 'PENDING' | 'PARTIAL' | 'PAID'): boolean {
  return estado === 'APPROVED' && (pago === 'PENDING' || pago === 'PARTIAL');
}

describe('una comisión ya pagada sigue perteneciendo a su corte', () => {
  it('PAGADA se engancha — es el caso de las 9 que se perdieron', () => {
    expect(seEngancha('PAID', true)).toBe(true);
  });

  it('APROBADA y sin pagar se engancha, como siempre', () => {
    expect(seEngancha('APPROVED', true)).toBe(true);
  });
});

describe('lo que NO debe entrar a un corte', () => {
  it('la que sigue retenida no entra: pertenece a un corte posterior', () => {
    expect(seEngancha('PENDING', true)).toBe(false);
  });

  it('la anulada no entra', () => {
    expect(seEngancha('REJECTED', true)).toBe(false);
  });

  it('sin destinatario no entra: no hay a quién transferirle', () => {
    expect(seEngancha('PAID', false)).toBe(false);
    expect(seEngancha('APPROVED', false)).toBe(false);
  });
});

describe('«qué pertenece al corte» y «qué queda por pagar» son cosas distintas', () => {
  it('una pagada pertenece al corte pero NO queda por pagar', () => {
    expect(seEngancha('PAID', true)).toBe(true);
    expect(quedaPorPagar('PAID', 'PAID')).toBe(false);
  });

  it('una aprobada sin pagar cumple las dos', () => {
    expect(seEngancha('APPROVED', true)).toBe(true);
    expect(quedaPorPagar('APPROVED', 'PENDING')).toBe(true);
  });

  it('un pago parcial sigue quedando por pagar', () => {
    expect(quedaPorPagar('APPROVED', 'PARTIAL')).toBe(true);
  });
});

/**
 * ── El nombre del plan ────────────────────────────────────────────────────
 *
 * El corte mostraba «Elite», que es el nombre interno del `Plan` — un SKU para
 * el gating y para Hotmart. Un negocio no tiene contratado «Elite»: tiene un
 * plan mensual, trimestral, semestral o anual.
 */
describe('el plan se nombra por su periodicidad, nunca por el SKU', () => {
  it('cada periodicidad tiene su nombre', () => {
    expect(nombreDePlan('MENSUAL')).toBe('Plan Mensual');
    expect(nombreDePlan('TRIMESTRAL')).toBe('Plan Trimestral');
    expect(nombreDePlan('SEMESTRAL')).toBe('Plan Semestral');
    expect(nombreDePlan('ANUAL')).toBe('Plan Anual');
  });

  it('sin periodicidad no se inventa un plan: el panel pinta «—»', () => {
    expect(nombreDePlan(null)).toBeNull();
    expect(nombreDePlan(undefined)).toBeNull();
    expect(nombreDePlan('')).toBeNull();
  });

  it('una periodicidad desconocida tampoco se pinta a medias', () => {
    expect(nombreDePlan('QUINCENAL')).toBeNull();
  });

  it('nunca devuelve el nombre interno', () => {
    for (const p of ['MENSUAL', 'ANUAL', null, 'Elite']) {
      expect(nombreDePlan(p as string)).not.toBe('Elite');
    }
  });
});

/**
 * ── Los otros dos agujeros del mismo corte (31-08-2026) ───────────────────
 *
 * El corte del 15-08 seguía sin cuadrar con la transferencia después del fix
 * de arriba: decía $343.15 contra $303.85 realmente transferidos. Los $39.30
 * de diferencia eran dos fallos distintos, los dos por lo mismo: **el corte se
 * engancha UNA vez y nunca se vuelve a mirar**.
 */

/** Espejo de la 3ª rama de `dayWindowWhere`: ¿absorbe lo habilitado a mano? */
function absorbeAdelantadas(ymdDelCorte: string, hoyYmd: string): boolean {
  return ymdDelCorte >= hoyYmd;
}

describe('lo habilitado a mano entra al corte VIGENTE, no al más viejo', () => {
  it('un corte cuya fecha ya pasó NO absorbe lo adelantado', () => {
    // El fallo real: Hydor, Quipao y Monet ($25) se habilitaron para el 30-08
    // y `topUpOpenBatches` —que recorre los abiertos de más viejo a más
    // nuevo— las pegó al corte del 15, que ya se había transferido.
    expect(absorbeAdelantadas('2026-08-15', '2026-08-31')).toBe(false);
  });

  it('el corte vigente sí las absorbe: para eso se habilitan a mano', () => {
    expect(absorbeAdelantadas('2026-08-31', '2026-08-31')).toBe(true);
    expect(absorbeAdelantadas('2026-09-15', '2026-08-31')).toBe(true);
  });
});

/** Espejo de `desengancharAnuladas`. */
function siguePegadaAlCorte(
  estado: Estado,
  estadoDelCorte: 'OPEN' | 'PAID' | 'CLOSED',
): boolean {
  if (estado !== 'REJECTED') return true;
  return estadoDelCorte !== 'OPEN';
}

describe('anular una comisión la saca del corte', () => {
  it('el duplicado anulado se desengancha del corte abierto', () => {
    // Tubiñez ($7.50) y Delizzibo ($6.80): dos filas por el mismo cobro, una
    // anulada y otra buena que sí se pagó. La anulada seguía sumando.
    expect(siguePegadaAlCorte('REJECTED', 'OPEN')).toBe(false);
  });

  it('un corte ya cerrado no se reescribe, ni por una anulada dentro', () => {
    expect(siguePegadaAlCorte('REJECTED', 'CLOSED')).toBe(true);
  });

  it('las que no se anulan no se mueven', () => {
    expect(siguePegadaAlCorte('APPROVED', 'OPEN')).toBe(true);
    expect(siguePegadaAlCorte('PAID', 'OPEN')).toBe(true);
  });
});

/** Espejo del destino de corte al pagar una comisión suelta. */
function corteAlPagar(
  corteActual: { id: string; status: 'OPEN' | 'PAID' | 'CLOSED' } | null,
  enLiquidacion: { id: string } | null,
): string | null {
  if (!corteActual) return enLiquidacion?.id ?? null;
  if (enLiquidacion && corteActual.status === 'OPEN') return enLiquidacion.id;
  return corteActual.id;
}

describe('pagar una comisión la mete en el corte que se está liquidando', () => {
  const liquidando = { id: 'corte-15' };

  it('sin corte: se engancha al que se liquida — las 9 que se perdieron', () => {
    expect(corteAlPagar(null, liquidando)).toBe('corte-15');
  });

  it('adelantada en un corte abierto POSTERIOR: se trae al que se liquida', () => {
    // Se habilita a mano antes de cumplir la retención y se paga en la
    // transferencia de ahora. Si se queda en su corte futuro, el que se
    // liquida no cuadra con lo transferido.
    expect(corteAlPagar({ id: 'corte-31', status: 'OPEN' }, liquidando)).toBe('corte-15');
  });

  it('un corte CERRADO no se toca: es contabilidad hecha', () => {
    expect(corteAlPagar({ id: 'corte-jul', status: 'CLOSED' }, liquidando)).toBe('corte-jul');
    expect(corteAlPagar({ id: 'corte-jun', status: 'PAID' }, liquidando)).toBe('corte-jun');
  });

  it('sin ningún corte abierto, el pago no inventa uno', () => {
    expect(corteAlPagar(null, null)).toBeNull();
  });
});
