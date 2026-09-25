'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';
import {
  diasSinHorario,
  estaAbierto,
  franjaEnPalabras,
  NOMBRE_DIA,
} from '@/lib/horario-de-domicilios.mjs';

/**
 * «Horarios de domicilio»: cuándo acepta pedidos el negocio.
 *
 * EL CASO (Javier, 2026-09-25): una hamburguesería trabaja de 6 p. m. a 1 a. m.
 * Un cliente entra a su Instagram al mediodía, pasa al InfoLink y de ahí al
 * menú de domicilios, arma el carrito y lo manda. No hay nadie al otro lado.
 *
 * Esta pantalla está hecha para que sea DIFÍCIL equivocarse, porque el error
 * caro no es poner mal una hora: es marcar solo el viernes y dejar de recibir
 * pedidos los otros seis días sin enterarse. Por eso:
 *
 *  - El interruptor de arriba dice en voz alta lo que pasa. «Vacío = siempre
 *    abierto» era verdad pero nadie lo deduce mirando una lista vacía.
 *  - Hay atajos para los tres casos de siempre; casi nadie tiene que tocar
 *    los días a mano.
 *  - Cada franja se lee en español debajo, con «del día siguiente» cuando
 *    cruza la medianoche.
 *  - Si quedan días sin cubrir, se dicen EN ROJO y por su nombre.
 *  - Y se enseña si AHORA MISMO estaría abierto, que es la única forma de
 *    saber si lo que configuraste es lo que querías.
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
const ENTRE_SEMANA = [1, 2, 3, 4, 5];
const FIN_DE_SEMANA = [0, 6];

const ATAJOS: { etiqueta: string; franjas: Franja[] }[] = [
  {
    etiqueta: 'Todos los días, 8 a. m. – 10 p. m.',
    franjas: [{ dias: TODOS, desde: '08:00', hasta: '22:00' }],
  },
  {
    etiqueta: 'Todas las noches, 6 p. m. – 1 a. m.',
    franjas: [{ dias: TODOS, desde: '18:00', hasta: '01:00' }],
  },
  {
    etiqueta: 'Entre semana y fin de semana por separado',
    franjas: [
      { dias: ENTRE_SEMANA, desde: '11:00', hasta: '22:00' },
      { dias: FIN_DE_SEMANA, desde: '11:00', hasta: '00:00' },
    ],
  },
];

export function HorarioDomiciliosCard({
  valorInicial,
  zona,
  onSaved,
}: {
  valorInicial: unknown;
  /** Zona del negocio: «ahora mismo» es su hora, no la de quien configura. */
  zona?: string;
  onSaved?: (franjas: Franja[]) => void;
}) {
  const inicial = Array.isArray(valorInicial) ? (valorInicial as Franja[]) : [];
  const [conHorario, setConHorario] = useState(inicial.length > 0);
  const [franjas, setFranjas] = useState<Franja[]>(inicial);
  const [guardando, setGuardando] = useState(false);

  // El «ahora mismo» se refresca solo: si alguien deja la pantalla abierta,
  // que no le mienta.
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const enUso = conHorario ? franjas : [];
  const huecos = diasSinHorario(enUso);
  const abiertoAhora = estaAbierto(enUso, new Date(ahora), zona || 'America/Bogota');

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
      const aGuardar = conHorario ? franjas : [];
      await api('/tenants/me', {
        method: 'PATCH',
        body: JSON.stringify({ deliveryHours: aGuardar }),
      });
      toast(
        aGuardar.length
          ? 'Horario guardado'
          : 'Listo: recibes pedidos a cualquier hora',
        'success',
      );
      onSaved?.(aGuardar);
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
        Cuándo puede un cliente hacerte un pedido a domicilio. Fuera de ese
        horario verá que no estás recibiendo y cuándo volver, en vez de armar un
        pedido que nadie va a atender.
      </p>

      {/* El interruptor dice en voz alta lo que pasa en cada caso. */}
      <div className="flex flex-col gap-2 mt-4">
        {[
          [false, 'Recibo pedidos a cualquier hora', 'El menú nunca se bloquea.'],
          [true, 'Solo en ciertos horarios', 'Fuera de ellos no se puede pedir.'],
        ].map(([valor, titulo, sub]) => (
          <label
            key={String(valor)}
            className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer ${
              conHorario === valor ? 'border-brand bg-brand-soft' : 'border-line'
            }`}
          >
            <input
              type="radio"
              className="mt-0.5"
              checked={conHorario === valor}
              onChange={() => {
                setConHorario(valor as boolean);
                // Al activarlo sin nada puesto, se arranca con algo usable en
                // vez de una lista vacía que no dice qué hacer.
                if (valor && franjas.length === 0) setFranjas(ATAJOS[0].franjas);
              }}
            />
            <span>
              <span className="text-sm font-semibold block">{titulo as string}</span>
              <span className="text-xs text-mute">{sub as string}</span>
            </span>
          </label>
        ))}
      </div>

      {conHorario && (
        <>
          <div className="mt-4">
            <div className="text-[11px] uppercase tracking-wider text-mute font-semibold mb-2">
              Atajos
            </div>
            <div className="flex flex-wrap gap-2">
              {ATAJOS.map((a) => (
                <button
                  key={a.etiqueta}
                  type="button"
                  className="btn-ghost rounded-pill text-xs"
                  onClick={() => setFranjas(a.franjas.map((f) => ({ ...f })))}
                >
                  {a.etiqueta}
                </button>
              ))}
            </div>
          </div>

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
                      aria-label={NOMBRE_DIA[d.n]}
                      className={`w-8 h-8 rounded-pill text-xs font-bold ${
                        f.dias.includes(d.n) ? 'bg-brand text-white' : 'bg-bg2 text-mute'
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
                    aria-label="Desde"
                    className="input py-1.5 w-32"
                    value={f.desde}
                    onChange={(e) => cambiar(i, { desde: e.target.value })}
                  />
                  <span className="text-xs text-mute">a</span>
                  <input
                    type="time"
                    aria-label="Hasta"
                    className="input py-1.5 w-32"
                    value={f.hasta}
                    onChange={(e) => cambiar(i, { hasta: e.target.value })}
                  />
                  {franjas.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setFranjas((p) => p.filter((_, j) => j !== i))}
                      className="text-xs text-red-600 font-semibold ml-auto hover:underline"
                    >
                      Quitar
                    </button>
                  )}
                </div>
                {/* En español, que es como se comprueba que dice lo que quieres. */}
                <p className="text-[11px] text-mute mt-2 mb-0">
                  {franjaEnPalabras(f) ?? 'Revisa las horas de esta franja.'}
                </p>
              </div>
            ))}
          </div>

          <button
            type="button"
            className="btn-ghost rounded-pill text-sm mt-3"
            onClick={() =>
              setFranjas((p) => [...p, { dias: TODOS, desde: '18:00', hasta: '22:00' }])
            }
          >
            + Otra franja
          </button>

          {/* El error caro, dicho por su nombre. */}
          {huecos.length > 0 && (
            <div className="mt-4 rounded-lg border border-warn bg-warn-soft p-3">
              <div className="text-xs font-semibold text-warn-ink mb-1">
                No vas a recibir pedidos {huecos.length === 1 ? 'el' : 'los'}{' '}
                {huecos.map((d) => NOMBRE_DIA[d]).join(', ')}
              </div>
              <p className="text-xs text-mute m-0">
                Esos días el menú de domicilios estará bloqueado todo el día. Si no
                es lo que quieres, marca esos días en alguna franja.
              </p>
            </div>
          )}
        </>
      )}

      <div className="flex items-center gap-3 mt-4">
        <span
          className={`text-xs font-semibold px-2.5 py-1 rounded-pill ${
            abiertoAhora ? 'bg-ok-soft text-ok' : 'bg-bad-soft text-bad-ink'
          }`}
        >
          {abiertoAhora ? 'Ahora mismo: recibiendo' : 'Ahora mismo: bloqueado'}
        </span>
        <button
          type="button"
          className="btn-primary rounded-pill text-sm ml-auto"
          disabled={guardando}
          onClick={guardar}
        >
          {guardando ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </div>
  );
}
