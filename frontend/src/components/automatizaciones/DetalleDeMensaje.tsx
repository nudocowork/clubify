'use client';

/**
 * Panel lateral con TODO lo que se puede hacer con un mensaje automático:
 * editar el texto y el asunto, insertar tokens, restaurar el default, probarlo,
 * apagar o encender su envío y moverlo de carpeta.
 *
 * Está aparte del listado porque antes todo esto vivía dentro de la tarjeta y
 * el editor de correo quedaba a media pantalla de scroll del botón de guardar.
 *
 * Colores por tokens (`brand`) y estados con `warn`/`bad`: bajo `.brand-panel`
 * la marca tiñe lo suyo sin tocar este archivo.
 */

import { useCallback, useEffect, useRef } from 'react';
import {
  correoDe,
  nombreDeCanal,
  type BorradorDeCorreo,
  type BrandMsgFolder,
  type BrandMsgTemplate,
} from './tipos';

type Props = {
  t: BrandMsgTemplate;
  carpetas: BrandMsgFolder[];
  draftTexto: string;
  onDraftTexto: (v: string) => void;
  draftCorreo: BorradorDeCorreo | null;
  onDraftCorreo: (v: BorradorDeCorreo) => void;
  guardandoTexto: boolean;
  guardandoCorreo: boolean;
  probandoTexto: boolean;
  probandoCorreo: boolean;
  /** Hay una operación de carpeta/encendido en curso. */
  ocupado: boolean;
  telefonoPrueba: string;
  correoPrueba: string;
  growConnected: boolean;
  emailConnected: boolean;
  onGuardarTexto: (texto: string) => void;
  onProbarTexto: (texto: string) => void;
  onGuardarCorreo: (correoId: string, asunto: string, cuerpo: string) => void;
  onProbarCorreo: (correoId: string, asunto: string, cuerpo: string) => void;
  onAlternarEnvio: (id: string, activar: boolean) => void;
  onMover: (folderId: string) => void;
  onCerrar: () => void;
};

/** Botón principal (guardar): el único que va del color de la marca. */
const BOTON_PRIMARIO =
  'min-h-[44px] rounded-input px-4 text-xs font-semibold text-white bg-brand hover:opacity-90 disabled:bg-line disabled:text-mute2 disabled:hover:opacity-100';
const BOTON_NEUTRO =
  'min-h-[44px] rounded-input border border-line bg-white px-4 text-xs font-semibold text-ink hover:bg-bg2 disabled:opacity-50';
const BOTON_PELIGRO =
  'min-h-[44px] rounded-input border border-bad-soft bg-white px-4 text-xs font-semibold text-bad hover:bg-bad-soft disabled:opacity-50';

