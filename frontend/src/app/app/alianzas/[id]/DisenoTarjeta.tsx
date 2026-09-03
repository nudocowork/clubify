'use client';
/**
 * Editor del aspecto de la tarjeta de una alianza.
 *
 * Javier lo pidió así: «que se vea en el centro el logo del convenio y que
 * pueda optimizarse más bonita antes de crearse». Antes no había nada que
 * editar — la tarjeta nacía cuando activaba el PRIMER empleado, así que el
 * dueño repartía el enlace a ciegas y el primero en entrar fijaba para siempre
 * unos colores que nadie había elegido. Ahora nace con la alianza y esto es lo
 * que la retoca.
 *
 * La vista previa se pinta con los valores SIN guardar, para que el cambio se
 * vea antes de escribirlo. Es el mismo componente que usa el asistente de
 * tarjetas y la página del empleado, no una maqueta parecida: si fuera otra,
 * enseñaría algo que la billetera no pinta.
 */
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';
import { ImageUploader } from '@/components/ImageUploader';
import { WalletPassPreview } from '@/components/WalletPassPreview';

type Diseno = {
  card: {
    id: string;
    name: string;
    rewardText: string;
    primaryColor: string;
    secondaryColor: string;
    logoUrl: string | null;
    businessName: string;
  } | null;
  porDefecto: { name: string };
  logoDelAliado: string | null;
};

const VACIO = {
  name: '',
  primaryColor: '#111827',
  secondaryColor: '#6B7280',
  logoUrl: null as string | null,
};

/** Lo editable de una `card`, para no repetir el mapeo en tres sitios. */
function editableDe(card: NonNullable<Diseno['card']>) {
  return {
    name: card.name,
    primaryColor: card.primaryColor,
    secondaryColor: card.secondaryColor,
    logoUrl: card.logoUrl,
  };
}

