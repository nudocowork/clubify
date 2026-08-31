/**
 * Redes sociales del infolink.
 *
 * Vive en `InfoLink.theme.social`, que ya es una columna JSON: no hace falta
 * migración y un infolink que no lo tenga se comporta como siempre — sin la
 * fila de iconos.
 *
 * Regla que sostiene todo lo demás: en la página pública **solo se pinta la
 * red activada Y con un enlace válido**. Un icono que lleva a ninguna parte
 * es peor que no tener icono: el cliente lo toca, no pasa nada, y la culpa se
 * la lleva el negocio.
 */

export type RedSocial = 'instagram' | 'facebook' | 'whatsapp' | 'tiktok';

export const REDES: RedSocial[] = [
  'instagram',
  'facebook',
  'whatsapp',
  'tiktok',
];

export const RED_LABEL: Record<RedSocial, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  whatsapp: 'WhatsApp',
  tiktok: 'TikTok',
};

/** Qué escribir en el campo, en el idioma del negocio. */
export const RED_PLACEHOLDER: Record<RedSocial, string> = {
  instagram: '@minegocio  ·  o  instagram.com/minegocio',
  facebook: 'facebook.com/minegocio',
  whatsapp: '+57 300 123 4567  ·  o  wa.me/573001234567',
  tiktok: '@minegocio  ·  o  tiktok.com/@minegocio',
};

export type RedConfig = {
  enabled?: boolean;
  /** Lo que escribió el negocio, tal cual. Se guarda sin normalizar para que
   *  al reabrir el editor vea lo que puso, no una URL reescrita. */
  value?: string;
};

export type SocialConfig = {
  /** Color de los iconos. Ausente = color principal del infolink. */
  color?: string | null;
} & Partial<Record<RedSocial, RedConfig | null>>;

/** Dominio oficial de cada red, para reconocer un enlace ya pegado. */
const DOMINIO: Record<RedSocial, RegExp> = {
  instagram: /^(https?:\/\/)?(www\.)?instagram\.com\//i,
  facebook: /^(https?:\/\/)?(www\.)?(facebook\.com|fb\.com|fb\.me|m\.facebook\.com)\//i,
  whatsapp: /^(https?:\/\/)?(www\.)?(wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com)\//i,
  tiktok: /^(https?:\/\/)?(www\.)?tiktok\.com\//i,
};

/** Un usuario de red: letras, números, punto, guion y guion bajo. */
const USUARIO = /^@?[A-Za-z0-9._-]{1,40}$/;

/**
 * Convierte lo que escribió el negocio en el enlace final, o `null` si no
 * hay forma de interpretarlo.
 *
 * Se acepta tanto el enlace completo como el usuario a secas (`@minegocio`):
 * quien administra el infolink de una cafetería copia su usuario, no la URL
 * canónica, y rechazárselo solo consigue que deje la red sin poner.
 */
