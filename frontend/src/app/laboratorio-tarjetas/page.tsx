'use client';
/**
 * Laboratorio de estilos de tarjeta.
 *
 * Panel de PRUEBA: nada de lo que se toca aquí se guarda ni llega a un pase.
 *
 * Vive FUERA de /app y /admin a propósito: el AppShell de /app manda a /admin a
 * SUPER_ADMIN y MARKETING, y quien prueba estilos es justo el equipo. Como no
 * llama a la API ni guarda nada, no necesita sesión ni negocio.
 * Sirve para probar cómo se vería la franja central con otros estilos (taza,
 * anillo, porciones, camino de premios…) antes de decidir cuáles pasan al
 * generador real del backend (`generateStampsStrip`).
 *
 * Las imágenes (portada, ícono propio) se leen como data URL en el navegador y
 * no se suben a ningún lado: es un banco de pruebas, no un editor.
 */
import { useMemo, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { StampIconPicker } from '@/components/StampIconPicker';
import {
  ALTO,
  ANCHO,
  ESTILOS,
  LETRAS,
  NIVELES_POR_DEFECTO,
  PALETAS,
  dibujarFranja,
  fraseDeFaltan,
  svgComoDataUrl,
  type ConfigFranja,
  type EstiloFranja,
  type Letra,
  type Nivel,
  type Porcion,
  type Recipiente,
  type PremioIntermedio,
} from '@/lib/cards/estilos-de-franja';
import { EditorDeAcomodo } from './EditorDeAcomodo';
import { InstalarEnCelular } from './InstalarEnCelular';
import { PruebasInstaladas } from './PruebasInstaladas';

type Plataforma = 'APPLE' | 'GOOGLE' | 'SAMSUNG';
type Pestana = 'ESTILO' | 'COLORES' | 'DATOS';

const INICIAL: ConfigFranja = {
  estilo: 'SELLOS',
  ...{ fondo: '#1A1033', texto: '#FFF6F0', sello: '#F4B6A6', area: '#2A2047' },
  requeridos: 10,
  sellados: 6,
  premio: 'Masaje gratis',
  unidad: 'visitas',
  emoji: '💆',
  iconoImagen: null,
  portada: null,
  portadaDetrasDeSellos: false,
  numerarVacios: false,
  premiosIntermedios: [{ pos: 5, texto: 'Mascarilla' }],
  niveles: [
    { nombre: 'Plata', desde: 0, beneficio: '5 % en servicios' },
    { nombre: 'Oro', desde: 300, beneficio: '10 % y bebida de cortesía' },
    { nombre: 'Platino', desde: 600, beneficio: '15 % y prioridad en agenda' },
  ],
  acomodo: 'ENCIMADO',
  gastado: 152,
  saldo: 12.6,
  porcentaje: 5,
  moneda: '$',
};

function leerArchivo(f: File): Promise<string> {
  return new Promise((ok, mal) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => mal(r.error);
    r.readAsDataURL(f);
  });
}

/** Lo que dice el campo de arriba a la derecha del pase, según el estilo. */
function campoCabecera(c: ConfigFranja): { etiqueta: string; valor: string } {
  if (c.estilo === 'SALDO') return { etiqueta: 'SALDO', valor: `${c.moneda ?? '$'}${(c.saldo ?? 0).toFixed(2)}` };
  if (c.estilo === 'VIP') {
    const n = (c.niveles?.length ? c.niveles : NIVELES_POR_DEFECTO).slice().sort((a, b) => a.desde - b.desde);
    let k = 0;
    n.forEach((x, i) => {
      if ((c.gastado ?? 0) >= x.desde) k = i;
    });
    return { etiqueta: 'NIVEL', valor: n[k].nombre };
  }
  return { etiqueta: c.unidad.toUpperCase(), valor: `${c.sellados}/${c.requeridos}` };
}

