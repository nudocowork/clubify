import { describe, it, expect } from 'vitest';
import { FRESCA_MS, MemoPublico, VIGENTE_MS } from './memo-publico';

/**
 * Café 1550 (2026-10-03): el menú tardaba 2–3,5 s cada vez que la caché del
 * borde estaba fría. Lo ya armado sale ahora de memoria.
 */
describe('la caché del menú público', () => {
  function montar() {
    let ahora = 1_000_000;
    let cargas = 0;
    const memo = new MemoPublico(() => ahora);
    const cargar = async () => ({ version: ++cargas });
    return { memo, cargar, avanzar: (ms: number) => (ahora += ms), cargas: () => cargas };
  }

  it('fresca: la segunda visita no toca la base', async () => {
    const m = montar();
    expect(await m.memo.obtener('carta|cafe', m.cargar)).toEqual({ version: 1 });
    m.avanzar(FRESCA_MS - 1);
    expect(await m.memo.obtener('carta|cafe', m.cargar)).toEqual({ version: 1 });
    expect(m.cargas()).toBe(1);
  });

  it('pasada la frescura: responde al instante con la guardada y la rehace por detrás', async () => {
    const m = montar();
    await m.memo.obtener('carta|cafe', m.cargar);
    m.avanzar(FRESCA_MS + 1);
    expect(await m.memo.obtener('carta|cafe', m.cargar)).toEqual({ version: 1 });
    await new Promise((r) => setTimeout(r, 0));
    expect(await m.memo.obtener('carta|cafe', m.cargar)).toEqual({ version: 2 });
  });

  it('demasiado vieja: se espera la nueva', async () => {
    const m = montar();
    await m.memo.obtener('carta|cafe', m.cargar);
    m.avanzar(VIGENTE_MS + 1);
    expect(await m.memo.obtener('carta|cafe', m.cargar)).toEqual({ version: 2 });
  });

  it('muchas visitas a la vez con la caché vacía hacen UNA sola carga', async () => {
    const m = montar();
    const r = await Promise.all([1, 2, 3, 4, 5].map(() => m.memo.obtener('carta|cafe', m.cargar)));
    expect(r.every((x) => x.version === 1)).toBe(true);
    expect(m.cargas()).toBe(1);
  });

  it('un error no se guarda: la siguiente visita lo vuelve a intentar', async () => {
    const m = montar();
    await expect(m.memo.obtener('negocio|x', async () => { throw new Error('no disponible'); })).rejects.toThrow();
    expect(await m.memo.obtener('negocio|x', m.cargar)).toEqual({ version: 1 });
  });

  it('cada negocio, idioma o modo es su propia entrada', async () => {
    const m = montar();
    await m.memo.obtener('carta|cafe|es|mesa', m.cargar);
    await m.memo.obtener('carta|cafe|en|mesa', m.cargar);
    await m.memo.obtener('carta|konys|es|mesa', m.cargar);
    expect(m.memo.tamano).toBe(3);
  });
});
