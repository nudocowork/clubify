import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { AuthController } from '../src/auth/auth.controller';
import { IS_PUBLIC_KEY } from '../src/common/decorators/public.decorator';

/**
 * Rutas de autenticación que TIENEN que ser públicas.
 *
 * Nace de un bug real (27-ago): al agregar `trial-otp` justo encima de
 * `trial-signup`, el método nuevo quedó entre el comentario de `trial-signup` y
 * su `@Post`, y **se llevó sus decoradores**. `trial-signup` perdió `@Public()`
 * y el registro público empezó a devolver 401 en producción.
 *
 * No lo atrapó ni `tsc` ni el arranque: el código compila y la app levanta; solo
 * cambia quién puede entrar. Este test mira los metadatos, que es donde vive la
 * diferencia.
 */
const PUBLICAS = [
  'login',
  'signup',
  'trialSignup',
  'trialOtp',
  'infolinkSignup',
  'infolinkBrand',
];

const esPublica = (metodo: string) =>
  Reflect.getMetadata(IS_PUBLIC_KEY, (AuthController.prototype as any)[metodo]) === true;

describe('rutas públicas de auth', () => {
  it.each(PUBLICAS)('%s existe en el controller', (metodo) => {
    expect(typeof (AuthController.prototype as any)[metodo]).toBe('function');
  });

  it.each(PUBLICAS)('%s está marcada @Public()', (metodo) => {
    expect(esPublica(metodo)).toBe(true);
  });

  // El otro lado del bug: un decorador robado también puede volver PÚBLICA una
  // ruta que debería pedir sesión, y eso no lo nota nadie hasta que es tarde.
  //
  // `logout` queda fuera a propósito: es público de verdad — uno tiene que poder
  // cerrar sesión aunque el token ya no sirva.
  const PROTEGIDAS = ['me', 'setLocale', 'setup2FA', 'confirm2FA', 'disable2FA'];

  it.each(PROTEGIDAS)('%s exige sesión', (metodo) => {
    if (typeof (AuthController.prototype as any)[metodo] !== 'function') return;
    expect(esPublica(metodo)).toBe(false);
  });
});
