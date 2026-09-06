/**
 * Pruebas del inventario de rutas públicas.
 *
 * NO necesita base de datos: analiza controladores de ejemplo con el AST.
 *
 * Por qué existen, y esta es la lección cara: la primera versión daba por
 * seguras las rutas cuyo TEXTO DE CLASE contenía `firma`, y la palabra
 * «confirmación» en un comentario cualquiera bastaba. Con eso el inventario
 * escondió las 15 rutas `@Public()` de `/auth/*` —login, signup,
 * reset-password, 2FA— y se publicaron números falsos a partir de él.
 *
 * Marcar una ruta abierta como segura es peor que no mirarla: la saca de la
 * lista de pendientes y nadie vuelve. Así que lo que estas pruebas protegen,
 * sobre todo, es que NO se marque como autenticado lo que no lo está.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCRIPT = path.join(__dirname, '..', 'scripts', 'arqueo-rutas-publicas.cjs');

let dir: string;
let srcDir: string;

type Ruta = {
  handler: string;
  metodo: string;
  ruta: string;
  escribe: boolean;
  llaveDebil: boolean;
  otraAuth: boolean;
};

function arquear(contenido: string): Ruta[] {
  fs.writeFileSync(path.join(srcDir, 'x.controller.ts'), contenido, 'utf8');
  const salida = execFileSync(process.execPath, [SCRIPT, `--src=${srcDir}`, '--json'], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  return JSON.parse(salida);
}

const buscar = (rs: Ruta[], h: string) => rs.find((r) => r.handler === h);

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arqrut-'));
  srcDir = path.join(dir, 'src');
  fs.mkdirSync(srcDir);
});
afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('no marcar como autenticado lo que no lo esta', () => {
  it('un vecino que valida api-key NO cubre al handler de al lado', () => {
    const rs = arquear(`
      @Controller('cosas')
      export class C {
        private assertKey(k?: string) { if (k !== process.env.TEAM_INTEGRATION_KEY) throw new Error(); }
        @Public() @Get('protegida')
        protegida(@Headers('x-api-key') k: string) { this.assertKey(k); return 1; }
        @Public() @Post('abierta')
        abierta(@Param('slug') slug: string) { return slug; }
      }`);
    expect(buscar(rs, 'protegida')?.otraAuth).toBe(true);
    expect(buscar(rs, 'abierta')?.otraAuth).toBe(false);
  });

  it('la palabra "confirmacion" en un comentario no autentica nada', () => {
    // El fallo exacto que escondio las 15 rutas de /auth/*.
    const rs = arquear(`
      @Controller('auth')
      export class C {
        // Aqui se confirma el registro del usuario y se envia la confirmacion.
        @Public() @Post('login')
        login(@Body() body: any) { return body; }
      }`);
    expect(buscar(rs, 'login')?.otraAuth).toBe(false);
    expect(buscar(rs, 'login')?.escribe).toBe(true);
  });

  it('reconoce la firma de un webhook de verdad', () => {
    const rs = arquear(`
      @Controller('webhooks')
      export class C {
        @Public() @Post('stripe/:slug')
        recibir(@Param('slug') slug: string, @Req() req: any) {
          const evento = this.stripe.webhooks.constructEvent(req.rawBody, req.headers['stripe-signature'], secreto);
          return evento;
        }
      }`);
    expect(buscar(rs, 'recibir')?.otraAuth).toBe(true);
  });
});

describe('clasificacion de riesgo', () => {
  it('marca las que ESCRIBEN', () => {
    const rs = arquear(`
      @Controller('c')
      export class C {
        @Public() @Get(':id') leer(@Param('id') id: string) { return id; }
        @Public() @Delete(':id') borrar(@Param('id') id: string) { return id; }
      }`);
    expect(buscar(rs, 'leer')?.escribe).toBe(false);
    expect(buscar(rs, 'borrar')?.escribe).toBe(true);
  });

  it('distingue llave adivinable de llave que no se acierta', () => {
    const rs = arquear(`
      @Controller('c')
      export class C {
        @Public() @Get('por-codigo/:code') porCodigo(@Param('code') code: string) { return code; }
        @Public() @Get('por-id/:id') porId(@Param('id') id: string) { return id; }
      }`);
    expect(buscar(rs, 'porCodigo')?.llaveDebil).toBe(true);
    expect(buscar(rs, 'porId')?.llaveDebil).toBe(false);
  });

  it('coge las rutas de un controlador @Public() a nivel de clase', () => {
    const rs = arquear(`
      @Public()
      @Controller('todo-publico')
      export class C {
        @Get('a') a() { return 1; }
        @Post('b') b() { return 2; }
      }`);
    expect(rs.length).toBe(2);
    expect(buscar(rs, 'b')?.escribe).toBe(true);
  });

  it('NO incluye rutas que no son publicas', () => {
    const rs = arquear(`
      @Controller('c')
      export class C {
        @Public() @Get('abierta') abierta() { return 1; }
        @Get('cerrada') cerrada() { return 2; }
      }`);
    expect(buscar(rs, 'abierta')).toBeTruthy();
    expect(buscar(rs, 'cerrada')).toBeUndefined();
  });
});
