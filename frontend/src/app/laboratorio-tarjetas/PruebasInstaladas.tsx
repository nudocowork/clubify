'use client';
/**
 * «Pruebas instaladas»: las tarjetas de prueba que ya se armaron desde el
 * laboratorio, con botones para dar o quitar sellos (o gasto, o saldo). Cada
 * cambio llega al celular como llega el de un cliente real: franja nueva, push
 * al iPhone y aviso en Google Wallet.
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { ESTILOS } from '@/lib/cards/estilos-de-franja';
import { Codigo } from './InstalarEnCelular';

type Prueba = {
  id: string;
  creado: string;
  actualizado: string;
  negocio: string;
  titular: string;
  estilo: string;
  requeridos: number;
  premio: string;
  unidad: string;
  moneda: string;
  sellados: number;
  gastado: number;
  saldo: number;
  aviso: string | null;
  franjaUrl: string;
  appleUrl: string | null;
  googleUrl: string | null;
  iphones: number;
  actualizaciones: boolean;
};

type Respuesta = {
  prueba: Prueba;
  apple: { enviados: number; fallidos: number };
  google: 'actualizado' | 'no_guardado' | 'no_configurado' | 'error';
};

const nombreDelEstilo = (id: string) => ESTILOS.find((e) => e.id === id)?.nombre ?? id;

const fecha = (iso: string) =>
  new Date(iso).toLocaleString('es', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/** Lo que pasó con cada billetera, en palabras. */
function resumenDelEnvio(r: Respuesta): string {
  const partes: string[] = [];
  if (r.prueba.iphones === 0) partes.push('iPhone: ninguno conectado todavía');
  else if (r.apple.enviados > 0) partes.push(`iPhone: avisado (${r.apple.enviados})`);
  else partes.push('iPhone: Apple no aceptó el aviso');
  partes.push(
    r.google === 'actualizado'
      ? 'Android: actualizado'
      : r.google === 'no_guardado'
        ? 'Android: aún no la guardaron en Google Wallet'
        : r.google === 'no_configurado'
          ? 'Android: Google Wallet no está configurado'
          : 'Android: Google dio error',
  );
  return partes.join(' · ');
}

export function PruebasInstaladas({ version }: { version: number }) {
  const [pruebas, setPruebas] = useState<Prueba[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      setPruebas(await api<Prueba[]>('/wallet/laboratorio/pases'));
    } catch (e: any) {
      const m = String(e?.message ?? e);
      setError(
        /401|403|unauthor|forbidden|denegad/i.test(m)
          ? 'Para ver las pruebas necesitas haber iniciado sesión con tu cuenta del equipo de Clubify en este navegador.'
          : m,
      );
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar, version]);

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <h2 className="text-base font-semibold m-0">Pruebas instaladas</h2>
          <p className="text-xs text-mute m-0 mt-0.5">
            Dale sellos a una tarjeta de prueba y mira en el celular lo que verá tu cliente: la franja nueva y la
            notificación.
          </p>
        </div>
        <button type="button" className="btn-ghost" onClick={() => void cargar()}>
          Actualizar lista
        </button>
      </div>

      {error && <p className="text-sm text-bad bg-red-50 rounded-input px-3 py-2">{error}</p>}
      {!pruebas && !error && <div className="pulse-soft h-40 rounded-card" />}
      {pruebas?.length === 0 && (
        <div className="card card-pad text-sm text-mute">
          Todavía no hay pruebas. Arma un diseño en el editor y pulsa «Instalar en mi celular».
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {pruebas?.map((p) => (
          <TarjetaDePrueba
            key={p.id}
            p={p}
            onCambio={(nueva) => setPruebas((l) => l?.map((x) => (x.id === nueva.id ? nueva : x)) ?? null)}
            onQuitada={() => setPruebas((l) => l?.filter((x) => x.id !== p.id) ?? null)}
          />
        ))}
      </div>
    </section>
  );
}

