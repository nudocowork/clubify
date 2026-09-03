'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { toast } from '@/components/Toast';

type Fila = {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  status: 'ACTIVE' | 'PAUSED' | 'FINISHED';
  verificacion: 'ABIERTO' | 'CODIGO' | 'LISTA';
  codigo: string | null;
  endsAt: string | null;
  tarjetas: number;
  cupones: number;
  cuponesEncendidos: number;
  canjesDelMes: number;
};

type Respuesta = {
  habilitado: boolean;
  tope: number;
  cupoLibre: number;
  convenios: Fila[];
};

/**
 * Alianzas: convenios con empresas para que SUS empleados tengan beneficios
 * en el local.
 *
 * Es un estilo de tarjeta propio, no un tipo más dentro del asistente de
 * tarjetas. Meter tipos ahí ya salió mal antes —un DISCOUNT que se pintaba como
 * sellos y al canjear no hacía nada—, y una alianza no se parece a una tarjeta
 * de sellos en nada: no acumula, la paga nadie, y quien decide quién la tiene
 * es una empresa de fuera.
 */
export default function AlianzasPage() {
  const [data, setData] = useState<Respuesta | null>(null);
  // `?nueva=1` abre el formulario de una: es por donde entra quien viene del
  // asistente de tarjetas («Nueva tarjeta → Alianza»), y llegar a una lista sin
  // nada abierto haría pensar que el botón no hizo nada.
  const abrirDeEntrada = useSearchParams().get('nueva') === '1';
  const [creando, setCreando] = useState(abrirDeEntrada);
  const [form, setForm] = useState({
    name: '',
    verificacion: 'CODIGO' as Fila['verificacion'],
    contactName: '',
    contactEmail: '',
    // Vigencia. ILIMITADA por defecto porque es lo que ya pasaba de hecho —
    // hasta ahora el alta ni preguntaba la fecha— y porque una fecha inventada
    // por defecto apagaría el descuento en la cara de un empleado sin que nadie
    // la hubiera elegido.
    vigencia: 'ILIMITADA' as 'ILIMITADA' | 'FECHA',
    endsAt: '',
    // Primer beneficio. Va en el mismo alta a propósito: una alianza sin
    // ningún beneficio no deja activar a nadie, así que crearla sola dejaría
    // un enlace que no funciona.
    bNombre: '',
    bTipo: 'PERCENT_OFF' as 'PERCENT_OFF' | 'AMOUNT_OFF' | 'FREEBIE' | 'TWO_FOR_ONE' | 'OTHER',
    bValor: '15',
    bMax: '',
    bPeriodo: 'SIEMPRE' as 'SIEMPRE' | 'DIA' | 'SEMANA' | 'MES' | 'ANIO',
  });

  async function cargar() {
    try {
      setData(await api('/convenios'));
    } catch (e: any) {
      toast(e.message || 'No pudimos cargar las alianzas', 'error');
    }
  }
  useEffect(() => {
    cargar();
  }, []);

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    // Una fecha ya pasada apagaría la alianza en el mismo momento de crearla.
    // Es casi siempre un dedazo, así que se pregunta antes de dejarlo pasar.
    if (form.vigencia === 'FECHA' && form.endsAt && new Date(form.endsAt) < new Date()) {
      if (!confirm('Esa fecha ya pasó: la alianza nacería vencida y nadie podría activarla. ¿Seguro?')) {
        return;
      }
    }
    try {
      const nuevo = await api<Fila>('/convenios', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name,
          verificacion: form.verificacion,
          contactName: form.contactName || undefined,
          contactEmail: form.contactEmail || undefined,
          // null explícito, no omitido: en el backend `undefined` significa «no
          // tocar» y `null` significa «sin fecha de fin».
          endsAt: form.vigencia === 'FECHA' && form.endsAt ? form.endsAt : null,
          beneficio: form.bNombre.trim()
            ? {
                name: form.bNombre.trim(),
                tipo: form.bTipo,
                valor: Number(form.bValor) || 0,
                maxPorPersona: form.bMax ? Number(form.bMax) : undefined,
                periodo: form.bMax ? form.bPeriodo : 'SIEMPRE',
              }
            : undefined,
        }),
      });
      toast('Alianza creada', 'success');
      setCreando(false);
      await cargar();
      window.location.href = `/app/alianzas/${nuevo.id}`;
    } catch (e: any) {
      toast(e.message || 'No pudimos crearla', 'error');
    }
  }

  if (!data) return <div className="card card-pad animate-shimmer h-40" />;

  // El módulo se enciende negocio por negocio desde el panel de admin. Sin
  // instrucciones internas al dueño: si no lo tiene, se le dice a quién pedirlo.
  if (!data.habilitado) {
    return (
      <div className="card card-pad text-center py-12 max-w-2xl mx-auto">
        <Icon name="users" className="mx-auto mb-3 opacity-40" />
        <h1 className="text-lg font-semibold">Alianzas con empresas</h1>
        <p className="mt-2 text-sm text-mute max-w-md mx-auto">
          Pacta un convenio con una empresa y sus empleados reciben un beneficio
          permanente en tu local: un porcentaje de descuento, una bebida con el
          almuerzo, un 2x1. Cada empresa recibe su propio enlace para repartir
          entre su gente.
        </p>
        <p className="mt-4 text-sm text-mute">
          Escríbenos y te lo activamos.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Alianzas con empresas</h1>
          <p className="mt-1 text-sm text-mute">
            Sus empleados reciben beneficios en tu local. Cada empresa tiene un
            enlace propio para repartir.
          </p>
        </div>
        {data.cupoLibre > 0 && !creando && (
          <button className="btn btn-primary shrink-0" onClick={() => setCreando(true)}>
            Nueva alianza
          </button>
        )}
      </header>

      {data.cupoLibre === 0 && (
        <p className="mt-4 rounded-input bg-bg2 px-4 py-3 text-sm text-mute">
          Tienes las {data.tope} alianzas que puedes tener a la vez. Cierra una o
          escríbenos para ampliar el límite.
        </p>
      )}

      {creando && (
        <form onSubmit={crear} className="card card-pad mt-4 grid gap-3">
          <div>
            <label className="label">Nombre de la empresa</label>
            <input
              className="input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Nombre de la empresa aliada"
              required
            />
          </div>
          <div>
            <label className="label">¿Cómo compruebas que alguien trabaja ahí?</label>
            <select
              className="input"
              value={form.verificacion}
              onChange={(e) =>
                setForm({ ...form, verificacion: e.target.value as Fila['verificacion'] })
              }
            >
              <option value="CODIGO">Con un código que reparte la empresa</option>
              <option value="LISTA">Solo quien esté en la lista que cargues</option>
              <option value="ABIERTO">Cualquiera con el enlace</option>
            </select>
            {form.verificacion === 'ABIERTO' && (
              <p className="mt-1 text-[11px] leading-snug text-amber-700">
                Cuidado: con esta opción, cualquiera que reciba el enlace obtiene
                el beneficio, trabaje o no en la empresa.
              </p>
            )}
          </div>
          <hr className="border-line" />

          <div>
            <label className="label">El beneficio</label>
            <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
              <input
                className="input"
                value={form.bNombre}
                onChange={(e) => setForm({ ...form, bNombre: e.target.value })}
                placeholder="Almuerzo ejecutivo, Bebida…"
              />
              <select
                className="input"
                value={form.bTipo}
                onChange={(e) =>
                  setForm({ ...form, bTipo: e.target.value as typeof form.bTipo })
                }
              >
                <option value="PERCENT_OFF">% de descuento</option>
                <option value="AMOUNT_OFF">Descuento en dinero</option>
                <option value="FREEBIE">Gratis</option>
                <option value="TWO_FOR_ONE">2x1</option>
                <option value="OTHER">Otro</option>
              </select>
              {(form.bTipo === 'PERCENT_OFF' || form.bTipo === 'AMOUNT_OFF') && (
                <input
                  className="input sm:w-28"
                  type="number"
                  min={1}
                  value={form.bValor}
                  onChange={(e) => setForm({ ...form, bValor: e.target.value })}
                />
              )}
            </div>
            <p className="mt-1 text-[11px] leading-snug text-mute">
              Puedes añadir más beneficios después. Sin ninguno, el enlace no
              deja activar a nadie.
            </p>
          </div>

          <div>
            <label className="label">¿Cuántas veces puede usarlo cada persona?</label>
            <div className="flex gap-2">
              <input
                className="input"
                type="number"
                min={1}
                placeholder="Sin tope"
                value={form.bMax}
                onChange={(e) => setForm({ ...form, bMax: e.target.value })}
              />
              <select
                className="input"
                disabled={!form.bMax}
                value={form.bPeriodo}
                onChange={(e) =>
                  setForm({ ...form, bPeriodo: e.target.value as typeof form.bPeriodo })
                }
              >
                <option value="SIEMPRE">en total</option>
                <option value="DIA">al día</option>
                <option value="SEMANA">a la semana</option>
                <option value="MES">al mes</option>
                <option value="ANIO">al año</option>
              </select>
            </div>
          </div>

          <hr className="border-line" />

          <div>
            <label className="label">Hasta cuándo dura</label>
            <div className="flex gap-2">
              {(
                [
                  ['ILIMITADA', 'Ilimitada'],
                  ['FECHA', 'Hasta una fecha'],
                ] as const
              ).map(([v, t]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setForm({ ...form, vigencia: v })}
                  className={`rounded-input px-3 py-2 text-sm transition ${
                    form.vigencia === v
                      ? 'bg-fg font-semibold text-bg1'
                      : 'border border-line text-mute'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
            {form.vigencia === 'FECHA' ? (
              <input
                className="input mt-2"
                type="date"
                value={form.endsAt}
                onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
              />
            ) : (
              <p className="mt-2 text-[11px] leading-snug text-mute">
                No caduca: seguirá activa hasta que la pauses o la finalices.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Contacto en la empresa (opcional)</label>
              <input
                className="input"
                value={form.contactName}
                onChange={(e) => setForm({ ...form, contactName: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Su correo (opcional)</label>
              <input
                className="input"
                type="email"
                value={form.contactEmail}
                onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button className="btn btn-primary" type="submit">
              Crear alianza
            </button>
            <button className="btn" type="button" onClick={() => setCreando(false)}>
              Cancelar
            </button>
          </div>
        </form>
      )}

      <ul className="mt-4 grid gap-3">
        {data.convenios.map((c) => (
          <li key={c.id}>
            <Link
              href={`/app/alianzas/${c.id}`}
              className="card card-pad flex items-center gap-4 hover:shadow-md transition"
            >
              {c.logoUrl ? (
                <img
                  src={c.logoUrl}
                  alt=""
                  className="h-11 w-11 rounded-input object-contain shrink-0"
                />
              ) : (
                <div className="h-11 w-11 rounded-input bg-bg2 shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <p className="font-medium truncate">{c.name}</p>
                {c.cupones === 0 ? (
                  // Una alianza sin beneficios está viva pero es inerte: su
                  // enlace responde «aún no está disponible». Sin decirlo aquí
                  // se queda olvidada creyéndose activa.
                  <p className="text-xs text-amber-700 mt-0.5">
                    Sin beneficios aún — nadie puede activarla
                  </p>
                ) : (
                  <p className="text-xs text-mute mt-0.5">
                    {c.tarjetas} {c.tarjetas === 1 ? 'empleado' : 'empleados'} ·{' '}
                    {c.cuponesEncendidos} de {c.cupones}{' '}
                    {c.cupones === 1 ? 'beneficio activo' : 'beneficios activos'} ·{' '}
                    {c.canjesDelMes} este mes
                  </p>
                )}
              </div>
              <EtiquetaEstado status={c.status} endsAt={c.endsAt} />
            </Link>
          </li>
        ))}
        {data.convenios.length === 0 && !creando && (
          <li className="card card-pad text-center py-10 text-sm text-mute">
            Todavía no tienes alianzas.
          </li>
        )}
      </ul>
    </div>
  );
}

function EtiquetaEstado({
  status,
  endsAt,
}: {
  status: Fila['status'];
  endsAt: string | null;
}) {
  // Vencido por fecha es DISTINTO de finalizado: se arregla extendiendo la
  // fecha, mientras que finalizado no tiene vuelta atrás.
  const vencido = !!endsAt && new Date(endsAt) <= new Date();
  const texto =
    status === 'FINISHED'
      ? 'Finalizada'
      : status === 'PAUSED'
        ? 'En pausa'
        : vencido
          ? 'Venció'
          : 'Activa';
  const color =
    texto === 'Activa'
      ? 'bg-emerald-100 text-emerald-800'
      : 'bg-bg2 text-mute';
  return (
    <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ${color}`}>
      {texto}
    </span>
  );
}
