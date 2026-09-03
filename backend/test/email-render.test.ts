import { describe, it, expect } from 'vitest';
import {
  BLOCK_META,
  emptyDoc,
  newBlock,
  newRow,
  renderEmailHtml,
  renderEmailText,
  type EmailBlockType,
} from '../../frontend/src/lib/email-blocks';

// ── Reglas del HTML de correo, fijadas en tests ─────────────────────────────
// OJO: vive en test/ y no junto al código, aunque NO necesita base de datos
// (a diferencia del resto de esta carpeta). El motivo es tonto pero real: el
// motor está en el frontend y tsconfig del backend no deja importar fuera de
// rootDir, así que un spec en src/ rompería `tsc --noEmit`. Aquí lo recoge
// vitest igual y el compilador no lo mira.
//
// El motor vive en el frontend (es quien manda: el editor regenera el `html`
// de cada plantilla en cada guardado) pero el frontend no tiene runner de
// tests, así que las reglas se comprueban desde aquí. No es un capricho de
// estilo: un flexbox o una hoja de estilos externa no rompen el build, rompen
// el correo del cliente final, y eso solo se ve cuando ya salió.

/** Props mínimas para que cada tipo de bloque produzca salida. */
const PROPS: Partial<Record<EmailBlockType, Record<string, unknown>>> = {
  image: { url: 'https://cdn.ejemplo.com/hero.jpg', alt: 'Foto de la tienda', width: 560 },
  logo: { url: 'https://cdn.ejemplo.com/logo.png', alt: 'Logotipo de la marca' },
  product: { url: 'https://cdn.ejemplo.com/p.jpg', alt: 'Foto del producto', title: 'Café', label: 'Ver' },
  social: { networks: [{ kind: 'facebook', url: 'https://facebook.com/x' }] },
  html: { html: '<table role="presentation"><tr><td>libre</td></tr></table>' },
};

const TIPOS = Object.keys(BLOCK_META) as EmailBlockType[];

/** Documento con TODOS los tipos de bloque, cada uno con contenido real. */
function docCompleto() {
  const d = emptyDoc();
  d.settings.preheader = 'Un texto de vista previa de longitud razonable para la bandeja.';
  d.rows = [
    newRow([100], [TIPOS.map((t) => newBlock(t, PROPS[t]))], { background: '#4f46e5', paddingV: 30 }),
    newRow([50, 50], [[newBlock('text', { html: 'izq' })], [newBlock('text', { html: 'der' })]]),
  ];
  return d;
}

describe('renderEmailHtml — restricciones de cliente de correo', () => {
  const html = renderEmailHtml(docCompleto(), { title: 'Prueba' });

  it('no usa flexbox, grid, position ni float en ningún bloque', () => {
    expect(html).not.toMatch(/display\s*:\s*(flex|grid|inline-flex)/i);
    expect(html).not.toMatch(/position\s*:\s*(absolute|fixed|sticky)/i);
    expect(html).not.toMatch(/float\s*:\s*(left|right)/i);
  });

  it('no enlaza CSS ni fuentes externas: todo va en línea o en el <style> del head', () => {
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/@import/i);
    expect(html).not.toMatch(/<script\b/i);
  });

  it('maqueta con tablas de presentación', () => {
    expect(html).toContain('role="presentation"');
    // Una tabla sin role="presentation" la leen los lectores de pantalla como
    // tabla de datos y cantan filas y columnas.
    const tablas = html.match(/<table\b[^>]*>/gi) ?? [];
    expect(tablas.length).toBeGreaterThan(5);
    expect(tablas.every((t) => /role="presentation"/.test(t))).toBe(true);
  });

  it('el contenedor mide 600 px y va centrado sobre el fondo exterior', () => {
    expect(html).toMatch(/width="600"/);
    expect(html).toMatch(/max-width:100%/);
    expect(html).toContain('<center');
  });

  it('lleva preheader oculto, y no lo pinta si está vacío', () => {
    expect(html).toContain('Un texto de vista previa');
    expect(html).toMatch(/display:none;max-height:0/);
    const sinPre = emptyDoc();
    sinPre.rows = [newRow([100], [[newBlock('text', { html: 'hola' })]])];
    expect(renderEmailHtml(sinPre)).not.toMatch(/display:none;max-height:0/);
  });

  it('declara el esquema de color para el modo oscuro', () => {
    expect(html).toMatch(/name="color-scheme"/);
    expect(html).toMatch(/name="supported-color-schemes"/);
    expect(html).toMatch(/prefers-color-scheme:\s*dark/);
  });

  it('apila columnas, baja el relleno lateral y ensancha el botón en móvil', () => {
    expect(html).toMatch(/@media only screen and \(max-width:/);
    expect(html).toMatch(/\.cf-col\s*\{[^}]*width:\s*100%\s*!important/);
    expect(html).toMatch(/\.cf-pad\s*\{[^}]*padding-left:\s*20px\s*!important/);
    expect(html).toMatch(/\.cf-btn-wrap\s*\{[^}]*width:\s*100%\s*!important/);
  });

  it('nunca deja pasar una imagen incrustada', () => {
    const d = emptyDoc();
    d.rows = [newRow([100], [[newBlock('image', { url: 'data:image/png;base64,AAAA', alt: 'x' })]])];
    expect(renderEmailHtml(d)).not.toMatch(/data:\s*image/i);
  });
});

