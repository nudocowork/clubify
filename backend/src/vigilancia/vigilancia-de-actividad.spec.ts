import { describe, it, expect, vi } from 'vitest';
import { CLAVE_HISTORIAL, VigilanciaDeActividadService } from './vigilancia-de-actividad.service';

/**
 * Desde el 2026-10-04 la vigilancia de actividad NO avisa a nadie (Javier: «no
 * son necesarios, que se los quede el sistema»). Lo que se prueba es que el
 * sistema se quede con lo que importa: cuándo empezó y cuándo terminó cada
 * bajón, sin repetirlo cada hora y sin borrar una caída por una franja muda.
 */
function make(opts: { estadoGuardado?: string; historial?: unknown[] } = {}) {
  const setting = {
    findUnique: vi.fn().mockImplementation(async ({ where }: any) => {
      if (where.key === CLAVE_HISTORIAL) {
        return opts.historial ? { key: where.key, value: JSON.stringify(opts.historial) } : null;
      }
      return opts.estadoGuardado ? { key: where.key, value: opts.estadoGuardado } : null;
    }),
    upsert: vi.fn().mockResolvedValue({}),
  };
  const prisma = { setting, $queryRawUnsafe: vi.fn() };
  const svc = new VigilanciaDeActividadService(prisma as any);
  return { svc, prisma, setting };
}

/** Llama al privado que registra los cambios. */
const registrar = (svc: any, v: any, actual = 0, esperado = 40) =>
  svc.registrarSiCambio({ nombre: 'pedidos', tabla: 'Order', campo: 'createdAt', minimoUtil: 3 },
    actual, esperado, v, 20);

const escrito = (setting: any, clave: string) =>
  setting.upsert.mock.calls.find((c: any) => c[0].where.key === clave)?.[0].update.value;

const CAIDA = { estado: 'caida', gravedad: 'total', motivo: '0 cuando lo normal a esta hora son 40' };
const SANO = { estado: 'sano', motivo: '38, normal a esta hora 40' };
const SIN_SEÑAL = { estado: 'sin-señal', motivo: 'esta franja normalmente tiene 1' };

describe('registrar solo cuando cambia, sin avisar a nadie', () => {
  it('una caída queda en el historial y en el estado', async () => {
    const { svc, setting } = make({ estadoGuardado: 'sano' });
    await registrar(svc, CAIDA);
    expect(escrito(setting, 'vigilancia:actividad:Order')).toBe('caida');
    const h = JSON.parse(escrito(setting, CLAVE_HISTORIAL));
    expect(h[0]).toMatchObject({ señal: 'pedidos', estado: 'caida', actual: 0, esperado: 40, franjaUtc: '20:00-21:00' });
  });

  it('no se repite cada hora mientras dure', async () => {
    const { svc, setting } = make({ estadoGuardado: 'caida' });
    await registrar(svc, CAIDA);
    expect(setting.upsert).not.toHaveBeenCalled();
  });

  it('la recuperación también queda: así se sabe cuánto duró', async () => {
    const { svc, setting } = make({ estadoGuardado: 'caida', historial: [{ estado: 'caida' }] });
    await registrar(svc, SANO, 38, 40);
    const h = JSON.parse(escrito(setting, CLAVE_HISTORIAL));
    expect(h.map((e: any) => e.estado)).toEqual(['sano', 'caida']);
  });

  it('con todo normal no escribe nada', async () => {
    const { svc, setting } = make({ estadoGuardado: 'sano' });
    await registrar(svc, SANO, 38, 40);
    expect(setting.upsert).not.toHaveBeenCalled();
  });

  it('una franja sin señal NO pisa el estado guardado', async () => {
    // Si a las 4 de la mañana se escribiera «sano», se borraría una caída que
    // empezó a medianoche y sigue ahí.
    const { svc, setting } = make({ estadoGuardado: 'caida' });
    await registrar(svc, SIN_SEÑAL);
    expect(setting.upsert).not.toHaveBeenCalled();
  });

  it('el historial no crece sin límite', async () => {
    const { svc, setting } = make({ estadoGuardado: 'sano', historial: Array.from({ length: 200 }, () => ({})) });
    await registrar(svc, CAIDA);
    expect(JSON.parse(escrito(setting, CLAVE_HISTORIAL))).toHaveLength(200);
  });
});

describe('lo normal cuenta los días en cero (2026-10-03)', () => {
  it('un día sin actividad entra al histórico como 0, no desaparece', async () => {
    const { svc, prisma } = make();
    // La base solo devuelve los días que tuvieron algo.
    prisma.$queryRawUnsafe.mockResolvedValue([{ dia: new Date('2026-10-01T00:00:00Z'), n: 4 }]);
    const hasta = new Date('2026-10-04T04:00:00Z');
    const desde = new Date(hasta.getTime() - 21 * 86_400_000);
    const m: Map<string, number> = await (svc as any).conteoPorDia(
      { nombre: 'tarjetas emitidas', tabla: 'Pass', campo: 'issuedAt', minimoUtil: 2 },
      desde,
      hasta,
      3,
    );
    expect(m.size).toBe(21);
    expect(m.get('2026-10-01')).toBe(4);
    expect(m.get('2026-10-02')).toBe(0);
    expect(m.get('2026-10-04')).toBe(0);
  });
});
