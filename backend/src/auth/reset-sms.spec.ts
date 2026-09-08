/**
 * Restablecer la contraseña por SMS: lo que impide que se adivine el código.
 *
 * NO necesita base de datos: se le pasa un Prisma de mentira.
 *
 * Por qué existen estas pruebas. El código son seis dígitos, y tres fallos
 * pequeños se multiplicaban entre sí hasta volverlo adivinable en minutos con
 * solo el número de teléfono de la víctima (P0-7):
 *
 *   1. se generaba con `Math.random()`, que no es criptográfico;
 *   2. cada petición dejaba OTRO código válido, sin matar los anteriores —con
 *      100 llamadas, acertar pasaba de 1 entre un millón a 1 entre 10.000—;
 *   3. no había contador de intentos, así que fallar salía gratis.
 *
 * Si alguien quita cualquiera de las tres protecciones, el ataque vuelve. De
 * eso van estos casos.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuthService } from './auth.service';

/** Prisma de mentira con lo justo para este flujo. */
function prismaFalso() {
  const tokens: any[] = [];
  const usuario = { id: 'u1', phone: '573001112233', email: 'a@b.c', isActive: true };
  return {
    tokens,
    usuario,
    user: {
      findMany: vi.fn(async () => [usuario]),
      findFirst: vi.fn(async () => usuario),
      findUnique: vi.fn(async () => usuario),
      update: vi.fn(async () => usuario),
    },
    passwordResetToken: {
      count: vi.fn(async ({ where }: any) => {
        const desde = where?.createdAt?.gte?.getTime?.() ?? 0;
        return tokens.filter((t) => t.createdAt.getTime() >= desde).length;
      }),
      create: vi.fn(async ({ data }: any) => {
        const t = { id: `t${tokens.length + 1}`, attempts: 0, usedAt: null, createdAt: new Date(), ...data };
        tokens.push(t);
        return t;
      }),
      findFirst: vi.fn(async ({ where }: any) => {
        const vivos = tokens
          .filter((t) => t.usedAt === null && t.expiresAt > new Date())
          .sort((a, b) => b.createdAt - a.createdAt);
        if (where?.tokenHash) return vivos.find((t) => t.tokenHash === where.tokenHash) ?? null;
        return vivos[0] ?? null;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const t = tokens.find((x) => x.id === where.id);
        if (!t) return null;
        if (data.attempts?.increment) t.attempts += data.attempts.increment;
        if (data.usedAt) t.usedAt = data.usedAt;
        return t;
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const afectados = tokens.filter(
          (t) =>
            (where.id ? t.id === where.id : true) &&
            (where.userId ? t.userId === where.userId : true) &&
            (where.usedAt === null ? t.usedAt === null : true),
        );
        for (const t of afectados) if (data.usedAt) t.usedAt = data.usedAt;
        return { count: afectados.length };
      }),
    },
  };
}

/** Monta AuthService con lo mínimo, saltándose el contenedor de Nest. */
function servicio(prisma: any) {
  const svc = Object.create(AuthService.prototype) as any;
  svc.prisma = prisma;
  svc.logger = { warn: vi.fn(), log: vi.fn(), error: vi.fn() };
  svc.refreshTokens = { revokeAllForUser: vi.fn(async () => undefined) };
  svc.hashPassword = vi.fn(async (p: string) => `hash:${p}`);
  svc.resolveDefaultSmsAccount = vi.fn(async () => null); // no manda SMS de verdad
  svc.resolveBrandNameForUser = vi.fn(async () => 'Marca');
  svc.findUniqueUserByPhoneLast10 = vi.fn(async () => prisma.usuario);
  return svc as AuthService;
}

const TELEFONO = '3001112233';

beforeEach(() => {
  process.env.QR_HMAC_SECRET = 'secreto-de-prueba-para-los-codigos-sms';
});

