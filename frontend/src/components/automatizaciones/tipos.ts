/**
 * Tipos y ayudas de la pestaña «Mensajes automáticos» del panel de la marca.
 *
 * Viven fuera del panel porque las tres piezas de la pantalla —la columna de
 * carpetas, la fila de un mensaje y el panel lateral— necesitan exactamente las
 * mismas formas. Tenerlas repetidas en cada archivo era la vía rápida a que una
 * se quedara vieja y el editor guardara un campo que la lista ya no pintaba.
 */

/** El correo que acompaña a una automatización (misma condición de envío). */
export type EmailTwin = {
  id: string;
  subject: string;
  subjectDefault: string;
  body: string;
  bodyDefault: string;
  vars: string[];
  enabled: boolean;
  isBrandCustom: boolean;
};

export type BrandMsgTemplate = {
  id: string;
  label: string;
  description: string;
  vars: string[];
  folderId: string;
  status: 'active' | 'pending';
  enabled: boolean;
  channel: string;
  audience: string;
  default: string;
  text: string;
  isBrandCustom: boolean;
  source: 'brand' | 'global' | 'default';
  /** Correo gemelo, si esta automatización también sale por email. */
  email?: EmailTwin | null;
  /** Solo tarjetas de canal EMAIL sin gemelo (bienvenida, panel creado). */
  subject?: string;
  subjectDefault?: string;
};

export type BrandMsgFolder = { id: string; name: string; system: boolean };

/** Borrador de un correo mientras se edita (asunto + cuerpo juntos). */
export type BorradorDeCorreo = { subject: string; body: string };

/**
 * Cómo se llama el canal DE CARA AL USUARIO.
 *
 * Por dentro se llama `SMS`, pero lo que sale es un WhatsApp. Vive en una sola
 * función porque la cabecera decía «WhatsApp» y el botón de probar decía
 * «Probar» a secas: al lado de «Probar correo» se leía como un botón genérico
 * y parecía que no había forma de probar el mensaje. Sí la había.
 */
export function nombreDeCanal(canal: string): string {
  return canal === 'SMS' ? 'WhatsApp' : canal;
}

/**
 * El correo de una automatización, venga como gemelo o sea la tarjeta entera.
 *
 * Las tarjetas de canal EMAIL (bienvenida, panel creado) no traen `email`: el
 * backend les manda el asunto suelto en `subject`/`subjectDefault`. Antes esas
 * dos se editaban con el editor de texto plano, así que su ASUNTO no había
 * forma de tocarlo aunque el mismo PATCH ya lo aceptaba. Devolviéndolas con la
 * misma forma que un gemelo, el editor de correo las cubre sin caso especial.
 */
export function correoDe(t: BrandMsgTemplate): EmailTwin | null {
  if (t.email) return t.email;
  if (t.channel !== 'EMAIL') return null;
  return {
    id: t.id,
    subject: t.subject ?? '',
    subjectDefault: t.subjectDefault ?? '',
    body: t.text,
    bodyDefault: t.default,
    vars: t.vars,
    enabled: t.enabled,
    isBrandCustom: t.isBrandCustom,
  };
}

/** ¿Esta automatización tiene un texto de WhatsApp/SMS propio que editar? */
export function tieneTexto(t: BrandMsgTemplate): boolean {
  return t.channel !== 'EMAIL';
}

/** Recorte de una línea del mensaje, para la vista previa de la fila. */
export function vistaPrevia(texto: string, max = 140): string {
  const plano = (texto || '').replace(/\s+/g, ' ').trim();
  if (plano.length <= max) return plano;
  return `${plano.slice(0, max - 1).trimEnd()}…`;
}

/** ¿Coincide el mensaje con lo escrito en el buscador? */
export function coincideConBusqueda(t: BrandMsgTemplate, q: string): boolean {
  if (!q) return true;
  const correo = correoDe(t);
  // Se busca también en el TEXTO, no solo en el nombre: quien recuerda «el del
  // link de pago» no recuerda cómo se llama la automatización, recuerda una
  // frase que leyó en el mensaje.
  const campos = [
    t.label,
    t.description,
    t.text,
    t.audience,
    correo?.subject ?? '',
    correo?.body ?? '',
  ];
  return campos.some((c) => (c || '').toLowerCase().includes(q));
}
