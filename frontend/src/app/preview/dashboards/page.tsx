/* eslint-disable @next/next/no-img-element */
// 10 mockups nuevos de dashboard. Verde Clubify (#22C55E + #15803D)
// como accent, sidebar oscuro. Inspiración: estilos Nudo Admin (con
// alerts + cards mega + charts) y Grow Business (lista densa con cards
// de cuentas + account switcher).

const PRIMARY = '#22C55E';
const PRIMARY_DARK = '#15803D';

const M = {
  pedidosHoy: 12,
  ingresosHoy: 145300,
  ingresosAyer: 1293750,
  ticket: 48125,
  ingresos30d: 1250000,
  clientes: 87,
  recurrentes: 23,
  tarjetas: 65,
  pasesWallet: 41,
  sellos30d: 156,
  calif: 4.8,
  empleados: 6,
  nominaPend: 680000,
  propinasPend: 568359,
};
const fmt = (n: number) =>
  '$ ' + n.toLocaleString('es-CO', { maximumFractionDigits: 0 });

// =============================================================
//                   Sidebars (variantes)
// =============================================================

function SidebarDark({ active = 'Dashboard' }: { active?: string }) {
  const items = [
    'Dashboard',
    'Tarjetas',
    'Clientes',
    'Push',
    'Reseñas',
    'Menú',
    'Pedidos',
  ];
  return (
    <aside className="bg-[#0F1B26] text-white w-[180px] flex-none p-3 flex flex-col gap-1 text-[11px]">
      <div className="flex items-center gap-2 mb-3 px-1.5 pt-1">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-[13px] font-bold"
          style={{ background: PRIMARY }}
        >
          C
        </div>
        <div className="font-bold leading-tight text-[12px]">
          Mi Negocio
          <div className="text-[9px] opacity-60 font-normal">Panel</div>
        </div>
      </div>
      {items.map((label) => (
        <div
          key={label}
          className={`flex items-center gap-2 px-2 py-1.5 rounded-md ${
            label === active ? 'shadow' : 'opacity-70'
          }`}
          style={label === active ? { background: PRIMARY } : undefined}
        >
          <span className="w-3 h-3 rounded-sm bg-white/20" />
          <span>{label}</span>
        </div>
      ))}
    </aside>
  );
}

function SidebarSlate({ active = 'Dashboard' }: { active?: string }) {
  const items = [
    { l: 'Dashboard', s: 'PRINCIPAL' },
    { l: 'Equipo de trabajo', s: '' },
    { l: 'Horarios', s: '' },
    { l: 'Nómina', s: 'GESTIÓN' },
    { l: 'Propinas', s: '' },
    { l: 'Finanzas', s: '' },
    { l: 'Pedidos', s: '' },
  ];
  return (
    <aside className="bg-[#0F172A] text-white w-[170px] flex-none p-2.5 flex flex-col gap-0.5 text-[11px]">
      <div className="flex items-center gap-2 mb-3 px-1.5 pt-1.5">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-[12px] font-bold"
          style={{ background: PRIMARY }}
        >
          M
        </div>
        <div className="font-bold leading-tight text-[12px]">
          Mi Negocio
          <div className="text-[8px] opacity-60 font-normal">Panel de Control</div>
        </div>
      </div>
      {items.map((it) => (
        <div key={it.l}>
          {it.s && (
            <div className="text-[8px] uppercase tracking-widest text-white/40 mt-2 mb-0.5 px-1.5">
              {it.s}
            </div>
          )}
          <div
            className={`flex items-center gap-1.5 px-1.5 py-1.5 rounded-md ${
              it.l === active ? 'shadow font-semibold' : 'opacity-70'
            }`}
            style={it.l === active ? { background: PRIMARY } : undefined}
          >
            <span className="w-3 h-3 rounded-sm bg-white/20" />
            <span>{it.l}</span>
          </div>
        </div>
      ))}
    </aside>
  );
}

function SidebarGB({ active = 'Subcuentas' }: { active?: string }) {
  const items = [
    'Tablero',
    'AI Usage',
    'Subcuentas',
    'Reventa',
    'Plantillas',
    'Socios',
    'Configuración',
  ];
  return (
    <aside className="bg-[#0F1B2D] text-white w-[170px] flex-none p-2.5 flex flex-col gap-0.5 text-[11px]">
      <div className="px-1.5 pt-1.5 pb-3">
        <div className="font-black text-[14px] leading-none tracking-tight">
          MI<span style={{ color: PRIMARY }}>NEGOCIO</span>
        </div>
        <div className="text-[8px] opacity-60 mt-0.5">Panel multi-cuenta</div>
      </div>
      <div className="bg-white/[0.06] rounded-lg p-1.5 mb-2 flex items-center gap-1.5">
        <div
          className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white"
          style={{ background: PRIMARY }}
        >
          ⇄
        </div>
        <div className="flex-1 text-[10px] leading-tight">
          <div className="font-semibold">Cambiar de cuenta</div>
          <div className="opacity-60 text-[8px]">Click para escoger</div>
        </div>
        <span className="opacity-50">▾</span>
      </div>
      {items.map((label) => (
        <div
          key={label}
          className={`flex items-center gap-1.5 px-1.5 py-1.5 rounded-md ${
            label === active ? 'shadow font-semibold' : 'opacity-70'
          }`}
          style={label === active ? { background: PRIMARY } : undefined}
        >
          <span className="w-3 h-3 rounded-sm bg-white/20" />
          <span>{label}</span>
        </div>
      ))}
    </aside>
  );
}

// =============================================================
//          Frame wrapper
// =============================================================

