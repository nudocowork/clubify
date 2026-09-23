'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';
import ListaDeCarpetas from '@/components/automatizaciones/ListaDeCarpetas';
import FilaDeMensaje from '@/components/automatizaciones/FilaDeMensaje';
import DetalleDeMensaje from '@/components/automatizaciones/DetalleDeMensaje';
import {
  coincideConBusqueda,
  correoDe,
  type BorradorDeCorreo,
  type BrandMsgFolder,
  type BrandMsgTemplate,
} from '@/components/automatizaciones/tipos';

// Panel de Automatizaciones de la PROPIA marca (panel /admin). Se scopea solo
// contra `/admin/automations/*` (el backend resuelve la marca del token). Lista
// los mensajes SMS/WhatsApp que el sistema envía, organizados en carpetas
// (Administrativa / Cobros / Operativas + las que crees). Editar vacío = volver
// al default. Los workflows "pending" son editables pero su envío se activa
// en un paso posterior.
//
// LA PANTALLA (rediseño 2026-09-23): dos columnas. A la izquierda el buscador,
// las carpetas y los destinos de prueba; a la derecha los mensajes de la
// carpeta elegida, uno por línea. Editar abre un panel lateral.
//
// Antes eran todas las carpetas apiladas, cada mensaje una tarjeta que se
// desplegaba hacia abajo y dos bloques de color a pantalla completa arriba con
// los campos de prueba. Con ~30 mensajes no se sabía dónde estabas, y el editor
// de correo quedaba a media pantalla de scroll de su propio botón de guardar.
//
// Los ENDPOINTS y los datos son exactamente los de antes: esto es solo la
// pantalla.

