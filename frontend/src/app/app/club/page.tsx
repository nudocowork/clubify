'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { toast } from '@/components/Toast';
import { plural } from '@/lib/plural';

type Tramo = { desdeDia: number; hastaDia: number; beneficios: number };

type Plan = {
  id: string;
  name: string;
  slug: string;
  description: string;
  beneficiosPorMes: number;
  unidad: string;
  precioCents: number;
  periodicidad?: string;
  currency: string;
  isActive: boolean;
  tramos: Tramo[];
  miembrosActivos: number;
  miembrosPausados: number;
};

type Borrador = {
  id?: string;
  name: string;
  unidad: string;
  beneficiosPorMes: number;
  precio: number;
  periodicidad: 'MENSUAL' | 'ANUAL';
  description: string;
  tramos: Tramo[];
  isActive: boolean;
};

const NUEVO: Borrador = {
  name: '',
  unidad: 'café',
  beneficiosPorMes: 10,
  precio: 0,
  periodicidad: 'MENSUAL',
  description: '',
  tramos: [],
  isActive: true,
};

/**
 * En COP no hay decimales, así que la unidad menor SON los pesos y el campo
 * del formulario se guarda tal cual. Si algún día entra una moneda con
 * céntimos hay que multiplicar aquí, no en el backend.
 */
function precioLegible(cents: number, moneda: string) {
  if (!cents) return 'Sin precio';
  return `$${cents.toLocaleString('es-CO')} ${moneda}`;
}

/**
 * «al mes» o «al año». El mismo número significa cosas muy distintas y el
 * negocio tiene varios planes a la vista a la vez: sin esto, un anual de 600.000
 * al lado de un mensual de 60.000 se lee como diez veces más caro.
 */
function cadaCuanto(periodicidad?: string) {
  return periodicidad === 'ANUAL' ? 'al año' : 'al mes';
}