export default function LaboratorioDeTarjetas() {
  const [c, setC] = useState<ConfigFranja>(INICIAL);
  const [negocio, setNegocio] = useState('Spa Rocío');
  const [titular, setTitular] = useState('Rocío');
  const [logo, setLogo] = useState<string | null>(null);
  const [pestana, setPestana] = useState<Pestana>('ESTILO');
  const [plataforma, setPlataforma] = useState<Plataforma>('APPLE');
  const [comparar, setComparar] = useState(false);
  const [instaladas, setInstaladas] = useState(false);
  /** Sube al crear una prueba, para que la lista se recargue. */
  const [versionDePruebas, setVersionDePruebas] = useState(0);

  const set = (p: Partial<ConfigFranja>) => setC((prev) => ({ ...prev, ...p }));

  const svg = useMemo(() => dibujarFranja(c), [c]);
  const franja = useMemo(() => svgComoDataUrl(svg), [svg]);

  const descargarPng = async () => {
    // 960×369 = el strip@3x de Apple: el tamaño más exigente del pase.
    const img = new Image();
    img.src = franja;
    await img.decode();
    const lienzo = document.createElement('canvas');
    lienzo.width = 960;
    lienzo.height = 369;
    lienzo.getContext('2d')!.drawImage(img, 0, 0, 960, 369);
    const a = document.createElement('a');
    a.href = lienzo.toDataURL('image/png');
    a.download = `franja-${c.estilo.toLowerCase()}.png`;
    a.click();
  };

  return (
    <main className="min-h-screen bg-bg2/60 px-4 py-6 sm:px-8">
    <div className="mx-auto max-w-[1280px] space-y-4 fade-enter">
      <div>
        <h1 className="page-title leading-tight m-0">Laboratorio de tarjetas</h1>
        <p className="text-[13px] text-mute m-0 mt-0.5">
          Prueba estilos de tarjeta. El diseño no se guarda; las pruebas que instalas sí, para darles sellos.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-100 text-amber-800">
          Modo prueba · no toca ningún negocio
        </span>
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              setInstaladas((v) => !v);
              setComparar(false);
            }}
          >
            {instaladas ? 'Volver al editor' : 'Pruebas instaladas'}
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              setComparar((v) => !v);
              setInstaladas(false);
            }}
          >
            {comparar ? 'Volver al editor' : 'Comparar todos los estilos'}
          </button>
          <button type="button" className="btn-ghost" onClick={descargarPng}>
            Descargar franja (PNG)
          </button>
          <InstalarEnCelular
            c={c}
            negocio={negocio}
            titular={titular}
            onCreada={() => setVersionDePruebas((v) => v + 1)}
          />
        </div>
      </div>

      {instaladas ? (
        <PruebasInstaladas version={versionDePruebas} />
      ) : comparar ? (
        <Comparador c={c} onElegir={(e) => { set({ estilo: e }); setComparar(false); }} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px] items-start">
          <section className="card card-pad space-y-5">
            <div role="tablist" className="bg-bg2 rounded-full p-0.5 inline-flex text-sm font-semibold">
              {(
                [
                  ['ESTILO', 'Estilo'],
                  ['COLORES', 'Colores e ícono'],
                  ['DATOS', 'Datos de prueba'],
                ] as const
              ).map(([id, txt]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={pestana === id}
                  onClick={() => setPestana(id)}
                  className={`px-4 py-1.5 rounded-full transition ${pestana === id ? 'bg-white text-ink shadow-sm' : 'text-mute hover:text-ink'}`}
                >
                  {txt}
                </button>
              ))}
            </div>

            {pestana === 'ESTILO' && <PestanaEstilo c={c} set={set} />}
            {pestana === 'COLORES' && <PestanaColores c={c} set={set} />}
            {pestana === 'DATOS' && (
              <PestanaDatos
                c={c}
                set={set}
                negocio={negocio}
                setNegocio={setNegocio}
                titular={titular}
                setTitular={setTitular}
                logo={logo}
                setLogo={setLogo}
              />
            )}
          </section>

          <aside className="card card-pad space-y-3 lg:sticky lg:top-4">
            <div className="text-xs text-mute">Así se ve en el celular</div>
            <div role="tablist" className="bg-bg2 rounded-full p-0.5 flex text-xs font-semibold">
              {(['APPLE', 'GOOGLE', 'SAMSUNG'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  role="tab"
                  aria-selected={plataforma === p}
                  onClick={() => setPlataforma(p)}
                  className={`flex-1 px-3 py-1.5 rounded-full transition ${plataforma === p ? 'bg-white text-ink shadow-sm' : 'text-mute hover:text-ink'}`}
                >
                  {p === 'APPLE' ? 'Apple' : p === 'GOOGLE' ? 'Google' : 'Samsung'}
                </button>
              ))}
            </div>

            <Telefono>
              <Pase c={c} franja={franja} plataforma={plataforma} negocio={negocio} titular={titular} logo={logo} />
            </Telefono>

            <ControlDeProgreso c={c} set={set} />
          </aside>
        </div>
      )}
    </div>
    </main>
  );
}

/* ───────────────────────── pestañas ───────────────────────── */

