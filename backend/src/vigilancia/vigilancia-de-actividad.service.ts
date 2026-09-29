import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../common/prisma/prisma.service';
import { PreregAlertsService } from '../auth/prereg-alerts.service';
import { decidirCaida, mediana, Veredicto } from './decidir-caida';

/**
 * El fallo que nadie ve: todo responde 200 y el negocio está parado.
 *
 * `/health` dice `ok`, Sentry no tiene nada, los contenedores están arriba — y
 * llevamos cuatro horas sin un pedido porque un cron dejó de correr, una
 * pasarela cambió un campo o un despliegue se llevó una ruta. Hasta hoy eso se
 * descubría porque un negocio llamaba, que es tarde y además queda fatal.
 *
 * Esto NO vigila que el servidor esté vivo (de eso ya hay), vigila que siga
 * PASANDO lo que tiene que pasar. La decisión de qué es una caída vive aparte
 * en `decidir-caida.ts`, con sus pruebas: acá solo se cuenta y se avisa.
 */

/** Una señal de que el producto está funcionando de verdad. */
type Señal = {
  /** Cómo se llama en el aviso, que lo lee una persona. */
  nombre: string;
  tabla: string;
  /** Ojo: `Pass` no tiene `createdAt`, se llama `issuedAt`. */
  campo: string;
  /**
   * Por debajo de esta mediana la franja no dice nada. Es lo que evita que las
   * madrugadas suenen todas las noches: donde lo normal es 1, tener 0 es
   * martes, no una avería.
   */
  minimoUtil: number;
};

const SEÑALES: Señal[] = [
  { nombre: 'pedidos', tabla: 'Order', campo: 'createdAt', minimoUtil: 3 },
  { nombre: 'sellos', tabla: 'Stamp', campo: 'createdAt', minimoUtil: 5 },
  { nombre: 'tarjetas emitidas', tabla: 'Pass', campo: 'issuedAt', minimoUtil: 2 },
  { nombre: 'reservas', tabla: 'Reservation', campo: 'createdAt', minimoUtil: 2 },
];

/** Cuántos días atrás se mira para saber qué es normal a esta hora. */
const DIAS_DE_HISTORIA = 21;

@Injectable()
export class VigilanciaDeActividadService {
  private readonly log = new Logger('VigilanciaActividad');

  constructor(
    private prisma: PrismaService,
    private alerts: PreregAlertsService,
  ) {}

  /**
   * A los :10 de cada hora, para que la hora anterior esté cerrada de verdad.
   *
   * El servidor va en UTC y este `@Cron` no fija zona — da igual acá, porque lo
   * único que importa es que las dos mitades de la comparación se saquen de la
   * misma forma: las «20:00 UTC» de hoy contra las «20:00 UTC» de los días
   * anteriores son la misma franja en Bogotá.
   */
  @Cron('10 * * * *', { name: 'vigilancia.actividad' })
  async cada_hora() {
    try {
      await this.revisar();
    } catch (e: any) {
      this.log.error(`La vigilancia de actividad falló: ${e?.message ?? e}`);
    }
  }

  /** Revisa todas las señales. Devuelve lo visto (lo usan las pruebas y el panel). */
  async revisar(): Promise<Array<{ señal: string; actual: number; esperado: number; v: Veredicto }>> {
    const finVentana = new Date();
    finVentana.setUTCMinutes(0, 0, 0); // arriba de la hora en curso
    const inicioVentana = new Date(finVentana.getTime() - 3600_000);
    const hora = inicioVentana.getUTCHours();
    const desde = new Date(finVentana.getTime() - DIAS_DE_HISTORIA * 86_400_000);

    const resultados = [];
    for (const s of SEÑALES) {
      const porDia = await this.conteoPorDia(s, desde, finVentana, hora);
      // La franja que acaba de cerrar es la del día de `inicioVentana`.
      const claveHoy = inicioVentana.toISOString().slice(0, 10);
      const actual = porDia.get(claveHoy) ?? 0;
      const historico = [...porDia.entries()].filter(([d]) => d !== claveHoy).map(([, n]) => n);

      const v = decidirCaida(actual, historico, s.minimoUtil);
      resultados.push({ señal: s.nombre, actual, esperado: mediana(historico), v });
      await this.avisarSiCambio(s, actual, mediana(historico), v, hora);
    }
    return resultados;
  }

