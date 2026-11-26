import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LaboratorioDePaseService } from './laboratorio-de-pase.service';

/** Bucket en memoria: lo único que el servicio usa de MediaService. */
function bucketFalso() {
  const datos = new Map<string, unknown>();
  let n = 0;
  return {
    datos,
    guardarJson: vi.fn(async (k: string, v: unknown) => void datos.set(k, JSON.parse(JSON.stringify(v)))),
    leerJson: vi.fn(async (k: string) => (datos.has(k) ? datos.get(k) : null)),
    listarClaves: vi.fn(async (p: string) => [...datos.keys()].filter((k) => k.startsWith(p))),
    borrar: vi.fn(async (k: string) => void datos.delete(k)),
    uploadRaw: vi.fn(async () => ({ url: `https://cdn.test/laboratorio/${++n}.png`, key: '', size: 1 })),
  };
}

const diseno = {
  config: {
    estilo: 'SELLOS',
    fondo: '#1A1033',
    texto: '#FFFFFF',
    sello: '#F4B6A6',
    area: '#2A2047',
    requeridos: 10,
    sellados: 2,
    premio: 'Café gratis',
    unidad: 'sellos',
    emoji: '☕',
  },
  negocio: 'Café Prueba',
  titular: 'Ana',
};

describe('LaboratorioDePaseService', () => {
  let media: ReturnType<typeof bucketFalso>;
  let wallet: any;
  let google: any;
  let svc: LaboratorioDePaseService;

  beforeEach(() => {
    process.env.JWT_SECRET = 'secreto-de-prueba';
    media = bucketFalso();
    wallet = {
      dibujarFranjaDeLaboratorio: vi.fn(async () => ({ 'strip@3x.png': Buffer.from('png') })),
      generarPaseDeLaboratorio: vi.fn(async () => Buffer.from('pkpass')),
      avisarDispositivosDeLaboratorio: vi.fn(async (t: string[]) => ({ enviados: t.length, fallidos: 0, muertos: [] })),
    };
    google = {
      urlDeLaboratorio: vi.fn(() => 'https://pay.google.com/gp/v/save/x'),
      actualizarLaboratorio: vi.fn(async () => 'actualizado'),
    };
    svc = new LaboratorioDePaseService(wallet, google, media as any);
  });

  /** Crea una prueba y devuelve su id y el token que lleva el pase de Apple. */
  async function crear() {
    const { id } = await svc.crear(diseno);
    const token = wallet.generarPaseDeLaboratorio.mock.calls[0][0].token as string;
    return { id, token, serial: `lab_${id}` };
  }

  it('crea la prueba, la lista y el pase lleva token para actualizarse', async () => {
    const { id, token } = await crear();
    expect(token).toMatch(/^[a-f0-9]{40}$/);
    const lista = await svc.listar();
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({ id, sellados: 2, requeridos: 10, iphones: 0, actualizaciones: true });
  });

  it('un iPhone con el token bueno se registra; con otro, no', async () => {
    const { id, token, serial } = await crear();
    expect(await svc.registrar(serial, 'f'.repeat(40), 'DEVICE123456', 'push1')).toBe(false);
    expect(await svc.registrar(serial, token, 'DEVICE123456', 'push1')).toBe(true);
    expect(await svc.serialesDelDispositivo('DEVICE123456')).toEqual([serial]);
    expect((await svc.listar())[0].iphones).toBe(1);
    // Volver a registrar el mismo iPhone no lo duplica.
    await svc.registrar(serial, token, 'DEVICE123456', 'push2');
    expect(media.datos.get(`laboratorio/pases/${id}/dispositivos.json`)).toEqual([
      { deviceLibraryId: 'DEVICE123456', pushToken: 'push2' },
    ]);
  });

  it('un deviceLibraryId raro no llega a ser clave del bucket', async () => {
    const { token, serial } = await crear();
    expect(await svc.registrar(serial, token, '../../otra/cosa', 'push')).toBe(false);
    expect(await svc.serialesDelDispositivo('../../x')).toEqual([]);
  });

  it('sumar un sello: guarda, avisa a los iPhones y a Google, y el pase sale al día', async () => {
    const { id, token, serial } = await crear();
    await svc.registrar(serial, token, 'DEVICE123456', 'push1');
    const r = await svc.moverProgreso(id, { sellados: 3 });
    expect(r.prueba.sellados).toBe(3);
    expect(r.prueba.aviso).toBe('¡Nuevo sello! Llevas 3/10');
    expect(wallet.avisarDispositivosDeLaboratorio).toHaveBeenCalledWith(['push1']);
    expect(google.actualizarLaboratorio).toHaveBeenCalledWith(
      expect.objectContaining({ id, cabecera: { etiqueta: 'SELLOS', valor: '3/10' }, aviso: '¡Nuevo sello! Llevas 3/10' }),
    );

    expect(await svc.paseActual(serial, token)).not.toBeNull();
    const ultimo = wallet.generarPaseDeLaboratorio.mock.calls.at(-1)[0];
    expect(ultimo.config.sellados).toBe(3);
    expect(ultimo.aviso).toBe('¡Nuevo sello! Llevas 3/10');
    expect(await svc.paseActual(serial, 'x')).toBeNull();
  });

  it('el iPhone que Apple da por muerto (410) se borra', async () => {
    const { id, token, serial } = await crear();
    await svc.registrar(serial, token, 'DEVICE123456', 'push1');
    wallet.avisarDispositivosDeLaboratorio.mockResolvedValueOnce({ enviados: 0, fallidos: 1, muertos: ['push1'] });
    const r = await svc.moverProgreso(id, { sellados: 3 });
    expect(r.prueba.iphones).toBe(0);
    expect(media.datos.get(`laboratorio/pases/${id}/dispositivos.json`)).toEqual([]);
  });

  it('quitar la borra de la lista y del iPhone', async () => {
    const { id, token, serial } = await crear();
    await svc.registrar(serial, token, 'DEVICE123456', 'push1');
    await svc.quitar(id);
    expect(await svc.listar()).toEqual([]);
    expect(await svc.serialesDelDispositivo('DEVICE123456')).toEqual([]);
  });

  it('ids que no son nuestros dan 404', async () => {
    await expect(svc.moverProgreso('../x', { sellados: 1 })).rejects.toThrow(/no existe/);
  });
});
