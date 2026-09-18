'use client';

import { useAuthBrand } from '@/components/AuthBrand';

/**
 * ¿Esta marca puede EDITAR el cartel QR, o solo verlo y descargarlo?
 *
 * Sellea no edita (Humberto, vía Javier 2026-09-18): en su panel las cinco
 * páginas de QR enseñan el cartel, su enlace y las descargas, y nada más.
 *
 * Vive aquí y no dentro de `QrPosterEditor` porque las páginas también lo
 * necesitan —su texto de entrada dice «Diseña tu cartel…», que en solo lectura
 * es mentira— y el editor se carga con `dynamic(..., { ssr: false })`: importar
 * un hook desde él arrastraría las 6.000 líneas del editor a cada página.
 *
 * La marca sale del HOST, que es como se resuelve Sellea en selleala.com. Un
 * negocio de Sellea entrando por un dominio de Clubify sí vería el editor; no
 * pasa en la práctica, y la alternativa —pedir `/tenants/me` en las cinco
 * páginas— era mucho ruido por ese caso.
 */
export function useCartelSoloLectura(): boolean {
  const { brand } = useAuthBrand();
  return brand?.slug === 'sellea';
}
