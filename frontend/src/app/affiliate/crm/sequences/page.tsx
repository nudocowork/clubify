'use client';

/**
 * /affiliate/crm/sequences — Lista de secuencias automatizadas (F4).
 *
 * El user define workflows tipo "Cuando entra un contacto, mandale
 * bienvenida, espera 1h, mandale PDF, espera 1d, etc.". El builder
 * visual está en /affiliate/crm/sequences/[id].
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';

type Sequence = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  _count: {
    steps: number;
    triggers: number;
    enrollments: number;
  };
};

export default function SequencesListPage() {
  const router = useRouter();
  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [showNewModal, setShowNewModal] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const data = await api<Sequence[]>('/crm/sequences');
      setSequences(data);
    } catch (e: any) {
      toast(e.message ?? 'No se pudieron cargar las secuencias', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function createSequence() {
    if (!newName.trim()) {
      toast('Ponele un nombre', 'error');
      return;
    }
    setCreating(true);
    try {
      const seq = await api<Sequence>('/crm/sequences', {
        method: 'POST',
        body: JSON.stringify({
          name: newName.trim(),
          isActive: false,
          steps: [],
          triggers: [],
        }),
      });
      router.push(`/affiliate/crm/sequences/${seq.id}`);
    } catch (e: any) {
      toast(e.message ?? 'No se pudo crear', 'error');
    } finally {
      setCreating(false);
    }
  }

  async function toggleActive(seq: Sequence) {
    try {
      await api(`/crm/sequences/${seq.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !seq.isActive }),
      });
      load();
    } catch (e: any) {
      toast(e.message ?? 'No se pudo actualizar', 'error');
    }
  }

  async function duplicate(seq: Sequence) {
    try {
      await api(`/crm/sequences/${seq.id}/duplicate`, { method: 'POST' });
      load();
      toast('Secuencia duplicada', 'success');
    } catch (e: any) {
      toast(e.message ?? 'No se pudo duplicar', 'error');
    }
  }

  async function remove(seq: Sequence) {
    if (!confirm(`Eliminar "${seq.name}"? Esto cancela todos los enrollments activos.`)) return;
    try {
      await api(`/crm/sequences/${seq.id}`, { method: 'DELETE' });
      load();
      toast('Secuencia eliminada', 'success');
    } catch (e: any) {
      toast(e.message ?? 'No se pudo eliminar', 'error');
    }
  }

  return (
    <div className="px-4 sm:px-6 py-6 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-6">
        <div>
          <div className="flex items-center gap-2 text-sm text-mute mb-1">
            <Link href="/affiliate/crm" className="hover:text-ink">
              ← CRM
            </Link>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold m-0">
            Secuencias automatizadas
          </h1>
          <p className="text-sm text-mute mt-1 leading-relaxed">
            Workflows que envían mensajes, esperan tiempo y mueven contactos
            entre etapas automáticamente.
          </p>
        </div>
        <button
          className="btn-primary"
          onClick={() => setShowNewModal(true)}
        >
          + Nueva secuencia
        </button>
      </div>

      {loading ? (
        <div className="py-12 text-center text-mute text-sm">Cargando…</div>
      ) : sequences.length === 0 ? (
        <div className="rounded-input border border-line bg-bg2/40 p-8 text-center">
          <div className="text-4xl mb-3">🤖</div>
          <h2 className="text-lg font-semibold mb-2">
            Todavía no tienes secuencias
          </h2>
          <p className="text-sm text-mute mb-4 max-w-md mx-auto leading-relaxed">
            Crea tu primera secuencia para automatizar follow-ups: ej. enviar
            un mensaje de bienvenida apenas entra un contacto, esperar 1 día y
            enviar un PDF.
          </p>
          <button
            className="btn-primary"
            onClick={() => setShowNewModal(true)}
          >
            Crear mi primera secuencia
          </button>
        </div>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {sequences.map((seq) => (
            <li
              key={seq.id}
              className="rounded-input border border-line bg-bg p-4 flex flex-col gap-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/affiliate/crm/sequences/${seq.id}`}
                    className="font-semibold text-base hover:text-brand truncate block"
                  >
                    {seq.name}
                  </Link>
                  {seq.description && (
                    <p className="text-xs text-mute mt-1 line-clamp-2">
                      {seq.description}
                    </p>
                  )}
                </div>
                <label className="flex items-center gap-1.5 text-xs flex-shrink-0">
                  <input
                    type="checkbox"
                    checked={seq.isActive}
                    onChange={() => toggleActive(seq)}
                    className="accent-brand"
                  />
                  <span className={seq.isActive ? 'text-good' : 'text-mute'}>
                    {seq.isActive ? 'Activa' : 'Inactiva'}
                  </span>
                </label>
              </div>
              <div className="flex items-center gap-3 text-xs text-mute flex-wrap">
                <span>📋 {seq._count.steps} pasos</span>
                <span>⚡ {seq._count.triggers} triggers</span>
                <span>👥 {seq._count.enrollments} contactos</span>
              </div>
              <div className="flex gap-2 mt-1">
                <Link
                  href={`/affiliate/crm/sequences/${seq.id}`}
                  className="btn-ghost text-xs flex-1 justify-center"
                >
                  Editar
                </Link>
                <button
                  className="btn-ghost text-xs"
                  onClick={() => duplicate(seq)}
                  title="Duplicar"
                >
                  📋
                </button>
                <button
                  className="btn-danger text-xs"
                  onClick={() => remove(seq)}
                  title="Eliminar"
                >
                  🗑️
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* New sequence modal */}
      {showNewModal && (
        <div
          className="fixed inset-0 z-50 bg-ink/70 flex items-end sm:items-center justify-center sm:p-4"
          onClick={() => setShowNewModal(false)}
        >
          <div
            className="bg-bg rounded-t-2xl sm:rounded-2xl shadow-xl w-full max-w-md p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold mb-3">Nueva secuencia</h2>
            <label className="block mb-4">
              <div className="text-xs text-mute mb-1">Nombre</div>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Ej. Bienvenida nuevos contactos"
                className="input w-full"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') createSequence();
                  if (e.key === 'Escape') setShowNewModal(false);
                }}
              />
            </label>
            <div className="flex justify-end gap-2">
              <button
                className="btn-ghost"
                onClick={() => setShowNewModal(false)}
                disabled={creating}
              >
                Cancelar
              </button>
              <button
                className="btn-primary"
                onClick={createSequence}
                disabled={creating || !newName.trim()}
              >
                {creating ? 'Creando…' : 'Crear y editar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
