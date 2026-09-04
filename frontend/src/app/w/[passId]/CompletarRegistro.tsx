'use client';
import { useState } from 'react';
import { useT } from '@/lib/i18n';

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
 * Así que se le pide aquí, en el momento en que abre su tarjeta y todavía tiene
 * la atención puesta. Solo se piden los huecos que de verdad faltan, y el paso
 * se puede saltar: bloquear la instalación por un cumpleaños sería quedarnos
 * con el cliente fuera por un dato que no es imprescindible.
 */
export function CompletarRegistro({
  passId,
  falta,
  primary,
  onListo,
}: {
  passId: string;
  falta: { faltaNombre: boolean; faltaEmail: boolean; faltaCumple: boolean };
  primary: string;
  onListo: () => void;
}) {
  const tt = useT();
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
    <div className="mt-4 rounded-2xl border border-line bg-white p-4">
      <div className="text-[13px] font-semibold text-center">
        {tt('wallet.reg_title')}
      </div>
      <p className="text-[12px] text-mute text-center mt-1">
        {tt('wallet.reg_sub')}
      </p>

      <div className="space-y-2.5 mt-3">
        {falta.faltaNombre && (
          <input
            className="input"
            autoFocus
            placeholder={tt('wallet.reg_name')}
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
          />
        )}
        {falta.faltaEmail && (
          <input
            className="input"
            type="email"
            inputMode="email"
            autoCapitalize="off"
            placeholder={tt('wallet.reg_email')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        )}
        {falta.faltaCumple && (
          <div className="flex gap-2">
            <input
              className="input"
              inputMode="numeric"
              maxLength={2}
              placeholder={tt('wallet.reg_day')}
              value={dia}
              onChange={(e) => setDia(e.target.value.replace(/\D/g, ''))}
            />
            <input
              className="input"
              inputMode="numeric"
              maxLength={2}
              placeholder={tt('wallet.reg_month')}
              value={mes}
              onChange={(e) => setMes(e.target.value.replace(/\D/g, ''))}
            />
          </div>
        )}
      </div>

      {err && <div className="text-[12px] text-bad mt-2 text-center">{err}</div>}

      <button
        className="w-full mt-3 rounded-xl py-3 font-semibold text-white disabled:opacity-60"
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
