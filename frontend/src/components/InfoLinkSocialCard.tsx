'use client';
import { Icon } from '@/components/Icon';
import {
  REDES,
  RED_LABEL,
  RED_PLACEHOLDER,
  RED_ICONO,
  colorDeIconos,
  enlaceDeRed,
  errorDeRed,
  type RedSocial,
  type SocialConfig,
} from '@/lib/info-link-social';

/**
 * Redes sociales del infolink: qué se muestra y de qué color.
 *
 * Cada red se enciende por separado y tiene su propio campo. El error de
 * formato se avisa AQUÍ, mientras se escribe, y no al guardar: un enlace mal
 * puesto no rompe nada —la página pública simplemente no pinta ese icono—,
 * pero el negocio se queda creyendo que lo tiene puesto. Ver el aviso al lado
 * del campo es lo que evita eso.
 */
export function InfoLinkSocialCard({
  value,
  primary,
  onChange,
}: {
  value: SocialConfig | null | undefined;
  primary: string;
  onChange: (next: SocialConfig) => void;
}) {
  const social: SocialConfig = value ?? {};
  const color = colorDeIconos(social, primary);

  function patch(red: RedSocial, cambio: Partial<{ enabled: boolean; value: string }>) {
    onChange({ ...social, [red]: { ...(social[red] ?? {}), ...cambio } });
  }

  const activas = REDES.filter((r) => social[r]?.enabled);
  const visibles = activas.filter((r) => enlaceDeRed(r, social[r]?.value));

  return (
    <div className="card card-pad">
      <h3 className="font-semibold m-0">Redes sociales</h3>
      <p className="text-xs text-mute mt-1">
        Se muestran debajo de la descripción. Solo aparecen las que enciendas y
        tengan un enlace válido.
      </p>

      <div className="mt-4 flex flex-col gap-3">
        {REDES.map((red) => {
          const cfg = social[red] ?? {};
          const encendida = !!cfg.enabled;
          const error = encendida ? errorDeRed(red, cfg.value) : null;
          return (
            <div key={red} className="rounded-input border border-line p-3">
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={encendida}
                  onChange={(e) => patch(red, { enabled: e.target.checked })}
                />
                <span style={{ color: encendida ? color : undefined }}>
                  <Icon name={RED_ICONO[red]} size={20} />
                </span>
                <span className="text-sm font-semibold">{RED_LABEL[red]}</span>
              </label>

              {encendida && (
                <>
                  <input
                    className="input mt-2.5"
                    value={cfg.value ?? ''}
                    placeholder={RED_PLACEHOLDER[red]}
                    onChange={(e) => patch(red, { value: e.target.value })}
                  />
                  {error ? (
                    <p className="text-[11px] text-danger mt-1.5">{error}</p>
                  ) : (
                    <p className="text-[11px] text-mute mt-1.5 break-all">
                      Abrirá: {enlaceDeRed(red, cfg.value)}
                    </p>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-4">
        <label className="label">Color de los iconos</label>
        <div className="flex items-center gap-3 mt-1">
          <input
            type="color"
            className="w-11 h-10 rounded-input border border-line bg-transparent cursor-pointer p-0.5"
            value={/^#[0-9a-f]{6}$/i.test(color) ? color : '#000000'}
            onChange={(e) => onChange({ ...social, color: e.target.value })}
          />
          <input
            className="input flex-1"
            value={social.color ?? ''}
            placeholder={`Sin elegir = color principal (${primary})`}
            onChange={(e) =>
              onChange({ ...social, color: e.target.value.trim() || null })
            }
          />
          {social.color && (
            <button
              type="button"
              className="btn-ghost text-xs whitespace-nowrap"
              onClick={() => onChange({ ...social, color: null })}
            >
              Quitar
            </button>
          )}
        </div>
        <p className="text-[11px] text-mute mt-1.5">
          Comprueba que se lea bien sobre el fondo que tenga el infolink: un
          color oscuro desaparece sobre los estilos de fondo oscuro.
        </p>
      </div>

      {/* Vista previa sobre fondo claro y oscuro — es la comprobación de
          contraste que pide el ticket, hecha donde se elige el color y no
          después en la página pública. */}
      {visibles.length > 0 && (
        <div className="mt-4">
          <label className="label">Cómo se verán</label>
          <div className="grid grid-cols-2 gap-2 mt-1">
            {[
              { bg: '#FFFFFF', label: 'Fondo claro' },
              { bg: '#111111', label: 'Fondo oscuro' },
            ].map((f) => (
              <div
                key={f.bg}
                className="rounded-input border border-line p-3 text-center"
                style={{ background: f.bg }}
              >
                <div
                  className="flex items-center justify-center gap-3"
                  style={{ color }}
                >
                  {visibles.map((red) => (
                    <Icon key={red} name={RED_ICONO[red]} size={24} />
                  ))}
                </div>
                <div
                  className="text-[10px] mt-2"
                  style={{ color: f.bg === '#FFFFFF' ? '#666' : '#999' }}
                >
                  {f.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activas.length > visibles.length && (
        <p className="text-[11px] text-danger mt-3">
          Hay {activas.length - visibles.length} red(es) encendidas sin enlace
          válido. No se mostrarán hasta que lo corrijas.
        </p>
      )}
    </div>
  );
}
