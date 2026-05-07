/* eslint-disable @next/next/no-img-element */
// 10 mockups de dashboard manteniendo el verde Clubify (#22C55E + #15803D)
// y el sidebar oscuro. Cada uno explora una composición distinta — el cliente
// elige una y la aplicamos al panel real.

const PRIMARY = '#22C55E';
const PRIMARY_DARK = '#15803D';

// Datos mock compartidos
const M = {
  pedidosHoy: 12,
  ingresosHoy: 145300,
  ticket: 48125,
  ingresos30d: 1250000,
  clientes: 87,
  recurrentes: 23,
  tarjetas: 65,
  pasesWallet: 41,
  sellos30d: 156,
  calif: 4.8,
};
const fmt = (n: number) =>
  '$' + n.toLocaleString('es-CO', { maximumFractionDigits: 0 });

// =============================================================
//                   Sidebar shared (mini)
// =============================================================

function MiniSidebar({ active = 'Dashboard' }: { active?: string }) {
  const items = [
    { label: 'Dashboard', emoji: '⊞' },
    { label: 'Tarjetas', emoji: '💳' },
    { label: 'Clientes', emoji: '👥' },
    { label: 'Push', emoji: '🔔' },
    { label: 'Menú', emoji: '🍴' },
    { label: 'Pedidos', emoji: '🛒' },
    { label: 'Analítica', emoji: '📊' },
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
        <div className="font-bold leading-tight text-[13px]">
          Mi Negocio
          <div className="text-[9px] opacity-60 font-normal">Panel de Control</div>
        </div>
      </div>
      {items.map((i) => (
        <div
          key={i.label}
          className={`flex items-center gap-2 px-2 py-1.5 rounded-md ${
            i.label === active ? 'shadow' : 'opacity-70'
          }`}
          style={i.label === active ? { background: PRIMARY } : undefined}
        >
          <span>{i.emoji}</span>
          <span>{i.label}</span>
        </div>
      ))}
    </aside>
  );
}

// =============================================================
//          Frame wrapper para cada mockup numerado
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
//   1. CLUBIFY CLÁSICO (baseline · el actual)
// =============================================================

