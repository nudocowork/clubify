import { isEncrypted } from '../common/crypto/secret-box';

/**
 * Lo que un negocio guarda y NO puede salir en una respuesta del panel.
 *
 * `Tenant.growBusinessApiKey` es la llave con la que el negocio manda SMS por
 * Grow Business. Salía en claro en `GET/PATCH /tenants/me` —que ve hasta el
 * empleado «Solo pedidos»—, en `GET /tenants`, `GET /tenants/:id` y
 * `GET /passes/:id`.
 *
 * Se devuelve ENMASCARADA y no vacía porque el panel de reseñas decide
 * «Grow Business conectado» mirando que el campo tenga algo
 * (`app/reviews/page.tsx`). Ninguna pantalla la edita por estas rutas: la
 * conexión va por `POST /admin/tenants/:id/grow-business`, así que un PATCH
 * nunca recibe la máscara de vuelta ni puede pisar la clave real con ella.
 */
export function enmascararClave(valor: string | null | undefined): string | null {
  if (!valor) return null;
  // Cifrada no se descifra aquí: para «hay clave» basta, y así esto no depende
  // de que el proceso tenga SECRETS_ENC_KEY.
  if (isEncrypted(valor) || valor.length <= 8) return '••••';
  return `••••${valor.slice(-4)}`;
}

export function sinSecretosDelNegocio<T>(negocio: T): T {
  if (!negocio || typeof negocio !== 'object') return negocio;
  if (!('growBusinessApiKey' in (negocio as object))) return negocio;
  const t = negocio as T & { growBusinessApiKey?: string | null };
  return { ...t, growBusinessApiKey: enmascararClave(t.growBusinessApiKey) };
}

/**
 * Columnas del usuario que se pueden devolver al crear un negocio. La
 * respuesta traía la fila entera: `passwordHash` y `totpSecret` del dueño.
 */
export const USUARIO_SIN_SECRETOS = {
  id: true,
  email: true,
  fullName: true,
  phone: true,
  role: true,
  isActive: true,
  tenantId: true,
  createdAt: true,
} as const;
