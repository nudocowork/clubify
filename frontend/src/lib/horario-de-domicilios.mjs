/**
 * Horario de domicilios — ESPEJO de `backend/src/orders/horario-de-domicilios.ts`.
 * Mantener sincronizado, igual que `solo-infolink.ts`.
 *
 * Vive también aquí por una razón concreta: la respuesta pública del negocio se
 * cachea `s-maxage=180, stale-while-revalidate=600`. Un «abierto: true/false»
 * calculado en el servidor y metido dentro de esa respuesta queda congelado
 * hasta 10 minutos — a las 17:58 se cachea «cerrado» y a las 18:05 el cliente
 * sigue viendo cerrado. Peor al revés: le dejas llenar el formulario a las
 * 00:58 y el backend se lo rechaza a las 01:01.
 *
 * Por eso el servidor manda el HORARIO y el cliente saca la conclusión, con su
 * propio reloj y en la zona del negocio. El backend sigue rechazando al guardar:
 * esta es la cara amable, no la autoridad.
 */

const ES_HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const NOMBRE_DIA = [
  'domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado',
];

/** "18:30" → 1110. `null` si no es una hora válida. */
export function aMinutos(hora) {
  const m = ES_HORA.exec(String(hora ?? '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** 1110 → "6:30 p. m." */
export function enDoceHoras(minutos) {
  const h24 = Math.floor(minutos / 60) % 24;
  const mm = minutos % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const sufijo = h24 < 12 ? 'a. m.' : 'p. m.';
  return mm === 0 ? `${h12} ${sufijo}` : `${h12}:${String(mm).padStart(2, '0')} ${sufijo}`;
}

/** Se queda con las franjas que se entienden. Una rota no tumba a las demás. */
export function franjasUtiles(valor) {
  if (!Array.isArray(valor)) return [];
  return valor.filter(
    (f) =>
      f &&
      Array.isArray(f.dias) &&
      f.dias.length > 0 &&
      f.dias.every((d) => Number.isInteger(d) && d >= 0 && d <= 6) &&
      aMinutos(f.desde) !== null &&
      aMinutos(f.hasta) !== null &&
      aMinutos(f.desde) !== aMinutos(f.hasta),
  );
}

/** Qué día y qué minuto es AHORA en la zona del negocio. */
export function momentoLocal(ahora, zona) {
  let partes;
  try {
    partes = new Intl.DateTimeFormat('en-CA', {
      timeZone: zona || 'America/Bogota',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(ahora);
  } catch {
    // Zona que el navegador no entiende: se cae a Bogotá, como el backend.
    partes = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Bogota',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(ahora);
  }
  const buscar = (t) => partes.find((x) => x.type === t)?.value ?? '';
  const DIAS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    diaSemana: DIAS[buscar('weekday')] ?? 0,
    minutos: (Number(buscar('hour')) % 24) * 60 + (Number(buscar('minute')) || 0),
  };
}

/** ¿Se puede pedir ahora? Sin horario, siempre sí. */
export function estaAbierto(valor, ahora, zona) {
  const franjas = franjasUtiles(valor);
  if (!franjas.length) return true;
  const { diaSemana, minutos } = momentoLocal(ahora, zona);
  const ayer = (diaSemana + 6) % 7;
  return franjas.some((f) => {
    const desde = aMinutos(f.desde);
    const hasta = aMinutos(f.hasta);
    if (desde < hasta) {
      return f.dias.includes(diaSemana) && minutos >= desde && minutos < hasta;
    }
    // Cruza la medianoche: la franja es del día en que EMPIEZA.
    return (
      (f.dias.includes(diaSemana) && minutos >= desde) ||
      (f.dias.includes(ayer) && minutos < hasta)
    );
  });
}

/** «hoy a las 6 p. m.» / «mañana…» / «el viernes…». `null` si ya está abierto. */
export function proximaApertura(valor, ahora, zona) {
  const franjas = franjasUtiles(valor);
  if (!franjas.length || estaAbierto(valor, ahora, zona)) return null;
  const { diaSemana, minutos } = momentoLocal(ahora, zona);
  for (let salto = 0; salto < 7; salto++) {
    const dia = (diaSemana + salto) % 7;
    const candidatas = franjas
      .filter((f) => f.dias.includes(dia))
      .map((f) => aMinutos(f.desde))
      .filter((m) => salto > 0 || m > minutos)
      .sort((a, b) => a - b);
    if (!candidatas.length) continue;
    const hora = enDoceHoras(candidatas[0]);
    if (salto === 0) return `hoy a las ${hora}`;
    if (salto === 1) return `mañana a las ${hora}`;
    return `el ${NOMBRE_DIA[dia]} a las ${hora}`;
  }
  return null;
}

/**
 * Los días en que el negocio NO recibe ningún pedido.
 *
 * Es el error caro de configurar: alguien marca solo el viernes y deja de
 * recibir pedidos los otros seis días sin enterarse. Esto existe para
 * enseñárselo antes de que pase, no para impedírselo.
 */
export function diasSinHorario(valor) {
  const franjas = franjasUtiles(valor);
  if (!franjas.length) return [];
  const cubiertos = new Set(franjas.flatMap((f) => f.dias));
  return [1, 2, 3, 4, 5, 6, 0].filter((d) => !cubiertos.has(d));
}

/** Una franja en palabras: «viernes, de 6 p. m. a 1 a. m. del día siguiente». */
export function franjaEnPalabras(f) {
  const desde = aMinutos(f?.desde);
  const hasta = aMinutos(f?.hasta);
  if (desde === null || hasta === null) return null;
  const dias = !f.dias?.length
    ? 'sin días'
    : f.dias.length === 7
      ? 'todos los días'
      : [...f.dias].sort((a, b) => a - b).map((d) => NOMBRE_DIA[d]).join(', ');
  const cruza = desde > hasta ? ' del día siguiente' : '';
  return `${dias}, de ${enDoceHoras(desde)} a ${enDoceHoras(hasta)}${cruza}`;
}
