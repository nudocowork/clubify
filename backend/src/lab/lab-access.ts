import { ForbiddenException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

/**
 * Quién usa el Lab y de qué marca.
 *
 * El Lab nació como la comunidad de Clubify: afiliados y negocios proponen y
 * el equipo de Clubify modera. Al abrirse a las marcas blancas, un afiliado de
 * Sellea veía una pestaña «Sellea Lab» con «Clubify Lab» dentro. Javier decidió
 * (2026-09-15) que en una marca blanca SOLO su administrador general use el Lab
 * —sus influencers, embajadores, vendedores, socios y negocios no— y que el
 * equipo de la plataforma vea las propuestas de todas las marcas, cada una con
 * su etiqueta, para ordenarlas.
 *
 * Ideas que sostienen las reglas:
 *
 *  - Plataforma = Clubify. Una marca `null` o igual al id de la fila Clubify es
 *    la plataforma, igual que en `resolveBrandScope`: las propuestas históricas
 *    nacieron sin marca y los códigos de afiliado de Clubify llevan su id. Si
 *    se trataran distinto, el Lab de Clubify perdería la mitad de su historia.
 *  - La marca de la SESIÓN manda sobre la del usuario en la base. Cuando el
 *    dueño de la plataforma «entra» a una marca, el token lleva esa marca aunque
 *    la identidad usada no la tenga (`superadmin.service.ts`,
 *    `impersonateWhiteLabel`).
 *  - Esa misma entrada firma el token con el `sub` del administrador REAL de la
 *    marca. Autor y voto se guardan con ese id, así que la sesión suplantada es
 *    de solo lectura: un voto pisaría el del administrador (`proposalId_userId`)
 *    y un comentario saldría «Por Humberto» sin que Humberto lo escribiera.
 *  - Una propuesta de otra marca no existe para quien no modera: 404, no 403,
 *    para no confirmar que el id es bueno. El equipo de la plataforma la VE,
 *    pero no vota ni comenta: su voto movería el ranking de otra marca y su
 *    nombre saldría en un Lab que no es el de Clubify.
 */

export type LabAlcance =
  /** SUPER_ADMIN / MARKETING de la plataforma: su feed y la moderación de todas las marcas. */
  | 'PLATAFORMA_EQUIPO'
  /** Afiliados y dueños de negocio de la plataforma: el feed de Clubify. */
  | 'PLATAFORMA_MIEMBRO'
  /** Administrador general de una marca blanca: el feed de SU marca, sin moderación. */
  | 'MARCA_ADMIN';

export interface LabVisor {
  alcance: LabAlcance;
  /** Marca con la que nacen sus propuestas. null o la de Clubify = plataforma. */
  whiteLabelId: string | null;
  /** Id de la fila Clubify (null en entornos sin ella). */
  clubifyId: string | null;
  /** Sesión suplantada de un admin de marca: ve el Lab, no propone, vota ni comenta. */
  soloLectura: boolean;
}

export interface DatosDelVisor {
  role: string;
  /** Marca del token. */
  sesionWhiteLabelId?: string | null;
  /** `impersonatedBy` del token: quién está usando la sesión de otro. */
  suplantadoPor?: string | null;
  /** `User.whiteLabelId` (admins de marca). */
  usuarioWhiteLabelId?: string | null;
  /** `Tenant.whiteLabelId` del negocio del dueño. */
  negocioWhiteLabelId?: string | null;
  /** `ReferralCode.whiteLabelId`: un afiliado no tiene negocio, su marca vive ahí. */
  codigoWhiteLabelId?: string | null;
  clubifyId: string | null;
}

export type EtiquetaMarca = {
  id: string;
  name: string;
  primaryColor: string | null;
};

export const LAB_SOLO_ADMIN_DE_MARCA =
  'El Lab de tu marca solo está disponible para su administrador general.';
export const LAB_SIN_ACCESO = 'No tienes acceso al Lab.';
export const LAB_MODERACION_SOLO_PLATAFORMA =
  'La moderación del Lab es solo para el equipo de la plataforma.';
export const LAB_SUPLANTACION_SOLO_LECTURA =
  'Entraste a esta marca desde el panel maestro: puedes ver su Lab, pero no proponer, votar ni comentar en nombre de su administrador.';
// No nombra a nadie a propósito: lo lee un negocio de Clubify, y el motivo de
// verdad («es para las marcas») no le dice nada útil.
export const LAB_ADJUNTAR_SOLO_MARCAS =
  'Adjuntar archivos no está disponible en tu Lab. Puedes pegar el enlace de una imagen o un video.';

/** Valor del filtro de marca de la moderación para Clubify + las históricas sin marca. */
export const FILTRO_PLATAFORMA = 'plataforma';
/** Valor especial del filtro: solo los tickets de marcas blancas. */
export const FILTRO_MARCAS_BLANCAS = 'marcas';

const AFILIADOS = new Set([
  'AFFILIATE_INFLUENCER',
  'AFFILIATE_AMBASSADOR',
  'AFFILIATE_VENDOR',
  'AFFILIATE_SOCIO',
]);

export function esDeLaPlataforma(
  whiteLabelId: string | null | undefined,
  clubifyId: string | null,
): boolean {
  return !whiteLabelId || (!!clubifyId && whiteLabelId === clubifyId);
}

/** Dos marcas son la misma si son la misma fila, o si las dos son la plataforma. */
export function mismaMarca(
  a: string | null | undefined,
  b: string | null | undefined,
  clubifyId: string | null,
): boolean {
  const aPlataforma = esDeLaPlataforma(a, clubifyId);
  const bPlataforma = esDeLaPlataforma(b, clubifyId);
  if (aPlataforma || bPlataforma) return aPlataforma && bPlataforma;
  return a === b;
}

/** Decide quién es alguien para el Lab. Lanza 403 si no le toca usarlo. */
export function resolverVisorLab(d: DatosDelVisor): LabVisor {
  const { clubifyId } = d;
  const role = String(d.role);

  if (role === 'SUPER_ADMIN' || role === 'MARKETING') {
    const wl = d.sesionWhiteLabelId ?? d.usuarioWhiteLabelId ?? null;
    if (esDeLaPlataforma(wl, clubifyId)) {
      return { alcance: 'PLATAFORMA_EQUIPO', whiteLabelId: wl, clubifyId, soloLectura: false };
    }
    if (role === 'SUPER_ADMIN') {
      return {
        alcance: 'MARCA_ADMIN',
        whiteLabelId: wl,
        clubifyId,
        soloLectura: !!d.suplantadoPor,
      };
    }
    // MARKETING de una marca blanca no es su administrador general.
    throw new ForbiddenException(LAB_SOLO_ADMIN_DE_MARCA);
  }

  let wl: string | null;
  if (role === 'TENANT_OWNER') {
    wl = d.negocioWhiteLabelId ?? d.usuarioWhiteLabelId ?? null;
  } else if (AFILIADOS.has(role)) {
    wl = d.codigoWhiteLabelId ?? d.usuarioWhiteLabelId ?? null;
  } else {
    throw new ForbiddenException(LAB_SIN_ACCESO);
  }
  if (!esDeLaPlataforma(wl, clubifyId)) {
    throw new ForbiddenException(LAB_SOLO_ADMIN_DE_MARCA);
  }
  return { alcance: 'PLATAFORMA_MIEMBRO', whiteLabelId: wl, clubifyId, soloLectura: false };
}

/** WHERE de la plataforma: Clubify y las propuestas históricas sin marca. */
export function filtroPlataforma(
  clubifyId: string | null,
): Prisma.LabProposalWhereInput {
  return clubifyId
    ? { OR: [{ whiteLabelId: null }, { whiteLabelId: clubifyId }] }
    : { whiteLabelId: null };
}

/** WHERE del feed de quien mira: cada marca ve SU Lab. */
export function filtroDeMarca(visor: LabVisor): Prisma.LabProposalWhereInput {
  if (visor.alcance === 'MARCA_ADMIN') {
    return { whiteLabelId: visor.whiteLabelId };
  }
  return filtroPlataforma(visor.clubifyId);
}

/**
 * WHERE del filtro por marca de la moderación. Sin valor → todas las marcas.
 * Pedir la fila Clubify por id cuenta como la plataforma entera, para no dejar
 * fuera las históricas sin marca.
 */
export function filtroAdminPorMarca(
  valor: string | null | undefined,
  clubifyId: string | null,
): Prisma.LabProposalWhereInput | null {
  if (!valor) return null;
  if (valor === FILTRO_MARCAS_BLANCAS) {
    // Todo lo que NO es de la plataforma: los tickets que nos mandan las
    // marcas. Javier fue a buscarlos dos veces al Lab público de Clubify, donde
    // por diseño no pueden salir —cada Lab es de su marca—, así que la
    // moderación necesita una vista que los junte.
    return clubifyId
      ? { AND: [{ whiteLabelId: { not: null } }, { whiteLabelId: { not: clubifyId } }] }
      : { whiteLabelId: { not: null } };
  }
  if (valor === FILTRO_PLATAFORMA || esDeLaPlataforma(valor, clubifyId)) {
    return filtroPlataforma(clubifyId);
  }
  return { whiteLabelId: valor };
}

export function puedeVerPropuesta(
  visor: LabVisor,
  propuestaWhiteLabelId: string | null,
): boolean {
  return (
    visor.alcance === 'PLATAFORMA_EQUIPO' ||
    mismaMarca(visor.whiteLabelId, propuestaWhiteLabelId, visor.clubifyId)
  );
}

export function puedeParticipar(
  visor: LabVisor,
  propuestaWhiteLabelId: string | null,
): boolean {
  if (visor.soloLectura) return false;
  return mismaMarca(visor.whiteLabelId, propuestaWhiteLabelId, visor.clubifyId);
}

/** Proponer, votar y comentar: nunca desde una sesión suplantada (ver cabecera). */
export function exigirParticipacion(visor: LabVisor): void {
  if (visor.soloLectura) {
    throw new ForbiddenException(LAB_SUPLANTACION_SOLO_LECTURA);
  }
}

/**
 * Quién puede SUBIR una imagen o un video a una propuesta.
 *
 * Javier lo decidió así (2026-09-16): «Sellea y marcas blancas nos permitirán
 * ayudarles a las marcas a optimizar». El adjunto es la herramienta con la que
 * el administrador de una marca enseña lo que quiere cambiar, y por eso no lo
 * tienen «los demás negocios»: `PLATAFORMA_MIEMBRO` son los negocios y los
 * afiliados de Clubify, que son miles y subirían 100 MB al bucket cada uno.
 *
 * El equipo de la plataforma sí: son de casa, unos pocos, y ya suben archivos
 * por todo el producto.
 *
 * Ojo con lo que este candado NO es: pegar el ENLACE de un archivo lo sigue
 * pudiendo hacer todo el mundo, igual que hasta hoy. Lo que se cierra es la
 * subida al bucket, que es lo que cuesta dinero y espacio.
 */
export function puedeAdjuntar(visor: LabVisor): boolean {
  // Una sesión suplantada no sube nada a nombre del administrador real.
  if (visor.soloLectura) return false;
  return (
    visor.alcance === 'MARCA_ADMIN' || visor.alcance === 'PLATAFORMA_EQUIPO'
  );
}

export function exigirAdjuntar(visor: LabVisor): void {
  if (!puedeAdjuntar(visor)) {
    throw new ForbiddenException(LAB_ADJUNTAR_SOLO_MARCAS);
  }
}

export function exigirModeracion(visor: LabVisor): void {
  if (visor.alcance !== 'PLATAFORMA_EQUIPO') {
    throw new ForbiddenException(LAB_MODERACION_SOLO_PLATAFORMA);
  }
}

/**
 * Pone a cada propuesta la etiqueta de su marca. Las de la plataforma quedan
 * sin etiqueta. Una marca que ya no está en la base sale como «Marca
 * desconocida»: dejarla sin etiqueta la haría pasar por una de Clubify.
 */
export function conEtiquetaDeMarca<T extends { whiteLabelId: string | null }>(
  items: T[],
  marcas: Map<string, EtiquetaMarca>,
  clubifyId: string | null,
): Array<T & { brand: EtiquetaMarca | null }> {
  return items.map((p) => {
    if (esDeLaPlataforma(p.whiteLabelId, clubifyId)) return { ...p, brand: null };
    const id = p.whiteLabelId as string;
    return {
      ...p,
      brand: marcas.get(id) ?? { id, name: 'Marca desconocida', primaryColor: null },
    };
  });
}
