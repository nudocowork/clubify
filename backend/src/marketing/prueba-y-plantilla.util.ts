// ── Envío de prueba + plantilla del paso «Enviar correo» ───────────────────
//
// Helpers PUROS compartidos por los DOS constructores de flujos: el de
// contactos (`marketing/`) y el de negocios (`superadmin/brand-workflows/`).
//
// Viven en un solo sitio a propósito. Las dos pantallas y los dos motores son
// gemelos, y cada vez que algo se ha copiado entre ellos se ha separado a la
// primera corrección (pasó con el catálogo, que llegó a ofrecer un disparador
// que el motor no lanzaba nunca). Aquí no hay nada de Nest ni de Prisma: el que
// llama trae las filas ya leídas y su propio `resolveMerge`, y estas funciones
// solo deciden.

/**
 * De qué parte del producto viene el envío, para `MessageLog.feature`.
 *
 * Tiene el suyo propio —y no el `flujo-de-marca` de los envíos de verdad— para
 * que una prueba no se cuente como un mensaje al cliente cuando alguien mire
 * «¿cuántos correos salieron esta semana?». También es lo que cuenta el tope.
 */
export const FEATURE_PRUEBA = 'prueba-de-flujo';

/**
 * Con qué empieza todo lo que sale de «Enviar prueba».
 *
 * Quien recibe la prueba suele ser la misma persona que recibe los mensajes de
 * verdad (el móvil del dueño de la marca). Sin una marca al principio, una
 * prueba de «tu suscripción vence mañana» se lee como un aviso real.
 */
export const PREFIJO_PRUEBA = 'PRUEBA · ';

/** Cuántas pruebas puede hacer una marca dentro de la ventana. */
export const TOPE_PRUEBAS = 10;
/** Ventana del tope, en minutos. */
export const VENTANA_PRUEBAS_MIN = 10;

/**
 * Dónde se guarda el destino de prueba de cada marca.
 *
 * Son las MISMAS claves que usa la pantalla de «Mensajes automáticos»
 * (`superadmin.service.ts`): quien ya guardó ahí su número no tiene que
 * volverlo a escribir aquí, y al revés. Están escritas otra vez porque las de
 * allí son privadas de ese servicio; si alguna vez cambia el formato, hay que
 * cambiarlo en los dos sitios.
 */
export const claveTelefonoDePrueba = (whiteLabelId: string) => `autom.testphone.${whiteLabelId}`;
export const claveCorreoDePrueba = (whiteLabelId: string) => `autom.testemail.${whiteLabelId}`;

export type CanalDePrueba = 'sms' | 'email';

/** Antepone la marca de prueba sin duplicarla si el texto ya la trae. */
export function conPrefijoDePrueba(texto: string): string {
  const t = String(texto ?? '').trim();
  if (t.startsWith(PREFIJO_PRUEBA.trim())) return t;
  return `${PREFIJO_PRUEBA}${t}`;
}

/**
 * Los valores de ejemplo con los que se sustituyen los `{{merge}}` en una
 * prueba. Cubre las variables de los DOS catálogos (las del contacto y las del
 * negocio) porque el mismo botón sirve en las dos pantallas.
 *
 * Una variable que el catálogo no conozca sigue quedando VACÍA, igual que en un
 * envío de verdad: si aquí se rellenara con algo inventado, la prueba se vería
 * bien y el mensaje real saldría con un hueco — que es justo lo que el botón
 * viene a evitar.
 */
export function ctxDePrueba(datos: { marca?: string | null; negocio?: string | null }): Record<string, string> {
  const negocio = (datos.negocio ?? '').trim() || 'Tu negocio';
  const marca = (datos.marca ?? '').trim() || negocio;
  return {
    // ── Contacto ──
    nombre: 'Ana',
    email: 'ana@ejemplo.com',
    telefono: '+57 300 000 0000',
    empresa: negocio,
    marca,
    respuesta: 'Sí, me interesa',
    etapa: 'Contactado',
    equipo: 'Ventas',
    vendedor: 'Carlos',
    cita_fecha: '15 de octubre de 2026',
    cita_hora: '10:00 a. m.',
    cita_estado: 'Confirmada',
    embudo: 'Ventas',
    etapa_oportunidad: 'Propuesta enviada',
    estado_oportunidad: 'Abierta',
    valor_oportunidad: '$500.000',
    // ── Negocio ──
    negocio,
    owner: 'Ana',
    plan: 'Pro',
    periodicidad: 'Mensual',
    vence: '15 de octubre de 2026',
    prueba_termina: '20 de octubre de 2026',
    pedidos: '128',
    platform: marca,
  };
}

