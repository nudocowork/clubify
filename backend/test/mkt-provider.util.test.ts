import { describe, expect, it } from 'vitest';
import { pickMessageId, classifyReadError } from '../src/marketing/provider/mkt-provider.util';

describe('pickMessageId — normaliza el id del mensaje del proveedor', () => {
  it('messageId en la raíz', () => {
    expect(pickMessageId({ messageId: 'm1' })).toBe('m1');
  });
  it('id en la raíz', () => {
    expect(pickMessageId({ id: 'i1' })).toBe('i1');
  });
  it('conversationMessageId en la raíz', () => {
    expect(pickMessageId({ conversationMessageId: 'c1' })).toBe('c1');
  });
  it('anidado dentro de message', () => {
    expect(pickMessageId({ message: { id: 'nm1' } })).toBe('nm1');
  });
  it('anidado dentro de data', () => {
    expect(pickMessageId({ data: { messageId: 'nd1' } })).toBe('nd1');
  });
  it('prioriza messageId sobre id', () => {
    expect(pickMessageId({ messageId: 'a', id: 'b' })).toBe('a');
  });
  it('sin id → undefined (la analítica de ese envío no existirá)', () => {
    expect(pickMessageId({ foo: 'bar' })).toBeUndefined();
    expect(pickMessageId(null)).toBeUndefined();
    expect(pickMessageId('x')).toBeUndefined();
  });
});

describe('classifyReadError — 401 (scope) vs 403 (cuenta)', () => {
  it('401 = falta permiso de lectura → scopeLimited', () => {
    const r = classifyReadError(401);
    expect(r.scopeLimited).toBe(true);
    expect(r.error).toMatch(/permiso de LECTURA/i);
  });
  it('403 = sin acceso a la cuenta → NO scopeLimited', () => {
    const r = classifyReadError(403);
    expect(r.scopeLimited).toBe(false);
  });
  it('otro código → mensaje genérico con el número', () => {
    expect(classifyReadError(500).error).toMatch(/500/);
  });
});
