/**
 * Helpers PUROS del envoltorio del proveedor de envío (sin Nest/Prisma —
 * testeables solos). El proveedor real por debajo es Grow Business
 * (LeadConnector), pero su nombre NUNCA se expone al usuario: la UI y los
 * errores hablan de "el proveedor de envío".
 */

/** Resultado normalizado de un envío por cualquier canal. */
export type SendResult = {
  ok: boolean;
  /** true = no se intentó (sin configurar, sin destinatario, opt-out, cuerpo vacío). */
  skipped?: boolean;
  /** Motivo legible del fallo/skip (para el registro que ve el usuario). */
  error?: string;
  /** id del mensaje EN EL PROVEEDOR — lo único que pega un evento (abrió/clic) a su envío. */
  messageId?: string;
  /** id del contacto EN EL PROVEEDOR — se guarda junto a la subcuenta de la que salió. */
  contactId?: string;
};

/** Info de conexión para el panel (solo lectura). Proveedor anónimo. */
export type ConnectionInfo = {
  configured: boolean;
  /** id de la subcuenta configurada (locationId). */
  subaccount?: string | null;
  /** dominio de envío, si el proveedor lo expone. */
  domain?: string | null;
  /** remitente por defecto. */
  from?: string | null;
  /** motivo legible si algo falló al leer. */
  error?: string;
  /**
   * true = el token envía pero NO tiene permiso de LECTURA de la cuenta (401).
   * No es "conexión caída": mostramos lo que sabemos sin preguntarle al proveedor.
   */
  scopeLimited?: boolean;
};

/**
 * El id del mensaje viene en formas distintas según el endpoint. Probamos
 * `messageId | id | conversationMessageId` en la raíz y dentro de `message`/`data`.
 * Devuelve undefined si no hay ninguno (la analítica de ese envío no existirá).
 */
export function pickMessageId(raw: unknown): string | undefined {
  const pick = (o: unknown): string | undefined => {
    if (!o || typeof o !== 'object') return undefined;
    const r = o as Record<string, unknown>;
    const v = r.messageId ?? r.id ?? r.conversationMessageId;
    return v != null && v !== '' ? String(v) : undefined;
  };
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  return pick(r) ?? pick(r.message) ?? pick(r.data);
}

/**
 * Traduce un status HTTP de una llamada de LECTURA al proveedor en el matiz que
 * el panel necesita. 401 = token inválido o SIN ese permiso (scopeLimited).
 * 403 = token válido pero sin acceso a ESA cuenta. Distinguirlos ahorra horas.
 */
export function classifyReadError(status: number): {
  scopeLimited: boolean;
  error: string;
} {
  if (status === 401) {
    return {
      scopeLimited: true,
      error:
        'El acceso de envío funciona, pero falta el permiso de LECTURA de la cuenta. Habilítalo en la configuración de la subcuenta.',
    };
  }
  if (status === 403) {
    return {
      scopeLimited: false,
      error: 'El acceso no tiene permiso sobre esta cuenta (revisa la subcuenta configurada).',
    };
  }
  return { scopeLimited: false, error: `No se pudo leer la configuración (código ${status}).` };
}
