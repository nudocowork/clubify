import { describe, it, expect } from 'vitest';
import {
  CANCELACION_DESHECHA,
  PLANTILLA_DEL_AVISO,
  nombreDeLaPasarela,
  notaDelEstado,
  origenDelEventoDeHotmart,
  origenQueManda,
  tocaAvisar,
} from './estado-del-negocio';
import { estadoComercial } from '../common/estado-comercial';

/**
 * Cancelar y suspender no son lo mismo (Javier, 2026-11-23). Estas pruebas son
 * las reglas que lo sostienen, sin base de datos.
 */

const AHORA = new Date('2026-11-23T20:00:00.000Z');
const base = {
  status: 'ACTIVE',
  canceledAt: null as Date | null,
  trialEndsAt: null,
  lastChargeAt: new Date('2026-10-23T13:28:48.000Z'),
  currentPeriodEnd: new Date('2027-01-23T12:00:00.000Z'),
};

describe('CANCELADO ≠ SUSPENDIDO', () => {
  it('un contracargo deja el negocio CANCELADO, no suspendido por mora', () => {
    const t = {
      ...base,
      status: 'SUSPENDED',
      canceledAt: AHORA,
      cancelSource: 'CONTRACARGO',
      cancelReason: 'tx HP0032012122',
      suspendReason: 'DEVOLUCION',
    };
    expect(estadoComercial(t)).toBe('CANCELADO');
    expect(notaDelEstado(t, AHORA)).toBe(
      'Cancelado por contracargo del pago (tx HP0032012122) el 23 de noviembre de 2026. Servicio desconectado.',
    );
  });

  it('quien deja de pagar sale SUSPENDIDO por falta de pago, no cancelado', () => {
    const t = { ...base, status: 'SUSPENDED', suspendReason: 'FALTA_DE_PAGO' };
    expect(estadoComercial(t)).toBe('SUSPENDIDO');
    expect(notaDelEstado(t, AHORA)).toBe('Suspendido por falta de pago.');
  });

  it('cancelar hoy con el trimestre pagado: CANCELADO, pero conserva el servicio hasta el final', () => {
    const t = { ...base, canceledAt: AHORA, cancelSource: 'CLIENTE_PANEL', cancelReason: 'cierro el local' };
    expect(estadoComercial(t)).toBe('CANCELADO');
    expect(notaDelEstado(t, AHORA)).toBe(
      'Cancelado por el cliente desde su panel de Clubify (cierro el local) el 23 de noviembre de 2026. ' +
        'Conserva el servicio hasta el 23 de enero de 2027, el final del período que ya pagó.',
    );
  });

  it('la suspensión manual muestra lo que escribió el colaborador', () => {
    const t = { ...base, status: 'SUSPENDED', suspendReason: 'MANUAL: no contesta y debe dos meses' };
    expect(notaDelEstado(t, AHORA)).toBe('Suspendido por suspensión manual de un colaborador: no contesta y debe dos meses.');
  });

  it('una suspensión anterior al registro de motivos lo dice, en vez de inventar uno', () => {
    expect(notaDelEstado({ ...base, status: 'SUSPENDED' }, AHORA)).toMatch(/sin motivo registrado/);
  });

  it('activo y sin cancelar: no hay nada que explicar', () => {
    expect(notaDelEstado(base, AHORA)).toBeNull();
  });
});

describe('qué origen manda cuando llegan dos', () => {
  it('una devolución pisa a la cancelación anterior (Protein Station: canceló el 21, disputa el 23)', () => {
    expect(origenQueManda('CLIENTE_PASARELA', 'DISPUTA')).toBe('DISPUTA');
    expect(origenQueManda('CLIENTE_PANEL', 'REEMBOLSO')).toBe('REEMBOLSO');
  });
  it('el reembolso confirma la disputa', () => {
    expect(origenQueManda('DISPUTA', 'REEMBOLSO')).toBe('REEMBOLSO');
  });
  it('una cancelación tardía no le quita la etiqueta de devolución', () => {
    expect(origenQueManda('CONTRACARGO', 'CLIENTE_PASARELA')).toBe('CONTRACARGO');
  });
  it('a igual peso manda la primera: el aviso de Hotmart no borra que canceló desde el panel', () => {
    expect(origenQueManda('CLIENTE_PANEL', 'CLIENTE_PASARELA')).toBe('CLIENTE_PANEL');
  });
});