describe('renderEmailHtml — botones a prueba de balas', () => {
  it('cada botón lleva su fallback VML para Outlook y su <a> para el resto', () => {
    const d = emptyDoc();
    d.rows = [
      newRow(
        [100],
        [
          [
            newBlock('button', { label: 'Uno', href: 'https://a.com' }),
            newBlock('buttons', { label: 'Dos', href: 'https://b.com', label2: 'Tres', href2: 'https://c.com' }),
            newBlock('product', { title: 'P', label: 'Cuatro', href: 'https://d.com', alt: 'foto' }),
          ],
        ],
      ),
    ];
    const html = renderEmailHtml(d);
    // 4 botones en total → 4 VML y 4 anclas visibles.
    expect(html.match(/<v:roundrect/g)?.length).toBe(4);
    expect(html.match(/<!--\[if !mso\]><!-- -->/g)?.length).toBe(4);
    // El namespace VML tiene que estar declarado o Outlook no pinta nada.
    expect(html).toMatch(/xmlns:v="urn:schemas-microsoft-com:vml"/);
  });

  it('el botón secundario se pinta con contorno, no con relleno', () => {
    const d = emptyDoc();
    d.rows = [newRow([100], [[newBlock('buttons', { label: 'A', label2: 'B' })]])];
    const html = renderEmailHtml(d);
    expect(html).toMatch(/border:2px solid/);
  });
});

describe('renderEmailHtml — imágenes', () => {
  const d = emptyDoc();
  d.rows = [
    newRow(
      [100],
      [
        [
          newBlock('image', { url: 'https://cdn.ejemplo.com/a.jpg', alt: 'Foto de la tienda', width: 560 }),
          newBlock('logo', { url: 'https://cdn.ejemplo.com/l.png', alt: 'Logotipo' }),
          newBlock('product', { url: 'https://cdn.ejemplo.com/p.jpg', alt: 'Foto del producto', title: 'P' }),
        ],
      ],
    ),
  ];
  const html = renderEmailHtml(d);

  it('toda imagen lleva alt y ancho explícito', () => {
    const imgs = html.match(/<img\b[^>]*>/gi) ?? [];
    expect(imgs.length).toBe(3);
    // El alt es lo ÚNICO que se lee mientras el cliente bloquea las imágenes,
    // que es el estado por defecto en Outlook y en Gmail hasta que se activan.
    expect(imgs.every((i) => /\salt="[^"]*"/.test(i))).toBe(true);
    expect(imgs.every((i) => /\swidth="/.test(i))).toBe(true);
    expect(imgs.every((i) => /display:block/.test(i))).toBe(true);
    expect(imgs.every((i) => /border:0/.test(i))).toBe(true);
  });

  it('una imagen sin URL no se pinta: el hueco es del negocio, no un roto', () => {
    const vacio = emptyDoc();
    vacio.rows = [newRow([100], [[newBlock('image', { url: '', alt: 'Hueco' })]])];
    expect(renderEmailHtml(vacio)).not.toContain('<img');
  });
});

describe('renderEmailHtml — filas con fondo', () => {
  it('la banda de color llega con bgcolor y con su relleno', () => {
    const d = emptyDoc();
    d.rows = [newRow([100], [[newBlock('text', { html: 'hola' })]], { background: '#0f172a', paddingV: 40, paddingH: 32 })];
    const html = renderEmailHtml(d);
    // bgcolor además del style: Outlook ignora background-color en algunos <td>.
    expect(html).toMatch(/bgcolor="#0f172a"/);
    expect(html).toMatch(/padding:40px 32px/);
  });
});

describe('renderEmailText — fallback de texto plano', () => {
  it('saca texto legible de todos los bloques, con los enlaces a la vista', () => {
    const texto = renderEmailText(docCompleto());
    expect(texto).toContain('Un texto de vista previa');
    expect(texto).toContain('Café');
    expect(texto).not.toContain('<');
    expect(texto).not.toMatch(/\n{3,}/);
  });
});
