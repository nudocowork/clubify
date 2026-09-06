/**
 * Pruebas del arqueo de índices que faltan.
 *
 * NO necesita base de datos: analiza ficheros de ejemplo con el AST.
 *
 * Lo que hay que proteger aquí es la distinción que hace útil el informe: un
 * campo sin índice ACOMPAÑADO de otro que sí lo tiene no escanea la tabla
 * —Postgres entra por el índice y filtra el resto sobre pocas filas—, mientras
 * que el mismo campo solo, sí. Si esa distinción se rompe, el informe pasa de
 * 121 casos accionables a 289 con ruido, y deja de leerse.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCRIPT = path.join(__dirname, '..', 'scripts', 'arqueo-indices.cjs');

let dir: string;
let srcDir: string;
let schema: string;

const SCHEMA = `
model Pedido {
  id       String @id
  tenantId String
  estado   String
  nota     String

  @@index([tenantId])
}
`;

function correr(): string {
  return execFileSync(
    process.execPath,
    [SCRIPT, `--src=${srcDir}`, `--schema=${schema}`, '--full'],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  );
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arqidx-'));
  srcDir = path.join(dir, 'src');
  fs.mkdirSync(srcDir);
  schema = path.join(dir, 'schema.prisma');
  fs.writeFileSync(schema, SCHEMA, 'utf8');
});
afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('arqueo de indices', () => {
  it('marca como escaneo el filtro por un campo sin indice y sin acompanante', () => {
    fs.writeFileSync(
      path.join(srcDir, 'a.service.ts'),
      `export class S {
        constructor(private prisma: any) {}
        porEstado(estado: string) {
          return this.prisma.pedido.findMany({ where: { estado } });
        }
      }`,
      'utf8',
    );
    const salida = correr();
    expect(salida).toContain('Pedido.estado');
    expect(salida).toMatch(/1x sin entrada\s+Pedido\.estado/);
  });

  it('NO lo marca como escaneo si el where lleva un campo indexado', () => {
    fs.writeFileSync(
      path.join(srcDir, 'a.service.ts'),
      `export class S {
        constructor(private prisma: any) {}
        porEstadoDelNegocio(tenantId: string, estado: string) {
          return this.prisma.pedido.findMany({ where: { tenantId, estado } });
        }
      }`,
      'utf8',
    );
    const salida = correr();
    // Sigue apareciendo (no esta indexado) pero como acompanado, no escaneo.
    expect(salida).toMatch(/1x acompanado\s+Pedido\.estado/);
    expect(salida).not.toMatch(/sin entrada\s+Pedido\.estado/);
  });

  it('no se queja de un campo que si tiene indice', () => {
    fs.writeFileSync(
      path.join(srcDir, 'a.service.ts'),
      `export class S {
        constructor(private prisma: any) {}
        porNegocio(tenantId: string) {
          return this.prisma.pedido.findMany({ where: { tenantId } });
        }
      }`,
      'utf8',
    );
    expect(correr()).not.toContain('Pedido.tenantId');
  });

  it('falla si no esta viendo el codigo, en vez de decir que no falta nada', () => {
    const roto = path.join(dir, 'roto.prisma');
    fs.writeFileSync(roto, '// schema movido\n', 'utf8');
    let code = 0;
    try {
      execFileSync(process.execPath, [SCRIPT, `--src=${srcDir}`, `--schema=${roto}`], {
        encoding: 'utf8',
      });
    } catch (e: any) {
      code = e.status ?? 1;
    }
    expect(code).toBe(1);
  });
});