export default function ClubPage() {
  const [planes, setPlanes] = useState<Plan[]>([]);
  const [cargando, setCargando] = useState(true);
  const [habilitado, setHabilitado] = useState<boolean | null>(null);
  // Distinto de «apagado»: es «no pudimos preguntarlo». Ver el early-return.
  const [falloAlPreguntar, setFalloAlPreguntar] = useState(false);
  const [borrador, setBorrador] = useState<Borrador | null>(null);

  async function cargar() {
    try {
      setPlanes(await api('/club/planes'));
    } catch (e: any) {
      toast(e.message || 'No se pudieron cargar los planes.', 'error');
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    // Se pregunta ANTES de pintar el formulario. Sin esto, el negocio que llega
    // por el asistente rellenaba el plan entero y solo al pulsar «Crear» se
    // enteraba, con un 403, de que el módulo no está encendido para él.
    // Un fallo al preguntar NO es un «no». Antes se caía a `false` y al negocio
    // se le decía que su módulo no está activo cuando lo que pasaba era que el
    // backend no respondía —con el módulo encendido y todo—. Mandarle a
    // escribirnos por un error nuestro es hacerle perder el tiempo a él.
    api('/club/estado')
      .then((r) => {
        setHabilitado(Boolean(r?.habilitado));
        setFalloAlPreguntar(false);
      })
      .catch(() => setFalloAlPreguntar(true));
    cargar();
    // El asistente de tarjetas llega aquí con `?nuevo=1` y espera encontrar el
    // formulario ya abierto: quien acaba de elegir «Tarjeta de club» no debería
    // tener que pulsar «Nuevo plan» otra vez. Se lee de `window` y no con
    // `useSearchParams` para no obligar a envolver la página en un Suspense.
    if (typeof window !== 'undefined') {
      const p = new URLSearchParams(window.location.search);
      if (p.get('nuevo')) setBorrador({ ...NUEVO });
    }
  }, []);

  // No se pudo preguntar. Se dice eso y se ofrece reintentar, en vez de
  // afirmar algo que no sabemos.
  if (falloAlPreguntar) {
    return (
      <div>
        <div className="page-head">
          <h1 className="page-title">Tarjeta de Club</h1>
        </div>
        <div className="card card-pad text-center py-12">
          <div className="font-semibold">No pudimos cargar esta sección</div>
          <p className="text-sm text-mute mt-1.5 max-w-md mx-auto">
            Puede ser algo momentáneo de nuestro lado. Vuelve a intentarlo en un
            minuto; si sigue igual, escríbenos.
          </p>
          <button
            className="btn-primary mt-4 inline-flex"
            onClick={() => window.location.reload()}
          >
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  // El módulo no está encendido para este negocio. No se le enseña ningún
  // formulario: se le dice qué es y a quién pedírselo. Nada de rutas internas
  // del panel de administración — quien lee esto es el negocio.
  if (habilitado === false) {
    return (
      <div>
        <div className="page-head">
          <h1 className="page-title">Tarjeta de Club</h1>
        </div>
        <div className="card card-pad text-center py-12">
          <div className="text-4xl mb-2">🎟️</div>
          <div className="font-semibold">
            La Tarjeta de Club todavía no está activa en tu cuenta
          </div>
          <p className="text-sm text-mute mt-1.5 max-w-lg mx-auto">
            Es una suscripción que tu cliente te paga a ti: cada mes recibe un
            cupo de beneficios —diez cafés, cuatro lavadas, ocho clases— que
            gasta en tu local y que vuelve a llenarse el día 1, los haya usado o
            no. Tú cobras por tu medio de siempre y activas o pausas a cada
            socio a mano.
          </p>
          <p className="text-sm text-mute mt-3">
            Escríbenos y te la activamos.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          Tarjeta de Club{' '}
          <span className="page-crumb">
            {planes.length === 1 ? '1 plan' : `${planes.length} planes`}
          </span>
        </h1>
        {habilitado === true && planes.length > 0 && !borrador && (
          <button className="btn-primary" onClick={() => setBorrador({ ...NUEVO })}>
            <Icon name="plus" /> Nuevo plan
          </button>
        )}
      </div>

      {habilitado === true && borrador && (
        <FormularioPlan
          // La `key` fuerza un montaje nuevo al cambiar de plan. Sin ella, el
          // estado interno se quedaba con el PRIMER plan que se abrió: pulsar
          // «Editar» en otro sin cancelar antes guardaba encima del anterior
          // —y repintaba los pases de todos SUS socios.
          key={borrador.id ?? 'nuevo'}
          valor={borrador}
          onCancelar={() => setBorrador(null)}
          onGuardado={() => {
            setBorrador(null);
            cargar();
          }}
        />
      )}

      {/* Hasta que `/club/estado` responde no se sabe si el módulo está
          encendido: pintar el listado vacío y el botón mientras tanto le
          enseñaba medio segundo un panel que no es suyo. */}
      {habilitado === true && !cargando && planes.length === 0 && !borrador && (
        <div className="card card-pad text-center py-12">
          <div className="text-4xl mb-2">🎟️</div>
          <div className="font-semibold">Todavía no tienes ningún plan de club</div>
          <p className="text-sm text-mute mt-1.5 max-w-lg mx-auto">
            Un plan de club es una suscripción que tu cliente te paga a ti. A
            cambio recibe un cupo de beneficios cada mes —diez cafés, cuatro
            lavadas, ocho clases— que va gastando en el local y que vuelve a
            llenarse el día 1, los haya usado o no.
          </p>
          <button
            className="btn-primary mt-4 inline-flex"
            onClick={() => setBorrador({ ...NUEVO })}
          >
            <Icon name="plus" /> Crear el primer plan
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
        {planes.map((p) => (
          <div key={p.id} className="card card-pad">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-semibold truncate">{p.name}</div>
                <div className="text-xs text-mute mt-0.5">
                  {precioLegible(p.precioCents, p.currency)}{' '}
                  {cadaCuanto(p.periodicidad)}
                </div>
              </div>
              <span className={`badge ${p.isActive ? 'badge-ok' : 'badge-mute'} shrink-0`}>
                {p.isActive ? 'Activo' : 'Apagado'}
              </span>
            </div>

            <div className="mt-3 flex items-baseline gap-1.5">
              <strong className="text-2xl tabular-nums">{p.beneficiosPorMes}</strong>
              <span className="text-sm text-mute">
                {plural(p.unidad, p.beneficiosPorMes)} al mes
              </span>
            </div>

            {p.description && (
              <p className="text-xs text-mute mt-2 line-clamp-2">{p.description}</p>
            )}

            {p.tramos.length > 0 && (
              <p className="text-xs text-mute mt-2">
                {p.tramos.length === 1
                  ? '1 tramo de alta configurado'
                  : `${p.tramos.length} tramos de alta configurados`}
              </p>
            )}

            <div className="mt-3 pt-3 border-t border-line flex items-center gap-3 text-xs">
              <span className="text-ink font-medium tabular-nums">
                {p.miembrosActivos} {p.miembrosActivos === 1 ? 'socio' : 'socios'}
              </span>
              {p.miembrosPausados > 0 && (
                <span className="text-mute tabular-nums">
                  {p.miembrosPausados} en pausa
                </span>
              )}
            </div>

            <div className="mt-3 flex gap-2">
              <Link href={`/app/club/${p.id}`} className="btn-ghost flex-1 justify-center">
                Ver socios
              </Link>
              <button
                className="btn-ghost"
                onClick={() =>
                  setBorrador({
                    id: p.id,
                    name: p.name,
                    unidad: p.unidad,
                    beneficiosPorMes: p.beneficiosPorMes,
                    precio: p.precioCents,
                    periodicidad:
                      p.periodicidad === 'ANUAL' ? 'ANUAL' : 'MENSUAL',
                    description: p.description,
                    // Solo los tres campos. Las filas que devuelve el
                    // backend traen además `id` y `planId`, y el
                    // `ValidationPipe` global corre con `forbidNonWhitelisted`:
                    // mandarlas enteras devolvía un 400 y dejaba el plan
                    // inmutable en cuanto tenía un tramo.
                    tramos: p.tramos.map((t) => ({
                      desdeDia: t.desdeDia,
                      hastaDia: t.hastaDia,
                      beneficios: t.beneficios,
                    })),
                    isActive: p.isActive,
                  })
                }
              >
                <Icon name="edit" /> Editar
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════

function FormularioPlan({
  valor,
  onCancelar,
  onGuardado,
}: {
  valor: Borrador;
  onCancelar: () => void;
  onGuardado: () => void;
}) {
  const [f, setF] = useState<Borrador>(valor);
  const [guardando, setGuardando] = useState(false);
  const editando = Boolean(f.id);

  function set<K extends keyof Borrador>(k: K, v: Borrador[K]) {
    setF((x) => ({ ...x, [k]: v }));
  }

  async function guardar() {
    if (!f.name.trim()) {
      toast('Ponle nombre al plan.', 'error');
      return;
    }
    if (!f.unidad.trim()) {
      toast('Escribe qué recibe el cliente: café, clase, lavada…', 'error');
      return;
    }
    if (!Number.isInteger(f.beneficiosPorMes) || f.beneficiosPorMes < 1) {
      toast('El cupo del mes tiene que ser 1 o más.', 'error');
      return;
    }
    // Los tramos se revisan aquí y no solo en el backend porque el suyo
    // responde en inglés y con el nombre interno del campo: borrar la casilla
    // de un día deja un 0 —`Number('')` es 0, no NaN— y el negocio veía
    // «desdeDia must not be less than 1» sin saber a qué se refiere.
    const malo = f.tramos.find(
      (t) =>
        !Number.isInteger(t.desdeDia) ||
        !Number.isInteger(t.hastaDia) ||
        t.desdeDia < 1 ||
        t.hastaDia > 31,
    );
    if (malo) {
      toast('En los tramos, los días van del 1 al 31.', 'error');
      return;
    }
    const cuerpo = {
      name: f.name.trim(),
      unidad: f.unidad.trim(),
      beneficiosPorMes: f.beneficiosPorMes,
      precioCents: Math.max(0, Math.round(f.precio || 0)),
      periodicidad: f.periodicidad,
      description: f.description.trim(),
      tramos: f.tramos,
      ...(editando ? { isActive: f.isActive } : {}),
    };
    setGuardando(true);
    try {
      if (editando) {
        await api(`/club/planes/${f.id}`, {
          method: 'PATCH',
          body: JSON.stringify(cuerpo),
        });
        toast('Plan actualizado.', 'success');
      } else {
        await api('/club/planes', { method: 'POST', body: JSON.stringify(cuerpo) });
        toast('Plan creado. Ya puedes dar de alta a tus socios.', 'success');
      }
      onGuardado();
    } catch (e: any) {
      toast(e.message || 'No se pudo guardar el plan.', 'error');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="card card-pad mb-4">
      <h2 className="text-base font-semibold m-0">
        {editando ? 'Editar el plan' : 'Nuevo plan de club'}
      </h2>
      <p className="text-xs text-mute mt-1">
        El cobro lo llevas tú por fuera. Aquí solo defines qué recibe el socio
        cada mes; después lo das de alta y lo pausas si deja de pagarte.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
        <div>
          <label className="label">Nombre del plan</label>
          <input
            className="input"
            value={f.name}
            maxLength={80}
            placeholder="Club del café"
            onChange={(e) => set('name', e.target.value)}
          />
        </div>

        <div>
          <label className="label">
            Precio de la suscripción ({cadaCuanto(f.periodicidad)})
          </label>
          <div className="flex gap-2">
            <input
              className="input flex-1 min-w-0"
              type="number"
              min={0}
              value={f.precio || ''}
              placeholder={f.periodicidad === 'ANUAL' ? '600000' : '60000'}
              onChange={(e) => set('precio', Number(e.target.value))}
            />
            <select
              className="input w-32 flex-none"
              value={f.periodicidad}
              onChange={(e) =>
                set(
                  'periodicidad',
                  e.target.value === 'ANUAL' ? 'ANUAL' : 'MENSUAL',
                )
              }
            >
              <option value="MENSUAL">Al mes</option>
              <option value="ANUAL">Al año</option>
            </select>
          </div>
          <p className="text-xs text-mute mt-1">
            Solo para tu referencia: el cobro no pasa por aquí.{' '}
            {f.periodicidad === 'ANUAL'
              ? 'El socio paga el año por adelantado y sigue recibiendo su cupo cada mes.'
              : null}
          </p>
        </div>

        <div>
          <label className="label">¿Qué recibe? (en singular)</label>
          <input
            className="input"
            value={f.unidad}
            maxLength={30}
            placeholder="café"
            onChange={(e) => set('unidad', e.target.value)}
          />
          <p className="text-xs text-mute mt-1">
            Se lo lee el cajero al escanear: «le queda 1 {f.unidad.trim() || 'café'}».
          </p>
        </div>

        <div>
          <label className="label">¿Cuántos al mes?</label>
          <input
            className="input"
            type="number"
            min={1}
            max={1000}
            value={f.beneficiosPorMes || ''}
            onChange={(e) => set('beneficiosPorMes', Number(e.target.value))}
          />
          <p className="text-xs text-mute mt-1">
            Vuelve a {f.beneficiosPorMes || 0} el día 1 de cada mes, los haya
            gastado o no. No se acumulan.
          </p>
        </div>

        <div className="md:col-span-2">
          <label className="label">Descripción (opcional)</label>
          <textarea
            className="input"
            rows={2}
            maxLength={500}
            value={f.description}
            placeholder="Un café de especialidad al día, de lunes a viernes."
            onChange={(e) => set('description', e.target.value)}
          />
        </div>
      </div>

      <EditorTramos
        tramos={f.tramos}
        unidad={f.unidad}
        cupo={f.beneficiosPorMes}
        onCambio={(t) => set('tramos', t)}
      />

      {editando && (
        <label className="flex items-center gap-2 mt-4 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={f.isActive}
            onChange={(e) => set('isActive', e.target.checked)}
          />
          <span>
            Plan activo
            <span className="text-mute">
              {' '}
              — apagado solo cierra las altas nuevas. Los socios que ya tienes
              siguen consumiendo y se les sigue repartiendo su cupo cada mes,
              que es lo correcto mientras te paguen. Para cerrar el club de
              verdad, dales de baja desde la pantalla del plan.
            </span>
          </span>
        </label>
      )}

      <div className="mt-4 flex gap-2">
        <button className="btn-primary" onClick={guardar} disabled={guardando}>
          {guardando ? 'Guardando…' : editando ? 'Guardar cambios' : 'Crear el plan'}
        </button>
        <button className="btn-ghost" onClick={onCancelar} disabled={guardando}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════

/**
 * Los tramos de alta: cuántos beneficios recibe quien entra a mitad de mes.
 *
 * Es SOLO para el primer mes. Se avisa en la propia pantalla porque el negocio
 * lo lee como si fuera el cupo permanente y luego no entiende por qué en
 * octubre recibe diez.
 */
function EditorTramos({
  tramos,
  unidad,
  cupo,
  onCambio,
}: {
  tramos: Tramo[];
  unidad: string;
  cupo: number;
  onCambio: (t: Tramo[]) => void;
}) {
  function editar(i: number, campo: keyof Tramo, v: number) {
    onCambio(tramos.map((t, j) => (j === i ? { ...t, [campo]: v } : t)));
  }

  function anadir() {
    // Empieza donde acabó el último para que no se pisen solos: el backend
    // rechaza solapes y el negocio no tiene por qué adivinar el hueco libre.
    const ultimo = tramos.reduce((m, t) => Math.max(m, t.hastaDia), 0);
    if (ultimo >= 31) {
      toast('Los tramos ya cubren el mes entero.', 'error');
      return;
    }
    onCambio([
      ...tramos,
      {
        desdeDia: ultimo + 1,
        hastaDia: 31,
        beneficios: Math.max(1, Math.round(cupo / 2)),
      },
    ]);
  }

  return (
    <div className="mt-5 pt-4 border-t border-line">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-semibold text-sm">Si entra a mitad de mes</div>
          <p className="text-xs text-mute mt-0.5 max-w-xl">
            Reparte el mes por días y dile cuántos recibe quien se dé de alta en
            cada tramo. Es solo para su primer mes: del siguiente en adelante
            recibe los {cupo || 0} completos. Los días que no cubras dan el cupo
            entero.
          </p>
        </div>
        <button className="btn-ghost shrink-0" onClick={anadir}>
          <Icon name="plus" /> Tramo
        </button>
      </div>

      {tramos.length > 0 && (
        <div className="mt-3 space-y-2">
          {tramos.map((t, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-mute">Del día</span>
              <input
                className="input w-16 text-center tabular-nums"
                type="number"
                min={1}
                max={31}
                value={t.desdeDia}
                onChange={(e) => editar(i, 'desdeDia', Number(e.target.value))}
              />
              <span className="text-mute">al</span>
              <input
                className="input w-16 text-center tabular-nums"
                type="number"
                min={1}
                max={31}
                value={t.hastaDia}
                onChange={(e) => editar(i, 'hastaDia', Number(e.target.value))}
              />
              <span className="text-mute">recibe</span>
              <input
                className="input w-20 text-center tabular-nums"
                type="number"
                min={0}
                // El backend recorta con `Math.min(beneficios, cupoMensual)`.
                // Sin tope aquí, el negocio escribía 50 en un plan de 10, se
                // guardaba sin queja, el panel seguía diciendo 50 y el cliente
                // recibía 10 — sin forma de enterarse de la diferencia.
                max={cupo || undefined}
                value={t.beneficios}
                onChange={(e) => editar(i, 'beneficios', Number(e.target.value))}
              />
              <span className="text-mute">
                {plural(unidad.trim() || 'beneficio', t.beneficios)}
              </span>
              <button
                className="btn-ghost ml-auto"
                aria-label="Quitar el tramo"
                onClick={() => onCambio(tramos.filter((_, j) => j !== i))}
              >
                <Icon name="trash" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
