import { describe, it, expect, vi } from 'vitest';
import { TenantMeController } from './me.controller';

/**
 * Un teléfono borrado en Ajustes se guarda como NULL, no como cadena vacía.
 *
 * El formulario manda `''` al vaciar un campo y se guardaba tal cual. Las
 * cadenas de destino del pedido (`sede → pedidos → whatsapp → teléfono`) se
 * armaban con `??`, que no salta `''`: La Gloriosa tenía `whatsappPhone = ''`
 * y los pedidos de una de sus sedes no le llegaban a nadie. Las cadenas ya se
 * arreglaron; esto es para que el problema no vuelva a nacer en otras.
 */
function controlador() {
  const svc = { updateMine: vi.fn(async (_tid: string, dto: any) => dto) };
  const ctrl = new TenantMeController(svc as any, {} as any, {} as any, {} as any);
  return { ctrl, svc };
}

const DUENO = { id: 'u1', email: 'a@b.co', role: 'TENANT_OWNER', tenantId: 't1' } as any;

describe('guardar los teléfonos del negocio', () => {
  it('vacío o solo espacios se guarda como null', async () => {
    const { ctrl, svc } = controlador();
    await ctrl.update(DUENO, {
      phone: '  ',
      whatsappPhone: '',
      whatsappOrdersPhone: '',
      whatsappDeliveryPhone: '',
      whatsappReservationsPhone: '',
    } as any);
    const dto = svc.updateMine.mock.calls[0][1];
    expect(dto).toMatchObject({
      phone: null,
      whatsappPhone: null,
      whatsappOrdersPhone: null,
      whatsappDeliveryPhone: null,
      whatsappReservationsPhone: null,
    });
  });

  it('un número de verdad se guarda, sin espacios sobrantes en los bordes', async () => {
    const { ctrl, svc } = controlador();
    await ctrl.update(DUENO, { whatsappPhone: ' +57 3181666999 ' } as any);
    expect(svc.updateMine.mock.calls[0][1].whatsappPhone).toBe('+57 3181666999');
  });

  it('un campo que no llegó no se toca (no se borra lo guardado)', async () => {
    const { ctrl, svc } = controlador();
    await ctrl.update(DUENO, { brandName: 'La Gloriosa' } as any);
    const dto = svc.updateMine.mock.calls[0][1];
    expect('whatsappPhone' in dto).toBe(false);
    expect('phone' in dto).toBe(false);
  });

  it('solo los teléfonos: un texto vacío en otro campo sigue como estaba', async () => {
    const { ctrl, svc } = controlador();
    await ctrl.update(DUENO, { instagramUrl: '', whatsappPhone: '' } as any);
    const dto = svc.updateMine.mock.calls[0][1];
    expect(dto.instagramUrl).toBe('');
    expect(dto.whatsappPhone).toBeNull();
  });

  it('el número del aviso de pedido se guarda desde Ajustes, y vacío queda en null', async () => {
    // Existía en la base y lo usaba el SMS del pedido, pero no estaba en
    // ninguna pantalla: el negocio no sabía adónde le llegaba el aviso ni
    // podía cambiarlo (Javier, 2026-09-17).
    const { ctrl, svc } = controlador();
    await ctrl.update(DUENO, {
      ownerOrderAlertsEnabled: true,
      ownerOrderAlertsPhone: ' +57 3001112233 ',
    } as any);
    expect(svc.updateMine.mock.calls[0][1]).toEqual({
      ownerOrderAlertsEnabled: true,
      ownerOrderAlertsPhone: '+57 3001112233',
    });

    const b = controlador();
    await b.ctrl.update(DUENO, { ownerOrderAlertsPhone: '  ' } as any);
    expect(b.svc.updateMine.mock.calls[0][1]).toEqual({ ownerOrderAlertsPhone: null });
  });
});
