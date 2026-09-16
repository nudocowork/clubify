import { interpolateEmail, type EmailTemplateDef } from './brand-email-templates';
import {
  maquetarCorreo,
  resumenParaVistaPrevia,
  sinEmojiInicial,
  textoPlano,
  urlSegura,
  type IdentidadDeCorreo,
} from './maquetador';

/**
 * Asunto interpolado en una sola línea. Un token vacío (una marca sin nombre)
 * dejaba dobles espacios en el asunto: «Tu cuenta de  está por pausarse».
 */
export function interpolarAsunto(plantilla: string, vars: Record<string, string>): string {
  return interpolateEmail(plantilla, vars).replace(/\s+/g, ' ').trim();
}

/**
 * HTML y texto plano de un correo del catálogo de ciclo de vida (pago
 * confirmado, recordatorios, pausa…). Es puro: lo usa `BrandEmailService` al
 * enviar y lo usan las previsualizaciones y los tests sin base de datos.
 *
 * El marco es de la MARCA (logo, color, pie) y no del negocio: el aviso lo
 * manda la marca que cobra. El negocio sale como dato («Negocio: Fressh»).
 */
export function renderCorreoDeCiclo(args: {
  def: EmailTemplateDef;
  identidad: IdentidadDeCorreo | null;
  /** Asunto ya interpolado. Sin su emoji inicial hace de título. */
  asunto: string;
  /** Cuerpo ya interpolado, con `**negrita**` y listas «1.». */
  cuerpo: string;
  vars: Record<string, string>;
}): { html: string; texto: string } {
  const { def, identidad, asunto, cuerpo, vars } = args;
  const url = def.cta ? urlSegura(vars[def.cta.urlVar]) : null;
  const boton = def.cta && url ? { texto: def.cta.label, url } : null;

  // La caja de datos es estructura de FÁBRICA y acompaña al texto por defecto,
  // que por eso no repite esos datos. Si la marca reescribió el cuerpo, la caja
  // no se pinta: no la puede quitar desde el panel y podría contradecir su texto.
  const cuerpoDeFabrica = cuerpo.trim() === interpolateEmail(def.default, vars).trim();
  // Una fila con el token vacío no se pinta: mejor sin «Próximo cobro» que con
  // la etiqueta sola.
  const filas = cuerpoDeFabrica
    ? (def.facts ?? [])
        .map((f) => ({ etiqueta: f.label, valor: (vars[f.var] ?? '').trim() }))
        .filter((f) => f.valor)
    : [];

  const html = maquetarCorreo({
    identidad,
    preheader: resumenParaVistaPrevia(cuerpo),
    antetitulo: def.kicker ?? null,
    titulo: sinEmojiInicial(asunto),
    bloques: [
      { tipo: 'texto', texto: cuerpo },
      ...(filas.length ? [{ tipo: 'datos' as const, filas }] : []),
    ],
    boton,
    enlaceVisible: def.showCtaLink === true,
    // El comprador todavía no tiene cuenta: decirle que «tiene una» es falso.
    motivo:
      def.audience === 'Al comprador'
        ? 'Recibes este correo porque hiciste una compra en {marca}.'
        : 'Recibes este correo porque tienes una cuenta en {marca}.',
  });

  // El texto plano lleva también los datos de la caja: el texto por defecto ya
  // no los repite, y es lo que ve un cliente sin HTML y lo que guarda el historial.
  const texto = [
    textoPlano(cuerpo),
    filas.map((f) => `${f.etiqueta}: ${f.valor}`).join('\n'),
    boton ? `${boton.texto}: ${boton.url}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  return { html, texto };
}
