import { describe, it, expect } from 'vitest';
import {
  DIAS_DE_HOLD,
  dentroDelRango,
  fechaQuePintaElPanel,
  necesitaRecorteEnMemoria,
  rangoBogota,
  whereSupersetDeFecha,
  type TipoDeFecha,
} from './rango-de-fechas';

/**
 * El filtro de fechas de /admin/commissions ("Detalle avanzado").
 *
 * EL FALLO (16-09-2026, Javier): filtrando 16/08–31/08 desaparecían 10
 * comisiones de 10 negocios —Serendipity entre ellas— que SÍ se veían sin
 * filtro y cuya columna "Fecha de compra" enseñaba una fecha dentro del rango.
 * Causa: el `where` miraba la columna `businessDate`, que en esas filas es
 * NULL, mientras la columna pintada salía de un cálculo (`tenant.purchasedAt`
 * o `createdAt`). NULL no entra en ningún rango → fila invisible.
 *
 * Las fixtures de abajo son filas REALES de producción (consultadas en solo
 * lectura el 16-09-2026), no inventadas.
 */

const RANGO = rangoBogota('2026-08-16', '2026-08-31')!;

type FilaCruda = {
  nombre: string;
  businessDate: Date | null;
  createdAt: Date;
  availableAt?: Date | null;
  paidAt?: Date | null;
  referralUse?: { tenant?: { purchasedAt: Date | null } | null } | null;
};

/** Adapta la fila cruda a lo que espera `fechaQuePintaElPanel`. */
const plana = (f: FilaCruda) => ({
  businessDate: f.businessDate,
  createdAt: f.createdAt,
  availableAt: f.availableAt ?? null,
  paidAt: f.paidAt ?? null,
  tenantPurchasedAt: f.referralUse?.tenant?.purchasedAt ?? null,
});

/**
 * Evalúa EN MEMORIA el mismísimo fragmento que se le manda a Prisma.
 *
 * Es deliberado: si se testeara una copia de la lógica, romper el fragmento
 * real dejaría los tests en verde — que es justo como este bug llegó a
 * producción. Aquí, quitarle al `where` la rama de `businessDate: null` pone
 * los tests en ROJO.
 */
const ES_OPERADOR = new Set(['gte', 'gt', 'lt', 'lte', 'equals', 'not']);
function evaluar(fragmento: any, fila: any): boolean {
  if (!fila) return false;
  return Object.entries(fragmento).every(([clave, cond]: [string, any]) => {
    if (clave === 'OR') return (cond as any[]).some((r) => evaluar(r, fila));
    if (clave === 'AND') return (cond as any[]).every((r) => evaluar(r, fila));
    if (cond === null) return (fila[clave] ?? null) === null;
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      const claves = Object.keys(cond);
      if (claves.length > 0 && claves.every((k) => ES_OPERADOR.has(k))) {
        const v = fila[clave] ?? null;
        if (!v) return false;
        const ms = new Date(v).getTime();
        if (cond.gte && ms < new Date(cond.gte).getTime()) return false;
        if (cond.lt && ms >= new Date(cond.lt).getTime()) return false;
        return true;
      }
      return evaluar(cond, fila[clave]); // relación (referralUse → tenant)
    }
    return fila[clave] === cond;
  });
}

/** El primer cobro del negocio; para las fixtures, el de la propia fila. */
const primerCobroDe = (f: FilaCruda) =>
  (f.availableAt ?? new Date(f.createdAt.getTime() + DIAS_DE_HOLD * 86400000)).getTime();

// ── Filas reales de producción (16-09-2026) ────────────────────────────────
// Las 10 que DESAPARECÍAN con el filtro 16/08–31/08. Todas businessDate NULL.
const DESAPARECIDAS: FilaCruda[] = [
  {
    nombre: 'Serendipity',
    businessDate: null,
    createdAt: new Date('2026-08-27T15:38:58.442Z'),
    availableAt: new Date('2026-09-10T14:26:21.000Z'),
    referralUse: { tenant: { purchasedAt: new Date('2026-08-26T14:26:21.000Z') } },
  },
  {
    nombre: 'El Arrayán',
    businessDate: null,
    createdAt: new Date('2026-08-18T16:18:57.516Z'),
    availableAt: new Date('2026-09-02T15:57:53.000Z'),
    referralUse: { tenant: { purchasedAt: new Date('2026-08-18T15:57:53.000Z') } },
  },
  {
    nombre: 'Restaurante el Establo',
    businessDate: null,
    createdAt: new Date('2026-08-28T21:43:55.093Z'),
    availableAt: new Date('2026-09-12T21:42:18.000Z'),
    referralUse: { tenant: { purchasedAt: new Date('2026-08-28T21:42:18.000Z') } },
  },
  {
    // Sin `purchasedAt`: la fecha pintada sale de createdAt.
    nombre: 'Café 1550 de Altitud',
    businessDate: null,
    createdAt: new Date('2026-08-31T13:06:02.635Z'),
    availableAt: new Date('2026-09-15T13:06:02.635Z'),
    referralUse: { tenant: { purchasedAt: null } },
  },
  {
    // NO es huérfana: es la comisión del GRUPO "Aldehir - Grupo Mistika"
    // ($15 del 17/08). No cuelga de ningún negocio (`referralUseId` null), y el
    // panel la pinta "(sin negocio)" porque sólo lee `referralUse.tenant`.
    nombre: 'comisión de grupo (Mistika)',
    businessDate: null,
    createdAt: new Date('2026-08-17T14:06:54.157Z'),
    availableAt: new Date('2026-09-01T14:06:54.157Z'),
    referralUse: null,
  },
];

