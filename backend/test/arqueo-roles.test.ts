/**
 * Pruebas de la matriz de roles contra la API.
 *
 * NO necesita base de datos: analiza controladores de ejemplo con el AST.
 *
 * Lo que protegen: que el arqueo siga distinguiendo un endpoint con `@Roles`
 * de uno sin él, y que entienda que el decorador del MÉTODO pisa al de la
 * clase — igual que hace el `Reflector` de Nest con `getAllAndOverride`. Si esa
 * distinción se rompe, el informe deja de ver justo los endpoints que quedan
 * abiertos a cualquier sesión, que es lo único que mira.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCRIPT = path.join(__dirname, '..', 'scripts', 'arqueo-roles.cjs');

let dir: string;
let srcDir: string;

type Ep = { handler: string; metodo: string; ruta: string; roles: string[] | null };

function arquear(contenido: string): { endpoints: Ep[]; abiertos: Ep[] } {
  fs.writeFileSync(path.join(srcDir, 'x.controller.ts'), contenido, 'utf8');
  const salida = execFileSync(process.execPath, [SCRIPT, `--src=${srcDir}`, '--json'], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  return JSON.parse(salida);
}

const buscar = (r: { endpoints: Ep[] }, h: string) => r.endpoints.find((e) => e.handler === h);

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arqrol-'));
  srcDir = path.join(dir, 'src');
  fs.mkdirSync(srcDir);
});
afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('matriz de roles', () => {
  it('caza el endpoint autenticado SIN @Roles', () => {
    const r = arquear(`
      @Controller('cosas')
      export class C {
        @Roles('TENANT_OWNER') @Get('con') con() { return 1; }
        @Post('sin') sin(@Body() b: any) { return b; }
      }`);
    expect(buscar(r, 'con')?.roles).toEqual(['TENANT_OWNER']);
    expect(buscar(r, 'sin')?.roles).toBeNull();
    expect(r.abiertos.map((e) => e.handler)).toContain('sin');
    expect(r.abiertos.map((e) => e.handler)).not.toContain('con');
  });

  it('el @Roles de la CLASE cubre a sus metodos', () => {
    const r = arquear(`
      @Roles('SUPER_ADMIN')
      @Controller('admin')
      export class C {
        @Get('a') a() { return 1; }
      }`);
    expect(buscar(r, 'a')?.roles).toEqual(['SUPER_ADMIN']);
    expect(r.abiertos.length).toBe(0);
  });

  it('el @Roles del METODO pisa al de la clase, como hace Nest', () => {
    // El Reflector usa getAllAndOverride: gana el del handler.
    const r = arquear(`
      @Roles('SUPER_ADMIN')
      @Controller('admin')
      export class C {
        @Roles('TENANT_OWNER', 'TENANT_STAFF') @Get('a') a() { return 1; }
      }`);
    expect(buscar(r, 'a')?.roles).toEqual(['TENANT_OWNER', 'TENANT_STAFF']);
  });

  it('las rutas @Public NO son asunto de este arqueo', () => {
    // De esas se ocupa arqueo-rutas-publicas: aqui solo van las de sesion.
    const r = arquear(`
      @Controller('c')
      export class C {
        @Public() @Get('abierta') abierta() { return 1; }
        @Roles('TENANT_OWNER') @Get('cerrada') cerrada() { return 2; }
      }`);
    expect(buscar(r, 'abierta')).toBeUndefined();
    expect(buscar(r, 'cerrada')).toBeTruthy();
  });

  it('separa lo que es sobre uno mismo de lo que abre datos ajenos', () => {
    const r = arquear(`
      @Controller('users/me')
      export class C {
        @Get() yo() { return 1; }
      }`);
    // Aparece como endpoint sin @Roles, pero no cuenta como "abierto":
    // /users/me es correcto que lo alcance cualquier sesion.
    expect(buscar(r, 'yo')?.roles).toBeNull();
    expect(r.abiertos.map((e) => e.handler)).not.toContain('yo');
  });

  it('falla si no esta viendo el codigo, en vez de decir que no falta nada', () => {
    const vacio = path.join(dir, 'vacio');
    fs.mkdirSync(vacio, { recursive: true });
    let code = 0;
    try {
      execFileSync(process.execPath, [SCRIPT, `--src=${vacio}`], { encoding: 'utf8' });
    } catch (e: any) {
      code = e.status ?? 1;
    }
    expect(code).toBe(1);
  });
});