/**
 * ¿El destino de prueba sirve para este canal?
 *
 * Deliberadamente flojo con el teléfono (hay formatos de medio mundo) y
 * estricto con lo que importa: que no vaya un correo al campo del teléfono ni
 * al revés, que es el error que de verdad se comete.
 */
export function destinoDePruebaValido(canal: CanalDePrueba, destino: string): { ok: true; valor: string } | { ok: false; motivo: string } {
  const valor = String(destino ?? '').trim();
  if (!valor) {
    return {
      ok: false,
      motivo: canal === 'sms' ? 'Escribe un teléfono de prueba.' : 'Escribe un correo de prueba.',
    };
  }
  if (canal === 'email') {
    // Un correo de verdad: algo, arroba, algo, punto, algo. Sin espacios.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valor)) return { ok: false, motivo: 'Ese correo no parece un correo.' };
    return { ok: true, valor: valor.toLowerCase() };
  }
  const digitos = valor.replace(/\D/g, '');
  if (digitos.length < 7 || digitos.length > 15) return { ok: false, motivo: 'Ese teléfono no parece un teléfono.' };
  if (/[a-zA-Z@]/.test(valor)) return { ok: false, motivo: 'Ese teléfono no parece un teléfono.' };
  return { ok: true, valor };
}

export type ResultadoDePrueba = {
  ok: boolean;
  canal: CanalDePrueba;
  /** A dónde salió (o a dónde se iba a intentar). */
  destino: string | null;
  motivo?: string;
  /**
   * El motivo es de lo que mandó quien pulsó el botón (destino vacío, tope,
   * marca sin subcuenta) y no del proveedor. El controlador lo convierte en un
   * 400 para que la pantalla lo enseñe como algo que se puede arreglar.
   */
  deEntrada?: boolean;
};

/**
 * El «Enviar prueba» de un paso, de principio a fin, sin Nest ni Prisma: quien
 * llama trae las cuatro cosas que dependen de la base (leer y guardar el
 * destino, contar las pruebas recientes, y enviar).
 *
 * Está aquí y no en cada controlador porque los dos constructores son gemelos
 * y las reglas que importan son las mismas en los dos:
 *
 *  1. **El destino nunca es arbitrario.** Si llega uno escrito a mano, se
 *     valida y se GUARDA como destino de prueba de la marca antes de mandar
 *     nada. Así no hay forma de usar el botón para mandarle un SMS a un tercero
 *     desde el remitente de la marca: lo que se manda es siempre a lo que la
 *     marca tiene puesto como suyo.
 *  2. **Tope por marca.** Sin él, el botón es un generador de mensajes gratis
 *     contra la subcuenta —y contra la reputación del remitente— a golpe de
 *     clic.
 *
 * La subcuenta por la que sale la decide `enviar`, y siempre es la de la marca
 * del que pide la prueba: aquí no entra ningún identificador de marca ajeno.
 */
export async function ejecutarPruebaDeFlujo(deps: {
  canal: CanalDePrueba;
  /** El que escribió el usuario en el panel, si escribió alguno. */
  destino?: string | null;
  leerDestinoGuardado: () => Promise<string | null>;
  guardarDestino: (valor: string) => Promise<void>;
  /** Cuántas pruebas lleva la marca dentro de la ventana. */
  contarPruebas: () => Promise<number>;
  enviar: (destino: string) => Promise<{ ok: boolean; motivo?: string }>;
}): Promise<ResultadoDePrueba> {
  const canal = deps.canal;
  const escrito = String(deps.destino ?? '').trim();

  let destino: string;
  if (escrito) {
    const v = destinoDePruebaValido(canal, escrito);
    if (!v.ok) return { ok: false, canal, destino: null, motivo: v.motivo, deEntrada: true };
    destino = v.valor;
    // Guardar ANTES de enviar: el destino solo es legítimo porque pasa a ser el
    // de la marca. Si se guardara después, un envío fallido dejaría el destino
    // sin guardar y el siguiente intento volvería a pedirlo.
    await deps.guardarDestino(destino);
  } else {
    const guardado = (await deps.leerDestinoGuardado()) ?? '';
    const v = destinoDePruebaValido(canal, guardado);
    if (!v.ok) {
      return {
        ok: false,
        canal,
        destino: null,
        motivo: canal === 'sms' ? 'Escribe el teléfono al que quieres que llegue la prueba.' : 'Escribe el correo al que quieres que llegue la prueba.',
        deEntrada: true,
      };
    }
    destino = v.valor;
  }

  if ((await deps.contarPruebas()) >= TOPE_PRUEBAS) {
    return {
      ok: false,
      canal,
      destino,
      motivo: `Ya van ${TOPE_PRUEBAS} pruebas en los últimos ${VENTANA_PRUEBAS_MIN} minutos. Espera un momento y vuelve a intentarlo.`,
      deEntrada: true,
    };
  }

  const res = await deps.enviar(destino);
  return res.ok
    ? { ok: true, canal, destino }
    : { ok: false, canal, destino, motivo: res.motivo || 'No se pudo enviar la prueba.' };
}

