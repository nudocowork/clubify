'use client';
/**
 * Cabecera de sección del panel del negocio, pintada en la BARRA SUPERIOR del
 * shell (a la izquierda del buscador «Buscar ⌘K»).
 *
 * Por qué existe: cada página pintaba su título dentro del contenido y su
 * «Ver tutorial» mezclado con los filtros, así que la franja del buscador
 * quedaba vacía y el contenido arrancaba más abajo de lo necesario (pedido del
 * cliente, «MODIFICACIONES CLIENTES (5)»). Ahora la página DECLARA su título,
 * contador, subtítulo y tutorial con <PanelHeader …/> y el shell los pinta
 * arriba — un solo sitio, el mismo aspecto en todas las secciones.
 *
 * Mecanismo: el shell monta un hueco vacío (`slot`) en su barra superior y lo
 * publica por contexto; <PanelHeader> se pinta ahí con un portal. Con portal
 * (y no subiendo datos por contexto) el título puede ser cualquier ReactNode y
 * se actualiza con el estado de la página sin bucles de setState.
 *
 * Fuera del shell (sin contexto) se pinta en línea, como antes: así un
 * componente reutilizado en otra pantalla no pierde su título.
 */
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AcademyButton } from './AcademyButton';

type SlotCtx = {
  slot: HTMLElement | null;
  /** Hueco junto al buscador donde va «Ver tutorial». */
  tutorialSlot?: HTMLElement | null;
  /** El shell solo enseña la franja en celular cuando hay una cabecera
   *  montada: sin esto quedaría un hueco vacío encima de cada página. */
  register: () => () => void;
};

export const PanelHeaderSlotContext = createContext<SlotCtx | null>(null);

export function PanelHeader({
  title,
  crumb,
  subtitle,
  tutorial,
  actions,
}: {
  title: ReactNode;
  /** Contador o miga junto al título («/ 26», «/ 31 enviadas»). */
  crumb?: ReactNode;
  /** Una línea de descripción bajo el título. */
  subtitle?: ReactNode;
  /** Clave del módulo de Academia (ver lib/academy-modules). Sin video activo
   *  para esa clave el botón no se pinta. */
  tutorial?: string;
  /** Botones de la sección que van en la barra superior, a la DERECHA de
   *  «Ver tutorial» (p. ej. «+ Invitar al equipo»). Existe para que la acción
   *  principal no gaste una fila propia bajo la barra (pedido del cliente). */
  actions?: ReactNode;
}) {
  const ctx = useContext(PanelHeaderSlotContext);
  const register = ctx?.register;
  useEffect(() => (register ? register() : undefined), [register]);

  const content = (
    <>
      <div className="min-w-0 flex-1 basis-[12rem]">
        <h1 className="page-title leading-tight break-words">
          {title}
          {crumb != null && crumb !== false && (
            <>
              {' '}
              <span className="page-crumb whitespace-nowrap">{crumb}</span>
            </>
          )}
        </h1>
        {subtitle && (
          <p className="text-[13px] text-mute m-0 mt-0.5 max-w-3xl leading-snug">
            {subtitle}
          </p>
        )}
      </div>
      {/* Fuera del shell, el botón va en línea con el título. */}
      {tutorial && !ctx?.tutorialSlot && <AcademyButton moduleKey={tutorial} variant="shell" />}
      {actions}
    </>
  );
  // En el shell, «Ver tutorial» va a la izquierda del buscador.
  const boton =
    tutorial && ctx?.tutorialSlot
      ? createPortal(<AcademyButton moduleKey={tutorial} variant="shell" />, ctx.tutorialSlot)
      : null;

  if (!ctx) {
    return <div className="flex items-center gap-x-3 gap-y-2 flex-wrap mb-5">{content}</div>;
  }
  // El hueco aparece tras el primer montaje del shell: un frame sin título es
  // preferible a pintarlo en línea y que salte de sitio.
  if (!ctx.slot) return null;
  return (
    <>
      {createPortal(content, ctx.slot)}
      {boton}
    </>
  );
}
