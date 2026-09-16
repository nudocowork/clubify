/**
 * El aviso al equipo de Clubify cuando una marca blanca deja algo en su Lab.
 * NO necesita base de datos.
 *
 * Por qué. Si estas reglas se aflojan pasa una de dos: el SMS empieza a llegar
 * también por cada propuesta de los negocios y afiliados de Clubify —son muchas
 * más, y en una semana nadie lo mira— o llega repetido por el mismo hecho,
 * porque `sendInternalAlert` no trae anti-repetición propia.
 */
import { describe, it, expect } from 'vitest';
import {
  MemoriaDeAvisos,
  TELEFONO_EQUIPO_LAB,
  claveDeComentario,
  claveDePropuesta,
  debeAvisarAlEquipo,
  enlaceDeModeracion,
  textoAvisoLab,
} from './lab-aviso';

const CLUBIFY = 'wl-clubify';
const SELLEA = 'wl-sellea';

describe('a quién se avisa', () => {
  it('solo por las marcas blancas', () => {
    expect(debeAvisarAlEquipo(SELLEA, CLUBIFY)).toBe(true);
    expect(debeAvisarAlEquipo('wl-otra', CLUBIFY)).toBe(true);
  });

  it('nunca por lo de la plataforma: Clubify ni las históricas sin marca', () => {
    expect(debeAvisarAlEquipo(CLUBIFY, CLUBIFY)).toBe(false);
    expect(debeAvisarAlEquipo(null, CLUBIFY)).toBe(false);
    expect(debeAvisarAlEquipo(undefined, CLUBIFY)).toBe(false);
  });

  it('sin fila Clubify (entornos sin ella) una marca blanca sigue avisando', () => {
    expect(debeAvisarAlEquipo(SELLEA, null)).toBe(true);
    expect(debeAvisarAlEquipo(null, null)).toBe(false);
  });

  it('va a la línea del equipo de Clubify, no a nadie de la marca', () => {
    expect(TELEFONO_EQUIPO_LAB).toBe('+573248088401');
  });
});

describe('el texto del SMS', () => {
  const base = {
    marca: 'Sellea',
    autor: 'Humberto',
    enlace: 'https://app.soyclubify.com/admin/lab/p1',
  };

  it('dice marca, quién, qué y dónde abrirlo', () => {
    expect(textoAvisoLab({ ...base, titulo: 'Agenda por sede', hecho: 'propuesta' })).toBe(
      'Lab de Sellea: Humberto creó la propuesta «Agenda por sede». ' +
        'Revisar: https://app.soyclubify.com/admin/lab/p1',
    );
    expect(textoAvisoLab({ ...base, titulo: 'Agenda por sede', hecho: 'comentario' })).toBe(
      'Lab de Sellea: Humberto comentó en «Agenda por sede». ' +
        'Revisar: https://app.soyclubify.com/admin/lab/p1',
    );
  });

  it('un título larguísimo se recorta para que el enlace no se pierda de vista', () => {
    const texto = textoAvisoLab({
      ...base,
      titulo: 'A'.repeat(300),
      hecho: 'propuesta',
    });
    expect(texto).toContain('…»');
    expect(texto).toContain(base.enlace);
    expect(texto.length).toBeLessThan(160);
  });

  it('los saltos de línea del título no parten el SMS en dos mensajes', () => {
    const texto = textoAvisoLab({
      ...base,
      titulo: 'Agenda\n\npor   sede',
      hecho: 'propuesta',
    });
    expect(texto).toContain('«Agenda por sede»');
    expect(texto).not.toContain('\n');
  });

  it('sin marca resuelta lo dice; nunca se inventa «Clubify»', () => {
    const texto = textoAvisoLab({
      ...base,
      marca: null,
      titulo: 'Algo',
      hecho: 'propuesta',
    });
    expect(texto).toContain('Lab (marca sin resolver)');
    expect(texto).not.toContain('Clubify:');
  });

  it('sin nombre del autor sigue saliendo, sin un hueco vacío', () => {
    const texto = textoAvisoLab({
      ...base,
      autor: null,
      titulo: 'Algo',
      hecho: 'comentario',
    });
    expect(texto).toBe(
      'Lab de Sellea: Alguien comentó en «Algo». ' +
        'Revisar: https://app.soyclubify.com/admin/lab/p1',
    );
  });

  it('el enlace es el de la moderación, con o sin barra final en APP_URL', () => {
    expect(enlaceDeModeracion('https://app.soyclubify.com', 'p1')).toBe(
      'https://app.soyclubify.com/admin/lab/p1',
    );
    expect(enlaceDeModeracion('https://app.soyclubify.com/', 'p1')).toBe(
      'https://app.soyclubify.com/admin/lab/p1',
    );
  });
});

