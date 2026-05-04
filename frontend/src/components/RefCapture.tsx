'use client';
import { useEffect } from 'react';

/**
 * Captura `?ref=CODIGO` desde la URL y lo persiste en localStorage para
 * que el signup posterior pueda enviarlo al backend y crear el ReferralUse.
 * Vive en cualquier página pública por la que pueda entrar un referido.
 */
export function RefCapture() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const ref = new URLSearchParams(window.location.search).get('ref');
      if (ref && ref.length >= 4 && ref.length <= 20) {
        localStorage.setItem('clubify:ref', ref.toUpperCase());
      }
    } catch {}
  }, []);
  return null;
}
