'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { EnlaceConQr } from '@/components/EnlaceConQr';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';
import { DisenoTarjeta } from './DisenoTarjeta';
import { useTranslations, useLocale } from 'next-intl';

type Traductor = ReturnType<typeof useTranslations<'app_alianza'>>;

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

// Solo los tipos: el texto lo pone el traductor.
const TIPOS = [
  'PERCENT_OFF',
  'AMOUNT_OFF',
  'FREEBIE',
  'TWO_FOR_ONE',
  'OTHER',
] as const;
const TIPO_CLAVE: Record<(typeof TIPOS)[number], string> = {
  PERCENT_OFF: 'typePercent',
  AMOUNT_OFF: 'typeAmount',
  FREEBIE: 'typeFreebie',
  TWO_FOR_ONE: 'typeTwoForOne',
  OTHER: 'typeOther',
};

export default function AlianzaDetalle() {
  const t = useTranslations('app_alianza');
  const locale = useLocale();
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
      toast(e.message || t('loadError'), 'error');
    }
  }, [id]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function patchConvenio(body: Record<string, unknown>, aviso?: string) {
    try {
      await api(`/convenios/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
      await cargar();
      // Confirmar SIEMPRE. El código se guarda al salir del campo y la vigencia
      // al elegir la fecha: sin un aviso, el dueño no tiene forma de saber si
      // quedó, y acaba tocándolo dos veces por si acaso.
      toast(aviso ?? t('saved'), 'success');
    } catch (e: any) {
      toast(e.message || t('saveError'), 'error');
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
      toast(e.message || t('changeError'), 'error');
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
      toast(e.message || t('createBenefitError'), 'error');
    }
  }

  async function bloquear(tarjeta: Tarjeta) {
    try {
      await api(`/convenios/tarjetas/${tarjeta.id}/bloqueo`, {
        method: 'PATCH',
        body: JSON.stringify({ bloquear: tarjeta.status !== 'BLOCKED' }),
      });
      await cargar();
    } catch (e: any) {
      toast(e.message || t('changeError'), 'error');
    }
  }

  /**
   * La salida al callejón sin salida: el documento se fija en la PRIMERA
   * activación, así que un dedazo —o alguien que activó con el teléfono de un
   * compañero— dejaba fuera a la persona legítima para siempre. Bloquear no
   * servía: bloqueada tampoco se puede volver a activar.
   */
  async function corregirDocumento(tarjeta: Tarjeta) {
    const nuevo = prompt(
      t('promptDocument', { name: tarjeta.nombre }),
      tarjeta.documento ?? '',
    );
    if (nuevo === null || nuevo.trim() === (tarjeta.documento ?? '')) return;
    try {
      await api(`/convenios/tarjetas/${tarjeta.id}/documento`, {
        method: 'PATCH',
        body: JSON.stringify({ documento: nuevo.trim() }),
      });
      toast(t('documentFixed'), 'success');
      await cargar();
    } catch (e: any) {
      toast(e.message || t('documentError'), 'error');
    }
  }

  async function liberar(tarjeta: Tarjeta) {
    if (
      !confirm(t('confirmRelease', { name: tarjeta.nombre }))
    ) {
      return;
    }
    try {
      await api(`/convenios/tarjetas/${tarjeta.id}`, { method: 'DELETE' });
      toast(t('released'), 'success');
      await cargar();
    } catch (e: any) {
      toast(e.message || t('releaseError'), 'error');
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
        {t('back')}
      </Link>

      <header className="mt-2 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{c.name}</h1>
          <p className="mt-1 text-sm text-mute">
            {c._count.tarjetas === 1
              ? t('oneActivated')
              : t('manyActivated', { count: c._count.tarjetas })}
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
                  c.status === 'PAUSED' ? t('resumed') : t('pausedToast'),
                )
              }
            >
              {c.status === 'PAUSED' ? t('resume') : t('pause')}
            </button>
            <button
              className="btn"
              onClick={() => {
                if (
                  confirm(t('confirmFinish'))
                ) {
                  patchConvenio({ status: 'FINISHED' });
                }
              }}
            >
              {t('finish')}
            </button>
          </div>
        )}
      </header>

      {finalizada && (
        <p className="mt-4 rounded-input bg-bg2 px-4 py-3 text-sm text-mute">
          {t('finishedNote')}
        </p>
      )}
      {c.status === 'PAUSED' && (
        <p className="mt-4 rounded-input bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {t('pausedNote')}
        </p>
      )}

      {/* ── Los dos enlaces ── */}
      <section className="card card-pad mt-5">
        <h2 className="font-medium">{t('links')}</h2>
        <EnlaceConQr
          titulo={t('forEmployees')}
          nota={t('forEmployeesNote')}
          url={enlaces?.activacion}
          archivo={`alianza-${c.slug}-empleados`}
        />
        <EnlaceConQr
          titulo={t('forCompany')}
          nota={t('forCompanyNote')}
          url={enlaces?.portal}
          archivo={`alianza-${c.slug}-portal-aliado`}
          accion={
            <button
              className="text-xs text-mute hover:underline"
              onClick={async () => {
                if (!confirm(t('confirmRotate'))) return;
                setEnlaces(await api(`/convenios/${id}/enlaces/rotar`, { method: 'POST' }));
                toast(t('rotated'), 'success');
              }}
            >
              {t('rotate')}
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
          .map((x) => resumen(t, locale, x))}
      />

      {/* ── Verificación ── */}
      <section className="card card-pad mt-4">
        <h2 className="font-medium">{t('verificationTitle')}</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">{t('method')}</label>
            <select
              className="input"
              disabled={finalizada}
              value={c.verificacion}
              onChange={(e) => patchConvenio({ verificacion: e.target.value })}
            >
              <option value="CODIGO">{t('methodCode')}</option>
              <option value="LISTA">{t('methodList')}</option>
              <option value="ABIERTO">{t('methodOpen')}</option>
            </select>
          </div>
          {c.verificacion === 'CODIGO' && (
            <div>
              <label className="label">{t('currentCode')}</label>
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
                {t('codeHint')}
              </p>
            </div>
          )}
        </div>
        {c.verificacion === 'ABIERTO' && (
          <p className="mt-2 text-[11px] leading-snug text-amber-700">
            {t('openWarning')}
          </p>
        )}

        {/* La lista. Sin esto, elegir «solo quien esté en la lista» dejaba la
            alianza inservible: no había forma de cargarla y a todos los
            empleados les salía «no encontramos tu documento». */}
        {c.verificacion === 'LISTA' && (
          <div className="mt-4 rounded-input bg-bg2 p-4">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-sm font-medium">{t('whoCanActivate')}</h3>
              <span className="text-xs text-mute">
                {t('listCount', {
                  total: lista.length,
                  usados: lista.filter((x) => x.usedAt).length,
                })}
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-snug text-mute">
              {t('listHint')}
            </p>
            {/* El correo no se puede comprobar: no le mandamos nada a esa
                dirección. Quien lo conozca puede activar con cualquier
                documento. El documento sí lo coteja el cajero contra la cédula,
                así que es lo que conviene pedirle a la empresa. */}
            <p className="mt-1 text-[11px] leading-snug text-amber-700">
              {t('listWarning')}
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
                      r.yaEstaban
                        ? t('addedWithExisting', {
                            count: r.agregadas,
                            yaEstaban: r.yaEstaban,
                          })
                        : t('added', { count: r.agregadas }),
                      'success',
                    );
                    setPegado('');
                    await cargar();
                  } catch (e: any) {
                    toast(e.message || t('addListError'), 'error');
                  }
                }}
              >
                {t('addToList')}
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
                          {t('alreadyActivated')}
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
                          toast(e.message || t('removeError'), 'error');
                        }
                      }}
                    >
                      {t('removeFromList')}
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
        <h2 className="font-medium">{t('durationTitle')}</h2>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            className={`rounded-input px-3 py-2 text-sm transition ${
              !c.endsAt ? 'bg-fg font-semibold text-bg1' : 'border border-line text-mute'
            }`}
            disabled={finalizada}
            onClick={() => patchConvenio({ endsAt: null })}
          >
            {t('unlimited')}
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
              ? t('expiredNote')
              : t('willExpireNote')
            : t('neverExpiresNote')}
        </p>
      </section>

      {/* ── Beneficios ── */}
      <section className="card card-pad mt-4">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">{t('benefits')}</h2>
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
              {t('add')}
            </button>
          )}
        </div>
        <p className="mt-1 text-xs text-mute">
          {t('twoSwitches')}
        </p>

        {nuevo && (
          <form onSubmit={crearCupon} className="mt-3 grid gap-3 rounded-input bg-bg2 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label">{t('name')}</label>
                <input
                  className="input"
                  value={nuevo.name}
                  onChange={(e) => setNuevo({ ...nuevo, name: e.target.value })}
                  placeholder={t('namePlaceholder')}
                  required
                />
              </div>
              <div>
                <label className="label">{t('type')}</label>
                <select
                  className="input"
                  value={nuevo.tipo}
                  onChange={(e) =>
                    setNuevo({ ...nuevo, tipo: e.target.value as Cupon['tipo'] })
                  }
                >
                  {TIPOS.map((tipo) => (
                    <option key={tipo} value={tipo}>
                      {t(TIPO_CLAVE[tipo] as any)}
                    </option>
                  ))}
                </select>
              </div>
              {(nuevo.tipo === 'PERCENT_OFF' || nuevo.tipo === 'AMOUNT_OFF') && (
                <div>
                  <label className="label">
                    {nuevo.tipo === 'PERCENT_OFF'
                      ? t('percentage')
                      : t('howMuchOff')}
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
                <label className="label">{t('timesPerPerson')}</label>
                <div className="flex gap-2">
                  <input
                    className="input"
                    type="number"
                    min={1}
                    placeholder={t('noLimit')}
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
                    <option value="SIEMPRE">{t('periodAlways')}</option>
                    <option value="DIA">{t('periodDay')}</option>
                    <option value="SEMANA">{t('periodWeek')}</option>
                    <option value="MES">{t('periodMonth')}</option>
                    <option value="ANIO">{t('periodYear')}</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <button className="btn btn-primary" type="submit">
                {t('saveBenefit')}
              </button>
              <button className="btn" type="button" onClick={() => setNuevo(null)}>
                {t('cancel')}
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
                <p className="text-sm font-medium">{resumen(t, locale, x)}</p>
                {x.description && (
                  <p className="mt-0.5 text-xs text-mute">{x.description}</p>
                )}
                <p className="mt-1 text-xs">
                  <EstadoCupon cupon={x} status={c.status} />
                  {x.topeTexto && (
                    <span className="ml-2 text-mute">{x.topeTexto}</span>
                  )}
                  <span className="ml-2 text-mute">
                    {x.canjesCount === 1
                      ? t('oneUse', { count: x.canjesCount })
                      : t('manyUses', { count: x.canjesCount })}
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
                {x.isActive ? t('on') : t('off')}
              </button>
            </li>
          ))}
          {c.cupones.length === 0 && !nuevo && (
            <li className="rounded-input bg-bg2 px-4 py-6 text-center text-sm text-mute">
              {t('noBenefits')}
            </li>
          )}
        </ul>
      </section>

      {/* ── Empleados ── */}
      <section className="card card-pad mt-4">
        <h2 className="font-medium">{t('employees')}</h2>
        {tarjetas.length === 0 ? (
          <p className="mt-3 rounded-input bg-bg2 px-4 py-6 text-center text-sm text-mute">
            {t('noEmployees')}
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {tarjetas.map((tarjeta) => (
              <li
                key={tarjeta.id}
                className="flex items-center justify-between gap-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{tarjeta.nombre}</p>
                  <p className="text-xs text-mute">
                    {tarjeta.telefono}
                    {tarjeta.documento && ` · ${tarjeta.documento}`} ·{' '}
                    {tarjeta.canjes === 1
                      ? t('oneUse', { count: tarjeta.canjes })
                      : t('manyUses', { count: tarjeta.canjes })}
                    {tarjeta.status === 'BLOCKED' &&
                      (tarjeta.bloqueadaPor === 'aliado'
                        ? t('blockedByCompany')
                        : t('blockedByYou'))}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    className="btn-ghost text-xs"
                    disabled={finalizada}
                    onClick={() => corregirDocumento(tarjeta)}
                    title={t('idButtonTitle')}
                  >
                    {t('idButton')}
                  </button>
                  {/* Liberar borra: solo tiene sentido cuando no hay nada que
                      perder. Con canjes el backend se niega, y aquí ni se
                      ofrece para no prometer un botón que va a fallar. */}
                  {tarjeta.canjes === 0 && (
                    <button
                      className="btn-ghost text-xs"
                      disabled={finalizada}
                      onClick={() => liberar(tarjeta)}
                      title={t('releaseTitle')}
                    >
                      {t('release')}
                    </button>
                  )}
                <button
                  className="btn btn-sm shrink-0"
                  disabled={finalizada}
                  onClick={() => {
                    if (
                      tarjeta.status === 'BLOCKED' &&
                      tarjeta.bloqueadaPor === 'aliado' &&
                      !confirm(t('confirmUnblockByCompany'))
                    ) {
                      return;
                    }
                    // Bloquear le apaga el pase a una persona real: no puede
                    // estar a un solo clic de distancia.
                    if (
                      tarjeta.status !== 'BLOCKED' &&
                      !confirm(t('confirmBlock', { name: tarjeta.nombre }))
                    ) {
                      return;
                    }
                    bloquear(tarjeta);
                  }}
                >
                  {tarjeta.status === 'BLOCKED' ? t('reactivate') : t('block')}
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

function resumen(t: Traductor, locale: string, x: Cupon) {
  switch (x.tipo) {
    case 'PERCENT_OFF':
      return t('summaryPercent', { valor: x.valor, name: x.name });
    case 'AMOUNT_OFF':
      return t('summaryAmount', {
        valor: x.valor.toLocaleString(locale),
        name: x.name,
      });
    case 'FREEBIE':
      return t('summaryFreebie', { name: x.name });
    case 'TWO_FOR_ONE':
      return t('summaryTwoForOne', { name: x.name });
    default:
      return x.name;
  }
}

/**
 * El estado REAL del beneficio, no solo mi interruptor. Si lo apagó la empresa
 * aliada hay que decirlo: el dueño no puede encenderlo por ella y si solo
 * leyera «apagado» buscaría el fallo en su propio panel.
 */
function EstadoCupon({
  cupon,
  status,
}: {
  cupon: Cupon;
  status: Convenio['status'];
}) {
  const t = useTranslations('app_alianza');
  if (status === 'FINISHED')
    return <span className="text-mute">{t('statusFinished')}</span>;
  if (status === 'PAUSED')
    return <span className="text-mute">{t('statusPaused')}</span>;
  if (cupon.apagadoPor === 'ambos')
    return <span className="text-mute">{t('offByBoth')}</span>;
  if (cupon.apagadoPor === 'negocio')
    return <span className="text-mute">{t('offByYou')}</span>;
  if (cupon.apagadoPor === 'aliado')
    return <span className="text-mute">{t('offByCompany')}</span>;
  if (cupon.agotado) return <span className="text-mute">{t('soldOut')}</span>;
  return (
    <span className="font-medium text-emerald-700">{t('statusActive')}</span>
  );
}