// ── Plantilla del paso «Enviar correo» ──────────────────────────────────────

/** Lo que hace falta de una `MktEmailTemplate` para decidir si se puede usar. */
export type PlantillaDeCorreo = {
  id: string;
  whiteLabelId: string;
  isPreset: boolean;
  subject: string | null;
  html: string | null;
};

export type CorreoDelPaso =
  | { ok: true; subject: string; html: string }
  | { ok: false; motivo: string };

/**
 * Qué asunto y qué HTML salen de un paso «Enviar correo».
 *
 * Con plantilla elegida el cuerpo es el `html` de la plantilla —una REFERENCIA
 * por id, no una copia: se lee al enviar, así que editar la plantilla cambia lo
 * que manda el flujo— y el asunto es el del paso si lo escribieron, o el de la
 * plantilla si no.
 *
 * FAIL-CLOSED, y es lo importante de esta función: si la plantilla ya no
 * existe, es de otra marca, o se quedó sin HTML, NO se cae al cuerpo escrito en
 * el paso ni se manda un correo en blanco. Devuelve el motivo para que el paso
 * se salte y quede anotado. Un correo vacío a toda una lista no se puede
 * deshacer; un paso saltado, sí.
 *
 * `merge` es el `resolveMerge` del motor que llama, con su contexto ya dentro:
 * los `{{campos}}` se sustituyen también DENTRO del HTML de la plantilla.
 */
export function correoDelPaso(input: {
  templateId?: unknown;
  /** La fila que se leyó con ese id, o null si no se encontró. */
  plantilla: PlantillaDeCorreo | null;
  /** La marca DUEÑA del flujo: la plantilla tiene que ser suya o de fábrica. */
  whiteLabelId: string;
  subject?: unknown;
  body?: unknown;
  merge: (texto: string) => string;
}): CorreoDelPaso {
  const templateId = String(input.templateId ?? '').trim();
  const asuntoDelPaso = input.merge(String(input.subject ?? '')).trim();

  if (!templateId) {
    const body = input.merge(String(input.body ?? ''));
    // Un cuerpo que ya trae etiquetas se manda tal cual; uno de texto plano
    // necesita los saltos de línea convertidos o llega todo en un párrafo.
    const html = /<[a-z][\s\S]*>/i.test(body) ? body : body.replace(/\n/g, '<br>');
    return { ok: true, subject: asuntoDelPaso, html };
  }

  if (!input.plantilla) {
    return { ok: false, motivo: 'La plantilla de correo del paso ya no existe' };
  }
  // Propia o de fábrica. Una plantilla de OTRA marca no se usa aunque alguien
  // haya escrito su id a mano en el flujo: el contenido de otra marca saldría
  // firmado con esta, que es la fuga de marca de siempre.
  if (input.plantilla.whiteLabelId !== input.whiteLabelId && !input.plantilla.isPreset) {
    return { ok: false, motivo: 'La plantilla de correo del paso es de otra marca' };
  }
  const html = input.merge(String(input.plantilla.html ?? ''));
  if (!html.trim()) {
    return { ok: false, motivo: 'La plantilla de correo del paso está vacía' };
  }
  const subject = asuntoDelPaso || input.merge(String(input.plantilla.subject ?? '')).trim();
  return { ok: true, subject, html };
}
