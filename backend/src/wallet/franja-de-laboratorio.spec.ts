import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { cabeceraDelPase, validarPaseDeLaboratorio } from './franja-de-laboratorio';
import { dibujarFranja, ESTILOS } from './estilos-de-franja';

const base = {
  estilo: 'SELLOS',
  fondo: '#1A1033',
  texto: '#FFF6F0',
  sello: '#F4B6A6',
  area: '#2A2047',
  requeridos: 10,
  sellados: 6,
  premio: 'Masaje gratis',
  unidad: 'visitas',
  emoji: '💆',
};
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

describe('validarPaseDeLaboratorio', () => {
  it('acepta un diseño normal y rellena lo que falta', () => {
    const r = validarPaseDeLaboratorio({ config: base, negocio: 'Spa Rocío', titular: 'Rocío' });
    expect(r.config.estilo).toBe('SELLOS');
    expect(r.config.moneda).toBe('$');
    expect(r.negocio).toBe('Spa Rocío');
  });

  // Lo que importa: nada de lo que llega puede romper el SVG que rasteriza
  // librsvg para hacerle leer archivos o pedir URLs.
  it('rechaza un color que intenta salirse del atributo', () => {
    expect(() =>
      validarPaseDeLaboratorio({ config: { ...base, fondo: '#000"/><image href="file:///etc/passwd"/>' } }),
    ).toThrow(/fondo/);
  });

  it('rechaza imágenes que no son data: de png/jpeg/webp', () => {
    for (const url of ['https://evil.test/x.png', 'file:///etc/passwd', 'data:image/svg+xml;base64,PHN2Zz4=']) {
      expect(() => validarPaseDeLaboratorio({ config: { ...base, portada: url } })).toThrow(/portada/);
      expect(() =>
        validarPaseDeLaboratorio({ config: { ...base, posiciones: [{ x: 1, y: 1, tam: 40, giro: 0, imagen: url }] } }),
      ).toThrow(/posiciones/);
    }
    expect(validarPaseDeLaboratorio({ config: { ...base, portada: PNG } }).config.portada).toBe(PNG);
  });

  it('rechaza números que no son números y acota los demás', () => {
    expect(() =>
      validarPaseDeLaboratorio({ config: { ...base, posiciones: [{ x: '10" onload="x', y: 1, tam: 40 }] } }),
    ).toThrow(/posiciones/);
    const r = validarPaseDeLaboratorio({ config: { ...base, requeridos: 500, sellados: 900 } });
    expect(r.config.requeridos).toBe(30);
    expect(r.config.sellados).toBe(30);
  });

  it('rechaza estilos y opciones que no existen', () => {
    expect(() => validarPaseDeLaboratorio({ config: { ...base, estilo: 'OTRO' } })).toThrow(/estilo/);
    expect(() => validarPaseDeLaboratorio({ config: { ...base, letra: 'Comic Sans' } })).toThrow(/letra/);
  });

  it('el texto llega escapado al SVG', () => {
    const r = validarPaseDeLaboratorio({ config: { ...base, estilo: 'ANILLO', premio: '<script>x</script>' } });
    const svg = dibujarFranja(r.config);
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
  });

  it('todos los estilos dibujan sin NaN', () => {
    for (const e of ESTILOS) {
      const r = validarPaseDeLaboratorio({ config: { ...base, estilo: e.id, requeridos: 1, sellados: 1 } });
      expect(dibujarFranja(r.config)).not.toMatch(/NaN|undefined/);
    }
  });
});

describe('cabeceraDelPase', () => {
  it('sellos, VIP y saldo', () => {
    const v = (o: object) => validarPaseDeLaboratorio({ config: { ...base, ...o } }).config;
    expect(cabeceraDelPase(v({}))).toEqual({ etiqueta: 'VISITAS', valor: '6/10' });
    expect(cabeceraDelPase(v({ estilo: 'VIP', gastado: 350 })).valor).toBe('Oro');
    expect(cabeceraDelPase(v({ estilo: 'SALDO', saldo: 12.6 })).valor).toBe('$12.60');
  });
});

describe('copia del módulo de dibujo', () => {
  // El pase de prueba se dibuja con la copia del backend y la vista previa con
  // la del frontend: si se separan, lo que se ve en el panel deja de ser lo que
  // llega al celular. Solo corre donde está el repo completo.
  const front = path.resolve(__dirname, '../../../frontend/src/lib/cards/estilos-de-franja.ts');
  it.runIf(fs.existsSync(front))('es idéntica a la del frontend', () => {
    const quitarCabecera = (s: string) => s.replace(/^(\/\/.*\r?\n)+\r?\n/, '').replace(/\r\n/g, '\n');
    const back = fs.readFileSync(path.resolve(__dirname, 'estilos-de-franja.ts'), 'utf8');
    expect(quitarCabecera(back)).toBe(fs.readFileSync(front, 'utf8').replace(/\r\n/g, '\n'));
  });
});
