'use client';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

/**
 * Menú de acciones por fila, robusto contra contenedores con overflow.
 *
 * El problema clásico: un dropdown `position:absolute` dentro de una tabla con
 * `overflow-x-auto`/`overflow-hidden` queda RECORTADO en la última fila. Este
 * componente lo evita con **portal a document.body + position:fixed**, y además
 * abre hacia ARRIBA cuando no hay espacio abajo (clamp al viewport). Mismo
 * patrón ya probado en /admin/tenants (ActionsMenu inline).
 *
 * Uso:
 *   <ActionsMenu label="Acciones ▾">
 *     {(close) => (<>
 *       <button onClick={() => { close(); onEnter(); }}>Entrar</button>
 *     </>)}
 *   </ActionsMenu>
 */
export function ActionsMenu({
  label,
  buttonClassName,
  buttonStyle,
  menuWidth = 180,
  children,
}: {
  label: ReactNode;
  buttonClassName?: string;
  buttonStyle?: React.CSSProperties;
  menuWidth?: number;
  /** Render-prop: recibe `close` para cerrar el menú al elegir una acción. */
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0, width: menuWidth });
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    function update() {
      const rect = btnRef.current!.getBoundingClientRect();
      const left = Math.max(
        8,
        Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8),
      );
      const menuH = menuRef.current?.offsetHeight ?? 240;
      const spaceBelow = window.innerHeight - rect.bottom;
      let top =
        spaceBelow < menuH + 12 && rect.top > menuH + 12
          ? rect.top - menuH - 6
          : rect.bottom + 6;
      top = Math.max(8, Math.min(top, window.innerHeight - menuH - 8));
      setPos({ top, left, width: menuWidth });
    }
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, menuWidth]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const target = e.target as Node;
      if (btnRef.current?.contains(target) || menuRef.current?.contains(target))
        return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const close = () => setOpen(false);

  const menu =
    open && mounted ? (
      <div
        ref={menuRef}
        role="menu"
        className="fixed bg-white border border-line2 rounded-lg shadow-xl py-1 text-left text-sm overflow-y-auto"
        style={{
          top: pos.top,
          left: pos.left,
          width: pos.width,
          maxHeight: 'calc(100vh - 16px)',
          zIndex: 9999,
        }}
      >
        {children(close)}
      </div>
    ) : null;

  return (
    <div className="relative inline-block" onClick={(e) => e.stopPropagation()}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={
          buttonClassName ?? 'btn-ghost text-xs px-3 py-1.5 min-h-0'
        }
        style={buttonStyle}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {label}
      </button>
      {menu && createPortal(menu, document.body)}
    </div>
  );
}
