/**
 * El segundo factor se bloquea al fallar demasiado.
 *
 * NO necesita base de datos: se le pasa un Prisma de mentira.
 *
 * Por qué. `/auth/2fa/challenge` no tenía ningún contador: probar un código
 * cuesta una lectura y un HMAC, y con la tolerancia de ±30 s hay unos tres
 * códigos válidos por ventana. Sin límite de peticiones que funcione, el
 * segundo factor de una cuenta con la contraseña ya filtrada era cuestión de
 * insistir (P0-8).
 *
 * El bloqueo es TEMPORAL a propósito, y eso también se prueba: uno permanente
 * convertiría «fallar cinco veces» en dejar a alguien fuera de su cuenta para
 * siempre, y hoy no hay ninguna ruta de administración para desbloquear.
 */
import { describe, it, expect, vi } from 'vitest';
import { TwoFactorService } from './two-factor.service';

/** Usuario con 2FA activo y un secreto conocido. */
function prismaFalso(overrides: Record<string, unknown> = {}) {
  const usuario: any = {
    id: 'u1',
    totpSecret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
    totpEnabledAt: new Date('2026-01-01'),
    totpFallos: 0,
    totpBloqueadoHasta: null,
    ...overrides,
  };
  return {
    usuario,
    user: {
      findUnique: vi.fn(async () => usuario),
      update: vi.fn(async ({ data }: any) => {
        Object.assign(usuario, data);
        return usuario;
      }),
    },
  };
}

function servicio(prisma: any) {
  const svc = Object.create(TwoFactorService.prototype) as any;
  svc.prisma = prisma;
  svc.appConfig = {};
  return svc as TwoFactorService;
}

describe('bloqueo del segundo factor', () => {
  it('cada codigo malo suma un fallo', async () => {
    const prisma = prismaFalso();
    const svc = servicio(prisma);

    await svc.verify('u1', '000000');
    expect(prisma.usuario.totpFallos).toBe(1);

    await svc.verify('u1', '111111');
    expect(prisma.usuario.totpFallos).toBe(2);
  });

  it('a los 5 fallos queda bloqueado', async () => {
    const prisma = prismaFalso();
    const svc = servicio(prisma);

    for (let i = 0; i < 5; i++) await svc.verify('u1', '000000');

    expect(prisma.usuario.totpFallos).toBe(5);
    expect(prisma.usuario.totpBloqueadoHasta).toBeInstanceOf(Date);
    expect(prisma.usuario.totpBloqueadoHasta.getTime()).toBeGreaterThan(Date.now());
  });

  it('bloqueado, ni se mira el codigo', async () => {
    // Aunque mandaran el bueno: primero se comprueba el bloqueo.
    const prisma = prismaFalso({
      totpFallos: 5,
      totpBloqueadoHasta: new Date(Date.now() + 10 * 60 * 1000),
    });
    const svc = servicio(prisma);

    expect(await svc.verify('u1', '123456')).toBe(false);
    // No suma otro fallo: ya está bloqueado, no se cuenta dos veces.
    expect(prisma.usuario.totpFallos).toBe(5);
  });

  it('el bloqueo CADUCA: pasado el rato se puede volver a intentar', async () => {
    // Lo importante de que sea temporal. Con un bloqueo permanente, cinco
    // fallos dejarían a alguien fuera de su cuenta para siempre.
    const prisma = prismaFalso({
      totpFallos: 5,
      totpBloqueadoHasta: new Date(Date.now() - 60 * 1000), // ya pasó
    });
    const svc = servicio(prisma);

    await svc.verify('u1', '000000');
    // Vuelve a contar intentos en vez de rechazar sin mirar.
    //
    // Este caso esperaba 6, y ese 6 ERA el bug: el contador sobrevivía al
    // bloqueo, así que el primer tropiezo después de esperar los quince
    // minutos rebloqueaba otros quince. La prueba daba por bueno el
    // comportamiento que dejaba a la gente fuera de su cuenta. Con el bloqueo
    // ya cumplido los cinco tiros se devuelven enteros: esto es 1 de 5.
    expect(prisma.usuario.totpFallos).toBe(1);
  });

  it('sin 2FA activo no bloquea a nadie', async () => {
    const prisma = prismaFalso({ totpEnabledAt: null, totpSecret: null });
    const svc = servicio(prisma);

    expect(await svc.verify('u1', '000000')).toBe(false);
    // Y no escribe nada: no hay segundo factor que proteger.
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('cuando el bloqueo CADUCA, se devuelven los cinco tiros', async () => {
    // El contador sobrevivía al bloqueo: quien esperaba sus quince minutos
    // volvía con totpFallos en 5, así que UNA equivocación al teclear lo
    // rebloqueaba otros quince. A partir del primer bloqueo, cada fallo
    // suelto costaba un cuarto de hora y el dueño se quedaba fuera de su
    // propia cuenta dando vueltas.
    const prisma = prismaFalso({
      totpFallos: 5,
      totpBloqueadoHasta: new Date(Date.now() - 60_000), // caducó hace un minuto
    });
    const svc = servicio(prisma);

    expect(await svc.verify('u1', '000000')).toBe(false);

    // Lo que importa: cuenta 1 de 5, no 6 — y el bloqueo viejo se limpia.
    expect(prisma.usuario.totpFallos).toBe(1);
    expect(prisma.usuario.totpBloqueadoHasta).toBeNull();
  });

  it('el bloqueo viejo se limpia, no se arrastra vuelta tras vuelta', async () => {
    // Si el bloqueo caducado siguiera puesto, el propio «caducó» de la
    // siguiente vuelta perdonaría los fallos otra vez, y así siempre: nunca
    // se volvería a bloquear a nadie.
    const prisma = prismaFalso({
      totpFallos: 5,
      totpBloqueadoHasta: new Date(Date.now() - 60_000),
    });
    const svc = servicio(prisma);

    for (let i = 0; i < 5; i++) {
      await svc.verify('u1', '000000');
    }

    // Cinco fallos seguidos tras el perdón: vuelve a bloquear de verdad.
    expect(prisma.usuario.totpFallos).toBe(5);
    expect(prisma.usuario.totpBloqueadoHasta).toBeInstanceOf(Date);
    expect(prisma.usuario.totpBloqueadoHasta.getTime()).toBeGreaterThan(Date.now());
  });

  it('un bloqueo VIGENTE sigue bloqueando: esto no lo perdona', async () => {
    // El perdón es solo para el bloqueo ya cumplido. Mientras corre, ni se
    // mira el código.
    const prisma = prismaFalso({
      totpFallos: 5,
      totpBloqueadoHasta: new Date(Date.now() + 10 * 60_000),
    });
    const svc = servicio(prisma);

    expect(await svc.verify('u1', '000000')).toBe(false);
    // Ni siquiera escribe: sale antes de tocar la base.
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.usuario.totpFallos).toBe(5);
  });
});
