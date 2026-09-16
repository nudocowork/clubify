/**
 * Quién cuenta de verdad como "negocio sin afiliado" en el aviso amarillo de
 * /admin/commissions.
 *
 * EL FALLO QUE ESTO IMPIDE (16-09-2026, reportado por Javier): el aviso listaba
 * "Cevichería Marea Místika" como si nadie cobrara por ella. No era cierto: ese
 * negocio pertenece al grupo empresarial "Aldehir - Grupo Mistika", que sí
 * tiene afiliado (TAFMPWK5, Nicolas Quintero) y que YA generó sus comisiones
 * ($15 pagada en julio, $15 aprobada en agosto). La comisión de un grupo se
 * calcula UNA vez sobre el bruto del grupo (`Commission.businessGroupId`), no
 * negocio por negocio, así que sus miembros no tienen `ReferralUse` propio —
 * y la consulta, que sólo miraba el `ReferralUse` del negocio suelto, los daba
 * por huérfanos.
 *
 * No era cosmético: el aviso invita a "asignarlos manualmente", y hacerlo
 * habría creado una atribución por negocio que pelea con la del grupo (dos
 * recipientes para el mismo cobro).
 *
 * OJO CON EL CANDADO: es "el GRUPO tiene afiliado QUE COBRA", NO "pertenece a
 * un grupo". Dos formas de equivocarse, las dos esconden negocios por los que
 * no cobra nadie:
 *
 *   1. Excluir por pertenencia. En producción hay 3 grupos vacíos y SIN
 *      afiliado; si mañana cae ahí un negocio que paga, nadie cobra por él y el
 *      aviso tiene que seguir avisando.
 *   2. Mirar sólo que exista `referralCodeId`. Un código DESACTIVADO no
 *      devenga: `generateGroupCommission` aborta con 'code-inactivo'
 *      (`referrals.service.ts:5193`) y el cron de recurrentes filtra por
 *      `referralCode: { isActive: true }` (`:452`). Si se desactivara TAFMPWK5,
 *      Mistika dejaría de generar comisión y sus 3 negocios desaparecerían del
 *      aviso justo cuando más falta hace verlos.
 */

/** Lo mínimo para decidir si alguien cobra por este negocio. */
export type NegocioParaAtribucion = {
  /**
   * ¿Tiene `ReferralUse` propio con un rol que cobra (influencer/embajador/
   * vendedor) Y con el código ACTIVO? El filtro por `isActive` se hace en la
   * consulta (`listUnattributedBusinesses`), por el mismo motivo del punto 2
   * de arriba.
   */
  atribuidoDirecto: boolean;
  /** Grupo empresarial al que pertenece. Null = negocio suelto. */
  grupo?: {
    referralCodeId: string | null;
    referralCode?: { isActive: boolean } | null;
  } | null;
};

/** ¿Hay alguien cobrando comisión por este negocio, por la vía que sea? */
export function tieneAfiliadoQueCobra(negocio: NegocioParaAtribucion): boolean {
  // Vía 1: atribución directa del negocio.
  if (negocio.atribuidoDirecto) return true;
  // Vía 2: el grupo empresarial al que pertenece tiene recipiente, y es ahí
  // donde se genera la comisión (`generateGroupCommission`). Un grupo sin
  // recipiente —o con el código desactivado— no genera nada: ese negocio sigue
  // estando huérfano. Se compara contra `false` explícito, igual que el
  // generador, para no dar por inactivo lo que simplemente no se seleccionó.
  const grupo = negocio.grupo;
  if (!grupo?.referralCodeId) return false;
  return grupo.referralCode?.isActive !== false;
}

/** El negocio va en el aviso "sin afiliado". */
export function quedaSinAfiliado(negocio: NegocioParaAtribucion): boolean {
  return !tieneAfiliadoQueCobra(negocio);
}
