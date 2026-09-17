import { describe, it, expect } from 'vitest';
import { CacheAcotada } from './cache-acotada';

describe('CacheAcotada', () => {
  it('expulsa la usada hace más tiempo, no la más vieja en entrar', () => {
    const c = new CacheAcotada<number>({ maxEntradas: 2 });
    c.set('a', 1);
    c.set('b', 2);
    c.get('a'); // «a» se usó: ahora la más antigua en uso es «b»
    c.set('c', 3);
    expect(c.has('a')).toBe(true);
    expect(c.has('b')).toBe(false);
    expect(c.size).toBe(2);
  });

  it('respeta el tope de bytes', () => {
    const c = new CacheAcotada<string>({ maxEntradas: 100, maxBytes: 10, pesar: (s) => s.length });
    c.set('a', '12345');
    c.set('b', '12345');
    c.set('c', '1');
    expect(c.has('a')).toBe(false);
    expect(c.bytes).toBeLessThanOrEqual(10);
    // Lo que por sí solo no cabe, ni entra ni echa a nadie.
    c.set('enorme', 'x'.repeat(50));
    expect(c.has('enorme')).toBe(false);
    expect(c.has('b')).toBe(true);
  });

  it('caduca por entrada, y un `null` guardado cuenta como guardado', () => {
    let t = 0;
    const c = new CacheAcotada<string | null>({ maxEntradas: 10, ahora: () => t });
    c.set('fallo', null, 1000);
    c.set('bien', 'png');
    expect(c.has('fallo')).toBe(true);
    expect(c.get('fallo')).toBeNull();
    t = 1001;
    expect(c.has('fallo')).toBe(false);
    expect(c.get('bien')).toBe('png');
  });
});
