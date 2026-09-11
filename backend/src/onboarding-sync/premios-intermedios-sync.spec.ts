import { describe, it, expect } from 'vitest';
import { datosDeTarjetaDeSellos } from './onboarding-sync.service';

/**
 * EL TEST DE LA PUERTA, no el de la regla.
 *
 * `premios-intermedios.spec.ts` prueba que la regla sanea bien. Pero eso ya
 * pasaba en verde mientras el Onboarding no podía mandar premios intermedios:
 * el fallo no estaba en la regla, estaba en que **este mapeo ni miraba el
 * campo** y lo tiraba en silencio. El cliente los configuraba en el formulario
 * y no aparecían en ningún sitio.
 *
 * Si alguien vuelve a quitar `freeRewards` de `datosDeTarjetaDeSellos`, esto se
 * pone rojo.
 */
describe('datosDeTarjetaDeSellos · premios intermedios', () => {
  it('los pasa a la tarjeta', () => {
    const d = datosDeTarjetaDeSellos({
      name: 'Tarjeta',
      stampsRequired: 10,
      freeRewards: [
        { pos: 3, text: 'Café', emoji: '☕' },
        { pos: 5, text: 'Cookie', emoji: '🍪' },
      ],
    });
    expect(Array.isArray(d.freeRewards)).toBe(true);
    expect(d.freeRewards).toHaveLength(2);
    expect(d.freeRewards[0].pos).toBe(3);
    expect(d.freeRewards[1].text).toBe('Cookie');
  });

  it('recorta contra el total de sellos del MISMO envío', () => {
    // El máximo sale de `stampsRequired` que viene en esta misma llamada, no
    // de lo que hubiera antes en la tarjeta.
    const d = datosDeTarjetaDeSellos({
      stampsRequired: 6,
      freeRewards: [{ pos: 3 }, { pos: 9 }],
    });
    expect(d.freeRewards.map((r: any) => r.pos)).toEqual([3]);
  });

  it('sin el campo NO toca los premios que ya tenga la tarjeta', () => {
    // Un sync que solo cambia el color no puede borrar lo que el negocio
    // configuró a mano en el panel.
    const d = datosDeTarjetaDeSellos({ primaryColor: '#112233' });
    expect('freeRewards' in d).toBe(false);
  });

  it('un arreglo vacío SÍ los borra: es una orden explícita', () => {
    const d = datosDeTarjetaDeSellos({ freeRewards: [] });
    expect(d.freeRewards).toEqual([]);
  });
});
