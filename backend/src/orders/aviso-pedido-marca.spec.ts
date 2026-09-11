import { describe, it, expect } from 'vitest';
import { OwnerOrderAlertService } from './owner-order-alert.service';

/**
 * EL ENLACE DEL AVISO DE PEDIDO ES DEL PANEL DE SU MARCA.
 *
 * El 2026-09-11: un negocio de Sellea recibió su aviso de pedido nuevo y
 * WhatsApp le pintó la vista previa de `soyclubify.com` — tarjeta verde, logo
 * de Clubify y «El sistema operativo de tu negocio local». El enlace estaba
 * fijo a `app.soyclubify.com`.
 *
 * Es la fuga de marca de siempre, y lo que más duele es que `brandAppUrl` ya
 * existía para esto: se arregló en los otros mensajes y ESTE se quedó fuera.
 * De ahí este candado.
 */

const PEDIDO = {
  code: 'DAU9EJ',
  total: 0,
  fulfillment: 'DELIVERY',
  tableNumber: null,
  customer: { fullName: 'Prueba tomando pedido' },
};

function texto(whiteLabel: unknown) {
  const svc = new OwnerOrderAlertService({} as any, {} as any) as any;
  return svc.texto(PEDIDO, { currencySymbol: '$', whiteLabel });
}

describe('el aviso de pedido al dueño', () => {
  it('un negocio de una MARCA BLANCA no ve ningún dominio de Clubify', () => {
    const t = texto({ appDomain: 'app.selleala.com', domain: 'selleala.com' });
    expect(t).toContain('https://app.selleala.com/app/orders');
    expect(t.toLowerCase()).not.toContain('soyclubify');
    expect(t.toLowerCase()).not.toContain('clubify');
  });

  it('si la marca solo tiene dominio de marketing, se usa ese', () => {
    const t = texto({ appDomain: null, domain: 'selleala.com' });
    expect(t).toContain('https://selleala.com/app/orders');
    expect(t.toLowerCase()).not.toContain('soyclubify');
  });

  it('un negocio SIN marca cae al panel de la plataforma, que es lo correcto', () => {
    const t = texto(null);
    expect(t).toContain('/app/orders');
  });

  it('el texto sigue diciendo lo que hace falta para reaccionar', () => {
    const t = texto({ appDomain: 'app.selleala.com' });
    expect(t).toContain('DAU9EJ');
    expect(t).toContain('Prueba tomando pedido');
    expect(t).toContain('Domicilio');
  });
});
