import { describe, it, expect, vi } from 'vitest';
import { VigilanteService } from './vigilante.service';

/**
 * Los cuatro estados del chequeo de respaldos. El que más importa es el de
 * 'fallo': no poder mirar el bucket NO calla, porque el silencio del que
 * vigila es indistinguible del «todo bien» — que es exactamente como se
 * perdieron 135 noches de respaldo sin que nadie lo supiera.
 */
function make(visto: Date | null | 'sin-configurar' | 'fallo') {
  const svc = Object.create(VigilanteService.prototype) as VigilanteService;
  (svc as any).logger = { error: vi.fn(), warn: vi.fn(), log: vi.fn() };
  (svc as any).masRecienteEnBucket = vi.fn().mockResolvedValue(visto);
  return svc as any;
}

describe('respaldoQueNoExiste', () => {
  it('desarrollo local sin S3: calla, ahí no hay nada que vigilar', async () => {
    expect(await make('sin-configurar').respaldoQueNoExiste()).toBeNull();
  });

  it('no poder mirar el bucket ES un hallazgo, no un silencio', async () => {
    const h = await make('fallo').respaldoQueNoExiste();
    expect(h).not.toBeNull();
    expect(h.titulo).toMatch(/ni comprobar/);
  });

  it('sin ningún respaldo en el bucket: suena con lo más serio', async () => {
    const h = await make(null).respaldoQueNoExiste();
    expect(h).not.toBeNull();
    expect(h.detalle).toMatch(/NINGÚN respaldo/);
  });

  it('respaldo de hace 3 días: vencido, y el aviso dice dónde mirar', async () => {
    const h = await make(new Date(Date.now() - 75 * 3_600_000)).respaldoQueNoExiste();
    expect(h).not.toBeNull();
    expect(h.titulo).toMatch(/VENCIDO/);
    expect(h.queHacer).toMatch(/GitHub Actions/);
  });

  it('respaldo de esta madrugada: todo en orden, ni una palabra', async () => {
    expect(await make(new Date(Date.now() - 10 * 3_600_000)).respaldoQueNoExiste()).toBeNull();
  });
});
