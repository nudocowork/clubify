'use client';
/**
 * «Estilo de la tarjeta» en el editor: en SELLOS, el cartón clásico o uno de los
 * estilos del laboratorio (taza, cono de pizza, anillo…); en CASHBACK, «Saldo»;
 * en VIP por niveles (MEMBERSHIP), «VIP».
 *
 * Solo elige la FORMA (`Card.stripStyle`). Colores, ícono, premio y tope son
 * los de la tarjeta: se cambian en los controles de siempre y la vista previa
 * de aquí los usa en vivo. La franja se dibuja con el mismo código que usa el
 * servidor para el pase, así que lo que se ve aquí es lo que llega al celular.
 */
import { useMemo, useState } from 'react';
import {
  configDesdeTarjeta,
  ESTILOS,
  ESTILOS_POR_TIPO,
  LETRAS,
  svgComoDataUrl,
  type ConfigFranja,
  type EstiloDeTarjeta,
  type EstiloFranja,
  type Letra,
  type Porcion,
  type Recipiente,
} from '@/lib/cards/estilos-de-franja';
import { EditorDeAcomodo } from '@/app/laboratorio-tarjetas/EditorDeAcomodo';
import { ImageUploader } from '@/components/ImageUploader';
import { subirArchivo } from '@/lib/subir-archivo';
import {
  franjaDeTarjeta,
  gastoDeMuestra,
  premiosDe,
  type TarjetaParaEstilo,
} from '@/lib/cards/franja-de-tarjeta';

/** Imagen en memoria (data URL) → archivo en el almacenamiento → URL. */
async function subirDataUrl(dataUrl: string, folder: string): Promise<string> {
  const blob = await (await fetch(dataUrl)).blob();
  const r = await subirArchivo(blob, { folder, nombre: 'sello.png' });
  return r.url;
}

const CON_TEXTO = new Set<EstiloFranja>(['TAZA', 'PORCIONES', 'ANILLO', 'CAMINO', 'FOTO_NUMERO', 'COLOR_SOLIDO']);

/** Qué dice la ficha «sin estilo» en cada tipo. */
const SIN_ESTILO: Record<string, { nombre: string; ayuda: string }> = {
  STAMPS: { nombre: 'Clásico', ayuda: 'El de siempre' },
  CASHBACK: { nombre: 'Sin franja', ayuda: 'Solo el saldo arriba' },
  MEMBERSHIP: { nombre: 'Sin franja', ayuda: 'Solo el nivel arriba' },
};

const pesos = (n: number) => `$${Math.round(n).toLocaleString('es-CO')}`;

