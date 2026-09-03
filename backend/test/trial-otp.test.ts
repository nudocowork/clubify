import { describe, it, expect, vi } from 'vitest';
import * as argon2 from 'argon2';
import { TrialOtpService } from '../src/auth/trial-otp.service';

/**
 * PIN por correo de la prueba gratuita.
 *
 * Lo que se blinda acá es seguridad, no comodidad: que el código no se pueda
 * adivinar ni reusar, que no se guarde en claro, y que pedirlo no sirva para
 * averiguar quién es cliente.
 */
function make(opts: { ultimo?: any; pedidos?: number; enviado?: boolean } = {}) {
  const prisma = {
    trialEmailOtp: {
      count: vi.fn().mockResolvedValue(opts.pedidos ?? 0),
      create: vi.fn().mockImplementation(async ({ data }: any) => ({ id: 'otp1', ...data })),
      findFirst: vi.fn().mockResolvedValue(opts.ultimo ?? null),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const brandEmail = {
    sendRaw: vi.fn().mockResolvedValue(
      opts.enviado === false ? { sent: false, reason: 'no_connection' } : { sent: true },
    ),
  };
  const svc = new TrialOtpService(prisma as any, brandEmail as any);
  return { svc, prisma, brandEmail };
}
const enMinutos = (n: number) => new Date(Date.now() + n * 60_000);

describe('solicitar', () => {
  it('rechaza un correo inválido antes de tocar nada', async () => {
    const { svc, prisma } = make();
    await expect(svc.solicitar('no-es-un-correo')).rejects.toThrow(/correo válido/i);
    expect(prisma.trialEmailOtp.create).not.toHaveBeenCalled();
  });

  it('normaliza el correo (mayúsculas y espacios)', async () => {
    const { svc, prisma } = make();
    await svc.solicitar('  Ana@Mail.COM  ');
    expect(prisma.trialEmailOtp.create.mock.calls[0][0].data.email).toBe('ana@mail.com');
  });

  it('genera un PIN de 6 dígitos y lo manda por correo', async () => {
    const { svc, brandEmail } = make();
    await svc.solicitar('ana@mail.com');
    const asunto = brandEmail.sendRaw.mock.calls[0][0].subject as string;
    expect(asunto).toMatch(/^\d{6} /);
  });

  // Un volcado de la tabla NO debe alcanzar para crear cuentas.
  it('guarda el PIN HASHEADO, nunca en claro', async () => {
    const { svc, prisma, brandEmail } = make();
    await svc.solicitar('ana@mail.com');
    const guardado = prisma.trialEmailOtp.create.mock.calls[0][0].data.codeHash as string;
    const pin = (brandEmail.sendRaw.mock.calls[0][0].subject as string).slice(0, 6);
    expect(guardado).not.toContain(pin);
    expect(guardado.startsWith('$argon2')).toBe(true);
    await expect(argon2.verify(guardado, pin)).resolves.toBe(true);
  });

  it('frena el bombardeo: tope de pedidos por correo y hora', async () => {
    const { svc, prisma } = make({ pedidos: 5 });
    await expect(svc.solicitar('ana@mail.com')).rejects.toThrow(/varios códigos/i);
    expect(prisma.trialEmailOtp.create).not.toHaveBeenCalled();
  });

  it('si el correo no sale, lo dice sin romper', async () => {
    const { svc } = make({ enviado: false });
    await expect(svc.solicitar('ana@mail.com')).resolves.toMatchObject({ enviado: false });
  });

  // Pedir el código NO puede volverse un enumerador de clientes.
  it('la respuesta no depende de si el correo ya tiene cuenta', async () => {
    const a = make(); const b = make();
    const r1 = await a.svc.solicitar('existente@mail.com');
    const r2 = await b.svc.solicitar('nuevo@mail.com');
    expect(r1).toEqual(r2);
  });
});

describe('consumir', () => {
  const vivo = async (pin: string, extra: any = {}) => ({
    id: 'otp1', attempts: 0, consumedAt: null, expiresAt: enMinutos(5),
    codeHash: await argon2.hash(pin), ...extra,
  });

  it('exige 6 dígitos', async () => {
    const { svc } = make();
    await expect(svc.consumir('ana@mail.com', '123')).rejects.toThrow(/6 dígitos/i);
  });

  it('sin código vivo, manda a pedir uno nuevo', async () => {
    const { svc } = make({ ultimo: null });
    await expect(svc.consumir('ana@mail.com', '123456')).rejects.toThrow(/venció o ya se usó/i);
  });

  it('acepta el correcto y lo consume', async () => {
    const { svc, prisma } = make({ ultimo: await vivo('123456') });
    await expect(svc.consumir('ana@mail.com', '123456')).resolves.toBeUndefined();
    expect(prisma.trialEmailOtp.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'otp1', consumedAt: null } }),
    );
  });

  it('tolera espacios y guiones al pegarlo', async () => {
    const { svc } = make({ ultimo: await vivo('123456') });
    await expect(svc.consumir('ana@mail.com', '123-456')).resolves.toBeUndefined();
  });

  it('el incorrecto suma intento y avisa cuántos quedan', async () => {
    const { svc, prisma } = make({ ultimo: await vivo('123456') });
    await expect(svc.consumir('ana@mail.com', '000000')).rejects.toThrow(/quedan 4/i);
    expect(prisma.trialEmailOtp.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { attempts: { increment: 1 } } }),
    );
  });

  it('agotados los intentos, el código muere', async () => {
    const { svc } = make({ ultimo: await vivo('123456', { attempts: 5 }) });
    await expect(svc.consumir('ana@mail.com', '123456')).rejects.toThrow(/demasiados intentos/i);
  });

  // Carrera: dos peticiones con el mismo código no pueden crear dos cuentas.
  it('si otra petición lo consumió primero, la segunda falla', async () => {
    const { svc, prisma } = make({ ultimo: await vivo('123456') });
    prisma.trialEmailOtp.updateMany.mockResolvedValue({ count: 0 });
    await expect(svc.consumir('ana@mail.com', '123456')).rejects.toThrow(/ya se usó/i);
  });

  it('busca solo códigos vivos: ni vencidos ni consumidos', async () => {
    const { svc, prisma } = make({ ultimo: await vivo('123456') });
    await svc.consumir('ana@mail.com', '123456');
    const where = prisma.trialEmailOtp.findFirst.mock.calls[0][0].where;
    expect(where.consumedAt).toBeNull();
    expect(where.expiresAt).toHaveProperty('gt');
  });
});
