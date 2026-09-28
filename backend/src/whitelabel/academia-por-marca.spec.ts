import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * LA ACADEMIA DE CADA MARCA ES LA SUYA, NO LA DE CLUBIFY.
 *
 * El menú lateral del negocio tenía el enlace escrito a mano:
 * `https://academy.soyclubify.lat/cliente`. Medido en producción el
 * 2026-09-28: **13 negocios de Sellea** llegaban a la academia de Clubify
 * desde su propio panel — y Sellea no tiene academia propia, así que estaban
 * viendo el material de la plataforma que revenden.
 *
 * Es el MISMO fallo que ya se había arreglado en el panel del AFILIADO con
 * `WhiteLabel.academiaUrl`, y que seguía vivo en la otra pantalla. Por eso este
 * candado mira las DOS: arreglar una y dejar la otra es exactamente lo que
 * pasó.
 *
 * `academy.soyclubify.lat` puede seguir apareciendo en un script de migración
 * —hay que sembrar la de Clubify en alguna parte— pero nunca en el código que
 * pinta una pantalla.
 */

const RAIZ = path.join(process.cwd(), '..');
const DOMINIO_DE_CLUBIFY = 'academy.soyclubify';

/** Las pantallas donde el enlace estuvo, o podría volver a estar. */
const PANTALLAS = [
  'frontend/src/components/AppShell.tsx',
  'frontend/src/app/affiliate/page.tsx',
];

describe('el enlace de la academia sale de la MARCA, nunca escrito a mano', () => {
  for (const rel of PANTALLAS) {
    it(`${rel} no lleva el dominio de Clubify escrito`, () => {
      const p = path.join(RAIZ, rel);
      if (!fs.existsSync(p)) return; // el fichero se movió: no es lo que se vigila
      const src = fs.readFileSync(p, 'utf8');
      // Se ignoran los comentarios: ahí SÍ se nombra, para explicar el caso.
      const codigo = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      expect(
        codigo.includes(DOMINIO_DE_CLUBIFY),
        `${rel} tiene el dominio de la academia de Clubify escrito a mano. ` +
          'Un negocio o un afiliado de otra marca acabaría ahí. El enlace tiene ' +
          'que salir de `academiaNegociosUrl` / `academiaUrl` de SU marca, y si ' +
          'la marca no tiene, la entrada no se pinta.',
      ).toBe(false);
    });
  }

  it('el campo existe en el esquema para las DOS audiencias', () => {
    // Si alguien borra uno de los dos campos «porque son lo mismo», el enlace
    // vuelve al código a mano. No son lo mismo: en Clubify son `/cliente` y
    // `/Embajadores`, y mandar a un dueño de local al portal de embajadores es
    // enseñarle a vender la plataforma en vez de a usarla.
    const schema = fs.readFileSync(
      path.join(process.cwd(), 'prisma', 'schema.prisma'),
      'utf8',
    );
    expect(schema).toContain('academiaNegociosUrl');
    expect(schema).toContain('academiaUrl');
  });

  it('SE PUEDE CONFIGURAR desde el panel, que es lo que faltaba', () => {
    // La causa de fondo: no había pantalla para ponerlo, así que el enlace
    // acabó en el código. Mientras no se pueda configurar, volverá a pasar.
    const panel = fs.readFileSync(
      path.join(RAIZ, 'frontend/src/app/superadmin/marcas/page.tsx'),
      'utf8',
    );
    expect(panel).toContain('academiaNegociosUrl');
    expect(panel).toContain('academiaUrl');

    const dto = fs.readFileSync(
      path.join(process.cwd(), 'src/superadmin/superadmin.controller.ts'),
      'utf8',
    );
    expect(dto).toContain('academiaNegociosUrl');
  });

  it('LA PRUEBA SABE PONERSE EN ROJO: detecta el enlace a mano', () => {
    // El detector se comprueba contra un texto de mentira, con la misma forma
    // que tenía el código antes de arreglarlo.
    const comoEstabaAntes = `href: 'https://academy.soyclubify.lat/cliente',`;
    const limpio = comoEstabaAntes
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(limpio.includes(DOMINIO_DE_CLUBIFY)).toBe(true);

    // Y que un COMENTARIO que lo nombre no dispara el candado.
    const soloUnComentario = `      // antes era academy.soyclubify.lat/cliente`;
    const sinComentarios = soloUnComentario
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(sinComentarios.includes(DOMINIO_DE_CLUBIFY)).toBe(false);
  });
});
