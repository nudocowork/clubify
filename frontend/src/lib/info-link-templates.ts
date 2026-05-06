/**
 * 5 estilos de InfoLink que el negocio puede elegir al crear/editar una
 * mini-página. El template se guarda en `link.theme.template` (string)
 * para no requerir migration. El renderer público hace switch y aplica
 * el shell correspondiente.
 */

export type InfoLinkTemplate =
  | 'AURORA'
  | 'MINIMAL'
  | 'SHOP'
  | 'STORIES'
  | 'NEON';

export const INFO_LINK_TEMPLATES: {
  id: InfoLinkTemplate;
  emoji: string;
  name: string;
  hint: string;
}[] = [
  {
    id: 'AURORA',
    emoji: '🌅',
    name: 'Aurora',
    hint: 'Gradient mesh + glassmorphism. Marcas creativas y eventos.',
  },
  {
    id: 'MINIMAL',
    emoji: '⚪',
    name: 'Minimal',
    hint: 'Blanco limpio, foco en la info. Profesionales y boutiques.',
  },
  {
    id: 'SHOP',
    emoji: '🛍',
    name: 'Shop',
    hint: 'Hero + grid de productos. Vender desde el bio.',
  },
  {
    id: 'STORIES',
    emoji: '📸',
    name: 'Stories',
    hint: 'Feed estilo Instagram con posts. Marcas IG-first.',
  },
  {
    id: 'NEON',
    emoji: '⚡',
    name: 'Neon',
    hint: 'Fondo oscuro + glow neón. Bares, eventos nocturnos.',
  },
];

export const DEFAULT_TEMPLATE: InfoLinkTemplate = 'MINIMAL';

export function resolveTemplate(theme: any): InfoLinkTemplate {
  const t = theme?.template;
  if (
    t === 'AURORA' ||
    t === 'MINIMAL' ||
    t === 'SHOP' ||
    t === 'STORIES' ||
    t === 'NEON'
  )
    return t;
  return DEFAULT_TEMPLATE;
}
