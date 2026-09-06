/**
 * Pruebas del arqueo de aislamiento entre negocios.
 *
 * NO necesita base de datos: analiza ficheros de ejemplo con el AST.
 *
 * Por qué existen: `scripts/arqueo-aislamiento-tenant.cjs` corre en el CI y es
 * lo único que impide que entre una consulta que no acote el negocio. Si una
 * refactorización lo rompe en silencio —el schema cambia de sitio, el cliente
 * de Prisma se llama de otra forma, sube la versión mayor— el arqueo encuentra
 * cero hallazgos, informa de que todo va bien y el CI pasa en VERDE para
 * siempre. Un candado que siempre abre es peor que no poner candado, porque
 * además tranquiliza.
 *
 * Así que estas pruebas no comprueban «no peta»: comprueban que SIGUE
 * DETECTANDO lo que dice detectar, y que NO marca lo que es correcto.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCRIPT = path.join(__dirname, '..', 'scripts', 'arqueo-aislamiento-tenant.cjs');

let dir: string;
let srcDir: string;
let schema: string;

/** Esquema mínimo: un modelo de negocio y otro que NO lleva tenantId. */
const SCHEMA = `
model Producto {
  id       String @id
  tenantId String
  nombre   String
}

model Ajuste {
  id    String @id
  clave String
}
`;

function escribir(nombre: string, contenido: string) {
  fs.writeFileSync(path.join(srcDir, nombre), contenido, 'utf8');
}

/** Corre el arqueo sobre los ficheros de ejemplo y devuelve los hallazgos. */
function arquear(): {
  huerfanos: Array<{ archivo: string; fn: string; modelo: string; op: string }>;
  delegados: Array<{ fn: string }>;
  cubiertos: Array<{ fn: string }>;
} {
  const salida = execFileSync(
    process.execPath,
    [SCRIPT, `--src=${srcDir}`, `--schema=${schema}`, '--json'],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );
  return JSON.parse(salida);
}

const nombresHuerfanos = () => arquear().huerfanos.map((h) => h.fn);

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arqueo-'));
  srcDir = path.join(dir, 'src');
  fs.mkdirSync(srcDir);
  schema = path.join(dir, 'schema.prisma');
  fs.writeFileSync(schema, SCHEMA, 'utf8');
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('arqueo de aislamiento: lo que DEBE cazar', () => {
  it('un update por id sin acotar el negocio', () => {
    escribir(
      'malo.service.ts',
      `export class S {
        constructor(private prisma: any) {}
        async cambiarNombre(id: string, nombre: string) {
          return this.prisma.producto.update({ where: { id }, data: { nombre } });
        }
      }`,
    );
    const h = arquear().huerfanos;
    expect(h.map((x) => x.fn)).toContain('cambiarNombre');
    expect(h.find((x) => x.fn === 'cambiarNombre')?.op).toBe('update');
  });

  it('un include del tenant NO excusa la consulta: no filtra nada', () => {
    escribir(
      'include.service.ts',
      `export class S {
        constructor(private prisma: any) {}
        async traer(id: string) {
          return this.prisma.producto.findUnique({
            where: { id },
            include: { tenant: { select: { nombre: true } } },
          });
        }
      }`,
    );
    expect(nombresHuerfanos()).toContain('traer');
  });

  it('mencionar tenantId en un comentario o en un log no acota nada', () => {
    escribir(
      'comentario.service.ts',
      `export class S {
        constructor(private prisma: any) {}
        async borrar(id: string) {
          // aqui no hace falta tenantId porque si
          console.log('sin tenantId');
          return this.prisma.producto.delete({ where: { id } });
        }
      }`,
    );
    expect(nombresHuerfanos()).toContain('borrar');
  });

  it('un findMany sin where se lleva los productos de todos los negocios', () => {
    escribir(
      'global.service.ts',
      `export class S {
        constructor(private prisma: any) {}
        async todos() {
          return this.prisma.producto.findMany();
        }
      }`,
    );
    const h = arquear().huerfanos.find((x) => x.fn === 'todos');
    expect(h).toBeTruthy();
  });
});