export function DisenoTarjeta({
  convenioId,
  empresa,
  estado,
  beneficiosVivos,
}: {
  convenioId: string;
  empresa: string;
  estado: 'ACTIVO' | 'PAUSA' | 'FINALIZADO';
  beneficiosVivos: string[];
}) {
  const [d, setD] = useState<Diseno | null>(null);
  const [abierto, setAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  // Lo que se está editando, separado de lo guardado: así el botón sabe si hay
  // algo que guardar y «Descartar» tiene a dónde volver.
  const [b, setB] = useState(VACIO);

  useEffect(() => {
    api<Diseno>(`/convenios/${convenioId}/diseno`)
      .then((r) => {
        setD(r);
        if (r.card) setB(editableDe(r.card));
      })
      .catch(() => {
        // El resto de la pantalla —enlaces, beneficios, empleados— funciona sin
        // esto, así que un fallo aquí no debe tumbarla entera.
      });
  }, [convenioId]);

  if (!d) return null;

  // Alianzas creadas antes de que la tarjeta naciera con ellas: no hay nada que
  // editar todavía. Se dice, en vez de enseñar un editor que no guarda nada.
  if (!d.card) {
    return (
      <section className="card card-pad mt-4">
        <h2 className="font-medium">Cómo se ve la tarjeta</h2>
        <p className="text-sm text-neutral-500 mt-2">
          Esta alianza es de antes y su tarjeta todavía no existe: se crea con el
          primer empleado que active. En cuanto haya una podrás cambiar aquí el
          logo, los colores y el título.
        </p>
      </section>
    );
  }

  const guardado = editableDe(d.card);
  const sucio = (Object.keys(guardado) as Array<keyof typeof guardado>).some(
    (k) => b[k] !== guardado[k],
  );

  async function guardar() {
    setGuardando(true);
    try {
      await api(`/convenios/${convenioId}/diseno`, {
        method: 'PUT',
        body: JSON.stringify(b),
      });
      // Se relee en vez de dar por bueno lo que se mandó: un texto vacío vuelve
      // al valor por defecto en el servidor y un color mal pegado se descarta.
      // Sin releer, la pantalla enseñaría lo que se escribió y el teléfono otra
      // cosa.
      const fresco = await api<Diseno>(`/convenios/${convenioId}/diseno`);
      setD(fresco);
      if (fresco.card) setB(editableDe(fresco.card));
      toast('Diseño guardado. Las tarjetas ya instaladas se actualizan solas.', 'success');
    } catch (e: any) {
      toast(e.message || 'No pudimos guardar el diseño', 'error');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <section className="card card-pad mt-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-medium">Cómo se ve la tarjeta</h2>
          <p className="text-sm text-neutral-500">
            Lo que verán los empleados de {empresa} en su teléfono.
          </p>
        </div>
        <button className="btn-ghost text-sm shrink-0" onClick={() => setAbierto(!abierto)}>
          {abierto ? 'Cerrar' : 'Personalizar'}
        </button>
      </div>

      <div className="mt-4 grid gap-6 md:grid-cols-[auto_1fr] items-start">
        <div className="mx-auto">
          <WalletPassPreview
            brandName={d.card.businessName}
            brandLogoUrl={b.logoUrl}
            primaryColor={b.primaryColor}
            secondaryColor={b.secondaryColor}
            cardName={b.name || d.porDefecto.name}
            cardType="STAMPS"
            alianza={{ estado, empresa, vivos: beneficiosVivos }}
            // Los beneficios VIVOS, igual que el pase de verdad: en una
            // alianza este campo lo pisan Apple, Google y la vista del
            // empleado con lo que la caja va a aplicar. Poner aquí otra cosa
            // haría de la vista previa una promesa que el pase no cumple.
            rewardText={
              beneficiosVivos.join(' · ') || `Consulta con ${empresa}`
            }
            customerName="Nombre del empleado"
            size="sm"
          />
        </div>

        {abierto && (
          <div className="grid gap-3">
            <div>
              <label className="label">Logo de {empresa}</label>
              <p className="text-xs text-neutral-500 mb-2">
                Va en el centro de la tarjeta, sobre un círculo blanco: los logos
                corporativos suelen venir en negro con fondo transparente y sin
                el círculo desaparecen. Sin logo se ponen las iniciales.
              </p>
              <ImageUploader
                value={b.logoUrl}
                onChange={(url) => setB({ ...b, logoUrl: url })}
                folder="logos"
                crop={false}
                minDimensionWarn={false}
              />
            </div>

            <div>
              <label className="label">Título</label>
              <input
                className="input"
                value={b.name}
                placeholder={d.porDefecto.name}
                maxLength={60}
                onChange={(e) => setB({ ...b, name: e.target.value })}
              />
              <p className="text-xs text-neutral-500 mt-1">
                El beneficio no se escribe aquí: la tarjeta enseña siempre los
                que estén encendidos, que son los que la caja va a aplicar.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  ['primaryColor', 'Color de fondo'],
                  ['secondaryColor', 'Color del texto'],
                ] as const
              ).map(([campo, etiqueta]) => (
                <div key={campo}>
                  <label className="label">{etiqueta}</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      className="h-9 w-12 shrink-0 rounded border border-neutral-300 bg-transparent p-0.5"
                      value={b[campo]}
                      onChange={(e) => setB({ ...b, [campo]: e.target.value })}
                    />
                    <input
                      className="input flex-1 font-mono text-sm"
                      value={b[campo]}
                      maxLength={7}
                      onChange={(e) => setB({ ...b, [campo]: e.target.value })}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                className="btn-primary"
                disabled={!sucio || guardando}
                onClick={guardar}
              >
                {guardando ? 'Guardando…' : 'Guardar diseño'}
              </button>
              {sucio && (
                <button className="btn-ghost text-sm" onClick={() => setB(guardado)}>
                  Descartar
                </button>
              )}
            </div>
            <p className="text-xs text-neutral-500">
              Al guardar, las tarjetas que ya estén instaladas se actualizan
              solas: Apple solo se vuelve a bajar el pase cuando se le avisa.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
