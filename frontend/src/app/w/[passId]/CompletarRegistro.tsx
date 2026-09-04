'use client';
import { useMemo, useState } from 'react';
import { useT, useLocale } from '@/lib/i18n';
import { logoShapeClass, type LogoShape } from '@/components/WalletPassPreview';
import { DAY_OPTIONS, monthOptionsFor } from '@/lib/opciones-cumple';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4949';

/**
 * El paso que le faltaba al socio del club.
 *
 * El club se da de alta desde el mostrador con un solo dato —el teléfono— para
 * que el negocio no tenga que teclear una ficha con el cliente esperando. Pero
 * eso deja a ese cliente sin correo, sin cumpleaños y con el número por nombre:
 * es el único del negocio que nunca pasa por un formulario. Sin correo no le
 * llega nada de lo que el negocio manda, y sin cumpleaños se queda fuera de la
 * automatización que más se usa.
 *
 * Se le pide aquí, cuando abre su tarjeta y todavía tiene la atención puesta, y
 * con la MISMA cara que el formulario de alta de `/c/[cardId]`: el logo de su
 * negocio, las etiquetas encima de cada campo y el cumpleaños en dos listas. El
 * socio del club ya vio ese formulario en otras tarjetas del mismo negocio; si
 * este pareciera otra cosa, parecería de otro.
 *
 * El paso se puede saltar: bloquear la instalación por un cumpleaños sería
 * quedarnos con el cliente fuera por un dato que no es imprescindible.
 */
export function CompletarRegistro({
  passId,
  falta,
  primary,
  nombreActual,
  marca,
  logoUrl,
  logoShape,
  logoBgColor,
  onListo,
}: {
  passId: string;
  falta: { faltaNombre: boolean; faltaEmail: boolean; faltaCumple: boolean };
  primary: string;
  /** El nombre que ya tiene la ficha, si es un nombre de verdad. */
  nombreActual?: string | null;
  marca: string;
  logoUrl?: string | null;
  logoShape?: LogoShape | null;
  logoBgColor?: string | null;
  onListo: () => void;
}) {
  const tt = useT();
  const [locale] = useLocale();
  const monthOptions = useMemo(() => monthOptionsFor(locale), [locale]);

  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [dia, setDia] = useState('');
  const [mes, setMes] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function guardar() {
    setErr(null);
    if (falta.faltaNombre && !/\p{L}/u.test(nombre)) {
      setErr(tt('wallet.reg_name_err'));
      return;
    }
    if (falta.faltaEmail && email.trim() && !/.+@.+\..+/.test(email)) {
      setErr(tt('wallet.reg_email_err'));
      return;
    }
    setEnviando(true);
    try {
      // El cumpleaños se guarda con un año fijo: lo que se celebra es el día y
      // el mes, y pedir el año hace que la gente abandone el formulario.
      const birthday =
        dia && mes
          ? `2000-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
          : undefined;
      await fetch(`${API}/api/passes/${passId}/completar-registro`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: nombre.trim() || undefined,
          email: email.trim() || undefined,
          birthday,
        }),
      });
      onListo();
    } catch {
      // Que un fallo de red no deje al cliente sin poder instalar su tarjeta:
      // los datos se pueden pedir otro día, la tarjeta no.
      onListo();
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="mt-4 rounded-2xl border border-line bg-white p-4 sm:p-5 text-left">
      {/* La cabecera del negocio, igual que en el alta: el cliente tiene que
          ver de quién es la tarjeta antes de escribir sus datos. */}
      <div className="flex items-center gap-2.5">
        <div
          className={`${logoShapeClass(logoShape)} flex items-center justify-center font-bold text-[12px] shrink-0 overflow-hidden text-white`}
          style={{ background: logoBgColor || primary }}
        >
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt=""
              className="w-full h-full object-contain"
            />
          ) : (
            (marca?.[0] || 'C').toUpperCase()
          )}
        </div>
        <div className="text-[12px] font-bold uppercase tracking-wide leading-tight break-words line-clamp-2">
          {marca}
        </div>
      </div>

      <h2 className="text-[17px] font-extrabold tracking-tight mt-3">
        {tt('wallet.reg_title')}
      </h2>
      <p className="text-xs text-mute mt-1">{tt('wallet.reg_sub')}</p>

      <div className="mt-4 space-y-3">
        {/* El nombre va SIEMPRE, no solo cuando falta: es lo que le confirma al
            socio que la tarjeta es suya y no un formulario en blanco más. Si el
            negocio ya se lo puso, se enseña y no se toca — cambiarlo se pide en
            el mostrador, y así un enlace reenviado no reescribe una ficha. */}
        <div>
          <label className="label">{tt('card.full_name')}</label>
          {falta.faltaNombre ? (
            <input
              className="input"
              autoFocus
              placeholder={tt('card.full_name')}
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              autoComplete="name"
              autoCapitalize="words"
              enterKeyHint="next"
            />
          ) : (
            <input
              className="input bg-bg2 text-mute"
              value={nombreActual ?? ''}
              readOnly
              tabIndex={-1}
            />
          )}
        </div>

        {falta.faltaEmail && (
          <div>
            <label className="label">{tt('card.email')}</label>
            <input
              className="input"
              type="email"
              placeholder="tucorreo@ejemplo.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              inputMode="email"
              autoCapitalize="none"
              enterKeyHint="next"
            />
          </div>
        )}

        {falta.faltaCumple && (
          <div>
            <label className="label">🎂 {tt('card.birthday')}</label>
            <div className="grid grid-cols-2 gap-2">
              <select
                className="input"
                value={dia}
                onChange={(e) => setDia(e.target.value)}
              >
                <option value="">{tt('card.birth_day')}</option>
                {DAY_OPTIONS}
              </select>
              <select
                className="input"
                value={mes}
                onChange={(e) => setMes(e.target.value)}
              >
                <option value="">{tt('card.birth_month')}</option>
                {monthOptions}
              </select>
            </div>
            <div className="text-[11px] text-mute mt-1">
              {tt('card.birthday_gift_hint')}
            </div>
          </div>
        )}
      </div>

      {err && <div className="text-[12px] text-bad mt-2">{err}</div>}

      <button
        className="w-full mt-4 rounded-xl py-3 font-semibold text-white disabled:opacity-60 active:scale-[0.99] transition"
        style={{ background: primary }}
        disabled={enviando}
        onClick={guardar}
      >
        {enviando ? tt('wallet.reg_saving') : tt('wallet.reg_continue')}
      </button>

      <button
        className="w-full mt-2 text-[12px] text-mute underline"
        onClick={onListo}
      >
        {tt('wallet.reg_skip')}
      </button>
    </div>
  );
}
