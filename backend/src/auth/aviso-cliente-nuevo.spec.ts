import { describe, it, expect } from 'vitest';
import { PreregAlertsService, fechaHoraColombia } from './prereg-alerts.service';

/**
 * El aviso de cliente nuevo.
 *
 * Javier pidió que a Samuel le llegue «Cliente nuevo: nombre, negocio,
 * teléfono». El nombre y el teléfono ya estaban; **el negocio no**, y es el
 * dato que dice de quién se trata — «Doralis rodriguez reyes» sin más no le
 * dice nada a quien lo recibe.
 *
 * Ojo con la confusión que esto esconde: `brandName` es la MARCA de la
 * plataforma (Clubify, Sellea) y `businessName` es el NEGOCIO que se acaba de
 * crear (Laly.com). Mezclarlos es como se cuelan las fugas de marca.
 */
function mensaje(opts: Record<string, unknown>) {
  // Dos dependencias, no tres. `nest build --tsc` compila los .spec.ts, asi que
  // un argumento de mas aqui tumba el build de produccion.
  const svc = new PreregAlertsService({} as any, {} as any) as any;
  return svc.buildMessage({
    customerName: 'Doralis rodriguez reyes',
    customerEmail: 'dorore.4@hotmail.com',
    customerPhone: '573104849820',
    source: 'Landing principal',
    ...opts,
  });
}

describe('aviso de cliente nuevo', () => {
  it('lleva nombre, NEGOCIO y teléfono', () => {
    const m = mensaje({ businessName: 'Laly.com' });
    expect(m).toContain('Nombre: Doralis rodriguez reyes');
    expect(m).toContain('Negocio: Laly.com');
    expect(m).toContain('Teléfono: 573104849820');
  });

  it('el negocio va JUSTO debajo del nombre, que es como se lee', () => {
    const m: string = mensaje({ businessName: 'Laly.com' });
    const lineas = m.split('\n');
    const iNombre = lineas.findIndex((l) => l.startsWith('Nombre:'));
    expect(lineas[iNombre + 1]).toBe('Negocio: Laly.com');
  });

  it('sin negocio no deja una línea vacía diciendo «Negocio: —»', () => {
    // Un preregistro puede no tener negocio todavía. Mejor no decir nada que
    // enseñar un hueco.
    const m: string = mensaje({});
    expect(m).not.toContain('Negocio:');
    expect(m).toContain('Nombre:');
  });

  it('el NEGOCIO no se confunde con la MARCA de la plataforma', () => {
    // `brandName` titula el aviso («Nuevo preregistro en Sellea»); el negocio
    // es otra linea. Si se mezclaran, el aviso de un negocio de Sellea diria
    // el nombre de la marca donde va el del cliente.
    const m: string = mensaje({ brandName: 'Sellea', businessName: 'Laly.com' });
    expect(m).toContain('Nuevo preregistro en Sellea');
    expect(m).toContain('Negocio: Laly.com');
  });
});

describe('fecha del aviso en hora de Colombia', () => {
  it('13:24 UTC se lee como 8:24 a. m. en Bogotá', () => {
    // El caso real: el servidor está en UTC y el aviso decía «1:24 p. m.».
    const t = fechaHoraColombia(new Date('2026-10-23T13:24:00Z'));
    expect(t).toContain('23/10/2026');
    expect(t).toMatch(/8:24\s*a/);
  });

  it('cerca de medianoche UTC cambia de día', () => {
    // 03:10 UTC del 24 = 10:10 p. m. del 23 en Colombia.
    const t = fechaHoraColombia(new Date('2026-10-24T03:10:00Z'));
    expect(t).toContain('23/10/2026');
    expect(t).toMatch(/10:10\s*p/);
  });

  it('el aviso dice que es hora Colombia', () => {
    expect(mensaje({})).toMatch(/Fecha: .+ \(hora Colombia\)/);
  });
});
