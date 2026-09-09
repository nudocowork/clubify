/**
 * Cada cuánto puede consumir un socio.
 *
 * EL AGUJERO QUE CIERRA
 * ---------------------
 * El cupo del club es MENSUAL y se descuenta, pero nada regulaba el ritmo: un
 * socio con 10 cafés al mes podía llevarse los 10 en un mismo minuto y el
 * sistema solo lo paraba al llegar a cero. Pasó de verdad en DEMO CLUBIFY el
 * 2026-09-08 — tres consumos en dos minutos y medio, saldo 9 → 8 → 7 → 6:
 *
 *   15:53:55  x1  saldo 8
 *   15:54:54  x1  saldo 7
 *   15:56:22  x1  saldo 6
 *
 * Un plan de «10 cafés al mes» que se agota el día 1 no es lo que el negocio
 * vendió, y encima le vacía el inventario de una sentada.
 *
 * DOS LÍMITES, LOS DOS OPCIONALES
 * -------------------------------
 * - `maxPorDia`: cuántos como mucho en un día (en hora de Bogotá, igual que el
 *   período — si no, un café de las 8 de la noche contaría en el día
 *   siguiente).
 * - `minutosEntreConsumos`: cuánto hay que esperar desde el anterior. Sirve
 *   para «uno por visita» sin tener que definir qué es una visita.
 *
 * Los dos en null = como hasta ahora. Es a propósito: encenderlos de oficio le
 * cambiaría las reglas a socios que ya pagaron.
 *
 * Sin dependencias, como `club-periodo.ts`: son reglas puras y se prueban de
 * verdad.
 */

const TZ_BOGOTA = 'America/Bogota';

/** El día natural de un instante en Bogotá: "2026-09-08". */
export function diaDe(fecha: Date, tz: string = TZ_BOGOTA): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(fecha);
}

/** Minutos que la zona va por delante de UTC en ese instante (Bogotá: -300). */
function desfaseMinutos(fecha: Date, tz: string): number {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(fecha);
  const p = Object.fromEntries(partes.map((x) => [x.type, x.value]));
  const comoSiFueraUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour) % 24, // 'en-US' con hour12:false devuelve 24 a medianoche
    Number(p.minute),
    Number(p.second),
  );
  return Math.round((comoSiFueraUtc - fecha.getTime()) / 60_000);
}

/**
 * El instante UTC en que empezó el día local de `fecha`.
 *
 * Es lo que hay que darle a la consulta: los `createdAt` están en UTC y la
 * medianoche de Bogotá son las 05:00 UTC. Filtrando por medianoche UTC, los
 * consumos de las 7 y las 11 de la noche caerían en el día siguiente y el tope
 * diario dejaría pasar el doble cada tarde.
 *
 * El desfase se mide, no se supone: hoy Bogotá es -5 todo el año, pero el mismo
 * código sirve si mañana un negocio vive en otra zona.
 */
export function inicioDelDia(fecha: Date, tz: string = TZ_BOGOTA): Date {
  const dia = diaDe(fecha, tz);
  const medianocheComoUtc = new Date(`${dia}T00:00:00.000Z`).getTime();
  return new Date(medianocheComoUtc - desfaseMinutos(fecha, tz) * 60_000);
}

export interface LimitesDeFrecuencia {
  /** Máximo por día natural. null = sin tope. */
  maxPorDia: number | null;
  /** Espera mínima desde el consumo anterior, en minutos. null = sin espera. */
  minutosEntreConsumos: number | null;
}

export interface EstadoDeFrecuencia {
  /** Cuántos lleva HOY (sumando cantidades, sin contar los anulados). */
  consumidosHoy: number;
  /** Cuándo fue el último que cuenta, o null si no hay ninguno. */
  ultimoConsumoAt: Date | null;
}

export type MotivoBloqueo = 'CUPO_DIARIO' | 'ESPERA';

export interface VeredictoFrecuencia {
  permitido: boolean;
  motivo?: MotivoBloqueo;
  /** Mensaje para el cajero, ya redactado. */
  mensaje?: string;
  /** Cuándo podrá volver a consumir, si el motivo es la espera. */
  disponibleEn?: Date;
}

/**
 * Plural de la unidad del negocio. Es un apaño con reglas, no un diccionario,
 * pero cubre lo que la gente escribe de verdad: café, lavada, clase, corte,
 * masaje, sesión, menú.
 *
 * La versión ingenua (`/[aeiou]$/` → +s, si no +es) daba «cafées», porque la
 * `é` no está en `[aeiou]`. Lo cazó una prueba antes de que lo leyera un
 * cliente.
 */
