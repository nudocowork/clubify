import { describe, it, expect, vi } from 'vitest';
import { VigilanciaDeActividadService } from './vigilancia-de-actividad.service';

/**
 * Lo que se prueba acá son las dos costuras donde esto se rompe de verdad:
 *
 *  1. Que no repita el aviso cada hora mientras dure la caída. A la tercera
 *     nadie lo lee, y entonces la alarma dejó de servir.
 *  2. Que el estado se selle SOLO si el aviso salió. Al revés, un SMS fallido
 *     deja la caída marcada como «ya avisada» y no se reintenta nunca — el
 *     fallo que ya se pagó dos veces en este repo (el `reminderSentAt` de las
 *     citas y la alerta de capacidad de la base).
 */
function make(opts: { estadoGuardado?: string; avisoOk?: boolean } = {}) {
  const setting = {
    findUnique: vi.fn().mockResolvedValue(
      opts.estadoGuardado ? { key: 'k', value: opts.estadoGuardado } : null,
    ),
    upsert: vi.fn().mockResolvedValue({}),
  };
  const prisma = { setting, $queryRawUnsafe: vi.fn() };
  const alerts = {
    sendTeamAlert: vi.fn().mockResolvedValue(
      opts.avisoOk === false ? { ok: false, sent: 0, total: 3 } : { ok: true, sent: 3, total: 3 },
    ),
  };
  const svc = new VigilanciaDeActividadService(prisma as any, alerts as any);
  return { svc, prisma, alerts, setting };
}

/** Llama al privado que decide si avisar. */
const avisar = (svc: any, v: any, actual = 0, esperado = 40) =>
  svc.avisarSiCambio({ nombre: 'pedidos', tabla: 'Order', campo: 'createdAt', minimoUtil: 3 },
    actual, esperado, v, 20);

const CAIDA = { estado: 'caida', gravedad: 'total', motivo: '0 cuando lo normal a esta hora son 40' };
const SANO = { estado: 'sano', motivo: '38, normal a esta hora 40' };
const SIN_SEÑAL = { estado: 'sin-señal', motivo: 'esta franja normalmente tiene 1' };

describe('avisar solo cuando cambia', () => {
  it('avisa la primera vez que cae', async () => {
    const { svc, alerts, setting } = make({ estadoGuardado: 'sano' });
    await avisar(svc, CAIDA);
    expect(alerts.sendTeamAlert).toHaveBeenCalledOnce();
    expect(alerts.sendTeamAlert.mock.calls[0][1]).toBe('actividad');
    expect(setting.upsert.mock.calls[0][0].update.value).toBe('caida');
  });

  it('NO vuelve a avisar en la hora siguiente si sigue caída', async () => {
    const { svc, alerts } = make({ estadoGuardado: 'caida' });
    await avisar(svc, CAIDA);
    expect(alerts.sendTeamAlert).not.toHaveBeenCalled();
  });

  it('avisa la recuperación, para no dejar a nadie esperando', async () => {
    const { svc, alerts } = make({ estadoGuardado: 'caida' });
    await avisar(svc, SANO, 38, 40);
    expect(alerts.sendTeamAlert).toHaveBeenCalledOnce();
    expect(alerts.sendTeamAlert.mock.calls[0][0]).toMatch(/vuelven a entrar/);
  });

  it('con todo normal no manda nada: el silencio es la señal de que está bien', async () => {
    const { svc, alerts } = make({ estadoGuardado: 'sano' });
    await avisar(svc, SANO, 38, 40);
    expect(alerts.sendTeamAlert).not.toHaveBeenCalled();
  });

  it('una franja sin señal NO pisa el estado guardado', async () => {
    // Si a las 4 de la mañana se escribiera «sano», se borraría una caída que
    // empezó a medianoche y sigue ahí: a las 9 se avisaría como nueva, o peor,
    // no se avisaría la recuperación.
    const { svc, alerts, setting } = make({ estadoGuardado: 'caida' });
    await avisar(svc, SIN_SEÑAL);
    expect(alerts.sendTeamAlert).not.toHaveBeenCalled();
    expect(setting.upsert).not.toHaveBeenCalled();
  });
});

describe('el estado se sella solo si el aviso salió', () => {
  it('si el SMS falla, no se marca como avisado y se reintenta', async () => {
    const { svc, alerts, setting } = make({ estadoGuardado: 'sano', avisoOk: false });
    await avisar(svc, CAIDA);
    expect(alerts.sendTeamAlert).toHaveBeenCalledOnce();
    // Lo que importa: el estado sigue en «sano», así que la próxima pasada
    // vuelve a intentarlo.
    expect(setting.upsert).not.toHaveBeenCalled();
  });
});
