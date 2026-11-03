/**
 * ABONOS — qué pasó con cada abono de USD 20 (Javier, 2026-11-03).
 *
 * Un abono aparta el plan; el cliente paga el restante después con una oferta
 * «+ Abono» (ver billing/abono-hotmart.ts). Hasta hoy el abono entraba como un
 * ingreso suelto y nadie podía ver cuáles ya se habían convertido en plan y
 * cuáles seguían colgando. Cada abono queda en uno de tres estados:
 *
 *   ENLAZADO   el restante ya entró. Automático cuando el cliente pagó con el
 *              MISMO correo; manual cuando usó otro.
 *   EN_ESPERA  todavía no paga el restante.
 *   NO_PAGARA  Javier sabe que ese cliente no va a completar.
 *
 * El enlace automático gana siempre sobre «No pagará»: si el cliente terminó
 * pagando, la decisión vieja ya no describe la realidad.
 *
 * Esto no mueve dinero ni comisiones: la comisión del closer ya nace sobre el
 * plan completo cuando entra el restante, y el socio cobra sobre el total
 * facturado (abono + restante), que es lo que hay en el libro.
 */

export type EstadoAbono = 'ENLAZADO' | 'EN_ESPERA' | 'NO_PAGARA';

/** Lo que se guarda por abono en `Setting` (`abono.<tx>`). Solo decisiones manuales. */
export interface DecisionAbono {
  estado: 'ENLAZADO' | 'NO_PAGARA';
  /** Transacción del pago restante, si se enlazó a mano. */
  pagoTx?: string | null;
  nota?: string | null;
  por?: string | null;
  fecha: string;
}

export const PREFIJO_DECISION = 'abono.';

export interface AbonoBase {
  tx: string;
  email: string | null;
  fecha: Date;
}

export interface PagoRestante {
  tx: string;
  email: string | null;
  fecha: Date;
}

export interface Clasificado {
  tx: string;
  estado: EstadoAbono;
  pagoTx: string | null;
  enlace: 'AUTOMATICO' | 'MANUAL' | null;
}

/** Tolerancia hacia atrás: el restante a veces se aprueba antes que el abono
 *  (Hotmart aprueba cada compra por su lado) — un día basta. */
const MARGEN_MS = 24 * 60 * 60 * 1000;

const correo = (e: string | null | undefined) => (e ?? '').trim().toLowerCase();

export function leerDecision(valor: string | null | undefined): DecisionAbono | null {
  if (!valor) return null;
  try {
    const d = JSON.parse(valor) as DecisionAbono;
    return d && (d.estado === 'ENLAZADO' || d.estado === 'NO_PAGARA') ? d : null;
  } catch {
    return null;
  }
}

/**
 * Clasifica todos los abonos de una vez, para que un mismo pago restante no se
 * enlace a dos abonos. Primero se reservan los enlaces manuales; después, por
 * orden de fecha, cada abono toma el primer restante libre con su correo.
 */
export function clasificarAbonos(
  abonos: AbonoBase[],
  pagos: PagoRestante[],
  decisiones: Map<string, DecisionAbono>,
): Clasificado[] {
  const usados = new Set<string>();
  for (const d of decisiones.values()) {
    if (d.estado === 'ENLAZADO' && d.pagoTx) usados.add(d.pagoTx);
  }
  const pagosOrdenados = [...pagos].sort((a, b) => a.fecha.getTime() - b.fecha.getTime());
  const resultado = new Map<string, Clasificado>();

  for (const a of [...abonos].sort((x, y) => x.fecha.getTime() - y.fecha.getTime())) {
    const d = decisiones.get(a.tx);
    if (d?.estado === 'ENLAZADO') {
      resultado.set(a.tx, { tx: a.tx, estado: 'ENLAZADO', pagoTx: d.pagoTx ?? null, enlace: 'MANUAL' });
      continue;
    }
    const mail = correo(a.email);
    const pago = mail
      ? pagosOrdenados.find(
          (p) =>
            !usados.has(p.tx) &&
            correo(p.email) === mail &&
            p.fecha.getTime() >= a.fecha.getTime() - MARGEN_MS,
        )
      : undefined;
    if (pago) {
      usados.add(pago.tx);
      resultado.set(a.tx, { tx: a.tx, estado: 'ENLAZADO', pagoTx: pago.tx, enlace: 'AUTOMATICO' });
      continue;
    }
    resultado.set(a.tx, {
      tx: a.tx,
      estado: d?.estado === 'NO_PAGARA' ? 'NO_PAGARA' : 'EN_ESPERA',
      pagoTx: null,
      enlace: null,
    });
  }
  return abonos.map((a) => resultado.get(a.tx)!);
}
