import { describe, it, expect } from 'vitest';
import {
  contraste,
  identidadDeMarca,
  maquetarCorreo,
  normalizarColor,
  resumenParaVistaPrevia,
  sinEmojiInicial,
  textoAHtml,
  textoPlano,
  type ContenidoDelCorreo,
  type IdentidadDeCorreo,
} from './maquetador';

const SELLEA: IdentidadDeCorreo = {
  nombre: 'Sellea',
  logoUrl: 'https://cdn.example.com/branding/sellea-logo.png',
  iconoUrl: 'https://cdn.example.com/branding/sellea-icono.png',
  color: '#FF4D3D',
  colorTinta: '#1A1033',
  sitioUrl: 'https://www.selleala.com',
  correoContacto: 'hola@selleala.com',
};

const BASE: ContenidoDelCorreo = {
  preheader: 'Tu pago de Sellea quedó confirmado',
  antetitulo: 'Pago confirmado',
  titulo: 'Recibimos tu pago',
  bloques: [{ tipo: 'texto', texto: 'Hola **Ana**, todo en orden.' }],
  boton: { texto: 'Entrar a mi panel', url: 'https://app.selleala.com/app' },
  motivo: 'Recibes este correo porque tienes una cuenta en {marca}.',
};

const imagenes = (html: string) => [...html.matchAll(/<img[^>]+src="([^"]+)"/g)].map((m) => m[1]);

