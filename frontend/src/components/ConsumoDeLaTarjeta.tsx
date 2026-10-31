'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

type Tramo = { total: number; compras: number; ticketPromedio: number };
type Consumo = {
  historico: Tramo;
  desdeElCanje: Tramo;
  ultimoCanjeAt: string | null;
  ultimaCompraAt: string | null;
  sinMonto: number;
  regalos: number;
  moneda: { currency: string; currencySymbol: string | null };
};

function dinero(n: number, m: Consumo['moneda']) {
  try {
    const partes = new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: m.currency,
      maximumFractionDigits: 0,
    }).formatToParts(n);
    const simbolo = m.currencySymbol?.trim();
    return partes.map((p) => (p.type === 'currency' && simbolo ? simbolo : p.value)).join('');
  } catch {
    return `${m.currencySymbol?.trim() || '$'}${n.toFixed(0)}`;
  }
}

const fecha = (s: string) =>
  new Date(s).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });

const compras = (n: number) => `${n} ${n === 1 ? 'compra' : 'compras'}`;

/**
 * Lo que el cliente ha consumido en esta tarjeta, a la vista de quien va a
 * entregar el premio: en la caja y en la ficha del cliente. `version` vuelve a
 * pedir el dato cuando el pase cambia (un sello o un canje recién hechos).
 */
export function ConsumoDeLaTarjeta({ passId, version }: { passId: string; version?: unknown }) {
  const [c, setC] = useState<Consumo | null>(null);

  useEffect(() => {
    let vigente = true;
    api<Consumo>(`/stamps/consumo/${passId}`)
      .then((r) => vigente && setC(r))
      // Un dato de apoyo: si no llega, el canje sigue funcionando igual.
      .catch(() => vigente && setC(null));
    return () => {
      vigente = false;
    };
  }, [passId, version]);

  if (!c || (c.historico.compras === 0 && c.sinMonto === 0 && c.regalos === 0)) return null;

  const notas = [
    c.ultimoCanjeAt ? `Último canje: ${fecha(c.ultimoCanjeAt)}` : 'Aún no ha canjeado',
    c.regalos > 0 ? `${c.regalos} ${c.regalos === 1 ? 'sello regalado' : 'sellos regalados'}` : null,
    c.sinMonto > 0
      ? `${c.sinMonto} ${c.sinMonto === 1 ? 'sello' : 'sellos'} sin monto registrado, no ${
          c.sinMonto === 1 ? 'suma' : 'suman'
        } al total`
      : null,
  ].filter(Boolean);

  return (
    <div className="mt-3 rounded-xl border border-line2 p-3 text-left">
      <div className="text-[10px] uppercase tracking-[0.18em] text-mute font-semibold mb-2">
        Consumo en esta tarjeta
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="min-w-0">
          <div className="text-[11px] text-mute">
            {c.ultimoCanjeAt ? 'Desde el último canje' : 'Para este premio'}
          </div>
          <div className="text-lg font-bold text-brand break-words">
            {dinero(c.desdeElCanje.total, c.moneda)}
          </div>
          <div className="text-[11px] text-mute">{compras(c.desdeElCanje.compras)}</div>
        </div>
        <div className="min-w-0">
          <div className="text-[11px] text-mute">Total en la tarjeta</div>
          <div className="text-lg font-bold break-words">{dinero(c.historico.total, c.moneda)}</div>
          <div className="text-[11px] text-mute">
            {compras(c.historico.compras)}
            {c.historico.compras > 0 && ` · promedio ${dinero(c.historico.ticketPromedio, c.moneda)}`}
          </div>
        </div>
      </div>
      <div className="text-[11px] text-mute mt-2">{notas.join(' · ')}</div>
    </div>
  );
}
