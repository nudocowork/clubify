'use client';
import { toast } from '@/components/Toast';

/**
 * Modal que se muestra UNA SOLA VEZ tras crear un afiliado (influencer
 * o embajador). Muestra email + password en plain text para que el
 * admin lo copie y comparta vía WhatsApp / email. El password no se
 * guarda en plain text en ningún lado — si el admin lo pierde, debe
 * resetearlo desde el panel de auth.
 */
export function AffiliateCredentialsModal({
  credentials,
  whoLabel,
  whatsapp,
  onClose,
}: {
  credentials: { email: string; password: string; loginUrl: string };
  /** Texto descriptivo del afiliado, p.ej. "influencer Juan Pérez". */
  whoLabel: string;
  /** WhatsApp opcional para deep-link a wa.me con el mensaje prearmado. */
  whatsapp?: string;
  onClose: () => void;
}) {
  const loginAbsolute =
    typeof window !== 'undefined'
      ? `${window.location.origin}${credentials.loginUrl}`
      : credentials.loginUrl;
  const message =
    `Hola! Ya tenés acceso al panel de afiliado de Clubify.\n\n` +
    `🔗 Entrá aquí: ${loginAbsolute}\n` +
    `📧 Email: ${credentials.email}\n` +
    `🔑 Contraseña: ${credentials.password}\n\n` +
    `Te recomendamos cambiar la contraseña al primer ingreso.`;

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(message);
      toast('Mensaje copiado — pegalo en WhatsApp/email', 'success');
    } catch {
      toast('No se pudo copiar', 'error');
    }
  }
  async function copyPwd() {
    try {
      await navigator.clipboard.writeText(credentials.password);
      toast('Contraseña copiada', 'success');
    } catch {
      toast('No se pudo copiar', 'error');
    }
  }
  const waHref = whatsapp
    ? `https://wa.me/${whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`
    : null;

  return (
    <div
      className="fixed inset-0 z-[60] bg-ink/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-xl max-w-md w-full p-5"
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold m-0">
            ✅ Credenciales del {whoLabel}
          </h2>
          <button onClick={onClose} className="text-mute hover:text-ink text-xl leading-none">
            ×
          </button>
        </div>
        <div className="text-xs text-mute mb-4 leading-relaxed">
          <strong>Importante:</strong> esta es la única vez que vas a ver
          la contraseña. Copiala ahora y compartila con el afiliado.
          Después podrá cambiarla desde su panel.
        </div>
        <div className="space-y-2 mb-4">
          <div className="bg-bg2 rounded-lg p-3">
            <div className="text-[10px] uppercase tracking-wider text-mute font-semibold mb-0.5">
              Email
            </div>
            <div className="font-mono text-sm break-all">{credentials.email}</div>
          </div>
          <div className="bg-bg2 rounded-lg p-3 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-wider text-mute font-semibold mb-0.5">
                Contraseña
              </div>
              <div className="font-mono text-base font-bold break-all">
                {credentials.password}
              </div>
            </div>
            <button onClick={copyPwd} className="btn-ghost text-xs shrink-0">
              Copiar
            </button>
          </div>
          <div className="bg-bg2 rounded-lg p-3">
            <div className="text-[10px] uppercase tracking-wider text-mute font-semibold mb-0.5">
              Link de acceso
            </div>
            <div className="font-mono text-xs break-all text-brand">{loginAbsolute}</div>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={copyAll} className="btn-primary flex-1 justify-center">
            Copiar mensaje
          </button>
          {waHref && (
            <a
              href={waHref}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-ghost"
            >
              WhatsApp
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
