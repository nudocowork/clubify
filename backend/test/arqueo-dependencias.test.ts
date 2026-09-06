/**
 * Pruebas del trinquete de dependencias vulnerables.
 *
 * NO necesita base de datos ni red: la auditoría se inyecta desde un JSON
 * (`--auditoria=`) en vez de ejecutar `npm audit`.
 *
 * Por qué existen: este candado ya falló dos veces en silencio el mismo día.
 * La primera, comparando contadores: el mismo lockfile daba 14 altas en una
 * máquina y 15 en el CI —por la VERSIÓN DE NPM, no por el sistema— y el
 * «arreglo» por plataforma dejó el job imprimiendo «no hay techo para linux» y
 * saliendo 0 sin comparar nada. La segunda, con la red caída: `npm audit`
 * escribe un JSON válido de error, se leía como cero vulnerabilidades y el
 * trinquete lo celebraba como «bajaron todas».
 *
 * Las dos formas de que deje de servir son silenciosas, y ninguna se nota
 * mirando un log en verde. De ahí estos casos.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'arqueo-dependencias.cjs');

let dir: string;

const TECHO = {
  graves: {
    backend: ['jsonwebtoken:high', 'multer:high', 'tar:critical'],
    frontend: ['next:high'],
  },
};

const AL_DIA = {
  backend: {
    critical: 1,
    high: 2,
    moderate: 0,
    low: 0,
    graves: ['jsonwebtoken:high', 'multer:high', 'tar:critical'],
  },
  frontend: { critical: 0, high: 1, moderate: 0, low: 0, graves: ['next:high'] },
};

function correr(techo: unknown, auditoria: unknown, extra: string[] = []) {
  const fT = path.join(dir, `t-${Math.random().toString(36).slice(2)}.json`);
  const fA = path.join(dir, `a-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(fT, JSON.stringify(techo), 'utf8');
  fs.writeFileSync(fA, JSON.stringify(auditoria), 'utf8');
  try {
    const salida = execFileSync(
      process.execPath,
      [SCRIPT, `--baseline=${fT}`, `--auditoria=${fA}`, ...extra],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
    );
    return { code: 0, salida, techo: fT };
  } catch (e: any) {
    return { code: e.status ?? 1, salida: (e.stdout ?? '') + (e.stderr ?? ''), techo: fT };
  }
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arqdep-'));
});
afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('trinquete de dependencias', () => {
  it('pasa cuando no ha aparecido ningun paquete grave nuevo', () => {
    const r = correr(TECHO, AL_DIA, ['--ci']);
    expect(r.code).toBe(0);
    expect(r.salida).toContain('sin paquetes graves nuevos');
  });

  it('BLOQUEA cuando aparece un paquete grave nuevo', () => {
    const conNuevo = {
      ...AL_DIA,
      backend: { ...AL_DIA.backend, graves: [...AL_DIA.backend.graves, 'lodash:high'] },
    };
    const r = correr(TECHO, conNuevo, ['--ci']);
    expect(r.code).toBe(1);
    expect(r.salida).toContain('lodash:high');
  });

  it('BLOQUEA aunque el TOTAL no suba (uno entra y otro sale)', () => {
    // El fallo del trinquete por contadores: sustituir una alta por otra daba
    // verde porque el numero no se movia.
    const permutado = {
      ...AL_DIA,
      backend: { ...AL_DIA.backend, graves: ['jsonwebtoken:high', 'lodash:high', 'tar:critical'] },
    };
    const r = correr(TECHO, permutado, ['--ci']);
    expect(r.code).toBe(1);
    expect(r.salida).toContain('lodash:high');
  });

  it('avisa, pero no bloquea, cuando uno deja de aparecer', () => {
    // Otra version de npm puede seguir viendolo: se queda en el techo.
    const menos = {
      ...AL_DIA,
      backend: { ...AL_DIA.backend, graves: ['jsonwebtoken:high', 'tar:critical'] },
    };
    const r = correr(TECHO, menos, ['--ci']);
    expect(r.code).toBe(0);
    expect(r.salida).toContain('Ya no aparecen');
  });

  it('BLOQUEA si un paquete del techo no devuelve auditoria', () => {
    // `npm audit` que falla solo en frontend no es «frontend sin
    // vulnerabilidades»: es no haber mirado el frontend.
    const r = correr(TECHO, { backend: AL_DIA.backend }, ['--ci']);
    expect(r.code).toBe(1);
    expect(r.salida).toContain('NO SE PUDO AUDITAR LO QUE ANTES SI');
    expect(r.salida).toContain('frontend');
  });
});

describe('sellado', () => {
  it('ACUMULA en vez de reemplazar, para cubrir varias versiones de npm', () => {
    // npm 10 ve un paquete que npm 11 no. Si `--sellar` reemplazara, sellar
    // desde una maquina apagaria el candado para la otra.
    const soloUno = {
      backend: { critical: 0, high: 1, moderate: 0, low: 0, graves: ['jsonwebtoken:high'] },
      frontend: { critical: 0, high: 0, moderate: 0, low: 0, graves: [] },
    };
    const r = correr(TECHO, soloUno, ['--sellar']);
    expect(r.code).toBe(0);
    const techo = JSON.parse(fs.readFileSync(r.techo, 'utf8'));
    // Los tres de antes siguen ahi, no se han perdido.
    expect(techo.graves.backend).toContain('multer:high');
    expect(techo.graves.backend).toContain('tar:critical');
    expect(techo.graves.frontend).toContain('next:high');
  });
});
