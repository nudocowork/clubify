'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { EnlaceConQr } from '@/components/EnlaceConQr';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';
import { DisenoTarjeta } from './DisenoTarjeta';

type Cupon = {
  id: string;
  name: string;
  tipo: 'PERCENT_OFF' | 'AMOUNT_OFF' | 'FREEBIE' | 'TWO_FOR_ONE' | 'OTHER';
  valor: number;
  description: string;
  isActive: boolean;
  activoAliado: boolean;
  maxPorPersona: number | null;
  periodo: 'SIEMPRE' | 'DIA' | 'SEMANA' | 'MES' | 'ANIO';
  maxTotal: number | null;
  compraMinima: number | null;
  canjesCount: number;
  topeTexto: string;
  agotado: boolean;
  apagadoPor: 'negocio' | 'aliado' | 'ambos' | null;
};

type Convenio = {
  id: string;
  name: string;
  slug: string;
  status: 'ACTIVE' | 'PAUSED' | 'FINISHED';
  verificacion: 'ABIERTO' | 'CODIGO' | 'LISTA';
  codigo: string | null;
  endsAt: string | null;
  contactName: string | null;
  cupones: Cupon[];
  _count: { tarjetas: number; lista: number };
};

type Tarjeta = {
  id: string;
  nombre: string;
  telefono: string;
  documento: string | null;
  status: 'ACTIVE' | 'BLOCKED';
  bloqueadaPor: 'negocio' | 'aliado' | null;
  origen: string | null;
  canjes: number;
  createdAt: string;
};

const TIPOS = [
  { v: 'PERCENT_OFF', t: 'Porcentaje de descuento' },
  { v: 'AMOUNT_OFF', t: 'Descuento en dinero' },
  { v: 'FREEBIE', t: 'Algo gratis' },
  { v: 'TWO_FOR_ONE', t: '2x1' },
  { v: 'OTHER', t: 'Otro' },
] as const;

