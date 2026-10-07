'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/Icon';
import { POLITICA, aceptarDe, pesoLegible, validarArchivo } from '@/lib/politica-de-archivos.mjs';
import { importarPdfDelMenu, subirArchivo, type EstadoDeSubida } from '@/lib/subir-archivo';

// El endpoint recibe UN archivo por request, así que un lote son N requests.
// Tres a la vez es el techo: una carta larga son imágenes de varios MB y la
// conexión del negocio (a menudo el wifi del local) se satura si se lanzan las
// 20 juntas — se cortan a la mitad y hay que reintentar todo.
const MAX_CONCURRENT_UPLOADS = 3;

type Problem = { name: string; reason: string };

const PAGINA = POLITICA.PAGINA_LIBRO;
const PDF = POLITICA.PDF_MENU;

function esPdf(f: File) {
  return f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
}

/**
 * Zona de subida de páginas del Menú Libro: acepta VARIAS imágenes de una vez
 * (clic o arrastre) porque una carta real son 10–30 páginas y de a una es
 * inviable.
 *
 * Reparto de responsabilidades: este componente sube los archivos a R2 y le
 * entrega las URLs al padre por `onUploadPage`; el alta de la página en el menú
 * la hace el padre.
 *
 * Dos garantías que el flujo no puede perder:
 *
 * 1. `onUploadPage` se llama EN SERIE y en el orden en que el usuario eligió
 *    los archivos. El backend calcula `sortOrder` leyendo la última página y
 *    sumando 1 (menu-book.service.ts → createPage), así que dos altas en
 *    paralelo se asignarían el mismo número y la carta saldría desordenada.
 * 2. Un archivo que falla no aborta el lote: se anota y se sigue con el resto.
 *    Reintentar 25 imágenes porque la número 7 se cortó es exactamente lo que
 *    hace que el negocio abandone la carga.
 */
