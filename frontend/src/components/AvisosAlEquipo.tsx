'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { toast } from '@/components/Toast';

/**
 * «Avisos al equipo»: quién del equipo recibe qué SMS interno (Setting
 * `prereg.alertPhones`). Antes solo se cambiaba a mano en la base.
 *
 * Existe por el pedido de Javier (2026-09-22): el equipo de implementación
 * (Samuel) tiene que enterarse cuando un cliente pagó y no se registra, y el
 * número tiene que poder cambiarse desde Clubify.
 *
 * Pantalla interna de la plataforma (Integraciones SMS, solo Clubify): los
 * textos van en español, igual que los SMS que describe.
 */

type Tipo = string;

type Persona = { name: string; phone: string; solo?: Tipo[] };

/**
 * Nombres para pintar. El UNIVERSO de tipos no sale de aquí sino del servidor
 * (`tipos` del GET): backend y frontend se despliegan por separado, y con una
 * lista local vieja, desmarcar uno a quien «recibe todos» guardaría un `solo`
 * sin el tipo nuevo y esa persona dejaría de recibirlo sin enterarse.
 */
const NOMBRES: Array<{ id: Tipo; label: string; desc: string }> = [
  {
    id: 'implementacion',
    label: 'Implementación',
    desc: 'Cliente que pagó y no se registra: a los 30 min y a las 24 h, con su nombre, teléfono y enlace de activación.',
  },
  { id: 'pago_sin_cuenta', label: 'Pago sin cuenta', desc: 'En el momento en que alguien paga sin tener cuenta.' },
  { id: 'preregistro', label: 'Nuevo registro', desc: 'Alguien se registró.' },
  { id: 'nueva_compra', label: 'Nueva compra', desc: 'Alta nueva ya activada.' },
  { id: 'trial', label: 'Pruebas', desc: 'Pruebas gratuitas a punto de vencer.' },
  { id: 'lab', label: 'Lab', desc: 'Cambios de estado en el Lab.' },
  {
    id: 'infraestructura',
    label: 'Infraestructura',
    desc: 'La base de datos llenándose. Solo cuando sube de nivel, no todos los días.',
  },
];

