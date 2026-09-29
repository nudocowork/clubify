import { Injectable } from '@nestjs/common';
import { ThrottlerException, ThrottlerGuard } from '@nestjs/throttler';

/**
 * Limitador de peticiones que cuenta POR USUARIO cuando hay sesión, y por IP
 * solo cuando no la hay.
 *
 * Por qué no vale el de serie. El `ThrottlerGuard` cuenta por IP, y en un
 * negocio los empleados salen todos por la IP del wifi del local: sus
 * peticiones se suman contra el mismo cubo de 100/min. Con tres personas
 * trabajando, el dueño se queda fuera de su propio panel sin haber hecho nada
 * raro. Ese es el motivo real por el que esto llevaba meses sin activarse — no
 * el `trust proxy`, que es solo la mitad del problema.
 *
 * Separando los cubos, cada uno gasta el suyo:
 *
 *   · Con sesión  → `u:<id>`. Dos empleados del mismo local dejan de restarse.
 *   · Sin sesión  → `ip:<ip>`. Login, registro y webhooks siguen contando por
 *     IP, que es justo donde importa frenar la fuerza bruta.
 *
 * OJO con el orden de los guards: esto solo funciona si `req.user` ya está
 * puesto cuando corre. En este backend los guards globales se registran en
 * `auth.module.ts` y el `JwtAuthGuard` va antes, así que llega relleno. Si
 * alguna vez `req.user` no estuviera, el peor caso es contar por IP — el
 * comportamiento de antes, nunca «sin límite».
 */
@Injectable()
export class ThrottlerPorUsuario extends ThrottlerGuard {
  /**
   * El 429 sale en español DESDE AQUÍ, no traducido en cada pantalla.
   *
   * El de serie responde «ThrottlerException: Too Many Requests», y eso era lo
   * que iba a ver un negocio en el toast del login el día que se encendiera
   * TRUST_PROXY — de hecho fue LO QUE FRENÓ el encendido durante semanas.
   * Naciendo en español, queda bien en todas las superficies de una vez: el
   * panel, las páginas públicas de reserva y pedido (que no pasan por
   * api.ts), la app iOS y el Onboarding. El header Retry-After no se pierde:
   * el guard base lo pone ANTES de llamar acá (throttler.guard.js:107).
   */
  protected async throwThrottlingException(): Promise<void> {
    throw new ThrottlerException(
      'Demasiados intentos seguidos. Espera un momento y vuelve a intentarlo.',
    );
  }

  protected async getTracker(req: Record<string, any>): Promise<string> {
    const userId = req?.user?.id;
    if (userId) return `u:${userId}`;
    // `req.ips` viene relleno cuando `trust proxy` está activo y trae la
    // cadena de X-Forwarded-For; el primero es el cliente real.
    const ip = req?.ips?.length ? req.ips[0] : req?.ip;
    return `ip:${ip ?? 'desconocida'}`;
  }
}
