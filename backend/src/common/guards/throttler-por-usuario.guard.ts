import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

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
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const userId = req?.user?.id;
    if (userId) return `u:${userId}`;
    // `req.ips` viene relleno cuando `trust proxy` está activo y trae la
    // cadena de X-Forwarded-For; el primero es el cliente real.
    const ip = req?.ips?.length ? req.ips[0] : req?.ip;
    return `ip:${ip ?? 'desconocida'}`;
  }
}
