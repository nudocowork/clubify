'use client';
import { useEffect, useRef, useState } from 'react';

/**
 * Escáner de cámara reusable. Nace para la cuponera (§6: canjear escaneando, no
 * solo pegando el código) pero no sabe nada de cuponera: recibe `onResult` y
 * listo.
 *
 * NO reemplaza a /scan, que es el escáner de los negocios y tiene su propia
 * lógica de sellos y anti-abuso. Comparte las lecciones aprendidas ahí:
 *
 *  · El BarcodeDetector nativo lee el <video> DIRECTO, a resolución completa.
 *    html5-qrcode recorta a un canvas del tamaño del qrbox (~310 px en celular)
 *    y un PDF417 corto tiene ~136 módulos de ancho: a ese tamaño queda ~1 px por
 *    módulo, imposible de decodificar. Los pases de Apple y Google Wallet usan
 *    PDF417, así que esto no es un detalle.
 *  · La resolución alta se pide SOLO si hay detector nativo. Con el decodificador
 *    JS es contraproducente: su canvas mide lo mismo pidas lo que pidas, así que
 *    más resolución de origen es más submuestreo.
 *  · La cámara se elige por etiqueta, no `cams[0]`: en móvil el primero suele ser
 *    el frontal y el escáner termina apuntando al lado equivocado.
 */

const NATIVE_FORMATS = ['pdf417', 'qr_code', 'code_128', 'aztec', 'data_matrix'];

function isPermissionError(e: any) {
  return e?.name === 'NotAllowedError' || /permission|denied/i.test(e?.message ?? '');
}

function pickBackCamera(cams: Array<{ id: string; label: string }>) {
  return cams.find((c) => /back|rear|trasera|traseira|environment/i.test(c.label ?? '')) ?? cams[0];
}

async function makeNativeDetector(): Promise<any | null> {
  const BD = (globalThis as any).BarcodeDetector;
  if (!BD) return null;
  try {
    const supported: string[] = await BD.getSupportedFormats();
    const formats = NATIVE_FORMATS.filter((f) => supported.includes(f));
    if (!formats.length) return null;
    return new BD({ formats });
  } catch {
    return null;
  }
}

export function QrScanner({
  onResult,
  onClose,
  elementId = 'cuponera-qr',
}: {
  /** Se llama UNA vez con el texto leído. El componente ya paró la cámara. */
  onResult: (text: string) => void;
  onClose?: () => void;
  elementId?: string;
}) {
  const [err, setErr] = useState<string | null>(null);
  const [listo, setListo] = useState(false);
  const scannerRef = useRef<any>(null);
  const loopRef = useRef<any>(null);
  // Sin este guard, el detector nativo y el de la librería pueden disparar los
  // dos con el mismo código y el canje se intentaría dos veces.
  const handledRef = useRef(false);

  useEffect(() => {
    let vivo = true;

    const stopLoop = () => {
      if (loopRef.current) { clearTimeout(loopRef.current); loopRef.current = null; }
    };

    const apagar = async () => {
      stopLoop();
      try { await scannerRef.current?.stop(); } catch { /* ya estaba parada */ }
      try { scannerRef.current?.clear(); } catch { /* idem */ }
      scannerRef.current = null;
    };

    const resolver = async (texto: string) => {
      if (handledRef.current) return;
      handledRef.current = true;
      await apagar();
      onResult(texto);
    };

    const loopNativo = (detector: any) => {
      const tick = async () => {
        loopRef.current = null;
        if (handledRef.current || !detector || !vivo) return;
        const video = document.querySelector<HTMLVideoElement>(`#${elementId} video`);
        if (video && video.readyState >= 2 && video.videoWidth > 0) {
          try {
            const codes = await detector.detect(video);
            const raw = codes?.[0]?.rawValue;
            if (raw) { await resolver(String(raw)); return; }
          } catch {
            // Frame ilegible o detector ocupado: se reintenta al próximo tick.
          }
        }
        if (!handledRef.current && vivo) loopRef.current = setTimeout(tick, 120);
      };
      stopLoop();
      loopRef.current = setTimeout(tick, 300);
    };

    (async () => {
      try {
        const { Html5Qrcode } = await import('html5-qrcode');
        const cams = await Html5Qrcode.getCameras();
        if (!vivo) return;
        if (!cams?.length) { setErr('No encontramos ninguna cámara en este dispositivo.'); return; }

        const detector = await makeNativeDetector();
        const inst = new Html5Qrcode(elementId, { verbose: false });
        scannerRef.current = inst;

        await inst.start(
          pickBackCamera(cams).id,
          { fps: 10, qrbox: { width: 260, height: 170 } },
          (texto: string) => { void resolver(texto); },
          () => { /* cada frame sin código entra acá: no es un error */ },
        );
        if (!vivo) { await apagar(); return; }
        setListo(true);

        if (detector) {
          // Resolución alta solo con detector nativo (ver comentario de arriba).
          try {
            await (inst as any).applyVideoConstraints({
              width: { ideal: 1920 }, height: { ideal: 1080 },
            });
          } catch { /* best-effort: no puede tumbar una cámara que ya anda */ }
          loopNativo(detector);
        }
      } catch (e: any) {
        if (!vivo) return;
        setErr(
          isPermissionError(e)
            ? 'No nos diste permiso para usar la cámara. Habilitalo desde el candado de la barra de direcciones y volvé a intentar.'
            : 'No pudimos abrir la cámara. Podés escribir el código a mano acá abajo.',
        );
      }
    })();

    // Apagar SIEMPRE al desmontar: una cámara que queda prendida se nota (luz
    // encendida) y desconfía al usuario.
    return () => { vivo = false; void apagar(); };
  }, [elementId, onResult]);

  return (
    <div>
      <div
        id={elementId}
        style={{
          width: '100%', maxWidth: 420, margin: '0 auto', borderRadius: 12,
          overflow: 'hidden', background: '#0b1016', minHeight: err ? 0 : 210,
        }}
      />
      {!listo && !err && (
        <div style={{ fontSize: 13, color: '#64748b', textAlign: 'center', marginTop: 8 }}>
          Abriendo la cámara…
        </div>
      )}
      {listo && !err && (
        <div style={{ fontSize: 12.5, color: '#64748b', textAlign: 'center', marginTop: 8 }}>
          Apuntá al código de la tarjeta del socio.
        </div>
      )}
      {err && (
        <div style={{
          fontSize: 13, color: '#92400e', background: '#fffbeb',
          border: '1px solid #fde68a', borderRadius: 9, padding: '10px 12px',
        }}>
          {err}
        </div>
      )}
      {onClose && (
        <div style={{ textAlign: 'center', marginTop: 10 }}>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', color: '#64748b',
              fontSize: 13, cursor: 'pointer', textDecoration: 'underline',
            }}
          >
            Cerrar la cámara
          </button>
        </div>
      )}
    </div>
  );
}
