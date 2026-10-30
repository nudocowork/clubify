'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { PanelHeader } from '@/components/PanelHeader';
import { toast } from '@/components/Toast';
import { ActionsMenu } from '@/components/ActionsMenu';
import { descargarCsv, descargarXlsx, type Celda } from '@/lib/exportar-hoja';
import type { FormularioDeRegistro, ModoDeCampo } from '@/lib/formulario-de-registro';
import {
  motivoBase,
  notaDelSello,
  quienDioElSello,
  tituloDelSello,
  type SelloConMotivo,
  type TraductorDeSellos,
} from '@/lib/sellos/motivo-del-sello';

type Customer = {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  createdAt: string;
  lastOrderAt: string | null;
  totalOrdersCount: number;
  totalOrdersAmount: number;
  // Cumpleaños (año 2000 = centinela; solo día+mes importan). Puede venir null.
  birthday: string | null;
  _count?: { passes: number; stamps: number };
  passes?: { id: string; walletInstalledAt: string | null; walletPlatform: string | null }[];
  // M6: last stamp con operator + location, devuelto por el backend
  // como array de hasta 1 entrada. Vacío si el cliente nunca fue
  // escaneado.
  stamps?: Array<{
    id: string;
    createdAt: string;
    action: string;
    operator: { id: string; fullName: string; email: string } | null;
    location: { id: string; name: string } | null;
  }>;
};

type StaffOption = { id: string; fullName: string; email: string };

type Traductor = ReturnType<typeof useTranslations<'app_customers'>>;

/** Lo que devuelve `/customers/export-datos`. Los decimales llegan como texto. */
type DatosExportables = {
  clientes: Array<Customer & { tags?: string[] | null; marketingOptIn?: boolean | null }>;
  sellos: Array<
    SelloConMotivo & {
      id: string;
      customerId: string;
      createdAt: string;
      amount: number | string;
      purchaseAmount: number | string | null;
      pass?: { card?: { name: string } | null } | null;
    }
  >;
};