function PestanaEstilo({ c, set }: { c: ConfigFranja; set: (p: Partial<ConfigFranja>) => void }) {
  return (
    <div className="space-y-4">
      <div>
        <div className="text-sm font-semibold">Estilo de la tarjeta</div>
        <p className="text-xs text-mute mt-0.5">
          Cada miniatura ya usa tus colores y tus datos: lo que ves es lo que verá tu cliente.
        </p>
      </div>
      <div className="grid grid-cols-2 xl:grid-cols-3 gap-2.5">
        {ESTILOS.map((e) => {
          const activo = c.estilo === e.id;
          return (
            <button
              key={e.id}
              type="button"
              onClick={() => set({ estilo: e.id })}
              className={`text-left rounded-card overflow-hidden border-2 transition bg-surface ${
                activo ? 'border-brand shadow-md' : 'border-line hover:border-brand/40'
              }`}
            >
              <Miniatura c={{ ...c, estilo: e.id }} />
              <div className="px-2.5 py-2">
                <div className="text-sm font-semibold flex items-center gap-1.5">
                  {e.nombre}
                  {e.nuevo && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-brand-soft text-brand">Nuevo</span>
                  )}
                </div>
                <div className="text-[11px] text-mute leading-snug">{e.ayuda}</div>
              </div>
            </button>
          );
        })}
      </div>

      <OpcionesDelEstilo c={c} set={set} />
    </div>
  );
}

/**
 * Lo que cambia según el estilo elegido, como en Sellea: cada estilo trae sus
 * propias perillas (acomodo en «Tu producto», recipiente en la taza…). La
 * letra la comparten todos los que llevan texto grande.
 */