  /**
   * Cuántas filas hay en esa MISMA hora, un número por día. Una sola consulta
   * por señal: con la base al otro lado del proxy público cada ida y vuelta
   * cuesta ~140 ms, así que pedir 21 días por separado serían 3 segundos por
   * señal para nada.
   *
   * `tabla` y `campo` salen de `SEÑALES`, que es una lista fija de este archivo
   * — no llegan de fuera. Las fechas y la hora van como parámetros.
   */
  private async conteoPorDia(
    s: Señal,
    desde: Date,
    hasta: Date,
    hora: number,
  ): Promise<Map<string, number>> {
    const filas = await this.prisma.$queryRawUnsafe<Array<{ dia: Date; n: bigint | number }>>(
      `SELECT ("${s.campo}")::date AS dia, count(*)::int AS n
         FROM "${s.tabla}"
        WHERE "${s.campo}" >= $1 AND "${s.campo}" < $2
          AND extract(hour from "${s.campo}") = $3
        GROUP BY 1`,
      desde,
      hasta,
      hora,
    );
    const m = new Map<string, number>();
    for (const f of filas) {
      const clave = new Date(f.dia).toISOString().slice(0, 10);
      m.set(clave, Number(f.n));
    }
    return m;
  }

  /**
   * Avisa solo cuando el estado CAMBIA, y también cuando se recupera.
   *
   * Sin esto el aviso saldría cada hora mientras dure la caída: a la tercera
   * nadie lo lee, y entonces la alarma ya no sirve. Y la recuperación se avisa
   * a propósito — quien recibió «los pedidos están a cero» necesita saber que
   * volvieron sin tener que ir a mirar.
   *
   * Leer el estado y luego escribirlo NO es atómico: con dos instancias del
   * backend, las dos podrían leer «sano» y avisar. Se deja así a conciencia
   * porque `sendTeamAlert` ya corta las alertas idénticas seguidas, y porque
   * el coste de equivocarse es un SMS repetido, no un dato perdido. Si algún
   * día hay más de un pod y molesta, el arreglo es un `updateMany` condicional
   * mirando el `count`, como en el resto del repo.
   */
  private async avisarSiCambio(
    s: Señal,
    actual: number,
    esperado: number,
    v: Veredicto,
    hora: number,
  ) {
    const clave = `vigilancia:actividad:${s.tabla}`;
    const previo = (await this.prisma.setting.findUnique({ where: { key: clave } }))?.value ?? 'sano';
    const ahora = v.estado === 'caida' ? 'caida' : 'sano';

    // «sin-señal» no es un estado: es no saber. Si la franja no da para opinar
    // se deja el estado como estaba, porque pisarlo con «sano» a las 4 de la
    // mañana borraría una caída que empezó a medianoche y sigue ahí.
    if (v.estado === 'sin-señal') {
      this.log.debug(`${s.nombre}: ${v.motivo}`);
      return;
    }
    if (ahora === previo) return;

    const texto =
      ahora === 'caida'
        ? `🔴 ${s.nombre.toUpperCase()}: ${v.motivo}. Franja ${hora}:00-${hora + 1}:00 UTC. ` +
          `Todo puede estar respondiendo 200 y aun así estar roto: mira los cron y la pasarela.`
        : `🟢 ${s.nombre.toUpperCase()}: vuelven a entrar (${actual}, normal a esta hora ${esperado}).`;

    const aviso = await this.alerts.sendTeamAlert(texto, 'actividad');

    // El estado se sella DESPUÉS y solo si el aviso salió. Al revés, un envío
    // fallido dejaría la caída marcada como «ya avisada» y no se reintentaría
    // nunca — el mismo fallo que ya se arregló en la alerta de capacidad.
    if (!aviso.ok) {
      this.log.warn(
        `Aviso de ${s.nombre} (${ahora}) NO salió: ${aviso.sent} de ${aviso.total}. ` +
          `Se reintenta en la próxima pasada.`,
      );
      return;
    }
    await this.prisma.setting.upsert({
      where: { key: clave },
      update: { value: ahora },
      create: { key: clave, value: ahora },
    });
    this.log.warn(`${s.nombre}: ${ahora} — avisado a ${aviso.sent} persona(s).`);
  }
}