/** «2026-10-22 14:35» en la hora del navegador: ordena bien en Excel. */
function fechaHora(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Cumpleaños DD/MM: el año guardado (2000) es un centinela, no se exporta. */
function diaMes(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(5, 10).split('-').reverse().join('/');
}

const aNumero = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Dos hojas: una fila por cliente (ficha + resumen de sus sellos y compras) y
 * una fila por movimiento de sellos. Mismos textos que la ficha del cliente.
 */
function filasParaExportar(
  datos: DatosExportables,
  t: Traductor,
  tSello: TraductorDeSellos,
): { clientes: Celda[][]; sellos: Celda[][] } {
  type Resumen = {
    sellos: number;
    cortesia: number;
    fechaEspecial: number;
    canjes: number;
    compras: number;
    gastado: number;
    ultimo: string | null;
  };
  const porCliente = new Map<string, Resumen>();
  const resumenDe = (id: string): Resumen => {
    let r = porCliente.get(id);
    if (!r) {
      r = { sellos: 0, cortesia: 0, fechaEspecial: 0, canjes: 0, compras: 0, gastado: 0, ultimo: null };
      porCliente.set(id, r);
    }
    return r;
  };
  for (const s of datos.sellos) {
    const r = resumenDe(s.customerId);
    const cantidad = aNumero(s.amount) ?? 0;
    const monto = aNumero(s.purchaseAmount);
    if (s.action === 'STAMP' || s.action === 'VISIT') {
      r.sellos += cantidad;
      if (s.giftReason === 'COURTESY') r.cortesia += cantidad;
      else if (s.giftReason === 'SPECIAL_DATE') r.fechaEspecial += cantidad;
      // ISO ordena como texto.
      if (!r.ultimo || s.createdAt > r.ultimo) r.ultimo = s.createdAt;
    }
    if (s.action === 'REDEEM') r.canjes += 1;
    if (monto && monto > 0) {
      r.compras += 1;
      r.gastado += monto;
    }
  }
  const si = t('expYes');
  const no = t('expNo');
  const redondear = (n: number) => Math.round(n * 100) / 100;

  const clientes: Celda[][] = [
    [
      t('expc_name'), t('expc_email'), t('expc_phone'), t('expc_birthday'), t('expc_since'),
      t('expc_tags'), t('expc_marketing'), t('expc_passes'), t('expc_installed'),
      t('expc_stamps'), t('expc_courtesy'), t('expc_specialDate'), t('expc_redeems'),
      t('expc_purchases'), t('expc_spent'), t('expc_avgTicket'), t('expc_lastStamp'),
      t('expc_orders'), t('expc_ordersAmount'), t('expc_lastOrder'),
    ],
    ...datos.clientes.map((c) => {
      const r = resumenDe(c.id);
      const instalada = (c.passes ?? []).some((p) => !!p.walletInstalledAt);
      return [
        c.fullName, c.email ?? '', c.phone ?? '', diaMes(c.birthday), fechaHora(c.createdAt),
        (c.tags ?? []).join(' | '), c.marketingOptIn === false ? no : si,
        c._count?.passes ?? c.passes?.length ?? 0, instalada ? si : no,
        r.sellos, r.cortesia, r.fechaEspecial, r.canjes,
        r.compras, redondear(r.gastado), r.compras ? redondear(r.gastado / r.compras) : '',
        fechaHora(r.ultimo),
        c.totalOrdersCount ?? 0, aNumero(c.totalOrdersAmount) ?? 0, fechaHora(c.lastOrderAt),
      ];
    }),
  ];

  const clientePorId = new Map(datos.clientes.map((c) => [c.id, c] as const));
  const sellos: Celda[][] = [
    [
      t('exps_date'), t('exps_customer'), t('exps_email'), t('exps_phone'), t('exps_card'),
      t('exps_action'), t('exps_amount'), t('exps_purchase'), t('exps_reason'), t('exps_note'),
      t('exps_operator'), t('exps_location'),
    ],
    ...datos.sellos.map((s) => {
      const c = clientePorId.get(s.customerId);
      const monto = aNumero(s.purchaseAmount);
      return [
        fechaHora(s.createdAt), c?.fullName ?? '', c?.email ?? '', c?.phone ?? '',
        s.pass?.card?.name ?? '', tituloDelSello(s, tSello), aNumero(s.amount) ?? 0,
        monto && monto > 0 ? monto : '', motivoBase(s, monto, tSello).join(' · '),
        notaDelSello(s), quienDioElSello(s, tSello), s.location?.name ?? '',
      ];
    }),
  ];
  return { clientes, sellos };
}

type Segment =
  | 'all'
  | 'new7'
  | 'vip'
  | 'recurring'
  | 'no-pass'
  | 'sin-instalar'
  | 'inactive'
  | 'birthday';

const SEGMENTS: { key: Segment; label: string; emoji: string; help: string }[] = [
  { key: 'all', label: 'Todos', emoji: '👥', help: 'Toda tu base' },
  { key: 'new7', label: 'Nuevos 7d', emoji: '✨', help: 'Crearon cuenta esta semana' },
  { key: 'vip', label: 'VIP', emoji: '👑', help: '3+ pedidos en total' },
  { key: 'recurring', label: 'Recurrentes', emoji: '🔁', help: '2+ pedidos' },
  { key: 'no-pass', label: 'Sin tarjeta', emoji: '🎴', help: 'Aún no tienen tarjeta de fidelización' },
  {
    key: 'sin-instalar',
    label: 'Sin instalar',
    emoji: '📥',
    help: 'Tienen tarjeta pero no se la descargaron al móvil — a estos NO les llega el push',
  },
  { key: 'inactive', label: 'Inactivos 30d+', emoji: '💤', help: 'Sin pedido en los últimos 30 días' },
  { key: 'birthday', label: 'Cumple este mes', emoji: '🎂', help: 'Cumplen años este mes' },
];

/**
 * Tiene tarjeta, pero no está en su móvil.
 *
 * Es un estado propio y no un «sin tarjeta»: el negocio le emitió el pase y el
 * cliente nunca lo instaló (o lo desinstaló). Importa por dos motivos —el
 * panel cuenta «X de Y instalados» y hasta ahora no había forma de saber quién
 * era el que faltaba, y sobre todo porque a una tarjeta sin instalar NO le
 * llega el push. Son exactamente los clientes a los que el negocio cree que
 * está avisando y no.
 */
function sinInstalar(c: { passes?: { walletInstalledAt: string | null }[] }) {
  const p = c.passes ?? [];
  return p.length > 0 && p.every((x) => !x.walletInstalledAt);
}

/** Mes (0-11) del cumpleaños, o null. La fecha se guarda con año centinela
 *  2000 y @db.Date → usamos getUTCMonth para no derivar por zona horaria. */
function birthdayMonth(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.getUTCMonth();
}

type Orden = 'reciente' | 'alfabetico' | 'cumple';

/**
 * Cómo se ordena la lista.
 *
 * «Reciente» es lo de siempre y sigue siendo lo primero: el negocio entra a
 * ver quién acaba de darse de alta. Los otros dos los pidió Primor Barber:
 * alfabético para buscar a alguien por el nombre en una lista de 128, y por
 * día de cumpleaños para saber a quién le toca esta semana — un mes ordenado
 * por fecha de alta no sirve para felicitar a nadie.
 */
const ORDENES: { key: Orden; label: string }[] = [
  { key: 'reciente', label: 'Más recientes' },
  { key: 'alfabetico', label: 'A → Z' },
  { key: 'cumple', label: 'Por día de cumpleaños' },
];

const MONTHS_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
/** Día del mes del cumpleaños, o null. Mismo criterio UTC que el mes. */
function birthdayDay(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.getUTCDate();
}

/** "15 may" a partir del cumpleaños (día + mes corto). */
function fmtBday(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCDate()} ${MONTHS_ES[d.getUTCMonth()]}`;
}

function avatarClass(seed: string) {
  const sum = seed.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return `avatar-${(sum % 7) + 1}`;
}
function initials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
}
function fmtDate(s: string | null) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('es-CO', {
    day: '2-digit',
    month: 'short',
  });
}
function COP(n: number) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(n);
}

export default function CustomersPage() {
  const t = useTranslations('app_customers');
  // Los textos de los movimientos de sellos viven en la ficha del cliente.
  const tSello = useTranslations('app_customers_id');
  const [list, setList] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');
  const [locationId, setLocationId] = useState<string>('');
  const [locations, setLocations] = useState<Array<{ id: string; name: string }>>([]);
  // M6: filtros por scanner (operator) y fecha desde (en días).
  const [operatorId, setOperatorId] = useState<string>('');
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [sinceDays, setSinceDays] = useState<string>(''); // '' | '7' | '30' | '90'
  const [segment, setSegment] = useState<Segment>('all');
  const [orden, setOrden] = useState<Orden>('reciente');
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ fullName: '', email: '', phone: '', birthday: '' });
  // El alta manual pide lo mismo que el formulario de las tarjetas. Si no se
  // puede leer, se queda como opcional: el backend exige el correo igualmente.
  const [modoCorreo, setModoCorreo] = useState<ModoDeCampo>('opcional');
  const [modoCumple, setModoCumple] = useState<ModoDeCampo>('opcional');
  useEffect(() => {
    api<FormularioDeRegistro>('/tenants/me/formulario-registro')
      .then((f) => {
        setModoCorreo(f.email);
        setModoCumple(f.cumpleanos);
      })
      .catch(() => {});
  }, []);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [waOpen, setWaOpen] = useState(false);
  const [waMessage, setWaMessage] = useState(
    t('waMessageDefault'),
  );
  const [duplicateGroups, setDuplicateGroups] = useState(0);

  // Búsqueda live debounced (300ms) — re-fetch si cambia search/sede/
  // scanner/fecha. M6: 4 filtros combinables.
  //
  // HOTFIX 2026-06-05 (bug I): requestIdRef monotónico para descartar
  // respuestas de filtros viejos. Sin esto, si el cliente tipea "Juan"
  // → borra → "Maria" rápido, la respuesta de "Juan" podía llegar
  // después y pisar la lista de "Maria" → lista incorrecta intermitente.
  // El api() helper no expone AbortController, así que usamos id que
  // se invalida en cada nueva request.
  const requestIdRef = useRef(0);
  useEffect(() => {
    const t = setTimeout(() => load(search), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, locationId, operatorId, sinceDays]);

  useEffect(() => {
    api('/customers/duplicates')
      .then((r) => setDuplicateGroups(r?.total ?? 0))
      .catch(() => {});
    api<any[]>('/locations')
      .then((rows) =>
        setLocations((rows ?? []).map((r) => ({ id: r.id, name: r.name }))),
      )
      .catch(() => {});
    // M6: lista de staff (scanner users) para poblar el dropdown del filtro.
    // Endpoint TENANT_OWNER-only; si el user es TENANT_STAFF no carga.
    api<any[]>('/tenants/me/staff')
      .then((rows) =>
        setStaff(
          (rows ?? []).map((r) => ({
            id: r.id,
            fullName: r.fullName,
            email: r.email,
          })),
        ),
      )
      .catch(() => {});
  }, []);

  /** Los mismos filtros que la lista: la exportación saca lo que se ve. */
  function filtrosActuales(term: string = search): string {
    const qs = new URLSearchParams();
    if (term) qs.set('search', term);
    if (locationId) qs.set('locationId', locationId);
    if (operatorId) qs.set('operatorId', operatorId);
    if (sinceDays) {
      const days = Number(sinceDays);
      if (Number.isFinite(days) && days > 0) {
        qs.set(
          'since',
          new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString(),
        );
      }
    }
    return qs.toString() ? `?${qs}` : '';
  }

  async function load(term: string = search) {
    setLoading(true);
    const myId = ++requestIdRef.current;
    try {
      const params = filtrosActuales(term);
      const res = await api<Customer[]>(`/customers${params}`);
      // Solo aplicar si seguimos siendo la última request — sino una
      // respuesta lenta de filtros viejos pisaría la nueva.
      if (myId === requestIdRef.current) {
        setList(res);
      }
    } catch (e: any) {
      if (myId === requestIdRef.current) {
        toast(e.message || t('errLoading'), 'error');
      }
    } finally {
      if (myId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }

  /**
   * Excel con dos hojas (clientes y cada movimiento de sellos) o un CSV por
   * hoja. El CSV de antes solo llevaba la ficha del cliente: el dueño no podía
   * ver en qué compra se dio cada sello ni cuáles fueron de cortesía.
   */
  async function exportar(formato: 'xlsx' | 'csv-clientes' | 'csv-sellos') {
    try {
      const datos = await api<DatosExportables>(`/customers/export-datos${filtrosActuales()}`);
      if (!datos?.clientes?.length) {
        toast(t('exportNothing'), 'info');
        return;
      }
      const hojas = filasParaExportar(datos, t, tSello);
      const dia = new Date().toISOString().slice(0, 10);
      if (formato === 'xlsx') {
        descargarXlsx(`clientes-${dia}.xlsx`, [
          { nombre: t('expSheetCustomers'), filas: hojas.clientes },
          { nombre: t('expSheetStamps'), filas: hojas.sellos },
        ]);
      } else if (formato === 'csv-clientes') {
        descargarCsv(`clientes-${dia}.csv`, hojas.clientes);
      } else {
        descargarCsv(`sellos-${dia}.csv`, hojas.sellos);
      }
    } catch (e: any) {
      toast(e.message || t('exportFailed'), 'error');
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api('/customers', {
        method: 'POST',
        body: JSON.stringify({
          fullName: form.fullName,
          email: form.email.trim() || undefined,
          phone: form.phone.trim() || undefined,
          birthday: form.birthday || undefined,
        }),
      });
      setForm({ fullName: '', email: '', phone: '', birthday: '' });
      setShowForm(false);
      load();
      toast(t('customerCreated'), 'success');
    } catch (e: any) {
      toast(e.message || t('errCreate'), 'error');
    } finally {
      setSaving(false);
    }
  }

  // Segmentación client-side para no recargar
  const visible = useMemo(() => {
    const now = Date.now();
    const ms7 = 7 * 24 * 60 * 60 * 1000;
    const ms30 = 30 * 24 * 60 * 60 * 1000;
    const thisMonth = new Date().getMonth();
    return list.filter((c) => {
      switch (segment) {
        case 'new7':
          return now - new Date(c.createdAt).getTime() < ms7;
        case 'vip':
          return (c.totalOrdersCount ?? 0) >= 3;
        case 'recurring':
          return (c.totalOrdersCount ?? 0) >= 2;
        case 'no-pass':
          return (c._count?.passes ?? 0) === 0;
        case 'sin-instalar':
          return sinInstalar(c);
        case 'inactive':
          return (
            !!c.lastOrderAt &&
            now - new Date(c.lastOrderAt).getTime() > ms30
          );
        case 'birthday':
          return birthdayMonth(c.birthday) === thisMonth;
        default:
          return true;
      }
    });
  }, [list, segment]);

  const ordenados = useMemo(() => {
    const copia = [...visible];
    if (orden === 'alfabetico') {
      // `localeCompare` con locale español: así la Ñ va entre la N y la O y
      // los acentos no mandan a Álvaro al final de la lista.
      copia.sort((a, b) =>
        (a.fullName || '').localeCompare(b.fullName || '', 'es', {
          sensitivity: 'base',
        }),
      );
    } else if (orden === 'cumple') {
      // Por día del mes. Quien no tiene fecha se va al final: no estorba
      // arriba y sigue estando en la lista.
      copia.sort((a, b) => {
        const da = birthdayDay(a.birthday);
        const db = birthdayDay(b.birthday);
        if (da === null && db === null) return 0;
        if (da === null) return 1;
        if (db === null) return -1;
        return da - db;
      });
    }
    return copia;
  }, [visible, orden]);

  const segmentCounts = useMemo(() => {
    const now = Date.now();
    const ms7 = 7 * 24 * 60 * 60 * 1000;
    const ms30 = 30 * 24 * 60 * 60 * 1000;
    return {
      all: list.length,
      new7: list.filter((c) => now - new Date(c.createdAt).getTime() < ms7).length,
      vip: list.filter((c) => (c.totalOrdersCount ?? 0) >= 3).length,
      recurring: list.filter((c) => (c.totalOrdersCount ?? 0) >= 2).length,
      'no-pass': list.filter((c) => (c._count?.passes ?? 0) === 0).length,
      'sin-instalar': list.filter(sinInstalar).length,
      inactive: list.filter(
        (c) =>
          !!c.lastOrderAt && now - new Date(c.lastOrderAt).getTime() > ms30,
      ).length,
      birthday: list.filter((c) => birthdayMonth(c.birthday) === new Date().getMonth())
        .length,
    } as Record<Segment, number>;
  }, [list]);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllVisible() {
    setSelected((prev) => {
      const allVisibleIds = visible
        .filter((c) => !!c.phone)
        .map((c) => c.id);
      const allSelected = allVisibleIds.every((id) => prev.has(id));
      if (allSelected) {
        const next = new Set(prev);
        for (const id of allVisibleIds) next.delete(id);
        return next;
      }
      const next = new Set(prev);
      for (const id of allVisibleIds) next.add(id);
      return next;
    });
  }

  const selectedCustomers = useMemo(
    () => list.filter((c) => selected.has(c.id) && !!c.phone),
    [list, selected],
  );

  function buildWaLink(c: Customer) {
    const phone = (c.phone ?? '').replace(/\D/g, '');
    const msg = waMessage.replace(/\{\{nombre\}\}/g, c.fullName);
    return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
  }

  return (
    <div>
      <PanelHeader
        title={t('title')}
        crumb={
          <>
            / {visible.length}
            {segment !== 'all' && ` ${t('ofTotal', { total: list.length })}`}
          </>
        }
        tutorial="clientes"
      />

      {/* Filtros en UNA fila en escritorio (pedido del cliente): cada control
          mide lo que su texto pide y el buscador es el único que se estira o
          encoge. Por debajo de 1280 px (o con el zoom del navegador al
          125-150 %) salta de línea en vez de salirse de su caja o esconder
          botones tras un scroll; «Nuevo cliente» siempre queda al final, a la
          derecha. El aviso de duplicados vive con los segmentos: no cabía en
          la fila y es un atajo, no un filtro. */}
      <div className="flex flex-wrap xl:flex-nowrap items-center gap-2 mb-4">
        <div className="flex items-center gap-2 bg-white border border-line rounded-pill px-3 py-1.5 min-w-[9rem] basis-full sm:basis-auto flex-1 sm:flex-none sm:w-56 xl:w-auto xl:flex-1 xl:max-w-[15rem]">
          <Icon name="search" size={14} className="text-mute shrink-0" />
          <input
            className="border-0 outline-none text-sm w-full min-w-0 bg-transparent"
            placeholder={t('searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="text-mute hover:text-ink text-sm"
              title={t('clear')}
            >
              ✕
            </button>
          )}
        </div>
        {locations.length > 0 && (
          <select
            className="basis-[calc(50%-0.25rem)] sm:basis-auto shrink-0 min-w-0 sm:w-auto sm:max-w-[11rem] truncate bg-white border border-line rounded-pill px-2.5 py-1.5 text-[13px]"
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            title={t('filterByLocation')}
          >
            <option value="">{t('allLocations')}</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                📍 {l.name}
              </option>
            ))}
          </select>
        )}
        {staff.length > 0 && (
          <select
            className="basis-[calc(50%-0.25rem)] sm:basis-auto shrink-0 min-w-0 sm:w-auto sm:max-w-[11rem] truncate bg-white border border-line rounded-pill px-2.5 py-1.5 text-[13px]"
            value={operatorId}
            onChange={(e) => setOperatorId(e.target.value)}
            title={t('filterByScanner')}
          >
            <option value="">{t('allScanners')}</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                👤 {s.fullName}
              </option>
            ))}
          </select>
        )}
        <select
          className="basis-[calc(50%-0.25rem)] sm:basis-auto shrink-0 min-w-0 sm:w-auto sm:max-w-[11rem] truncate bg-white border border-line rounded-pill px-2.5 py-1.5 text-[13px]"
          value={sinceDays}
          onChange={(e) => setSinceDays(e.target.value)}
          title={t('filterByActivity')}
        >
          <option value="">{t('anyDate')}</option>
          <option value="7">📅 {t('last7Days')}</option>
          <option value="30">📅 {t('last30Days')}</option>
          <option value="90">📅 {t('last90Days')}</option>
        </select>
        <ActionsMenu
          label={<>⤓ {t('export')} ▾</>}
          buttonClassName="btn-ghost text-xs shrink-0 whitespace-nowrap"
          menuWidth={240}
        >
          {(close) => (
            <>
              {(
                [
                  ['xlsx', t('exportExcelAll')],
                  ['csv-clientes', t('exportCsvCustomers')],
                  ['csv-sellos', t('exportCsvStamps')],
                ] as const
              ).map(([formato, etiqueta]) => (
                <button
                  key={formato}
                  type="button"
                  onClick={() => {
                    close();
                    void exportar(formato);
                  }}
                  className="block w-full text-left text-xs font-semibold px-3 py-2 text-ink transition hover:bg-gray-50"
                >
                  {etiqueta}
                </button>
              ))}
            </>
          )}
        </ActionsMenu>
        <button
          className="btn-primary shrink-0 whitespace-nowrap ml-auto"
          onClick={() => setShowForm(!showForm)}
        >
          <Icon name="plus" /> {showForm ? t('cancel') : t('newCustomer')}
        </button>
      </div>

      {/* Segment chips */}
      <div className="flex gap-1.5 flex-wrap mb-4">
        {SEGMENTS.map((s) => {
          const active = segment === s.key;
          const count = segmentCounts[s.key] ?? 0;
          return (
            <button
              key={s.key}
              onClick={() => setSegment(s.key)}
              title={s.help}
              className={`text-xs font-medium px-3 py-1.5 rounded-pill border transition ${
                active
                  ? 'bg-brand text-white border-brand'
                  : 'bg-white text-mute border-line hover:border-brand/50 hover:text-ink'
              }`}
            >
              <span className="mr-1">{s.emoji}</span>
              {s.label}
              <span
                className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full ${
                  active ? 'bg-white/20' : 'bg-bg2'
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
        {duplicateGroups > 0 && (
          <Link
            href="/app/customers/duplicates"
            className="shrink-0 whitespace-nowrap text-xs sm:ml-auto font-medium px-3 py-1.5 rounded-pill border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 transition flex items-center gap-1.5"
            title={t('duplicatesDetected')}
          >
            ⚠ {t('possibleDuplicates')}
            <span className="bg-amber-600 text-white text-[10px] px-1.5 py-0.5 rounded-full">
              {duplicateGroups}
            </span>
          </Link>
        )}
      </div>

      {/* Ordenar. Lo pidio Primor Barber: con 128 clientes, una lista por
          fecha de alta no sirve para buscar a nadie por su nombre, ni para
          saber a quien hay que felicitar esta semana. */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xs text-mute">{t('sortBy')}</span>
        <select
          className="input h-8 py-0 text-sm w-auto"
          value={orden}
          onChange={(e) => setOrden(e.target.value as Orden)}
        >
          {ORDENES.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {showForm && (
        <form
          onSubmit={create}
          className="card card-pad mb-4 grid grid-cols-1 md:grid-cols-3 gap-3"
        >
          <div>
            <label className="label">{t('name')}</label>
            <input
              className="input"
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              required
            />
          </div>
          {modoCorreo !== 'oculto' && (
            <div>
              <label className="label">{t('email')}</label>
              <input
                className="input"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                required={modoCorreo === 'obligatorio'}
              />
            </div>
          )}
          <div>
            <label className="label">{t('phone')}</label>
            <input
              className="input"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </div>
          {modoCumple === 'obligatorio' && (
            <div>
              <label className="label">{t('expc_birthday')}</label>
              <input
                className="input"
                type="date"
                value={form.birthday}
                onChange={(e) => setForm({ ...form, birthday: e.target.value })}
                required
              />
            </div>
          )}
          <div className="md:col-span-3">
            <button className="btn-primary" disabled={saving}>
              {saving ? t('saving') : t('save')}
            </button>
          </div>
        </form>
      )}

      <div className="card overflow-hidden p-0">
       <div className="overflow-x-auto">
        <table className="w-full text-[13.5px] min-w-[760px]">
          <thead className="bg-bg2">
            <tr>
              <th className="px-3 py-3.5 w-10">
                <input
                  type="checkbox"
                  className="cursor-pointer"
                  checked={
                    visible.length > 0 &&
                    visible
                      .filter((c) => !!c.phone)
                      .every((c) => selected.has(c.id))
                  }
                  onChange={toggleSelectAllVisible}
                  title={t('selectAllWithPhone')}
                />
              </th>
              {[
                { key: 'colCustomer', label: t('colCustomer') },
                { key: 'colContact', label: t('colContact') },
                { key: 'colPasses', label: t('colPasses') },
                { key: 'colOrders', label: t('colOrders') },
                { key: 'colLtv', label: t('colLtv') },
                { key: 'colLastScan', label: t('colLastScan') },
              ].map((h) => (
                <th
                  key={h.key}
                  className="text-left px-4 py-3.5 text-[11px] uppercase tracking-[0.1em] text-mute font-semibold"
                >
                  {h.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading &&
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={`sk-${i}`} className="border-t border-line2">
                  <td colSpan={7} className="px-4 py-3.5">
                    <div className="h-6 bg-bg2 rounded animate-shimmer" />
                  </td>
                </tr>
              ))}
            {!loading && visible.length === 0 && (
              <tr>
                <td className="px-4 py-12 text-center" colSpan={7}>
                  <div className="text-4xl mb-2">
                    {segment === 'all' ? '👥' : SEGMENTS.find((s) => s.key === segment)?.emoji}
                  </div>
                  <div className="font-semibold">
                    {search
                      ? t('noResultsFor', { term: search })
                      : segment === 'all'
                      ? t('noCustomersYet')
                      : t('noCustomersInSegment')}
                  </div>
                  <div className="text-xs text-mute mt-1 max-w-sm mx-auto">
                    {segment === 'all'
                      ? t('emptyHelp')
                      : SEGMENTS.find((s) => s.key === segment)?.help}
                  </div>
                </td>
              </tr>
            )}
            {!loading &&
              ordenados.map((c) => (
                <tr
                  key={c.id}
                  className={`border-t border-line2 hover:bg-[#FAFAFB] ${
                    selected.has(c.id) ? 'bg-brand-soft/30' : ''
                  }`}
                >
                  <td className="px-3 py-3.5">
                    <input
                      type="checkbox"
                      className="cursor-pointer disabled:opacity-30"
                      checked={selected.has(c.id)}
                      disabled={!c.phone}
                      onChange={() => toggleSelect(c.id)}
                      title={
                        c.phone
                          ? t('selectForCampaign')
                          : t('noPhoneCannotContact')
                      }
                    />
                  </td>
                  <td className="px-4 py-3.5">
                    <Link
                      href={`/app/customers/${c.id}`}
                      className="flex items-center gap-2.5 hover:text-brand"
                    >
                      <span
                        className={`avatar w-8 h-8 text-xs ${avatarClass(c.fullName)}`}
                      >
                        {initials(c.fullName)}
                      </span>
                      <div>
                        <div className="font-medium">{c.fullName}</div>
                        <div className="flex items-center gap-1 flex-wrap">
                          {c.totalOrdersCount >= 3 && (
                            <span className="badge text-[9px] bg-amber-100 text-amber-800 mt-0.5">
                              👑 VIP
                            </span>
                          )}
                          {c.birthday && (
                            <span
                              className={`badge text-[9px] mt-0.5 ${
                                birthdayMonth(c.birthday) === new Date().getMonth()
                                  ? 'bg-pink-100 text-pink-700'
                                  : 'bg-bg2 text-mute'
                              }`}
                            >
                              🎂 {fmtBday(c.birthday)}
                            </span>
                          )}
                        </div>
                      </div>
                    </Link>
                  </td>
                  <td className="px-4 py-3.5 text-mute text-xs">
                    <div>{c.phone || '—'}</div>
                    {c.email && (
                      <div className="text-mute2 truncate max-w-[180px]">
                        {c.email}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3.5">
                    <span
                      className={`badge ${
                        (c._count?.passes ?? 0) > 0 ? 'badge-info' : 'badge-mute'
                      }`}
                    >
                      {c._count?.passes ?? 0}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 font-medium">
                    {c.totalOrdersCount ?? 0}
                  </td>
                  <td className="px-4 py-3.5 text-xs">
                    {Number(c.totalOrdersAmount) > 0
                      ? COP(Number(c.totalOrdersAmount))
                      : '—'}
                  </td>
                  <td className="px-4 py-3.5 text-xs">
                    {(() => {
                      const last = c.stamps?.[0];
                      if (!last) return <span className="text-mute">—</span>;
                      const who =
                        last.operator?.fullName ?? last.operator?.email ?? '—';
                      return (
                        <div>
                          <div
                            className="font-medium text-ink truncate max-w-[160px]"
                            title={last.operator?.email ?? ''}
                          >
                            👤 {who}
                          </div>
                          <div className="text-mute2 truncate max-w-[160px]">
                            {last.location
                              ? `📍 ${last.location.name}`
                              : t('noLocation')}
                            {' · '}
                            {fmtDate(last.createdAt)}
                          </div>
                        </div>
                      );
                    })()}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
       </div>
      </div>

      {/* Barra flotante de selección */}
      {selected.size > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 bg-ink text-white rounded-full shadow-2xl pl-5 pr-2 py-2 flex items-center gap-3">
          <span className="text-sm font-semibold">
            {t('selectedCount', { count: selected.size })}
          </span>
          <button
            onClick={() => setSelected(new Set())}
            className="text-white/70 hover:text-white text-xs"
          >
            {t('clear')}
          </button>
          <button
            onClick={() => setWaOpen(true)}
            className="bg-ok text-white text-sm font-semibold px-4 py-2 rounded-full inline-flex items-center gap-1.5 hover:bg-ok/90"
          >
            <Icon name="send" size={14} /> {t('sendWhatsApp')}
          </button>
          <button
            onClick={async () => {
              const n = selected.size;
              const msg = t('deleteConfirm', { count: n });
              const confirmText = window.prompt(msg);
              if ((confirmText ?? '').trim().toUpperCase() !== t('deleteConfirmKeyword')) return;
              let ok = 0;
              let fail = 0;
              for (const id of Array.from(selected)) {
                try {
                  await api(`/customers/${id}`, { method: 'DELETE' });
                  ok++;
                } catch {
                  fail++;
                }
              }
              setSelected(new Set());
              toast(
                fail > 0
                  ? t('deleteResultPartial', { ok, fail })
                  : t('deleteResultAll', { count: ok }),
                fail > 0 ? 'error' : 'success',
              );
              load();
            }}
            className="bg-bad text-white text-sm font-semibold px-4 py-2 rounded-full inline-flex items-center gap-1.5 hover:bg-bad/90"
          >
            <Icon name="trash" size={14} /> {t('delete')}
          </button>
        </div>
      )}

      {/* Modal: campaña WhatsApp */}
      {waOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-ink/60"
            onClick={() => setWaOpen(false)}
          />
          <div className="relative bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-line2 flex items-center justify-between">
              <div>
                <h2 className="font-bold text-lg">{t('waCampaign')}</h2>
                <p className="text-xs text-mute mt-0.5">
                  {t('recipientsWithPhone', { count: selectedCustomers.length })}
                </p>
              </div>
              <button
                onClick={() => setWaOpen(false)}
                className="text-mute hover:text-ink text-lg"
                aria-label={t('close')}
              >
                ✕
              </button>
            </div>

            <div className="px-6 py-4 border-b border-line2">
              <label className="label">
                {t('messageLabelBefore')} <code>{'{{nombre}}'}</code> {t('messageLabelAfter')}
              </label>
              <textarea
                className="input min-h-[100px]"
                value={waMessage}
                onChange={(e) => setWaMessage(e.target.value)}
                placeholder={t('waMessagePlaceholder')}
                maxLength={1000}
              />
              <div className="text-xs text-mute mt-1.5 flex items-center justify-between">
                <span>
                  {t('waWebHint')}
                </span>
                <span>{waMessage.length}/1000</span>
              </div>
            </div>

            <div className="flex-1 overflow-auto px-6 py-4">
              <div className="text-[11px] uppercase tracking-wider text-mute font-semibold mb-2">
                {t('sendList')}
              </div>
              {selectedCustomers.length === 0 ? (
                <div className="text-sm text-mute text-center py-6">
                  {t('noneHasPhone')}
                </div>
              ) : (
                <div className="space-y-1.5">
                  {selectedCustomers.map((c) => (
                    <div
                      key={c.id}
                      className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-bg2/50 hover:bg-bg2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-sm truncate">
                          {c.fullName}
                        </div>
                        <div className="text-xs text-mute">{c.phone}</div>
                      </div>
                      <a
                        href={buildWaLink(c)}
                        target="_blank"
                        rel="noreferrer"
                        className="bg-ok text-white text-xs font-semibold px-3 py-1.5 rounded-full inline-flex items-center gap-1 hover:bg-ok/90 whitespace-nowrap"
                      >
                        {t('openChat')} →
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="px-6 py-3 border-t border-line2 bg-bg2/40 flex items-center justify-between">
              <div className="text-xs text-mute">
                💡 {t('massCampaignHintBefore')}{' '}
                <Link
                  href="/app/automations"
                  className="text-brand hover:underline"
                >
                  {t('whatsappAutomations')}
                </Link>
                {t('massCampaignHintAfter')}
              </div>
              <button
                onClick={() => setWaOpen(false)}
                className="btn-ghost text-sm"
              >
                {t('close')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