export default function DetalleDeMensaje({
  t,
  carpetas,
  draftTexto,
  onDraftTexto,
  draftCorreo,
  onDraftCorreo,
  guardandoTexto,
  guardandoCorreo,
  probandoTexto,
  probandoCorreo,
  ocupado,
  telefonoPrueba,
  correoPrueba,
  growConnected,
  emailConnected,
  onGuardarTexto,
  onProbarTexto,
  onGuardarCorreo,
  onProbarCorreo,
  onAlternarEnvio,
  onMover,
  onCerrar,
}: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const refTexto = useRef<HTMLTextAreaElement>(null);
  const refAsunto = useRef<HTMLInputElement>(null);
  const refCuerpo = useRef<HTMLTextAreaElement>(null);
  // En qué campo del correo cayó el cursor por última vez: los tokens del
  // correo se insertan ahí. El asunto los usa tanto como el cuerpo («Tu pedido
  // {codigo} está listo»), y una fila de tokens que siempre escribe en el
  // cuerpo obliga a teclearlos a mano en el asunto.
  const ultimoCampoDelCorreo = useRef<'asunto' | 'cuerpo'>('cuerpo');

  const correo = correoDe(t);
  // Una tarjeta de canal EMAIL ES su propio correo: encender el correo y
  // encender el mensaje serían el mismo botón, así que el bloque de correo no
  // pinta el suyo y manda el de la cabecera.
  const esSoloCorreo = t.channel === 'EMAIL';
  const hayWhatsapp = t.channel === 'SMS';
  const dCorreo: BorradorDeCorreo | null =
    draftCorreo ?? (correo ? { subject: correo.subject, body: correo.body } : null);
  const textoSucio = draftTexto !== t.text;
  const correoSucio =
    !!correo &&
    !!dCorreo &&
    (dCorreo.subject !== correo.subject || dCorreo.body !== correo.body);

  useEffect(() => {
    function alTeclado(e: KeyboardEvent) {
      if (e.key === 'Escape') onCerrar();
    }
    document.addEventListener('keydown', alTeclado);
    return () => document.removeEventListener('keydown', alTeclado);
  }, [onCerrar]);

  // El bloqueo del scroll va en SU PROPIO efecto, sin dependencias: si viviera
  // con el de Escape —que depende de `onCerrar`— cada render del padre lo
  // volvería a montar, y la segunda vez guardaría como «valor previo» el
  // 'hidden' que él mismo puso. Al cerrar, la página quedaba sin scroll.
  useEffect(() => {
    const previo = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // De dónde vino el foco, para devolverlo al cerrar: sin esto, quien navega
    // con teclado cerraba el mensaje 18 y aparecía al principio de la página,
    // con 17 filas por delante para volver donde estaba.
    const veniaDe = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    return () => {
      document.body.style.overflow = previo;
      veniaDe?.focus?.();
    };
  }, []);

  // El Tab no se escapa del panel: por detrás siguen el buscador, las carpetas
  // y la lista entera, y el anillo de foco desaparecía «detrás del velo».
  const atraparElTab = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;
    const caja = panel.current;
    if (!caja) return;
    const focusables = caja.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (!focusables.length) return;
    const primero = focusables[0];
    const ultimo = focusables[focusables.length - 1];
    const activo = document.activeElement;
    if (e.shiftKey && (activo === primero || activo === caja)) {
      e.preventDefault();
      ultimo.focus();
    } else if (!e.shiftKey && activo === ultimo) {
      e.preventDefault();
      primero.focus();
    }
  }, []);

  // El `||` del final es para un canal que no sea ni SMS ni EMAIL: sin él la
  // línea empezaría por el separador («· Negocios»).
  const canales =
    [hayWhatsapp ? nombreDeCanal(t.channel) : null, correo ? 'Correo' : null]
      .filter(Boolean)
      .join(' · ') || nombreDeCanal(t.channel);

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-ink/30"
        onClick={onCerrar}
        aria-hidden
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="titulo-del-mensaje"
        tabIndex={-1}
        onKeyDown={atraparElTab}
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[580px] flex-col bg-white shadow-md2 outline-none"
      >
        <header className="shrink-0 border-b border-line px-4 py-3 sm:px-5">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <h2
                id="titulo-del-mensaje"
                className="m-0 text-base font-bold leading-snug text-ink"
              >
                {t.label}
              </h2>
              <p className="m-0 mt-0.5 text-xs text-mute">
                {canales} · {t.audience}
              </p>
            </div>
            <button
              type="button"
              onClick={onCerrar}
              aria-label="Cerrar el mensaje"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-input text-lg text-mute hover:bg-bg2"
            >
              ✕
            </button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5">
              <span
                aria-hidden
                className={`h-2 w-2 rounded-full ${t.enabled ? 'bg-brand' : 'bg-warn'}`}
              />
              <span
                className={`text-xs font-semibold ${t.enabled ? 'text-ink' : 'text-warn-ink'}`}
              >
                {t.enabled ? 'Enviando' : 'Envío apagado'}
              </span>
            </span>
            <button
              type="button"
              onClick={() => onAlternarEnvio(t.id, !t.enabled)}
              disabled={ocupado}
              className={t.enabled ? BOTON_NEUTRO : BOTON_PRIMARIO}
            >
              {t.enabled ? 'Apagar envío' : 'Activar envío'}
            </button>
            {t.isBrandCustom && (
              <span className="rounded-pill bg-brand-soft px-2.5 py-1 text-[11px] font-semibold text-ink">
                Personalizado por tu marca
              </span>
            )}
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          {t.description && (
            <p className="m-0 mb-4 rounded-input bg-bg2 p-3 text-xs leading-relaxed text-mute">
              {t.description}
            </p>
          )}

          {!esSoloCorreo && (
            <section className="mb-5">
              <h3 className="m-0 mb-2 text-xs font-bold uppercase tracking-wide text-mute">
                Mensaje de {nombreDeCanal(t.channel)}
              </h3>
              <Tokens
                vars={t.vars}
                onInsertar={(v) =>
                  insertarToken(refTexto, draftTexto, v, onDraftTexto)
                }
              />
              <textarea
                ref={refTexto}
                value={draftTexto}
                onChange={(e) => onDraftTexto(e.target.value)}
                rows={Math.min(12, Math.max(4, draftTexto.split('\n').length + 1))}
                placeholder={t.default}
                className="input mt-2 resize-y font-mono text-xs"
              />
              <p className="m-0 mt-1.5 text-[11px] text-mute2">
                Déjalo vacío y guarda para volver al texto por defecto. Los
                tokens <code className="font-mono">{'{así}'}</code> se
                reemplazan al enviar.
              </p>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => onGuardarTexto(draftTexto)}
                  disabled={guardandoTexto || !textoSucio}
                  className={BOTON_PRIMARIO}
                >
                  {guardandoTexto ? 'Guardando…' : 'Guardar'}
                </button>
                {hayWhatsapp && (
                  <button
                    type="button"
                    onClick={() => onProbarTexto(draftTexto)}
                    disabled={probandoTexto || !telefonoPrueba.trim()}
                    title={
                      telefonoPrueba.trim()
                        ? `Enviar este ${nombreDeCanal(t.channel)} a tu número de prueba`
                        : 'Pon un número de prueba en «Cambiar destinos de prueba»'
                    }
                    className={BOTON_NEUTRO}
                  >
                    {probandoTexto
                      ? 'Enviando…'
                      : `Probar ${nombreDeCanal(t.channel)}`}
                  </button>
                )}
                {t.isBrandCustom && (
                  <button
                    type="button"
                    onClick={() => onGuardarTexto('')}
                    disabled={guardandoTexto}
                    className={BOTON_PELIGRO}
                  >
                    Restaurar default
                  </button>
                )}
              </div>
              {hayWhatsapp && !telefonoPrueba.trim() && (
                // Un botón apagado y sin explicación se lee como «esto no se
                // puede probar». Sí se puede: lo que falta es el número.
                <p className="m-0 mt-1.5 text-[11px] text-warn-ink">
                  Pon un número de prueba en «Cambiar destinos de prueba» para
                  poder enviarlo.
                </p>
              )}
              {hayWhatsapp && !growConnected && (
                <p className="m-0 mt-1.5 text-[11px] text-warn-ink">
                  ⚠ Esta marca aún no tiene subcuenta de mensajería conectada:
                  ni la prueba ni el envío real salen hasta conectarla.
                </p>
              )}
            </section>
          )}

          {correo && dCorreo && (
            <section
              className={
                esSoloCorreo ? '' : 'rounded-card border border-line bg-bg p-3'
              }
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <h3 className="m-0 text-xs font-bold uppercase tracking-wide text-mute">
                  Correo
                </h3>
                {!esSoloCorreo && (
                  <>
                    <span className="text-[11px] text-mute2">
                      Mismo disparo que el {nombreDeCanal(t.channel)} de arriba.
                    </span>
                    <span
                      className={`rounded-pill px-2 py-0.5 text-[10px] font-bold ${
                        correo.enabled
                          ? 'bg-bg2 text-mute'
                          : 'bg-warn-soft text-warn-ink'
                      }`}
                    >
                      {correo.enabled ? 'Enviando' : 'Apagado'}
                    </span>
                  </>
                )}
              </div>

              <Tokens
                vars={correo.vars}
                onInsertar={(v) =>
                  ultimoCampoDelCorreo.current === 'asunto'
                    ? insertarToken(refAsunto, dCorreo.subject, v, (s) =>
                        onDraftCorreo({ ...dCorreo, subject: s }),
                      )
                    : insertarToken(refCuerpo, dCorreo.body, v, (b) =>
                        onDraftCorreo({ ...dCorreo, body: b }),
                      )
                }
              />

              <label
                htmlFor="asunto-del-correo"
                className="label mb-1 mt-2 text-[11px]"
              >
                Asunto
              </label>
              <input
                id="asunto-del-correo"
                ref={refAsunto}
                value={dCorreo.subject}
                onFocus={() => (ultimoCampoDelCorreo.current = 'asunto')}
                onChange={(e) =>
                  onDraftCorreo({ ...dCorreo, subject: e.target.value })
                }
                placeholder={correo.subjectDefault}
                className="input min-h-[44px] text-xs"
              />

              <div className="mt-3">
                <label
                  htmlFor="cuerpo-del-correo"
                  className="label mb-1 text-[11px]"
                >
                  Cuerpo
                </label>
                <textarea
                  id="cuerpo-del-correo"
                  ref={refCuerpo}
                  value={dCorreo.body}
                  onFocus={() => (ultimoCampoDelCorreo.current = 'cuerpo')}
                  onChange={(e) =>
                    onDraftCorreo({ ...dCorreo, body: e.target.value })
                  }
                  rows={Math.min(
                    16,
                    Math.max(5, dCorreo.body.split('\n').length + 1),
                  )}
                  placeholder={correo.bodyDefault}
                  className="input resize-y font-mono text-xs"
                />
              </div>

              <p className="m-0 mt-1.5 text-[11px] text-mute2">
                Texto plano: una línea en blanco separa párrafos y{' '}
                <code className="font-mono">**así**</code> pone negrita. El
                logo, los colores y el botón los pone tu marca. Asunto y cuerpo
                vacíos y guardar = volver al default.
              </p>

              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    onGuardarCorreo(correo.id, dCorreo.subject, dCorreo.body)
                  }
                  disabled={guardandoCorreo || !correoSucio}
                  className={BOTON_PRIMARIO}
                >
                  {guardandoCorreo ? 'Guardando…' : 'Guardar correo'}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onProbarCorreo(correo.id, dCorreo.subject, dCorreo.body)
                  }
                  disabled={probandoCorreo || !correoPrueba.trim()}
                  title={
                    correoPrueba.trim()
                      ? 'Enviar este correo a tu correo de prueba'
                      : 'Pon un correo de prueba en «Cambiar destinos de prueba»'
                  }
                  className={BOTON_NEUTRO}
                >
                  {probandoCorreo ? 'Enviando…' : 'Probar correo'}
                </button>
                {correo.isBrandCustom && (
                  <button
                    type="button"
                    onClick={() => onGuardarCorreo(correo.id, '', '')}
                    disabled={guardandoCorreo}
                    className={BOTON_PELIGRO}
                  >
                    Restaurar default
                  </button>
                )}
                {!esSoloCorreo && (
                  <button
                    type="button"
                    onClick={() => onAlternarEnvio(correo.id, !correo.enabled)}
                    disabled={ocupado}
                    className={BOTON_NEUTRO}
                  >
                    {correo.enabled ? 'Apagar correo' : 'Encender correo'}
                  </button>
                )}
              </div>
              {!correoPrueba.trim() && (
                <p className="m-0 mt-1.5 text-[11px] text-warn-ink">
                  Pon un correo de prueba en «Cambiar destinos de prueba» para
                  poder enviarlo.
                </p>
              )}
              {!emailConnected && (
                <p className="m-0 mt-1.5 text-[11px] text-warn-ink">
                  ⚠ Esta marca todavía no tiene remitente propio de correo; sus
                  correos no salen. Configúralo en Master Admin → Marcas.
                </p>
              )}
            </section>
          )}
        </div>

        <footer className="shrink-0 border-t border-line px-4 py-3 sm:px-5">
          <label htmlFor="carpeta-del-mensaje" className="label mb-1 text-[11px]">
            Carpeta
          </label>
          <select
            id="carpeta-del-mensaje"
            value={t.folderId}
            onChange={(e) => onMover(e.target.value)}
            disabled={ocupado}
            className="input min-h-[44px] text-xs"
          >
            {carpetas.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </footer>
      </div>
    </>
  );
}