// Filas que SÍ pasaban (tienen businessDate congelado): no deben romperse.
const YA_PASABAN: FilaCruda[] = [
  {
    nombre: 'MOMENTO',
    businessDate: new Date('2026-08-18T15:38:36.000Z'),
    createdAt: new Date('2026-08-18T15:40:00.000Z'),
    availableAt: new Date('2026-09-02T15:38:36.000Z'),
    referralUse: { tenant: { purchasedAt: null } },
  },
  {
    nombre: 'CHANFLE RESTAURANTE TEMÁTICO',
    businessDate: new Date('2026-08-25T00:23:30.000Z'), // 24/08 19:23 en Bogotá
    createdAt: new Date('2026-08-25T00:25:00.000Z'),
    availableAt: new Date('2026-09-09T00:23:30.000Z'),
    referralUse: { tenant: { purchasedAt: null } },
  },
];

// Fuera del rango: no deben colarse.
const FUERA: FilaCruda[] = [
  {
    nombre: 'Monet (15/08)',
    businessDate: new Date('2026-08-15T15:49:42.000Z'),
    createdAt: new Date('2026-08-15T15:50:00.000Z'),
    availableAt: new Date('2026-08-30T15:49:42.000Z'),
    referralUse: { tenant: { purchasedAt: null } },
  },
  {
    nombre: 'Konys (01/09, sin businessDate)',
    businessDate: null,
    createdAt: new Date('2026-09-01T23:50:04.162Z'),
    availableAt: new Date('2026-09-16T23:50:04.162Z'),
    referralUse: { tenant: { purchasedAt: null } },
  },
];

describe('el rango significa lo que el usuario cree (zona Bogotá)', () => {
  it('el día "hasta" entra ENTERO, no hasta su medianoche', () => {
    // 31/08 a las 20:00 en Bogotá es el 01/09 a la 01:00 en UTC. El fallo
    // clásico —`lte` a medianoche— se comería toda la tarde del día 31.
    const tarde31 = new Date('2026-09-01T01:00:00.000Z');
    expect(dentroDelRango(tarde31, RANGO)).toBe(true);
  });

  it('el 01/09 en Bogotá ya NO entra', () => {
    expect(dentroDelRango(new Date('2026-09-01T05:00:00.000Z'), RANGO)).toBe(false);
  });

  it('el 15/08 por la noche en Bogotá NO entra aunque en UTC sea 16', () => {
    // 15/08 23:00 Bogotá = 16/08 04:00 UTC. Anclado a UTC se colaría.
    expect(dentroDelRango(new Date('2026-08-16T04:00:00.000Z'), RANGO)).toBe(false);
  });

  it('el 16/08 a las 00:30 de Bogotá SÍ entra', () => {
    expect(dentroDelRango(new Date('2026-08-16T05:30:00.000Z'), RANGO)).toBe(true);
  });

  it('sin fechas no hay rango', () => {
    expect(rangoBogota(undefined, undefined)).toBeNull();
  });
});

describe('la fecha del filtro es la MISMA que pinta la columna', () => {
  it('con businessDate congelado, manda ese', () => {
    const f = YA_PASABAN[0];
    expect(fechaQuePintaElPanel(plana(f), 'purchase', primerCobroDe(f))).toEqual(
      f.businessDate,
    );
  });

  it('Serendipity: sin businessDate, se usa la fecha de compra del negocio', () => {
    // La fila que reportó Javier. Pinta 26/08 y el filtro tiene que verla igual.
    const f = DESAPARECIDAS[0];
    const pintada = fechaQuePintaElPanel(plana(f), 'purchase', primerCobroDe(f));
    expect(pintada).toEqual(new Date('2026-08-26T14:26:21.000Z'));
    expect(dentroDelRango(pintada, RANGO)).toBe(true);
  });

  it('sin businessDate NI compra del negocio, se usa la creación', () => {
    const f = DESAPARECIDAS[3]; // Café 1550
    expect(fechaQuePintaElPanel(plana(f), 'purchase', primerCobroDe(f))).toEqual(
      f.createdAt,
    );
  });

  it('una comisión de grupo (sin negocio propio) no se queda sin fecha', () => {
    const f = DESAPARECIDAS[4];
    expect(fechaQuePintaElPanel(plana(f), 'purchase', primerCobroDe(f))).toEqual(
      f.createdAt,
    );
  });
});

