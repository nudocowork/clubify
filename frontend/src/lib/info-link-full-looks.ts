/**
 * "Looks completos" del InfoLink — bundlea logoContainer + bannerConfig
 * + tipografía + sombras en un solo paquete. Un click aplica los 4
 * elementos coherentemente, así el dueño elige un vibe global sin tener
 * que tunear cada panel.
 *
 * Los 4 looks coinciden conceptualmente con los 4 presets de logo y
 * banner (minimalista/premium/dark/glassmorphism), pero acá se aplican
 * en conjunto para que el resultado se vea armado.
 */

import {
  LOGO_CONTAINER_PRESETS,
  type LogoContainerConfig,
} from './info-link-logo-container';
import { BANNER_PRESETS, type BannerConfig } from './info-link-banner';

export type FullLookId = 'minimalista' | 'premium' | 'dark' | 'glassmorphism';

export type FullLook = {
  id: FullLookId;
  label: string;
  description: string;
  /** Bundle de configs que se aplican al click. */
  logoContainer: LogoContainerConfig;
  bannerConfig: BannerConfig;
  /** Familia tipográfica para títulos/subtítulos del shell. Las opciones
   *  son fuentes Google ya cargadas globalmente — value usable directo
   *  como font-family CSS. */
  fontFamily: string;
};

export const FULL_LOOKS: Record<FullLookId, FullLook> = {
  minimalista: {
    id: 'minimalista',
    label: 'Minimalista',
    description: 'Tipografía sans clean, sin sombras pesadas. Foco en el contenido.',
    logoContainer: LOGO_CONTAINER_PRESETS.minimalista.config,
    bannerConfig: BANNER_PRESETS.limpio.config,
    fontFamily: 'Inter, system-ui, sans-serif',
  },
  premium: {
    id: 'premium',
    label: 'Premium',
    description: 'Serif elegante, sombras suaves, banner con sombreado para lectura.',
    logoContainer: LOGO_CONTAINER_PRESETS.premium.config,
    bannerConfig: BANNER_PRESETS.oscuro.config,
    fontFamily: '"Playfair Display", Georgia, serif',
  },
  dark: {
    id: 'dark',
    label: 'Dark / Cinema',
    description: 'Vibe nocturno: logo con glow, banner cinemático con gradient negro.',
    logoContainer: LOGO_CONTAINER_PRESETS.dark.config,
    bannerConfig: BANNER_PRESETS.cinematico.config,
    fontFamily: '"Space Grotesk", Inter, sans-serif',
  },
  glassmorphism: {
    id: 'glassmorphism',
    label: 'Glassmorphism',
    description: 'Translúcidos + blur. Foto de fondo desenfocada con vidrio esmerilado encima.',
    logoContainer: LOGO_CONTAINER_PRESETS.glassmorphism.config,
    bannerConfig: BANNER_PRESETS.blur.config,
    fontFamily: '"Manrope", Inter, sans-serif',
  },
};