/** Fila de tokens insertables. Antes solo se podían leer y copiar a mano. */
function Tokens({
  vars,
  onInsertar,
}: {
  vars: string[];
  onInsertar: (v: string) => void;
}) {
  if (!vars.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] text-mute2">Insertar:</span>
      {vars.map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onInsertar(v)}
          className="min-h-[44px] rounded-input border border-line bg-bg2 px-2.5 font-mono text-[11px] text-ink hover:bg-white"
        >
          {`{${v}}`}
        </button>
      ))}
    </div>
  );
}

/**
 * Mete un token donde está el cursor, no al final.
 *
 * Y devuelve el cursor DETRÁS de lo insertado: sin eso, insertar dos tokens
 * seguidos los deja del revés, porque el segundo vuelve a caer en la posición 0.
 */
function insertarToken(
  ref: React.RefObject<HTMLTextAreaElement | HTMLInputElement>,
  valor: string,
  token: string,
  aplicar: (v: string) => void,
) {
  const marca = `{${token}}`;
  const el = ref.current;
  if (!el) {
    aplicar(valor + marca);
    return;
  }
  const ini = el.selectionStart ?? valor.length;
  const fin = el.selectionEnd ?? valor.length;
  aplicar(valor.slice(0, ini) + marca + valor.slice(fin));
  requestAnimationFrame(() => {
    el.focus();
    const p = ini + marca.length;
    el.setSelectionRange(p, p);
  });
}
