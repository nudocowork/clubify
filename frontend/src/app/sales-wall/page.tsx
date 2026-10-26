'use client';
import React from 'react';
import { api } from '@/lib/api';

/**
 * Clubify Sales Wall — la pantalla de ventas para la TV de la oficina.
 *
 * Nació del diseño de Claude Design («Clubify Sales Wall.dc.html»,
 * 2026-10-25). El 2026-10-25 Javier pidió que fuera «más amigable, menos IA»,
 * con modo claro y oscuro, y que se pudiera bajar en pantallas pequeñas: se
 * cambió el neón sobre negro y las etiquetas en mayúsculas espaciadas por la
 * estética de Clubify (Inter, verde #22C55E, tarjetas blancas o grafito).
 *
 * Datos: `GET /admin/sales-wall` — ventas y renovaciones del mes en hora de
 * Bogotá, desde Contabilidad (lo cobrado de verdad, cuadrado con Hotmart).
 * Se consulta cada `?cada=` segundos (15 por defecto); la primera respuesta
 * cuenta sin celebrar y las siguientes celebran lo nuevo.
 *
 * Opciones por URL, para no tocar código desde la TV:
 *   ?meta=4000    meta mensual en USD (sin ella, la de octubre 2026: 4.000)
 *   ?cada=15      segundos entre consultas
 *   ?tema=oscuro  o claro; si no, el último elegido o el del sistema
 *   ?demo=1       datos simulados (etiqueta «Demo» visible)
 */