export function MenuBookPagesUploader({
  folder = 'menu-book',
  onUploadPage,
  onDone,
}: {
  folder?: string;
  /** Obsoleto: el tope lo pone la política (PAGINA_LIBRO), igual que el servidor. */
  maxSizeMb?: number;
  /** Crea la página en el menú. Se invoca de a una y en orden. */
  onUploadPage: (url: string) => Promise<void>;
  /** El lote terminó (con o sin fallos): momento de recargar el listado. */
  onDone: () => void;
}) {
  const t = useTranslations('app_menu_book');
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [pct, setPct] = useState(0);
  const [added, setAdded] = useState(0);
  const [discarded, setDiscarded] = useState<Problem[]>([]);
  const [failed, setFailed] = useState<Problem[]>([]);
  const [estadoPdf, setEstadoPdf] = useState<EstadoDeSubida | null>(null);

  function validate(files: File[]): { valid: File[]; discarded: Problem[] } {
    const valid: File[] = [];
    const bad: Problem[] = [];
    for (const f of files) {
      // Mismo mensaje que daría el servidor, antes de transmitir un byte.
      const motivo = esPdf(f) ? validarArchivo(f, 'PDF_MENU') : validarArchivo(f, 'PAGINA_LIBRO');
      if (motivo) bad.push({ name: f.name, reason: motivo });
      else valid.push(f);
    }
    if (valid.length > PAGINA.archivosPorLote) {
      for (const f of valid.splice(PAGINA.archivosPorLote)) {
        bad.push({ name: f.name, reason: `se pueden subir hasta ${PAGINA.archivosPorLote} páginas por vez` });
      }
    }
    return { valid, discarded: bad };
  }

  /**
   * Un PDF: el servidor lo trocea en páginas ya optimizadas y aquí se dan de
   * alta EN ORDEN, como si fueran imágenes elegidas una tras otra.
   */
  async function runPdf(pdf: File) {
    setBusy(true);
    setTotal(1);
    setDone(0);
    setPct(0);
    const errors: Problem[] = [];
    let okCount = 0;
    try {
      const r = await importarPdfDelMenu(pdf, { alProgreso: (n) => setPct(Math.min(99, n)), alEstado: setEstadoPdf });
      setEstadoPdf('listo');
      setTotal(r.paginas.length);
      for (let i = 0; i < r.paginas.length; i++) {
        try {
          await onUploadPage(r.paginas[i].url);
          okCount++;
          setAdded(okCount);
        } catch (e: any) {
          errors.push({ name: `${pdf.name} · página ${i + 1}`, reason: e?.message || 'Error' });
        }
        setDone(i + 1);
      }
    } catch (e: any) {
      errors.push({ name: pdf.name, reason: e?.message || 'Error' });
    } finally {
      setPct(100);
      setFailed(errors);
      setEstadoPdf(null);
      setBusy(false);
      onDone();
    }
  }

  async function run(picked: File[]) {
    if (busy || picked.length === 0) return;
    setAdded(0);
    setFailed([]);

    // Validar el lote ENTERO antes de empezar: si algo se va a descartar, el
    // negocio lo ve de una y no a mitad de una subida de diez minutos.
    const { valid: validos, discarded: bad } = validate(picked);
    // Un PDF va solo: mezclarlo con imágenes dejaría el orden de la carta al
    // azar de qué termina antes.
    const pdfs = validos.filter(esPdf);
    const valid = validos.filter((f) => !esPdf(f));
    if (pdfs.length && (valid.length || pdfs.length > 1)) {
      for (const f of pdfs.slice(valid.length ? 0 : 1)) {
        bad.push({ name: f.name, reason: 'importa los PDF de a uno y sin imágenes en el mismo lote' });
      }
    }
    setDiscarded(bad);
    if (pdfs.length === 1 && valid.length === 0) {
      await runPdf(pdfs[0]);
      return;
    }
    if (valid.length === 0) return;

    setBusy(true);
    setTotal(valid.length);
    setDone(0);
    setPct(0);

    const totalBytes = valid.reduce((s, f) => s + f.size, 0) || 1;
    const loaded = new Array<number>(valid.length).fill(0);
    let lastPct = 0;
    const bumpBytes = (i: number, n: number) => {
      loaded[i] = n;
      const next = Math.min(
        99,
        Math.round((loaded.reduce((a, b) => a + b, 0) / totalBytes) * 100),
      );
      // Repintar solo al cruzar un punto porcentual: con 3 XHR en vuelo los
      // eventos de progreso llegan a decenas por segundo.
      if (next !== lastPct) {
        lastPct = next;
        setPct(next);
      }
    };

    // Una promesa por índice: así el commit puede esperar SU archivo sin
    // depender del orden en que terminen las subidas.
    type Result = { ok: true; url: string } | { ok: false; error: string };
    const slots = valid.map(() => {
      let settle!: (r: Result) => void;
      const promise = new Promise<Result>((res) => {
        settle = res;
      });
      return { promise, settle };
    });

    let cursor = 0;
    async function worker() {
      for (;;) {
        const i = cursor++;
        if (i >= valid.length) return;
        try {
          const { url } = await subirArchivo(valid[i], {
            uso: 'PAGINA_LIBRO',
            folder,
            alProgreso: (pct) => bumpBytes(i, Math.round((pct / 100) * valid[i].size)),
          });
          loaded[i] = valid[i].size;
          slots[i].settle({ ok: true, url });
        } catch (e: any) {
          slots[i].settle({ ok: false, error: e?.message || 'Error' });
        }
      }
    }

    const errors: Problem[] = [];
    let okCount = 0;
    const committer = (async () => {
      for (let i = 0; i < valid.length; i++) {
        const r = await slots[i].promise;
        if (r.ok) {
          try {
            await onUploadPage(r.url);
            okCount++;
            setAdded(okCount);
          } catch (e: any) {
            errors.push({ name: valid[i].name, reason: e?.message || 'Error' });
          }
        } else {
          errors.push({ name: valid[i].name, reason: r.error });
        }
        setDone(i + 1);
      }
    })();

    await Promise.all([
      ...Array.from({ length: Math.min(MAX_CONCURRENT_UPLOADS, valid.length) }, () =>
        worker(),
      ),
      committer,
    ]);

    setPct(100);
    setFailed(errors);
    setBusy(false);
    onDone();
  }

  function onPick(list: FileList | null) {
    if (!list || list.length === 0) return;
    void run(Array.from(list));
    // Permite volver a elegir los mismos archivos (el input no dispara change
    // si el value no cambió) — hace falta al reintentar los que fallaron.
    if (inputRef.current) inputRef.current.value = '';
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (busy) return;
    onPick(e.dataTransfer.files);
  }

  return (
    <div>
      <div
        onClick={() => !busy && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`relative h-40 rounded-input border-2 border-dashed flex flex-col items-center justify-center gap-2 transition ${
          busy
            ? 'cursor-wait border-line bg-bg2/50'
            : dragOver
              ? 'cursor-pointer border-brand bg-brand-soft'
              : 'cursor-pointer border-line hover:border-brand bg-bg2/50'
        }`}
      >
        {busy ? (
          <>
            <div className="w-2/3 h-1.5 rounded-full bg-line overflow-hidden">
              <div
                className="h-full bg-brand transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="text-sm font-medium">
              {estadoPdf === 'subiendo'
                ? `Subiendo el PDF… ${pct}%`
                : estadoPdf === 'procesando'
                  ? 'Convirtiendo el PDF en páginas optimizadas… puede tardar hasta 2 minutos'
                  : t('uploaderProgress', { done, total })}
            </div>
            {!estadoPdf && <div className="text-xs text-mute">{pct}%</div>}
          </>
        ) : (
          <>
            <div className="w-10 h-10 rounded-full bg-brand-soft flex items-center justify-center text-brand">
              <Icon name="plus" size={18} />
            </div>
            <div className="text-sm font-medium">{t('uploaderCta')}</div>
            <div className="text-xs text-mute text-center px-3">
              {t('uploaderHint', { max: pesoLegible(PAGINA.maxBytesOriginal) })}
            </div>
            <div className="text-[11px] text-mute text-center px-3">
              {t('uploaderPdfHint', { max: pesoLegible(PDF.maxBytesOriginal), pages: PDF.paginasMaximas })}
            </div>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={`${aceptarDe('PAGINA_LIBRO')},application/pdf`}
          multiple
          className="hidden"
          onChange={(e) => onPick(e.target.files)}
        />
      </div>

      {!busy && added > 0 && (
        <div className="mt-2 rounded-lg bg-ok-soft px-3 py-2 text-xs text-ok-ink">
          ✓ {t('uploaderAdded', { count: added })}
        </div>
      )}

      {discarded.length > 0 && (
        <ProblemList
          title={t('uploaderDiscardedTitle', { count: discarded.length })}
          items={discarded}
          dismiss={t('uploaderDismiss')}
          onDismiss={() => setDiscarded([])}
        />
      )}

      {failed.length > 0 && (
        <ProblemList
          title={t('uploaderFailedTitle', { count: failed.length })}
          items={failed}
          dismiss={t('uploaderDismiss')}
          onDismiss={() => setFailed([])}
        />
      )}
    </div>
  );
}

/**
 * Lista persistente de archivos con problema. No usamos toast a propósito: el
 * negocio necesita leer QUÉ archivo falló para volver a subir solo ese, y un
 * toast se va antes de que alcance a apuntarlo.
 */
function ProblemList({
  title,
  items,
  dismiss,
  onDismiss,
}: {
  title: string;
  items: Problem[];
  dismiss: string;
  onDismiss: () => void;
}) {
  return (
    <div className="mt-2 rounded-lg bg-bad-soft px-3 py-2 text-xs text-bad-ink">
      <div className="font-semibold">{title}</div>
      <ul className="mt-1 space-y-0.5 list-disc pl-4">
        {items.map((it, i) => (
          <li key={`${it.name}-${i}`}>
            <span className="font-medium break-all">{it.name}</span> — {it.reason}
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={onDismiss}
        className="mt-1.5 underline hover:no-underline"
      >
        {dismiss}
      </button>
    </div>
  );
}