export default function AutomatizacionesPanel() {
  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<BrandMsgTemplate[]>([]);
  const [folders, setFolders] = useState<BrandMsgFolder[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [phoneDraft, setPhoneDraft] = useState('');
  const [growConnected, setGrowConnected] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  // Borradores del correo, por id de plantilla de correo.
  const [mailDrafts, setMailDrafts] = useState<
    Record<string, BorradorDeCorreo>
  >({});
  const [emailDraft, setEmailDraft] = useState('');
  const [emailConnected, setEmailConnected] = useState(true);
  const [testingMailId, setTestingMailId] = useState<string | null>(null);
  const [savingMailId, setSavingMailId] = useState<string | null>(null);
  // Carpeta elegida y buscador. `null` = todas: solo se usa mientras hay algo
  // escrito en el buscador, porque el buscador mira TODAS las carpetas.
  const [carpetaActiva, setCarpetaActiva] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState('');
  // Nota descartable (2-3 líneas): explica que estas automatizaciones vienen
  // activas por defecto. Se recuerda el descarte por navegador (patrón
  // localStorage de InsightsCard). `noteChecked` evita el flash antes de leerla.
  const [noteDismissed, setNoteDismissed] = useState(false);
  const [noteChecked, setNoteChecked] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem('clubify:admin:automations-note:dismissed') === '1') {
        setNoteDismissed(true);
      }
    } catch {}
    setNoteChecked(true);
  }, []);

  function dismissNote() {
    setNoteDismissed(true);
    try {
      localStorage.setItem('clubify:admin:automations-note:dismissed', '1');
    } catch {}
  }

  function applyData(d: any) {
    const list: BrandMsgTemplate[] = d?.templates ?? [];
    setTemplates(list);
    setFolders(d?.folders ?? []);
    setDrafts(Object.fromEntries(list.map((t) => [t.id, t.text])));
    setGrowConnected(!!d?.growConnected);
    setEmailConnected(d?.emailConnected !== false);
    if (d?.testPhone !== undefined) setPhoneDraft(d.testPhone ?? '');
    if (d?.testEmail !== undefined) setEmailDraft(d.testEmail ?? '');
    // Un correo puede venir como gemelo de una automatización o como tarjeta
    // suelta (bienvenida, panel creado): los dos casos alimentan el borrador.
    const mails: Record<string, BorradorDeCorreo> = {};
    for (const t of list) {
      if (t.email) {
        mails[t.email.id] = { subject: t.email.subject, body: t.email.body };
      } else if (t.channel === 'EMAIL') {
        mails[t.id] = { subject: t.subject ?? '', body: t.text };
      }
    }
    setMailDrafts(mails);
  }

  /** Guarda asunto + cuerpo de un correo. Ambos vacíos = volver al default. */
  async function saveMail(emailId: string, subject: string, body: string) {
    setSavingMailId(emailId);
    try {
      applyData(
        await api(`/admin/automations/message-templates/${emailId}`, {
          method: 'PATCH',
          body: JSON.stringify({ text: body, subject }),
        }),
      );
      const limpio = !subject.trim() && !body.trim();
      toast(limpio ? 'Correo restaurado' : 'Correo actualizado', 'success');
    } catch (e: any) {
      toast(e.message ?? 'Error al guardar el correo', 'error');
    } finally {
      setSavingMailId(null);
    }
  }

  /** Manda este correo al correo de prueba, con el texto que hay en pantalla. */
  async function testMail(emailId: string, subject: string, body: string) {
    if (!emailDraft.trim()) {
      toast('Escribe un correo de prueba en «Cambiar destinos de prueba»', 'error');
      return;
    }
    setTestingMailId(emailId);
    try {
      await api('/admin/automations/test-email', {
        method: 'PATCH',
        body: JSON.stringify({ email: emailDraft }),
      });
      const r: any = await api(
        `/admin/automations/message-templates/${emailId}/test-email`,
        { method: 'POST', body: JSON.stringify({ subject, body }) },
      );
      toast(`Correo de prueba enviado a ${r?.to ?? emailDraft}`, 'success');
    } catch (e: any) {
      toast(e.message ?? 'No se pudo enviar el correo de prueba', 'error');
    } finally {
      setTestingMailId(null);
    }
  }

  async function savePhone() {
    setBusy(true);
    try {
      const r: any = await api('/admin/automations/test-phone', {
        method: 'PATCH',
        body: JSON.stringify({ phone: phoneDraft }),
      });
      setPhoneDraft(r?.phone ?? phoneDraft);
      toast('Número de prueba guardado', 'success');
    } catch (e: any) {
      toast(e.message ?? 'Error al guardar el número', 'error');
    } finally {
      setBusy(false);
    }
  }

  /** Guarda el correo de prueba, igual que el número. El endpoint ya existía;
   *  faltaba el botón, así que lo escrito se perdía al recargar. */
  async function saveEmail() {
    setBusy(true);
    try {
      const escrito = emailDraft.trim();
      const r: any = await api('/admin/automations/test-email', {
        method: 'PATCH',
        body: JSON.stringify({ email: emailDraft }),
      });
      // Nunca vaciar el campo por una respuesta que no trae el valor: si el
      // servidor cambia de forma, el usuario vería «guardado» y su correo
      // desapareciendo. Ante la duda, gana lo que él escribió.
      const guardado = r?.email ?? r?.testEmail ?? escrito;
      setEmailDraft(guardado);
      toast(
        guardado.trim() ? 'Correo de prueba guardado' : 'Correo de prueba borrado',
        'success',
      );
    } catch (e: any) {
      toast(e.message ?? 'Error al guardar el correo', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function testSend(id: string, text: string) {
    if (!phoneDraft.trim()) {
      toast('Escribe y guarda un número de prueba primero', 'error');
      return;
    }
    setTestingId(id);
    try {
      // Guarda el número (para que quede persistido) y envía la prueba.
      await api('/admin/automations/test-phone', {
        method: 'PATCH',
        body: JSON.stringify({ phone: phoneDraft }),
      });
      const r: any = await api(
        `/admin/automations/message-templates/${id}/test`,
        { method: 'POST', body: JSON.stringify({ text }) },
      );
      toast(r?.ok ? 'WhatsApp de prueba enviado' : r?.message ?? 'No se pudo enviar', r?.ok ? 'success' : 'error');
    } catch (e: any) {
      toast(e.message ?? 'Error al enviar la prueba', 'error');
    } finally {
      setTestingId(null);
    }
  }

  async function load() {
    setLoading(true);
    try {
      applyData(await api('/admin/automations/message-templates'));
    } catch {
      /* noop */
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function save(id: string, text: string) {
    setSavingId(id);
    try {
      applyData(
        await api(`/admin/automations/message-templates/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ text }),
        }),
      );
      toast(text.trim() ? 'Mensaje actualizado' : 'Mensaje restaurado', 'success');
    } catch (e: any) {
      toast(e.message ?? 'Error al guardar el mensaje', 'error');
    } finally {
      setSavingId(null);
    }
  }

  async function toggleSend(id: string, enabled: boolean) {
    setBusy(true);
    try {
      applyData(
        await api(`/admin/automations/message-templates/${id}/enabled`, {
          method: 'PATCH',
          body: JSON.stringify({ enabled }),
        }),
      );
      toast(enabled ? 'Envío activado' : 'Envío desactivado', 'success');
    } catch (e: any) {
      toast(e.message ?? 'Error al cambiar el envío', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function moveTo(id: string, folderId: string) {
    setBusy(true);
    try {
      applyData(
        await api(`/admin/automations/message-templates/${id}/folder`, {
          method: 'PATCH',
          body: JSON.stringify({ folderId }),
        }),
      );
      // Seguir al mensaje a su carpeta nueva: si no, desaparece de la lista que
      // estás mirando y parece que se ha borrado.
      setCarpetaActiva(folderId);
      toast('Mensaje movido de carpeta', 'success');
    } catch (e: any) {
      toast(e.message ?? 'Error al mover', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function createFolder() {
    const name = window.prompt('Nombre de la nueva carpeta:')?.trim();
    if (!name) return;
    setBusy(true);
    try {
      applyData(
        await api('/admin/automations/folders', {
          method: 'POST',
          body: JSON.stringify({ name }),
        }),
      );
      toast('Carpeta creada', 'success');
    } catch (e: any) {
      toast(e.message ?? 'Error al crear carpeta', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function renameFolder(f: BrandMsgFolder) {
    const name = window.prompt('Nuevo nombre de la carpeta:', f.name)?.trim();
    if (!name || name === f.name) return;
    setBusy(true);
    try {
      applyData(
        await api(`/admin/automations/folders/${f.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ name }),
        }),
      );
      toast('Carpeta renombrada', 'success');
    } catch (e: any) {
      toast(e.message ?? 'Error al renombrar', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function deleteFolder(f: BrandMsgFolder) {
    if (
      !window.confirm(
        `¿Borrar la carpeta "${f.name}"? Sus workflows vuelven a su carpeta original.`,
      )
    )
      return;
    setBusy(true);
    try {
      applyData(
        await api(`/admin/automations/folders/${f.id}`, { method: 'DELETE' }),
      );
      // La carpeta elegida ya no existe: volver a la primera en el render.
      setCarpetaActiva(null);
      toast('Carpeta borrada', 'success');
    } catch (e: any) {
      toast(e.message ?? 'Error al borrar', 'error');
    } finally {
      setBusy(false);
    }
  }

  // ---- Qué se ve ----------------------------------------------------------

  const q = busqueda.trim().toLowerCase();
  const enBusqueda = q.length > 0;

  const filtrados = useMemo(
    () => templates.filter((t) => coincideConBusqueda(t, q)),
    [templates, q],
  );
  const conteos = useMemo(() => {
    const r: Record<string, number> = {};
    for (const t of filtrados) r[t.folderId] = (r[t.folderId] ?? 0) + 1;
    return r;
  }, [filtrados]);

  // Sin búsqueda siempre hay una carpeta elegida: `null` solo tiene sentido
  // mientras se busca (el buscador mira todas las carpetas a la vez).
  useEffect(() => {
    if (enBusqueda || !folders.length) return;
    // También cubre la carpeta que ya no existe (la acabas de borrar): sin esto
    // el listado se quedaba enseñando «todas» sin que nadie lo hubiera pedido.
    if (carpetaActiva && folders.some((f) => f.id === carpetaActiva)) return;
    setCarpetaActiva(folders[0].id);
  }, [enBusqueda, carpetaActiva, folders]);

  const carpetaValida = folders.some((f) => f.id === carpetaActiva)
    ? carpetaActiva
    : null;
  const carpeta = folders.find((f) => f.id === carpetaValida) ?? null;
  const visibles = carpetaValida
    ? filtrados.filter((t) => t.folderId === carpetaValida)
    : filtrados;
  const enviando = visibles.filter((t) => t.enabled).length;
  const nombreDeCarpeta = useMemo(
    () => Object.fromEntries(folders.map((f) => [f.id, f.name])),
    [folders],
  );

  const abierto = templates.find((t) => t.id === openId) ?? null;
  const correoAbierto = abierto ? correoDe(abierto) : null;
  // `useCallback` para que el efecto de Escape del panel no se vuelva a montar
  // en cada render del listado.
  const cerrarDetalle = useCallback(() => setOpenId(null), []);

  return (
    <div>
      <div className="mb-3">
        <h1 className="m-0 text-xl font-bold">Automatizaciones</h1>
        <p className="m-0 mt-0.5 text-xs text-mute">
          Los mensajes que el sistema envía solo a tus negocios, por WhatsApp y
          por correo. Elige una carpeta y abre un mensaje para editarlo.
        </p>
      </div>

      {noteChecked && !noteDismissed && (
        <div className="mb-4 flex items-start gap-2 rounded-card border border-line bg-bg2 p-3">
          <span className="text-base leading-none" aria-hidden>
            ✅
          </span>
          <p className="m-0 flex-1 text-xs leading-relaxed text-mute">
            Vienen <b className="text-ink">activas por defecto</b> para que tus
            negocios reciban avisos de cobro, cancelaciones y novedades sin
            configurarlas. Puedes apagar o editar cualquiera desde su panel, y
            correo y WhatsApp se controlan por separado.
          </p>
          <button
            type="button"
            onClick={dismissNote}
            aria-label="Descartar la nota"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-input text-sm text-mute hover:bg-white"
          >
            ✕
          </button>
        </div>
      )}

      {loading ? (
        <div className="text-sm text-mute2">Cargando…</div>
      ) : (
        <div className="flex flex-col gap-4 min-[900px]:flex-row min-[900px]:items-start min-[900px]:gap-5">
          <ListaDeCarpetas
            carpetas={folders}
            conteos={conteos}
            totalFiltrado={filtrados.length}
            busqueda={busqueda}
            onBuscar={(v) => {
              setBusqueda(v);
              // Buscar mira TODAS las carpetas: si se quedara la elegida, una
              // búsqueda que solo casa en otra carpeta se vería vacía y
              // parecería que el buscador no funciona.
              if (v.trim()) setCarpetaActiva(null);
            }}
            carpetaActiva={carpetaValida}
            onElegirCarpeta={setCarpetaActiva}
            telefono={phoneDraft}
            onTelefono={setPhoneDraft}
            onGuardarTelefono={savePhone}
            correo={emailDraft}
            onCorreo={setEmailDraft}
            onGuardarCorreo={saveEmail}
            guardando={busy}
            growConnected={growConnected}
            emailConnected={emailConnected}
          />

          <section className="min-w-0 flex-1">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <h2 className="m-0 text-sm font-bold text-ink">
                  {carpeta ? carpeta.name : 'Todas las carpetas'}
                </h2>
                <p className="m-0 text-[11px] text-mute">
                  {visibles.length}{' '}
                  {visibles.length === 1 ? 'mensaje' : 'mensajes'} · {enviando}{' '}
                  enviando
                  {enBusqueda ? ` · buscando «${busqueda.trim()}»` : ''}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {carpeta && !carpeta.system && (
                  <>
                    <button
                      type="button"
                      onClick={() => renameFolder(carpeta)}
                      disabled={busy}
                      className="min-h-[44px] rounded-input px-3 text-xs font-semibold text-mute hover:bg-bg2 disabled:opacity-50"
                    >
                      Renombrar
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteFolder(carpeta)}
                      disabled={busy}
                      className="min-h-[44px] rounded-input px-3 text-xs font-semibold text-bad hover:bg-bad-soft disabled:opacity-50"
                    >
                      Borrar
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={createFolder}
                  disabled={busy}
                  className="min-h-[44px] rounded-input border border-line bg-white px-3 text-xs font-semibold text-ink hover:bg-bg2 disabled:opacity-50"
                >
                  + Carpeta
                </button>
              </div>
            </div>

            <div className="overflow-hidden rounded-card border border-line bg-white">
              {visibles.length === 0 ? (
                <p className="m-0 px-4 py-8 text-center text-xs text-mute2">
                  {enBusqueda
                    ? `Ningún mensaje coincide con «${busqueda.trim()}».`
                    : 'Esta carpeta está vacía. Abre un mensaje de otra carpeta y cámbiale la carpeta desde su panel.'}
                </p>
              ) : (
                visibles.map((t) => (
                  <FilaDeMensaje
                    key={t.id}
                    t={t}
                    carpeta={
                      carpetaValida ? null : nombreDeCarpeta[t.folderId] ?? null
                    }
                    abierta={openId === t.id}
                    onAbrir={() => setOpenId(t.id)}
                  />
                ))
              )}
            </div>
          </section>
        </div>
      )}

      {abierto && (
        <DetalleDeMensaje
          key={abierto.id}
          t={abierto}
          carpetas={folders}
          draftTexto={drafts[abierto.id] ?? abierto.text}
          onDraftTexto={(v) =>
            setDrafts((p) => ({ ...p, [abierto.id]: v }))
          }
          draftCorreo={correoAbierto ? mailDrafts[correoAbierto.id] ?? null : null}
          onDraftCorreo={(v) =>
            correoAbierto &&
            setMailDrafts((p) => ({ ...p, [correoAbierto.id]: v }))
          }
          guardandoTexto={savingId === abierto.id}
          guardandoCorreo={!!correoAbierto && savingMailId === correoAbierto.id}
          probandoTexto={testingId === abierto.id}
          probandoCorreo={!!correoAbierto && testingMailId === correoAbierto.id}
          ocupado={busy}
          telefonoPrueba={phoneDraft}
          correoPrueba={emailDraft}
          growConnected={growConnected}
          emailConnected={emailConnected}
          onGuardarTexto={(texto) => save(abierto.id, texto)}
          onProbarTexto={(texto) => testSend(abierto.id, texto)}
          onGuardarCorreo={saveMail}
          onProbarCorreo={testMail}
          onAlternarEnvio={toggleSend}
          onMover={(folderId) => moveTo(abierto.id, folderId)}
          onCerrar={cerrarDetalle}
        />
      )}
    </div>
  );
}
