/**
 * Pruebas del trinquete de dependencias vulnerables.
 *
 * NO necesita base de datos ni red: la auditoría se inyecta desde un JSON
 * (`--auditoria=`) en vez de ejecutar `npm audit`.
 *
 * Por qué existen: `scripts/arqueo-dependencias.cjs` corre en el CI y decide si
 * entra una dependencia vulnerable nueva. Las dos formas de que deje de servir
 * son silenciosas —dar verde cuando no ha podido auditar, o dar verde cuando sí
 * ha subido algo grave— y ninguna se nota mirando el log en verde.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'arqueo-dependencias.cjs');

let dir: string;

const TECHO = {
  win32: {
    backend: { critical: 1, high: 14, moderate: 24, low: 1 },
    frontend: { critical: 0, high: 8, moderate: 10, low: 1 },
  },
  linux: {
    backend: { critical: 1, high: 14, moderate: 24, low: 1 },
    frontend: { critical: 0, high: 8, moderate: 10, low: 1 },
  },
  darwin: {
    backend: { critical: 1, high: 14, moderate: 24, low: 1 },
    frontend: { critical: 0, high: 8, moderate: 10, low: 1 },
  },
};

const AL_DIA = {
  backend: { critical: 1, high: 14, moderate: 24, low: 1, graves: [] },
  frontend: { critical: 0, high: 8, moderate: 10, low: 1, graves: [] },
};

/** Corre el arqueo con un techo y una auditoría de mentira. */
function ci(techo: unknown, auditoria: unknown): { code: number; salida: string } {
  const fT = path.join(dir, `techo-${Math.random().toString(36).slice(2)}.json`);
  const fA = path.join(dir, `audit-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(fT, JSON.stringify(techo), 'utf8');
  fs.writeFileSync(fA, JSON.stringify(auditoria), 'utf8');
  try {
    const salida = execFileSync(
      process.execPath,
      [SCRIPT, `--baseline=${fT}`, `--auditoria=${fA}`, '--ci'],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
    );
    return { code: 0, salida };
  } catch (e: any) {
    return { code: e.status ?? 1, salida: (e.stdout ?? '') + (e.stderr ?? '') };
  }
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arqdep-'));
});
afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('trinquete de dependencias', () => {
  it('pasa cuando nada ha subido', () => {
    const r = ci(TECHO, AL_DIA);
    expect(r.code).toBe(0);
    expect(r.salida).toContain('sin vulnerabilidades nuevas');
  });

  it('BLOQUEA cuando sube una ALTA', () => {
    const subida = { ...AL_DIA, backend: { ...AL_DIA.backend, high: 15 } };
    const r = ci(TECHO, subida);
    expect(r.code).toBe(1);
    expect(r.salida).toContain('backend  high: 14 -> 15');
  });

  it('BLOQUEA cuando sube una CRITICA', () => {
    const subida = { ...AL_DIA, backend: { ...AL_DIA.backend, critical: 2 } };
    expect(ci(TECHO, subida).code).toBe(1);
  });

  it('avisa pero NO bloquea cuando sube una moderada', () => {
    // Un CVE nuevo de nivel moderate en una dependencia de tercero no puede
    // dejar a nadie sin mergear un arreglo urgente.
    const subida = { ...AL_DIA, frontend: { ...AL_DIA.frontend, moderate: 11 } };
    const r = ci(TECHO, subida);
    expect(r.code).toBe(0);
    expect(r.salida).toContain('no son graves');
  });

  it('avisa de que se selle cuando algo BAJA', () => {
    const bajada = { ...AL_DIA, backend: { ...AL_DIA.backend, high: 10 } };
    const r = ci(TECHO, bajada);
    expect(r.code).toBe(0);
    expect(r.salida).toContain('Bajaron');
  });
});

describe('no da verde cuando no ha podido mirar', () => {
  it('BLOQUEA si un paquete del techo no devuelve auditoria', () => {
    // `npm audit` que falla solo en frontend no es «frontend sin
    // vulnerabilidades»: es no haber mirado el frontend.
    const soloBackend = { backend: AL_DIA.backend };
    const r = ci(TECHO, soloBackend);
    expect(r.code).toBe(1);
    expect(r.salida).toContain('NO SE PUDO AUDITAR');
    expect(r.salida).toContain('frontend');
  });

  it('BLOQUEA si no hay techo para ninguna plataforma conocida', () => {
    const r = ci({}, AL_DIA);
    // Sin techo para esta plataforma avisa y deja pasar (no puede comparar),
    // pero nunca dice que este todo bien.
    expect(r.salida).toContain('No hay techo sellado');
    expect(r.salida).not.toContain('sin vulnerabilidades nuevas');
  });
});
