/**
 * Motor de reglas de las ALIANZAS. Puro: sin Prisma, sin Nest, sin reloj propio.
 *
 * Existe aparte para que los tests importen ESTO y no una copia. Los 31 tests
 * viejos de convenios reimplementaban la lógica dentro del propio fichero de
 * test: pasaban en verde sin proteger producción. Todo lo que decide si un
 * beneficio se puede usar vive aquí y lo llaman por igual la caja, la página de
 * activación y el portal del aliado — un solo sitio donde equivocarse.
 *
 * La regla de oro del módulo: lo que se ve en pantalla NUNCA es la
 * autorización. `resolverParaCaja` pinta con estas funciones y `canjear` las
 * vuelve a llamar dentro del candado, porque entre que el cajero mira y pulsa,
 * el dueño pudo apagar el cupón.
 */

/** Lo mínimo del convenio para decidir. Deliberadamente no es el tipo Prisma:
 *  así los tests construyen casos a mano sin arrastrar la base. */
export type ConvenioParaEstado = {
  status: 'ACTIVE' | 'PAUSED' | 'FINISHED';
  endsAt: Date | null;
};

export type CuponParaEstado = {
  /** Interruptor del NEGOCIO. */
  isActive: boolean;
  /** Interruptor de la EMPRESA ALIADA. El canje exige los dos. */
  activoAliado: boolean;
  endsAt: Date | null;
  maxTotal: number | null;
  /** Contador denormalizado de canjes NO anulados. */
  canjesCount: number;
};

/** Quién dejó el beneficio fuera de juego. El cajero necesita saberlo para
 *  decirle al cliente a quién preguntar; el empleado, en su pase, no. */
export type Apagador = 'negocio' | 'aliado' | 'ambos';

/**
 * Motivo que tumba el convenio ENTERO, o null si está en pie.
 *
 * Se comprueba una vez por escaneo y el mensaje es el mismo para todos sus
 * cupones: repetir «Convenio en pausa» siete veces, una por beneficio, hace
 * pensar al cajero que cada uno falló por su cuenta.
 */
export function motivoDelConvenio(
  convenio: ConvenioParaEstado,
  ahora: Date,
): string | null {
  if (convenio.status === 'FINISHED') return 'Convenio finalizado.';
  if (convenio.status === 'PAUSED') return 'Convenio en pausa.';
  // `endsAt` se evalúa perezosamente, sin cron: el convenio sigue ACTIVE pero
  // vencido. Es el estado REVERSIBLE —extender la fecha lo revive— frente a
  // FINISHED, que es definitivo. Son dos herramientas distintas: la renovación
  // anual y el cierre.
  if (convenio.endsAt && convenio.endsAt <= ahora) {
    return 'El convenio llegó a su fecha de fin.';
  }
  return null;
}

/** ¿El convenio admite ACTIVACIONES nuevas? Es más estricto que el canje: una
 *  pausa suele ser una renegociación, y emitir tarjetas mientras tanto crea
 *  compromisos que quizá no se quieran honrar. */
export function admiteActivaciones(
  convenio: ConvenioParaEstado,
  ahora: Date,
): boolean {
  return motivoDelConvenio(convenio, ahora) === null;
}

/**
 * Quién tiene apagado el cupón, o null si ninguno.
 *
 * Son dos banderas independientes y no una con «quién la apagó» porque así
 * cada parte es dueña de la suya por construcción: nadie puede encender lo que
 * apagó el otro, sin reglas que validar y sin carreras.
 */
export function quienApago(cupon: CuponParaEstado): Apagador | null {
  if (!cupon.isActive && !cupon.activoAliado) return 'ambos';
  if (!cupon.isActive) return 'negocio';
  if (!cupon.activoAliado) return 'aliado';
  return null;
}

/** ¿Se agotó el tope global? Calculado, nunca guardado como «apagado». */
export function estaAgotado(cupon: CuponParaEstado): boolean {
  return cupon.maxTotal != null && cupon.canjesCount >= cupon.maxTotal;
}

/**
 * Estado de UN cupón para el cajero, sin mirar los topes por persona (esos
 * necesitan contar en la base y se resuelven fuera).
 *
 * El orden importa y es el de la especificación: el motivo global gana sobre
 * todo; luego el interruptor del negocio sobre el del aliado —porque es el
 * accionable para quien tiene al cliente delante: puede llamar a su dueño, no
 * a la empresa aliada—; después la fecha y por último el tope global.
 *
 * Devuelve el motivo en castellano y accionable, nunca un código.
 */
export function motivoDelCupon(
  cupon: CuponParaEstado,
  ahora: Date,
  motivoGlobal: string | null,
): string | null {
  if (motivoGlobal) return motivoGlobal;

  const apagado = quienApago(cupon);
  // Con las dos llaves apagadas gana el mensaje del negocio: es quien puede
  // resolverlo en el momento.
  if (apagado === 'negocio' || apagado === 'ambos') {
    return 'Beneficio apagado por el negocio.';
  }
  if (apagado === 'aliado') {
    return 'Beneficio apagado por la empresa aliada.';
  }
  if (cupon.endsAt && cupon.endsAt <= ahora) return 'Este cupón ya venció.';
  // Agotado va DESPUÉS de los interruptores pero se calcula, no se guarda: el
  // auto-apagado que había antes escribía isActive=false al llegar al tope, y
  // entonces el cajero leía «apagado por el negocio» —falso— y subir el tope no
  // reabría el cupón, sin que nadie entendiera por qué.
  if (estaAgotado(cupon)) return 'Se agotaron los canjes de este cupón.';
  return null;
}

