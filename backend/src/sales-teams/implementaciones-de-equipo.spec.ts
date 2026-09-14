import { describe, it, expect } from 'vitest';
import {
  estadoTrasMarcar,
  PASOS_POR_DEFECTO,
  ImplementacionesDeEquipoService,
} from './implementaciones-de-equipo.service';

/**
 * «Clientes» del equipo de ventas: la lista de comprobación de cada venta.
 *
 * Se prueba la regla que decide el estado al marcar un paso —la parte que un
 * clic mal pensado rompería— y el arranque automático al cerrar una venta, que
 * tiene que ser idempotente aunque lleguen dos llamadas a la vez.
 */

const pasos = (...hechos: boolean[]) => hechos.map((done) => ({ done }));

describe('el estado tras marcar un paso', () => {
  it('marcar el primero de una pendiente la pone en progreso', () => {
    expect(estadoTrasMarcar('pendiente', pasos(true, false, false))).toBe('en_progreso');
  });

  it('marcar el último la completa', () => {
    expect(estadoTrasMarcar('en_progreso', pasos(true, true, true))).toBe('completada');
  });

  it('una ya completada no se toca aunque sigan todos hechos', () => {
    expect(estadoTrasMarcar('completada', pasos(true, true))).toBeNull();
  });

  it('desmarcar un paso NO devuelve a progreso una completada: eso lo decide una persona', () => {
    expect(estadoTrasMarcar('completada', pasos(true, false))).toBeNull();
  });

  it('una cancelada no revive por marcar casillas', () => {
    expect(estadoTrasMarcar('cancelada', pasos(true, true, true))).toBeNull();
  });

  it('sin pasos no se completa nada (every() de un array vacío es true, y sería mentira)', () => {
    expect(estadoTrasMarcar('pendiente', [])).toBeNull();
  });
});

describe('arrancar la implementación al cerrar una venta', () => {
  function servicio() {
    const filas: any[] = [];
    const prisma: any = {
      salesImplementation: {
        findUnique: async ({ where }: any) =>
          filas.find((f) => f.leadId === where.leadId) ?? null,
        create: async ({ data }: any) => {
          // El índice único de `leadId`, como en Postgres.
          if (filas.some((f) => f.leadId === data.leadId)) {
            throw Object.assign(new Error('Unique constraint'), { code: 'P2002' });
          }
          const fila = { id: `impl-${filas.length + 1}`, ...data };
          filas.push(fila);
          return fila;
        },
      },
    };
    const srv = new ImplementacionesDeEquipoService(prisma);
    return { srv, filas };
  }

  const entrada = {
    teamId: 't1',
    whiteLabelId: 'wl-sellea',
    leadId: 'lead-1',
    cliente: 'Café La Esquina',
  };

  it('nace con los 6 pasos, pendiente y con plazo de entrega', async () => {
    const { srv, filas } = servicio();
    const r = await srv.asegurarParaLead(entrada);
    expect(r.nueva).toBe(true);
    expect(filas).toHaveLength(1);
    expect(filas[0].status).toBe('pendiente');
    expect(filas[0].whiteLabelId).toBe('wl-sellea');
    expect(filas[0].items.create.map((x: any) => x.title)).toEqual([...PASOS_POR_DEFECTO]);
    expect(filas[0].dueDate.getTime()).toBeGreaterThan(filas[0].startDate.getTime());
  });

  it('mover la tarjeta a «Cliente» dos veces deja UNA implementación', async () => {
    const { srv, filas } = servicio();
    const a = await srv.asegurarParaLead(entrada);
    const b = await srv.asegurarParaLead(entrada);
    expect(filas).toHaveLength(1);
    expect(b).toEqual({ id: a.id, nueva: false });
  });

  it('dos llamadas A LA VEZ tampoco crean dos: el índice único decide', async () => {
    const { srv, filas } = servicio();
    const [a, b] = await Promise.all([
      srv.asegurarParaLead(entrada),
      srv.asegurarParaLead(entrada),
    ]);
    expect(filas).toHaveLength(1);
    expect(a.id).toBe(b.id);
  });
});
