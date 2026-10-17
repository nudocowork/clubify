'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';
import { FileUploader } from '@/components/FileUploader';
import { usd } from '../_lib';
import { CampoMotivo, Modal } from './Modal';

const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());

/**
 * Registrar la transferencia a UNA persona dentro de un corte abierto. Es el
 * mismo paso que «Corte actual» en /admin/commissions (marca sus comisiones del
 * corte como pagadas, guarda el comprobante y avisa); aquí se pide además el
 * motivo para el historial. Cerrar el corte entero sigue en /admin/commissions.
 */
export function PagoPersona({
  nombre,
  codeId,
  corte,
  onCerrar,
  onListo,
}: {
  nombre: string;
  codeId: string;
  corte: { batchId: string; code: string; pendienteUsd: number };
  onCerrar: () => void;
  onListo: () => void;
}) {
  const [dia, setDia] = useState(hoy);
  const [referencia, setReferencia] = useState('');
  const [comprobante, setComprobante] = useState<string | null>(null);
  const [mime, setMime] = useState<string | null>(null);
  const [motivo, setMotivo] = useState('');
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    setGuardando(true);
    try {
      await api('/admin/reporte-comisiones/pago-persona', {
        method: 'POST',
        body: JSON.stringify({
          batchId: corte.batchId,
          recipientCodeId: codeId,
          paymentDate: dia,
          reference: referencia || undefined,
          proofUrl: comprobante ?? undefined,
          proofMimeType: mime ?? undefined,
          motivo,
        }),
      });
      toast(`Pago de ${nombre} registrado.`, 'success');
      onListo();
    } catch (e: any) {
      toast(e?.message ?? 'No se pudo registrar el pago', 'error');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal titulo={`Registrar pago a ${nombre}`} subtitulo={`${corte.code} · por pagar ${usd(corte.pendienteUsd)}`} onCerrar={onCerrar} ancho="max-w-lg">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Fecha real de la transferencia</label>
            <input type="date" className="input" value={dia} onChange={(e) => setDia(e.target.value)} />
          </div>
          <div>
            <label className="label">Referencia</label>
            <input className="input" maxLength={120} value={referencia} onChange={(e) => setReferencia(e.target.value)} placeholder="Nº de comprobante" />
          </div>
        </div>
        <FileUploader
          value={comprobante}
          contentType={mime}
          onChange={(u, meta) => {
            setComprobante(u);
            setMime(meta?.contentType ?? null);
          }}
          folder="payout-proofs"
          kind="imageOrPdf"
          label="Comprobante de la transferencia"
        />
        <CampoMotivo value={motivo} onChange={setMotivo} />
        <div className="flex gap-2 justify-end">
          <button className="btn-ghost" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </button>
          <button className="btn-primary" onClick={guardar} disabled={guardando || motivo.trim().length < 5}>
            {guardando ? 'Guardando…' : 'Confirmar pago'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