const TZ = 'America/Bogota';
const MSG_V = '¡Bienvenido a Clubify!';
const MSG_R = 'Sigue creciendo con Clubify';
const fmtTime = new Intl.DateTimeFormat('es-CO', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true });
const fmtHM = new Intl.DateTimeFormat('es-CO', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true });
const fmtDate = new Intl.DateTimeFormat('es-CO', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' });
const fmtDM = new Intl.DateTimeFormat('es-CO', { timeZone: TZ, day: 'numeric', month: 'short' });
const fmtMonth = new Intl.DateTimeFormat('es-CO', { timeZone: TZ, month: 'long', year: 'numeric' });
const fmtKey = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const dayKey = (ts: number) => fmtKey.format(new Date(ts));
const monthKey = (ts: number) => dayKey(ts).slice(0, 7);
const fmtUSD = (n: number) => 'US$ ' + Math.round(n).toLocaleString('es-CO');
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const iniciales = (n: string) =>
  n
    .replace(/[^\p{L}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('') || '·';

type Tema = 'claro' | 'oscuro';
/** Colores por tema. Venta = verde Clubify; renovación = azul. */
const PALETA: Record<Tema, { venta: string; ventaRgb: string; renov: string; renovRgb: string; confeti: string[] }> = {
  claro: { venta: '#16A34A', ventaRgb: '22,163,74', renov: '#2563EB', renovRgb: '37,99,235', confeti: ['#22C55E', '#16A34A', '#86EFAC', '#FACC15', '#38BDF8'] },
  oscuro: { venta: '#22C55E', ventaRgb: '34,197,94', renov: '#60A5FA', renovRgb: '96,165,250', confeti: ['#22C55E', '#4ADE80', '#BBF7D0', '#FDE047', '#7DD3FC'] },
};

const DEMO_AF = ['Juan Pérez', 'María Gómez', 'Andrés Ramírez', 'Laura Castillo', 'Santiago Torres', 'Valentina Ríos'];
const DEMO_NEG = ['Restaurante El Sabor', 'Café Central', 'Panadería La Espiga', 'Barbería Clásica', 'Pizzería Napoli', 'Spa Armonía', 'Heladería Polar'];
const DEMO_PLAN: Array<[string, number]> = [['Mensualidad básica', 25], ['Plan Mensual', 68], ['Plan Trimestral', 150], ['Plan Anual', 500]];

type Tipo = 'venta' | 'renov';
type Evento = {
  id: string;
  type: Tipo;
  usd: number;
  ts: number;
  afiliado: string;
  negocio: string;
  plan: string;
  confirmed: boolean;
};
type Raw = Record<string, any>;

function normalize(raw: Raw): Evento | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = String(raw.tipo ?? raw.type ?? '').toLowerCase();
  const type: Tipo | null = /renov|renew/.test(t) ? 'renov' : /venta|sale|new|nuev|alta/.test(t) ? 'venta' : null;
  if (!type) return null;
  const tsRaw = raw.fecha ?? raw.created_at ?? Date.now();
  const ts = typeof tsRaw === 'number' ? (tsRaw < 1e12 ? tsRaw * 1000 : tsRaw) : Date.parse(tsRaw);
  const estadoRaw = String(raw.estado ?? raw.status ?? 'confirmada').toLowerCase();
  const confirmed = /confirm|aprob|approv|paid|pagad|complet|success|exitos|activ/.test(estadoRaw);
  const afiliado = String(raw.afiliado ?? raw.affiliate ?? '') || 'Sin asignar';
  const negocio = String(raw.negocio ?? raw.business ?? '') || '—';
  const plan = typeof raw.plan === 'string' ? raw.plan : '';
  const id = String(raw.id ?? `${type}-${ts}-${afiliado}-${negocio}`);
  const usd = Number(raw.monto_usd ?? raw.monto ?? raw.amount ?? 0) || 0;
  return { id, type, usd, ts: Number.isNaN(ts) ? Date.now() : ts, afiliado, negocio, plan, confirmed };
}

const CSS = `
.sw{--bg:#F4F6F5;--card:#FFFFFF;--ink:#0F172A;--ink2:#334155;--mute:#64748B;--line:#E5E7EB;--soft:#F1F5F3;--track:#E9EEEB;
  --venta:#16A34A;--venta-soft:#DCFCE7;--renov:#2563EB;--renov-soft:#DBEAFE;--brand:#22C55E;--shadow:0 1px 2px rgba(15,23,42,.04),0 8px 24px rgba(15,23,42,.06)}
.sw[data-tema="oscuro"]{--bg:#0B1110;--card:#121A18;--ink:#ECF2EF;--ink2:#C7D2CD;--mute:#8A9A93;--line:#1F2A27;--soft:#16201D;--track:#1C2724;
  --venta:#22C55E;--venta-soft:rgba(34,197,94,.14);--renov:#60A5FA;--renov-soft:rgba(96,165,250,.14);--shadow:0 1px 2px rgba(0,0,0,.3)}
.sw{min-height:100vh;background:var(--bg);color:var(--ink);font-family:'Inter',system-ui,sans-serif;position:relative;
  display:flex;flex-direction:column;gap:clamp(12px,1.2vw,28px);padding:clamp(14px,1.6vw,40px);transition:background .3s,color .3s}
.sw *{box-sizing:border-box}
.sw-card{background:var(--card);border:1px solid var(--line);border-radius:clamp(14px,1vw,22px);box-shadow:var(--shadow)}
.sw-label{font-size:clamp(13px,.95vw,22px);font-weight:600;color:var(--mute)}
.sw-num{font-variant-numeric:tabular-nums}
.sw-btn{display:inline-flex;align-items:center;gap:8px;cursor:pointer;background:var(--card);color:var(--ink2);border:1px solid var(--line);
  border-radius:999px;padding:clamp(7px,.5vw,12px) clamp(12px,1vw,22px);font:600 clamp(12px,.85vw,18px) 'Inter',system-ui,sans-serif;white-space:nowrap}
.sw-btn:hover{border-color:var(--brand)}
.sw-btn:focus-visible{outline:2px solid var(--brand);outline-offset:2px}
.sw-pill{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:3px 10px;font-weight:600;font-size:clamp(11px,.8vw,18px);white-space:nowrap}
@keyframes sw-pulse{0%{box-shadow:0 0 0 0 currentColor}70%{box-shadow:0 0 0 8px transparent}100%{box-shadow:0 0 0 0 transparent}}
@media (max-width:900px){.sw-stats{grid-template-columns:1fr!important}.sw-bottom{grid-template-columns:1fr!important}.sw-col-plan,.sw-col-hora{display:none!important}}
@media (prefers-reduced-motion:reduce){.sw *{animation:none!important;transition:none!important}}
`;

type Particula = Record<string, any>;
type Estado = {
  now: number;
  status: 'connecting' | 'live' | 'reconnecting' | 'offline';
  events: Evento[];
  ventas: number;
  renov: number;
  usd: number;
  dV: number;
  dR: number;
  dU: number;
  cel: Evento | null;
  soundOn: boolean;
  flashId: string | null;
  tema: Tema;
};
type Opciones = { demo: boolean; meta: number; cada: number; tema: Tema };

class SalesWall extends React.Component<Opciones, Estado> {
  state: Estado = { now: Date.now(), status: 'connecting', events: [], ventas: 0, renov: 0, usd: 0, dV: 0, dR: 0, dU: 0, cel: null, soundOn: false, flashId: null, tema: this.props.tema };
  /** Cualquier toque o tecla en la página desbloquea el audio (ver `prepararSonido`). */
  desbloquear = () => this.prepararSonido();
  vNumRef = React.createRef<HTMLDivElement>();
  rNumRef = React.createRef<HTMLDivElement>();
  tNumRef = React.createRef<HTMLDivElement>();
  vCardRef = React.createRef<HTMLDivElement>();
  rCardRef = React.createRef<HTMLDivElement>();
  tCardRef = React.createRef<HTMLDivElement>();
  celRef = React.createRef<HTMLDivElement>();
  trackRef = React.createRef<HTMLDivElement>();
  canvasRef = React.createRef<HTMLCanvasElement>();
  seen = new Set<string>();
  queue: Evento[] = [];
  particles: Particula[] = [];
  timers: ReturnType<typeof setTimeout>[] = [];
  failures = 0;
  x = 0;
  month = '';
  clock?: ReturnType<typeof setInterval>;
  pollT?: ReturnType<typeof setInterval>;
  celT?: ReturnType<typeof setTimeout>;
  raf = 0;
  pRaf: number | null = null;
  cRaf = 0;
  celBusy = false;
  ac?: AudioContext;
  master?: GainNode;
  onOff = () => this.setState({ status: 'offline' });
  onOn = () => this.restart();
  resize = () => {
    const c = this.canvasRef.current;
    if (!c) return;
    const d = Math.min(2, window.devicePixelRatio || 1);
    c.width = c.clientWidth * d;
    c.height = c.clientHeight * d;
  };

  componentDidMount() {
    this.month = monthKey(Date.now());
    this.clock = setInterval(() => {
      const now = Date.now();
      if (monthKey(now) !== this.month) {
        this.month = monthKey(now);
        this.restart();
      }
      this.setState({ now });
    }, 1000);
    window.addEventListener('offline', this.onOff);
    window.addEventListener('online', this.onOn);
    window.addEventListener('resize', this.resize);
    // Sonido SIEMPRE activo (Javier, 2026-10-25). El navegador no deja sonar
    // nada hasta que alguien toca la página una vez: se intenta al abrir y,
    // si sigue bloqueado, el primer toque o tecla en cualquier parte lo
    // desbloquea. No hay botón para apagarlo.
    window.addEventListener('pointerdown', this.desbloquear);
    window.addEventListener('keydown', this.desbloquear);
    this.prepararSonido();
    this.resize();
    this.tickerLoop();
    this.start();
  }

  componentWillUnmount() {
    this.stop();
    clearInterval(this.clock);
    cancelAnimationFrame(this.raf);
    if (this.pRaf) cancelAnimationFrame(this.pRaf);
    window.removeEventListener('offline', this.onOff);
    window.removeEventListener('online', this.onOn);
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('pointerdown', this.desbloquear);
    window.removeEventListener('keydown', this.desbloquear);
  }

  later(fn: () => void, ms: number) {
    const t = setTimeout(fn, ms);
    this.timers.push(t);
    return t;
  }
  stop() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
    clearInterval(this.pollT);
    clearTimeout(this.celT);
  }
  restart() {
    this.stop();
    this.seen.clear();
    this.queue = [];
    this.failures = 0;
    this.setState({ events: [], ventas: 0, renov: 0, usd: 0, dV: 0, dR: 0, dU: 0, cel: null, status: 'connecting' }, () => this.start());
  }

  start() {
    if (this.props.demo) return this.startDemo();
    let primera = true;
    const poll = async () => {
      try {
        const d = await api<{ ventas: number; renovaciones: number; monto_usd: number; eventos: Raw[] }>('/admin/sales-wall');
        if (primera) {
          this.ingestMany(d.eventos ?? []);
          this.setCounts(+d.ventas || 0, +d.renovaciones || 0, +d.monto_usd || 0);
          primera = false;
        } else {
          [...(d.eventos ?? [])].reverse().forEach((e) => this.ingest(e, true));
        }
        this.failures = 0;
        this.setState({ status: 'live' });
      } catch {
        this.failures++;
        this.setState({ status: this.failures >= 3 ? 'offline' : 'reconnecting' });
      }
    };
    void poll();
    this.pollT = setInterval(poll, Math.max(5, this.props.cada) * 1000);
  }

  demoEvent(ts: number): Raw {
    const [plan, monto] = pick(DEMO_PLAN);
    return { id: 'demo-' + ts + '-' + Math.random().toString(36).slice(2, 7), tipo: Math.random() < 0.6 ? 'venta' : 'renovacion', afiliado: pick(DEMO_AF), negocio: pick(DEMO_NEG), plan, monto_usd: monto, fecha: ts, estado: 'confirmada' };
  }
  startDemo() {
    const now = Date.now();
    const [y, m] = monthKey(now).split('-').map(Number);
    const start = Date.UTC(y, m - 1, 1, 5, 0, 0);
    const n = Math.max(6, Math.round(((now - start) / 864e5) * 3));
    this.ingestMany(Array.from({ length: n }, () => this.demoEvent(start + Math.random() * (now - start - 60000))), true);
    this.later(() => this.setState({ status: 'live' }), 700);
    const loop = () => this.later(() => { this.ingest(this.demoEvent(Date.now()), true); loop(); }, 14000 * (0.6 + Math.random() * 0.8));
    this.later(loop, 2500);
  }

  ingestMany(list: Raw[], count = false) {
    const evs = list.map(normalize).filter((e): e is Evento => !!e && !this.seen.has(e.id) && monthKey(e.ts) === this.month);
    evs.forEach((e) => this.seen.add(e.id));
    this.setState((s) => ({ events: s.events.concat(evs).sort((a, b) => b.ts - a.ts).slice(0, 400) }), () => {
      if (count) this.recount();
    });
  }
  recount() {
    const c = this.state.events.filter((e) => e.confirmed);
    this.setCounts(c.filter((e) => e.type === 'venta').length, c.filter((e) => e.type === 'renov').length, c.reduce((a, e) => a + e.usd, 0));
  }
  setCounts(v: number, r: number, u: number) {
    this.setState({ ventas: v, renov: r, usd: u }, () => this.tweenCounts());
  }

  ingest(raw: Raw, live: boolean) {
    const ev = normalize(raw);
    if (!ev || this.seen.has(ev.id) || monthKey(ev.ts) !== this.month) return;
    this.seen.add(ev.id);
    this.setState(
      (s) => ({
        events: [ev].concat(s.events).sort((a, b) => b.ts - a.ts).slice(0, 400),
        ventas: s.ventas + (ev.confirmed && ev.type === 'venta' ? 1 : 0),
        renov: s.renov + (ev.confirmed && ev.type === 'renov' ? 1 : 0),
        usd: s.usd + (ev.confirmed ? ev.usd : 0),
      }),
      () => {
        if (live && ev.confirmed) {
          this.queue.push(ev);
          if (!this.state.cel && !this.celBusy) this.showNext();
        } else this.tweenCounts();
      },
    );
  }

  tweenCounts() {
    cancelAnimationFrame(this.cRaf);
    const { dV: fV, dR: fR, dU: fU, usd: tU, ventas: tV, renov: tR } = this.state;
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 1100);
      const e = 1 - Math.pow(1 - k, 3);
      this.setState({ dV: Math.round(fV + (tV - fV) * e), dR: Math.round(fR + (tR - fR) * e), dU: fU + (tU - fU) * e });
      if (k < 1) this.cRaf = requestAnimationFrame(step);
    };
    this.cRaf = requestAnimationFrame(step);
  }

  showNext() {
    const ev = this.queue.shift();
    if (!ev) {
      this.celBusy = false;
      return;
    }
    this.celBusy = true;
    this.setState({ cel: ev, flashId: ev.id }, () => {
      const isV = ev.type === 'venta';
      const pal = PALETA[this.state.tema];
      const rgb = isV ? pal.ventaRgb : pal.renovRgb;
      this.celRef.current?.animate(
        [{ transform: 'translateY(24px) scale(.96)', opacity: 0 }, { transform: 'translateY(0) scale(1)', opacity: 1 }],
        { duration: 500, easing: 'cubic-bezier(.2,.9,.3,1)' },
      );
      this.later(() => {
        this.tweenCounts();
        const num = isV ? this.vNumRef.current : this.rNumRef.current;
        const cardEl = isV ? this.vCardRef.current : this.rCardRef.current;
        num?.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.08)' }, { transform: 'scale(1)' }], { duration: 700, easing: 'ease-out' });
        [cardEl, this.tCardRef.current].forEach((c) =>
          c?.animate([{ boxShadow: `0 0 0 0 rgba(${rgb},0)` }, { boxShadow: `0 0 0 4px rgba(${rgb},.25)` }, { boxShadow: `0 0 0 0 rgba(${rgb},0)` }], { duration: 1600, easing: 'ease-out' }),
        );
      }, 300);
      this.burst(ev.type);
      this.playSound(ev.type);
      this.celT = setTimeout(() => {
        const c = this.celRef.current;
        const done = () => {
          this.setState({ cel: null });
          this.later(() => this.showNext(), 450);
        };
        if (c) {
          const a = c.animate([{ opacity: 1 }, { opacity: 0, transform: 'scale(.97)' }], { duration: 300, easing: 'ease-in', fill: 'forwards' });
          a.onfinish = done;
        } else done();
      }, 6000);
      this.later(() => this.setState({ flashId: null }), 9000);
    });
  }

  /** Confeti en la venta, un brillo suave de puntos en la renovación. */
  burst(type: Tipo) {
    const c = this.canvasRef.current;
    if (!c) return;
    if (!c.width) this.resize();
    const W = c.width;
    const H = c.height;
    const s = W / 1920;
    const pal = PALETA[this.state.tema];
    if (type === 'venta') {
      for (let i = 0; i < 160; i++) {
        this.particles.push({ k: 'conf', x: W * (0.2 + Math.random() * 0.6), y: -20 * s, vx: (Math.random() - 0.5) * 6 * s, vy: (2 + Math.random() * 5) * s, g: 0.12 * s, w: (7 + Math.random() * 7) * s, h: (10 + Math.random() * 8) * s, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.25, col: pick(pal.confeti), life: 1, decay: 0.004 + Math.random() * 0.003, delay: Math.random() * 30 });
      }
    } else {
      for (let i = 0; i < 60; i++) {
        const a = Math.random() * Math.PI * 2;
        const d = (180 + Math.random() * 420) * s;
        this.particles.push({ k: 'orb', x: W / 2 + Math.cos(a) * d, y: H / 2 + Math.sin(a) * d * 0.6, vy: (-0.5 - Math.random() * 1.2) * s, r: (3 + Math.random() * 4) * s, col: pal.renov, life: 1, decay: 0.007 + Math.random() * 0.008, delay: Math.random() * 50 });
      }
    }
    if (!this.pRaf) this.pRaf = requestAnimationFrame(this.draw);
  }

  draw = () => {
    const c = this.canvasRef.current;
    if (!c) {
      this.pRaf = null;
      return;
    }
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    this.particles = this.particles.filter((p) => {
      if (p.delay > 0) {
        p.delay--;
        return true;
      }
      p.life -= p.decay;
      if (p.life <= 0) return false;
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 1.5));
      ctx.fillStyle = p.col;
      if (p.k === 'conf') {
        p.vy += p.g;
        p.vx *= 0.99;
        p.x += p.vx + Math.sin(p.rot) * 0.6;
        p.y += p.vy;
        p.rot += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.scale(1, Math.cos(p.rot * 2));
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      } else {
        p.y += p.vy;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      return true;
    });
    ctx.globalAlpha = 1;
    this.pRaf = this.particles.length ? requestAnimationFrame(this.draw) : null;
    if (!this.pRaf) ctx.clearRect(0, 0, c.width, c.height);
  };

  tickerLoop() {
    let last = performance.now();
    const step = (t: number) => {
      const dt = Math.min(64, t - last) / 1000;
      last = t;
      const el = this.trackRef.current;
      if (el) {
        const half = el.scrollWidth / 2;
        this.x -= 70 * dt * Math.max(0.5, window.innerWidth / 1920);
        if (half > 0 && -this.x >= half) this.x += half;
        el.style.transform = `translate3d(${this.x}px,0,0)`;
      }
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  cambiarTema = () => {
    const tema: Tema = this.state.tema === 'oscuro' ? 'claro' : 'oscuro';
    this.setState({ tema });
    try {
      localStorage.setItem('sales-wall:tema', tema);
    } catch {}
  };

  /** Crea el audio y lo deja sonando. `soundOn` = el navegador ya lo dejó. */
  prepararSonido = () => {
    if (!this.ac) {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (!AC) return;
      this.ac = new AC();
      this.master = this.ac.createGain();
      this.master.gain.value = 0.7;
      this.master.connect(this.ac.destination);
      this.ac.onstatechange = () => this.setState({ soundOn: this.ac?.state === 'running' });
    }
    const yaSonaba = this.ac.state === 'running';
    void this.ac.resume().then(() => {
      const ok = this.ac?.state === 'running';
      this.setState({ soundOn: ok });
      if (ok && !yaSonaba) this.playSound('venta');
    });
  };
  playSound(type: Tipo) {
    if (!this.ac || !this.master || this.ac.state !== 'running') return;
    const ac = this.ac;
    const master = this.master;
    const t = ac.currentTime;
    const note = (f: number, st: number, d: number, wave: OscillatorType, vol: number) => {
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = wave;
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + st);
      g.gain.linearRampToValueAtTime(vol, t + st + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + st + d);
      o.connect(g);
      g.connect(master);
      o.start(t + st);
      o.stop(t + st + d + 0.05);
    };
    if (type === 'venta') {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => note(f, i * 0.085, 0.45, 'triangle', 0.2));
      note(1318.5, 0.34, 1.0, 'sine', 0.1);
    } else {
      note(659.25, 0, 1.2, 'sine', 0.2);
      note(987.77, 0.2, 1.4, 'sine', 0.16);
    }
  }

  render() {
    const s = this.state;
    const now = s.now;
    const pal = PALETA[s.tema];
    const ST = ({ live: ['En vivo', pal.venta], connecting: ['Conectando…', '#94A3B8'], reconnecting: ['Reconectando…', '#D97706'], offline: ['Sin conexión', '#DC2626'] } as const)[s.status];
    const total = s.ventas + s.renov;
    const pctV = total ? Math.round((s.ventas / total) * 100) : 0;
    const pctR = total ? 100 - pctV : 0;
    const today = dayKey(now);
    const conf = s.events.filter((e) => e.confirmed);
    const todayEv = conf.filter((e) => dayKey(e.ts) === today);
    // Montos en USD por tipo (precio del plan, desde Contabilidad).
    const usdV = conf.filter((e) => e.type === 'venta').reduce((a, e) => a + e.usd, 0);
    const usdR = conf.filter((e) => e.type === 'renov').reduce((a, e) => a + e.usd, 0);
    const when = (e: Evento) => (dayKey(e.ts) === today ? 'Hoy, ' : fmtDM.format(new Date(e.ts)).replace('.', '') + ', ') + fmtHM.format(new Date(e.ts));

    let tick = conf.slice(0, 12).reverse();
    if (tick.length) {
      const base = tick;
      while (tick.length < 8) tick = tick.concat(base);
      tick = tick.concat(tick);
    }

    const map: Record<string, { name: string; v: number; r: number }> = {};
    conf.forEach((e) => {
      const m = map[e.afiliado] || (map[e.afiliado] = { name: e.afiliado, v: 0, r: 0 });
      if (e.type === 'venta') m.v++;
      else m.r++;
    });
    const rk = Object.values(map)
      .map((m) => ({ ...m, total: m.v + m.r }))
      .sort((a, b) => b.total - a.total || b.v - a.v)
      .slice(0, 5);
    const top = rk[0]?.total || 1;

    const goal = Math.max(1, this.props.meta);
    const goalPct = Math.round((s.dU / goal) * 100);
    const remaining = goal - s.usd;
    const cel = s.cel;
    const cv = cel?.type === 'venta';
    const celColor = cv ? 'var(--venta)' : 'var(--renov)';

    return (
      <div className="sw" data-tema={s.tema}>
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" />
        <style>{CSS}</style>

        {/* Cabecera */}
        <header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'clamp(10px,1.2vw,28px)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'clamp(8px,.6vw,14px)' }}>
            <svg viewBox="0 0 280 280" style={{ width: 'clamp(30px,2.2vw,54px)', height: 'clamp(30px,2.2vw,54px)', display: 'block' }} aria-hidden>
              <defs>
                <linearGradient id="swMark" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#4FE83F" />
                  <stop offset="100%" stopColor="#00B23A" />
                </linearGradient>
              </defs>
              <rect width="280" height="280" rx="62" fill="url(#swMark)" />
              <g transform="translate(140 140) scale(0.547) translate(-256 -256)">
                <path d="M 352 141 A 150 150 0 1 0 352 371" fill="none" stroke="#FFFFFF" strokeWidth="76" strokeLinecap="round" />
              </g>
            </svg>
            <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
              <span style={{ fontWeight: 800, fontSize: 'clamp(18px,1.4vw,34px)', letterSpacing: '-0.02em' }}>Clubify</span>
              <span style={{ fontSize: 'clamp(12px,.85vw,18px)', color: 'var(--mute)', fontWeight: 500 }}>Ventas en vivo</span>
            </div>
          </div>
          <div style={{ flex: 1 }} />
          <span className="sw-pill" style={{ color: ST[1], background: 'var(--card)', border: '1px solid var(--line)' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: ST[1], color: ST[1], animation: s.status === 'live' ? 'sw-pulse 1.8s infinite' : undefined }} />
            {ST[0]}
            {this.props.demo && <span style={{ marginLeft: 4, background: '#FEF3C7', color: '#92400E', borderRadius: 6, padding: '0 6px' }}>Demo</span>}
          </span>
          {s.soundOn ? (
            <span className="sw-pill" style={{ background: 'var(--venta-soft)', color: 'var(--venta)' }}>🔔 Sonido activo</span>
          ) : (
            <button type="button" className="sw-btn" onClick={this.prepararSonido} style={{ borderColor: '#D97706', color: '#D97706' }}>
              🔈 Toca la pantalla para activar el sonido
            </button>
          )}
          <button type="button" className="sw-btn" onClick={this.cambiarTema} aria-label="Cambiar entre modo claro y oscuro">
            {s.tema === 'oscuro' ? '☀️ Modo claro' : '🌙 Modo oscuro'}
          </button>
          <div style={{ textAlign: 'right', lineHeight: 1.2 }}>
            <div className="sw-num" style={{ fontWeight: 700, fontSize: 'clamp(18px,1.5vw,36px)' }}>{fmtTime.format(new Date(now))}</div>
            <div style={{ fontSize: 'clamp(12px,.85vw,18px)', color: 'var(--mute)' }}>{capital(fmtDate.format(new Date(now)))} · {capital(fmtMonth.format(new Date(now)))}</div>
          </div>
        </header>

        {/* Contadores */}
        <section className="sw-stats" style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 'clamp(12px,1.2vw,28px)' }}>
          <Contador refCard={this.vCardRef} refNum={this.vNumRef} titulo="Ventas nuevas" color="var(--venta)" soft="var(--venta-soft)" icono="venta" valor={s.dV} monto={usdV} hoy={todayEv.filter((e) => e.type === 'venta').length} />
          <Contador refCard={this.rCardRef} refNum={this.rNumRef} titulo="Renovaciones" color="var(--renov)" soft="var(--renov-soft)" icono="renov" valor={s.dR} monto={usdR} hoy={todayEv.filter((e) => e.type === 'renov').length} />
          <div ref={this.tCardRef} className="sw-card" style={{ padding: 'clamp(16px,1.4vw,32px)', display: 'flex', flexDirection: 'column', gap: 'clamp(6px,.6vw,14px)' }}>
            <span className="sw-label">Total del mes</span>
            <div ref={this.tNumRef} className="sw-num" style={{ fontWeight: 800, fontSize: 'clamp(44px,4.6vw,120px)', lineHeight: 1, letterSpacing: '-0.03em', transformOrigin: 'left center' }}>{(s.dV + s.dR).toLocaleString('es-CO')}</div>
            <div className="sw-num" style={{ fontWeight: 700, fontSize: 'clamp(18px,1.5vw,36px)' }}>{fmtUSD(s.dU)}</div>
            <div style={{ display: 'flex', height: 10, borderRadius: 999, overflow: 'hidden', background: 'var(--track)', gap: 3 }}>
              <div style={{ width: pctV + '%', background: 'var(--venta)', borderRadius: 999, transition: 'width .8s ease' }} />
              <div style={{ width: pctR + '%', background: 'var(--renov)', borderRadius: 999, transition: 'width .8s ease' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'clamp(12px,.85vw,18px)', color: 'var(--mute)', fontWeight: 500 }}>
              <span><b style={{ color: 'var(--venta)' }}>{pctV}%</b> ventas</span>
              <span><b style={{ color: 'var(--renov)' }}>{pctR}%</b> renovaciones</span>
            </div>
          </div>
        </section>

        {/* Actividad en vivo */}
        <section className="sw-card" style={{ display: 'flex', alignItems: 'stretch', overflow: 'hidden', height: 'clamp(56px,4.4vw,110px)' }}>
          <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 8, padding: '0 clamp(14px,1.2vw,28px)', background: 'var(--venta-soft)', color: 'var(--venta)', fontWeight: 700, fontSize: 'clamp(13px,.95vw,22px)', whiteSpace: 'nowrap' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--venta)' }} /> Actividad reciente
          </div>
          <div style={{ position: 'relative', flex: 1, minWidth: 0, overflow: 'hidden' }}>
            <div style={{ position: 'absolute', inset: '0 auto 0 0', width: '5vw', background: 'linear-gradient(90deg,var(--card),transparent)', zIndex: 2, pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', inset: '0 0 0 auto', width: '5vw', background: 'linear-gradient(270deg,var(--card),transparent)', zIndex: 2, pointerEvents: 'none' }} />
            {!tick.length && <div style={{ height: '100%', display: 'flex', alignItems: 'center', paddingLeft: '2vw', color: 'var(--mute)', fontSize: 'clamp(13px,.95vw,22px)' }}>Aquí aparecerá cada venta y renovación del mes.</div>}
            <div ref={this.trackRef} style={{ position: 'absolute', top: 0, bottom: 0, left: 0, display: 'flex', alignItems: 'center', whiteSpace: 'nowrap', willChange: 'transform' }}>
              {tick.map((e, i) => {
                const isV = e.type === 'venta';
                return (
                  <div key={i} style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 'clamp(8px,.7vw,16px)', padding: '0 clamp(18px,1.6vw,40px)', borderRight: '1px solid var(--line)', height: '60%', fontSize: 'clamp(14px,1vw,24px)' }}>
                    <span className="sw-pill" style={{ background: isV ? 'var(--venta-soft)' : 'var(--renov-soft)', color: isV ? 'var(--venta)' : 'var(--renov)' }}>{isV ? 'Nueva venta' : 'Renovación'}</span>
                    <span style={{ color: 'var(--ink2)' }}>
                      <b style={{ color: 'var(--ink)' }}>{e.negocio}</b>
                      {e.plan ? ` · ${e.plan}` : ''} · vendido por <b style={{ color: 'var(--ink)' }}>{e.afiliado}</b>
                    </span>
                    <span style={{ color: 'var(--mute)', fontSize: '.85em' }}>{when(e)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Movimientos, meta y ranking */}
        <section className="sw-bottom" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,7fr) minmax(0,5fr)', gap: 'clamp(12px,1.2vw,28px)', alignItems: 'start' }}>
          <div className="sw-card" style={{ overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: 'clamp(14px,1.2vw,28px) clamp(16px,1.4vw,32px)' }}>
              <h2 style={{ margin: 0, fontSize: 'clamp(16px,1.15vw,28px)', fontWeight: 700 }}>Últimos movimientos</h2>
              <span className="sw-label" style={{ fontWeight: 500 }}>Lo más reciente primero</span>
            </div>
            <div>
              {s.events.slice(0, 10).map((e) => {
                const isV = e.type === 'venta';
                const flash = e.id === s.flashId;
                return (
                  <div key={e.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(max-content,auto) minmax(0,1.6fr) minmax(0,1.3fr) minmax(0,1fr) minmax(max-content,auto)', gap: 'clamp(10px,1vw,24px)', alignItems: 'center', padding: 'clamp(10px,.8vw,18px) clamp(16px,1.4vw,32px)', borderTop: '1px solid var(--line)', background: flash ? (isV ? 'var(--venta-soft)' : 'var(--renov-soft)') : 'transparent', transition: 'background 1.2s ease', fontSize: 'clamp(13px,.95vw,22px)' }}>
                    <span className="sw-pill" style={{ background: isV ? 'var(--venta-soft)' : 'var(--renov-soft)', color: isV ? 'var(--venta)' : 'var(--renov)', justifySelf: 'start' }}>{isV ? 'Venta nueva' : 'Renovación'}</span>
                    <span style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={e.negocio}>{e.negocio}</span>
                    <span style={{ color: 'var(--ink2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={e.afiliado}>{e.afiliado}</span>
                    <span className="sw-col-plan" style={{ color: 'var(--mute)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.plan || '—'}</span>
                    <span className="sw-col-hora sw-num" style={{ color: 'var(--mute)', whiteSpace: 'nowrap', textAlign: 'right' }}>{when(e)}</span>
                  </div>
                );
              })}
              {!s.events.length && <div style={{ padding: 'clamp(16px,1.4vw,32px)', color: 'var(--mute)', borderTop: '1px solid var(--line)' }}>Todavía no hay movimientos este mes.</div>}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(12px,1.2vw,28px)' }}>
            <div className="sw-card" style={{ padding: 'clamp(16px,1.4vw,32px)', display: 'flex', flexDirection: 'column', gap: 'clamp(10px,.8vw,18px)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
                <h2 style={{ margin: 0, fontSize: 'clamp(16px,1.15vw,28px)', fontWeight: 700 }}>Meta del mes</h2>
                <span className="sw-num" style={{ color: 'var(--mute)', fontSize: 'clamp(13px,.95vw,22px)' }}>
                  <b style={{ color: 'var(--ink)' }}>{fmtUSD(s.dU)}</b> de {fmtUSD(goal)}
                </span>
              </div>
              <div style={{ height: 'clamp(12px,.9vw,22px)', borderRadius: 999, background: 'var(--track)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: Math.min(100, goalPct) + '%', background: 'linear-gradient(90deg,#4FE83F,#16A34A)', borderRadius: 999, transition: 'width .9s cubic-bezier(.2,.8,.2,1)' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
                <span className="sw-num" style={{ fontWeight: 800, fontSize: 'clamp(24px,2vw,48px)', color: 'var(--venta)' }}>{goalPct}%</span>
                <span style={{ color: 'var(--mute)', fontSize: 'clamp(13px,.95vw,22px)', textAlign: 'right' }}>{remaining > 0 ? `Faltan ${fmtUSD(remaining)}` : '🎉 ¡Meta cumplida!'}</span>
              </div>
            </div>

            <div className="sw-card" style={{ padding: 'clamp(16px,1.4vw,32px)', display: 'flex', flexDirection: 'column', gap: 'clamp(12px,1vw,22px)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
                <h2 style={{ margin: 0, fontSize: 'clamp(16px,1.15vw,28px)', fontWeight: 700 }}>Ranking de afiliados</h2>
                <span style={{ display: 'flex', gap: 12, fontSize: 'clamp(12px,.85vw,18px)', color: 'var(--mute)' }}>
                  <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: 'var(--venta)', marginRight: 5 }} />Ventas</span>
                  <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: 'var(--renov)', marginRight: 5 }} />Renovaciones</span>
                </span>
              </div>
              {rk.map((m, i) => (
                <div key={m.name} style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0,1fr) auto', alignItems: 'center', gap: 'clamp(10px,.8vw,18px)' }}>
                  <span style={{ width: 'clamp(34px,2.4vw,56px)', height: 'clamp(34px,2.4vw,56px)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 'clamp(12px,.85vw,20px)', background: i === 0 ? 'var(--venta)' : 'var(--soft)', color: i === 0 ? '#fff' : 'var(--ink2)' }}>{i === 0 ? '🏆' : iniciales(m.name)}</span>
                  <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span style={{ fontWeight: 600, fontSize: 'clamp(14px,1vw,24px)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.name}</span>
                    <div style={{ display: 'flex', height: 6, gap: 2, borderRadius: 999, overflow: 'hidden', width: Math.max(8, (m.total / top) * 100) + '%', transition: 'width .9s ease' }}>
                      <div style={{ flex: m.v, background: 'var(--venta)' }} />
                      <div style={{ flex: m.r, background: 'var(--renov)' }} />
                    </div>
                  </div>
                  <span style={{ textAlign: 'right', lineHeight: 1.15 }}>
                    <b className="sw-num" style={{ fontSize: 'clamp(16px,1.2vw,30px)' }}>{m.total}</b>
                    <span style={{ display: 'block', fontSize: 'clamp(11px,.75vw,16px)', color: 'var(--mute)' }}>{m.v} ventas · {m.r} renov.</span>
                  </span>
                </div>
              ))}
              {!rk.length && <div style={{ color: 'var(--mute)' }}>Aún no hay operaciones este mes.</div>}
            </div>
          </div>
        </section>

        <canvas ref={this.canvasRef} style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 40 }} />

        {cel && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', background: s.tema === 'oscuro' ? 'rgba(5,10,8,.6)' : 'rgba(15,23,42,.25)', backdropFilter: 'blur(3px)' }}>
            <div ref={this.celRef} className="sw-card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'clamp(8px,.9vw,22px)', padding: 'clamp(28px,3vw,72px) clamp(32px,4vw,110px)', textAlign: 'center', maxWidth: '82vw', borderTop: `6px solid ${celColor}` }}>
              <span style={{ fontSize: 'clamp(40px,4vw,96px)', lineHeight: 1 }}>{cv ? '🎉' : '🤝'}</span>
              <div style={{ fontWeight: 800, fontSize: 'clamp(32px,3.6vw,96px)', letterSpacing: '-0.02em', color: celColor, lineHeight: 1.05 }}>{cv ? '¡Nueva venta!' : '¡Nueva renovación!'}</div>
              <div style={{ fontWeight: 700, fontSize: 'clamp(22px,2.2vw,56px)' }}>{cel.negocio}</div>
              <div style={{ fontSize: 'clamp(16px,1.4vw,36px)', color: 'var(--ink2)' }}>
                Vendido por <b style={{ color: 'var(--ink)' }}>{cel.afiliado}</b>
                {cel.plan ? ` · ${cel.plan}` : ''}
              </div>
              <div style={{ fontSize: 'clamp(15px,1.25vw,32px)', color: 'var(--mute)', textWrap: 'balance' } as React.CSSProperties}>{cv ? MSG_V : MSG_R}</div>
            </div>
          </div>
        )}
      </div>
    );
  }
}

function Contador(props: {
  refCard: React.RefObject<HTMLDivElement>;
  refNum: React.RefObject<HTMLDivElement>;
  titulo: string;
  color: string;
  soft: string;
  icono: 'venta' | 'renov';
  valor: number;
  /** USD del mes de este tipo. */
  monto: number;
  hoy: number;
}) {
  return (
    <div ref={props.refCard} className="sw-card" style={{ padding: 'clamp(16px,1.4vw,32px)', display: 'flex', flexDirection: 'column', gap: 'clamp(6px,.6vw,14px)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <span className="sw-label">{props.titulo}</span>
        <span style={{ width: 'clamp(32px,2.2vw,52px)', height: 'clamp(32px,2.2vw,52px)', borderRadius: 12, background: props.soft, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg viewBox="0 0 24 24" style={{ width: '55%', height: '55%' }} fill="none" stroke={props.color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            {props.icono === 'venta' ? (
              <>
                <polyline points="3,17 9,11 13,15 21,7" />
                <polyline points="15,7 21,7 21,13" />
              </>
            ) : (
              <>
                <path d="M20 12a8 8 0 1 1-2.34-5.66" />
                <polyline points="20,4 20,9 15,9" />
              </>
            )}
          </svg>
        </span>
      </div>
      <div ref={props.refNum} className="sw-num" style={{ fontWeight: 800, fontSize: 'clamp(44px,4.6vw,120px)', lineHeight: 1, letterSpacing: '-0.03em', color: props.color, transformOrigin: 'left center' }}>{props.valor.toLocaleString('es-CO')}</div>
      <div className="sw-num" style={{ fontWeight: 700, fontSize: 'clamp(18px,1.5vw,36px)', color: props.color }}>{fmtUSD(props.monto)}</div>
      <span style={{ fontSize: 'clamp(13px,.9vw,20px)', color: 'var(--mute)' }}>
        {props.hoy > 0 ? <><b style={{ color: props.color }}>+{props.hoy}</b> hoy</> : 'Ninguna hoy todavía'}
      </span>
    </div>
  );
}

export default function SalesWallPage() {
  const [op, setOp] = React.useState<Opciones | null>(null);
  React.useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const meta = Number(q.get('meta'));
    const cada = Number(q.get('cada'));
    let guardado: string | null = null;
    try {
      guardado = localStorage.getItem('sales-wall:tema');
    } catch {}
    const pedido = q.get('tema') ?? guardado;
    const tema: Tema =
      pedido === 'claro' || pedido === 'oscuro'
        ? pedido
        : window.matchMedia?.('(prefers-color-scheme: dark)').matches
          ? 'oscuro'
          : 'claro';
    setOp({
      demo: q.get('demo') === '1',
      meta: Number.isFinite(meta) && meta > 0 ? meta : 4000,
      cada: Number.isFinite(cada) && cada >= 5 ? cada : 15,
      tema,
    });
  }, []);
  if (!op) return <div style={{ minHeight: '100vh', background: '#F4F6F5' }} />;
  return <SalesWall {...op} />;
}