export function enlaceDeRed(red: RedSocial, valor: string | null | undefined): string | null {
  const v = (valor ?? '').trim();
  if (!v) return null;

  if (red === 'whatsapp') {
    if (DOMINIO.whatsapp.test(v)) return v.startsWith('http') ? v : `https://${v}`;
    // Número: se aceptan espacios, guiones y paréntesis porque así es como
    // la gente escribe un teléfono. El '+' inicial se descarta: wa.me lo
    // quiere sin él.
    const digitos = v.replace(/[\s()+-]/g, '');
    if (!/^\d{7,15}$/.test(digitos)) return null;
    return `https://wa.me/${digitos}`;
  }

  if (DOMINIO[red].test(v)) return v.startsWith('http') ? v : `https://${v}`;

  // Cualquier otra URL apuntando a otro sitio no es «el enlace de esa red».
  if (/^https?:\/\//i.test(v) || v.includes('/')) return null;

  if (!USUARIO.test(v)) return null;
  const usuario = v.replace(/^@/, '');
  if (red === 'instagram') return `https://instagram.com/${usuario}`;
  if (red === 'facebook') return `https://facebook.com/${usuario}`;
  return `https://tiktok.com/@${usuario}`;
}

/** Mensaje de error para el editor, o `null` si el valor sirve. */
export function errorDeRed(red: RedSocial, valor: string | null | undefined): string | null {
  const v = (valor ?? '').trim();
  if (!v) return 'Falta el enlace.';
  if (enlaceDeRed(red, v)) return null;
  if (red === 'whatsapp') {
    return 'Escribe el número con indicativo (+57 300 123 4567) o un enlace wa.me.';
  }
  return `Escribe el usuario (@minegocio) o un enlace de ${RED_LABEL[red]}.`;
}

export type RedVisible = { red: RedSocial; href: string };

/**
 * Las redes que se pintan en la página pública: activadas y con enlace
 * válido, en el orden fijo de `REDES` para que no bailen entre infolinks.
 */
export function redesVisibles(social: SocialConfig | null | undefined): RedVisible[] {
  if (!social) return [];
  const out: RedVisible[] = [];
  for (const red of REDES) {
    const cfg = social[red];
    if (!cfg?.enabled) continue;
    const href = enlaceDeRed(red, cfg.value);
    if (href) out.push({ red, href });
  }
  return out;
}

/**
 * Color de los iconos. Sin elegir, el principal del infolink — así encajan
 * con el resto de la página desde el primer momento y ningún infolink ya
 * publicado cambia de aspecto (hoy no tiene iconos que cambiar).
 */
export function colorDeIconos(
  social: SocialConfig | null | undefined,
  primary: string,
): string {
  const c = social?.color?.trim();
  return c && /^#[0-9a-f]{3,8}$/i.test(c) ? c : primary;
}

/** Icono de marca de cada red, en `Icon.tsx`. */
export const RED_ICONO: Record<RedSocial, 'instagram' | 'facebook' | 'whatsapp' | 'tiktok'> = {
  instagram: 'instagram',
  facebook: 'facebook',
  whatsapp: 'whatsapp',
  tiktok: 'tiktok',
};

/** Lo que la fila de iconos necesita para pintarse, venga de donde venga. */
export type IconoSocial = {
  icono: 'instagram' | 'facebook' | 'whatsapp' | 'tiktok' | 'pin';
  href: string;
  label: string;
};

/**
 * Iconos heredados de la ficha del NEGOCIO.
 *
 * El estilo Minimal ya mostraba una fila de emojis (📷 💬 📍) sacada de
 * `tenant.instagramUrl`, `tenant.whatsappPhone` y `tenant.mapsUrl` — son los
 * «iconos genéricos» del reporte. Si la fila pasara a leer solo la
 * configuración nueva, todos esos infolinks publicados se quedarían sin
 * iconos de un día para otro.
 *
 * Así que esto es el respaldo: se usa cuando el infolink todavía no configuró
 * ninguna red. En cuanto configura una, manda la suya y este respaldo
 * desaparece — si no, saldrían los dos Instagram.
 *
 * Se conserva el pin de «cómo llegar» aunque no sea una red social: estaba
 * publicado y funcionando, y quitarlo sería romper algo que nadie pidió
 * romper.
 */
export function iconosDeRespaldo(tenant: {
  instagramUrl?: string | null;
  whatsappPhone?: string | null;
  mapsUrl?: string | null;
}): IconoSocial[] {
  const out: IconoSocial[] = [];
  if (tenant.instagramUrl) {
    out.push({ icono: 'instagram', href: tenant.instagramUrl, label: 'Instagram' });
  }
  if (tenant.whatsappPhone) {
    const d = tenant.whatsappPhone.replace(/\D/g, '');
    if (d) out.push({ icono: 'whatsapp', href: `https://wa.me/${d}`, label: 'WhatsApp' });
  }
  if (tenant.mapsUrl) {
    out.push({ icono: 'pin', href: tenant.mapsUrl, label: 'Cómo llegar' });
  }
  return out;
}

/** Los iconos que se pintan: los del infolink si configuró alguno, si no los
 *  heredados del negocio. */
export function iconosSociales(
  social: SocialConfig | null | undefined,
  tenant: { instagramUrl?: string | null; whatsappPhone?: string | null; mapsUrl?: string | null },
): IconoSocial[] {
  const propios = redesVisibles(social);
  if (propios.length > 0) {
    return propios.map((r) => ({
      icono: RED_ICONO[r.red],
      href: r.href,
      label: RED_LABEL[r.red],
    }));
  }
  return iconosDeRespaldo(tenant);
}
