'use client';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';
import { subirArchivo, ErrorDeSubida, type EstadoDeSubida } from '@/lib/subir-archivo';

// =====================================================
// Recordatorio con datos de pago
// =====================================================
// A los negocios que pagan por fuera, justo después de cada aviso de cobro
// (7, 3 y 1 día antes, el día del cobro y los días de mora), les sale un
// segundo mensaje con esta imagen y este texto. Backend:
// GET/PATCH /billing/datos-de-pago-manual (solo plataforma).
//
// La imagen se SUBE al almacenamiento de archivos (no se guarda en la base):
// en la configuración solo queda su enlace.

type DatosDePago = { activo: boolean; imagenUrl: string; mensaje: string };

const MAX_MENSAJE = 600;

export function DatosDePagoCard() {
  const [guardado, setGuardado] = useState<DatosDePago | null>(null);
  const [form, setForm] = useState<DatosDePago | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Un admin de marca blanca entra a esta página pero los datos bancarios son
  // de Clubify: el backend le responde 403 y la tarjeta no se pinta.
  const [oculta, setOculta] = useState(false);
  const [saving, setSaving] = useState(false);
  const [subida, setSubida] = useState<EstadoDeSubida | null>(null);
  const [pct, setPct] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ datos: DatosDePago }>('/billing/datos-de-pago-manual');
      setGuardado(res.datos);
      setForm(res.datos);
    } catch (e: any) {
      if (e?.status === 403) setOculta(true);
      else setError(e?.message || 'No se pudieron cargar los datos de pago');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  if (oculta) return null;

  const cambiado =
    !!form &&
    !!guardado &&
    (form.activo !== guardado.activo ||
      form.imagenUrl.trim() !== guardado.imagenUrl ||
      form.mensaje.trim() !== guardado.mensaje);
  const subiendo = subida === 'validando' || subida === 'subiendo' || subida === 'procesando';

  async function guardar() {
    if (!form || saving) return;
    const datos = form;
    if (!/^https:\/\//i.test(datos.imagenUrl.trim())) {
      toast('La imagen debe ser un enlace que empiece por https://', 'error');
      return;
    }
    if (!datos.mensaje.trim()) {
      toast('Escribe el mensaje que acompaña a la imagen', 'error');
      return;
    }
    setSaving(true);
    try {
      const res = await api<{ datos: DatosDePago }>('/billing/datos-de-pago-manual', {
        method: 'PATCH',
        body: JSON.stringify({
          activo: datos.activo,
          imagenUrl: datos.imagenUrl.trim(),
          mensaje: datos.mensaje.trim(),
        }),
      });
      // Se pinta lo que QUEDÓ guardado, no lo que se escribió.
      setGuardado(res.datos);
      setForm(res.datos);
      toast('Datos de pago guardados', 'success');
    } catch (e: any) {
      toast(e?.message || 'No se pudieron guardar los datos de pago', 'error');
    } finally {
      setSaving(false);
    }
  }

  /** Solo el interruptor: no se lleva consigo lo que esté a medio escribir. */
  async function cambiarActivo() {
    if (!form || !guardado || saving) return;
    const activo = !form.activo;
    setSaving(true);
    try {
      const res = await api<{ datos: DatosDePago }>('/billing/datos-de-pago-manual', {
        method: 'PATCH',
        body: JSON.stringify({ activo }),
      });
      setGuardado(res.datos);
      setForm((f) => (f ? { ...f, activo: res.datos.activo } : f));
      toast(activo ? 'Datos de pago activados' : 'Datos de pago desactivados', 'success');
    } catch (e: any) {
      toast(e?.message || 'No se pudo cambiar el envío', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function alElegirArchivo(file: File | undefined) {
    if (!file || !form) return;
    setPct(0);
    try {
      const r = await subirArchivo(file, {
        // Formato compatible (JPG/PNG): WhatsApp y los MMS no siempre abren WebP.
        uso: 'IMAGEN_CORREO',
        alProgreso: setPct,
        alEstado: setSubida,
      });
      setForm({ ...form, imagenUrl: r.url });
      toast('Imagen subida. Pulsa «Guardar» para usarla.', 'success');
    } catch (e: any) {
      toast(
        e instanceof ErrorDeSubida ? e.message : 'No se pudo subir la imagen',
        'error',
      );
    } finally {
      setSubida(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="card card-pad mt-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">Recordatorio con datos de pago</h2>
          <p className="text-xs text-mute leading-snug mt-0.5 max-w-2xl">
            A los negocios que pagan por fuera, justo después de cada aviso de cobro
            (7, 3 y 1 día antes, el día del cobro y mientras el pago está vencido), les
            llega un segundo mensaje con esta imagen y este texto, al mismo número. A
            los que pagan con tarjeta no les llega.
          </p>
        </div>
      </div>

      {loading && <div className="h-40 bg-bg2 rounded animate-shimmer mt-4" />}

      {error && !loading && (
        <div className="mt-3">
          <div className="text-sm text-bad-ink">{error}</div>
          <button type="button" className="btn-ghost text-sm mt-2" onClick={load}>
            Reintentar
          </button>
        </div>
      )}

      {!loading && !error && form && (
        <>
          <div className="mt-4 flex items-start gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={form.activo}
              aria-label="Enviar los datos de pago con los avisos de cobro"
              disabled={saving}
              // El interruptor guarda al momento: es lo que se espera de un
              // interruptor, y así no queda «apagado» solo en pantalla.
              onClick={cambiarActivo}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition mt-0.5 disabled:opacity-60 ${
                form.activo ? 'bg-brand' : 'bg-mute2'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition ${
                  form.activo ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
            <div className="min-w-0">
              <div className="text-sm font-semibold">
                {form.activo ? 'Se envía con cada aviso de cobro' : 'No se envía'}
              </div>
              <p className="text-xs text-mute leading-snug mt-0.5">
                Apagado, los negocios que pagan por fuera solo reciben el aviso de cobro.
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-5 md:grid-cols-[minmax(0,260px)_1fr]">
            <div>
              <div className="label">Imagen</div>
              <div className="rounded-xl border border-line2 bg-bg2 overflow-hidden aspect-[3/4] flex items-center justify-center">
                {form.imagenUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={form.imagenUrl}
                    alt="Vista previa de los datos de pago"
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <span className="text-xs text-mute">Sin imagen</span>
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png"
                className="hidden"
                onChange={(e) => alElegirArchivo(e.target.files?.[0])}
              />
              <button
                type="button"
                className="btn-ghost text-sm w-full justify-center mt-2 disabled:opacity-50"
                disabled={subiendo || saving}
                onClick={() => fileRef.current?.click()}
              >
                {subida === 'procesando'
                  ? 'Procesando…'
                  : subiendo
                    ? `Subiendo… ${pct}%`
                    : 'Subir otra imagen'}
              </button>
            </div>

            <div className="min-w-0 space-y-4">
              <div>
                <label className="label" htmlFor="datos-pago-url">
                  Enlace de la imagen
                </label>
                <input
                  id="datos-pago-url"
                  className="input w-full font-mono text-xs"
                  value={form.imagenUrl}
                  onChange={(e) => setForm({ ...form, imagenUrl: e.target.value })}
                  placeholder="https://"
                  inputMode="url"
                />
                <p className="text-xs text-mute mt-1">
                  Se llena solo al subir una imagen. También puedes pegar un enlace https://.
                </p>
              </div>

              <div>
                <label className="label" htmlFor="datos-pago-mensaje">
                  Mensaje que acompaña a la imagen
                </label>
                <textarea
                  id="datos-pago-mensaje"
                  className="input w-full min-h-[110px] leading-snug"
                  maxLength={MAX_MENSAJE}
                  value={form.mensaje}
                  onChange={(e) => setForm({ ...form, mensaje: e.target.value })}
                />
                <div className="text-xs text-mute mt-1 text-right tabular-nums">
                  {form.mensaje.length}/{MAX_MENSAJE}
                </div>
              </div>

              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
                {cambiado && (
                  <button
                    type="button"
                    className="btn-ghost text-sm justify-center"
                    disabled={saving}
                    onClick={() => guardado && setForm(guardado)}
                  >
                    Descartar cambios
                  </button>
                )}
                <button
                  type="button"
                  className="btn-primary text-sm disabled:opacity-50"
                  disabled={!cambiado || saving || subiendo}
                  onClick={guardar}
                >
                  {saving ? 'Guardando…' : 'Guardar'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
