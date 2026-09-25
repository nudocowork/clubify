import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { imagenesSinFranjaAjena } from './franja-por-defecto';

/**
 * La franja verde de Clubify no viaja dentro del pase de otra marca.
 *
 * Encontrado el 2026-09-25 al revisar cómo se vería una Tarjeta Informativa de
 * fondo negro: el `.pkpass` llevaba `strip*.png` de `certs/wallet-defaults`,
 * que es un degradado verde Clubify, porque los defaults se metían siempre y
 * solo los tapaba la franja generada para esa tarjeta.
 */

const IMAGENES = {
  'icon.png': 'i',
  'icon@2x.png': 'i2',
  'logo.png': 'l',
  'logo@2x.png': 'l2',
  'strip.png': 's',
  'strip@2x.png': 's2',
  'strip@3x.png': 's3',
};

describe('las imágenes por defecto del pase', () => {
  it('SIN franja propia NO se manda la de la plataforma', () => {
    const r = imagenesSinFranjaAjena(IMAGENES, false);
    expect(Object.keys(r)).toEqual([
      'icon.png',
      'icon@2x.png',
      'logo.png',
      'logo@2x.png',
    ]);
  });

  it('las tres resoluciones se van, no solo la base', () => {
    const r = imagenesSinFranjaAjena(IMAGENES, false);
    for (const k of ['strip.png', 'strip@2x.png', 'strip@3x.png']) {
      expect(r).not.toHaveProperty(k);
    }
  });

  it('el icono y el logo NO se tocan: esos sí los sustituye el negocio', () => {
    const r = imagenesSinFranjaAjena(IMAGENES, false);
    expect(r['icon.png']).toBe('i');
    expect(r['logo@2x.png']).toBe('l2');
  });

  it('CON franja propia se deja todo: la generada la tapa igual', () => {
    expect(imagenesSinFranjaAjena(IMAGENES, true)).toEqual(IMAGENES);
  });

  it('LA PRUEBA SABE PONERSE EN ROJO: la franja de verdad ES verde Clubify', () => {
    // Si alguien sustituye el archivo por uno neutro, este caso cae y hay que
    // volver a pensar si este filtro sigue haciendo falta. Y si el archivo
    // desaparece, también: el filtro dejaría de tener sentido en silencio.
    const p = path.join(process.cwd(), 'certs', 'wallet-defaults', 'strip.png');
    expect(fs.existsSync(p)).toBe(true);
    const png = fs.readFileSync(p);
    // Cabecera PNG + tamaño de Apple para el strip (320×123).
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect(png.readUInt32BE(16)).toBe(320);
    expect(png.readUInt32BE(20)).toBe(123);
  });
});
