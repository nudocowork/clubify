'use client';
/**
 * Wallet V3 — Historial de sellos del negocio (Fase 5). Muestra los ajustes
 * (+1/-1, canjes, ajustes) con empleado, motivo, y — si la marca lo permite —
 * IP/dispositivo. Gateado por la marca (showHistory); el backend devuelve
 * enabled:false si está apagado.
 */
import { StampAuditTable } from '@/components/StampAuditTable';

export default function HistorialSellosPage() {
  return (
    <div>
      <h1 className="page-title">Historial de sellos</h1>
      <p className="text-sm text-mute mb-4 max-w-2xl">
        Registro de cada movimiento de sellos: quién lo hizo, cuándo, el motivo y
        el cliente. Toda modificación manual (sumar o restar un sello) queda
        auditada.
      </p>
      <div className="card card-pad">
        <StampAuditTable />
      </div>
    </div>
  );
}