describe('pedir el codigo', () => {
  it('solo deja UN codigo vivo: el nuevo mata a los anteriores', async () => {
    // El multiplicador del ataque: con N codigos vivos, acertar es N veces
    // mas facil.
    const prisma = prismaFalso();
    const svc = servicio(prisma);

    await svc.requestPasswordResetSms(TELEFONO);
    await svc.requestPasswordResetSms(TELEFONO);
    await svc.requestPasswordResetSms(TELEFONO);

    const vivos = prisma.tokens.filter((t: any) => t.usedAt === null);
    expect(vivos.length).toBe(1);
  });

  it('corta al llegar al tope por hora, sin decir que ha cortado', async () => {
    const prisma = prismaFalso();
    const svc = servicio(prisma);

    for (let i = 0; i < 8; i++) await svc.requestPasswordResetSms(TELEFONO);

    // 5 es el tope; el resto no crea nada.
    expect(prisma.tokens.length).toBe(5);
    // Y la respuesta es la de siempre: no puede servir para saber si el
    // telefono existe o si hay tope.
    await expect(svc.requestPasswordResetSms(TELEFONO)).resolves.toEqual({ ok: true });
  });

  it('el codigo no sale de Math.random()', async () => {
    // Si alguien vuelve a Math.random(), esto lo caza: se fija la semilla y se
    // comprueba que el codigo NO es el que Math.random() habria dado.
    const prisma = prismaFalso();
    const svc = servicio(prisma);
    const espia = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      await svc.requestPasswordResetSms(TELEFONO);
    } finally {
      espia.mockRestore();
    }
    // Con Math.random()=0.5 el codigo viejo habria sido siempre 550000.
    const conMathRandom = require('crypto')
      .createHmac('sha256', process.env.QR_HMAC_SECRET)
      .update('550000')
      .digest('hex');
    expect(prisma.tokens[0].tokenHash).not.toBe(conMathRandom);
  });
});

describe('usar el codigo', () => {
  /** Pide un codigo y devuelve el de verdad, sacándolo del hash por fuerza
   *  bruta (son 10^6: en una prueba es instantáneo y demuestra el punto). */
  async function pedirYAveriguar(svc: any, prisma: any): Promise<string> {
    await svc.requestPasswordResetSms(TELEFONO);
    const hash = prisma.tokens[prisma.tokens.length - 1].tokenHash;
    const { createHmac } = require('crypto');
    for (let i = 0; i < 1_000_000; i++) {
      const c = String(i).padStart(6, '0');
      if (createHmac('sha256', process.env.QR_HMAC_SECRET).update(c).digest('hex') === hash) return c;
    }
    throw new Error('no se encontro el codigo');
  }

  it('el codigo bueno cambia la contrasena y cierra las sesiones abiertas', async () => {
    const prisma = prismaFalso();
    const svc = servicio(prisma) as any;
    const code = await pedirYAveriguar(svc, prisma);

    await expect(svc.resetPasswordWithSmsCode(TELEFONO, code, 'NuevaClave123')).resolves.toEqual({
      ok: true,
    });
    // Si te robaron la sesion, cambiar la clave tiene que echarlos.
    expect(svc.refreshTokens.revokeAllForUser).toHaveBeenCalledWith('u1');
    // Y el codigo queda gastado.
    expect(prisma.tokens[0].usedAt).not.toBeNull();
  });

  it('se quema a los 5 fallos, en vez de dejar probar sin fin', async () => {
    const prisma = prismaFalso();
    const svc = servicio(prisma) as any;
    await svc.requestPasswordResetSms(TELEFONO);

    for (let i = 0; i < 5; i++) {
      await expect(svc.resetPasswordWithSmsCode(TELEFONO, '000000', 'ClaveLarga123')).rejects.toThrow();
    }
    expect(prisma.tokens[0].attempts).toBe(5);

    // El sexto ya no prueba nada: el codigo esta muerto.
    await expect(svc.resetPasswordWithSmsCode(TELEFONO, '000000', 'ClaveLarga123')).rejects.toThrow(
      /Demasiados intentos/,
    );
    expect(prisma.tokens[0].usedAt).not.toBeNull();
  });

  it('un codigo ya gastado no vale dos veces', async () => {
    const prisma = prismaFalso();
    const svc = servicio(prisma) as any;
    const code = await pedirYAveriguar(svc, prisma);

    await svc.resetPasswordWithSmsCode(TELEFONO, code, 'NuevaClave123');
    await expect(svc.resetPasswordWithSmsCode(TELEFONO, code, 'Otra456')).rejects.toThrow();
  });
});
