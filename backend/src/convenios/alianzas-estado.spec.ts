import { describe, it, expect } from 'vitest';
import {
  admiteActivaciones,
  cambiaLoQueSeVe,
  estaAgotado,
  estadoDelPase,
  motivoDelConvenio,
  motivoDelCupon,
  normalizarCodigo,
  normalizarDocumento,
  quienApago,
  type ConvenioParaEstado,
  type CuponParaEstado,
} from './alianzas-estado';

/**
 * Estos tests importan el MÓDULO REAL. Los 31 tests viejos de convenios
 * reimplementaban la lógica dentro del propio fichero de test y pasaban en
 * verde sin proteger nada: si el servicio se rompía, el test seguía contento
 * porque probaba su propia copia. Aquí, si `alianzas-estado.ts` se equivoca,
 * esto se pone rojo — que es para lo único que sirve un test.
 */

const AHORA = new Date('2026-09-01T15:00:00Z');
const AYER = new Date('2026-08-31T15:00:00Z');
const MANANA = new Date('2026-09-02T15:00:00Z');

function convenio(p: Partial<ConvenioParaEstado> = {}): ConvenioParaEstado {
  return { status: 'ACTIVE', endsAt: null, ...p };
}

function cupon(p: Partial<CuponParaEstado> = {}): CuponParaEstado {
  return {
    isActive: true,
    activoAliado: true,
    endsAt: null,
    maxTotal: null,
    canjesCount: 0,
    ...p,
  };
}

describe('el doble interruptor — la pieza nueva', () => {
  it('con las dos llaves encendidas el beneficio se puede usar', () => {
    expect(motivoDelCupon(cupon(), AHORA, null)).toBeNull();
  });

  it('el negocio apaga y el beneficio cae', () => {
    expect(motivoDelCupon(cupon({ isActive: false }), AHORA, null)).toBe(
      'Beneficio apagado por el negocio.',
    );
  });

  it('el aliado apaga y el beneficio cae, con SU mensaje', () => {
    expect(motivoDelCupon(cupon({ activoAliado: false }), AHORA, null)).toBe(
      'Beneficio apagado por la empresa aliada.',
    );
  });

  it('con las dos apagadas gana el mensaje del negocio: es quien puede resolverlo en el momento', () => {
    const c = cupon({ isActive: false, activoAliado: false });
    expect(quienApago(c)).toBe('ambos');
    expect(motivoDelCupon(c, AHORA, null)).toBe('Beneficio apagado por el negocio.');
  });

  it('LA PROPIEDAD QUE SOSTIENE TODO: encender una llave no levanta lo que apagó la otra', () => {
    // El aliado enciende la suya. La del negocio sigue apagada.
    const trasEncenderElAliado = cupon({ isActive: false, activoAliado: true });
    expect(motivoDelCupon(trasEncenderElAliado, AHORA, null)).not.toBeNull();

    // Y al revés: el negocio enciende la suya con la del aliado apagada.
    const trasEncenderElNegocio = cupon({ isActive: true, activoAliado: false });
    expect(motivoDelCupon(trasEncenderElNegocio, AHORA, null)).not.toBeNull();
  });
});

describe('agotado se calcula, no se guarda', () => {
  it('al llegar al tope el cupón queda agotado sin tocar ninguna bandera', () => {
    const c = cupon({ maxTotal: 3, canjesCount: 3 });
    expect(estaAgotado(c)).toBe(true);
    // isActive sigue en true: nadie lo apagó, se acabó.
    expect(c.isActive).toBe(true);
    expect(motivoDelCupon(c, AHORA, null)).toBe(
      'Se agotaron los canjes de este cupón.',
    );
  });

  it('subir el tope reabre el cupón — que es lo que el auto-apagado impedía', () => {
    const agotado = cupon({ maxTotal: 3, canjesCount: 3 });
    expect(motivoDelCupon(agotado, AHORA, null)).not.toBeNull();
    const ampliado = { ...agotado, maxTotal: 10 };
    expect(motivoDelCupon(ampliado, AHORA, null)).toBeNull();
  });

  it('un cupón agotado NO dice «apagado por el negocio»', () => {
    const c = cupon({ maxTotal: 1, canjesCount: 5 });
    expect(motivoDelCupon(c, AHORA, null)).not.toContain('apagado');
  });

  it('sin tope global nunca se agota', () => {
    expect(estaAgotado(cupon({ maxTotal: null, canjesCount: 9999 }))).toBe(false);
  });
});

describe('precedencia: qué gana sobre qué', () => {
  it('el motivo global tumba el cupón aunque esté impecable', () => {
    expect(motivoDelCupon(cupon(), AHORA, 'Convenio en pausa.')).toBe(
      'Convenio en pausa.',
    );
  });

  it('los interruptores van antes que la fecha de vencimiento', () => {
    const c = cupon({ isActive: false, endsAt: AYER });
    expect(motivoDelCupon(c, AHORA, null)).toBe('Beneficio apagado por el negocio.');
  });

  it('la fecha va antes que el tope global', () => {
    const c = cupon({ endsAt: AYER, maxTotal: 1, canjesCount: 5 });
    expect(motivoDelCupon(c, AHORA, null)).toBe('Este cupón ya venció.');
  });

  it('un cupón que vence mañana todavía sirve', () => {
    expect(motivoDelCupon(cupon({ endsAt: MANANA }), AHORA, null)).toBeNull();
  });
});

