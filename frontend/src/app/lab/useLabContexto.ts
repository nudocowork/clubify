'use client';
import { useEffect, useState } from 'react';
import { api, getToken } from '@/lib/api';
import type { LabContexto } from './_shared';

/**
 * Alcance y marca de quien mira el Lab (`GET /lab/me`).
 *
 * La cabecera, el feed y la moderación lo necesitan en la misma pantalla: se
 * comparte una sola petición. La clave es el token y no el usuario, porque al
 * «entrar» a una marca el token cambia aunque la identidad sea la misma, y la
 * marca anterior no debe quedarse pegada.
 */
export type EstadoLab =
  | { estado: 'cargando' }
  | { estado: 'listo'; contexto: LabContexto }
  | { estado: 'error'; mensaje: string };

let enCurso: { token: string; promesa: Promise<LabContexto> } | null = null;

function pedirContexto(): Promise<LabContexto> {
  const token = getToken() ?? '';
  if (enCurso && enCurso.token === token) return enCurso.promesa;
  const promesa = api<LabContexto>('/lab/me');
  enCurso = { token, promesa };
  // Un fallo (403, red) no se guarda: el siguiente montaje vuelve a preguntar.
  promesa.catch(() => {
    if (enCurso?.promesa === promesa) enCurso = null;
  });
  return promesa;
}

/** Con `activo = false` no pregunta (por ejemplo, antes de saber si hay sesión). */
export function useLabContexto(activo = true): EstadoLab {
  const [estado, setEstado] = useState<EstadoLab>({ estado: 'cargando' });

  useEffect(() => {
    if (!activo) return;
    let vigente = true;
    pedirContexto()
      .then((contexto) => {
        if (vigente) setEstado({ estado: 'listo', contexto });
      })
      .catch((e: any) => {
        if (vigente) {
          setEstado({
            estado: 'error',
            mensaje: e?.message || 'No se pudo abrir el Lab.',
          });
        }
      });
    return () => {
      vigente = false;
    };
  }, [activo]);

  return estado;
}