describe('el SMS de «verifica la cancelación en la pasarela»', () => {
  const nada = { cancelNoticeSentAt: null, cancelNoticeTemplate: null };
  const yaPanel = { cancelNoticeSentAt: AHORA, cancelNoticeTemplate: 'cancel_aviso_panel' };
  const yaReembolso = { cancelNoticeSentAt: AHORA, cancelNoticeTemplate: 'cancel_aviso_reembolso' };

  it('hay una plantilla por situación', () => {
    expect(PLANTILLA_DEL_AVISO.CLIENTE_PANEL).toBe('cancel_aviso_panel');
    expect(PLANTILLA_DEL_AVISO.COLABORADOR).toBe('cancel_aviso_colaborador');
    expect(PLANTILLA_DEL_AVISO.REEMBOLSO).toBe('cancel_aviso_reembolso');
    expect(PLANTILLA_DEL_AVISO.CONTRACARGO).toBe('cancel_aviso_contracargo');
    expect(PLANTILLA_DEL_AVISO.DISPUTA).toBe('cancel_aviso_contracargo');
    // Canceló EN la pasarela: no tiene sentido pedirle que vaya a mirarlo allí.
    expect(PLANTILLA_DEL_AVISO.CLIENTE_PASARELA).toBeNull();
  });

  it('se manda la primera vez', () => {
    expect(tocaAvisar(nada, 'cancel_aviso_panel')).toBe(true);
  });

  it('pulsar «Cancelar» otra vez en el mismo proceso NO repite el SMS', () => {
    expect(tocaAvisar(yaPanel, 'cancel_aviso_panel')).toBe(false);
    // Ni aunque después lo cancele un colaborador.
    expect(tocaAvisar(yaPanel, 'cancel_aviso_colaborador')).toBe(false);
  });

  it('una devolución DESPUÉS de una cancelación sí avisa: es otra noticia', () => {
    expect(tocaAvisar(yaPanel, 'cancel_aviso_reembolso')).toBe(true);
  });

  it('dos devoluciones del mismo pago (disputa y reembolso) no repiten', () => {
    expect(tocaAvisar(yaReembolso, 'cancel_aviso_contracargo')).toBe(false);
  });

  it('reactivar limpia el aviso: un proceso nuevo vuelve a avisar', () => {
    expect(CANCELACION_DESHECHA).toMatchObject({ canceledAt: null, cancelNoticeSentAt: null, cancelSource: null });
  });

  it('nombra la pasarela por la que cobra el negocio', () => {
    expect(nombreDeLaPasarela({ hotmartSubscriberCode: 'BRW813M3' })).toBe('Hotmart');
    expect(nombreDeLaPasarela({ stripeSubscriptionId: 'sub_1' })).toBe('Stripe');
    expect(nombreDeLaPasarela({})).toBe('la plataforma de pagos');
  });
});

describe('los avisos de Hotmart', () => {
  it('cada evento tiene su origen', () => {
    expect(origenDelEventoDeHotmart('PURCHASE_REFUNDED')).toBe('REEMBOLSO');
    expect(origenDelEventoDeHotmart('PURCHASE_CHARGEBACK')).toBe('CONTRACARGO');
    expect(origenDelEventoDeHotmart('PURCHASE_PROTEST')).toBe('DISPUTA');
    expect(origenDelEventoDeHotmart('SUBSCRIPTION_CANCELLATION')).toBe('CLIENTE_PASARELA');
    expect(origenDelEventoDeHotmart('PURCHASE_DELAYED')).toBeNull();
  });
});
