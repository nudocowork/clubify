'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
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
  const [creando, setCreando] = useState(false);
  const [form, setForm] = useState({
    name: '',
    verificacion: 'CODIGO' as Fila['verificacion'],
    contactName: '',
    contactEmail: '',
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
    try {
      const nuevo = await api<Fila>('/convenios', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      toast('Alianza creada', 'success');
      setCreando(false);
      setForm({ name: '', verificacion: 'CODIGO', contactName: '', contactEmail: '' });
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
              placeholder="Confenalco, Altieri…"
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
                <p className="text-xs text-mute mt-0.5">
                  {c.tarjetas} {c.tarjetas === 1 ? 'empleado' : 'empleados'} ·{' '}
                  {c.cuponesEncendidos} de {c.cupones}{' '}
                  {c.cupones === 1 ? 'beneficio activo' : 'beneficios activos'} ·{' '}
                  {c.canjesDelMes} este mes
                </p>
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