describe('el convenio entero', () => {
  it('finalizado y en pausa dicen cosas distintas', () => {
    expect(motivoDelConvenio(convenio({ status: 'FINISHED' }), AHORA)).toBe(
      'Convenio finalizado.',
    );
    expect(motivoDelConvenio(convenio({ status: 'PAUSED' }), AHORA)).toBe(
      'Convenio en pausa.',
    );
  });

  it('vencido por fecha aunque siga ACTIVE — la evaluación es perezosa, sin cron', () => {
    expect(motivoDelConvenio(convenio({ endsAt: AYER }), AHORA)).toBe(
      'El convenio llegó a su fecha de fin.',
    );
  });

  it('extender la fecha lo revive: ESA es la diferencia con FINISHED', () => {
    const vencido = convenio({ endsAt: AYER });
    expect(motivoDelConvenio(vencido, AHORA)).not.toBeNull();
    expect(motivoDelConvenio({ ...vencido, endsAt: MANANA }, AHORA)).toBeNull();
  });

  it('la pausa congela también las activaciones nuevas, no solo el canje', () => {
    expect(admiteActivaciones(convenio({ status: 'PAUSED' }), AHORA)).toBe(false);
    expect(admiteActivaciones(convenio({ status: 'FINISHED' }), AHORA)).toBe(false);
    expect(admiteActivaciones(convenio({ endsAt: AYER }), AHORA)).toBe(false);
    expect(admiteActivaciones(convenio(), AHORA)).toBe(true);
  });
});

describe('lo que el empleado ve en su pase', () => {
  it('con un solo beneficio vivo el pase dice ACTIVO', () => {
    const estado = estadoDelPase(
      convenio(),
      [cupon({ isActive: false }), cupon()],
      false,
      AHORA,
    );
    expect(estado).toBe('ACTIVO');
  });

  it('con todos apagados dice PAUSA, sin decir quién los apagó', () => {
    const estado = estadoDelPase(
      convenio(),
      [cupon({ isActive: false }), cupon({ activoAliado: false })],
      false,
      AHORA,
    );
    // Que sea PAUSA y no dos estados distintos es deliberado: al empleado no se
    // le cuenta cuál de las dos empresas le apagó el descuento.
    expect(estado).toBe('PAUSA');
  });

  it('la tarjeta bloqueada gana sobre todo lo demás', () => {
    expect(estadoDelPase(convenio(), [cupon()], true, AHORA)).toBe('BLOQUEADA');
  });

  it('el convenio vencido se ve FINALIZADO, no en pausa', () => {
    expect(estadoDelPase(convenio({ endsAt: AYER }), [cupon()], false, AHORA)).toBe(
      'FINALIZADO',
    );
  });

  it('sin cupones el pase está en pausa, no activo', () => {
    expect(estadoDelPase(convenio(), [], false, AHORA)).toBe('PAUSA');
  });
});

describe('cuándo empujar el pase — el push que no hay que mandar', () => {
  it('encender la llave del aliado con la del negocio apagada NO cambia nada', () => {
    const antes = cupon({ isActive: false, activoAliado: false });
    const despues = cupon({ isActive: false, activoAliado: true });
    expect(cambiaLoQueSeVe(antes, despues, AHORA)).toBe(false);
  });

  it('encender la última llace que faltaba SÍ se empuja', () => {
    const antes = cupon({ isActive: true, activoAliado: false });
    const despues = cupon({ isActive: true, activoAliado: true });
    expect(cambiaLoQueSeVe(antes, despues, AHORA)).toBe(true);
  });

  it('apagar un cupón que ya estaba vencido no se empuja', () => {
    const antes = cupon({ endsAt: AYER });
    const despues = cupon({ endsAt: AYER, isActive: false });
    expect(cambiaLoQueSeVe(antes, despues, AHORA)).toBe(false);
  });
});

describe('normalización — la red del índice único', () => {
  it('la misma cédula escrita de tres formas colisiona', () => {
    expect(normalizarDocumento('1.020.304-5')).toBe('10203045');
    expect(normalizarDocumento('1 020 304 5')).toBe('10203045');
    expect(normalizarDocumento('10203045')).toBe('10203045');
  });

  it('los documentos con letra se comparan en mayúsculas', () => {
    expect(normalizarDocumento('x-1234567-l')).toBe('X1234567L');
  });

  it('vacío o solo separadores es null, nunca cadena vacía', () => {
    expect(normalizarDocumento('')).toBeNull();
    expect(normalizarDocumento('   ')).toBeNull();
    expect(normalizarDocumento(null)).toBeNull();
    expect(normalizarDocumento('---')).toBeNull();
  });

  it('el código se compara sin distinguir mayúsculas ni espacios', () => {
    expect(normalizarCodigo(' abc 123 ')).toBe('ABC123');
    expect(normalizarCodigo('ABC123')).toBe('ABC123');
  });
});
