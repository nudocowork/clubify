import { describe, it, expect } from 'vitest';
import { datosDePlanDeClub, datosDeConvenio } from './sync-club-convenio';

/**
 * Traducción de lo que manda el Onboarding a lo que esperan Club y Convenios.
 *
 * Aquí NO se prueban las reglas de negocio —tramos que no se solapen, topes
 * coherentes con el cupo, slugs sin colisión— porque no viven aquí: viven en
 * `ClubService` y `ConveniosService`, que el sync llama. Lo que se prueba es
 * la traducción: que nada se cuele mal tipado y que «omitir» no sea lo mismo
 * que «vaciar».
 */
describe('datosDePlanDeClub', () => {
  it('traduce un plan completo', () => {
    const d = datosDePlanDeClub({
      name: '  Plan Café  ',
      beneficiosPorMes: 10,
      unidad: 'café',
      precioCents: 49000,
      currency: 'cop',
      periodicidad: 'mensual',
      maxPorDia: 1,
      minutosEntreConsumos: 120,
    });
    expect(d.name).toBe('Plan Café');
    expect(d.beneficiosPorMes).toBe(10);
    expect(d.unidad).toBe('café');
    expect(d.currency).toBe('COP');
    expect(d.periodicidad).toBe('MENSUAL');
    expect(d.maxPorDia).toBe(1);
  });

  it('OMITIR no es VACIAR: lo ausente no aparece en la salida', () => {
    // Un sync que solo cambia el nombre no puede llevarse por delante los
    // topes que el negocio configuró a mano.
    const d = datosDePlanDeClub({ name: 'Plan' });
    expect('maxPorDia' in d).toBe(false);
    expect('minutosEntreConsumos' in d).toBe(false);
    expect('beneficiosPorMes' in d).toBe(false);
  });

  it('null EXPLÍCITO sí quita el tope', () => {
    const d = datosDePlanDeClub({
      name: 'Plan',
      maxPorDia: null,
      minutosEntreConsumos: null,
    });
    expect(d.maxPorDia).toBeNull();
    expect(d.minutosEntreConsumos).toBeNull();
  });

  it('un cupo de 0 o negativo no pasa: lo rechaza el servicio, no se inventa', () => {
    expect('beneficiosPorMes' in datosDePlanDeClub({ beneficiosPorMes: 0 })).toBe(false);
    expect('beneficiosPorMes' in datosDePlanDeClub({ beneficiosPorMes: -5 })).toBe(false);
  });

  it('ordena los tramos por día y descarta los mal formados', () => {
    const d = datosDePlanDeClub({
      name: 'Plan',
      tramosAlta: [
        { desdeDia: 16, hastaDia: 24, beneficios: 5 },
        { desdeDia: 1, hastaDia: 15, beneficios: 10 },
        { desdeDia: 40, hastaDia: 50, beneficios: 1 }, // fuera del mes
        { hastaDia: 31, beneficios: 3 }, // sin desdeDia
      ],
    });
    expect(d.tramos).toEqual([
      { desdeDia: 1, hastaDia: 15, beneficios: 10 },
      { desdeDia: 16, hastaDia: 24, beneficios: 5 },
    ]);
  });

  it('un precio que no es número no se convierte en 0', () => {
    // Poner 0 seria decir «es gratis», que es una afirmación que nadie hizo.
    expect('precioCents' in datosDePlanDeClub({ precioCents: 'gratis' })).toBe(false);
  });
});

describe('datosDeConvenio', () => {
  it('traduce un convenio con su cupón', () => {
    const d = datosDeConvenio({
      name: 'Confenalco',
      verificacion: 'codigo',
      codigo: ' confe2026 ',
      cupones: [
        { name: '20% en cafetería', tipo: 'percent_off', valor: 20, periodo: 'mes', maxPorPersona: 1 },
      ],
    });
    expect(d.name).toBe('Confenalco');
    expect(d.verificacion).toBe('CODIGO');
    expect(d.codigo).toBe('CONFE2026');
    expect(d.cupones).toHaveLength(1);
    expect(d.cupones![0].tipo).toBe('PERCENT_OFF');
    expect(d.cupones![0].periodo).toBe('MES');
  });

  it('un modo de verificación DESCONOCIDO no abre el convenio', () => {
    // Caer a ABIERTO por una errata dejaria el beneficio a disposicion de
    // cualquiera con el enlace. Se ignora y manda el que hubiera.
    const d = datosDeConvenio({ name: 'X', verificacion: 'ABIERTA' });
    expect('verificacion' in d).toBe(false);
  });

  it('acepta los tres modos válidos', () => {
    for (const v of ['ABIERTO', 'CODIGO', 'LISTA']) {
      expect(datosDeConvenio({ name: 'X', verificacion: v }).verificacion).toBe(v);
    }
  });

  it('un cupón SIN nombre se descarta: no se puede ni listar', () => {
    const d = datosDeConvenio({
      name: 'X',
      cupones: [{ tipo: 'FREEBIE' }, { name: 'Bueno', tipo: 'FREEBIE' }],
    });
    expect(d.cupones).toHaveLength(1);
    expect(d.cupones![0].name).toBe('Bueno');
  });

  it('un tipo de beneficio inventado se ignora y queda el de por defecto', () => {
    const d = datosDeConvenio({ name: 'X', cupones: [{ name: 'C', tipo: 'REGALITO' }] });
    expect('tipo' in d.cupones![0]).toBe(false);
  });

  it('una fecha de fin inválida no se guarda', () => {
    expect('endsAt' in datosDeConvenio({ name: 'X', endsAt: 'el martes' })).toBe(false);
    expect(datosDeConvenio({ name: 'X', endsAt: null }).endsAt).toBeNull();
  });

  it('OMITIR no es VACIAR tampoco aquí', () => {
    const d = datosDeConvenio({ name: 'X' });
    expect('cupones' in d).toBe(false);
    expect('logoUrl' in d).toBe(false);
  });
});
