'use client';
import React from 'react';
import { api } from '@/lib/api';

/**
 * Clubify Sales Wall — la pantalla de ventas para la TV de la oficina.
 *
 * Diseño de Claude Design («Clubify Sales Wall.dc.html», 2026-10-25), pasado
 * a React tal cual. Los datos salen de `GET /admin/sales-wall`: ventas y
 * renovaciones del mes en hora de Bogotá, desde Contabilidad (lo cobrado de
 * verdad, cuadrado con Hotmart). Se consulta cada `?cada=` segundos (15 por
 * defecto) y cada operación nueva dispara la celebración.
 *
 * Opciones por URL, para no tocar código desde la TV:
 *   ?meta=4000    meta mensual en USD (sin ella, la de octubre 2026: 4.000)
 *   ?cada=15      segundos entre consultas
 *   ?demo=1       datos simulados (etiqueta DEMO visible)
 */

const TZ = 'America/Bogota';
const C_V = '#CAFF00';
const C_R = '#5FD4FF';
const MSG_V = '¡Bienvenido a Clubify!';
const MSG_R = '¡Un cliente más que continúa creciendo con Clubify!';
const fmtTime = new Intl.DateTimeFormat('es-CO', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const fmtHM = new Intl.DateTimeFormat('es-CO', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
const fmtDate = new Intl.DateTimeFormat('es-CO', { timeZone: TZ, weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
const fmtDM = new Intl.DateTimeFormat('es-CO', { timeZone: TZ, day: '2-digit', month: 'short' });
const fmtMonth = new Intl.DateTimeFormat('es-CO', { timeZone: TZ, month: 'long', year: 'numeric' });
const fmtKey = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const dayKey = (ts: number) => fmtKey.format(new Date(ts));
const monthKey = (ts: number) => dayKey(ts).slice(0, 7);
const fmtUSD = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

const MONO = "'JetBrains Mono', ui-monospace, monospace";

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
  estado: string;
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
  return {
    id,
    type,
    usd,
    ts: Number.isNaN(ts) ? Date.now() : ts,
    afiliado,
    negocio,
    plan,
    confirmed,
    estado: confirmed ? 'CONFIRMADA' : estadoRaw.toUpperCase().slice(0, 14),
  };
}

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
};
type Opciones = { demo: boolean; meta: number; cada: number };

class SalesWall extends React.Component<Opciones, Estado> {
  state: Estado = { now: Date.now(), status: 'connecting', events: [], ventas: 0, renov: 0, usd: 0, dV: 0, dR: 0, dU: 0, cel: null, soundOn: false, flashId: null };
  vNumRef = React.createRef<HTMLDivElement>();
  rNumRef = React.createRef<HTMLDivElement>();
  tNumRef = React.createRef<HTMLDivElement>();
  vCardRef = React.createRef<HTMLDivElement>();
  rCardRef = React.createRef<HTMLDivElement>();
  tCardRef = React.createRef<HTMLDivElement>();
  glowRef = React.createRef<HTMLDivElement>();
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
    // La primera respuesta trae el mes entero: cuenta, pero no celebra.
    // Las siguientes solo celebran lo que no se había visto.
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
      const col = isV ? C_V : C_R;
      const rgb = isV ? '202,255,0' : '95,212,255';
      this.celRef.current?.animate(
        isV
          ? [{ transform: 'scale(0.6) translateY(40px)', opacity: 0, filter: 'blur(8px)' }, { transform: 'scale(1.06)', opacity: 1, filter: 'blur(0)', offset: 0.6 }, { transform: 'scale(1)', opacity: 1 }]
          : [{ transform: 'translateX(-60px) rotateY(25deg)', opacity: 0 }, { transform: 'translateX(0) rotateY(0)', opacity: 1 }],
        { duration: isV ? 650 : 800, easing: 'cubic-bezier(.2,.9,.25,1.1)' },
      );
      const g = this.glowRef.current;
      if (g) {
        g.style.boxShadow = `inset 0 0 140px rgba(${rgb},0.55), inset 0 0 18px rgba(${rgb},0.9)`;
        g.animate([{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 0.5, offset: 0.5 }, { opacity: 0 }], { duration: 2600, easing: 'ease-out' });
      }
      this.later(() => {
        this.tweenCounts();
        const num = isV ? this.vNumRef.current : this.rNumRef.current;
        const cardEl = isV ? this.vCardRef.current : this.rCardRef.current;
        num?.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.14)', textShadow: `0 0 60px ${col}` }, { transform: 'scale(1)' }], { duration: 900, easing: 'ease-out' });
        this.tNumRef.current?.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.08)' }, { transform: 'scale(1)' }], { duration: 900, easing: 'ease-out' });
        [cardEl, this.tCardRef.current].forEach((c) =>
          c?.animate([{ boxShadow: `0 0 0 0 rgba(${rgb},0)` }, { boxShadow: `0 0 60px 4px rgba(${rgb},0.35), inset 0 0 40px rgba(${rgb},0.12)` }, { boxShadow: `0 0 0 0 rgba(${rgb},0)` }], { duration: 1800, easing: 'ease-out' }),
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
          const a = c.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.94)' }], { duration: 350, easing: 'ease-in', fill: 'forwards' });
          a.onfinish = done;
        } else done();
      }, 6000);
      this.later(() => this.setState({ flashId: null }), 9000);
    });
  }

  burst(type: Tipo) {
    const c = this.canvasRef.current;
    if (!c) return;
    if (!c.width) this.resize();
    const W = c.width;
    const H = c.height;
    const s = W / 1920;
    if (type === 'venta') {
      const cols = ['#CAFF00', '#CAFF00', '#E6FF80', '#FFFFFF', '#7FD000'];
      for (let side = 0; side < 2; side++)
        for (let i = 0; i < 70; i++) {
          const fromLeft = side === 0;
          this.particles.push({ k: 'conf', x: fromLeft ? W * 0.12 : W * 0.88, y: H * 0.62, vx: (fromLeft ? 1 : -1) * (6 + Math.random() * 14) * s, vy: (-10 - Math.random() * 16) * s, g: 0.32 * s, w: (6 + Math.random() * 8) * s, h: (10 + Math.random() * 10) * s, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3, col: pick(cols), life: 1, decay: 0.006 + Math.random() * 0.005 });
        }
      for (let i = 0; i < 40; i++) this.particles.push({ k: 'spark', x: W / 2 + (Math.random() - 0.5) * W * 0.5, y: H / 2 + (Math.random() - 0.5) * H * 0.4, r: (1.5 + Math.random() * 3) * s, col: '#F4FFD0', life: 1, decay: 0.012 + Math.random() * 0.015, delay: Math.random() * 40 });
    } else {
      for (let i = 0; i < 4; i++) this.particles.push({ k: 'ring', x: W / 2, y: H / 2, r: 40 * s, vr: 9 * s, col: C_R, life: 1, decay: 0.011, delay: i * 14 });
      for (let i = 0; i < 70; i++) {
        const a = Math.random() * Math.PI * 2;
        const d = (200 + Math.random() * 500) * s;
        this.particles.push({ k: 'orb', x: W / 2 + Math.cos(a) * d, y: H / 2 + Math.sin(a) * d * 0.6, vx: 0, vy: (-0.6 - Math.random() * 1.6) * s, r: (2 + Math.random() * 4) * s, col: Math.random() < 0.7 ? C_R : '#FFFFFF', life: 1, decay: 0.006 + Math.random() * 0.008, delay: Math.random() * 60 });
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
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 1.4));
      if (p.k === 'conf') {
        p.vy += p.g;
        p.vx *= 0.985;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.scale(1, Math.cos(p.rot * 3));
        ctx.fillStyle = p.col;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      } else if (p.k === 'ring') {
        p.r += p.vr;
        p.vr *= 0.985;
        ctx.strokeStyle = p.col;
        ctx.lineWidth = 3 * p.life + 1;
        ctx.shadowColor = p.col;
        ctx.shadowBlur = 20;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, p.r, p.r * 0.62, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.shadowBlur = 0;
      } else {
        if (p.vy) {
          p.x += p.vx || 0;
          p.y += p.vy;
        }
        ctx.fillStyle = p.col;
        ctx.shadowColor = p.col;
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * (0.6 + 0.4 * Math.sin(p.life * 20)), 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
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
        this.x -= 90 * dt * Math.max(0.5, window.innerWidth / 1920);
        if (half > 0 && -this.x >= half) this.x += half;
        el.style.transform = `translate3d(${this.x}px,0,0)`;
      }
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  /** Los navegadores bloquean el audio hasta que alguien toca la página:
   *  en la TV se pulsa una vez «ACTIVAR SONIDO». */
  toggleSound = () => {
    if (!this.ac) {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (!AC) return;
      this.ac = new AC();
      this.master = this.ac.createGain();
      this.master.gain.value = 0.7;
      this.master.connect(this.ac.destination);
    }
    void this.ac.resume();
    this.setState((s) => ({ soundOn: !s.soundOn }), () => {
      if (this.state.soundOn) this.playSound('venta', true);
    });
  };
  playSound(type: Tipo, force = false) {
    if ((!this.state.soundOn && !force) || !this.ac || !this.master) return;
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
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => note(f, i * 0.085, 0.45, 'triangle', 0.22));
      note(1318.5, 0.34, 1.0, 'sine', 0.12);
      note(1567.98, 0.38, 1.1, 'sine', 0.1);
      note(2093, 0.42, 1.2, 'sine', 0.06);
    } else {
      note(659.25, 0, 1.4, 'sine', 0.24);
      note(1318.5, 0, 0.9, 'sine', 0.05);
      note(987.77, 0.22, 1.6, 'sine', 0.2);
      note(1975.5, 0.22, 1.0, 'sine', 0.04);
    }
  }

  render() {
    const s = this.state;
    const now = s.now;
    const ST = ({ live: ['EN VIVO', C_V], connecting: ['CONECTANDO', '#9BA295'], reconnecting: ['RECONECTANDO', '#FFB020'], offline: ['SIN CONEXIÓN', '#FF5A4D'] } as const)[s.status];
    const total = s.ventas + s.renov;
    const dTotal = s.dV + s.dR;
    const pctV = total ? Math.round((s.ventas / total) * 100) : 0;
    const pctR = total ? 100 - pctV : 0;
    const today = dayKey(now);
    const conf = s.events.filter((e) => e.confirmed);
    const todayEv = conf.filter((e) => dayKey(e.ts) === today);
    const label = (e: Evento) => (e.type === 'venta' ? '¡NUEVA VENTA!' : '¡NUEVA RENOVACIÓN!');
    const when = (e: Evento) => (dayKey(e.ts) === today ? 'Hoy ' : fmtDM.format(new Date(e.ts)) + ' · ') + fmtHM.format(new Date(e.ts));

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
    const period = fmtMonth.format(new Date(now));
    const celColor = cv ? C_V : C_R;
    const celHalo = cv ? 'rgba(202,255,0,0.22)' : 'rgba(95,212,255,0.2)';
    const cols = 'minmax(max-content,1.3fr) 1.6fr 2fr 1.1fr 0.9fr minmax(max-content,1fr)';

    return (
      <div style={{ position: 'relative', width: '100%', height: '100vh', minHeight: 620, display: 'grid', gridTemplateRows: 'auto auto auto minmax(0,1fr)', background: 'radial-gradient(ellipse 80% 60% at 50% -25%, rgba(202,255,0,0.07), transparent 70%), #060708', color: '#F2F4F0', fontFamily: "'Archivo', system-ui, sans-serif", overflow: 'hidden' }}>
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@75..125,400..900&family=JetBrains+Mono:wght@400;600;700&display=swap" />
        <style>{`html,body{margin:0;padding:0;background:#060708;overflow:hidden}*{box-sizing:border-box}@keyframes livepulse{0%{box-shadow:0 0 0 0 currentColor;opacity:1}70%{box-shadow:0 0 0 10px transparent;opacity:.7}100%{box-shadow:0 0 0 0 transparent;opacity:1}}`}</style>

        <div style={{ display: 'flex', flexWrap: 'wrap', rowGap: 10, alignItems: 'center', gap: 'clamp(14px,1.8vw,48px)', padding: 'clamp(12px,1.3vw,32px) clamp(16px,2vw,48px)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/sales-wall/clubify-logo.png" alt="Clubify" style={{ height: 'clamp(22px,2.3vw,60px)', width: 'auto', display: 'block' }} />
          <div style={{ width: 1, height: 'clamp(22px,2.3vw,60px)', background: 'rgba(255,255,255,0.14)' }} />
          <div style={{ fontSize: 'clamp(14px,1.45vw,38px)', fontWeight: 800, fontStretch: '118%', letterSpacing: '0.2em', whiteSpace: 'nowrap' }}>SALES WALL</div>
          <div style={{ flex: 1, minWidth: 0 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 'clamp(6px,0.5vw,12px) clamp(12px,1vw,24px)', border: `1px solid ${ST[1]}55`, borderRadius: 999, background: `${ST[1]}12` }}>
            <div style={{ width: 'clamp(8px,0.6vw,14px)', height: 'clamp(8px,0.6vw,14px)', borderRadius: '50%', background: ST[1], color: ST[1], animation: 'livepulse 1.6s infinite' }} />
            <div style={{ fontFamily: MONO, fontWeight: 700, fontSize: 'clamp(11px,0.9vw,22px)', letterSpacing: '0.14em', color: ST[1], whiteSpace: 'nowrap' }}>{ST[0]}</div>
            {this.props.demo && <div style={{ fontFamily: MONO, fontSize: 'clamp(10px,0.7vw,18px)', letterSpacing: '0.12em', color: '#0B0C0A', background: '#FFB020', padding: '2px 8px', borderRadius: 4, fontWeight: 700 }}>DEMO</div>}
          </div>
          <button onClick={this.toggleSound} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', background: 'transparent', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 999, padding: 'clamp(6px,0.5vw,12px) clamp(12px,1vw,24px)', color: s.soundOn ? C_V : '#9BA295', fontFamily: MONO, fontSize: 'clamp(10px,0.75vw,18px)', letterSpacing: '0.12em', fontWeight: 600, whiteSpace: 'nowrap' }}>
            {s.soundOn ? '♪ SONIDO ON' : 'ACTIVAR SONIDO'}
          </button>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, paddingLeft: 'clamp(10px,1vw,28px)', borderLeft: '1px solid rgba(255,255,255,0.1)' }}>
            <div style={{ fontFamily: MONO, fontSize: 'clamp(10px,0.7vw,18px)', letterSpacing: '0.14em', color: '#7C8378' }}>PERIODO</div>
            <div style={{ fontSize: 'clamp(13px,1.05vw,28px)', fontWeight: 700, letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>{period.toUpperCase()}</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, paddingLeft: 'clamp(10px,1vw,28px)', borderLeft: '1px solid rgba(255,255,255,0.1)' }}>
            <div style={{ fontFamily: MONO, fontWeight: 700, fontSize: 'clamp(18px,1.85vw,48px)', letterSpacing: '0.04em', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{fmtTime.format(new Date(now))}</div>
            <div style={{ fontFamily: MONO, fontSize: 'clamp(10px,0.7vw,18px)', letterSpacing: '0.1em', color: '#7C8378', whiteSpace: 'nowrap' }}>{fmtDate.format(new Date(now)).toUpperCase().replace(/\./g, '')} · BOGOTÁ</div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 'clamp(10px,1.2vw,32px)', padding: 'clamp(12px,1.3vw,32px) clamp(16px,2vw,48px)' }}>
          <Contador refCard={this.vCardRef} refNum={this.vNumRef} titulo="VENTAS DEL MES" color={C_V} borde="rgba(202,255,0,0.18)" fondo="linear-gradient(180deg,#101310,#0B0D0B)" sombra="0 0 40px rgba(202,255,0,0.25)" valor={s.dV.toLocaleString('es-CO')} icono="venta">
            Nuevas ventas confirmadas · <span style={{ color: '#F2F4F0', fontWeight: 700 }}>+{todayEv.filter((e) => e.type === 'venta').length} hoy</span>
          </Contador>
          <Contador refCard={this.rCardRef} refNum={this.rNumRef} titulo="RENOVACIONES DEL MES" color={C_R} borde="rgba(95,212,255,0.18)" fondo="linear-gradient(180deg,#0E1214,#0B0D0E)" sombra="0 0 40px rgba(95,212,255,0.22)" valor={s.dR.toLocaleString('es-CO')} icono="renov">
            Renovaciones confirmadas · <span style={{ color: '#F2F4F0', fontWeight: 700 }}>+{todayEv.filter((e) => e.type === 'renov').length} hoy</span>
          </Contador>
          <div ref={this.tCardRef} style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 'clamp(4px,0.5vw,14px)', padding: 'clamp(14px,1.4vw,36px) clamp(16px,1.6vw,40px)', background: 'linear-gradient(180deg,#111311,#0C0D0C)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 'clamp(10px,0.8vw,20px)', overflow: 'hidden' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '4px 12px' }}>
              <div style={{ fontFamily: MONO, fontSize: 'clamp(11px,0.9vw,24px)', letterSpacing: '0.18em', fontWeight: 700 }}>ACTIVIDAD TOTAL</div>
              <div style={{ fontFamily: MONO, fontSize: 'clamp(10px,0.75vw,20px)', color: '#7C8378', letterSpacing: '0.1em' }}>VENTAS + RENOVACIONES</div>
            </div>
            <div ref={this.tNumRef} style={{ fontFamily: MONO, fontWeight: 700, fontSize: 'clamp(48px,6vw,168px)', lineHeight: 1, fontVariantNumeric: 'tabular-nums', transformOrigin: 'left center' }}>{dTotal.toLocaleString('es-CO')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', height: 'clamp(6px,0.5vw,12px)', borderRadius: 999, overflow: 'hidden', background: 'rgba(255,255,255,0.06)', gap: 2 }}>
                <div style={{ width: total ? pctV + '%' : '0%', background: C_V, transition: 'width 800ms ease' }} />
                <div style={{ width: total ? pctR + '%' : '0%', background: C_R, transition: 'width 800ms ease' }} />
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', justifyContent: 'space-between', fontFamily: MONO, fontSize: 'clamp(10px,0.85vw,22px)', fontWeight: 600 }}>
                <div style={{ color: C_V }}>VENTAS {pctV}%</div>
                <div style={{ color: C_R }}>RENOVACIONES {pctR}%</div>
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'stretch', height: 'clamp(64px,5.4vw,150px)', borderTop: '1px solid rgba(202,255,0,0.22)', borderBottom: '1px solid rgba(202,255,0,0.22)', background: '#090B08' }}>
          <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: '0 clamp(14px,1.4vw,36px)', background: C_V, color: '#0A0B07', fontWeight: 900, fontStretch: '115%', fontSize: 'clamp(12px,1vw,28px)', letterSpacing: '0.14em', whiteSpace: 'nowrap' }}>ACTIVIDAD EN VIVO</div>
          <div style={{ position: 'relative', flex: 1, minWidth: 0, overflow: 'hidden' }}>
            <div style={{ position: 'absolute', inset: '0 auto 0 0', width: '6vw', background: 'linear-gradient(90deg,#090B08,transparent)', zIndex: 2, pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', inset: '0 0 0 auto', width: '6vw', background: 'linear-gradient(270deg,#090B08,transparent)', zIndex: 2, pointerEvents: 'none' }} />
            {!tick.length && <div style={{ height: '100%', display: 'flex', alignItems: 'center', paddingLeft: '2vw', fontFamily: MONO, color: '#7C8378', fontSize: 'clamp(12px,1vw,26px)', letterSpacing: '0.1em' }}>Esperando la primera operación del mes…</div>}
            <div ref={this.trackRef} style={{ position: 'absolute', top: 0, bottom: 0, left: 0, display: 'flex', alignItems: 'center', whiteSpace: 'nowrap', willChange: 'transform' }}>
              {tick.map((e, i) => {
                const isV = e.type === 'venta';
                const color = isV ? C_V : C_R;
                const soft = isV ? 'rgba(202,255,0,0.14)' : 'rgba(95,212,255,0.14)';
                return (
                  <div key={i} style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 'clamp(10px,1vw,26px)', padding: '0 clamp(18px,2vw,52px)', borderRight: '1px solid rgba(255,255,255,0.08)', height: '100%' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 'clamp(26px,2.2vw,58px)', height: 'clamp(26px,2.2vw,58px)', borderRadius: '50%', background: soft, color, fontWeight: 900, fontSize: 'clamp(13px,1.1vw,30px)' }}>{isV ? '★' : '↻'}</div>
                    <div style={{ fontWeight: 900, fontStretch: '112%', fontSize: 'clamp(15px,1.35vw,36px)', letterSpacing: '0.06em', color }}>{label(e)}</div>
                    <div style={{ fontSize: 'clamp(14px,1.2vw,32px)', color: '#9BA295' }}>Afiliado: <span style={{ color: '#F2F4F0', fontWeight: 700 }}>{e.afiliado}</span></div>
                    <div style={{ fontSize: 'clamp(14px,1.2vw,32px)', color: '#9BA295' }}>Negocio: <span style={{ color: '#F2F4F0', fontWeight: 700 }}>{e.negocio}</span></div>
                    {e.plan && <div style={{ fontFamily: MONO, fontSize: 'clamp(11px,0.85vw,22px)', color, border: `1px solid ${soft}`, borderRadius: 4, padding: '3px 8px', letterSpacing: '0.06em' }}>{e.plan}</div>}
                    <div style={{ fontSize: 'clamp(14px,1.15vw,30px)', color, fontStyle: 'italic' }}>{isV ? MSG_V : MSG_R}</div>
                    <div style={{ fontFamily: MONO, fontSize: 'clamp(11px,0.85vw,22px)', color: '#7C8378' }}>{when(e)}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div style={{ minHeight: 0, display: 'grid', gridTemplateColumns: 'minmax(0,7fr) minmax(0,5fr)', gap: 'clamp(10px,1.2vw,32px)', padding: 'clamp(12px,1.3vw,32px) clamp(16px,2vw,48px) clamp(14px,1.5vw,36px)' }}>
          <div style={{ minHeight: 0, display: 'flex', flexDirection: 'column', background: '#0C0E0C', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 'clamp(10px,0.8vw,20px)', overflow: 'hidden' }}>
            <Cabecera titulo="ÚLTIMOS MOVIMIENTOS" nota="MÁS RECIENTE PRIMERO" />
            <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 12, padding: 'clamp(8px,0.6vw,16px) clamp(14px,1.4vw,36px)', fontFamily: MONO, fontSize: 'clamp(9px,0.7vw,18px)', letterSpacing: '0.14em', color: '#646B61' }}>
              <div>TIPO</div><div>AFILIADO</div><div>NEGOCIO</div><div>PLAN</div><div>HORA</div><div style={{ textAlign: 'right' }}>ESTADO</div>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              {s.events.slice(0, 12).map((e) => {
                const isV = e.type === 'venta';
                const color = isV ? C_V : C_R;
                const flash = e.id === s.flashId;
                return (
                  <div key={e.id} style={{ display: 'grid', gridTemplateColumns: cols, gap: 12, alignItems: 'center', padding: 'clamp(8px,0.75vw,20px) clamp(14px,1.4vw,36px)', borderTop: '1px solid rgba(255,255,255,0.05)', background: flash ? (isV ? 'rgba(202,255,0,0.09)' : 'rgba(95,212,255,0.09)') : 'transparent', transition: 'background 1.2s ease' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                      <div style={{ flex: 'none', width: 'clamp(7px,0.5vw,12px)', height: 'clamp(7px,0.5vw,12px)', borderRadius: isV ? '50%' : 2, background: color }} />
                      <div style={{ fontWeight: 800, fontSize: 'clamp(12px,0.95vw,26px)', letterSpacing: '0.04em', color, whiteSpace: 'nowrap' }}>{isV ? 'VENTA NUEVA' : 'RENOVACIÓN'}</div>
                    </div>
                    <div style={{ fontSize: 'clamp(13px,1vw,28px)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.afiliado}</div>
                    <div style={{ fontSize: 'clamp(13px,1vw,28px)', color: '#C9CEC4', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.negocio}</div>
                    <div style={{ fontFamily: MONO, fontSize: 'clamp(11px,0.8vw,22px)', color: '#9BA295', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.plan || '—'}</div>
                    <div style={{ fontFamily: MONO, fontSize: 'clamp(12px,0.9vw,24px)', color: '#C9CEC4', fontVariantNumeric: 'tabular-nums' }}>{when(e)}</div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <div style={{ fontFamily: MONO, fontSize: 'clamp(10px,0.72vw,20px)', fontWeight: 700, letterSpacing: '0.08em', color: e.confirmed ? color : '#FFB020', border: `1px solid ${e.confirmed ? (isV ? 'rgba(202,255,0,0.35)' : 'rgba(95,212,255,0.35)') : 'rgba(255,176,32,0.4)'}`, borderRadius: 4, padding: '3px 8px', whiteSpace: 'nowrap' }}>{e.estado}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ minHeight: 0, display: 'grid', gridTemplateRows: 'auto minmax(0,1fr)', gap: 'clamp(10px,1.2vw,32px)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(8px,0.7vw,18px)', padding: 'clamp(12px,1.2vw,30px) clamp(14px,1.4vw,36px)', background: '#0C0E0C', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 'clamp(10px,0.8vw,20px)' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: '4px 12px' }}>
                <div style={{ fontFamily: MONO, fontSize: 'clamp(11px,0.9vw,24px)', letterSpacing: '0.18em', fontWeight: 700 }}>META MENSUAL · USD</div>
                <div style={{ fontFamily: MONO, fontSize: 'clamp(12px,0.95vw,26px)', color: '#9BA295' }}><span style={{ color: '#F2F4F0', fontWeight: 700 }}>{fmtUSD(s.dU)}</span> / {fmtUSD(goal)}</div>
              </div>
              <div style={{ position: 'relative', height: 'clamp(12px,1vw,26px)', borderRadius: 999, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', inset: '0 auto 0 0', width: Math.min(100, goalPct) + '%', background: 'linear-gradient(90deg,#7FB300,#CAFF00)', borderRadius: 999, boxShadow: '0 0 24px rgba(202,255,0,0.45)', transition: 'width 900ms cubic-bezier(.2,.8,.2,1)' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
                <div style={{ fontFamily: MONO, fontWeight: 700, fontSize: 'clamp(20px,1.9vw,52px)', color: C_V }}>{goalPct}%</div>
                <div style={{ fontSize: 'clamp(12px,0.95vw,26px)', color: '#9BA295', textAlign: 'right' }}>{remaining > 0 ? `Faltan ${fmtUSD(remaining)} USD` : '¡Meta superada!'}</div>
              </div>
            </div>
            <div style={{ minHeight: 0, display: 'flex', flexDirection: 'column', background: '#0C0E0C', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 'clamp(10px,0.8vw,20px)', overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'clamp(10px,1vw,26px) clamp(14px,1.4vw,36px)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                <div style={{ fontFamily: MONO, fontSize: 'clamp(11px,0.9vw,24px)', letterSpacing: '0.18em', fontWeight: 700 }}>RANKING DE AFILIADOS</div>
                <div style={{ display: 'flex', gap: 14, fontFamily: MONO, fontSize: 'clamp(9px,0.7vw,18px)', letterSpacing: '0.1em' }}><div style={{ color: C_V }}>■ VENTAS</div><div style={{ color: C_R }}>■ RENOV.</div></div>
              </div>
              <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'space-evenly', padding: 'clamp(4px,0.4vw,10px) clamp(14px,1.4vw,36px)' }}>
                {rk.map((m, i) => (
                  <div key={m.name} style={{ display: 'grid', gridTemplateColumns: 'clamp(26px,2vw,52px) minmax(0,1fr) auto', alignItems: 'center', gap: 'clamp(8px,0.8vw,20px)' }}>
                    <div style={{ fontFamily: MONO, fontWeight: 700, fontSize: 'clamp(14px,1.2vw,32px)', color: i === 0 ? C_V : '#646B61' }}>{String(i + 1).padStart(2, '0')}</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
                      <div style={{ fontSize: 'clamp(13px,1.05vw,28px)', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.name}</div>
                      <div style={{ display: 'flex', height: 'clamp(4px,0.35vw,9px)', gap: 2, borderRadius: 999, overflow: 'hidden', width: Math.max(6, (m.total / top) * 100) + '%', transition: 'width 900ms ease' }}>
                        <div style={{ flex: m.v, background: C_V }} />
                        <div style={{ flex: m.r, background: C_R }} />
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, fontFamily: MONO }}>
                      <div style={{ fontSize: 'clamp(10px,0.75vw,20px)', color: '#7C8378', whiteSpace: 'nowrap' }}>{m.v}V · {m.r}R</div>
                      <div style={{ fontWeight: 700, fontSize: 'clamp(16px,1.35vw,36px)', minWidth: '2ch', textAlign: 'right' }}>{m.total}</div>
                    </div>
                  </div>
                ))}
                {!rk.length && <div style={{ fontFamily: MONO, color: '#7C8378', fontSize: 'clamp(12px,0.9vw,24px)' }}>Sin operaciones confirmadas este mes.</div>}
              </div>
            </div>
          </div>
        </div>

        <div ref={this.glowRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', opacity: 0, zIndex: 20 }} />
        <canvas ref={this.canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 40 }} />

        {cel && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', background: `radial-gradient(ellipse 60% 55% at 50% 50%, ${celHalo}, rgba(6,7,8,0.82) 70%)` }}>
            <div ref={this.celRef} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'clamp(8px,1vw,28px)', padding: 'clamp(24px,3vw,80px) clamp(32px,5vw,140px)', background: 'rgba(10,12,10,0.92)', border: `1px solid ${celColor}`, borderRadius: 'clamp(14px,1.4vw,36px)', boxShadow: `0 0 80px ${celHalo}, inset 0 0 60px rgba(255,255,255,0.02)`, textAlign: 'center', maxWidth: '80vw' }}>
              <div style={{ fontFamily: MONO, fontSize: 'clamp(11px,0.95vw,26px)', letterSpacing: '0.3em', color: '#9BA295' }}>{fmtTime.format(new Date(cel.ts))} · {cv ? 'VENTA NUEVA' : 'RENOVACIÓN'}</div>
              <div style={{ fontWeight: 900, fontStretch: '120%', fontSize: 'clamp(40px,5.4vw,150px)', lineHeight: 0.95, letterSpacing: '0.02em', color: celColor, textShadow: `0 0 50px ${celHalo}` }}>{label(cel)}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(4px,0.4vw,12px)', marginTop: 'clamp(6px,0.6vw,16px)' }}>
                <div style={{ fontSize: 'clamp(18px,2.2vw,60px)', color: '#9BA295' }}>Afiliado: <span style={{ color: '#F2F4F0', fontWeight: 800 }}>{cel.afiliado}</span></div>
                <div style={{ fontSize: 'clamp(18px,2.2vw,60px)', color: '#9BA295' }}>Negocio: <span style={{ color: '#F2F4F0', fontWeight: 800 }}>{cel.negocio}</span></div>
              </div>
              {cel.plan && <div style={{ fontFamily: MONO, fontSize: 'clamp(12px,1vw,28px)', letterSpacing: '0.12em', color: celColor, border: `1px solid ${celColor}`, borderRadius: 6, padding: '6px 14px' }}>{cel.plan}</div>}
              <div style={{ fontSize: 'clamp(16px,1.7vw,46px)', fontStyle: 'italic', color: celColor, marginTop: 'clamp(4px,0.5vw,14px)', textWrap: 'balance' } as React.CSSProperties}>{cv ? MSG_V : MSG_R}</div>
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
  borde: string;
  fondo: string;
  sombra: string;
  valor: string;
  icono: 'venta' | 'renov';
  children: React.ReactNode;
}) {
  return (
    <div ref={props.refCard} style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 'clamp(4px,0.5vw,14px)', padding: 'clamp(14px,1.4vw,36px) clamp(16px,1.6vw,40px)', background: props.fondo, border: `1px solid ${props.borde}`, borderRadius: 'clamp(10px,0.8vw,20px)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ fontFamily: MONO, fontSize: 'clamp(11px,0.9vw,24px)', letterSpacing: '0.18em', color: props.color, fontWeight: 700 }}>{props.titulo}</div>
        <svg viewBox="0 0 24 24" style={{ width: 'clamp(20px,1.7vw,44px)', height: 'clamp(20px,1.7vw,44px)' }} fill="none" stroke={props.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
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
      </div>
      <div ref={props.refNum} style={{ fontFamily: MONO, fontWeight: 700, fontSize: 'clamp(48px,6vw,168px)', lineHeight: 1, color: props.color, fontVariantNumeric: 'tabular-nums', textShadow: props.sombra, transformOrigin: 'left center' }}>{props.valor}</div>
      <div style={{ fontSize: 'clamp(12px,0.95vw,26px)', color: '#9BA295' }}>{props.children}</div>
    </div>
  );
}

function Cabecera({ titulo, nota }: { titulo: string; nota: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'clamp(10px,1vw,26px) clamp(14px,1.4vw,36px)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
      <div style={{ fontFamily: MONO, fontSize: 'clamp(11px,0.9vw,24px)', letterSpacing: '0.18em', fontWeight: 700 }}>{titulo}</div>
      <div style={{ fontFamily: MONO, fontSize: 'clamp(10px,0.75vw,20px)', color: '#7C8378', letterSpacing: '0.1em' }}>{nota}</div>
    </div>
  );
}

export default function SalesWallPage() {
  const [op, setOp] = React.useState<Opciones | null>(null);
  React.useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const meta = Number(q.get('meta'));
    const cada = Number(q.get('cada'));
    setOp({
      demo: q.get('demo') === '1',
      meta: Number.isFinite(meta) && meta > 0 ? meta : 4000,
      cada: Number.isFinite(cada) && cada >= 5 ? cada : 15,
    });
  }, []);
  if (!op) return <div style={{ height: '100vh', background: '#060708' }} />;
  return <SalesWall {...op} />;
}
