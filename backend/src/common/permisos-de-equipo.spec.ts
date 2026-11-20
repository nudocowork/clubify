import { describe, expect, it } from 'vitest';
import { limpiarPermisos, personalizadoPuede, seccionesDeLaRuta } from './permisos-de-equipo';

const STAFF = ['TENANT_OWNER', 'TENANT_STAFF', 'SUPER_ADMIN'];
const DUENO = ['TENANT_OWNER', 'SUPER_ADMIN'];

describe('rol personalizado: ve solo lo que se le marcó', () => {
  it('con Sellos y Clientes: escáner y clientes sí, pedidos y menú no', () => {
    const p = ['sellos', 'clientes'];
    expect(personalizadoPuede('scanner/verify', STAFF, p)).toBe(true);
    expect(personalizadoPuede('customers/123', STAFF, p)).toBe(true);
    expect(personalizadoPuede('orders', STAFF, p)).toBe(false);
    expect(personalizadoPuede('catalog/categories', STAFF, p)).toBe(false);
  });

  it('con solo Pedidos: pedidos, y el catálogo y los clientes que el pedido manual necesita', () => {
    const p = ['pedidos'];
    expect(personalizadoPuede('orders/abc/status', STAFF, p)).toBe(true);
    expect(personalizadoPuede('catalog/products', STAFF, p)).toBe(true);
    expect(personalizadoPuede('customers', STAFF, p)).toBe(true);
    expect(personalizadoPuede('catalog/categories', STAFF, p)).toBe(false);
    expect(personalizadoPuede('scanner/verify', STAFF, p)).toBe(false);
  });

  it('una casilla abre su sección aunque hoy sea solo del dueño (Notificaciones)', () => {
    expect(personalizadoPuede('notifications', DUENO, ['notificaciones'])).toBe(true);
    expect(personalizadoPuede('notifications', DUENO, ['sellos'])).toBe(false);
  });

  it('una ruta solo de admin de plataforma nunca se abre', () => {
    expect(personalizadoPuede('customers/merge', ['SUPER_ADMIN'], ['clientes'])).toBe(false);
  });

  it('lo que no es de ninguna sección (Equipo, Suscripción, Sedes) queda cerrado', () => {
    const todo = ['sellos', 'clientes', 'tarjetas', 'notificaciones', 'menu', 'pedidos'];
    expect(personalizadoPuede('tenants/me/staff', ['TENANT_OWNER'], todo)).toBe(false);
    expect(personalizadoPuede('billing/reactivate', STAFF, todo)).toBe(false);
    expect(personalizadoPuede('locations', DUENO, todo)).toBe(false);
  });

  it('lo básico del panel (datos del negocio) se abre si la ruta nombra al rol', () => {
    expect(personalizadoPuede('tenants/me', ['TENANT_OWNER', 'TENANT_CUSTOM'], [])).toBe(true);
    expect(personalizadoPuede('auth/me', [], [])).toBe(true);
  });

  it('gana el prefijo más largo y se ignora /api', () => {
    expect(seccionesDeLaRuta('/api/catalog/products/1')).toEqual(['menu', 'pedidos']);
    expect(seccionesDeLaRuta('catalog/menu-book')).toEqual(['menu']);
    expect(seccionesDeLaRuta('tenants/me')).toBeNull();
  });

  it('solo se guardan claves conocidas, sin repetir', () => {
    expect(limpiarPermisos(['sellos', 'sellos', 'admin', 3, 'pedidos'])).toEqual(['sellos', 'pedidos']);
    expect(limpiarPermisos('sellos')).toEqual([]);
  });
});