export default function AlianzaDetalle() {
  const { id } = useParams<{ id: string }>();
  const [c, setC] = useState<Convenio | null>(null);
  const [enlaces, setEnlaces] = useState<{ activacion: string; portal: string } | null>(
    null,
  );
  const [tarjetas, setTarjetas] = useState<Tarjeta[]>([]);
  const [lista, setLista] = useState<
    { id: string; documento: string | null; email: string | null; usedAt: string | null }[]
  >([]);
  const [pegado, setPegado] = useState('');
  const [nuevo, setNuevo] = useState<null | {
    name: string;
    tipo: Cupon['tipo'];
    valor: string;
    description: string;
    maxPorPersona: string;
    periodo: Cupon['periodo'];
  }>(null);

  const cargar = useCallback(async () => {
    try {
      const [conv, en] = await Promise.all([
        api<Convenio>(`/convenios/${id}`),
        api<{ activacion: string; portal: string }>(`/convenios/${id}/enlaces`),
      ]);
      setC(conv);
      setEnlaces(en);
      setTarjetas(await api<Tarjeta[]>(`/convenios/${id}/tarjetas`));
      if (conv.verificacion === 'LISTA') {
        setLista(await api(`/convenios/${id}/lista`));
      }
    } catch (e: any) {
      toast(e.message || 'No pudimos cargar la alianza', 'error');
    }
  }, [id]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function patchConvenio(body: Record<string, unknown>, aviso = 'Guardado') {
    try {
      await api(`/convenios/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
      await cargar();
      // Confirmar SIEMPRE. El código se guarda al salir del campo y la vigencia
      // al elegir la fecha: sin un aviso, el dueño no tiene forma de saber si
      // quedó, y acaba tocándolo dos veces por si acaso.
      toast(aviso, 'success');
    } catch (e: any) {
      toast(e.message || 'No se pudo guardar', 'error');
    }
  }

  async function alternarCupon(cupon: Cupon) {
    try {
      await api(`/convenios/cupones/${cupon.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !cupon.isActive }),
      });
      await cargar();
    } catch (e: any) {
      toast(e.message || 'No se pudo cambiar', 'error');
    }
  }

  async function crearCupon(e: React.FormEvent) {
    e.preventDefault();
    if (!nuevo) return;
    try {
      await api(`/convenios/${id}/cupones`, {
        method: 'POST',
        body: JSON.stringify({
          name: nuevo.name,
          tipo: nuevo.tipo,
          valor: Number(nuevo.valor) || 0,
          description: nuevo.description,
          maxPorPersona: nuevo.maxPorPersona ? Number(nuevo.maxPorPersona) : undefined,
          periodo: nuevo.periodo,
        }),
      });
      setNuevo(null);
      await cargar();
    } catch (e: any) {
      toast(e.message || 'No se pudo crear el beneficio', 'error');
    }
  }

  async function bloquear(t: Tarjeta) {
    try {
      await api(`/convenios/tarjetas/${t.id}/bloqueo`, {
        method: 'PATCH',
        body: JSON.stringify({ bloquear: t.status !== 'BLOCKED' }),
      });
      await cargar();
    } catch (e: any) {
      toast(e.message || 'No se pudo cambiar', 'error');
    }
  }

  /**
   * La salida al callejón sin salida: el documento se fija en la PRIMERA
   * activación, así que un dedazo —o alguien que activó con el teléfono de un
   * compañero— dejaba fuera a la persona legítima para siempre. Bloquear no
   * servía: bloqueada tampoco se puede volver a activar.
   */
  async function corregirDocumento(t: Tarjeta) {
    const nuevo = prompt(
      `Documento con el que ${t.nombre} activó su tarjeta.\n\n` +
        'Si se equivocó al escribirlo, no puede volver a entrar: al reintentar, ' +
        'el que teclea no coincide con este. Corrígelo y podrá.',
      t.documento ?? '',
    );
    if (nuevo === null || nuevo.trim() === (t.documento ?? '')) return;
    try {
      await api(`/convenios/tarjetas/${t.id}/documento`, {
        method: 'PATCH',
        body: JSON.stringify({ documento: nuevo.trim() }),
      });
      toast('Documento corregido', 'success');
      await cargar();
    } catch (e: any) {
      toast(e.message || 'No se pudo corregir', 'error');
    }
  }

  async function liberar(t: Tarjeta) {
    if (
      !confirm(
        `Se borrará la tarjeta de ${t.nombre} y su pase del teléfono, y esa ` +
          'persona podrá volver a activar desde cero con el enlace.\n\n' +
          'Es para cuando activó quien no debía. ¿Liberar?',
      )
    ) {
      return;
    }
    try {
      await api(`/convenios/tarjetas/${t.id}`, { method: 'DELETE' });
      toast('Tarjeta liberada. Ya puede volver a activar.', 'success');
      await cargar();
    } catch (e: any) {
      toast(e.message || 'No se pudo liberar', 'error');
    }
  }

  if (!c) return <div className="card card-pad animate-shimmer h-40" />;

  const finalizada = c.status === 'FINISHED';
  // Vencida por fecha es DISTINTO de finalizada: se arregla extendiendo la
  // fecha o poniéndola en ilimitada. Finalizada no tiene vuelta atrás.
  const vencida = !!c.endsAt && new Date(c.endsAt) <= new Date();

  return (
    <div className="max-w-4xl mx-auto">
      <Link href="/app/alianzas" className="text-xs text-mute hover:underline">
        ← Alianzas
      </Link>

      <header className="mt-2 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{c.name}</h1>
          <p className="mt-1 text-sm text-mute">
            {c._count.tarjetas}{' '}
            {c._count.tarjetas === 1 ? 'empleado activó' : 'empleados activaron'} su
            tarjeta
          </p>
        </div>
        {!finalizada && (
          <div className="flex gap-2 shrink-0">
            <button
              className="btn"
              onClick={() =>
                patchConvenio(
                  { status: c.status === 'PAUSED' ? 'ACTIVE' : 'PAUSED' },
                  // Pausar apaga TODOS los beneficios y reanudar no los vuelve
                  // a encender: es deliberado —no queremos que revivan solos—
                  // pero sin decirlo el dueño reanuda, ve desaparecer el aviso
                  // ámbar y se queda con los siete beneficios apagados sin
                  // ninguna pista de que falta un paso.
                  c.status === 'PAUSED'
                    ? 'Alianza reanudada. Enciende los beneficios que quieras volver a dar.'
                    : 'Alianza en pausa. Se apagaron todos los beneficios.',
                )
              }
            >
              {c.status === 'PAUSED' ? 'Reanudar' : 'Pausar'}
            </button>
            <button
              className="btn"
              onClick={() => {
                if (
                  confirm(
                    'Finalizar la alianza apaga todos los beneficios y NO se puede deshacer. Las tarjetas y el historial se conservan. ¿Seguro?',
                  )
                ) {
                  patchConvenio({ status: 'FINISHED' });
                }
              }}
            >
              Finalizar
            </button>
          </div>
        )}
      </header>

      {finalizada && (
        <p className="mt-4 rounded-input bg-bg2 px-4 py-3 text-sm text-mute">
          Esta alianza está finalizada. No se puede reabrir: si vuelven a
          acordarla, crea una nueva con las condiciones que pacten.
        </p>
      )}
      {c.status === 'PAUSED' && (
        <p className="mt-4 rounded-input bg-amber-50 px-4 py-3 text-sm text-amber-800">
          En pausa: no se canjea nada y nadie nuevo puede activar su tarjeta.
        </p>
      )}

      {/* ── Los dos enlaces ── */}
      <section className="card card-pad mt-5">
        <h2 className="font-medium">Enlaces</h2>
        <EnlaceConQr
          titulo="Para los empleados"
          nota="Es el que la empresa reparte entre su gente. Se puede reenviar sin problema: quién puede activar lo decide la verificación, no el enlace."
          url={enlaces?.activacion}
          archivo={`alianza-${c.slug}-empleados`}
        />
        <EnlaceConQr
          titulo="Para la empresa aliada"
          nota="Con este enciende y apaga SUS beneficios y da de baja a quien se va. No lo repartas: pásaselo solo a quien lo maneja."
          url={enlaces?.portal}
          archivo={`alianza-${c.slug}-portal-aliado`}
          accion={
            <button
              className="text-xs text-mute hover:underline"
              onClick={async () => {
                if (!confirm('El enlace actual dejará de funcionar. ¿Generar uno nuevo?'))
                  return;
                setEnlaces(await api(`/convenios/${id}/enlaces/rotar`, { method: 'POST' }));
                toast('Enlace nuevo generado', 'success');
              }}
            >
              Generar uno nuevo
            </button>
          }
        />
      </section>

      {/* ── Cómo se ve la tarjeta ── */}
      <DisenoTarjeta
        convenioId={c.id}
        empresa={c.name}
        estado={
          c.status === 'FINISHED'
            ? 'FINALIZADO'
            : c.status === 'PAUSED'
              ? 'PAUSA'
              : 'ACTIVO'
        }
        // Los que están encendidos por LAS DOS PARTES y no se han agotado: es
        // justo lo que el pase enseña y lo que la caja aplica. Enseñar aquí los
        // apagados haría de la vista previa una promesa falsa.
        beneficiosVivos={c.cupones
          .filter((x) => x.isActive && x.activoAliado && !x.agotado)
          .map(resumen)}
      />

      {/* ── Verificación ── */}
      <section className="card card-pad mt-4">
        <h2 className="font-medium">Cómo se comprueba quién trabaja ahí</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Método</label>
            <select
              className="input"
              disabled={finalizada}
              value={c.verificacion}
              onChange={(e) => patchConvenio({ verificacion: e.target.value })}
            >
              <option value="CODIGO">Código que reparte la empresa</option>
              <option value="LISTA">Lista de documentos o correos</option>
              <option value="ABIERTO">Cualquiera con el enlace</option>
            </select>
          </div>
          {c.verificacion === 'CODIGO' && (
            <div>
              <label className="label">Código vigente</label>
              <input
                className="input font-mono"
                disabled={finalizada}
                defaultValue={c.codigo ?? ''}
                onBlur={(e) => {
                  if (e.target.value.trim() && e.target.value !== c.codigo) {
                    patchConvenio({ codigo: e.target.value });
                  }
                }}
              />
              <p className="mt-1 text-[11px] leading-snug text-mute">
                Cambiarlo cierra la puerta a quien lo tenga filtrado, pero no
                echa a nadie que ya activó su tarjeta.
              </p>
            </div>
          )}
        </div>
        {c.verificacion === 'ABIERTO' && (
          <p className="mt-2 text-[11px] leading-snug text-amber-700">
            Cualquiera que reciba el enlace obtiene el beneficio, trabaje o no en
            la empresa.
          </p>
        )}

        {/* La lista. Sin esto, elegir «solo quien esté en la lista» dejaba la
            alianza inservible: no había forma de cargarla y a todos los
            empleados les salía «no encontramos tu documento». */}
        {c.verificacion === 'LISTA' && (
          <div className="mt-4 rounded-input bg-bg2 p-4">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-sm font-medium">Quién puede activar</h3>
              <span className="text-xs text-mute">
                {lista.length} en la lista ·{' '}
                {lista.filter((x) => x.usedAt).length} ya activaron
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-snug text-mute">
              Pega los documentos o los correos que te pase la empresa, uno por
              línea. Se añaden a los que ya están, no los reemplazan.
            </p>
            {/* El correo no se puede comprobar: no le mandamos nada a esa
                dirección. Quien lo conozca puede activar con cualquier
                documento. El documento sí lo coteja el cajero contra la cédula,
                así que es lo que conviene pedirle a la empresa. */}
            <p className="mt-1 text-[11px] leading-snug text-amber-700">
              Mejor documentos: el correo no lo verificamos, así que quien lo
              conozca puede activar aunque no trabaje ahí.
            </p>
            <textarea
              className="input mt-2 h-28 font-mono text-xs"
              value={pegado}
              onChange={(e) => setPegado(e.target.value)}
              placeholder={'1020304050\n1098765432\nana@empresa.com'}
            />
            <div className="mt-2 flex items-center gap-2">
              <button
                className="btn btn-sm"
                disabled={!pegado.trim() || finalizada}
                onClick={async () => {
                  try {
                    const r = await api<{ agregadas: number; yaEstaban: number }>(
                      `/convenios/${id}/lista`,
                      { method: 'POST', body: JSON.stringify({ texto: pegado }) },
                    );
                    toast(
                      `${r.agregadas} añadidos${r.yaEstaban ? `, ${r.yaEstaban} ya estaban` : ''}`,
                      'success',
                    );
                    setPegado('');
                    await cargar();
                  } catch (e: any) {
                    toast(e.message || 'No se pudo cargar', 'error');
                  }
                }}
              >
                Añadir a la lista
              </button>
            </div>
            {lista.length > 0 && (
              <ul className="mt-3 max-h-56 divide-y divide-line overflow-y-auto">
                {lista.map((f) => (
                  <li key={f.id} className="flex items-center justify-between gap-2 py-1.5">
                    <span className="truncate font-mono text-xs">
                      {f.documento || f.email}
                      {f.usedAt && (
                        <span className="ml-2 font-sans text-[11px] text-mute">
                          ya activó
                        </span>
                      )}
                    </span>
                    <button
                      className="shrink-0 text-xs text-mute hover:underline"
                      disabled={finalizada}
                      onClick={async () => {
                        // Con try/catch: sin él, un 403 —módulo apagado— o un
                        // fallo de red no pintaban NADA y el dueño creía que el
                        // botón estaba roto.
                        try {
                          await api(`/convenios/lista/${f.id}`, { method: 'DELETE' });
                          await cargar();
                        } catch (e: any) {
                          toast(e.message || 'No se pudo quitar', 'error');
                        }
                      }}
                    >
                      Quitar
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      {/* ── Vigencia ── */}
      <section className="card card-pad mt-4">
        <h2 className="font-medium">Hasta cuándo dura</h2>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            className={`rounded-input px-3 py-2 text-sm transition ${
              !c.endsAt ? 'bg-fg font-semibold text-bg1' : 'border border-line text-mute'
            }`}
            disabled={finalizada}
            onClick={() => patchConvenio({ endsAt: null })}
          >
            Ilimitada
          </button>
          <input
            className="input w-44"
            type="date"
            disabled={finalizada}
            value={c.endsAt ? String(c.endsAt).slice(0, 10) : ''}
            onChange={(e) =>
              patchConvenio({ endsAt: e.target.value || null })
            }
          />
        </div>
        <p className="mt-2 text-[11px] leading-snug text-mute">
          {c.endsAt
            ? vencida
              ? 'Venció: no se canjea ni puede activar nadie. Extiende la fecha o ponla en ilimitada si renovaron.'
              : 'Al llegar ese día se apaga sola. Puedes extenderla cuando renueven.'
            : 'No caduca: sigue activa hasta que la pauses o la finalices.'}
        </p>
      </section>

      {/* ── Beneficios ── */}
      <section className="card card-pad mt-4">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Beneficios</h2>
          {!finalizada && !nuevo && (
            <button
              className="btn btn-sm"
              onClick={() =>
                setNuevo({
                  name: '',
                  tipo: 'PERCENT_OFF',
                  valor: '10',
                  description: '',
                  maxPorPersona: '',
                  periodo: 'SIEMPRE',
                })
              }
            >
              Añadir
            </button>
          )}
        </div>
        <p className="mt-1 text-xs text-mute">
          Hay dos interruptores por beneficio: el tuyo y el de la empresa aliada.
          Se tiene que usar solo si los dos están encendidos, y ninguno puede
          encender el del otro.
        </p>

        {nuevo && (
          <form onSubmit={crearCupon} className="mt-3 grid gap-3 rounded-input bg-bg2 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label">Nombre</label>
                <input
                  className="input"
                  value={nuevo.name}
                  onChange={(e) => setNuevo({ ...nuevo, name: e.target.value })}
                  placeholder="Almuerzo ejecutivo, Bebida…"
                  required
                />
              </div>
              <div>
                <label className="label">Tipo</label>
                <select
                  className="input"
                  value={nuevo.tipo}
                  onChange={(e) =>
                    setNuevo({ ...nuevo, tipo: e.target.value as Cupon['tipo'] })
                  }
                >
                  {TIPOS.map((t) => (
                    <option key={t.v} value={t.v}>
                      {t.t}
                    </option>
                  ))}
                </select>
              </div>
              {(nuevo.tipo === 'PERCENT_OFF' || nuevo.tipo === 'AMOUNT_OFF') && (
                <div>
                  <label className="label">
                    {nuevo.tipo === 'PERCENT_OFF' ? 'Porcentaje' : 'Cuánto descuenta'}
                  </label>
                  <input
                    className="input"
                    type="number"
                    min={1}
                    value={nuevo.valor}
                    onChange={(e) => setNuevo({ ...nuevo, valor: e.target.value })}
                  />
                </div>
              )}
              <div>
                <label className="label">Cuántas veces por persona</label>
                <div className="flex gap-2">
                  <input
                    className="input"
                    type="number"
                    min={1}
                    placeholder="Sin tope"
                    value={nuevo.maxPorPersona}
                    onChange={(e) =>
                      setNuevo({ ...nuevo, maxPorPersona: e.target.value })
                    }
                  />
                  <select
                    className="input"
                    value={nuevo.periodo}
                    onChange={(e) =>
                      setNuevo({ ...nuevo, periodo: e.target.value as Cupon['periodo'] })
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
            </div>
            <div className="flex gap-2">
              <button className="btn btn-primary" type="submit">
                Guardar beneficio
              </button>
              <button className="btn" type="button" onClick={() => setNuevo(null)}>
                Cancelar
              </button>
            </div>
          </form>
        )}

        <ul className="mt-3 grid gap-2">
          {c.cupones.map((x) => (
            <li
              key={x.id}
              className="flex items-start justify-between gap-3 rounded-input border border-line px-4 py-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">{resumen(x)}</p>
                {x.description && (
                  <p className="mt-0.5 text-xs text-mute">{x.description}</p>
                )}
                <p className="mt-1 text-xs">
                  <EstadoCupon c={x} status={c.status} />
                  {x.topeTexto && (
                    <span className="ml-2 text-mute">{x.topeTexto}</span>
                  )}
                  <span className="ml-2 text-mute">
                    {x.canjesCount} {x.canjesCount === 1 ? 'uso' : 'usos'}
                  </span>
                </p>
              </div>
              <button
                type="button"
                disabled={finalizada}
                onClick={() => alternarCupon(x)}
                className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition disabled:opacity-50 ${
                  x.isActive
                    ? 'bg-fg text-bg1'
                    : 'border border-line text-mute'
                }`}
              >
                {x.isActive ? 'Encendido' : 'Apagado'}
              </button>
            </li>
          ))}
          {c.cupones.length === 0 && !nuevo && (
            <li className="rounded-input bg-bg2 px-4 py-6 text-center text-sm text-mute">
              Añade al menos un beneficio: hasta entonces el enlace no deja
              activar a nadie.
            </li>
          )}
        </ul>
      </section>

      {/* ── Empleados ── */}
      <section className="card card-pad mt-4">
        <h2 className="font-medium">Empleados con tarjeta</h2>
        {tarjetas.length === 0 ? (
          <p className="mt-3 rounded-input bg-bg2 px-4 py-6 text-center text-sm text-mute">
            Todavía no ha activado nadie. Comparte el enlace de arriba con la
            empresa.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {tarjetas.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{t.nombre}</p>
                  <p className="text-xs text-mute">
                    {t.telefono}
                    {t.documento && ` · ${t.documento}`} · {t.canjes}{' '}
                    {t.canjes === 1 ? 'uso' : 'usos'}
                    {t.status === 'BLOCKED' &&
                      ` · bloqueada por ${
                        t.bloqueadaPor === 'aliado' ? 'la empresa' : 'ti'
                      }`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    className="btn-ghost text-xs"
                    disabled={finalizada}
                    onClick={() => corregirDocumento(t)}
                    title="Se equivocó al teclear su cédula y ya no puede entrar"
                  >
                    Cédula
                  </button>
                  {/* Liberar borra: solo tiene sentido cuando no hay nada que
                      perder. Con canjes el backend se niega, y aquí ni se
                      ofrece para no prometer un botón que va a fallar. */}
                  {t.canjes === 0 && (
                    <button
                      className="btn-ghost text-xs"
                      disabled={finalizada}
                      onClick={() => liberar(t)}
                      title="Activó quien no debía: la borra para que pueda entrar el legítimo"
                    >
                      Liberar
                    </button>
                  )}
                <button
                  className="btn btn-sm shrink-0"
                  disabled={finalizada}
                  onClick={() => {
                    if (
                      t.status === 'BLOCKED' &&
                      t.bloqueadaPor === 'aliado' &&
                      !confirm(
                        'La bloqueó la empresa aliada, probablemente porque esa persona ya no trabaja ahí. ¿Reactivarla de todas formas?',
                      )
                    ) {
                      return;
                    }
                    // Bloquear le apaga el pase a una persona real: no puede
                    // estar a un solo clic de distancia.
                    if (
                      t.status !== 'BLOCKED' &&
                      !confirm(
                        `Se le apagará el beneficio a ${t.nombre}. Podrás reactivarlo después. ¿Bloquear?`,
                      )
                    ) {
                      return;
                    }
                    bloquear(t);
                  }}
                >
                  {t.status === 'BLOCKED' ? 'Reactivar' : 'Bloquear'}
                </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function resumen(x: Cupon) {
  switch (x.tipo) {
    case 'PERCENT_OFF':
      return `${x.valor}% de descuento — ${x.name}`;
    case 'AMOUNT_OFF':
      return `$${x.valor.toLocaleString('es-CO')} de descuento — ${x.name}`;
    case 'FREEBIE':
      return `${x.name} gratis`;
    case 'TWO_FOR_ONE':
      return `2x1 en ${x.name}`;
    default:
      return x.name;
  }
}

/**
 * El estado REAL del beneficio, no solo mi interruptor. Si lo apagó la empresa
 * aliada hay que decirlo: el dueño no puede encenderlo por ella y si solo
 * leyera «apagado» buscaría el fallo en su propio panel.
 */
function EstadoCupon({ c, status }: { c: Cupon; status: Convenio['status'] }) {
  if (status === 'FINISHED')
    return <span className="text-mute">Alianza finalizada</span>;
  if (status === 'PAUSED') return <span className="text-mute">Alianza en pausa</span>;
  if (c.apagadoPor === 'ambos')
    return <span className="text-mute">Apagado por ti y por la empresa</span>;
  if (c.apagadoPor === 'negocio')
    return <span className="text-mute">Apagado por ti</span>;
  if (c.apagadoPor === 'aliado')
    return <span className="text-mute">Apagado por la empresa aliada</span>;
  if (c.agotado) return <span className="text-mute">Agotado</span>;
  return <span className="font-medium text-emerald-700">Activo</span>;
}

