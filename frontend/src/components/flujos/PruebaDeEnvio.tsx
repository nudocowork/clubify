'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';

// «Enviar prueba» dentro del panel de un paso de mensaje. Lo usan los DOS
// constructores: lo único que cambia entre ellos es `base`, la raíz de sus
// rutas. Qué pasos lo enseñan NO se decide aquí con una lista de tipos escrita
// a mano, sino con `paso.prueba` del catálogo — así un canal nuevo en el
// backend aparece solo.
//
// Colores: los tokens `brand`, que `.brand-panel` tiñe con el color de cada
// marca. Nada de `hover:*-brand*`: el override mira el atributo `class`, no el
// estado, y lo pintaría SIEMPRE.

type Destinos = { telefono: string | null; correo: string | null };

const inp = 'input';

export function PruebaDeEnvio({
  canal,
  base,
  config,
}: {
  canal: 'sms' | 'email';
  /** Raíz de las rutas del constructor: `/admin/marketing/workflows` o `/admin/workflows`. */
  base: string;
  /** La configuración del paso TAL CUAL está ahora: se manda sin guardar el flujo. */
  config: Record<string, unknown>;
}) {
  const [destinos, setDestinos] = useState<Destinos | null>(null);
  const [escrito, setEscrito] = useState('');
  const [cambiando, setCambiando] = useState(false);
  const [enviando, setEnviando] = useState(false);

  const guardado = canal === 'sms' ? destinos?.telefono ?? null : destinos?.correo ?? null;
  const etiqueta = canal === 'sms' ? 'Teléfono de prueba' : 'Correo de prueba';

  useEffect(() => {
    let vivo = true;
    api<Destinos>(`${base}/prueba/destinos`)
      .then((d) => vivo && setDestinos(d))
      // Que no se pueda leer el destino no rompe el panel: se pide escribirlo.
      .catch(() => vivo && setDestinos({ telefono: null, correo: null }));
    return () => {
      vivo = false;
    };
  }, [base]);

  const enviar = useCallback(async () => {
    setEnviando(true);
    try {
      const res = await api<{ ok: boolean; destino: string | null; motivo?: string }>(`${base}/prueba`, {
        method: 'POST',
        body: JSON.stringify({
          canal,
          message: String(config.message ?? ''),
          subject: String(config.subject ?? ''),
          body: String(config.body ?? ''),
          templateId: String(config.templateId ?? ''),
          // Solo viaja si se escribió ahora: el servidor lo guarda como destino
          // de prueba de la marca antes de mandar nada.
          ...(escrito.trim() ? { destino: escrito.trim() } : {}),
        }),
      });
      if (!res.ok) {
        toast(res.motivo || 'No se pudo enviar la prueba.', 'error');
        return;
      }
      toast(`Prueba enviada a ${res.destino}.`, 'success');
      if (escrito.trim() && res.destino) {
        setDestinos((d) => ({ ...(d ?? { telefono: null, correo: null }), [canal === 'sms' ? 'telefono' : 'correo']: res.destino }));
        setEscrito('');
        setCambiando(false);
      }
    } catch (e: any) {
      toast(e?.message || 'No se pudo enviar la prueba.', 'error');
    } finally {
      setEnviando(false);
    }
  }, [base, canal, config, escrito]);

  const pidiendoDestino = cambiando || (destinos !== null && !guardado);

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
      <button
        type="button"
        onClick={enviar}
        disabled={enviando || destinos === null || (pidiendoDestino && !escrito.trim())}
        className="w-full rounded-lg border border-brand bg-brand-soft px-3 py-2 text-sm font-semibold text-brand disabled:opacity-50"
      >
        {enviando ? 'Enviando…' : 'Enviar prueba'}
      </button>

      {pidiendoDestino ? (
        <div className="mt-2">
          <label className="mb-1 block text-[11px] font-medium text-slate-500">{etiqueta}</label>
          <input
            value={escrito}
            onChange={(e) => setEscrito(e.target.value)}
            inputMode={canal === 'sms' ? 'tel' : 'email'}
            placeholder={canal === 'sms' ? '+57 300 111 2233' : 'tu@correo.com'}
            className={inp}
          />
          <p className="mt-1 text-[11px] text-slate-400">Se guarda para las próximas pruebas de tu marca.</p>
        </div>
      ) : (
        <p className="mt-2 text-[11px] text-slate-500">
          {destinos === null ? (
            'Cargando el destino de prueba…'
          ) : (
            <>
              Llega a <strong className="text-slate-700">{guardado}</strong>{' '}
              <button type="button" onClick={() => setCambiando(true)} className="btn-link">
                cambiar
              </button>
            </>
          )}
        </p>
      )}

      <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
        Sale lo que hay escrito ahora mismo, sin guardar el flujo. Las variables llevan valores de ejemplo ({'{{nombre}}'} → «Ana») y el
        mensaje empieza por «PRUEBA · » para que no se confunda con uno de verdad.
      </p>
    </div>
  );
}
