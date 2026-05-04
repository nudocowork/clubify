'use client';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';

type ToastType = 'success' | 'error' | 'info';
type Toast = { id: string; type: ToastType; message: string };

const ToastContext = createContext<{
  show: (message: string, type?: ToastType) => void;
}>({
  show: () => {},
});

export function useToast() {
  return useContext(ToastContext);
}

let listener: ((t: Omit<Toast, 'id'>) => void) | null = null;

/** Helper imperativo (fuera de React tree). Útil para api.ts errors. */
export function toast(message: string, type: ToastType = 'info') {
  if (listener) listener({ message, type });
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback((message: string, type: ToastType = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  useEffect(() => {
    listener = (t) => show(t.message, t.type);
    return () => {
      listener = null;
    };
  }, [show]);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div className="fixed top-4 right-4 z-[60] flex flex-col gap-2 max-w-sm w-full sm:w-auto pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto rounded-xl shadow-lg px-4 py-3 text-sm font-medium animate-in slide-in-from-top-2 ${
              t.type === 'success'
                ? 'bg-ok text-white'
                : t.type === 'error'
                ? 'bg-bad text-white'
                : 'bg-ink text-white'
            }`}
          >
            <div className="flex items-start gap-2">
              <span>
                {t.type === 'success' ? '✓' : t.type === 'error' ? '⚠' : 'ℹ'}
              </span>
              <span className="flex-1">{t.message}</span>
              <button
                onClick={() =>
                  setToasts((prev) => prev.filter((x) => x.id !== t.id))
                }
                className="text-white/70 hover:text-white text-xs"
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
