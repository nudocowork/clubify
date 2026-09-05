import { describe, it, expect } from 'vitest';
import { ChannelsService } from './channels.service';

/**
 * El mensaje que se le arma al negocio para WhatsApp.
 *
 * La regla que protege este archivo: **nada de emojis de 4 bytes**. WhatsApp
 * los destroza en su propia redirección — comprobado contra el servicio real:
 *
 *   GET https://wa.me/57…?text=%F0%9F%98%80
 *   → Location: …/send/?text=%EF%BF%BD        (el rombo con el interrogante)
 *
 * Los símbolos del plano básico (✓ → ▸ ☎ ✎) llegan intactos. Es del lado de
 * WhatsApp, así que no hay nada que arreglar allí: lo que se puede hacer es no
 * mandarlos. Sin esta prueba, el primer 🎉 que alguien añada al mensaje vuelve
 * a llenar de rombos el pedido que lee el negocio.
 */
const svc = new ChannelsService(null as any);

const tenant = {
  whatsappOrdersPhone: '573177777400',
  currency: 'COP',
  currencySymbol: '$',
} as any;

const order = {
  code: 'CBR6',
  items: [
    { qty: 1, name: 'Oreo (Pequeño)', lineTotal: 21500, unitPrice: 21500 },
  ],
  subtotal: 21500,
  discount: 0,
  total: 21500,
  fulfillment: 'DELIVERY',
  deliveryAddress: {
    firstName: 'QA',
    lastName: 'Test',
    phone: '+57 3150621706',
    departamento: 'Bogotá D.C.',
    municipio: 'Bogotá',
    direccion: 'Calle 123 #45-67',
  },
  customerNote: 'Sin azúcar',
  customerPaymentMethod: 'TRANSFERENCIA',
} as any;

const customer = { fullName: 'QA Test', phone: '+57 3150621706' } as any;

function textoDe(link: string): string {
  return decodeURIComponent(link.split('?text=')[1] ?? '');
}

/** Caracteres fuera del plano básico — los que WhatsApp convierte en rombo. */
function deCuatroBytes(s: string): string[] {
  return [...s].filter((ch) => (ch.codePointAt(0) ?? 0) > 0xffff);
}

describe('mensaje de WhatsApp al negocio', () => {
  it('no lleva ni un emoji de 4 bytes', () => {
    const texto = textoDe(svc.generateWaMeOwner(tenant, order, customer));
    expect(deCuatroBytes(texto)).toEqual([]);
  });

  it('lleva lo que el negocio necesita para atender el pedido', () => {
    const texto = textoDe(svc.generateWaMeOwner(tenant, order, customer));
    expect(texto).toContain('CBR6');
    expect(texto).toContain('QA Test');
    expect(texto).toContain('3150621706');
    expect(texto).toContain('Oreo (Pequeño)');
    expect(texto).toContain('Calle 123 #45-67');
    expect(texto).toContain('Sin azúcar');
  });

  it('sin teléfono no deja el separador colgando', () => {
    // Ya no debería poder crearse un pedido así —la API lo rechaza—, pero los
    // que ya existen se siguen leyendo, y «QA Test · » con el punto suelto
    // parece un dato perdido en vez de un dato que nunca hubo.
    const texto = textoDe(
      svc.generateWaMeOwner(tenant, order, { ...customer, phone: '' }),
    );
    expect(texto).toContain('QA Test');
    expect(texto).not.toContain('QA Test · ');
  });

  it('el mensaje al domiciliario tampoco lleva emojis de 4 bytes', () => {
    const texto = textoDe(
      svc.generateWaMeCourier(
        { ...tenant, whatsappDeliveryPhone: '573170000000' },
        order,
        customer,
      ),
    );
    expect(deCuatroBytes(texto)).toEqual([]);
  });
});
