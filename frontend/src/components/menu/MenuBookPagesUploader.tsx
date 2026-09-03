'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/Icon';
import { getToken } from '@/lib/api';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4949';

// Mismos mimetypes que acepta ALLOWED_IMAGE en backend/src/media/media.service.ts.
// Validamos acá para no gastar la subida de un HEIC de iPhone (que el backend
// rechaza igual) y poder decirle al negocio, archivo por archivo, por qué se
// descartó.
const ACCEPTED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

// El endpoint /api/media/upload recibe UN archivo por request (FileInterceptor),
// así que un lote son N requests. Tres a la vez es el techo: una carta larga son
// imágenes de varios MB y la conexión del negocio (a menudo el wifi del local)
// se satura si se lanzan las 20 juntas — se cortan a la mitad y hay que
// reintentar todo.
const MAX_CONCURRENT_UPLOADS = 3;

type Problem = { name: string; reason: string };

function prettyBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Extrae el mensaje del error de Nest (`{"message": "..."}`) o cae al texto crudo. */
function serverError(body: string, status: number): string {
  try {
    const parsed = JSON.parse(body);
    const msg = parsed?.message;
    if (typeof msg === 'string' && msg) return msg;
    if (Array.isArray(msg) && msg.length) return String(msg[0]);
  } catch {
    /* respuesta no-JSON (proxy caído, 502…) — usamos el texto tal cual */
  }
  return body?.slice(0, 140) || `HTTP ${status}`;
}

function uploadOne(
  file: File,
  folder: string,
  onBytes: (loaded: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append('file', file, file.name);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API}/api/media/upload?folder=${encodeURIComponent(folder)}`);
    const token = getToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onBytes(e.loaded);
    };
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(serverError(xhr.responseText, xhr.status)));
        return;
      }
      try {
        const data = JSON.parse(xhr.responseText);
        if (!data?.url) throw new Error('sin url');
        resolve(data.url as string);
      } catch {
        reject(new Error('Respuesta del servidor inválida'));
      }
    };
    xhr.onerror = () => reject(new Error('Fallo de red'));
    xhr.onabort = () => reject(new Error('Subida cancelada'));
    xhr.send(fd);
  });
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
  maxSizeMb = 25,
  onUploadPage,
  onDone,
}: {
  folder?: string;
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

  function validate(files: File[]): { valid: File[]; discarded: Problem[] } {
    const valid: File[] = [];
    const bad: Problem[] = [];
    for (const f of files) {
      if (!ACCEPTED_MIME.includes(f.type)) {
        bad.push({ name: f.name, reason: t('uploaderReasonFormat') });
      } else if (f.size > maxSizeMb * 1024 * 1024) {
        bad.push({
          name: f.name,
          reason: t('uploaderReasonTooBig', {
            size: prettyBytes(f.size),
            max: maxSizeMb,
          }),
        });
      } else {
        valid.push(f);
      }
    }
    return { valid, discarded: bad };
  }

  async function run(picked: File[]) {
    if (busy || picked.length === 0) return;
    setAdded(0);
    setFailed([]);

    // Validar el lote ENTERO antes de empezar: si algo se va a descartar, el
    // negocio lo ve de una y no a mitad de una subida de diez minutos.
    const { valid, discarded: bad } = validate(picked);
    setDiscarded(bad);
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
          const url = await uploadOne(valid[i], folder, (n) => bumpBytes(i, n));
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
              {t('uploaderProgress', { done, total })}
            </div>
            <div className="text-xs text-mute">{pct}%</div>
          </>
        ) : (
          <>
            <div className="w-10 h-10 rounded-full bg-brand-soft flex items-center justify-center text-brand">
              <Icon name="plus" size={18} />
            </div>
            <div className="text-sm font-medium">{t('uploaderCta')}</div>
            <div className="text-xs text-mute text-center px-3">
              {t('uploaderHint', { max: maxSizeMb })}
            </div>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
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