export function AvisosAlEquipo() {
  const [personas, setPersonas] = useState<Persona[] | null>(null);
  const [tipos, setTipos] = useState<Array<{ id: Tipo; label: string; desc: string }>>(NOMBRES);
  const [oculta, setOculta] = useState(false);
  const [deFabrica, setDeFabrica] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [cambios, setCambios] = useState(false);

  useEffect(() => {
    api<{ personas: Persona[]; tipos: Tipo[]; deFabrica: boolean }>('/admin/avisos-al-equipo')
      .then((r) => {
        setPersonas(r.personas);
        setDeFabrica(r.deFabrica);
        if (Array.isArray(r.tipos) && r.tipos.length) {
          setTipos(
            r.tipos.map(
              (id) => NOMBRES.find((n) => n.id === id) ?? { id, label: id, desc: '' },
            ),
          );
        }
      })
      .catch((e: any) => {
        // Marketing entra a Integraciones SMS pero estos teléfonos son solo
        // de la plataforma: sin permiso, la sección no se enseña.
        if (e?.status === 403) {
          setOculta(true);
          return;
        }
        setPersonas([]);
        toast(e?.message || 'No se pudo cargar la lista de avisos.', 'error');
      });
  }, []);

  function cambiar(i: number, parche: Partial<Persona>) {
    setPersonas((ps) => (ps ?? []).map((p, j) => (j === i ? { ...p, ...parche } : p)));
    setCambios(true);
  }

  function alternarTipo(i: number, tipo: Tipo) {
    const p = personas![i];
    // Sin `solo` = recibe todos. Al desmarcar uno partimos de «todos menos ese».
    const actuales = p.solo ?? tipos.map((t) => t.id);
    const nuevos = actuales.includes(tipo)
      ? actuales.filter((t) => t !== tipo)
      : [...actuales, tipo];
    cambiar(i, {
      // «Todos» solo si están marcados TODOS los que conoce el servidor.
      solo: tipos.every((t) => nuevos.includes(t.id)) ? undefined : nuevos,
    });
  }

  async function guardar() {
    if (!personas) return;
    setGuardando(true);
    try {
      const r = await api<{ personas: Persona[]; deFabrica: boolean }>(
        '/admin/avisos-al-equipo',
        { method: 'PUT', body: JSON.stringify({ personas }) },
      );
      setPersonas(r.personas);
      setDeFabrica(r.deFabrica);
      setCambios(false);
      toast('Avisos al equipo guardados', 'success');
    } catch (e: any) {
      toast(e?.message || 'No se pudo guardar.', 'error');
    } finally {
      setGuardando(false);
    }
  }

  if (oculta) return null;

  return (
    <section className="mt-8">
      <div className="flex items-end justify-between gap-3 flex-wrap mb-2">
        <div>
          <h2 className="text-lg font-bold m-0">Avisos al equipo</h2>
          <p className="text-sm text-mute mt-1 mb-0 max-w-2xl leading-relaxed">
            Quién del equipo recibe cada SMS interno. Para el seguimiento de clientes
            que pagaron y no se registran, marca <b>Implementación</b>.
          </p>
        </div>
        <button
          className="btn-primary"
          onClick={guardar}
          disabled={guardando || !cambios || !personas}
        >
          {guardando ? 'Guardando…' : 'Guardar'}
        </button>
      </div>

      {deFabrica && (
        <div className="card card-pad mb-3 text-sm text-mute">
          Todavía no hay una lista guardada: los avisos van a los teléfonos de fábrica.
          Guarda una para decidir tú quién los recibe.
        </div>
      )}

      {personas === null && <div className="text-mute">Cargando…</div>}

      {personas && (
        <div className="space-y-3">
          {personas.map((p, i) => {
            const todos = !p.solo;
            return (
              <div key={i} className="card card-pad">
                <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] items-end">
                  <div>
                    <label className="label" htmlFor={`aviso-nombre-${i}`}>Nombre</label>
                    <input
                      id={`aviso-nombre-${i}`}
                      className="input"
                      value={p.name}
                      maxLength={60}
                      onChange={(e) => cambiar(i, { name: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="label" htmlFor={`aviso-tel-${i}`}>Teléfono</label>
                    <input
                      id={`aviso-tel-${i}`}
                      className="input font-mono"
                      inputMode="tel"
                      placeholder="+573001234567"
                      value={p.phone}
                      onChange={(e) => cambiar(i, { phone: e.target.value })}
                    />
                  </div>
                  <button
                    className="btn-ghost text-xs text-bad"
                    onClick={() => {
                      setPersonas((ps) => (ps ?? []).filter((_, j) => j !== i));
                      setCambios(true);
                    }}
                  >
                    Quitar
                  </button>
                </div>

                <div className="mt-3">
                  <div className="text-xs text-mute mb-1.5">
                    {todos ? 'Recibe todos los avisos' : 'Recibe solo:'}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {tipos.map((t) => {
                      const marcado = todos || p.solo!.includes(t.id);
                      return (
                        <button
                          key={t.id}
                          type="button"
                          title={t.desc}
                          aria-pressed={marcado}
                          onClick={() => alternarTipo(i, t.id)}
                          className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition ${
                            marcado
                              ? 'bg-brand/10 border-brand text-brand'
                              : 'bg-white border-line text-mute hover:text-ink'
                          }`}
                        >
                          {marcado ? '✓ ' : ''}
                          {t.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}

          <button
            className="btn-ghost text-sm"
            onClick={() => {
              setPersonas((ps) => [...(ps ?? []), { name: '', phone: '', solo: ['implementacion'] }]);
              setCambios(true);
            }}
          >
            <Icon name="plus" /> Añadir persona
          </button>
        </div>
      )}
    </section>
  );
}