describe('qué se considera «lo mismo» para no repetir el aviso', () => {
  it('un doble clic en «Crear» es la misma propuesta, aunque la fila sea otra', () => {
    // La clave NO puede llevar el id de la fila: es nuevo en cada intento, así
    // que la memoria no cortaba absolutamente nada.
    expect(claveDePropuesta('u-humberto', 'Agenda por sede')).toBe(
      claveDePropuesta('u-humberto', '  agenda   POR   sede  '),
    );
  });

  it('dos propuestas distintas del mismo autor avisan las dos', () => {
    expect(claveDePropuesta('u-humberto', 'Agenda por sede')).not.toBe(
      claveDePropuesta('u-humberto', 'Otra idea distinta'),
    );
  });

  it('dos autores con el mismo título no se tapan el aviso entre ellos', () => {
    expect(claveDePropuesta('u-humberto', 'Agenda')).not.toBe(
      claveDePropuesta('u-otro', 'Agenda'),
    );
  });

  it('un título larguísimo no hace crecer la clave sin fin', () => {
    expect(claveDePropuesta('u1', 'A'.repeat(500)).length).toBeLessThan(140);
  });

  it('comentarios distintos en la MISMA propuesta son lo mismo: un aviso', () => {
    expect(claveDeComentario('u-humberto', 'p1')).toBe(
      claveDeComentario('u-humberto', 'p1'),
    );
  });

  it('comentar en otra propuesta es otra conversación: vuelve a avisar', () => {
    expect(claveDeComentario('u-humberto', 'p1')).not.toBe(
      claveDeComentario('u-humberto', 'p2'),
    );
  });

  it('una propuesta y un comentario nunca comparten clave', () => {
    expect(claveDePropuesta('u1', 'p1')).not.toBe(claveDeComentario('u1', 'p1'));
  });
});

describe('no repetir el aviso por el mismo hecho', () => {
  it('el mismo hecho dentro de la ventana no vuelve a avisar', () => {
    const m = new MemoriaDeAvisos(10 * 60 * 1000);
    expect(m.esRepetido('propuesta::p1', 0)).toBe(false);
    expect(m.esRepetido('propuesta::p1', 1000)).toBe(true);
    expect(m.esRepetido('propuesta::p1', 9 * 60 * 1000)).toBe(true);
  });

  it('dos hechos distintos avisan los dos: son dos cosas que revisar', () => {
    const m = new MemoriaDeAvisos();
    expect(m.esRepetido('propuesta::p1')).toBe(false);
    expect(m.esRepetido('propuesta::p2')).toBe(false);
    expect(m.esRepetido('comentario::c1')).toBe(false);
  });

  it('pasada la ventana vuelve a avisar: no es un silencio para siempre', () => {
    const m = new MemoriaDeAvisos(10 * 60 * 1000);
    expect(m.esRepetido('propuesta::p1', 0)).toBe(false);
    expect(m.esRepetido('propuesta::p1', 11 * 60 * 1000)).toBe(false);
  });
});
