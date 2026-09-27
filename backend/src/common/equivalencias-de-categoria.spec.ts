import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  BUSINESS_CATEGORIES,
  EQUIVALENCIAS_DE_CATEGORIA,
  getCategoryBySlug,
  slugDeCategoria,
} from './business-categories';

/**
 * Las categorías que llegan con otro nombre.
 *
 * En producción (2026-09-27) hay **37 negocios activos** con un
 * `businessCategorySlug` que no existe en la lista: `restaurante` (19),
 * `cafeteria` (8), `heladeria`, `joyeria`… Todos caían al respaldo
 * `restaurant`, en silencio, y los que no son restaurantes acababan con la
 * pestaña «Pedidos» y su catálogo llamado «Menú».
 */

describe('resolver una categoría que llega en español', () => {
  it('EL CASO GORDO: «restaurante» y «cafeteria» son 27 de los 37', () => {
    expect(getCategoryBySlug('restaurante').slug).toBe('restaurant');
    expect(getCategoryBySlug('cafeteria').slug).toBe('coffee_shop');
  });

  it('una JOYERÍA deja de tener el panel de un restaurante', () => {
    const antes = getCategoryBySlug('restaurant');
    const ahora = getCategoryBySlug('joyeria');
    expect(ahora.slug).toBe('boutique');
    // Lo que de verdad cambia para ella: su catálogo deja de llamarse «Menú»…
    expect(antes.catalogLabel).toBe('menu');
    expect(ahora.catalogLabel).toBe('catalog');
    // …y se le quita una pestaña de Pedidos que no usa.
    expect(ahora.modules).not.toContain('orders');
  });

  it('NINGUNA equivalencia le quita el catálogo a quien lo tiene', () => {
    // La regla para añadir una: no quitarle un módulo que esté usando. Los
    // negocios afectados tienen productos cargados, así que `menu` se queda.
    // (`peluqueria-barberia` no está en la lista justo por esto: su
    // equivalente no tiene `menu` y el negocio que la usa tiene un producto.)
    for (const destino of Object.values(EQUIVALENCIAS_DE_CATEGORIA)) {
      expect(getCategoryBySlug(destino).modules).toContain('menu');
    }
  });

  it('todas las equivalencias apuntan a una categoría que EXISTE', () => {
    const reales = new Set(BUSINESS_CATEGORIES.map((c) => c.slug));
    for (const [origen, destino] of Object.entries(EQUIVALENCIAS_DE_CATEGORIA)) {
      expect(reales.has(destino), `${origen} → ${destino}`).toBe(true);
      // Y ninguna «equivalencia» pisa una categoría de verdad.
      expect(reales.has(origen), `${origen} ya existe`).toBe(false);
    }
  });

  it('una categoría de verdad NO se toca', () => {
    for (const c of BUSINESS_CATEGORIES) {
      expect(slugDeCategoria(c.slug)).toBe(c.slug);
      expect(getCategoryBySlug(c.slug).slug).toBe(c.slug);
    }
  });

  it('lo desconocido sigue cayendo al respaldo, no revienta', () => {
    expect(getCategoryBySlug('lo-que-sea').slug).toBe('restaurant');
    expect(getCategoryBySlug(null).slug).toBe('restaurant');
    expect(getCategoryBySlug(undefined).slug).toBe('restaurant');
    expect(slugDeCategoria(null)).toBeNull();
  });

  it('mayúsculas y espacios no cuentan', () => {
    expect(getCategoryBySlug('  Restaurante ').slug).toBe('restaurant');
  });

  it('LAS DOS COPIAS DEL ARCHIVO NO SE PUEDEN SEPARAR', () => {
    // `business-categories.ts` está duplicado a propósito en backend y
    // frontend para no pagar una llamada de red. El precio es este: si una
    // copia gana una equivalencia y la otra no, el panel y el backend
    // discrepan sobre qué módulos tiene un negocio — y eso no lo ve nadie
    // hasta que un dueño dice que le falta una pestaña.
    const leer = (p: string) =>
      fs.readFileSync(path.join(process.cwd(), p), 'utf8');
    const trozo = (src: string) =>
      src
        .slice(
          src.indexOf('EQUIVALENCIAS_DE_CATEGORIA: Readonly'),
          src.indexOf('export function slugDeCategoria'),
        )
        .replace(/\s+/g, ' ')
        .trim();

    const aqui = trozo(leer('src/common/business-categories.ts'));
    const alla = trozo(leer('../frontend/src/lib/business-categories.ts'));
    expect(aqui.length).toBeGreaterThan(50); // que de verdad encontró el bloque
    expect(alla).toBe(aqui);
  });
});