function Frame({
  num,
  title,
  best,
  pros,
  children,
}: {
  num: number;
  title: string;
  best: string;
  pros: string[];
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <div className="mb-3">
        <div className="flex items-center gap-2 mb-1">
          <span
            className="w-7 h-7 rounded-full text-white font-bold text-sm flex items-center justify-center"
            style={{ background: PRIMARY }}
          >
            {num}
          </span>
          <span className="text-lg font-bold text-ink">{title}</span>
        </div>
        <div className="text-xs text-mute pl-9">
          <strong className="text-ink">Mejor para:</strong> {best}
        </div>
      </div>
      <div className="rounded-2xl overflow-hidden shadow-2xl border border-line bg-white">
        <div className="flex h-[480px]">{children}</div>
      </div>
      <ul className="mt-3 text-[11px] text-mute space-y-0.5 pl-1">
        {pros.map((p) => (
          <li key={p}>✓ {p}</li>
        ))}
      </ul>
    </div>
  );
}

// =============================================================
//   1. NUDO ADMIN STYLE (réplica del screenshot del cliente)
// =============================================================

function DashNudo() {
  return (
    <div className="flex flex-1 bg-white overflow-hidden">
      <SidebarSlate />
      <div className="flex-1 p-4 overflow-y-auto scrollbar-none">
        <div className="flex items-baseline gap-2 mb-3">
          <h1 className="text-lg font-bold">Dashboard</h1>
          <span className="text-[11px] text-mute">/ miércoles 6 may</span>
        </div>
        {/* Banner alerta */}
        <div className="bg-[#FEF3C7] border border-[#FDE68A] rounded-xl px-3 py-2 mb-3 flex items-center gap-2 text-[11px]">
          <span>⚠</span>
          <span className="text-amber-900">
            <b>1 empleado con nómina pendiente</b> este período.{' '}
            <span className="underline">Ir a nómina</span>
          </span>
        </div>
        {/* Card ventas con secciones lado a lado */}
        <div className="rounded-2xl border border-line2 p-4 mb-3">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[12px]" style={{ color: PRIMARY }}>
              📈
            </span>
            <span className="font-semibold text-[13px]">Ventas hoy</span>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-[8px] tracking-wider text-mute font-semibold">
                HOY · 7 MAY
              </div>
              <div className="grid grid-cols-2 gap-3 mt-1">
                <div>
                  <div
                    className="text-[8px] font-bold tracking-wider"
                    style={{ color: PRIMARY_DARK }}
                  >
                    CERRADAS
                  </div>
                  <div className="text-xl font-black">{fmt(0)}</div>
                  <div className="text-[8px] text-mute">📦 0 tickets</div>
                </div>
                <div>
                  <div
                    className="text-[8px] font-bold tracking-wider"
                    style={{ color: PRIMARY_DARK }}
                  >
                    ABIERTAS
                  </div>
                  <div className="text-xl font-black">{fmt(0)}</div>
                  <div className="text-[8px] text-mute">📦 0 tickets</div>
                </div>
              </div>
              <div className="mt-2 pt-2 border-t border-line2 flex justify-between text-[10px]">
                <span className="text-mute">TOTAL DÍA</span>
                <span className="font-bold">{fmt(0)}</span>
              </div>
            </div>
            <div className="border-l border-line2 pl-4">
              <div className="text-[8px] tracking-wider text-mute font-semibold">
                AYER · 6 MAY
              </div>
              <div className="grid grid-cols-2 gap-3 mt-1">
                <div>
                  <div
                    className="text-[8px] font-bold tracking-wider"
                    style={{ color: PRIMARY_DARK }}
                  >
                    CERRADAS
                  </div>
                  <div className="text-xl font-black">{fmt(M.ingresosAyer)}</div>
                  <div className="text-[8px] text-mute">📦 30 tickets</div>
                </div>
                <div>
                  <div
                    className="text-[8px] font-bold tracking-wider"
                    style={{ color: PRIMARY_DARK }}
                  >
                    ABIERTAS
                  </div>
                  <div className="text-xl font-black">{fmt(0)}</div>
                  <div className="text-[8px] text-mute">📦 0 tickets</div>
                </div>
              </div>
              <div className="mt-2 pt-2 border-t border-line2 flex justify-between text-[10px]">
                <span className="text-mute">TOTAL DÍA</span>
                <span className="font-bold">{fmt(M.ingresosAyer)}</span>
              </div>
            </div>
          </div>
        </div>
        {/* 3 KPI cards horizontales */}
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl border border-line2 p-2.5">
            <div className="text-[8px] uppercase text-mute font-semibold flex justify-between">
              EMPLEADOS ACTIVOS <span>👥</span>
            </div>
            <div className="text-2xl font-black mt-0.5">
              {M.empleados}<span className="text-mute text-base"> / {M.empleados}</span>
            </div>
            <div className="text-[9px] text-mute">0 inactivos</div>
          </div>
          <div
            className="rounded-xl border-2 p-2.5"
            style={{ borderColor: '#FCA5A5' }}
          >
            <div className="text-[8px] uppercase text-mute font-semibold flex justify-between">
              NÓMINA PENDIENTE <span>💵</span>
            </div>
            <div className="text-2xl font-black mt-0.5 text-red-600">
              {fmt(M.nominaPend)}
            </div>
            <div className="text-[9px] text-mute">1 sin pagar</div>
          </div>
          <div className="rounded-xl border border-line2 p-2.5">
            <div className="text-[8px] uppercase text-mute font-semibold flex justify-between">
              PROPINAS PEND. <span style={{ color: PRIMARY }}>$</span>
            </div>
            <div className="text-2xl font-black mt-0.5">{fmt(M.propinasPend)}</div>
            <div className="text-[9px] text-mute">1 sin entregar</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// =============================================================
//   2. GROW BUSINESS / GHL STYLE (lista densa con account switcher)
// =============================================================

function DashGrowBusiness() {
  const accounts = [
    { name: 'Café del Día', city: 'Bogotá', plan: 'Elite', status: 'ok', last: '27 mar' },
    { name: 'Pizzería Roma', city: 'Medellín', plan: 'Elite', status: 'ok', last: '7 ene' },
    { name: 'Barbería Central', city: 'Cali', plan: 'Elite', status: 'warn', last: 'hoy' },
    { name: 'Autolavado Express', city: 'Bogotá', plan: 'Elite', status: 'ok', last: 'ayer' },
  ];
  return (
    <div className="flex flex-1 bg-[#FAFBFC] overflow-hidden">
      <SidebarGB />
      <div className="flex-1 p-3 overflow-y-auto scrollbar-none">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-base font-bold">Subcuentas</h1>
          <button
            className="text-[10px] font-semibold text-white px-3 py-1.5 rounded-md"
            style={{ background: PRIMARY }}
          >
            + Crear Subcuenta
          </button>
        </div>
        <div className="rounded-md border border-line2 bg-white px-2.5 py-1.5 mb-2 flex items-center gap-2 text-[10px]">
          <span className="text-mute">🔍</span>
          <input
            placeholder="Buscar por subcuenta…"
            className="bg-transparent outline-none flex-1"
            disabled
          />
          <span className="text-mute">⚙</span>
        </div>
        <div className="space-y-1.5">
          {accounts.map((a) => (
            <div
              key={a.name}
              className="bg-white rounded-lg border border-line2 px-3 py-2 flex items-center gap-3"
            >
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[11px] font-bold flex-none"
                style={{ background: PRIMARY }}
              >
                {a.name[0]}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-[12px]">{a.name}</span>
                  <span
                    className="text-[8px] px-1.5 py-0.5 rounded-full font-semibold"
                    style={{
                      background: a.status === 'ok' ? '#DCFCE7' : '#FEF3C7',
                      color: a.status === 'ok' ? PRIMARY_DARK : '#92400E',
                    }}
                  >
                    {a.status === 'ok' ? 'Activo' : 'Atención'}
                  </span>
                </div>
                <div className="text-[10px] text-mute">
                  {a.city} · {a.plan}
                </div>
              </div>
              <div className="text-right text-[10px]">
                <div className="text-mute">Último login</div>
                <div className="font-medium">{a.last}</div>
              </div>
              <button
                className="text-[10px] font-semibold flex items-center gap-1 ml-1"
                style={{ color: PRIMARY }}
              >
                ⇄ Entrar
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// =============================================================
//   3. PUNTO DE OPERACIÓN (centro de control en vivo)
// =============================================================

function DashOpsCenter() {
  return (
    <div className="flex flex-1 bg-[#0A0F1A] text-white overflow-hidden">
      <SidebarDark />
      <div className="flex-1 p-4 overflow-y-auto scrollbar-none">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-lg font-bold">Centro de operación</h1>
            <div className="text-[10px] text-white/50">Actualizado en tiempo real</div>
          </div>
          <div className="flex items-center gap-2">
            <span
              className="w-2 h-2 rounded-full"
              style={{ background: PRIMARY, boxShadow: `0 0 12px ${PRIMARY}` }}
            />
            <span className="text-[10px] uppercase tracking-wider">Live</span>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-2 mb-3">
          {[
            ['Pedidos abiertos', '4', 'En cocina ahora'],
            ['Esperando', '2', 'Más de 15 min'],
            ['Listos', '1', 'Por entregar'],
            ['Promedio prep.', '12 min', '↓ 3 min'],
          ].map(([l, v, s]) => (
            <div
              key={l}
              className="rounded-xl border border-white/10 bg-white/[0.04] p-2.5"
            >
              <div className="text-[8px] uppercase tracking-wider text-white/50">{l}</div>
              <div className="text-xl font-black mt-0.5" style={{ color: PRIMARY }}>
                {v}
              </div>
              <div className="text-[9px] text-white/50 mt-0.5">{s}</div>
            </div>
          ))}
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
          <div className="text-[9px] uppercase tracking-wider text-white/50 mb-2 flex justify-between">
            <span>Stream de actividad</span>
            <span>14:32:18</span>
          </div>
          {[
            { e: '🛒', t: 'Pedido #A8K2 confirmado', m: 'Mesa 5 · 3 productos · ' + fmt(48000), tag: 'PEDIDO' },
            { e: '⭐', t: '+1 sello a Javier', m: '8/10 sellos · próxima recompensa: 1 café gratis', tag: 'SELLO' },
            { e: '🤝', t: 'Cliente nuevo · Maru', m: 'Llegó por QR de mesa 3', tag: 'CLIENTE' },
            { e: '💚', t: 'Reseña 5★ de Carlos', m: '"Excelente atención y café"', tag: 'REVIEW' },
          ].map((a, i) => (
            <div
              key={i}
              className="flex items-start gap-2.5 py-1.5 border-b border-white/5 last:border-0 text-[11px]"
            >
              <div className="text-base flex-none">{a.e}</div>
              <div className="flex-1 min-w-0">
                <div className="font-medium leading-tight">{a.t}</div>
                <div className="text-[10px] text-white/50 mt-0.5">{a.m}</div>
              </div>
              <span
                className="text-[8px] px-1.5 py-0.5 rounded font-bold tracking-wider"
                style={{
                  background: PRIMARY + '30',
                  color: PRIMARY,
                }}
              >
                {a.tag}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// =============================================================
//   4. CARD WALL (mosaico estilo Pinterest)
// =============================================================

function DashCardWall() {
  return (
    <div className="flex flex-1 bg-[#FAFBFC] overflow-hidden">
      <SidebarDark />
      <div className="flex-1 p-3 overflow-y-auto scrollbar-none columns-3 gap-2 [column-fill:_balance]">
        <div
          className="break-inside-avoid mb-2 rounded-2xl p-3 text-white"
          style={{ background: `linear-gradient(135deg, ${PRIMARY}, ${PRIMARY_DARK})` }}
        >
          <div className="text-[9px] opacity-80 uppercase tracking-wider">
            Ingresos del mes
          </div>
          <div className="text-2xl font-black mt-1">{fmt(M.ingresos30d)}</div>
          <div className="text-[10px] opacity-80 mt-0.5">↑ 12% vs anterior</div>
        </div>
        <div className="break-inside-avoid mb-2 rounded-2xl bg-white p-3 border border-line2">
          <div className="text-[9px] uppercase tracking-wider text-mute font-semibold">
            Pedidos hoy
          </div>
          <div className="text-3xl font-black mt-1">{M.pedidosHoy}</div>
        </div>
        <div className="break-inside-avoid mb-2 rounded-2xl bg-[#0F1B26] text-white p-3">
          <div className="text-[9px] opacity-70 uppercase tracking-wider">
            Calificación
          </div>
          <div className="text-3xl font-black mt-1" style={{ color: PRIMARY }}>
            {M.calif} ★
          </div>
          <div className="text-[10px] opacity-70 mt-0.5">5 reseñas</div>
        </div>
        <div className="break-inside-avoid mb-2 rounded-2xl bg-white p-3 border border-line2">
          <div className="text-[9px] uppercase tracking-wider text-mute font-semibold mb-2">
            Top productos
          </div>
          {['Café americano', 'Cappuccino', 'Brownie'].map((p, i) => (
            <div key={p} className="flex justify-between text-[11px] py-0.5">
              <span>{i + 1}. {p}</span>
              <span className="text-mute">{12 - i * 4}</span>
            </div>
          ))}
        </div>
        <div className="break-inside-avoid mb-2 rounded-2xl bg-white p-3 border border-line2">
          <div className="text-[9px] uppercase tracking-wider text-mute font-semibold">
            Clientes
          </div>
          <div className="text-2xl font-black mt-1">{M.clientes}</div>
          <div className="text-[9px] text-mute mt-0.5">+4 este mes</div>
        </div>
        <div className="break-inside-avoid mb-2 rounded-2xl bg-white p-3 border border-line2">
          <div className="text-[9px] uppercase tracking-wider text-mute font-semibold">
            Tarjetas wallet
          </div>
          <div className="flex items-baseline gap-1.5 mt-1">
            <div className="text-2xl font-black">{M.pasesWallet}</div>
            <div className="text-[10px] text-mute">/ {M.tarjetas}</div>
          </div>
          <div className="text-[9px] text-mute mt-0.5">en uso real</div>
        </div>
        <div
          className="break-inside-avoid mb-2 rounded-2xl p-3 text-white"
          style={{ background: '#1E293B' }}
        >
          <div className="text-[9px] uppercase tracking-wider opacity-80">
            Último pedido
          </div>
          <div className="font-bold mt-1 text-sm">#A8K2 · Javier</div>
          <div className="text-[10px] opacity-70 mt-0.5">
            Hace 2 min · {fmt(48000)}
          </div>
        </div>
      </div>
    </div>
  );
}

// =============================================================
//   5. SPLIT 60/40 (ingresos hero + actividad lateral)
// =============================================================

function DashSplit() {
  return (
    <div className="flex flex-1 bg-white overflow-hidden">
      <SidebarDark />
      <div className="flex-1 flex">
        <div className="flex-[3] p-5 border-r border-line2">
          <div className="text-[10px] uppercase tracking-widest text-mute font-bold">
            Ingresos del mes
          </div>
          <div className="text-5xl font-black mt-1" style={{ color: PRIMARY }}>
            {fmt(M.ingresos30d)}
          </div>
          <div className="text-xs text-mute mt-1">↑ 12% vs mes anterior</div>
          <svg viewBox="0 0 300 60" className="w-full h-20 mt-4">
            <defs>
              <linearGradient id="splitG" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={PRIMARY} stopOpacity="0.4" />
                <stop offset="100%" stopColor={PRIMARY} stopOpacity="0" />
              </linearGradient>
            </defs>
            <polyline
              points="0,45 25,40 50,42 75,35 100,30 125,32 150,25 175,18 200,22 225,15 250,10 275,8 300,5"
              fill="none"
              stroke={PRIMARY}
              strokeWidth="2"
            />
            <polygon
              points="0,45 25,40 50,42 75,35 100,30 125,32 150,25 175,18 200,22 225,15 250,10 275,8 300,5 300,60 0,60"
              fill="url(#splitG)"
            />
          </svg>
          <div className="grid grid-cols-3 gap-3 mt-5 pt-5 border-t border-line2">
            <div>
              <div className="text-[9px] uppercase text-mute font-semibold">Pedidos</div>
              <div className="text-xl font-bold">{M.pedidosHoy}</div>
              <div className="text-[9px] text-mute">hoy</div>
            </div>
            <div>
              <div className="text-[9px] uppercase text-mute font-semibold">Ticket</div>
              <div className="text-xl font-bold">{fmt(M.ticket)}</div>
              <div className="text-[9px] text-mute">promedio</div>
            </div>
            <div>
              <div className="text-[9px] uppercase text-mute font-semibold">Clientes</div>
              <div className="text-xl font-bold">{M.clientes}</div>
              <div className="text-[9px] text-mute">+4 este mes</div>
            </div>
          </div>
        </div>
        <aside className="flex-[2] p-3 bg-[#FAFBFC]">
          <div className="text-[9px] uppercase tracking-widest text-mute font-bold mb-2">
            Actividad reciente
          </div>
          <div className="space-y-1.5">
            {[
              { t: 'Pedido #A8K2', s: 'hace 2m', amt: '$48k' },
              { t: '+1 sello · Javier', s: 'hace 8m', amt: '8/10' },
              { t: 'Cliente nuevo Maru', s: 'hace 15m', amt: '🤝' },
              { t: 'Reseña 5★', s: 'hace 1h', amt: '⭐' },
              { t: 'Push enviado', s: 'hace 2h', amt: '32' },
            ].map((a) => (
              <div
                key={a.t}
                className="bg-white rounded-lg border border-line2 px-2.5 py-2 flex items-center gap-2 text-[11px]"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium">{a.t}</div>
                  <div className="text-[9px] text-mute">{a.s}</div>
                </div>
                <div className="text-[11px] font-bold" style={{ color: PRIMARY }}>
                  {a.amt}
                </div>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}

// =============================================================
//   6. KANBAN BOARD (pedidos como columnas Trello)
// =============================================================

function DashKanban() {
  const cols = [
    {
      name: 'Nuevos',
      tone: '#F59E0B',
      cards: [
        { code: 'A9K8', cust: 'Maru P.', items: '2 prod · ' + fmt(32000) },
        { code: 'A9K7', cust: 'Diego R.', items: '1 prod · ' + fmt(15000) },
      ],
    },
    {
      name: 'En cocina',
      tone: '#3B82F6',
      cards: [
        { code: 'A9K5', cust: 'Lucía A.', items: '4 prod · ' + fmt(72000) },
      ],
    },
    {
      name: 'Listos',
      tone: PRIMARY,
      cards: [
        { code: 'A9K3', cust: 'Carlos M.', items: '2 prod · ' + fmt(48000) },
      ],
    },
    {
      name: 'Entregados',
      tone: '#94A3B8',
      cards: [
        { code: 'A9K1', cust: 'Ana T.', items: '1 prod · ' + fmt(18000) },
      ],
    },
  ];
  return (
    <div className="flex flex-1 bg-[#F4F5F7] overflow-hidden">
      <SidebarDark active="Pedidos" />
      <div className="flex-1 p-3 overflow-y-auto scrollbar-none">
        <div className="flex items-baseline justify-between mb-2">
          <div>
            <h1 className="text-base font-bold">Pedidos en vivo</h1>
            <div className="text-[10px] text-mute">5 en curso · {fmt(M.ingresos30d)} este mes</div>
          </div>
          <button
            className="text-[10px] font-semibold text-white px-2.5 py-1 rounded-md"
            style={{ background: PRIMARY }}
          >
            + Nuevo
          </button>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {cols.map((c) => (
            <div
              key={c.name}
              className="bg-white rounded-xl p-2 border border-line2"
            >
              <div className="flex items-center justify-between mb-2 px-1">
                <div className="flex items-center gap-1.5">
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ background: c.tone }}
                  />
                  <span className="text-[10px] font-bold uppercase tracking-wider">
                    {c.name}
                  </span>
                </div>
                <span className="text-[9px] text-mute">{c.cards.length}</span>
              </div>
              <div className="space-y-1.5">
                {c.cards.map((card) => (
                  <div
                    key={card.code}
                    className="bg-[#FAFBFC] rounded-md px-2 py-1.5 border border-line2"
                  >
                    <div className="text-[9px] text-mute">#{card.code}</div>
                    <div className="text-[11px] font-semibold leading-tight">
                      {card.cust}
                    </div>
                    <div className="text-[9px] text-mute mt-0.5">{card.items}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2 mt-3">
          {[
            ['Tiempo prep. promedio', '12 min'],
            ['Pedidos hoy', M.pedidosHoy + ''],
            ['Ingresos hoy', fmt(M.ingresosHoy)],
          ].map(([l, v]) => (
            <div
              key={l}
              className="bg-white rounded-xl border border-line2 p-2.5"
            >
              <div className="text-[9px] uppercase text-mute font-semibold">
                {l}
              </div>
              <div className="text-base font-bold mt-0.5" style={{ color: PRIMARY }}>
                {v}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// =============================================================
//   7. CALENDARIO HERO (calendario grande con eventos)
// =============================================================

function DashCalendar() {
  const days = Array.from({ length: 35 }, (_, i) => i - 4); // -4..30
  const eventDays = new Set([2, 5, 7, 12, 18, 20, 22, 25, 28]);
  const today = 6;
  return (
    <div className="flex flex-1 bg-white overflow-hidden">
      <SidebarDark />
      <div className="flex-1 flex">
        <div className="flex-1 p-3">
          <div className="flex items-baseline justify-between mb-2">
            <h2 className="text-base font-bold">Mayo 2026</h2>
            <div className="flex gap-1">
              <button className="px-2 py-0.5 rounded text-[10px] border border-line">
                ‹
              </button>
              <button className="px-2 py-0.5 rounded text-[10px] border border-line">
                ›
              </button>
            </div>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-[9px] text-mute uppercase tracking-wider mb-1 px-0.5">
            {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((d) => (
              <div key={d} className="text-center">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {days.map((d) => {
              const isToday = d === today;
              const isCurMonth = d >= 1 && d <= 31;
              const hasEvent = eventDays.has(d);
              return (
                <div
                  key={d}
                  className={`aspect-square rounded-md flex flex-col items-center justify-start p-1 text-[10px] relative ${
                    isToday
                      ? 'text-white font-bold'
                      : isCurMonth
                      ? 'border border-line2'
                      : 'text-mute opacity-40'
                  }`}
                  style={isToday ? { background: PRIMARY } : undefined}
                >
                  <span>{d > 0 && d <= 31 ? d : d <= 0 ? 30 + d : d - 31}</span>
                  {hasEvent && !isToday && (
                    <span
                      className="w-1 h-1 rounded-full mt-0.5"
                      style={{ background: PRIMARY }}
                    />
                  )}
                  {isToday && (
                    <span className="text-[7px] mt-0.5">3 evt</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <aside className="w-[200px] p-3 bg-[#FAFBFC] border-l border-line2">
          <div className="text-[9px] uppercase tracking-widest text-mute font-bold mb-2">
            Hoy · 6 may
          </div>
          {[
            { h: '09:00', t: 'Apertura local', e: '☀' },
            { h: '12:30', t: 'Push de almuerzo', e: '🔔' },
            { h: '18:00', t: 'Cumpleaños · Javier', e: '🎂' },
          ].map((ev) => (
            <div key={ev.h} className="flex gap-2 py-2 border-b border-line2 last:border-0">
              <div className="text-[10px] text-mute font-mono w-10">{ev.h}</div>
              <div className="flex-1">
                <div className="text-[11px] font-medium leading-tight">
                  {ev.e} {ev.t}
                </div>
              </div>
            </div>
          ))}
          <div
            className="mt-3 rounded-lg p-2.5 text-white"
            style={{ background: PRIMARY }}
          >
            <div className="text-[8px] uppercase tracking-wider opacity-80">
              Hoy
            </div>
            <div className="text-base font-black">{fmt(M.ingresosHoy)}</div>
            <div className="text-[9px] opacity-80">{M.pedidosHoy} pedidos</div>
          </div>
        </aside>
      </div>
    </div>
  );
}

// =============================================================
//   8. NEWSPAPER (tipo periódico con headlines + columnas)
// =============================================================

function DashNewspaper() {
  return (
    <div className="flex flex-1 bg-[#FFFEF8] text-[#1A1410] overflow-hidden">
      <SidebarDark />
      <div className="flex-1 p-5 overflow-y-auto scrollbar-none font-serif">
        <div className="border-b-2 border-[#1A1410] pb-2 mb-3 text-center">
          <div className="text-[9px] uppercase tracking-[0.3em]">Mi Negocio Daily</div>
          <h1 className="text-2xl font-black tracking-tight mt-1">
            Edición del 6 de mayo · Mié
          </h1>
          <div className="text-[10px] mt-1 italic">
            "Otro día contando historias que se sirven en taza"
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3 text-[11px] leading-snug">
          <div>
            <div
              className="text-[8px] font-bold uppercase tracking-wider mb-1 pb-0.5 border-b"
              style={{ color: PRIMARY_DARK, borderColor: PRIMARY_DARK }}
            >
              Portada
            </div>
            <h2 className="text-base font-black leading-tight mb-1">
              Récord mensual: {fmt(M.ingresos30d)}
            </h2>
            <p className="text-justify">
              El negocio cerró el mes con un alza del 12% frente al período
              anterior, impulsado por el incremento de pedidos por delivery
              y el ticket promedio en horario de almuerzo.
            </p>
          </div>
          <div>
            <div
              className="text-[8px] font-bold uppercase tracking-wider mb-1 pb-0.5 border-b border-mute"
            >
              Operaciones
            </div>
            <div className="space-y-2">
              <div>
                <div className="font-bold text-xs">{M.pedidosHoy} pedidos hoy</div>
                <div>Ticket promedio: {fmt(M.ticket)}</div>
              </div>
              <div>
                <div className="font-bold text-xs">{M.empleados} empleados activos</div>
                <div>Sin inactivos esta jornada</div>
              </div>
              <div>
                <div className="font-bold text-xs">Top: Café americano</div>
                <div>12 unidades despachadas</div>
              </div>
            </div>
          </div>
          <div>
            <div
              className="text-[8px] font-bold uppercase tracking-wider mb-1 pb-0.5 border-b border-mute"
            >
              Lo más comentado
            </div>
            <div
              className="rounded p-2 mb-2"
              style={{ background: PRIMARY + '15' }}
            >
              <div className="text-[20px] font-black" style={{ color: PRIMARY_DARK }}>
                {M.calif}★
              </div>
              <div className="text-[10px]">5 reseñas en 30 días</div>
            </div>
            <p>
              Carlos dejó una reseña 5★ destacando la atención y el café. Maru se
              registró como cliente nueva por el QR de mesa.
            </p>
          </div>
        </div>
        <div
          className="mt-3 text-center text-[8px] uppercase tracking-[0.2em] py-1 border-t border-mute"
        >
          Lectura cortesía Mi Negocio · Powered by Clubify
        </div>
      </div>
    </div>
  );
}

// =============================================================
//   9. POS-STYLE (orientado a operación de mostrador)
// =============================================================

function DashPos() {
  return (
    <div className="flex flex-1 bg-[#0F1B26] text-white overflow-hidden">
      <SidebarDark />
      <div className="flex-1 p-3 grid grid-cols-3 gap-2">
        <div
          className="col-span-2 rounded-xl p-3"
          style={{ background: 'linear-gradient(180deg, #18293B 0%, #0F1B26 100%)' }}
        >
          <div className="flex items-baseline justify-between mb-3">
            <div>
              <div className="text-[8px] uppercase tracking-wider opacity-50">CAJA HOY</div>
              <div className="text-3xl font-black mt-0.5" style={{ color: PRIMARY }}>
                {fmt(M.ingresosHoy)}
              </div>
            </div>
            <div className="flex gap-1">
              <button
                className="text-[10px] font-bold px-2 py-1 rounded-md"
                style={{ background: PRIMARY, color: '#0F1B26' }}
              >
                + Cobrar
              </button>
              <button className="text-[10px] font-semibold px-2 py-1 rounded-md border border-white/20">
                Cerrar caja
              </button>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 mb-3">
            {[
              ['Efectivo', fmt(85000)],
              ['Tarjeta', fmt(45300)],
              ['Transfer.', fmt(15000)],
            ].map(([l, v]) => (
              <div key={l} className="border border-white/10 rounded-md p-2">
                <div className="text-[8px] uppercase opacity-50">{l}</div>
                <div className="font-bold text-[13px]">{v}</div>
              </div>
            ))}
          </div>
          <div className="text-[9px] uppercase tracking-wider opacity-50 mb-1">
            Últimas ventas
          </div>
          {[
            ['#A8K2', 'Mesa 5', fmt(48000)],
            ['#A8K1', 'Para llevar', fmt(15000)],
            ['#A8K0', 'Mesa 2', fmt(32000)],
          ].map(([c, m, a]) => (
            <div
              key={c}
              className="flex items-center text-[11px] py-1 border-b border-white/5 last:border-0"
            >
              <span className="opacity-50 w-12">{c}</span>
              <span className="flex-1">{m}</span>
              <span className="font-bold" style={{ color: PRIMARY }}>{a}</span>
            </div>
          ))}
        </div>
        <div className="space-y-2">
          <div className="rounded-xl p-3 border border-white/10 bg-white/[0.03]">
            <div className="text-[8px] uppercase opacity-50">Pedidos abiertos</div>
            <div className="text-3xl font-black mt-1">4</div>
            <div className="text-[9px] opacity-50">2 por confirmar</div>
          </div>
          <div className="rounded-xl p-3 border border-white/10 bg-white/[0.03]">
            <div className="text-[8px] uppercase opacity-50">Ticket prom.</div>
            <div className="text-xl font-bold mt-1">{fmt(M.ticket)}</div>
          </div>
          <div className="rounded-xl p-3 border border-white/10 bg-white/[0.03]">
            <div className="text-[8px] uppercase opacity-50">Sellos hoy</div>
            <div className="flex items-baseline gap-1 mt-1">
              <span className="text-xl font-bold">8</span>
              <span className="text-[9px] opacity-50">/ {M.sellos30d}m</span>
            </div>
          </div>
          <div
            className="rounded-xl p-3"
            style={{ background: PRIMARY }}
          >
            <div className="text-[8px] uppercase opacity-90 text-[#0F1B26] font-bold">
              Calificación
            </div>
            <div className="text-xl font-black text-[#0F1B26] mt-0.5">
              {M.calif}★
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// =============================================================
//   10. MAGAZINE EDITORIAL (cover style con tipografía editorial)
// =============================================================

function DashMagazine() {
  return (
    <div className="flex flex-1 bg-[#FAFAF7] text-[#1A1A1A] overflow-hidden">
      <SidebarDark />
      <div className="flex-1 p-6 overflow-y-auto scrollbar-none">
        <div className="flex items-baseline justify-between mb-4 pb-2 border-b border-[#1A1A1A]/20">
          <div>
            <div className="text-[8px] uppercase tracking-[0.4em] font-semibold opacity-60">
              Volumen 5 · Mayo 2026
            </div>
            <h1 className="text-3xl font-black tracking-tight mt-0.5 leading-none">
              Tu negocio,<br />
              en una página.
            </h1>
          </div>
          <div className="text-right">
            <div className="text-[8px] uppercase tracking-widest opacity-60">Hoy</div>
            <div className="text-xs font-bold">Mié 6 · 14:32</div>
          </div>
        </div>
        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-7">
            <div className="text-[8px] uppercase tracking-widest font-semibold opacity-60 mb-1">
              Story principal
            </div>
            <div className="text-5xl font-black tracking-tight" style={{ color: PRIMARY_DARK }}>
              {fmt(M.ingresos30d)}
            </div>
            <p className="text-xs leading-relaxed mt-2 max-w-md">
              Cerraste el mes con un alza significativa. {M.pedidosHoy} pedidos
              hoy, ticket promedio de {fmt(M.ticket)}, y {M.clientes} clientes
              activos en tu programa de fidelización.
            </p>
            <svg viewBox="0 0 300 50" className="w-full mt-4">
              <polyline
                points="0,40 30,35 60,38 90,30 120,28 150,22 180,18 210,12 240,15 270,8 300,5"
                fill="none"
                stroke={PRIMARY}
                strokeWidth="1.5"
              />
            </svg>
          </div>
          <div className="col-span-5 space-y-3 border-l border-[#1A1A1A]/20 pl-4">
            <div>
              <div className="text-[8px] uppercase tracking-widest opacity-60">
                Calificación
              </div>
              <div className="text-2xl font-black flex items-baseline gap-1">
                {M.calif}<span className="text-amber-500 text-base">★★★★★</span>
              </div>
            </div>
            <div>
              <div className="text-[8px] uppercase tracking-widest opacity-60">
                Clientes
              </div>
              <div className="text-2xl font-black">{M.clientes}</div>
              <div className="text-[10px] opacity-60">+4 este mes</div>
            </div>
            <div>
              <div className="text-[8px] uppercase tracking-widest opacity-60">
                Pases wallet
              </div>
              <div className="text-2xl font-black">{M.pasesWallet}</div>
              <div className="text-[10px] opacity-60">de {M.tarjetas} emitidas</div>
            </div>
          </div>
        </div>
        <div className="mt-6 grid grid-cols-3 gap-4 text-[11px] pt-4 border-t border-[#1A1A1A]/20">
          <div>
            <div className="text-[8px] uppercase tracking-widest font-semibold opacity-60 mb-1">
              Top producto
            </div>
            <div className="font-bold">Café americano</div>
            <div className="opacity-60">12 unidades hoy</div>
          </div>
          <div>
            <div className="text-[8px] uppercase tracking-widest font-semibold opacity-60 mb-1">
              Cliente del día
            </div>
            <div className="font-bold">Javier — 8 sellos</div>
            <div className="opacity-60">2 más para recompensa</div>
          </div>
          <div>
            <div className="text-[8px] uppercase tracking-widest font-semibold opacity-60 mb-1">
              Próximo evento
            </div>
            <div className="font-bold">Cumple Lucía · 9 may</div>
            <div className="opacity-60">Programar push</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// =============================================================
//                          PAGE
// =============================================================

export default function DashboardsPreview() {
  return (
    <div className="min-h-screen bg-bg p-6 sm:p-10">
      <div className="max-w-[1400px] mx-auto">
        <h1 className="text-3xl font-bold text-center">
          Estilos de Dashboard · v2
        </h1>
        <p className="text-center text-sm text-mute mt-2">
          10 nuevos estilos. Verde Clubify. Sidebar oscuro. Cada uno con vibe distinta.
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 mt-10">
          <Frame
            num={1}
            title="Nudo Admin"
            best="Restaurantes con caja, nómina y propinas (réplica del estilo que mostraste)."
            pros={[
              'Banner de alerta arriba (deuda pendiente, etc)',
              'Card mega "Ventas hoy / ayer" con sub-secciones',
              '3 KPIs operativos abajo (empleados / nómina / propinas)',
            ]}
          >
            <DashNudo />
          </Frame>
          <Frame
            num={2}
            title="Grow Business"
            best="Multi-cuenta — el dueño ve todas sus subcuentas como en GHL."
            pros={[
              'Account switcher prominente arriba del sidebar',
              'Lista densa con avatar + estado + último login',
              'Botón "Crear Subcuenta" siempre visible',
            ]}
          >
            <DashGrowBusiness />
          </Frame>
          <Frame
            num={3}
            title="Centro de operación"
            best="Restaurantes en hora pico — todo en vivo, oscuro estilo OS de cocina."
            pros={[
              'Fondo oscuro con verde neón',
              'Indicador "Live" pulsante',
              'Stream de actividad con tags (PEDIDO, SELLO, CLIENTE…)',
            ]}
          >
            <DashOpsCenter />
          </Frame>
          <Frame
            num={4}
            title="Card Wall"
            best="Negocios visuales que valoran lo orgánico (Pinterest-vibe)."
            pros={[
              'Mosaico tipo Pinterest con cards de tamaños variados',
              'Mezcla de cards verdes, dark y blancas',
              'Lectura no-lineal — el ojo brinca a lo más importante',
            ]}
          >
            <DashCardWall />
          </Frame>
          <Frame
            num={5}
            title="Split 60/40"
            best="Operadores que necesitan el número grande + actividad lateral."
            pros={[
              'Hero ingresos con sparkline grande',
              'Sidebar derecho con feed de actividad',
              '3 KPIs secundarios al pie',
            ]}
          >
            <DashSplit />
          </Frame>
          <Frame
            num={6}
            title="Kanban Board"
            best="Restaurantes/comida rápida — visualizar pedidos como tareas."
            pros={[
              'Columnas Trello (Nuevos / En cocina / Listos / Entregados)',
              'Cards arrastrables (mockup)',
              'KPIs operativos abajo',
            ]}
          >
            <DashKanban />
          </Frame>
          <Frame
            num={7}
            title="Calendar Hero"
            best="Negocios con eventos/citas (barbería, peluquería, gym, spa)."
            pros={[
              'Calendario mensual grande con dots de eventos',
              'Sidebar con agenda del día',
              'Card del día con KPI verde',
            ]}
          >
            <DashCalendar />
          </Frame>
          <Frame
            num={8}
            title="Newspaper"
            best="Marcas con personalidad fuerte — se siente como una revista impresa."
            pros={[
              'Header tipo cabezal de periódico',
              '3 columnas con headlines y bajadas',
              'Tipografía serif elegante',
            ]}
          >
            <DashNewspaper />
          </Frame>
          <Frame
            num={9}
            title="POS-style"
            best="Operadores de mostrador (cafés, panaderías) que cobran y miran caja."
            pros={[
              'CAJA HOY como hero con desglose por método de pago',
              '"Cobrar" como acción primaria',
              'Pedidos abiertos/sellos como sidebar derecho',
            ]}
          >
            <DashPos />
          </Frame>
          <Frame
            num={10}
            title="Magazine Editorial"
            best="Marcas premium / boutique que quieren un dashboard que se vea pensado."
            pros={[
              'Cabezal tipo "Volumen 5 · Mayo" + subtítulo editorial',
              'Hero con número gigante en serif',
              'Story breakdown en 3 columnas con highlights',
            ]}
          >
            <DashMagazine />
          </Frame>
        </div>
      </div>
    </div>
  );
}