export function pluralDe(unidad: string): string {
  const u = (unidad || 'beneficio').trim();
  if (/[aeiouáéíóúü]$/i.test(u)) return `${u}s`; // café→cafés, clase→clases
  if (/ón$/i.test(u)) return u.replace(/ón$/i, 'ones'); // sesión→sesiones
  if (/z$/i.test(u)) return u.replace(/z$/i, 'ces'); // vez→veces
  return `${u}es`; // corte ya cae arriba; queda flor→flores
}

/** "3 cafés" / "1 café", con la unidad del plan. */
function enUnidad(n: number, unidad: string): string {
  const u = (unidad || 'beneficio').trim();
  return n === 1 ? `1 ${u}` : `${n} ${pluralDe(u)}`;
}

/** "2 horas y 15 minutos" a partir de minutos. Redondea hacia arriba: decirle
 *  al cliente que vuelva antes de tiempo lo manda a un segundo rechazo. */
export function esperaEnPalabras(minutos: number): string {
  const m = Math.max(1, Math.ceil(minutos));
  if (m < 60) return m === 1 ? '1 minuto' : `${m} minutos`;
  const horas = Math.floor(m / 60);
  const resto = m % 60;
  const h = horas === 1 ? '1 hora' : `${horas} horas`;
  if (resto === 0) return h;
  return `${h} y ${resto === 1 ? '1 minuto' : `${resto} minutos`}`;
}

/**
 * ¿Puede llevarse `cantidad` ahora mismo?
 *
 * El cupo diario se mira ANTES que la espera: si ya agotó el día, decirle que
 * espere veinte minutos sería mentira — no le van a servir.
 */
export function puedeConsumir(entrada: {
  limites: LimitesDeFrecuencia;
  estado: EstadoDeFrecuencia;
  cantidad: number;
  ahora: Date;
  unidad: string;
  tz?: string;
}): VeredictoFrecuencia {
  const { limites, estado, cantidad, ahora, unidad } = entrada;

  const maxPorDia =
    typeof limites.maxPorDia === 'number' && limites.maxPorDia > 0
      ? limites.maxPorDia
      : null;
  if (maxPorDia != null && estado.consumidosHoy + cantidad > maxPorDia) {
    const quedan = Math.max(0, maxPorDia - estado.consumidosHoy);
    return {
      permitido: false,
      motivo: 'CUPO_DIARIO',
      mensaje:
        quedan === 0
          ? `Ya se llevó ${enUnidad(maxPorDia, unidad)} hoy, que es el máximo del plan. Puede volver mañana.`
          : `El plan permite ${enUnidad(maxPorDia, unidad)} al día y hoy ya lleva ${estado.consumidosHoy}. Solo ${quedan === 1 ? 'queda 1' : `quedan ${quedan}`}.`,
    };
  }

  const espera =
    typeof limites.minutosEntreConsumos === 'number' &&
    limites.minutosEntreConsumos > 0
      ? limites.minutosEntreConsumos
      : null;
  if (espera != null && estado.ultimoConsumoAt) {
    const disponibleEn = new Date(
      estado.ultimoConsumoAt.getTime() + espera * 60_000,
    );
    if (ahora < disponibleEn) {
      const faltan = (disponibleEn.getTime() - ahora.getTime()) / 60_000;
      return {
        permitido: false,
        motivo: 'ESPERA',
        disponibleEn,
        mensaje: `Acaba de usar el plan. Puede volver a usarlo en ${esperaEnPalabras(faltan)}.`,
      };
    }
  }

  return { permitido: true };
}

/** Lo que el negocio no puede guardar, o `null` si la configuración es válida. */
export function errorDeLimites(
  limites: Partial<LimitesDeFrecuencia>,
  beneficiosPorMes: number,
): string | null {
  const { maxPorDia, minutosEntreConsumos } = limites;

  if (maxPorDia != null) {
    if (!Number.isInteger(maxPorDia) || maxPorDia < 1) {
      return 'El máximo por día tiene que ser un número entero de 1 o más. Dejalo vacío si no querés límite.';
    }
    // Un tope diario mayor que el cupo del mes no limita nada y hace creer que
    // sí. Mejor decirlo al guardar que descubrirlo cuando alguien se queje.
    if (maxPorDia > beneficiosPorMes) {
      return `El máximo por día (${maxPorDia}) no puede superar el cupo del mes (${beneficiosPorMes}): nunca se aplicaría.`;
    }
  }

  if (minutosEntreConsumos != null) {
    if (!Number.isInteger(minutosEntreConsumos) || minutosEntreConsumos < 1) {
      return 'La espera entre usos tiene que ser un número entero de minutos. Dejala vacía si no querés espera.';
    }
    // Más de un día de espera con cupo mensual deja beneficios sin usar, y el
    // socio los pagó.
    if (minutosEntreConsumos > 24 * 60) {
      return 'La espera entre usos no puede pasar de 24 horas: el socio perdería beneficios que ya pagó.';
    }
  }

  return null;
}
