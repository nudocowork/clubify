import { describe, it, expect } from 'vitest';
import { InfoLinksService } from './info-links.service';

/**
 * `POST /public/i/:id/track` es PÚBLICO: lo llama la página del InfoLink en el
 * navegador del visitante.
 *
 * EL FALLO (arqueo 2026-09-17): aceptaba cualquier `type` y cualquier
 * `metadata` hasta el tope global de 15 MB, y lo guardaba tal cual en
 * `InfoLinkEvent`. Las estadísticas del negocio leen esa tabla entera en
 * memoria (`stats`, `tenantOverview`): unos cuantos eventos inflados bastaban
 * para tumbar el panel del negocio, y un `type` inventado aparecía como métrica.
 *
 * En producción (90 días) solo existen `view` (lo escribe el servidor),
 * `click_button` con `{label, buttonType}` (≤ 70 bytes) y `qr_scan`.
 */

function montar() {
  const guardados: Array<{ infoLinkId: string; type: string; metadata: any }> = [];
  const prisma: any = {
    infoLinkEvent: {
      create: async ({ data }: any) => {
        guardados.push(data);
        return data;
      },
    },
  };
  const svc = new (InfoLinksService as any)(prisma, {}, {}, {}) as InfoLinksService;
  return { svc, guardados };
}

describe('InfoLinksService.trackEvent', () => {
  it('guarda un clic de botón como lo manda la página', async () => {
    const { svc, guardados } = montar();
    await svc.trackEvent('l1', 'click_button', { label: 'WhatsApp', buttonType: 'WHATSAPP' });
    expect(guardados).toEqual([
      { infoLinkId: 'l1', type: 'click_button', metadata: { label: 'WhatsApp', buttonType: 'WHATSAPP' } },
    ]);
  });

  it('guarda el escaneo de QR', async () => {
    const { svc, guardados } = montar();
    await svc.trackEvent('l1', 'qr_scan', undefined);
    expect(guardados.map((g) => g.type)).toEqual(['qr_scan']);
  });

  it('ignora tipos inventados (y `view`, que lo cuenta el servidor)', async () => {
    const { svc, guardados } = montar();
    await svc.trackEvent('l1', 'compra_falsa', {});
    await svc.trackEvent('l1', 'view', {});
    await svc.trackEvent('l1', { $gt: '' } as any, {});
    expect(guardados).toEqual([]);
  });

  it('la metadata queda acotada: nada de megas ni claves arbitrarias', async () => {
    const { svc, guardados } = montar();
    await svc.trackEvent('l1', 'click_button', {
      label: 'x'.repeat(1_000_000),
      buttonType: 'y'.repeat(10_000),
      basura: 'z'.repeat(1_000_000),
    });
    expect(guardados).toHaveLength(1);
    const bytes = Buffer.byteLength(JSON.stringify(guardados[0].metadata));
    expect(bytes).toBeLessThanOrEqual(2048);
    expect(guardados[0].metadata).not.toHaveProperty('basura');
  });
});
