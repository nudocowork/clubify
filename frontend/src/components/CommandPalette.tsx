'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from './Icon';
import { api } from '@/lib/api';

type IconName = Parameters<typeof Icon>[0]['name'];

type Command = {
  id: string;
  label: string;
  href?: string;
  action?: () => void;
  group: string;
  keywords?: string;
  icon?: IconName;
};

export function CommandPalette({ variant }: { variant: 'admin' | 'app' }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [dynamic, setDynamic] = useState<Command[]>([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchSeq = useRef(0);

  const commands: Command[] = useMemo(() => {
    if (variant === 'admin') {
      return [
        { id: 'a1', group: 'Ir a', label: 'Dashboard', href: '/admin', icon: 'grid' },
        { id: 'a2', group: 'Ir a', label: 'Negocios', href: '/admin/tenants', icon: 'store' },
        { id: 'a3', group: 'Ir a', label: 'Referidos', href: '/admin/referrals', icon: 'gift' },
        { id: 'a4', group: 'Ir a', label: 'Audit log', href: '/admin/audit', icon: 'history' },
      ];
    }
    return [
      // Navegación principal
      { id: 'n1', group: 'Ir a', label: 'Dashboard', href: '/app', icon: 'grid' },
      { id: 'n2', group: 'Ir a', label: 'Pedidos', href: '/app/orders', icon: 'shopping-bag', keywords: 'orders kanban' },
      { id: 'n3', group: 'Ir a', label: 'Menú', href: '/app/menu', icon: 'menu', keywords: 'productos' },
      { id: 'n4', group: 'Ir a', label: 'Promociones', href: '/app/promos', icon: 'spark', keywords: 'descuentos cupones' },
      { id: 'n5', group: 'Ir a', label: 'Analítica', href: '/app/analytics', icon: 'history', keywords: 'metricas' },
      { id: 'n6', group: 'Ir a', label: 'Tarjetas de fidelización', href: '/app/cards', icon: 'card', keywords: 'sellos puntos loyalty' },
      { id: 'n7', group: 'Ir a', label: 'Clientes', href: '/app/customers', icon: 'users', keywords: 'crm' },
      { id: 'n8', group: 'Ir a', label: 'Escáner QR', href: '/scan', icon: 'qr', keywords: 'scanner barcode' },
      { id: 'n9', group: 'Ir a', label: 'Mensajes', href: '/app/messages', icon: 'send', keywords: 'whatsapp sms' },
      { id: 'n10', group: 'Ir a', label: 'Automatizaciones', href: '/app/automations', icon: 'spark' },
      { id: 'n11', group: 'Ir a', label: 'Notificaciones push', href: '/app/notifications', icon: 'bell' },
      { id: 'n12', group: 'Ir a', label: 'Mi sitio público', href: '/app/storefront', icon: 'store', keywords: 'storefront landing' },
      { id: 'n13', group: 'Ir a', label: 'InfoLinks', href: '/app/info-links', icon: 'arrow-right' },
      { id: 'n14', group: 'Ir a', label: 'Ubicaciones', href: '/app/locations', icon: 'pin', keywords: 'sucursales' },
      { id: 'n15', group: 'Ir a', label: 'Programa de referidos', href: '/app/referrals', icon: 'gift' },
      { id: 'n16', group: 'Ir a', label: 'Equipo de trabajo', href: '/app/staff', icon: 'users', keywords: 'team empleados staff' },
      { id: 'n17', group: 'Ir a', label: 'Suscripción', href: '/app/billing', icon: 'card', keywords: 'pago cobro' },
      { id: 'n18', group: 'Ir a', label: 'Mi cuenta', href: '/app/settings', icon: 'users', keywords: 'profile perfil' },
      { id: 'n19', group: 'Ir a', label: 'Novedades / changelog', href: '/app/whats-new', icon: 'spark', keywords: 'whats new release notes' },
      { id: 'n20', group: 'Ir a', label: 'Modo cocina TV', href: '/app/orders/display', icon: 'shopping-bag', keywords: 'kitchen display kanban' },
      { id: 'n21', group: 'Ir a', label: 'QR Menú imprimible', href: '/app/marketing/qr-menu', icon: 'qr', keywords: 'poster mesa cartel marketing' },
      { id: 'n22', group: 'Ir a', label: 'Marketing · QR', href: '/app/marketing', icon: 'spark', keywords: 'qr cartel poster marketing' },

      // Acciones rápidas
      { id: 'c1', group: 'Crear', label: 'Nuevo cliente', href: '/app/customers', icon: 'plus', keywords: 'add customer' },
      { id: 'c2', group: 'Crear', label: 'Nueva tarjeta de fidelización', href: '/app/cards/new', icon: 'plus' },
      { id: 'c3', group: 'Crear', label: 'Nuevo producto en menú', href: '/app/menu', icon: 'plus' },
      { id: 'c4', group: 'Crear', label: 'Nueva promoción', href: '/app/promos', icon: 'plus' },
      { id: 'c5', group: 'Crear', label: 'Nueva ubicación', href: '/app/locations', icon: 'plus' },
      { id: 'c6', group: 'Crear', label: 'Invitar empleado', href: '/app/staff', icon: 'plus' },
      { id: 'c7', group: 'Crear', label: 'Nueva regla de automatización', href: '/app/automations', icon: 'plus' },

      // Acciones
      { id: 'x1', group: 'Acciones', label: 'Abrir mi sitio público en nueva pestaña', icon: 'arrow-right',
        action: () => {
          // tomamos el slug de la sesión persistida (mejor esfuerzo)
          try {
            const u = JSON.parse(localStorage.getItem('clubify:user') || 'null');
            const slug = u?.tenant?.slug;
            window.open(slug ? `/m/${slug}` : '/app/storefront', '_blank');
          } catch {
            window.open('/app/storefront', '_blank');
          }
        } },
      { id: 'x2', group: 'Acciones', label: 'Abrir escáner', href: '/scan', icon: 'qr' },
      { id: 'x3', group: 'Acciones', label: 'Cerrar sesión', icon: 'out',
        action: () => {
          try {
            localStorage.removeItem('clubify:token');
            localStorage.removeItem('clubify:user');
          } catch {}
          window.location.href = '/login';
        } },
    ];
  }, [variant]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isMac = /Mac/.test(navigator.platform);
      const cmd = isMac ? e.metaKey : e.ctrlKey;
      if (cmd && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (open) {
      setQ('');
      setActive(0);
      setDynamic([]);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  // Búsqueda dinámica de clientes (solo en variant=app, con 2+ chars, debounced)
  useEffect(() => {
    if (variant !== 'app' || !open) return;
    const term = q.trim();
    if (term.length < 2) {
      setDynamic([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const seq = ++searchSeq.current;
    const timer = setTimeout(async () => {
      try {
        const customers = await api<any[]>(
          `/customers?search=${encodeURIComponent(term)}`,
        );
        if (seq !== searchSeq.current) return;
        setDynamic(
          customers.slice(0, 6).map((c) => ({
            id: `customer-${c.id}`,
            group: 'Clientes',
            label: c.fullName,
            keywords: `${c.email ?? ''} ${c.phone ?? ''}`,
            href: `/app/customers/${c.id}`,
            icon: 'users',
          })),
        );
      } catch {
        if (seq === searchSeq.current) setDynamic([]);
      } finally {
        if (seq === searchSeq.current) setSearching(false);
      }
    }, 220);
    return () => clearTimeout(timer);
  }, [q, open, variant]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const stat = !term
      ? commands
      : commands.filter((c) => {
          const hay = `${c.label} ${c.keywords ?? ''} ${c.group}`.toLowerCase();
          return hay.includes(term);
        });
    // Resultados dinámicos primero (clientes encontrados); luego comandos estáticos
    return [...dynamic, ...stat];
  }, [q, commands, dynamic]);

  // Group filtered for display
  const grouped = useMemo(() => {
    const m = new Map<string, Command[]>();
    for (const c of filtered) {
      if (!m.has(c.group)) m.set(c.group, []);
      m.get(c.group)!.push(c);
    }
    return Array.from(m.entries());
  }, [filtered]);

  function run(cmd: Command) {
    setOpen(false);
    if (cmd.href) router.push(cmd.href);
    else if (cmd.action) cmd.action();
  }

  function onInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const cmd = filtered[active];
      if (cmd) run(cmd);
    }
  }

  if (!open) return null;

  let runningIndex = -1;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] px-4">
      <div
        className="absolute inset-0 bg-ink/60 backdrop-blur-sm"
        onClick={() => setOpen(false)}
      />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-line2">
          <Icon name="search" size={18} className="text-mute" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={onInputKey}
            placeholder="Buscar páginas, acciones, atajos…"
            className="flex-1 outline-none text-sm bg-transparent"
          />
          <kbd className="text-[10px] text-mute font-mono px-1.5 py-0.5 rounded border border-line">
            ESC
          </kbd>
        </div>
        <div className="max-h-[60vh] overflow-y-auto py-1.5">
          {filtered.length === 0 ? (
            <div className="text-center text-mute text-sm py-10">
              Sin resultados para “{q}”.
            </div>
          ) : (
            grouped.map(([group, cmds]) => (
              <div key={group}>
                <div className="text-[10px] uppercase tracking-wider text-mute font-semibold px-4 pt-3 pb-1.5">
                  {group}
                </div>
                {cmds.map((c) => {
                  runningIndex += 1;
                  const isActive = runningIndex === active;
                  return (
                    <button
                      key={c.id}
                      onMouseEnter={() => setActive(runningIndex)}
                      onClick={() => run(c)}
                      className={`w-full flex items-center gap-3 px-4 py-2 text-left text-sm ${
                        isActive ? 'bg-brand-soft text-brand-700' : 'text-ink'
                      }`}
                    >
                      {c.icon && (
                        <Icon
                          name={c.icon}
                          size={16}
                          className={isActive ? 'text-brand' : 'text-mute'}
                        />
                      )}
                      <span className="flex-1">{c.label}</span>
                      {isActive && (
                        <kbd className="text-[10px] font-mono text-brand">↵</kbd>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
        <div className="border-t border-line2 px-4 py-2 text-[11px] text-mute flex items-center justify-between">
          <span>
            <kbd className="font-mono px-1 rounded bg-bg2">↑↓</kbd>{' '}
            navegar ·{' '}
            <kbd className="font-mono px-1 rounded bg-bg2">↵</kbd> ejecutar
          </span>
          <span>
            {searching
              ? 'Buscando clientes…'
              : `${filtered.length} resultado${filtered.length === 1 ? '' : 's'}`}
          </span>
        </div>
      </div>
    </div>
  );
}

/** Pequeño chip "⌘K" que abre la paleta al hacer click. Para el topbar. */
export function CommandHint() {
  const [isMac, setIsMac] = useState(true);
  useEffect(() => {
    setIsMac(/Mac/.test(navigator.platform));
  }, []);
  return (
    <button
      type="button"
      onClick={() => {
        // Simulamos el shortcut para no acoplar refs
        const ev = new KeyboardEvent('keydown', {
          key: 'k',
          metaKey: isMac,
          ctrlKey: !isMac,
          bubbles: true,
        });
        window.dispatchEvent(ev);
      }}
      className="hidden sm:inline-flex items-center gap-2 text-xs text-mute hover:text-ink border border-line rounded-full px-3 py-1.5 hover:bg-bg2 transition"
      title="Buscar (Ctrl+K / ⌘K)"
    >
      <Icon name="search" size={14} />
      <span>Buscar</span>
      <kbd className="font-mono text-[10px] bg-bg2 rounded px-1 py-0.5 border border-line">
        {isMac ? '⌘K' : 'Ctrl K'}
      </kbd>
    </button>
  );
}
