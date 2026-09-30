import { describe, expect, it } from 'vitest';
import { ordenarSedesParaPase, PREFIJO_GEOFENCE_ALIADO } from './orden-de-sedes';

// El pase corta a 10 puntos con slice(0, 10): este orden decide CUÁLES entran.
// Si se rompe, nadie lo ve en un test de pantalla — el síntoma es «la tarjeta
// dejó de avisar en tal sitio» semanas después.
describe('ordenarSedesParaPase', () => {
  const propia = (n: string, externalId: string | null = null) => ({ n, externalId });
  const deAliado = (n: string) => ({ n, externalId: `${PREFIJO_GEOFENCE_ALIADO}${n}` });

  it('los puntos propios van antes que las sedes de aliados', () => {
    const orden = ordenarSedesParaPase([
      deAliado('a1'), propia('p1'), deAliado('a2'), propia('p2'),
    ]).map((s) => s.n);
    expect(orden).toEqual(['p1', 'p2', 'a1', 'a2']);
  });

  it('dentro de cada grupo conserva el orden de llegada (createdAt de la consulta)', () => {
    const orden = ordenarSedesParaPase([
      deAliado('a1'), deAliado('a2'), propia('p1'), deAliado('a3'), propia('p2'),
    ]).map((s) => s.n);
    expect(orden).toEqual(['p1', 'p2', 'a1', 'a2', 'a3']);
  });

  it('un negocio normal (externalId del Onboarding o nulo) queda tal cual', () => {
    // El externalId de una sede sincronizada por el Onboarding NO es de aliado.
    const sedes = [propia('p1', 'onb-123'), propia('p2'), propia('p3', 'onb-9')];
    expect(ordenarSedesParaPase(sedes).map((s) => s.n)).toEqual(['p1', 'p2', 'p3']);
  });

  it('no muta el arreglo original', () => {
    const sedes = [deAliado('a1'), propia('p1')];
    ordenarSedesParaPase(sedes);
    expect(sedes.map((s) => s.n)).toEqual(['a1', 'p1']);
  });
});