function DashClassic() {
  return (
    <div className="flex flex-1 bg-[#FAFBFC] overflow-hidden">
      <MiniSidebar />
      <div className="flex-1 p-4 overflow-y-auto scrollbar-none">
        <div className="text-lg font-bold mb-3">
          Dashboard{' '}
          <span className="text-mute text-xs font-normal">/ miércoles 6 may</span>
        </div>
        <div className="text-[10px] uppercase tracking-wider text-mute font-semibold mb-2">
          Hoy
        </div>
        <div className="grid grid-cols-4 gap-2 mb-4">
          {[
            { lbl: 'Pedidos hoy', v: M.pedidosHoy.toString(), c: PRIMARY },
            { lbl: 'Ingresos hoy', v: fmt(M.ingresosHoy), c: PRIMARY },
            { lbl: 'Ticket promedio', v: fmt(M.ticket), c: '#3B82F6' },
            { lbl: 'Ingresos 30d', v: fmt(M.ingresos30d), c: PRIMARY },
          ].map((k) => (
            <div key={k.lbl} className="bg-white rounded-xl border border-line2 p-3">
              <div className="text-[9px] uppercase tracking-wider text-mute font-semibold">
                {k.lbl}
              </div>
              <div className="text-base font-bold mt-1" style={{ color: k.c }}>
                {k.v}
              </div>
            </div>
          ))}
        </div>
        <div className="text-[10px] uppercase tracking-wider text-mute font-semibold mb-2">
          Clientes y fidelización
        </div>
        <div className="grid grid-cols-6 gap-2 mb-4">
          {[
            ['Clientes', M.clientes],
            ['Recurr.', M.recurrentes],
            ['Tarjetas', M.tarjetas],
            ['Pases', M.pasesWallet],
            ['Sellos 30d', M.sellos30d],
            ['Calif.', `${M.calif}★`],
          ].map(([l, v]) => (
            <div key={l as string} className="bg-white rounded-lg border border-line2 p-2">
              <div className="text-[8px] uppercase text-mute">{l}</div>
              <div className="text-sm font-bold" style={{ color: PRIMARY }}>
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
//   2. HERO CHART (gráfico grande arriba)
// =============================================================

function DashHeroChart() {
  return (
    <div className="flex flex-1 bg-[#FAFBFC] overflow-hidden">
      <MiniSidebar />
      <div className="flex-1 p-4 overflow-y-auto scrollbar-none">
        <div className="flex justify-between items-baseline mb-3">
          <div className="text-lg font-bold">Vista general</div>
          <div className="text-[10px] text-mute">Últimos 30 días</div>
        </div>
        <div
          className="rounded-2xl p-4 mb-3 text-white relative overflow-hidden"
          style={{
            background: `linear-gradient(135deg, ${PRIMARY}, ${PRIMARY_DARK})`,
          }}
        >
          <div className="text-[10px] opacity-80 uppercase tracking-wider">
            Ingresos del mes
          </div>
          <div className="text-3xl font-black mt-1">{fmt(M.ingresos30d)}</div>
          <div className="text-[10px] opacity-80 mt-0.5">
            +12.4% vs mes anterior
          </div>
          {/* SVG sparkline */}
          <svg viewBox="0 0 200 60" className="w-full h-12 mt-2">
            <defs>
              <linearGradient id="g1" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#fff" stopOpacity="0.4" />
                <stop offset="100%" stopColor="#fff" stopOpacity="0" />
              </linearGradient>
            </defs>
            <polyline
              points="0,40 20,35 40,30 60,32 80,25 100,22 120,18 140,12 160,15 180,8 200,5"
              fill="none"
              stroke="#fff"
              strokeWidth="2"
            />
            <polygon
              points="0,40 20,35 40,30 60,32 80,25 100,22 120,18 140,12 160,15 180,8 200,5 200,60 0,60"
              fill="url(#g1)"
            />
          </svg>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[
            ['Pedidos', M.pedidosHoy, 'hoy'],
            ['Clientes', M.clientes, '+4'],
            ['Calif.', `${M.calif}★`, '5 reseñas'],
          ].map(([l, v, sub]) => (
            <div
              key={l as string}
              className="bg-white rounded-xl border border-line2 p-3"
            >
              <div className="text-[9px] uppercase text-mute">{l}</div>
              <div className="text-xl font-bold mt-0.5">{v}</div>
              <div className="text-[9px] text-mute mt-0.5">{sub}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// =============================================================
//   3. BENTO GRID (celdas de tamaños distintos)
// =============================================================

function DashBento() {
  return (
    <div className="flex flex-1 bg-[#F4F5F7] overflow-hidden">
      <MiniSidebar />
      <div className="flex-1 p-3 grid grid-cols-4 grid-rows-3 gap-2">
        <div
          className="col-span-2 row-span-2 rounded-2xl p-4 text-white"
          style={{ background: `linear-gradient(160deg, ${PRIMARY}, ${PRIMARY_DARK})` }}
        >
          <div className="text-[10px] opacity-80 uppercase tracking-wider">
            Ingresos 30 días
          </div>
          <div className="text-3xl font-black mt-1">{fmt(M.ingresos30d)}</div>
          <div className="text-[11px] opacity-90 mt-1">↑ 12% vs mes anterior</div>
          <svg viewBox="0 0 100 30" className="w-full mt-3">
            <polyline
              points="0,20 15,18 30,15 45,16 60,10 75,8 90,5 100,2"
              fill="none"
              stroke="#fff"
              strokeWidth="1.5"
            />
          </svg>
          <div className="absolute"></div>
        </div>
        <div className="rounded-2xl bg-white p-3 flex flex-col justify-between">
          <div className="text-[9px] uppercase text-mute font-semibold">
            Pedidos hoy
          </div>
          <div className="text-3xl font-black" style={{ color: PRIMARY }}>
            {M.pedidosHoy}
          </div>
        </div>
        <div className="rounded-2xl bg-white p-3 flex flex-col justify-between">
          <div className="text-[9px] uppercase text-mute font-semibold">Ticket prom.</div>
          <div className="text-xl font-bold">{fmt(M.ticket)}</div>
        </div>
        <div className="rounded-2xl bg-[#0F1B26] text-white p-3">
          <div className="text-[9px] uppercase opacity-70 font-semibold">Calificación</div>
          <div className="text-2xl font-black mt-1" style={{ color: PRIMARY }}>
            {M.calif} ★
          </div>
          <div className="text-[10px] opacity-80 mt-0.5">5 reseñas</div>
        </div>
        <div className="rounded-2xl bg-white p-3">
          <div className="text-[9px] uppercase text-mute font-semibold">Clientes</div>
          <div className="text-xl font-bold mt-1">{M.clientes}</div>
        </div>
        <div className="col-span-2 rounded-2xl bg-white p-3">
          <div className="text-[9px] uppercase text-mute font-semibold mb-2">
            Top productos
          </div>
          <div className="space-y-1.5">
            {['Café americano · 12', 'Cappuccino · 8', 'Brownie · 5'].map(
              (p) => (
                <div
                  key={p}
                  className="flex items-center text-[11px]"
                >
                  <div className="flex-1">{p}</div>
                  <div
                    className="h-1.5 rounded-full"
                    style={{
                      background: PRIMARY,
                      width: `${30 + Math.random() * 50}%`,
                    }}
                  />
                </div>
              ),
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// =============================================================
//   4. SIDEBAR DE STATS (tipo Linear/Notion)
// =============================================================

function DashSidebarStats() {
  return (
    <div className="flex flex-1 bg-white overflow-hidden">
      <MiniSidebar />
      <div className="flex-1 flex">
        <div className="flex-1 p-5 border-r border-line2">
          <div className="text-[11px] text-mute mb-1">miércoles 6 mayo</div>
          <h1 className="text-2xl font-bold mb-1">Buen día, Café del Día</h1>
          <p className="text-sm text-mute mb-5">
            Aquí está el resumen de tu negocio.
          </p>
          <div className="space-y-3">
            {[
              ['Pedidos hoy', M.pedidosHoy, '4 en últimos 30 días'],
              ['Ingresos del día', fmt(M.ingresosHoy), `${fmt(M.ingresos30d)} en 30d`],
              ['Tarjetas activas', M.tarjetas, `${M.pasesWallet} en wallet`],
              ['Calificación', `${M.calif}★`, '5 reseñas'],
            ].map(([l, v, s]) => (
              <div
                key={l as string}
                className="flex items-baseline justify-between border-b border-line2 pb-3"
              >
                <div>
                  <div className="font-medium text-sm">{l}</div>
                  <div className="text-[10px] text-mute mt-0.5">{s}</div>
                </div>
                <div className="text-2xl font-black" style={{ color: PRIMARY }}>
                  {v}
                </div>
              </div>
            ))}
          </div>
        </div>
        <aside className="w-[200px] p-3 bg-[#FAFBFC] flex flex-col gap-2">
          <div className="text-[9px] uppercase tracking-wider text-mute font-bold">
            Acciones
          </div>
          <button
            className="text-white text-xs font-semibold py-2 rounded-lg"
            style={{ background: PRIMARY }}
          >
            + Crear tarjeta
          </button>
          <button className="text-xs font-semibold py-2 rounded-lg border border-line">
            Enviar push
          </button>
          <div className="h-px bg-line2 my-2" />
          <div className="text-[9px] uppercase tracking-wider text-mute font-bold">
            Top productos
          </div>
          {['Ferrero', 'Café', 'Brownie'].map((p, i) => (
            <div key={p} className="flex justify-between text-[11px] py-1">
              <span>{i + 1}. {p}</span>
              <span className="text-mute">{3 - i}</span>
            </div>
          ))}
        </aside>
      </div>
    </div>
  );
}

// =============================================================
//   5. CARDS COLORIDAS (tipo Stripe Atlas)
// =============================================================

function DashStripe() {
  return (
    <div className="flex flex-1 bg-white overflow-hidden">
      <MiniSidebar />
      <div className="flex-1 p-5 overflow-y-auto scrollbar-none">
        <div className="text-2xl font-bold mb-4">Resumen</div>
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div
            className="rounded-2xl p-5 text-white"
            style={{ background: `linear-gradient(135deg, ${PRIMARY}, ${PRIMARY_DARK})` }}
          >
            <div className="text-[10px] opacity-80 uppercase tracking-wider">
              MRR estimado
            </div>
            <div className="text-3xl font-black mt-1">{fmt(M.ingresos30d)}</div>
            <div className="text-[10px] opacity-80 mt-1">12% más que el mes pasado</div>
          </div>
          <div className="rounded-2xl p-5 bg-[#1E293B] text-white">
            <div className="text-[10px] opacity-80 uppercase tracking-wider">
              Calificación promedio
            </div>
            <div className="text-3xl font-black mt-1" style={{ color: PRIMARY }}>
              {M.calif} ★
            </div>
            <div className="text-[10px] opacity-80 mt-1">5 reseñas en 30d</div>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {[
            ['Pedidos', M.pedidosHoy],
            ['Ticket', fmt(M.ticket)],
            ['Clientes', M.clientes],
            ['Tarjetas', M.tarjetas],
          ].map(([l, v]) => (
            <div
              key={l as string}
              className="rounded-xl border border-line2 bg-[#FAFBFC] p-3"
            >
              <div className="text-[9px] uppercase text-mute font-semibold">
                {l}
              </div>
              <div className="text-base font-bold mt-1">{v}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// =============================================================
//   6. DARK PRO (fondo oscuro · vibe gaming/saas técnico)
// =============================================================

function DashDarkPro() {
  return (
    <div className="flex flex-1 bg-[#0A0F18] overflow-hidden text-white">
      <MiniSidebar />
      <div className="flex-1 p-4 overflow-y-auto scrollbar-none">
        <div className="flex items-baseline justify-between mb-3">
          <div className="text-lg font-bold">Dashboard</div>
          <div
            className="text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded"
            style={{
              background: PRIMARY,
              color: '#0A0F18',
            }}
          >
            Live
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <div className="text-[9px] uppercase opacity-50">Ingresos 30d</div>
            <div className="text-2xl font-black mt-1" style={{ color: PRIMARY }}>
              {fmt(M.ingresos30d)}
            </div>
            <svg viewBox="0 0 100 20" className="w-full h-6 mt-1">
              <polyline
                points="0,15 15,12 30,10 45,11 60,7 75,5 90,3 100,1"
                fill="none"
                stroke={PRIMARY}
                strokeWidth="1.5"
              />
            </svg>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <div className="text-[9px] uppercase opacity-50">Pedidos hoy</div>
            <div className="text-2xl font-black mt-1">{M.pedidosHoy}</div>
            <div className="text-[10px] opacity-50 mt-1">
              Ticket {fmt(M.ticket)}
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 mb-3">
          <div className="text-[9px] uppercase opacity-50 mb-2">
            Actividad en tiempo real
          </div>
          {['+1 sello · Javier', '+1 pedido #A8K2', '+1 cliente nuevo'].map(
            (a, i) => (
              <div
                key={a}
                className="flex items-center gap-2 text-[11px] py-1 border-b border-white/5 last:border-0"
              >
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: PRIMARY, opacity: 1 - i * 0.3 }}
                />
                <span className="flex-1">{a}</span>
                <span className="opacity-50">hace {i + 1}m</span>
              </div>
            ),
          )}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[
            ['CLIENTES', M.clientes],
            ['TARJETAS', M.tarjetas],
            ['CALIF', `${M.calif}★`],
          ].map(([l, v]) => (
            <div
              key={l as string}
              className="rounded-xl border border-white/10 bg-white/[0.03] p-2 text-center"
            >
              <div className="text-[8px] tracking-widest opacity-50">{l}</div>
              <div className="text-sm font-bold mt-0.5">{v}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// =============================================================
//   7. EJECUTIVO (tablas + KPIs grandes · Excel-feel)
// =============================================================

function DashExecutive() {
  return (
    <div className="flex flex-1 bg-white overflow-hidden">
      <MiniSidebar />
      <div className="flex-1 p-4 overflow-y-auto scrollbar-none">
        <div className="text-lg font-bold mb-3">
          Reporte ejecutivo · Mayo
        </div>
        <table className="w-full text-[11px] mb-4 border-collapse">
          <thead>
            <tr className="bg-[#F4F5F7]">
              <th className="text-left p-2 font-semibold">Métrica</th>
              <th className="text-right p-2 font-semibold">Hoy</th>
              <th className="text-right p-2 font-semibold">7 días</th>
              <th className="text-right p-2 font-semibold">30 días</th>
              <th className="text-right p-2 font-semibold">vs mes ant.</th>
            </tr>
          </thead>
          <tbody>
            {[
              ['Pedidos', M.pedidosHoy, 38, 142, '+8%'],
              ['Ingresos', fmt(M.ingresosHoy), fmt(450000), fmt(M.ingresos30d), '+12%'],
              ['Ticket promedio', fmt(M.ticket), fmt(46200), fmt(M.ticket), '+3%'],
              ['Sellos otorgados', 4, 28, M.sellos30d, '+22%'],
            ].map((r) => (
              <tr key={r[0] as string} className="border-b border-line2">
                <td className="p-2">{r[0]}</td>
                <td className="text-right p-2 font-medium">{r[1]}</td>
                <td className="text-right p-2 font-medium">{r[2]}</td>
                <td className="text-right p-2 font-medium">{r[3]}</td>
                <td className="text-right p-2 font-bold" style={{ color: PRIMARY }}>
                  {r[4]}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="grid grid-cols-3 gap-3">
          {[
            ['Clientes', M.clientes, '+4'],
            ['Recurrentes', M.recurrentes, '26%'],
            ['Calif.', `${M.calif}★`, '5 reseñas'],
          ].map(([l, v, s]) => (
            <div
              key={l as string}
              className="rounded-xl bg-[#FAFBFC] p-3 border-l-4"
              style={{ borderColor: PRIMARY }}
            >
              <div className="text-[9px] uppercase text-mute font-semibold">
                {l}
              </div>
              <div className="text-xl font-bold mt-0.5">{v}</div>
              <div className="text-[10px] text-mute mt-0.5">{s}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// =============================================================
//   8. ACTIVITY FIRST (feed central · Twitter-style)
// =============================================================

function DashActivity() {
  return (
    <div className="flex flex-1 bg-[#FAFBFC] overflow-hidden">
      <MiniSidebar />
      <div className="flex-1 p-3 grid grid-cols-3 gap-3">
        <aside className="space-y-2">
          {[
            ['Pedidos hoy', M.pedidosHoy],
            ['Ingresos hoy', fmt(M.ingresosHoy)],
            ['Calif.', `${M.calif}★`],
            ['Clientes', M.clientes],
          ].map(([l, v]) => (
            <div
              key={l as string}
              className="bg-white rounded-xl p-2.5 border border-line2"
            >
              <div className="text-[9px] uppercase text-mute font-semibold">
                {l}
              </div>
              <div className="text-base font-bold mt-0.5" style={{ color: PRIMARY }}>
                {v}
              </div>
            </div>
          ))}
        </aside>
        <main className="col-span-2 bg-white rounded-2xl p-3 border border-line2">
          <div className="text-[10px] uppercase tracking-wider text-mute font-semibold mb-2">
            Actividad en vivo
          </div>
          {[
            { e: '⭐', t: '+1 sello a Javier', s: 'hace 2 min', tag: 'Sello' },
            { e: '🛒', t: 'Pedido #A8K2 confirmado', s: 'hace 5 min', tag: 'Pedido', amt: fmt(48000) },
            { e: '🤝', t: 'Nuevo cliente · Maru', s: 'hace 12 min', tag: 'Cliente' },
            { e: '🔔', t: 'Push enviado a 32 pases', s: 'hace 1h', tag: 'Push' },
            { e: '⭐', t: 'Reseña 5★ de Carlos', s: 'hace 2h', tag: 'Reseña' },
          ].map((a, i) => (
            <div
              key={i}
              className="flex items-start gap-2.5 py-2 border-b border-line2 last:border-0"
            >
              <div className="text-lg">{a.e}</div>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-medium leading-tight">
                  {a.t}
                </div>
                <div className="text-[10px] text-mute mt-0.5">
                  <span
                    className="inline-block px-1.5 py-0 rounded text-[9px] font-semibold mr-1"
                    style={{
                      background: PRIMARY + '20',
                      color: PRIMARY_DARK,
                    }}
                  >
                    {a.tag}
                  </span>
                  {a.s}
                </div>
              </div>
              {a.amt && (
                <div className="text-[11px] font-bold" style={{ color: PRIMARY }}>
                  {a.amt}
                </div>
              )}
            </div>
          ))}
        </main>
      </div>
    </div>
  );
}

// =============================================================
//   9. SOFT MINIMAL (whitespace · vibe Apple/Notion)
// =============================================================

function DashSoftMinimal() {
  return (
    <div className="flex flex-1 bg-white overflow-hidden">
      <MiniSidebar />
      <div className="flex-1 p-8 overflow-y-auto scrollbar-none">
        <div className="text-[11px] text-mute mb-1">Mayo 6, 2026</div>
        <h1 className="text-3xl font-bold tracking-tight mb-1">
          Buen día, Café del Día.
        </h1>
        <p className="text-mute text-sm mb-8">
          Tu negocio va bien hoy.
        </p>
        <div className="space-y-6 max-w-md">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-mute font-semibold mb-1">
              Ingresos
            </div>
            <div className="text-5xl font-black" style={{ color: PRIMARY }}>
              {fmt(M.ingresos30d)}
            </div>
            <div className="text-xs text-mute mt-1">en los últimos 30 días</div>
          </div>
          <div className="grid grid-cols-3 gap-6 pt-4 border-t border-line2">
            {[
              ['Pedidos', M.pedidosHoy],
              ['Clientes', M.clientes],
              ['Tarjetas', M.tarjetas],
            ].map(([l, v]) => (
              <div key={l as string}>
                <div className="text-[10px] uppercase tracking-widest text-mute font-semibold">
                  {l}
                </div>
                <div className="text-2xl font-bold mt-0.5">{v}</div>
              </div>
            ))}
          </div>
          <div className="pt-4 border-t border-line2">
            <div className="text-[10px] uppercase tracking-widest text-mute font-semibold mb-2">
              Calificación
            </div>
            <div className="flex items-end gap-3">
              <div className="text-4xl font-bold" style={{ color: PRIMARY }}>
                {M.calif}
              </div>
              <div className="text-2xl text-amber-400 mb-1">★★★★★</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// =============================================================
//   10. RING CHARTS (anillos de progreso · vibe fitness/health)
// =============================================================

function DashRings() {
  const Ring = ({ pct, color, label, value }: { pct: number; color: string; label: string; value: string }) => {
    const r = 36;
    const c = 2 * Math.PI * r;
    const off = c * (1 - pct / 100);
    return (
      <div className="flex flex-col items-center">
        <svg width="96" height="96" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r={r} fill="none" stroke="#E5E7EB" strokeWidth="8" />
          <circle
            cx="50"
            cy="50"
            r={r}
            fill="none"
            stroke={color}
            strokeWidth="8"
            strokeDasharray={c}
            strokeDashoffset={off}
            strokeLinecap="round"
            transform="rotate(-90 50 50)"
          />
          <text x="50" y="50" textAnchor="middle" dy="0.35em" fontSize="18" fontWeight="700">
            {value}
          </text>
        </svg>
        <div className="text-[10px] uppercase tracking-wider text-mute font-semibold mt-1.5">
          {label}
        </div>
      </div>
    );
  };
  return (
    <div className="flex flex-1 bg-[#FAFBFC] overflow-hidden">
      <MiniSidebar />
      <div className="flex-1 p-5 overflow-y-auto scrollbar-none">
        <div className="text-lg font-bold mb-1">Tu día en resumen</div>
        <p className="text-xs text-mute mb-5">Cierra los anillos cada día</p>
        <div className="grid grid-cols-3 gap-3 mb-5">
          <Ring pct={68} color={PRIMARY} label="Pedidos" value={`${M.pedidosHoy}`} />
          <Ring pct={82} color="#3B82F6" label="Ticket prom." value={`82%`} />
          <Ring pct={45} color="#F97316" label="Calif." value={`${M.calif}`} />
        </div>
        <div
          className="rounded-2xl p-4 text-white"
          style={{ background: `linear-gradient(135deg, ${PRIMARY}, ${PRIMARY_DARK})` }}
        >
          <div className="text-[10px] opacity-80 uppercase tracking-wider">
            Total del mes
          </div>
          <div className="text-2xl font-black mt-1">{fmt(M.ingresos30d)}</div>
          <div className="text-[10px] opacity-80 mt-1">
            {M.clientes} clientes · {M.pasesWallet} pases activos
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
          Estilos de Dashboard
        </h1>
        <p className="text-center text-sm text-mute mt-2">
          10 composiciones manteniendo el verde Clubify y el sidebar oscuro
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 mt-10">
          <Frame
            num={1}
            title="Clásico Clubify"
            best="Tu dashboard actual — KPIs en grid + secciones."
            pros={['Familiar y denso', 'Mucha info visible de un vistazo', 'Lo que ya conocen tus clientes']}
          >
            <DashClassic />
          </Frame>
          <Frame
            num={2}
            title="Hero Chart"
            best="Negocios donde el revenue mensual es la métrica clave."
            pros={['Gráfico grande arriba', 'Comparación vs mes anterior', 'Foco en evolución de ingresos']}
          >
            <DashHeroChart />
          </Frame>
          <Frame
            num={3}
            title="Bento Grid"
            best="Marcas modernas que valoran lo visual (estilo Apple Health)."
            pros={['Celdas de tamaños variados', 'Ingresos como hero', 'Top productos integrados']}
          >
            <DashBento />
          </Frame>
          <Frame
            num={4}
            title="Sidebar Stats"
            best="Operadores que quieren foco — info principal a la izquierda, acciones a la derecha."
            pros={['Saludo personalizado', 'Lista vertical limpia', 'Quick actions siempre a la mano']}
          >
            <DashSidebarStats />
          </Frame>
          <Frame
            num={5}
            title="Stripe / Atlas"
            best="Negocios que se ven 'profesionales' / startup-like."
            pros={['2 cards hero (verde + dark)', 'KPIs secundarios pequeños', 'Aire premium']}
          >
            <DashStripe />
          </Frame>
          <Frame
            num={6}
            title="Dark Pro"
            best="Bares, restaurantes nocturnos, marcas tech."
            pros={['Fondo oscuro elegante', 'Verde neón como accent', 'Live activity con dots animados']}
          >
            <DashDarkPro />
          </Frame>
          <Frame
            num={7}
            title="Ejecutivo"
            best="Dueños que viven en Excel — tabla con comparativos."
            pros={['Tabla con hoy/7d/30d/vs mes', 'Border accent verde', 'Tipo reporte gerencial']}
          >
            <DashExecutive />
          </Frame>
          <Frame
            num={8}
            title="Activity First"
            best="Restaurantes con mucha actividad en vivo (mesas/pedidos)."
            pros={['Feed central con eventos', 'KPIs como sidebar', 'Tags por tipo de evento']}
          >
            <DashActivity />
          </Frame>
          <Frame
            num={9}
            title="Soft Minimal"
            best="Boutiques, marcas lifestyle — vibe Notion/Apple."
            pros={['Mucho whitespace', 'Tipografía grande', 'Saludo + 1 número estrella']}
          >
            <DashSoftMinimal />
          </Frame>
          <Frame
            num={10}
            title="Rings"
            best="Gimnasios y negocios con metas diarias (cierra el anillo)."
            pros={['Anillos de progreso visuales', '3 metas del día', 'Card hero verde abajo']}
          >
            <DashRings />
          </Frame>
        </div>
      </div>
    </div>
  );
}
