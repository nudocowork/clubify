import { describe, it, expect } from 'vitest';
import { InfoLinksService } from './info-links.service';

/**
 * Degodoy, 2026-10-06: «al escanear el QR está demasiado lenta la carga». El QR
 * pasaba por dos consultas al backend de 1–2 s cada una. Ahora salen de
 * memoria, pero la visita se sigue contando en cada apertura.
 */

function montar() {
  const n = { tenant: 0, link: 0, visitas: 0, eventos: 0 };
  const prisma: any = {
    tenant: {
      findUnique: async ({ where }: any) => {
        n.tenant++;
        if (where.slug === 'degodoy-sas') {
          return { id: 't1', slug: 'degodoy-sas', status: 'ACTIVE', businessType: 'FULL', infolinkTier: null, whiteLabelId: null, locations: [], infoLinks: [{ slug: 'infolink' }] };
        }
        return null;
      },
    },
    infoLink: {
      findUnique: async ({ where }: any) => {
        n.link++;
        if (where.rootSlug === 'degodoy') return { slug: 'infolink', isActive: true, tenant: { slug: 'degodoy-sas', status: 'ACTIVE' } };
        if (where.rootSlug) return null;
        return { id: 'l1', slug: 'infolink', isActive: true, title: 'Degodoy', subtitle: null, buttons: [], sections: [], theme: {} };
      },
      update: async () => (n.visitas++, {}),
    },
    infoLinkEvent: { create: async () => (n.eventos++, {}) },
  };
  const brand: any = { resolveByWhiteLabelId: async () => ({ name: 'Clubify', slug: 'clubify' }) };
  const svc = new (InfoLinksService as any)(prisma, {}, brand) as InfoLinksService;
  return { svc, n };
}

describe('InfoLink público en memoria', () => {
  it('la segunda apertura no va a la base, pero cuenta su visita', async () => {
    const { svc, n } = montar();
    await svc.getPublic('degodoy-sas', 'infolink', 'es');
    const consultas = n.tenant + n.link;
    const r = await svc.getPublic('degodoy-sas', 'infolink', 'es');
    expect(r.link.id).toBe('l1');
    expect(n.tenant + n.link).toBe(consultas);
    await new Promise((ok) => setTimeout(ok, 0));
    expect(n.visitas).toBe(2);
    expect(n.eventos).toBe(2);
  });

  it('«fresco» (vista previa del panel) siempre va a la base', async () => {
    const { svc, n } = montar();
    await svc.getPublic('degodoy-sas', 'infolink', 'es');
    const antes = n.tenant;
    await svc.getPublic('degodoy-sas', 'infolink', 'es', { fresco: true });
    expect(n.tenant).toBe(antes + 1);
  });

  it('el destino del enlace corto: rootSlug o slug del negocio, sin contar visita', async () => {
    const { svc, n } = montar();
    expect(await svc.destinoPorRaiz('Degodoy')).toEqual({ tenant: { slug: 'degodoy-sas' }, link: { slug: 'infolink' } });
    expect(await svc.destinoPorRaiz('degodoy-sas')).toEqual({ tenant: { slug: 'degodoy-sas' }, link: { slug: 'infolink' } });
    await expect(svc.destinoPorRaiz('no-existe')).rejects.toThrow(/No disponible/);
    const consultas = n.link;
    await svc.destinoPorRaiz('degodoy');
    expect(n.link).toBe(consultas);
    expect(n.visitas).toBe(0);
  });
});
