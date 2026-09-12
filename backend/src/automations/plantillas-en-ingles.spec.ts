import { describe, it, expect } from 'vitest';
import { plantillaEnIdioma, enIngles, PLANTILLAS_EN } from './plantillas-en-ingles';
import { AUTOMATION_TEMPLATES } from './automations.service';

/**
 * Las automatizaciones de fábrica en el idioma del negocio.
 *
 * EL FALLO (Javier, 2026-09-11): DÓNDE JEANK está configurado en `en-US` y aun
 * así activaba «Bienvenida al inscribirse» y sus clientes de Estados Unidos
 * recibían «¡Bienvenido/a Ashley! Tu tarjeta está activa».
 */
describe('recetas en el idioma del negocio', () => {
  const bienvenida = AUTOMATION_TEMPLATES.find((t) => t.id === 'welcome')!;

  it('un negocio en inglés las recibe en inglés', () => {
    const t = plantillaEnIdioma(bienvenida, 'en-US');
    expect(t.name).toBe('Welcome on sign-up');
    expect((t.actions[0] as any).title).toContain('Welcome');
    expect((t.actions[0] as any).body).not.toContain('tarjeta');
  });

  it('un negocio en español no cambia', () => {
    expect(plantillaEnIdioma(bienvenida, 'es')).toBe(bienvenida);
    expect(plantillaEnIdioma(bienvenida, null)).toBe(bienvenida);
  });

  it('las variables del negocio NO se tocan', () => {
    // `{{customerName}}` lo rellena el sistema; traducirlo lo rompería.
    const t = plantillaEnIdioma(bienvenida, 'en-US');
    expect((t.actions[0] as any).title).toContain('{{customerName}}');
    expect((t.actions[0] as any).body).toContain('{{cardName}}');
  });

  it('están traducidas las SEIS, no solo las fáciles', () => {
    for (const tpl of AUTOMATION_TEMPLATES) {
      const t = plantillaEnIdioma(tpl, 'en-US');
      expect(t.name, `falta la traducción de ${tpl.id}`).not.toBe(tpl.name);
      for (const [i, a] of tpl.actions.entries()) {
        const trad = t.actions[i] as any;
        if ((a as any).title) expect(trad.title).not.toBe((a as any).title);
        if ((a as any).body) expect(trad.body).not.toBe((a as any).body);
      }
    }
  });

  it('cada traducción tiene tantas acciones como la receta', () => {
    // Si alguien añade una acción a una receta y no traduce la nueva, se cae
    // aquí en vez de salir a producción a medio traducir.
    for (const tpl of AUTOMATION_TEMPLATES) {
      expect(PLANTILLAS_EN[tpl.id].actions.length, tpl.id).toBe(tpl.actions.length);
    }
  });

  it('una receta nueva sin traducir sale en español, no vacía', () => {
    const inventada = {
      id: 'no-existe',
      name: 'Receta nueva',
      description: 'Sin traducir todavía',
      actions: [{ type: 'SEND_PUSH', title: 'Hola', body: 'Qué tal' }],
    };
    expect(plantillaEnIdioma(inventada, 'en-US')).toBe(inventada);
  });

  it('reconoce las variantes de inglés y solo esas', () => {
    expect(enIngles('en-US')).toBe(true);
    expect(enIngles('en-GB')).toBe(true);
    expect(enIngles('EN')).toBe(true);
    expect(enIngles('es')).toBe(false);
    expect(enIngles('pt-BR')).toBe(false);
    expect(enIngles(null)).toBe(false);
  });
});
