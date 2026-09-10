import { describe, it, expect } from 'vitest';
import { datosDeTarjetaDeSellos } from './onboarding-sync.service';

/**
 * El mapeo de una tarjeta de sellos del Onboarding.
 *
 * Lo usan las DOS vías —la de una tarjeta y la de varias—, así que un fallo
 * aquí se multiplica. Antes estaba escrito dos veces y era cuestión de tiempo
 * que una ganara un campo y la otra no.
 */
describe('datosDeTarjetaDeSellos', () => {
  it('un color inventado no se guarda: rompía la interfaz en silencio', () => {
    const d = datosDeTarjetaDeSellos({ primaryColor: 'azul bonito' });
    expect(d.primaryColor).toBeUndefined();
  });

  it('un color de verdad sí', () => {
    expect(datosDeTarjetaDeSellos({ primaryColor: '#22C55E' }).primaryColor).toBe(
      '#22C55E',
    );
  });

  it('los sellos nunca bajan de 1: una tarjeta de 0 sellos se premia sola', () => {
    expect(datosDeTarjetaDeSellos({ stampsRequired: 0 }).stampsRequired).toBe(1);
    expect(datosDeTarjetaDeSellos({ stampsRequired: '10' }).stampsRequired).toBe(10);
  });

  it('poner fondo enciende el modo imagen; quitarlo no toca el modo', () => {
    const con = datosDeTarjetaDeSellos({ stampBgImageUrl: 'https://cdn/f.jpg' });
    expect(con.stampBgType).toBe('IMAGE');
    const sin = datosDeTarjetaDeSellos({ stampBgImageUrl: '' });
    expect(sin.stampBgImageUrl).toBeNull();
    expect(sin.stampBgType).toBeUndefined();
  });

  // Un campo que no viene NO se escribe: si no, un formulario a medias borraba
  // el texto del premio que el negocio ya tenía puesto en el panel.
  it('lo que no viene no se toca', () => {
    expect(Object.keys(datosDeTarjetaDeSellos({}))).toEqual([]);
  });

  it('recoge los textos que sí vienen', () => {
    const d = datosDeTarjetaDeSellos({ name: 'Café', rewardText: 'Un café gratis' });
    expect(d.name).toBe('Café');
    expect(d.rewardText).toBe('Un café gratis');
  });
});
