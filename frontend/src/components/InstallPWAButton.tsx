'use client';
import { useEffect, useState } from 'react';
import { Icon } from './Icon';

type BIPEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

export function InstallPWAButton({
  className = 'btn-primary',
  label = 'Instalar app',
}: {
  className?: string;
  label?: string;
}) {
  const [deferred, setDeferred] = useState<BIPEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [showIosTip, setShowIosTip] = useState(false);

  useEffect(() => {
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      // @ts-ignore iOS Safari
      window.navigator.standalone === true;
    if (standalone) {
      setInstalled(true);
      return;
    }
    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BIPEvent);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (installed) return null;

  const isIos =
    typeof navigator !== 'undefined' &&
    /iPad|iPhone|iPod/.test(navigator.userAgent) &&
    // @ts-ignore
    !window.MSStream;

  async function install() {
    if (deferred) {
      await deferred.prompt();
      await deferred.userChoice;
      setDeferred(null);
      return;
    }
    if (isIos) {
      setShowIosTip((v) => !v);
    }
  }

  if (!deferred && !isIos) return null;

  return (
    <>
      <button className={className} onClick={install} type="button">
        <Icon name="plus" /> {label}
      </button>
      {showIosTip && (
        <div className="card card-pad mt-3 text-sm">
          <div className="font-semibold mb-1">Instalar en iPhone</div>
          <ol className="list-decimal pl-5 space-y-1 text-mute">
            <li>Toca el botón <b>Compartir</b> en Safari (el cuadro con la flecha ↑).</li>
            <li>Selecciona <b>Añadir a pantalla de inicio</b>.</li>
            <li>Confirma con <b>Añadir</b>.</li>
          </ol>
        </div>
      )}
    </>
  );
}
