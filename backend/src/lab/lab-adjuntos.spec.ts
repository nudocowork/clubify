/**
 * Qué se puede adjuntar a una propuesta del Lab. NO necesita base de datos.
 *
 * Por qué. El adjunto acaba pintado como `<img>`, como `<video>` y como enlace
 * en la moderación. Si estas reglas se aflojan entra un tipo que no sabemos
 * pintar, un archivo que no cabe, o —lo caro— una URL `javascript:` servida
 * desde nuestro propio panel.
 */
import { describe, it, expect } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import {
  LAB_MAX_IMAGEN_BYTES,
  LAB_MAX_VIDEO_BYTES,
  claseDeAdjunto,
  normalizarAdjunto,
  tipoDeAdjuntoPorUrl,
  urlDeAdjuntoValida,
  validarAdjuntoLab,
} from './lab-adjuntos';

const MB = 1024 * 1024;

describe('tipo del adjunto', () => {
  it('acepta las imágenes y los videos que el resto del producto ya sube', () => {
    for (const m of ['image/jpeg', 'image/png', 'image/webp', 'image/gif']) {
      expect(claseDeAdjunto(m)).toBe('image');
    }
    for (const m of ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v']) {
      expect(claseDeAdjunto(m)).toBe('video');
    }
  });

  it('el Lab NO acepta audio, PDF ni cosas raras, aunque `/media/upload` sí', () => {
    for (const m of ['audio/mpeg', 'application/pdf', 'text/html', '']) {
      expect(claseDeAdjunto(m)).toBeNull();
    }
  });

  it('rechaza con el motivo en español, que es lo que lee quien adjunta', () => {
    let error: any = null;
    try {
      validarAdjuntoLab({ mimetype: 'application/pdf', size: 1 });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.message).toContain('Solo se pueden adjuntar imágenes');
  });

  it('sin archivo tampoco pasa: multer deja `file` en undefined si no llegó nada', () => {
    expect(() => validarAdjuntoLab(undefined)).toThrow(BadRequestException);
    expect(() => validarAdjuntoLab(null)).toThrow(BadRequestException);
  });
});

describe('tamaño del adjunto', () => {
  it('una imagen normal y un video corto pasan', () => {
    expect(validarAdjuntoLab({ mimetype: 'image/png', size: 2 * MB })).toBe('image');
    expect(validarAdjuntoLab({ mimetype: 'video/mp4', size: 40 * MB })).toBe('video');
  });

  it('justo en el tope pasa; un byte más, no', () => {
    expect(
      validarAdjuntoLab({ mimetype: 'image/jpeg', size: LAB_MAX_IMAGEN_BYTES }),
    ).toBe('image');
    expect(
      validarAdjuntoLab({ mimetype: 'video/mp4', size: LAB_MAX_VIDEO_BYTES }),
    ).toBe('video');

    expect(() =>
      validarAdjuntoLab({ mimetype: 'image/jpeg', size: LAB_MAX_IMAGEN_BYTES + 1 }),
    ).toThrow(/imagen pesa demasiado \(máximo 15 MB\)/);
    expect(() =>
      validarAdjuntoLab({ mimetype: 'video/mp4', size: LAB_MAX_VIDEO_BYTES + 1 }),
    ).toThrow(/video pesa demasiado \(máximo 100 MB\)/);
  });

  it('el video tiene más margen que la imagen: un video de 40 MB pasa, una imagen de 40 MB no', () => {
    expect(validarAdjuntoLab({ mimetype: 'video/webm', size: 40 * MB })).toBe('video');
    expect(() =>
      validarAdjuntoLab({ mimetype: 'image/png', size: 40 * MB }),
    ).toThrow(BadRequestException);
  });
});

describe('una URL pegada a mano', () => {
  it('solo http y https: un `javascript:` sería un XSS servido por nuestro panel', () => {
    expect(urlDeAdjuntoValida('https://cdn.test/a.png')).toBe(true);
    expect(urlDeAdjuntoValida('http://cdn.test/a.png')).toBe(true);
    expect(urlDeAdjuntoValida('javascript:alert(1)')).toBe(false);
    expect(urlDeAdjuntoValida('data:text/html;base64,PHNjcmlwdD4=')).toBe(false);
    expect(urlDeAdjuntoValida('no-es-una-url')).toBe(false);
  });

  it('el tipo sale de la extensión, sin que la query string lo despiste', () => {
    expect(tipoDeAdjuntoPorUrl('https://cdn.test/a.PNG')).toBe('image');
    expect(tipoDeAdjuntoPorUrl('https://cdn.test/a.mp4?token=abc')).toBe('video');
    expect(tipoDeAdjuntoPorUrl('https://cdn.test/a.mov')).toBe('video');
    expect(tipoDeAdjuntoPorUrl('https://cdn.test/a.pdf')).toBe('pdf');
    expect(tipoDeAdjuntoPorUrl('https://cdn.test/algo')).toBe('document');
  });

  it('sin adjunto no se guarda ni la URL ni el tipo: nada de «Ver adjunto» que no lleva a ningún sitio', () => {
    expect(normalizarAdjunto({})).toEqual({ attachmentUrl: null, attachmentKind: null });
    expect(normalizarAdjunto({ attachmentUrl: '   ', attachmentKind: 'image' })).toEqual({
      attachmentUrl: null,
      attachmentKind: null,
    });
  });

  it('una URL inválida corta la creación en vez de guardarse a medias', () => {
    expect(() => normalizarAdjunto({ attachmentUrl: 'javascript:alert(1)' })).toThrow(
      BadRequestException,
    );
  });

  it('el tipo que manda el front es una pista: si no lo sabemos pintar, se deduce', () => {
    expect(normalizarAdjunto({ attachmentUrl: 'https://cdn.test/a.mp4' })).toEqual({
      attachmentUrl: 'https://cdn.test/a.mp4',
      attachmentKind: 'video',
    });
    expect(
      normalizarAdjunto({ attachmentUrl: 'https://cdn.test/a.png', attachmentKind: 'image' }),
    ).toEqual({ attachmentUrl: 'https://cdn.test/a.png', attachmentKind: 'image' });
    expect(
      normalizarAdjunto({ attachmentUrl: 'https://cdn.test/a.png', attachmentKind: '<script>' }),
    ).toEqual({ attachmentUrl: 'https://cdn.test/a.png', attachmentKind: 'image' });
  });
});