describe('maquetarCorreo — marca con logo', () => {
  const html = maquetarCorreo({ ...BASE, identidad: SELLEA });

  it('pinta el logo de la marca, con su nombre como texto alternativo', () => {
    expect(imagenes(html)).toEqual([SELLEA.logoUrl]);
    expect(html).toContain('alt="Sellea"');
  });

  it('la barra y el botón llevan el color de la marca, con texto legible', () => {
    expect(html).toContain('bgcolor="#FF4D3D"');
    expect(html).toMatch(/href="https:\/\/app\.selleala\.com\/app"[^>]*color:#FFFFFF/);
  });

  it('firma con la marca: nombre, sitio, contacto, motivo y «Enviado por»', () => {
    expect(html).toContain('Enviado por Sellea');
    expect(html).toContain('href="mailto:hola@selleala.com"');
    expect(html).toContain('>selleala.com</a>');
    expect(html).toContain('porque tienes una cuenta en Sellea.');
  });

  it('preheader, 600 px con tabla fantasma para Outlook y modo oscuro', () => {
    expect(html).toContain('Tu pago de Sellea quedó confirmado');
    expect(html).toContain('max-width:600px');
    expect(html).toContain('<!--[if mso]><table role="presentation" width="600"');
    expect(html).toContain('<meta name="color-scheme" content="light dark">');
    expect(html).toMatch(/@media \(prefers-color-scheme:dark\)\{[^\n]*\.c-fondo\{/);
    // El logo conserva su ficha blanca en modo oscuro, también en Gmail.
    expect(html).toContain('.c-chip{background-color:#FFFFFF!important');
    expect(html).toContain('linear-gradient(#FFFFFF,#FFFFFF)');
  });

  it('sin fuentes web ni degradados de fondo (Outlook no los pinta)', () => {
    expect(html).not.toMatch(/@import|@font-face|fonts\.googleapis/);
    expect(html).not.toMatch(/linear-gradient\((?!#FFFFFF,#FFFFFF\))/);
  });
});

describe('maquetarCorreo — marca sin logo', () => {
  it('con ícono: el ícono y el nombre en texto', () => {
    const html = maquetarCorreo({ ...BASE, identidad: { ...SELLEA, logoUrl: null } });
    expect(imagenes(html)).toEqual([SELLEA.iconoUrl]);
    expect(html).toMatch(/<span class="c-titulo"[^>]*>Sellea<\/span>/);
  });

  it('sin imágenes: el nombre en texto y ninguna inicial inventada', () => {
    const html = maquetarCorreo({ ...BASE, identidad: { nombre: 'Sellea', color: '#FF4D3D' } });
    expect(html).not.toContain('<img');
    expect(html).toMatch(/<span class="c-titulo"[^>]*>Sellea<\/span>/);
    expect(html).toContain('Enviado por Sellea');
    expect(html).toContain('bgcolor="#FF4D3D"');
  });

  it('un logo que no es http(s) no se pinta (data:, javascript:)', () => {
    const html = maquetarCorreo({
      ...BASE,
      identidad: { nombre: 'Sellea', logoUrl: 'data:image/png;base64,AAAA', iconoUrl: 'javascript:alert(1)' },
    });
    expect(html).not.toContain('<img');
    expect(html).not.toContain('data:image');
    expect(html).not.toContain('javascript:');
  });
});

describe('maquetarCorreo — sin marca resuelta', () => {
  const casos: [string, IdentidadDeCorreo | null][] = [
    ['identidad nula', null],
    ['nombre vacío', { nombre: '   ', logoUrl: SELLEA.logoUrl, color: '#22C55E' }],
  ];
  for (const [caso, identidad] of casos) {
    it(`${caso}: no pinta nombre, logo ni firma, y los colores son neutros`, () => {
      const html = maquetarCorreo({ ...BASE, identidad, credito: null });
      expect(html).not.toContain('<img');
      expect(html).not.toContain('Enviado por');
      expect(html).not.toContain('Hecho con');
      expect(html).not.toContain('Recibes este correo');
      expect(html.toLowerCase()).not.toContain('clubify');
      // Ni el verde de Clubify ni el morado del marco viejo.
      expect(html.toUpperCase()).not.toContain('#22C55E');
      expect(html.toUpperCase()).not.toContain('#6366F1');
      // El mensaje sí sale.
      expect(html).toContain('Recibimos tu pago');
      expect(html).toContain('href="https://app.selleala.com/app"');
    });
  }
});

describe('escapado', () => {
  const malo = '<script>alert("x")</script>';
  const html = maquetarCorreo({
    identidad: { ...SELLEA, nombre: `Sellea ${malo}`, color: 'red;background:url(https://evil.test/x)' },
    preheader: malo,
    antetitulo: malo,
    titulo: malo,
    bloques: [
      { tipo: 'texto', texto: `Hola ${malo} **${malo}**` },
      { tipo: 'datos', filas: [{ etiqueta: malo, valor: `"'><img src=x onerror=alert(1)>` }] },
      { tipo: 'destacado', titulo: malo, texto: malo },
      { tipo: 'codigo', etiqueta: malo, valor: malo },
      { tipo: 'nota', texto: malo },
    ],
    boton: { texto: malo, url: 'https://app.selleala.com/app?x="><script>' },
    motivo: `${malo} {marca}`,
    credito: malo,
  });

  it('ningún texto entra como HTML', () => {
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
  });

  it('un color que no es hexadecimal no llega al CSS', () => {
    expect(html).not.toContain('evil.test');
  });

  it('una URL con comillas o `javascript:` no se convierte en botón', () => {
    expect(html).not.toContain('app.selleala.com/app?x=');
    const js = maquetarCorreo({ ...BASE, identidad: SELLEA, boton: { texto: 'Entrar', url: 'javascript:alert(1)' } });
    expect(js).not.toContain('javascript:');
    expect(js).not.toContain('class="c-boton"');
  });
});

describe('texto del cuerpo', () => {
  it('convierte **negrita** y no deja asteriscos', () => {
    const html = textoAHtml('Tu suscripción de **Sellea** sigue activa.', SELLEA);
    expect(html).toMatch(/<strong class="c-titulo"[^>]*>Sellea<\/strong>/);
    expect(html).not.toContain('*');
  });

  it('un token vacío dentro de la negrita no deja «****»', () => {
    expect(textoAHtml('Tu plan de **** sigue activo.')).not.toContain('*');
    expect(textoPlano('Tu plan de **** sigue activo.')).toBe('Tu plan de  sigue activo.');
  });

  it('listas numeradas con su número; una línea «1.» suelta sigue siendo párrafo', () => {
    const html = textoAHtml('Primeros pasos:\n1. Sube tu catálogo\n2. Comparte tu link');
    expect(html).toContain('Primeros pasos:');
    expect(html).toMatch(/>1<\/span>[\s\S]*Sube tu catálogo[\s\S]*>2<\/span>[\s\S]*Comparte tu link/);
    expect(textoAHtml('1. de cada 3 clientes vuelve')).not.toContain('c-tinte');
  });

  it('enlaza las URLs sin comerse la puntuación y deja los correos en texto', () => {
    const html = textoAHtml('Entra a https://app.selleala.com/app. Tu acceso: (dueno@negocio.co)');
    expect(html).toContain('href="https://app.selleala.com/app"');
    expect(html).toContain('</a>.');
    expect(html).not.toContain('mailto:');
    expect(html).toContain('(dueno@negocio.co)');
  });

  it('el destacado conserva su acento de color también en modo oscuro', () => {
    const html = maquetarCorreo({ ...BASE, identidad: SELLEA, bloques: [{ tipo: 'destacado', titulo: 'Tu panel está abierto' }] });
    // Celda propia sin clase: ninguna regla oscura le cambia el color.
    expect(html).toContain('<td width="4" bgcolor="#FF4D3D"');
  });

  it('textoPlano quita la negrita y conserva el resto', () => {
    expect(textoPlano('Hola Ana, tu pago de **Sellea** falló.\n\n\n\nRevísalo.')).toBe(
      'Hola Ana, tu pago de Sellea falló.\n\nRevísalo.',
    );
  });

  it('la vista previa va en una línea, sin Markdown y recortada', () => {
    const r = resumenParaVistaPrevia(`Hola **Ana**,\n1. uno\n${'palabra '.repeat(40)}`);
    expect(r.startsWith('Hola Ana, uno palabra')).toBe(true);
    expect(r.length).toBeLessThanOrEqual(141);
    expect(r.endsWith('…')).toBe(true);
  });

  it('el título no arrastra el emoji del asunto, pero sí los números', () => {
    expect(sinEmojiInicial('🎉 Tu panel de Sellea ya está listo')).toBe('Tu panel de Sellea ya está listo');
    expect(sinEmojiInicial('3 días para renovar')).toBe('3 días para renovar');
  });
});

describe('colores', () => {
  it('acepta hexadecimales y rechaza el resto', () => {
    expect(normalizarColor('#ff4d3d')).toBe('#FF4D3D');
    expect(normalizarColor('#abc')).toBe('#AABBCC');
    expect(normalizarColor('red')).toBeNull();
    expect(normalizarColor('#FF4D3D;x')).toBeNull();
  });

  it('con un color de marca claro, el texto del botón pasa a oscuro', () => {
    const html = maquetarCorreo({ ...BASE, identidad: { nombre: 'Amarilla', color: '#FACC15' } });
    expect(html).toMatch(/class="c-boton-a" style="[^"]*color:#18181B/);
  });

  it('los enlaces llegan a 4,5:1 aunque el color de la marca no', () => {
    const html = textoAHtml('Ver https://app.selleala.com', SELLEA);
    const color = /class="c-enlace"[^>]*style="color:(#[0-9A-F]{6})/.exec(html)?.[1] ?? '';
    expect(contraste(color, '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
  });
});

describe('identidadDeMarca', () => {
  it('arma la firma desde la fila de WhiteLabel', () => {
    expect(
      identidadDeMarca({
        name: 'Sellea',
        logoUrl: 'https://cdn.example.com/l.png',
        primaryColor: '#FF4D3D',
        secondaryColor: '#1A1033',
        contactEmail: 'hola@selleala.com',
        domain: 'www.selleala.com',
        appDomain: 'app.selleala.com',
      }),
    ).toMatchObject({
      nombre: 'Sellea',
      color: '#FF4D3D',
      colorTinta: '#1A1033',
      sitioUrl: 'https://www.selleala.com',
      correoContacto: 'hola@selleala.com',
    });
  });

  it('sin nombre no hay identidad', () => {
    expect(identidadDeMarca({ name: '  ', logoUrl: 'https://cdn.example.com/l.png' })).toBeNull();
    expect(identidadDeMarca(null)).toBeNull();
  });
});
