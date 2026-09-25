'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';

/**
 * «Horarios de domicilio»: cuándo acepta pedidos el negocio.
 *
 * EL CASO (Javier, 2026-09-25): una hamburguesería trabaja de 6 p. m. a 1 a. m.
 * Un cliente entra a su Instagram al mediodía, pasa al InfoLink y de ahí al
 * menú de domicilios, arma el carrito y lo manda. No hay nadie al otro lado.
 *
 * **Vacío = se pide a cualquier hora.** Es lo que hacen hoy todos los negocios
 * y nadie nota el cambio hasta que decide configurarlo.
 *
 * La franja puede cruzar la medianoche (18:00 → 01:00) y pertenece al día en
 * que EMPIEZA. Las reglas —y su validación de verdad— viven en el backend
 * (`orders/horario-de-domicilios.ts`); aquí solo se editan.
 */

type Franja = { dias: number[]; desde: string; hasta: string };

const DIAS = [
  { n: 1, corto: 'L' },
  { n: 2, corto: 'M' },
  { n: 3, corto: 'X' },
  { n: 4, corto: 'J' },
  { n: 5, corto: 'V' },
  { n: 6, corto: 'S' },
  { n: 0, corto: 'D' },
];

const TODOS = [0, 1, 2, 3, 4, 5, 6];

export function HorarioDomiciliosCard({
  valorInicial,
  onSaved,
}: {
  valorInicial: unknown;
  onSaved?: (franjas: Franja[]) => void;
}) {
  const [franjas, setFranjas] = useState<Franja[]>(() =>
    Array.isArray(valorInicial) ? (valorInicial as Franja[]) : [],
  );
  const [guardando, setGuardando] = useState(false);

  const cambiar = (i: number, patch: Partial<Franja>) =>
    setFranjas((prev) => prev.map((f, j) => (j === i ? { ...f, ...patch } : f)));

  const alternarDia = (i: number, dia: number) =>
    setFranjas((prev) =>
      prev.map((f, j) =>
        j === i
          ? {
              ...f,
              dias: f.dias.includes(dia)
                ? f.dias.filter((d) => d !== dia)
                : [...f.dias, dia].sort((a, b) => a - b),
            }
          : f,
      ),
    );

  async function guardar() {
    setGuardando(true);
    try {
      await api('/tenants/me', {
        method: 'PATCH',
        body: JSON.stringify({ deliveryHours: franjas }),
      });
      toast(
        franjas.length
          ? 'Horario guardado'
          : 'Sin horario: se reciben pedidos a cualquier hora',
        'success',
      );
      onSaved?.(franjas);
    } catch (e: any) {
      toast(e?.message || 'No se pudo guardar', 'error');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="card card-pad mb-4">
      <h2 className="text-base font-semibold m-0 flex items-center gap-2">
        🕒 Horarios de domicilio
      </h2>
      <p className="text-xs text-mute mt-1 leading-relaxed">
        Cuándo puede el cliente hacer un pedido a domicilio.{' '}
        <strong>Si lo dejas vacío, se reciben pedidos a cualquier hora.</strong>{' '}
        Si tu negocio abre de noche, pon la hora de cierre aunque caiga al día
        siguiente — por ejemplo de 6:00 p. m. a 1:00 a. m.
      </p>

      {franjas.length === 0 ? (
        <p className="text-sm text-mute mt-4 mb-0">
          Ahora mismo recibes pedidos las 24 horas, todos los días.
        </p>
      ) : (
        <div className="flex flex-col gap-3 mt-4">
          {franjas.map((f, i) => (
            <div key={i} className="rounded-lg border border-line p-3">
              <div className="flex flex-wrap items-center gap-1.5 mb-3">
                {DIAS.map((d) => (
                  <button
                    key={d.n}
                    type="button"
                    onClick={() => alternarDia(i, d.n)}
                    aria-pressed={f.dias.includes(d.n)}
                    className={`w-8 h-8 rounded-pill text-xs font-bold ${
                      f.dias.includes(d.n)
                        ? 'bg-brand text-white'
                        : 'bg-bg2 text-mute'
                    }`}
                  >
                    {d.corto}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-mute">de</span>
                <input
                  type="time"
                  className="input py-1.5 w-32"
                  value={f.desde}
                  onChange={(e) => cambiar(i, { desde: e.target.value })}
                />
                <span className="text-xs text-mute">a</span>
                <input
                  type="time"
                  className="input py-1.5 w-32"
                  value={f.hasta}
                  onChange={(e) => cambiar(i, { hasta: e.target.value })}
                />
                <button
                  type="button"
                  onClick={() => setFranjas((p) => p.filter((_, j) => j !== i))}
                  className="text-xs text-red-600 font-semibold ml-auto hover:underline"
                >
                  Quitar
                </button>
              </div>
              {f.desde > f.hasta && (
                <p className="text-[11px] text-mute mt-2 mb-0">
                  Cruza la medianoche: cierra al día siguiente.
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2 mt-4">
        <button
          type="button"
          className="btn-ghost rounded-pill text-sm"
          onClick={() =>
            setFranjas((p) => [...p, { dias: TODOS, desde: '18:00', hasta: '01:00' }])
          }
        >
          + Agregar franja
        </button>
        <button
          type="button"
          className="btn-primary rounded-pill text-sm ml-auto"
          disabled={guardando}
          onClick={guardar}
        >
          {guardando ? 'Guardando…' : 'Guardar horario'}
        </button>
      </div>
    </div>
  );
}