function OpcionesDelEstilo({ c, set }: { c: ConfigFranja; set: (p: Partial<ConfigFranja>) => void }) {
  const conTexto = c.estilo !== 'SELLOS' && c.estilo !== 'PRODUCTO' && c.estilo !== 'PERFORADA';
  const niveles = c.niveles ?? [];
  const setNivel = (i: number, p: Partial<Nivel>) => set({ niveles: niveles.map((x, k) => (k === i ? { ...x, ...p } : x)) });

  return (
    <div className="space-y-4">
      {c.estilo === 'SELLOS' && (
        <div className="space-y-2 pt-3 border-t border-line">
          <Interruptor
            on={!!c.numerarVacios}
            onChange={(v) => set({ numerarVacios: v })}
            titulo="Numerar los sellos vacíos"
            ayuda="En vez del ícono apagado, el número que le toca: se lee de un vistazo cuánto falta."
          />
          <Interruptor
            on={!!c.portadaDetrasDeSellos}
            onChange={(v) => set({ portadaDetrasDeSellos: v })}
            titulo="Foto de portada detrás de los sellos"
            ayuda={c.portada ? 'Con un velo oscuro para que los sellos se lean.' : 'Primero sube una portada en «Colores e ícono».'}
          />
        </div>
      )}

      {c.estilo === 'PRODUCTO' && <EditorDeAcomodo c={c} set={set} />}

      {c.estilo === 'FOTO_NUMERO' && (
        <div className="pt-3 border-t border-line">
          <div className="text-sm font-semibold">Foto de la franja</div>
          <p className="text-xs text-mute mb-1">
            Una foto del negocio. Va a la derecha y se funde con el color del área, donde va el número. Ideal 1200 × 460.
          </p>
          <ArchivoLocal
            etiqueta={c.portada ? 'Cambiar foto' : 'Subir foto'}
            onArchivo={(url) => set({ portada: url })}
            onQuitar={c.portada ? () => set({ portada: null }) : undefined}
          />
        </div>
      )}

      {c.estilo === 'PORCIONES' && (
        <div className="pt-3 border-t border-line">
          <div className="text-sm font-semibold mb-2">Qué se reparte</div>
          <Segmentos
            opciones={[
              { id: 'PIZZA', txt: 'Pizza' },
              { id: 'TORTA', txt: 'Torta' },
              { id: 'LISA', txt: 'Lisa' },
            ]}
            valor={c.porcion ?? 'PIZZA'}
            onChange={(v) => set({ porcion: v as Porcion })}
          />
          <p className="text-xs text-mute mt-1.5">
            Pizza trae sus colores (masa, queso, pepperoni). Torta y Lisa usan el color de «Sellos».
          </p>
        </div>
      )}

      {c.estilo === 'TAZA' && (
        <div className="pt-3 border-t border-line">
          <div className="text-sm font-semibold mb-2">Recipiente</div>
          <Segmentos
            opciones={[
              { id: 'TAZA', txt: 'Taza' },
              { id: 'POCILLO', txt: 'Pocillo' },
              { id: 'PARA_LLEVAR', txt: 'Para llevar' },
              { id: 'VASO', txt: 'Vaso' },
              { id: 'FRAPPE', txt: 'Frappé' },
              { id: 'JARRA', txt: 'Jarra' },
              { id: 'COPA', txt: 'Copa' },
              { id: 'CONO', txt: 'Cono de pizza' },
            ]}
            valor={c.recipiente ?? 'TAZA'}
            onChange={(v) => set({ recipiente: v as Recipiente })}
          />
          <p className="text-xs text-mute mt-1.5">
            {c.recipiente === 'CONO'
              ? 'El cono lleva sus colores de pizza: masa, queso y pepperoni. Al completarse, el queso desborda.'
              : `El color de «Sellos» es el del líquido. ${
                  {
                    TAZA: 'Al completarse, echa vapor.',
                    POCILLO: 'El tinto con su plato; al completarse, echa vapor.',
                    PARA_LLEVAR: 'Vaso de cartón con tapa y faja; al completarse, echa vapor.',
                    VASO: 'Con pajilla, para bebidas frías.',
                    FRAPPE: 'Con hielo y pajilla; al completarse, se corona de crema.',
                    JARRA: 'Con espuma; al completarse, la espuma desborda.',
                    COPA: 'Copa de cóctel; al completarse, lleva su rodaja de limón.',
                  }[c.recipiente ?? 'TAZA'] ?? ''
                }`}
          </p>
        </div>
      )}

      {c.estilo === 'VIP' && (
        <div className="pt-3 border-t border-line">
          <div className="text-sm font-semibold mb-2">Niveles</div>
          <div className="grid grid-cols-[1fr_90px_1.4fr_32px] gap-2 text-[11px] text-mute mb-1">
            <span>Nivel</span>
            <span>Desde ($)</span>
            <span>Beneficio</span>
            <span />
          </div>
          <div className="space-y-2">
            {niveles.map((n, i) => (
              <div key={i} className="grid grid-cols-[1fr_90px_1.4fr_32px] gap-2 items-center">
                <input className="input" value={n.nombre} onChange={(e) => setNivel(i, { nombre: e.target.value })} />
                <input
                  type="number"
                  min={0}
                  className="input"
                  value={n.desde}
                  onChange={(e) => setNivel(i, { desde: Number(e.target.value) })}
                />
                <input
                  className="input"
                  placeholder="Ej.: 10 % en todo"
                  value={n.beneficio ?? ''}
                  onChange={(e) => setNivel(i, { beneficio: e.target.value })}
                />
                <button
                  type="button"
                  aria-label={`Quitar el nivel ${n.nombre}`}
                  disabled={niveles.length <= 1}
                  className="text-mute hover:text-bad disabled:opacity-30"
                  onClick={() => set({ niveles: niveles.filter((_, k) => k !== i) })}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="btn-link text-sm mt-2"
            onClick={() => {
              const ultimo = niveles[niveles.length - 1]?.desde ?? 0;
              set({ niveles: [...niveles, { nombre: 'Nuevo nivel', desde: ultimo + 300 }] });
            }}
          >
            + Agregar nivel
          </button>
          <p className="text-xs text-mute mt-1">
            Suben solos según lo que el cliente lleva gastado. El beneficio del nivel actual sale bajo el nombre.
          </p>
          <Campo label={`Gastado por el cliente de ejemplo: $${c.gastado ?? 0}`}>
            <input
              type="range"
              min={0}
              max={Math.round(Math.max(100, ...niveles.map((n) => n.desde)) * 1.2)}
              value={c.gastado ?? 0}
              onChange={(e) => set({ gastado: Number(e.target.value) })}
              className="w-full accent-brand mt-2"
            />
          </Campo>
        </div>
      )}

      {c.estilo === 'SALDO' && (
        <div className="pt-3 border-t border-line grid grid-cols-2 gap-3">
          <Campo label="% de cada compra que vuelve como saldo">
            <input
              type="number"
              min={0}
              max={100}
              className="input"
              value={c.porcentaje ?? 0}
              onChange={(e) => set({ porcentaje: Number(e.target.value) })}
            />
          </Campo>
          <Campo label="Saldo del cliente de ejemplo">
            <input
              type="number"
              step="0.01"
              className="input"
              value={c.saldo ?? 0}
              onChange={(e) => set({ saldo: Number(e.target.value) })}
            />
          </Campo>
        </div>
      )}

      {conTexto && (
        <div className="pt-3 border-t border-line">
          <div className="text-sm font-semibold mb-2">Letra de la franja</div>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(LETRAS) as Letra[]).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => set({ letra: l })}
                className={`rounded-input border-2 px-3 py-2 text-left transition ${
                  (c.letra ?? 'MODERNA') === l ? 'border-brand bg-brand-soft' : 'border-line hover:border-brand/40'
                }`}
              >
                <span
                  className="block text-xl leading-none"
                  style={{ fontFamily: LETRAS[l].familia, textTransform: l === 'IMPACTO' ? 'uppercase' : undefined }}
                >
                  6 de 10
                </span>
                <span className="block text-[11px] text-mute mt-1">{LETRAS[l].nombre}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Segmentos({
  opciones,
  valor,
  onChange,
}: {
  opciones: Array<{ id: string; txt: string }>;
  valor: string;
  onChange: (v: string) => void;
}) {
  return (
    // Con muchas opciones (los 8 recipientes) la fila se parte en dos: una
    // píldora redonda partida se ve rota, así que pasa a esquinas suaves.
    <div
      className={`bg-bg2 ${opciones.length > 4 ? 'rounded-2xl' : 'rounded-full'} p-0.5 inline-flex flex-wrap text-xs font-semibold`}
    >
      {opciones.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={`px-3 py-1.5 rounded-full transition ${valor === o.id ? 'bg-white text-ink shadow-sm' : 'text-mute hover:text-ink'}`}
        >
          {o.txt}
        </button>
      ))}
    </div>
  );
}

function PestanaColores({ c, set }: { c: ConfigFranja; set: (p: Partial<ConfigFranja>) => void }) {
  const paletaActiva = PALETAS.find(
    (p) =>
      [p.fondo, p.texto, p.sello, p.area].join().toLowerCase() === [c.fondo, c.texto, c.sello, c.area].join().toLowerCase(),
  )?.id;
  return (
    <div className="space-y-5">
      <div>
        <div className="text-sm font-semibold mb-2">Estilos listos</div>
        <div className="grid grid-cols-3 sm:grid-cols-4 xl:grid-cols-6 gap-2">
          {PALETAS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => set({ fondo: p.fondo, texto: p.texto, sello: p.sello, area: p.area })}
              className={`rounded-input overflow-hidden border-2 text-left transition ${
                paletaActiva === p.id ? 'border-brand' : 'border-line hover:border-brand/40'
              }`}
            >
              <div className="h-5" style={{ background: p.sello }} />
              <div className="px-2 py-1.5 flex gap-1" style={{ background: p.area }}>
                {[p.fondo, p.sello, p.texto].map((x, i) => (
                  <span key={i} className="w-2.5 h-2.5 rounded-full border border-white/40" style={{ background: x }} />
                ))}
              </div>
              <div className="px-2 py-1 text-[11px] font-medium">{p.nombre}</div>
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="text-sm font-semibold mb-2">Colores</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Color label="Fondo" valor={c.fondo} onChange={(v) => set({ fondo: v })} />
          <Color label="Texto" valor={c.texto} onChange={(v) => set({ texto: v })} />
          <Color label="Sellos" valor={c.sello} onChange={(v) => set({ sello: v })} />
          <Color label="Área de sellos" valor={c.area} onChange={(v) => set({ area: v })} />
        </div>
      </div>

      <div>
        <div className="text-sm font-semibold mb-2">Ícono del sello</div>
        <StampIconPicker value={c.emoji} onSelect={(e) => set({ emoji: e, iconoImagen: null })} />
        <ArchivoLocal
          etiqueta={c.iconoImagen ? 'Cambiar ícono propio' : 'Probar con tu ícono propio (PNG)'}
          onArchivo={(url) => set({ iconoImagen: url })}
          onQuitar={c.iconoImagen ? () => set({ iconoImagen: null }) : undefined}
        />
      </div>

      <div>
        <div className="text-sm font-semibold mb-1">Imagen de portada</div>
        <p className="text-xs text-mute mb-2">Fondo de «Foto + número» y, si lo activas, detrás de los sellos. Ideal 1200 × 460.</p>
        <ArchivoLocal
          etiqueta={c.portada ? 'Cambiar portada' : 'Subir portada'}
          onArchivo={(url) => set({ portada: url })}
          onQuitar={c.portada ? () => set({ portada: null }) : undefined}
        />
      </div>
    </div>
  );
}

function PestanaDatos(props: {
  c: ConfigFranja;
  set: (p: Partial<ConfigFranja>) => void;
  negocio: string;
  setNegocio: (v: string) => void;
  titular: string;
  setTitular: (v: string) => void;
  logo: string | null;
  setLogo: (v: string | null) => void;
}) {
  const { c, set } = props;
  const premios = c.premiosIntermedios ?? [];
  const setPremio = (i: number, p: Partial<PremioIntermedio>) =>
    set({ premiosIntermedios: premios.map((x, k) => (k === i ? { ...x, ...p } : x)) });

  return (
    <div className="space-y-5">
      <div className="grid sm:grid-cols-2 gap-3">
        <Campo label="Nombre del negocio">
          <input className="input" value={props.negocio} onChange={(e) => props.setNegocio(e.target.value)} />
        </Campo>
        <Campo label="Titular (cliente de ejemplo)">
          <input className="input" value={props.titular} onChange={(e) => props.setTitular(e.target.value)} />
        </Campo>
        <Campo label="Premio">
          <input className="input" value={c.premio} onChange={(e) => set({ premio: e.target.value })} />
        </Campo>
        <Campo label="Qué se cuenta (visitas, cafés, cortes…)">
          <input className="input" value={c.unidad} onChange={(e) => set({ unidad: e.target.value })} />
        </Campo>
        <Campo label={`Sellos para el premio: ${c.requeridos}`}>
          <input
            type="range"
            min={1}
            max={20}
            value={c.requeridos}
            onChange={(e) => {
              const r = Number(e.target.value);
              set({ requeridos: r, sellados: Math.min(c.sellados, r) });
            }}
            className="w-full accent-brand"
          />
        </Campo>
        <Campo label="Logo (solo para la vista)">
          <ArchivoLocal
            etiqueta={props.logo ? 'Cambiar logo' : 'Subir logo'}
            onArchivo={props.setLogo}
            onQuitar={props.logo ? () => props.setLogo(null) : undefined}
          />
        </Campo>
      </div>

      <div className="pt-3 border-t border-line">
        <div className="text-sm font-semibold">Premios intermedios</div>
        <p className="text-xs text-mute mb-2">Se ven en «Sellos» (🎁 en el círculo) y como paradas en «Camino de premios».</p>
        <div className="space-y-2">
          {premios.map((p, i) => (
            <div key={i} className="flex gap-2 items-center">
              <span className="text-xs text-mute w-14">En el</span>
              <input
                type="number"
                min={1}
                max={c.requeridos - 1}
                className="input w-20"
                value={p.pos}
                onChange={(e) => setPremio(i, { pos: Number(e.target.value) })}
              />
              <input className="input flex-1" value={p.texto} onChange={(e) => setPremio(i, { texto: e.target.value })} />
              <button
                type="button"
                className="btn-ghost px-3"
                aria-label="Quitar premio"
                onClick={() => set({ premiosIntermedios: premios.filter((_, k) => k !== i) })}
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn-link text-sm"
            onClick={() =>
              set({ premiosIntermedios: [...premios, { pos: Math.max(1, Math.floor(c.requeridos / 2)), texto: 'Regalo' }] })
            }
          >
            + Agregar premio intermedio
          </button>
        </div>
      </div>

    </div>
  );
}

/* ───────────────────────── vista previa ───────────────────────── */

function ControlDeProgreso({ c, set }: { c: ConfigFranja; set: (p: Partial<ConfigFranja>) => void }) {
  if (c.estilo === 'VIP' || c.estilo === 'SALDO') {
    return <p className="text-[11px] text-mute text-center">Ajusta el gasto o el saldo bajo los estilos.</p>;
  }
  const estados = [
    { id: 'nueva', txt: 'Nueva', v: 0 },
    { id: 'mitad', txt: 'A mitad', v: Math.floor(c.requeridos / 2) },
    { id: 'completa', txt: 'Completa', v: c.requeridos },
  ];
  return (
    <div className="space-y-2">
      <div className="bg-bg2 rounded-full p-0.5 flex text-xs font-semibold">
        {estados.map((e) => (
          <button
            key={e.id}
            type="button"
            onClick={() => set({ sellados: e.v })}
            className={`flex-1 px-3 py-1.5 rounded-full transition ${c.sellados === e.v ? 'bg-white text-ink shadow-sm' : 'text-mute hover:text-ink'}`}
          >
            {e.txt}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-2 text-xs text-mute">
        <span className="w-16">{c.sellados} de {c.requeridos}</span>
        <input
          type="range"
          min={0}
          max={c.requeridos}
          value={c.sellados}
          onChange={(e) => set({ sellados: Number(e.target.value) })}
          className="flex-1 accent-brand"
        />
      </label>
    </div>
  );
}

function Telefono({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-[300px] rounded-[44px] bg-[#0B0B0F] p-3 shadow-xl">
      <div className="rounded-[34px] bg-[#1C1C22] min-h-[540px] px-3 pt-4 pb-5">
        <div className="mx-auto mb-4 h-1.5 w-20 rounded-full bg-white/20" />
        {children}
      </div>
    </div>
  );
}

function Logo({ logo, negocio, color }: { logo: string | null; negocio: string; color: string }) {
  return logo ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={logo} alt="" className="w-7 h-7 rounded-md object-cover bg-white" />
  ) : (
    <span className="w-7 h-7 rounded-md grid place-items-center text-xs font-bold bg-white/15" style={{ color }}>
      {negocio.trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
}

function Pase({
  c,
  franja,
  plataforma,
  negocio,
  titular,
  logo,
}: {
  c: ConfigFranja;
  franja: string;
  plataforma: Plataforma;
  negocio: string;
  titular: string;
  logo: string | null;
}) {
  const cab = campoCabecera(c);
  const franjaImg = (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={franja} alt="Franja central del pase" className="block w-full" style={{ aspectRatio: `${ANCHO} / ${ALTO}` }} />
  );
  const qr = (
    <div className="flex flex-col items-center gap-1.5">
      <div className="bg-white p-2 rounded-lg">
        <QRCodeSVG value="https://soyclubify.com/laboratorio" size={84} />
      </div>
      <div className="text-[10px]" style={{ color: c.texto, opacity: 0.7 }}>
        Muéstralo en caja
      </div>
    </div>
  );
  const campos = (
    <div className="flex justify-between gap-3 text-[10px] font-semibold">
      <div>
        <div style={{ opacity: 0.7 }}>TITULAR</div>
        <div className="text-[13px]">{titular || '—'}</div>
      </div>
      <div className="text-right">
        <div style={{ opacity: 0.7 }}>{c.estilo === 'SALDO' ? 'DEVOLUCIÓN' : 'PRÓXIMO PREMIO'}</div>
        <div className="text-[13px]">{c.estilo === 'SALDO' ? `${c.porcentaje ?? 0}%` : c.premio}</div>
      </div>
    </div>
  );

  if (plataforma === 'APPLE') {
    // Apple: cabecera, franja (strip) a todo el ancho, campos debajo y el código al pie.
    return (
      <div className="rounded-2xl overflow-hidden" style={{ background: c.fondo, color: c.texto }}>
        <div className="flex items-center justify-between px-3 py-2.5">
          <div className="flex items-center gap-2 text-[13px] font-semibold">
            <Logo logo={logo} negocio={negocio} color={c.texto} />
            {negocio}
          </div>
          <div className="text-right text-[10px] font-semibold leading-tight">
            <div style={{ opacity: 0.7 }}>{cab.etiqueta}</div>
            <div className="text-[15px]">{cab.valor}</div>
          </div>
        </div>
        {franjaImg}
        <div className="px-3 py-3">{campos}</div>
        <div className="pb-4">{qr}</div>
      </div>
    );
  }

  if (plataforma === 'GOOGLE') {
    // Google pone la imagen grande («hero») AL PIE, debajo del código.
    return (
      <div className="rounded-2xl overflow-hidden" style={{ background: c.fondo, color: c.texto }}>
        <div className="px-4 pt-3 flex items-center gap-2 text-[12px] font-medium">
          <Logo logo={logo} negocio={negocio} color={c.texto} />
          {negocio}
        </div>
        <div className="px-4 pt-2 text-[19px] font-semibold leading-tight">Programa de {c.unidad}</div>
        <div className="px-4 pt-3 flex justify-between text-[10px] font-semibold">
          <div>
            <div style={{ opacity: 0.7 }}>{cab.etiqueta}</div>
            <div className="text-[14px]">{cab.valor}</div>
          </div>
          <div className="text-right">
            <div style={{ opacity: 0.7 }}>Próximo premio</div>
            <div className="text-[14px]">{c.premio}</div>
          </div>
        </div>
        <div className="py-4">{qr}</div>
        {franjaImg}
      </div>
    );
  }

  // Samsung Wallet: la imagen arriba, como portada, y la marca encima.
  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: c.fondo, color: c.texto }}>
      {franjaImg}
      <div className="px-4 pt-3 flex items-center gap-2 text-[13px] font-semibold">
        <Logo logo={logo} negocio={negocio} color={c.texto} />
        {negocio}
      </div>
      <div className="px-4 pt-1 text-[11px]" style={{ opacity: 0.75 }}>
        {c.estilo === 'VIP' || c.estilo === 'SALDO' ? `${cab.etiqueta}: ${cab.valor}` : fraseDeFaltan(c)}
      </div>
      <div className="px-4 py-3">{campos}</div>
      <div className="pb-4">{qr}</div>
    </div>
  );
}

/* ───────────────────────── comparador ───────────────────────── */

function Comparador({ c, onElegir }: { c: ConfigFranja; onElegir: (e: EstiloFranja) => void }) {
  const [vista, setVista] = useState<'actual' | 'tres'>('actual');
  return (
    <section className="card card-pad space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div>
          <div className="text-sm font-semibold">Todos los estilos con tus colores</div>
          <p className="text-xs text-mute">Toca uno para elegirlo y volver al editor.</p>
        </div>
        <div className="ml-auto bg-bg2 rounded-full p-0.5 flex text-xs font-semibold">
          {(
            [
              ['actual', `Con ${c.sellados} de ${c.requeridos}`],
              ['tres', 'Nueva · A mitad · Completa'],
            ] as const
          ).map(([id, txt]) => (
            <button
              key={id}
              type="button"
              onClick={() => setVista(id)}
              className={`px-3 py-1.5 rounded-full transition ${vista === id ? 'bg-white text-ink shadow-sm' : 'text-mute hover:text-ink'}`}
            >
              {txt}
            </button>
          ))}
        </div>
      </div>
      <div className={`grid gap-4 ${vista === 'actual' ? 'md:grid-cols-2 xl:grid-cols-3' : ''}`}>
        {ESTILOS.map((e) => (
          <button
            key={e.id}
            type="button"
            onClick={() => onElegir(e.id)}
            className={`text-left rounded-card border-2 overflow-hidden transition ${
              c.estilo === e.id ? 'border-brand' : 'border-line hover:border-brand/40'
            }`}
          >
            {vista === 'actual' ? (
              <Miniatura c={{ ...c, estilo: e.id }} />
            ) : (
              <div className="grid grid-cols-3 gap-1 bg-bg2 p-1">
                {[0, Math.floor(c.requeridos / 2), c.requeridos].map((s) => (
                  <Miniatura key={s} c={{ ...c, estilo: e.id, sellados: s }} />
                ))}
              </div>
            )}
            <div className="px-3 py-2 text-sm font-semibold">{e.nombre}</div>
          </button>
        ))}
      </div>
    </section>
  );
}

/* ───────────────────────── piezas ───────────────────────── */

function Miniatura({ c }: { c: ConfigFranja }) {
  const url = useMemo(() => svgComoDataUrl(dibujarFranja(c)), [c]);
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" className="block w-full" style={{ aspectRatio: `${ANCHO} / ${ALTO}`, background: c.area }} />;
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

function Color({ label, valor, onChange }: { label: string; valor: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-2 border border-line rounded-input px-2.5 py-2 cursor-pointer hover:border-brand/40">
      <span className="relative w-7 h-7 rounded-md border border-line shrink-0" style={{ background: valor }}>
        <input type="color" value={valor} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" />
      </span>
      <span className="min-w-0">
        <span className="block text-[11px] text-mute">{label}</span>
        <input
          className="block w-full text-xs font-mono bg-transparent outline-none uppercase"
          value={valor}
          onChange={(e) => onChange(e.target.value)}
        />
      </span>
    </label>
  );
}

function Interruptor({ on, onChange, titulo, ayuda }: { on: boolean; onChange: (v: boolean) => void; titulo: string; ayuda: string }) {
  return (
    <button type="button" onClick={() => onChange(!on)} className="w-full flex items-start gap-3 text-left">
      <span className={`mt-0.5 w-9 h-5 rounded-full p-0.5 transition shrink-0 ${on ? 'bg-brand' : 'bg-line'}`}>
        <span className={`block w-4 h-4 rounded-full bg-white shadow transition ${on ? 'translate-x-4' : ''}`} />
      </span>
      <span>
        <span className="block text-sm font-medium">{titulo}</span>
        <span className="block text-xs text-mute">{ayuda}</span>
      </span>
    </button>
  );
}

function ArchivoLocal({
  etiqueta,
  onArchivo,
  onQuitar,
}: {
  etiqueta: string;
  onArchivo: (dataUrl: string) => void;
  onQuitar?: () => void;
}) {
  return (
    <div className="flex items-center gap-2 mt-2">
      <label className="btn-ghost cursor-pointer">
        {etiqueta}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          className="sr-only"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) onArchivo(await leerArchivo(f));
            e.target.value = '';
          }}
        />
      </label>
      {onQuitar && (
        <button type="button" className="btn-link text-sm" onClick={onQuitar}>
          Quitar
        </button>
      )}
    </div>
  );
}