export function EstiloDeLaFranja({
  tipo = 'STAMPS',
  tierMetric,
  tarjeta,
  estilo,
  onEstilo,
  onIconoImagen,
}: {
  /** STAMPS, CASHBACK o MEMBERSHIP (VIP por niveles). */
  tipo?: string;
  /** VIP: el estilo dibuja plata, así que solo aplica con niveles por gasto. */
  tierMetric?: string | null;
  tarjeta: TarjetaParaEstilo;
  /** `null` = clásico. */
  estilo: EstiloDeTarjeta | null;
  onEstilo: (e: EstiloDeTarjeta | null) => void;
  /** «Tu producto» cambia el ícono propio del sello, que es un campo de la tarjeta. */
  onIconoImagen?: (url: string | null) => void;
}) {
  const estilos = ESTILOS_POR_TIPO[tipo] ?? [];
  const sinEstilo = SIN_ESTILO[tipo] ?? SIN_ESTILO.STAMPS;
  const niveles = tarjeta.niveles ?? [];
  const topeGasto = Math.max(100_000, ...niveles.map((n) => n.desde * 1.25));

  // Lo que mueve la barra de la vista previa depende del tipo: sellos, saldo o gasto.
  const [avance, setAvance] = useState(() => Math.ceil(tarjeta.requeridos / 2));
  const [saldo, setSaldo] = useState(25_000);
  const [gastado, setGastado] = useState(() => gastoDeMuestra(niveles));
  const sellados = Math.min(avance, tarjeta.requeridos);
  const muestra: TarjetaParaEstilo = { ...tarjeta, saldo, gastado };
  const set = (p: Partial<EstiloDeTarjeta>) => estilo && onEstilo({ ...estilo, ...p });

  // Miniaturas con el emoji y sin imágenes: como <img> no bajarían las URLs.
  const miniaturas = useMemo(() => {
    const base = {
      ...tarjeta,
      stampIconImageUrl: null,
      freeRewards: [],
      saldo: 25_000,
      gastado: gastoDeMuestra(tarjeta.niveles ?? []),
    };
    return Object.fromEntries(
      estilos.map((e) => [
        e,
        svgComoDataUrl(franjaDeTarjeta({ estilo: e }, base, Math.ceil(tarjeta.requeridos * 0.6))),
      ]),
    ) as Record<EstiloFranja, string>;
  }, [tarjeta, estilos]);

  const vista = useMemo(
    () => (estilo ? franjaDeTarjeta(estilo, { ...tarjeta, saldo, gastado }, sellados) : null),
    [estilo, tarjeta, sellados, saldo, gastado],
  );
  const vipNoAplica = tipo === 'MEMBERSHIP' && (tierMetric || 'spend') !== 'spend';

  /** Para el editor de «Tu producto», que trabaja sobre la configuración completa. */
  const config: ConfigFranja | null = useMemo(
    () =>
      estilo
        ? configDesdeTarjeta(estilo, { ...muestra, sellados, premiosIntermedios: premiosDe(tarjeta) })
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `muestra` se arma de estos
    [estilo, tarjeta, sellados, saldo, gastado],
  );

  const elegir = (e: EstiloFranja | null) => {
    if (!e) return onEstilo(null);
    // Al cambiar de estilo se conservan las opciones que valen para todos
    // (letra) y se sueltan las del anterior.
    onEstilo({
      estilo: e,
      ...(estilo?.letra ? { letra: estilo.letra } : {}),
      ...(e === 'PRODUCTO' ? { acomodo: 'FILA' as const } : {}),
    });
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="label m-0">Estilo de la tarjeta</label>
        <div className="text-[11px] text-mute mt-0.5 leading-snug">
          {tipo === 'CASHBACK'
            ? 'Una franja con el saldo del cliente y el % que gana en cada compra. Los colores son los de esta tarjeta.'
            : tipo === 'MEMBERSHIP'
              ? 'Una franja con el nivel del cliente, su beneficio y cuánto le falta para el siguiente.'
              : 'Cómo se ve el avance de sellos en el celular del cliente. Los colores y el ícono son los de esta tarjeta.'}
        </div>
      </div>

      {vipNoAplica && (
        <p className="text-[11px] text-mute bg-bg2 rounded-input px-2.5 py-1.5">
          Esta tarjeta sube de nivel por visitas, no por lo que gasta: la franja VIP muestra montos, así que el pase
          seguirá sin franja aunque la elijas.
        </p>
      )}

      <div className="grid grid-cols-3 gap-2">
        <Ficha activa={!estilo} onClick={() => elegir(null)} nombre={sinEstilo.nombre}>
          <div className="aspect-[640/246] rounded-md bg-bg2 grid place-items-center text-[10px] text-mute">
            {sinEstilo.ayuda}
          </div>
        </Ficha>
        {estilos.map((e) => (
          <Ficha
            key={e}
            activa={estilo?.estilo === e}
            onClick={() => elegir(e)}
            nombre={ESTILOS.find((x) => x.id === e)?.nombre ?? e}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- SVG generado aquí mismo */}
            <img src={miniaturas[e]} alt="" className="w-full aspect-[640/246] rounded-md" />
          </Ficha>
        ))}
      </div>

      {estilo && vista && (
        <div className="space-y-3 rounded-lg border border-line p-3">
          <div
            className="rounded-lg overflow-hidden [&>svg]:w-full [&>svg]:h-auto [&>svg]:block"
            dangerouslySetInnerHTML={{ __html: vista }}
          />
          <div className="flex items-center gap-2 text-xs text-mute">
            <span className="shrink-0">{tipo === 'STAMPS' ? 'Ver con' : tipo === 'CASHBACK' ? 'Saldo' : 'Gastado'}</span>
            {tipo === 'CASHBACK' ? (
              <input
                type="range"
                min={0}
                max={200_000}
                step={500}
                value={saldo}
                onChange={(e) => setSaldo(Number(e.target.value))}
                className="flex-1 accent-brand"
                aria-label="Saldo en la vista previa"
              />
            ) : tipo === 'MEMBERSHIP' ? (
              <input
                type="range"
                min={0}
                max={topeGasto}
                step={1000}
                value={gastado}
                onChange={(e) => setGastado(Number(e.target.value))}
                className="flex-1 accent-brand"
                aria-label="Gasto en la vista previa"
              />
            ) : (
              <input
                type="range"
                min={0}
                max={tarjeta.requeridos}
                value={sellados}
                onChange={(e) => setAvance(Number(e.target.value))}
                className="flex-1 accent-brand"
                aria-label="Sellos en la vista previa"
              />
            )}
            <span className="w-20 text-right tabular-nums">
              {tipo === 'CASHBACK' ? pesos(saldo) : tipo === 'MEMBERSHIP' ? pesos(gastado) : `${sellados}/${tarjeta.requeridos}`}
            </span>
          </div>

          {estilo.estilo === 'TAZA' && (
            <Opcion titulo="Recipiente">
              <Segmentos
                opciones={[
                  { id: 'TAZA', txt: 'Taza' },
                  { id: 'VASO', txt: 'Vaso' },
                  { id: 'CONO', txt: 'Cono de pizza' },
                ]}
                valor={estilo.recipiente ?? 'TAZA'}
                onChange={(v) => set({ recipiente: v as Recipiente })}
              />
              <p className="text-[11px] text-mute mt-1">
                {estilo.recipiente === 'CONO'
                  ? 'El cono lleva sus colores de pizza; al completarse, el queso desborda.'
                  : 'El líquido toma el color del sello activo.'}
              </p>
            </Opcion>
          )}

          {estilo.estilo === 'PORCIONES' && (
            <Opcion titulo="Qué se reparte">
              <Segmentos
                opciones={[
                  { id: 'PIZZA', txt: 'Pizza' },
                  { id: 'TORTA', txt: 'Torta' },
                  { id: 'LISA', txt: 'Lisa' },
                ]}
                valor={estilo.porcion ?? 'PIZZA'}
                onChange={(v) => set({ porcion: v as Porcion })}
              />
            </Opcion>
          )}

          {estilo.estilo === 'FOTO_NUMERO' && (
            <Opcion titulo="Foto de la franja">
              <p className="text-[11px] text-mute mb-1.5">
                Una foto del negocio: va a la derecha y se funde con el color del área. Ideal 1200 × 460.
              </p>
              <ImageUploader
                value={estilo.portada ?? null}
                onChange={(url) => set({ portada: url })}
                folder="card-stamp-bg"
                crop={false}
              />
            </Opcion>
          )}

          {estilo.estilo === 'PRODUCTO' && config && (
            <EditorDeAcomodo
              c={config}
              guardarImagen={(d) => subirDataUrl(d, 'card-stamp-icon')}
              set={(p) => {
                if ('iconoImagen' in p) onIconoImagen?.(p.iconoImagen ?? null);
                const resto: Partial<EstiloDeTarjeta> = {};
                if ('posiciones' in p) resto.posiciones = p.posiciones;
                if ('acomodo' in p) resto.acomodo = p.acomodo;
                if ('faltantes' in p) resto.faltantes = p.faltantes;
                if (Object.keys(resto).length) set(resto);
              }}
            />
          )}

          {CON_TEXTO.has(estilo.estilo) && (
            <Opcion titulo="Letra">
              <Segmentos
                opciones={(Object.keys(LETRAS) as Letra[]).map((l) => ({
                  id: l,
                  txt: l === 'MODERNA' ? 'Moderna' : l === 'ELEGANTE' ? 'Elegante' : 'Impacto',
                }))}
                valor={estilo.letra ?? 'MODERNA'}
                onChange={(v) => set({ letra: v as Letra })}
              />
            </Opcion>
          )}
        </div>
      )}
    </div>
  );
}

function Ficha({
  activa,
  onClick,
  nombre,
  children,
}: {
  activa: boolean;
  onClick: () => void;
  nombre: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activa}
      className={`rounded-lg p-1.5 text-left transition border-2 ${
        activa ? 'border-brand bg-brand-soft' : 'border-line hover:border-brand/40'
      }`}
    >
      {children}
      <div className={`text-[11px] font-semibold mt-1 leading-tight ${activa ? 'text-brand' : 'text-ink'}`}>
        {nombre}
      </div>
    </button>
  );
}

function Opcion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="pt-3 border-t border-line">
      <div className="text-sm font-semibold mb-2">{titulo}</div>
      {children}
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
    <div className="bg-bg2 rounded-full p-0.5 inline-flex flex-wrap text-xs font-semibold">
      {opciones.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={`px-3 py-1.5 rounded-full transition ${
            valor === o.id ? 'bg-white text-ink shadow-sm' : 'text-mute hover:text-ink'
          }`}
        >
          {o.txt}
        </button>
      ))}
    </div>
  );
}