describe('arqueo de aislamiento: lo que NO debe marcar', () => {
  it('un where compuesto con tenantId', () => {
    escribir(
      'bueno.service.ts',
      `export class S {
        constructor(private prisma: any) {}
        async traerBien(id: string, tenantId: string) {
          return this.prisma.producto.findFirst({ where: { id, tenantId } });
        }
      }`,
    );
    expect(nombresHuerfanos()).not.toContain('traerBien');
  });

  it('comprobar el negocio antes de escribir', () => {
    escribir(
      'comprobar.service.ts',
      `export class S {
        constructor(private prisma: any) {}
        async borrarBien(id: string, tenantId: string) {
          const p = await this.prisma.producto.findFirst({ where: { id, tenantId } });
          if (!p) throw new Error('no existe');
          return this.prisma.producto.delete({ where: { id } });
        }
      }`,
    );
    expect(nombresHuerfanos()).not.toContain('borrarBien');
  });

  it('un modelo sin tenantId no es asunto suyo', () => {
    escribir(
      'ajuste.service.ts',
      `export class S {
        constructor(private prisma: any) {}
        async tocarAjuste(id: string) {
          return this.prisma.ajuste.update({ where: { id }, data: { clave: 'x' } });
        }
      }`,
    );
    expect(nombresHuerfanos()).not.toContain('tocarAjuste');
  });

  it('el usuario de la sesion tocando su propia fila', () => {
    escribir(
      'propio.service.ts',
      `export class S {
        constructor(private prisma: any) {}
        async miProducto(user: { id: string }) {
          return this.prisma.producto.findUnique({ where: { id: user.id } });
        }
      }`,
    );
    expect(nombresHuerfanos()).not.toContain('miProducto');
  });

  it('una clave que solo TERMINA en "id" no es un identificador', () => {
    // Con la bandera /i, `\\w+Id$` casaba `paid` y `valid`.
    escribir(
      'paid.service.ts',
      `export class S {
        constructor(private prisma: any) {}
        async pagados(tenantId: string) {
          return this.prisma.producto.findMany({ where: { paid: true, tenantId } });
        }
      }`,
    );
    expect(nombresHuerfanos()).not.toContain('pagados');
  });
});

describe('el arqueo se niega a dar el visto bueno si no esta viendo el codigo', () => {
  /** Corre `--ci` y devuelve { code, salida } sin lanzar. */
  function ci(args: string[]): { code: number; salida: string } {
    try {
      const salida = execFileSync(process.execPath, [SCRIPT, ...args], {
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
      });
      return { code: 0, salida };
    } catch (e: any) {
      return { code: e.status ?? 1, salida: (e.stdout ?? '') + (e.stderr ?? '') };
    }
  }

  it('con el schema ilegible falla en vez de decir que todo esta bien', () => {
    const roto = path.join(dir, 'roto.prisma');
    fs.writeFileSync(roto, '// el schema se movio de sitio\n', 'utf8');
    const techo = path.join(dir, 'techo.json');
    fs.writeFileSync(
      techo,
      JSON.stringify({ _cordura: { modelos: 2, analizadas: 9 }, archivos: {} }),
      'utf8',
    );

    const r = ci([`--src=${srcDir}`, `--schema=${roto}`, `--baseline=${techo}`, '--ci']);
    expect(r.code).toBe(1);
    expect(r.salida).toContain('NO ESTA VIENDO EL CODIGO');
  });

  it('tampoco deja sellar un techo con el analisis roto', () => {
    const roto = path.join(dir, 'roto.prisma');
    const techo = path.join(dir, 'techo-sellar.json');
    const r = ci([`--src=${srcDir}`, `--schema=${roto}`, `--baseline=${techo}`, '--sellar']);
    expect(r.code).toBe(1);
    expect(fs.existsSync(techo)).toBe(false);
  });
});
