'use client';
/**
 * Modal de duplicación de negocios (item 12 del sprint). Lo abre el
 * SUPER_ADMIN desde el ActionsMenu de /admin/tenants. Tiene 2 fases:
 *   1) Form con datos del nuevo negocio + toggle "solo config / config + DB".
 *   2) Panel de resultados step-by-step (✓/⚠) con links a entrar/ver/copiar.
 *
 * Si el backend responde 409 por email duplicado, mostramos un checkbox
 * "Forzar duplicado de email" — el SUPER_ADMIN confirma y reintentamos
 * con allowDuplicateEmail=true.
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';

type Step = {
  name: string;
  status: 'ok' | 'error' | 'skip';
  message?: string;
  count?: number;
};

type DuplicateResult = {
  newTenantId: string;
  newSlug: string;
  publicUrl: string;
  includeDatabase: boolean;
  steps: Step[];
  ownerTempPassword?: string;
};

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 40);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SLUG_RE = /^[a-z0-9-]+$/;

export function DuplicateBusinessModal({
  source,
  onClose,
}: {
  source: { id: string; brandName: string; slug: string };
  onClose: () => void;
}) {
  const [brandName, setBrandName] = useState('');
  // Slug separado para no reescribirlo después de que el user lo toque a mano.
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [includeDatabase, setIncludeDatabase] = useState(false);
  const [allowDuplicateEmail, setAllowDuplicateEmail] = useState(false);
  const [needsAllowEmail, setNeedsAllowEmail] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<DuplicateResult | null>(null);

  // Auto-genera slug a partir de brandName hasta que el user lo toque.
  useEffect(() => {
    if (!slugTouched) setSlug(slugify(brandName));
  }, [brandName, slugTouched]);

  const errors = useMemo(() => {
    const errs: Record<string, string> = {};
    if (brandName.trim().length < 2) {
      errs.brandName = 'Mínimo 2 caracteres';
    } else if (brandName.trim().length > 80) {
      errs.brandName = 'Máximo 80 caracteres';
    }
    if (slug.length < 3) {
      errs.slug = 'Mínimo 3 caracteres';
    } else if (!SLUG_RE.test(slug)) {
      errs.slug = 'Solo minúsculas, números y guiones';
    }
    if (!EMAIL_RE.test(email)) errs.email = 'Correo no válido';
    if (password && password.length < 8) {
      errs.password = 'Mínimo 8 caracteres si la defines';
    }
    return errs;
  }, [brandName, slug, email, password]);

  const canSubmit =
    !submitting &&
    Object.keys(errors).length === 0 &&
    brandName.trim().length > 0 &&
    slug.length > 0 &&
    email.length > 0;

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        newBrandName: brandName.trim(),
        newSlug: slug,
        newOwnerEmail: email.trim().toLowerCase(),
        includeDatabase,
      };
      if (phone.trim()) body.newOwnerPhone = phone.trim();
      if (password.trim()) body.newOwnerPassword = password.trim();
      if (allowDuplicateEmail) body.allowDuplicateEmail = true;

      const res = await api<DuplicateResult>(
        `/admin/tenants/${source.id}/duplicate`,
        {
          method: 'POST',
          body: JSON.stringify(body),
        },
      );
      setResult(res);
      toast('Negocio duplicado', 'success');
    } catch (e: any) {
      const msg = e?.message || 'No se pudo duplicar el negocio';
      // 409 + texto sobre email = ofrecé "forzar duplicado".
      if (e?.status === 409 && /correo|email/i.test(msg)) {
        setNeedsAllowEmail(true);
      }
      toast(msg, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function copyPublicUrl() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.publicUrl);
      toast('Enlace copiado', 'success');
    } catch {
      toast('No se pudo copiar', 'error');
    }
  }

  async function copyPassword() {
    if (!result?.ownerTempPassword) return;
    try {
      await navigator.clipboard.writeText(result.ownerTempPassword);
      toast('Contraseña copiada', 'success');
    } catch {
      toast('No se pudo copiar', 'error');
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-line2 flex items-start gap-3">
          <div className="w-9 h-9 rounded-full bg-brand-soft flex items-center justify-center text-brand shrink-0">
            <span className="text-lg">📋</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-base">
              {result ? 'Negocio duplicado' : 'Duplicar negocio'}
            </div>
            <div className="text-xs text-mute mt-0.5 truncate">
              {result ? `Origen: ${source.brandName}` : `Origen: ${source.brandName} (${source.slug})`}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-mute hover:text-ink text-2xl leading-none -mr-1 -mt-1 shrink-0"
            aria-label="Cerrar"
          >
            ×
          </button>
        </div>

        {!result && (
          <div className="px-5 py-4 overflow-y-auto space-y-4 text-sm">
            <Field
              label="Nombre del negocio"
              error={errors.brandName}
              required
            >
              <input
                type="text"
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                placeholder="Mi Nuevo Negocio"
                maxLength={80}
                className="input w-full"
              />
            </Field>

            <Field label="Slug público" error={errors.slug} required>
              <div className="flex items-center gap-1">
                <span className="text-mute text-xs whitespace-nowrap">
                  /m/
                </span>
                <input
                  type="text"
                  value={slug}
                  onChange={(e) => {
                    setSlug(e.target.value.toLowerCase());
                    setSlugTouched(true);
                  }}
                  placeholder="mi-nuevo-negocio"
                  maxLength={40}
                  className="input w-full flex-1"
                />
              </div>
              <div className="text-[11px] text-mute mt-1">
                Solo minúsculas, números y guiones.
              </div>
            </Field>

            <Field label="Correo del dueño" error={errors.email} required>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="dueno@ejemplo.com"
                autoComplete="off"
                className="input w-full"
              />
            </Field>

            <Field label="Teléfono del dueño (opcional)">
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+57 300 123 4567"
                className="input w-full"
              />
            </Field>

            <Field
              label="Contraseña del dueño (opcional)"
              error={errors.password}
            >
              <div className="flex gap-2">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Si lo dejas vacío, generamos una automáticamente"
                  autoComplete="new-password"
                  className="input w-full flex-1"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="btn-ghost text-xs px-3 shrink-0"
                >
                  {showPassword ? 'Ocultar' : 'Ver'}
                </button>
              </div>
            </Field>

            <div>
              <div className="text-xs text-mute mb-1.5 font-medium">
                Modalidad
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <ModeRadio
                  active={!includeDatabase}
                  onClick={() => setIncludeDatabase(false)}
                  title="Solo configuración"
                  desc="Menú, tarjetas, branding, QR, InfoLinks, libro, reseñas."
                />
                <ModeRadio
                  active={includeDatabase}
                  onClick={() => setIncludeDatabase(true)}
                  title="Configuración + base de datos"
                  desc="Además clientes, pases, sellos, pedidos, reseñas, badges."
                />
              </div>
            </div>

            {needsAllowEmail && (
              <label className="flex items-start gap-2 rounded-lg border border-warn/40 bg-warn-soft/50 px-3 py-2.5 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={allowDuplicateEmail}
                  onChange={(e) => setAllowDuplicateEmail(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  El correo ya está en uso por otro usuario. Marca esta
                  opción para crear el negocio igual — el nuevo dueño
                  necesitará usar otro correo para iniciar sesión.
                </span>
              </label>
            )}
          </div>
        )}

        {result && (
          <div className="px-5 py-4 overflow-y-auto space-y-4 text-sm">
            <div className="rounded-lg bg-ok-soft/40 border border-ok/30 px-3 py-2.5 text-xs text-ok">
              Negocio duplicado correctamente
              {result.includeDatabase
                ? ' (con base de datos completa).'
                : ' (solo configuración).'}
            </div>

            {result.ownerTempPassword && (
              <div className="rounded-lg border border-warn/30 bg-warn-soft/40 px-3 py-3 text-xs">
                <div className="font-semibold text-ink mb-1">
                  Contraseña temporal del nuevo dueño
                </div>
                <div className="flex items-center gap-2">
                  <code className="font-mono text-sm bg-white border border-line2 rounded px-2 py-1 flex-1 break-all">
                    {result.ownerTempPassword}
                  </code>
                  <button
                    type="button"
                    onClick={copyPassword}
                    className="btn-ghost text-xs px-2 py-1 shrink-0"
                  >
                    Copiar
                  </button>
                </div>
                <div className="mt-1 text-mute">
                  Compártela con el dueño — no se vuelve a mostrar.
                </div>
              </div>
            )}

            <div>
              <div className="text-xs text-mute mb-1.5 font-medium">
                Pasos del duplicado
              </div>
              <ul className="space-y-1">
                {result.steps.map((s, i) => (
                  <li
                    key={`${s.name}-${i}`}
                    className="flex items-start gap-2 text-xs"
                  >
                    <span
                      className={`mt-0.5 shrink-0 ${
                        s.status === 'ok'
                          ? 'text-ok'
                          : s.status === 'error'
                            ? 'text-bad'
                            : 'text-mute'
                      }`}
                    >
                      {s.status === 'ok'
                        ? '✓'
                        : s.status === 'error'
                          ? '⚠'
                          : '·'}
                    </span>
                    <span className="flex-1">
                      <span className="text-ink">{s.name}</span>
                      {typeof s.count === 'number' && s.status === 'ok' && (
                        <span className="text-mute"> · {s.count}</span>
                      )}
                      {s.message && (
                        <span className="block text-bad mt-0.5">
                          {s.message}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2">
              <Link
                href={`/admin/tenants/${result.newTenantId}`}
                onClick={onClose}
                className="btn-primary text-sm justify-center"
              >
                Ver nuevo negocio
              </Link>
              <Link
                href={`/admin/tenants/${source.id}`}
                onClick={onClose}
                className="btn-ghost text-sm justify-center"
              >
                Ver negocio original
              </Link>
              <button
                type="button"
                onClick={copyPublicUrl}
                className="btn-ghost text-sm justify-center sm:col-span-2"
              >
                Copiar enlace del menú: {result.publicUrl}
              </button>
            </div>
          </div>
        )}

        <div className="px-5 py-3 border-t border-line2 flex flex-col-reverse sm:flex-row items-stretch sm:items-center sm:justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="btn-ghost text-sm justify-center min-h-[44px] disabled:opacity-50"
          >
            {result ? 'Cerrar' : 'Cancelar'}
          </button>
          {!result && (
            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              className="btn-primary text-sm justify-center min-h-[44px] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? 'Duplicando…' : 'Duplicar negocio'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs text-mute mb-1 font-medium">
        {label}
        {required && <span className="text-bad ml-0.5">*</span>}
      </label>
      {children}
      {error && <div className="text-[11px] text-bad mt-1">{error}</div>}
    </div>
  );
}

function ModeRadio({
  active,
  onClick,
  title,
  desc,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  desc: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left rounded-lg border px-3 py-2.5 transition cursor-pointer touch-manipulation select-none active:scale-[0.99] ${
        active
          ? 'border-brand bg-brand-soft/30 ring-1 ring-brand'
          : 'border-line2 hover:border-line bg-white'
      }`}
    >
      <div className="font-medium text-sm text-ink">{title}</div>
      <div className="text-[11px] text-mute mt-0.5 leading-relaxed">{desc}</div>
    </button>
  );
}