function TarjetaDePrueba({
  p,
  onCambio,
  onQuitada,
}: {
  p: Prueba;
  onCambio: (p: Prueba) => void;
  onQuitada: () => void;
}) {
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verQr, setVerQr] = useState(false);

  const mover = async (cambio: Partial<Pick<Prueba, 'sellados' | 'gastado' | 'saldo'>>) => {
    setEnviando(true);
    setError(null);
    setResultado(null);
    try {
      const r = await api<Respuesta>(`/wallet/laboratorio/pases/${p.id}/progreso`, {
        method: 'POST',
        body: JSON.stringify(cambio),
      });
      onCambio(r.prueba);
      setResultado(resumenDelEnvio(r));
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setEnviando(false);
    }
  };

  const quitar = async () => {
    if (!window.confirm('¿Quitar esta prueba de la lista? En el celular se queda instalada, pero ya no se podrá mover.')) {
      return;
    }
    try {
      await api(`/wallet/laboratorio/pases/${p.id}`, { method: 'DELETE' });
      onQuitada();
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  };

  const completa = p.sellados >= p.requeridos;
  const dinero = (n: number) => `${p.moneda}${n.toLocaleString('es', { maximumFractionDigits: 2 })}`;

  return (
    <article className="card overflow-hidden flex flex-col">
      {/* eslint-disable-next-line @next/next/no-img-element -- imagen del bucket, ya del tamaño final */}
      <img src={p.franjaUrl} alt={`Franja de ${p.negocio}`} className="w-full aspect-[640/246] object-cover bg-bg2" />
      <div className="card-pad space-y-3 flex-1 flex flex-col">
        <div>
          <div className="text-sm font-semibold">
            {p.negocio} · <span className="font-normal text-mute">{nombreDelEstilo(p.estilo)}</span>
          </div>
          <div className="text-xs text-mute">
            {p.titular} · creada {fecha(p.creado)}
          </div>
        </div>

        <div className="text-2xl font-semibold tabular-nums">
          {p.estilo === 'SALDO'
            ? dinero(p.saldo)
            : p.estilo === 'VIP'
              ? `${dinero(p.gastado)} gastados`
              : `${p.sellados}/${p.requeridos} ${p.unidad}`}
        </div>

        {!p.actualizaciones ? (
          <p className="text-xs text-mute">Esta prueba no recibe cambios: el servidor no tiene la llave para firmarlos.</p>
        ) : p.estilo === 'SALDO' ? (
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-ghost" disabled={enviando} onClick={() => mover({ saldo: p.saldo - 5 })}>
              − {dinero(5)}
            </button>
            <button type="button" className="btn-primary" disabled={enviando} onClick={() => mover({ saldo: p.saldo + 5 })}>
              + {dinero(5)}
            </button>
          </div>
        ) : p.estilo === 'VIP' ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-ghost"
              disabled={enviando || p.gastado <= 0}
              onClick={() => mover({ gastado: Math.max(0, p.gastado - 50) })}
            >
              − {dinero(50)}
            </button>
            <button type="button" className="btn-primary" disabled={enviando} onClick={() => mover({ gastado: p.gastado + 50 })}>
              Compra de {dinero(50)}
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-ghost"
              disabled={enviando || p.sellados <= 0}
              onClick={() => mover({ sellados: p.sellados - 1 })}
            >
              − Quitar sello
            </button>
            {completa ? (
              <button type="button" className="btn-primary" disabled={enviando} onClick={() => mover({ sellados: 0 })}>
                Canjear premio
              </button>
            ) : (
              <button type="button" className="btn-primary" disabled={enviando} onClick={() => mover({ sellados: p.sellados + 1 })}>
                + Dar sello
              </button>
            )}
          </div>
        )}

        {enviando && <p className="text-xs text-mute">Enviando al celular…</p>}
        {resultado && <p className="text-xs text-mute bg-bg2 rounded-input px-2.5 py-1.5">{resultado}</p>}
        {error && <p className="text-xs text-bad bg-red-50 rounded-input px-2.5 py-1.5">{error}</p>}

        <div className="mt-auto pt-1 flex items-center gap-3 text-xs text-mute">
          <span>{p.iphones === 1 ? '1 iPhone conectado' : `${p.iphones} iPhones conectados`}</span>
          <button type="button" className="btn-link text-xs ml-auto" onClick={() => setVerQr((v) => !v)}>
            {verQr ? 'Ocultar códigos' : 'Instalar en otro celular'}
          </button>
          <button type="button" className="text-xs text-mute hover:text-bad" onClick={quitar}>
            Quitar
          </button>
        </div>

        {verQr && (
          <div className="grid grid-cols-2 gap-3">
            <Codigo titulo="iPhone" url={p.appleUrl} faltante="Apple Wallet no está configurado." tam={120} />
            <Codigo titulo="Android" url={p.googleUrl} faltante="Google Wallet no está configurado." tam={120} />
          </div>
        )}
      </div>
    </article>
  );
}
