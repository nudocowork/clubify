import { describe, it, expect } from 'vitest';
import { transicionesPermitidas } from './lab.service';

/**
 * Los saltos de estado del Lab.
 *
 * No había ninguna prueba de esta tabla, y es la que decide si un cambio de
 * estado se acepta o devuelve un 400. Dos cosas la pusieron a prueba de golpe
 * (Javier, 2026-09-18):
 *
 *  1. «Cuando se aprueba, en lugar de ir a pendiente, ¿podemos colocarla a "En
 *     desarrollo" de inmediato?» — la escalera larga (evaluación → aprobada →
 *     desarrollo → pruebas) tiene sentido para una idea de la comunidad, que se
 *     vota antes de entrar al roadmap; para un TICKET de una marca blanca es
 *     burocracia: Humberto no manda ideas a votar, manda trabajo.
 *  2. «Cuando en Clubify aparezca, que se pueda marcar como completado».
 *
 * Y de paso el defecto que hacía esto invisible: el panel ofrecía los 7 estados
 * sin mirar desde cuál se venía, así que elegir uno no permitido devolvía un
 * 400 que el admin no podía interpretar. Ahora la lista sale de aquí.
 */

describe('los saltos de estado permitidos', () => {
  it('una propuesta nueva se puede aprobar y poner en desarrollo de una', () => {
    // El caso de Javier: sin esto había que pasar por «en evaluación» sí o sí.
    expect(transicionesPermitidas('PENDING')).toContain('IN_DEVELOPMENT');
    expect(transicionesPermitidas('PENDING')).toContain('APPROVED');
  });

  it('lo que está en desarrollo se puede dar por terminado', () => {
    // «Que se pueda marcar como completado». Antes había que pasar por
    // «en pruebas», que este equipo no usa.
    expect(transicionesPermitidas('IN_DEVELOPMENT')).toContain('IMPLEMENTED');
  });

  it('sigue existiendo el camino largo, para las ideas de la comunidad', () => {
    expect(transicionesPermitidas('PENDING')).toContain('EVALUATING');
    expect(transicionesPermitidas('EVALUATING')).toContain('APPROVED');
    expect(transicionesPermitidas('APPROVED')).toContain('IN_DEVELOPMENT');
    expect(transicionesPermitidas('IN_DEVELOPMENT')).toContain('IN_TESTING');
    expect(transicionesPermitidas('IN_TESTING')).toContain('IMPLEMENTED');
  });

  it('desde cualquier estado vivo se puede rechazar', () => {
    for (const s of ['PENDING', 'EVALUATING', 'APPROVED', 'IN_DEVELOPMENT', 'IN_TESTING'] as const) {
      expect(transicionesPermitidas(s)).toContain('REJECTED');
    }
  });

  it('lo implementado no se reabre: se propone de nuevo', () => {
    expect(transicionesPermitidas('IMPLEMENTED')).toEqual([]);
  });

  it('un rechazo se puede revivir', () => {
    expect(transicionesPermitidas('REJECTED')).toContain('PENDING');
    expect(transicionesPermitidas('REJECTED')).toContain('EVALUATING');
  });

  it('ningún estado se ofrece a sí mismo', () => {
    // Si se ofreciera, el modal podría abrir en un destino que da 400 — que es
    // justo lo que pasaba cuando se abría en el estado actual.
    for (const s of ['PENDING', 'EVALUATING', 'APPROVED', 'IN_DEVELOPMENT', 'IN_TESTING', 'REJECTED'] as const) {
      expect(transicionesPermitidas(s)).not.toContain(s);
    }
  });

  it('todos los estados vivos tienen al menos una salida', () => {
    // Un estado sin salida es un callejón: la propuesta se queda ahí para
    // siempre y hay que tocarla en la base.
    for (const s of ['PENDING', 'EVALUATING', 'APPROVED', 'IN_DEVELOPMENT', 'IN_TESTING', 'REJECTED'] as const) {
      expect(transicionesPermitidas(s).length).toBeGreaterThan(0);
    }
  });
});
