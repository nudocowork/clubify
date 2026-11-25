import { describe, it, expect } from 'vitest';
import { BillingService } from './billing.service';

/**
 * Un negocio suspendido NO puede reactivarse solo: la única salida es pagar.
 *
 * Hasta el 2026-11-25 había un botón de «3 días para ir a pagar». Limorada
 * (prueba de 3 meses vencida, nunca pagó) lo usó el 23-nov y volvió a tener
 * 3 días gratis. Javier: «si ya se suspendió el servicio, debe tener
 * únicamente la opción de pagar». Esta prueba fija que el endpoint ya no
 * toca la cuenta, aunque alguien lo llame a mano o desde el frontend viejo.
 */
describe('un negocio suspendido no se reactiva solo', () => {
  it('rechaza con el motivo y no toca la cuenta ni avisa de una reactivación', async () => {
    const tocado: string[] = [];
    const espia = new Proxy(
      {},
      {
        get: (_t, modelo: string) =>
          new Proxy(
            {},
            {
              get: (_x, op: string) => async () => {
                tocado.push(`${modelo}.${op}`);
                return null;
              },
            },
          ),
      },
    );
    const svc = new BillingService(espia as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    const avisos: string[] = [];
    svc.notifyBillingTeam = async (kind: any) => {
      avisos.push(kind);
    };

    await expect(svc.reactivate('limorada')).rejects.toThrow(/completa el pago/);
    expect(tocado).toEqual([]);
    expect(avisos).toEqual([]);
  });
});