describe('EL BUG: ninguna fila que el panel pinta dentro puede caerse', () => {
  // Esta es la invariante que se rompió. Se comprueba contra el fragmento
  // REAL que se le pasa a Prisma, no contra una copia.
  // Muestra de las 10 filas que desaparecían (9 negocios + la comisión del
  // grupo Mistika); aquí van las 5 que cubren cada forma de fallar.
  it('las que desaparecían ahora las acepta el where', () => {
    const fragmento = whereSupersetDeFecha('purchase', RANGO);
    for (const f of DESAPARECIDAS) {
      const pintada = fechaQuePintaElPanel(plana(f), 'purchase', primerCobroDe(f));
      expect(
        dentroDelRango(pintada, RANGO),
        `${f.nombre}: el panel la pinta dentro del rango`,
      ).toBe(true);
      expect(
        evaluar(fragmento, f),
        `${f.nombre}: el where la dejaba fuera (ESTE es el bug)`,
      ).toBe(true);
    }
  });

  it('las que ya pasaban siguen pasando', () => {
    const fragmento = whereSupersetDeFecha('purchase', RANGO);
    for (const f of YA_PASABAN) {
      expect(evaluar(fragmento, f), f.nombre).toBe(true);
    }
  });

  it('las de fuera del rango no se cuelan tras el recorte exacto', () => {
    const fragmento = whereSupersetDeFecha('purchase', RANGO);
    for (const f of FUERA) {
      const pintada = fechaQuePintaElPanel(plana(f), 'purchase', primerCobroDe(f));
      // El superconjunto puede dejar pasar de más (para eso es), pero el
      // recorte por la fecha pintada tiene que sacarlas.
      expect(dentroDelRango(pintada, RANGO), f.nombre).toBe(false);
      void evaluar(fragmento, f);
    }
  });

  it('el where de compra contempla explícitamente businessDate NULL', () => {
    // Guarda de forma: si alguien vuelve a filtrar sólo por la columna, rojo.
    const fragmento: any = whereSupersetDeFecha('purchase', RANGO);
    const ramaNula = (fragmento.OR as any[]).find(
      (r) => r.businessDate === null,
    );
    expect(ramaNula, 'falta la rama de las comisiones sin fecha congelada').toBeDefined();
  });
});

describe('desbloqueo (available): mismo fallo, mismo remedio', () => {
  it('sin availableAt la fecha se calcula a createdAt + 15 días', () => {
    const f: FilaCruda = {
      nombre: 'legacy sin availableAt',
      businessDate: null,
      createdAt: new Date('2026-08-05T12:00:00.000Z'),
      availableAt: null,
      referralUse: null,
    };
    const pintada = fechaQuePintaElPanel(plana(f), 'available');
    expect(pintada).toEqual(new Date('2026-08-20T12:00:00.000Z'));
    expect(dentroDelRango(pintada, RANGO)).toBe(true);
    // Y el where no puede dejarla fuera.
    expect(evaluar(whereSupersetDeFecha('available', RANGO), f)).toBe(true);
  });
});

describe('pago (payment): la columna es el campo tal cual', () => {
  it('sin paidAt no entra en ningún rango (se pinta "—")', () => {
    const f: FilaCruda = {
      nombre: 'sin pagar',
      businessDate: null,
      createdAt: new Date('2026-08-20T12:00:00.000Z'),
      paidAt: null,
      referralUse: null,
    };
    expect(fechaQuePintaElPanel(plana(f), 'payment')).toBeNull();
    expect(dentroDelRango(fechaQuePintaElPanel(plana(f), 'payment'), RANGO)).toBe(false);
  });
});

describe('qué tipos necesitan recorte en memoria', () => {
  it('los que pueden salir de un cálculo, sí; los demás, no', () => {
    const esperado: Record<TipoDeFecha, boolean> = {
      purchase: true,
      available: true,
      payment: false,
      batch: false,
    };
    for (const [tipo, v] of Object.entries(esperado)) {
      expect(necesitaRecorteEnMemoria(tipo as TipoDeFecha), tipo).toBe(v);
    }
  });
});