/**
 * Qué pinta el PASE del empleado en la billetera.
 *
 * Tres decisiones deliberadas:
 *  · Al empleado no se le dice CUÁL de las dos empresas apagó su beneficio.
 *    Eso es política entre ellas; a él le basta «en pausa» y a quién preguntar.
 *  · Los topes por persona NO se pintan: cambian solos a medianoche y el pase
 *    no recibe push a esa hora, así que cualquier texto sería mentira a las
 *    pocas horas.
 *  · El QR sigue escaneable siempre. La verdad la dice el servidor en caja.
 */
export function estadoDelPase(
  convenio: ConvenioParaEstado,
  cupones: CuponParaEstado[],
  tarjetaBloqueada: boolean,
  ahora: Date,
): 'ACTIVO' | 'PAUSA' | 'FINALIZADO' | 'BLOQUEADA' {
  if (tarjetaBloqueada) return 'BLOQUEADA';
  if (convenio.status === 'FINISHED') return 'FINALIZADO';
  if (convenio.endsAt && convenio.endsAt <= ahora) return 'FINALIZADO';
  if (convenio.status === 'PAUSED') return 'PAUSA';
  const vivos = cupones.filter(
    (c) => motivoDelCupon(c, ahora, null) === null,
  );
  return vivos.length > 0 ? 'ACTIVO' : 'PAUSA';
}

/**
 * ¿Hace falta empujar el pase tras tocar un interruptor?
 *
 * Solo si cambió el estado EFECTIVO. Encender la llave del aliado mientras la
 * del negocio sigue apagada no cambia nada de lo que el empleado ve, y empujar
 * por eso gasta cuota de Apple/Google y hace vibrar teléfonos sin motivo.
 */
export function cambiaLoQueSeVe(
  antes: CuponParaEstado,
  despues: CuponParaEstado,
  ahora: Date,
): boolean {
  return (
    (motivoDelCupon(antes, ahora, null) === null) !==
    (motivoDelCupon(despues, ahora, null) === null)
  );
}

/** Texto de lo que el cajero tiene que aplicar, en una línea. */
export function describirBeneficio(
  tipo: string,
  valor: number,
  nombre: string,
): string {
  switch (tipo) {
    case 'PERCENT_OFF':
      return `Aplicar ${valor}% de descuento`;
    case 'AMOUNT_OFF':
      return `Aplicar $${valor.toLocaleString('es-CO')} de descuento`;
    case 'FREEBIE':
      return `Entregar gratis: ${nombre}`;
    case 'TWO_FOR_ONE':
      return `2x1 en: ${nombre}`;
    default:
      return nombre;
  }
}

/**
 * El beneficio en corto, para el PASE del empleado.
 *
 * Distinto de `describirBeneficio`, que habla en imperativo al cajero
 * («Aplicar 10% de descuento»). En la tarjeta de quien lo recibe eso suena a
 * instrucción ajena: ahí va lo que gana, «10% de descuento».
 */
export function describirBeneficioCorto(
  tipo: string,
  valor: number,
  nombre: string,
): string {
  switch (tipo) {
    case 'PERCENT_OFF':
      return `${valor}% de descuento`;
    case 'AMOUNT_OFF':
      return `$${valor.toLocaleString('es-CO')} de descuento`;
    case 'FREEBIE':
      return `${nombre} gratis`;
    case 'TWO_FOR_ONE':
      return `2x1 en ${nombre}`;
    default:
      return nombre;
  }
}

/**
 * Normaliza un documento de identidad para comparar y para el índice único.
 *
 * Sin espacios, puntos ni guiones y en mayúsculas: la misma cédula escrita
 * «1.020.304-5», «10203045» y «1 020 304 5» tiene que colisionar, o el índice
 * único no sirve de nada y la misma persona activa el convenio tres veces.
 */
export function normalizarDocumento(s: string | null | undefined): string | null {
  if (!s) return null;
  const limpio = s
    .normalize('NFKC')
    .replace(/[\s.\-_/]/g, '')
    .toUpperCase();
  return limpio || null;
}

/** Normaliza el código del convenio: mayúsculas y sin espacios, como dice el
 *  esquema. Se compara así en los dos lados. */
export function normalizarCodigo(s: string | null | undefined): string | null {
  if (!s) return null;
  const limpio = s.replace(/\s/g, '').toUpperCase();
  return limpio || null;
}

/** Normaliza un correo para la lista blanca: minúsculas y sin espacios. */
export function normalizarEmail(s: string | null | undefined): string | null {
  if (!s) return null;
  const limpio = s.trim().toLowerCase();
  return limpio || null;
}
