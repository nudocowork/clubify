/**
 * Suscripciones de Hotmart que necesitan que alguien haga algo.
 *
 * Nace del 2026-10-16: en una revisión a mano apareció Café Macondo con DOS
 * suscripciones en Hotmart. La nueva (D99G58Q2, administracion@…, mensual)
 * paga y está vinculada al negocio; la vieja (JSLQIK9H, sergio.flores@…,
 * trimestral) lleva días en «Retraso»: Hotmart le reintenta el cobro a diario y
 * nos manda un PURCHASE_DELAYED cada vez, que no casa con ningún negocio y se
 * queda en `tenant_not_found` sin que nadie lo vea. En palabras del dueño:
 * «si tú no revisas no nos enteramos».
 *
 * Ningún sitio da error: cada aviso se guarda en `HotmartWebhookEvent` y el
 * webhook responde 200. El problema solo se ve CRUZANDO los avisos entre sí y
 * con los negocios, que es lo que hace esto. Dos casos:
 *
 *  · DOBLE: un negocio con dos o más códigos de suscriptor vivos. Lo normal es
 *    que una sea vieja y el cliente no se acuerde; si las dos cobran, le
 *    estamos cobrando dos veces (y eso acaba en reembolso y queja).
 *  · HUÉRFANA: un código que cobra o reintenta y no es de ningún negocio.
 *
 * Es una función PURA a propósito: la base y los mensajes los pone el servicio
 * (`alertas-de-suscripcion.service.ts`). Lo delicado —qué es ruido, a qué
 * negocio pertenece un código, cuál es la activa— se prueba solo.
 */

/** Lo que guarda `HotmartWebhookEvent`, con el payload sin tipar (Json). */
export type EventoGuardado = {
  eventType: string;
  tenantId: string | null;
  processedAt: Date;
  payload: unknown;
};

export type NegocioParaAlertas = {
  id: string;
  brandName: string;
  email: string | null;
  phone?: string | null;
  whatsappPhone?: string | null;
  hotmartSubscriberCode: string | null;
  deletedAt?: Date | null;
  /** Correos de los usuarios dueños (TENANT_OWNER). El comprador de Hotmart
   *  suele ser el dueño y no el correo de contacto del negocio. */
  correosDeDuenos?: string[];
};

export type EntradaDeteccion = {
  eventos: EventoGuardado[];
  negocios: NegocioParaAlertas[];
  ahora: Date;
  /** Productos que NO son suscripciones de un negocio: packs de créditos de
   *  marca (HotmartCreditLink) y planes de la cuponera (MembershipPlan). */
  productosAjenos?: Iterable<string>;
  /** Productos que sí son de negocio aunque nadie los haya pagado en la
   *  ventana (los `HOTMART_PRODUCT_ID*` del entorno). */
  productosDeNegocio?: Iterable<string>;
  /** Códigos que son de un grupo empresarial (`BusinessGroup`): cobran al
   *  grupo y no a un negocio, así que no están «huérfanos». */
  codigosDeGrupos?: Iterable<string>;
  /** Códigos con un pago guardado en «Pagos sin activar» sin consumir: ese
   *  caso ya tiene su pantalla y su recordatorio, aquí sería ruido repetido. */
  codigosPendientesDeActivar?: Iterable<string>;
};

export type EstadoDeSuscripcion = 'al_dia' | 'en_retraso';

export type SuscripcionEnAlerta = {
  codigo: string;
  /** Correos con que paga (normalmente uno; Hotmart deja cambiarlo). */
  correos: string[];
  telefono: string | null;
  plan: string | null;
  producto: string | null;
  estado: EstadoDeSuscripcion;
  /** Es el `hotmartSubscriberCode` del negocio. */
  vinculada: boolean;
  /** Reintentos de cobro (DELAYED / boleto) dentro de la ventana. */
  reintentos: number;
  ultimoPago: string | null;
  ultimoEvento: string;
  ultimaFecha: string;
};

export type VinculoDelNegocio =
  /** El código es el `hotmartSubscriberCode` del negocio. */
  | 'codigo'
  /** El webhook resolvió el negocio y lo apuntó en el evento. */
  | 'evento'
  /** El comprador paga con el correo del negocio o de su dueño. */
  | 'correo'
  /** Mismo dominio de empresa y mismo teléfono. */
  | 'dominio_y_telefono'
  /** Mismo dominio de empresa y ningún otro negocio lo comparte. */
  | 'dominio';

export type AlertaDeSuscripcion = {
  /** Estable entre pasadas: es lo que se marca como revisado y como avisado.
   *  Lleva los códigos dentro, así que si aparece un tercero es otra alerta. */
  id: string;
  tipo: 'DOBLE_SUSCRIPCION' | 'SUSCRIPCION_HUERFANA';
  gravedad: 'alta' | 'media';
  negocio: { id: string; nombre: string; vinculo: VinculoDelNegocio; eliminado: boolean } | null;
  suscripciones: SuscripcionEnAlerta[];
  ultimoEvento: string;
  ultimaFecha: string;
  titulo: string;
  recomendacion: string;
};

export const DIAS_DE_VENTANA = 45;

const PAGOS = new Set(['PURCHASE_APPROVED', 'PURCHASE_COMPLETE']);
const REINTENTOS = new Set(['PURCHASE_DELAYED', 'PURCHASE_BILLET_PRINTED']);
/** Lo que da por terminada una suscripción. Un cobro POSTERIOR la revive
 *  (Hotmart deja reactivar), por eso se compara la fecha y no la presencia. */
const FINALES = new Set([
  'SUBSCRIPTION_CANCELLATION',
  'PURCHASE_REFUNDED',
  'PURCHASE_CHARGEBACK',
  'PURCHASE_CANCELED',
  'PURCHASE_EXPIRED',
]);

/** Los eventos que le interesan a la detección (para filtrar en la consulta). */
export const EVENTOS_QUE_MIRA = [...PAGOS, ...REINTENTOS, ...FINALES];

/**
 * Dominios donde compartir dominio no dice nada: dos clientes con @gmail.com
 * no son el mismo negocio. Solo un dominio PROPIO (cafemacondo.cl) es señal.
 */
const DOMINIOS_PUBLICOS = [
  /^gmail\./, /^googlemail\./, /^hotmail\./, /^outlook\./, /^live\./, /^msn\./,
  /^yahoo\./, /^ymail\./, /^icloud\./, /^me\.com$/, /^mac\.com$/, /^aol\./,
  /^proton(mail)?\./, /^pm\.me$/, /^gmx\./, /^zoho\./, /^yandex\./, /^mail\./,
];

/** El nombre del producto de la plataforma. Es el mismo criterio que la
 *  conciliación (`scripts/conciliar-hotmart-comisiones.cjs`). */
const NOMBRE_DE_LA_PLATAFORMA = /clubify/i;

type Leido = {
  tipo: string;
  tenantId: string | null;
  fecha: Date;
  codigo: string | null;
  correo: string | null;
  telefono: string | null;
  productoId: string | null;
  productoNombre: string | null;
  plan: string | null;
};

/**
 * Lee lo mismo que `codigoDeSuscriptor` y `correoDelComprador` de
 * hotmart.service.ts (las dos formas del payload: compra y cancelación). Se
 * copia en vez de importarse para que esto siga siendo puro y no arrastre el
 * servicio entero a los tests; si cambia una ruta allí, hay que cambiarla aquí.
 */
function leer(e: EventoGuardado): Leido {
  const p = (e.payload ?? {}) as Record<string, any>;
  const d = (p.data ?? {}) as Record<string, any>;
  const codigo = d.subscription?.subscriber?.code ?? d.subscriber?.code ?? null;
  const correo = d.buyer?.email ?? d.subscriber?.email ?? null;
  const b = d.buyer ?? {};
  const telefono =
    b.checkout_phone ??
    (b.phone_local_code && b.phone ? `${b.phone_local_code}${b.phone}` : null) ??
    b.phone ??
    b.phone_number ??
    null;
  const productoId = d.product?.id;
  return {
    tipo: e.eventType,
    tenantId: e.tenantId,
    fecha: e.processedAt,
    codigo: codigo ? String(codigo).trim() : null,
    correo: correo ? String(correo).trim().toLowerCase() : null,
    telefono: telefono ? String(telefono) : null,
    productoId: productoId === undefined || productoId === null ? null : String(productoId),
    productoNombre: d.product?.name ? String(d.product.name) : null,
    plan: d.subscription?.plan?.name ? String(d.subscription.plan.name) : null,
  };
}

/** Los últimos 10 dígitos: así casan «+57 300…», «57300…» y «300…». Con
 *  menos de 7 dígitos no es un teléfono que sirva para comparar. */
export function telefonoComparable(t: string | null | undefined): string | null {
  const dig = (t ?? '').replace(/\D/g, '');
  if (dig.length < 7) return null;
  return dig.slice(-10);
}

export function dominioDeEmpresa(correo: string | null | undefined): string | null {
  const at = (correo ?? '').lastIndexOf('@');
  if (at < 0) return null;
  const dom = correo!.slice(at + 1).trim().toLowerCase();
  if (!dom || DOMINIOS_PUBLICOS.some((r) => r.test(dom))) return null;
  return dom;
}

const fechaCorta = (d: Date) =>
  d.toLocaleDateString('es-CO', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'America/Bogota',
  });

type Grupo = {
  codigo: string;
  eventos: Leido[];
  /** Negocio del `hotmartSubscriberCode`, si lo hay. */
  delCodigo: NegocioParaAlertas | null;
};

export function detectarAlertasDeSuscripcion(
  entrada: EntradaDeteccion,
): AlertaDeSuscripcion[] {
  const desde = entrada.ahora.getTime() - DIAS_DE_VENTANA * 86_400_000;
  const ajenos = new Set(entrada.productosAjenos ?? []);
  const deGrupos = new Set(entrada.codigosDeGrupos ?? []);
  const pendientes = new Set(entrada.codigosPendientesDeActivar ?? []);
  const negocioPorId = new Map(entrada.negocios.map((n) => [n.id, n]));
  const negocioPorCodigo = new Map<string, NegocioParaAlertas>();
  for (const n of entrada.negocios) {
    if (n.hotmartSubscriberCode) negocioPorCodigo.set(n.hotmartSubscriberCode.trim(), n);
  }

  const leidos = entrada.eventos
    .filter((e) => e.processedAt.getTime() >= desde)
    .map(leer)
    .filter((l): l is Leido & { codigo: string } => !!l.codigo);

  // Qué productos son de un negocio: los del entorno, y los que paga algún
  // código que YA es el `hotmartSubscriberCode` de un negocio. No vale el
  // `tenantId` del evento: el webhook lo resuelve también por correo, así que
  // un dueño que además compró Master Creativo con su correo dejaría ese
  // producto marcado como «de negocio» y su curso saldría como segunda
  // suscripción.
  const deNegocio = new Set(entrada.productosDeNegocio ?? []);
  for (const l of leidos) {
    if (l.productoId && negocioPorCodigo.has(l.codigo) && !ajenos.has(l.productoId)) {
      deNegocio.add(l.productoId);
    }
  }
  const esRelevante = (l: Leido & { codigo: string }): boolean => {
    if (l.productoId && ajenos.has(l.productoId)) return false;
    if (negocioPorCodigo.has(l.codigo)) return true;
    if (l.productoId || l.productoNombre) {
      // Producto conocido: decide el producto, no el vínculo. Es el filtro de
      // Master Creativo, Automatización de WhatsApp y demás productos del
      // mismo productor que llegan al mismo webhook.
      return (
        (!!l.productoId && deNegocio.has(l.productoId)) ||
        NOMBRE_DE_LA_PLATAFORMA.test(l.productoNombre ?? '')
      );
    }
    // Sin producto (algunas cancelaciones): solo cuenta si el webhook lo casó.
    return !!l.tenantId;
  };

  const grupos = new Map<string, Grupo>();
  for (const l of leidos) {
    if (deGrupos.has(l.codigo) || !esRelevante(l)) continue;
    let g = grupos.get(l.codigo);
    if (!g) {
      g = { codigo: l.codigo, eventos: [], delCodigo: negocioPorCodigo.get(l.codigo) ?? null };
      grupos.set(l.codigo, g);
    }
    g.eventos.push(l);
  }

  type Viva = {
    g: Grupo;
    sus: SuscripcionEnAlerta;
    negocio: NegocioParaAlertas | null;
    vinculo: VinculoDelNegocio | null;
    soloPagosSinVincular: boolean;
  };
  const vivas: Viva[] = [];
  for (const g of grupos.values()) {
    g.eventos.sort((a, b) => a.fecha.getTime() - b.fecha.getTime());
    const cobros = g.eventos.filter((e) => PAGOS.has(e.tipo) || REINTENTOS.has(e.tipo));
    if (!cobros.length) continue;
    const ultimoCobro = cobros[cobros.length - 1];
    const ultimoFinal = [...g.eventos].reverse().find((e) => FINALES.has(e.tipo));
    // Cancelada o devuelta después del último cobro: ya no cobra, no molesta.
    if (ultimoFinal && ultimoFinal.fecha.getTime() >= ultimoCobro.fecha.getTime()) continue;

    const pagos = cobros.filter((e) => PAGOS.has(e.tipo));
    const ultimoPago = pagos.length ? pagos[pagos.length - 1] : null;
    const ultimo = g.eventos[g.eventos.length - 1];
    const correos = [...new Set(g.eventos.map((e) => e.correo).filter((c): c is string => !!c))];
    const telefono = [...g.eventos].reverse().find((e) => e.telefono)?.telefono ?? null;
    const conDatos = [...g.eventos].reverse();

    const sus: SuscripcionEnAlerta = {
      codigo: g.codigo,
      correos,
      telefono,
      plan: conDatos.find((e) => e.plan)?.plan ?? null,
      producto: conDatos.find((e) => e.productoNombre)?.productoNombre ?? null,
      estado: REINTENTOS.has(ultimoCobro.tipo) ? 'en_retraso' : 'al_dia',
      vinculada: !!g.delCodigo,
      reintentos: cobros.filter((e) => REINTENTOS.has(e.tipo)).length,
      ultimoPago: ultimoPago ? ultimoPago.fecha.toISOString() : null,
      ultimoEvento: ultimo.tipo,
      ultimaFecha: ultimo.fecha.toISOString(),
    };

    let negocio: NegocioParaAlertas | null = g.delCodigo;
    let vinculo: VinculoDelNegocio | null = negocio ? 'codigo' : null;
    if (!negocio) {
      const tid = [...g.eventos].reverse().find((e) => e.tenantId)?.tenantId;
      const n = tid ? negocioPorId.get(tid) : undefined;
      if (n) {
        negocio = n;
        vinculo = 'evento';
      }
    }
    vivas.push({
      g,
      sus,
      negocio,
      vinculo,
      soloPagosSinVincular: sus.reintentos === 0,
    });
  }

  // Inferir el negocio de lo que no casó: primero el correo exacto, después el
  // dominio propio. Se hace DESPUÉS de juntar todo porque el teléfono a
  // comparar puede venir de otro código del mismo negocio (el de la
  // suscripción buena).
  const telefonosDe = (n: NegocioParaAlertas): Set<string> => {
    const s = new Set<string>();
    for (const t of [n.phone, n.whatsappPhone]) {
      const c = telefonoComparable(t);
      if (c) s.add(c);
    }
    for (const v of vivas) {
      if (v.negocio?.id !== n.id) continue;
      const c = telefonoComparable(v.sus.telefono);
      if (c) s.add(c);
    }
    return s;
  };
  const correosDe = (n: NegocioParaAlertas) =>
    [n.email, ...(n.correosDeDuenos ?? [])]
      .filter((c): c is string => !!c)
      .map((c) => c.trim().toLowerCase());
  const vivos = entrada.negocios.filter((n) => !n.deletedAt);
  for (const v of vivas) {
    if (v.negocio) continue;
    const porCorreo = vivos.filter((n) => correosDe(n).some((c) => v.sus.correos.includes(c)));
    if (porCorreo.length === 1) {
      v.negocio = porCorreo[0];
      v.vinculo = 'correo';
      continue;
    }
    const dominios = new Set(v.sus.correos.map(dominioDeEmpresa).filter((d): d is string => !!d));
    if (!dominios.size) continue;
    const porDominio = vivos.filter((n) =>
      correosDe(n).some((c) => {
        const d = dominioDeEmpresa(c);
        return !!d && dominios.has(d);
      }),
    );
    if (!porDominio.length) continue;
    const tel = telefonoComparable(v.sus.telefono);
    const conTelefono = tel ? porDominio.filter((n) => telefonosDe(n).has(tel)) : [];
    if (conTelefono.length === 1) {
      v.negocio = conTelefono[0];
      v.vinculo = 'dominio_y_telefono';
    } else if (porDominio.length === 1) {
      // Un solo negocio con ese dominio propio: es suyo casi seguro, pero se
      // dice «parece» en la alerta. Con dos negocios del mismo dominio (dos
      // sedes) no se adivina.
      v.negocio = porDominio[0];
      v.vinculo = 'dominio';
    }
  }

  const alertas: AlertaDeSuscripcion[] = [];
  const porNegocio = new Map<string, Viva[]>();
  for (const v of vivas) {
    if (!v.negocio) continue;
    porNegocio.set(v.negocio.id, [...(porNegocio.get(v.negocio.id) ?? []), v]);
  }
  const yaEnDoble = new Set<string>();

  for (const [, lista] of porNegocio) {
    if (lista.length < 2) continue;
    const n = lista[0].negocio!;
    for (const v of lista) yaEnDoble.add(v.g.codigo);
    alertas.push(alertaDoble(n, lista.map((v) => v.sus), vinculoMasDebil(lista)));
  }

  for (const v of vivas) {
    if (yaEnDoble.has(v.g.codigo)) continue;
    const vinculadaDeVerdad = v.vinculo === 'codigo' || v.vinculo === 'evento';
    if (vinculadaDeVerdad && !v.negocio?.deletedAt) continue;
    // Un primer pago sin cuenta ya está en «Pagos sin activar», con sus
    // recordatorios: repetirlo aquí enseña al equipo a ignorar las alertas.
    if (v.soloPagosSinVincular && pendientes.has(v.g.codigo)) continue;
    alertas.push(alertaHuerfana(v.sus, v.negocio, v.vinculo));
  }

  // Lo grave arriba; dentro, lo más reciente primero.
  return alertas.sort(
    (a, b) =>
      (a.gravedad === b.gravedad ? 0 : a.gravedad === 'alta' ? -1 : 1) ||
      b.ultimaFecha.localeCompare(a.ultimaFecha),
  );
}

const ORDEN_VINCULO: VinculoDelNegocio[] = ['codigo', 'evento', 'correo', 'dominio_y_telefono', 'dominio'];
function vinculoMasDebil(lista: Array<{ vinculo: VinculoDelNegocio | null }>): VinculoDelNegocio {
  let peor = 0;
  for (const v of lista) peor = Math.max(peor, ORDEN_VINCULO.indexOf(v.vinculo ?? 'dominio'));
  return ORDEN_VINCULO[peor];
}

function describir(s: SuscripcionEnAlerta): string {
  const correo = s.correos[0] ?? 'sin correo';
  const plan = s.plan ? `, ${s.plan}` : '';
  const estado =
    s.estado === 'en_retraso'
      ? `, en retraso: ${s.reintentos} reintento${s.reintentos === 1 ? '' : 's'} de cobro`
      : s.ultimoPago
        ? `, último pago el ${fechaCorta(new Date(s.ultimoPago))}`
        : '';
  return `${s.codigo} (${correo}${plan}${estado})`;
}

function alertaDoble(
  n: NegocioParaAlertas,
  subs: SuscripcionEnAlerta[],
  vinculo: VinculoDelNegocio,
): AlertaDeSuscripcion {
  const ordenadas = [...subs].sort((a, b) => a.codigo.localeCompare(b.codigo));
  // La que se conserva: la vinculada si está al día; si no, la que pagó más
  // reciente. Es lo que el equipo haría a mano mirando Hotmart.
  const alDia = ordenadas.filter((s) => s.estado === 'al_dia');
  const activa =
    alDia.find((s) => s.vinculada) ??
    [...alDia].sort((a, b) => (b.ultimoPago ?? '').localeCompare(a.ultimoPago ?? ''))[0] ??
    null;
  const sobran = ordenadas.filter((s) => s !== activa);
  const cobraDoble = alDia.length >= 2;
  const ultima = [...ordenadas].sort((a, b) => b.ultimaFecha.localeCompare(a.ultimaFecha))[0];
  const parece = vinculo === 'dominio' ? ' (por el dominio del correo: confírmalo con el negocio)' : '';

  let recomendacion: string;
  if (!activa) {
    recomendacion =
      `Ninguna de las ${ordenadas.length} suscripciones está al día: ${ordenadas.map(describir).join('; ')}. ` +
      `Pregúntale a ${n.brandName} con cuál se queda, cancela en Hotmart las demás y vincula esa al negocio.`;
  } else {
    recomendacion =
      `Cancelar en Hotmart ${sobran.length === 1 ? 'la suscripción' : 'las suscripciones'} ` +
      `${sobran.map(describir).join('; ')}; la activa es ${describir(activa)}.` +
      (cobraDoble ? ' Ojo: las dos están cobrando, revisa si toca devolver un pago.' : '') +
      (!activa.vinculada ? ` Después vincula ${activa.codigo} al negocio.` : '');
  }

  return {
    id: `doble:${n.id}:${ordenadas.map((s) => s.codigo).join('+')}`,
    tipo: 'DOBLE_SUSCRIPCION',
    gravedad: cobraDoble || ordenadas.some((s) => s.estado === 'en_retraso') ? 'alta' : 'media',
    negocio: { id: n.id, nombre: n.brandName, vinculo, eliminado: !!n.deletedAt },
    suscripciones: ordenadas,
    ultimoEvento: ultima.ultimoEvento,
    ultimaFecha: ultima.ultimaFecha,
    titulo: `${n.brandName} tiene ${ordenadas.length} suscripciones en Hotmart${parece}`,
    recomendacion,
  };
}

function alertaHuerfana(
  s: SuscripcionEnAlerta,
  n: NegocioParaAlertas | null,
  vinculo: VinculoDelNegocio | null,
): AlertaDeSuscripcion {
  const correo = s.correos[0] ?? 'sin correo';
  const cobra =
    s.estado === 'en_retraso'
      ? `Hotmart le reintenta el cobro (${s.reintentos} reintento${s.reintentos === 1 ? '' : 's'})`
      : 'Hotmart la está cobrando';
  let titulo: string;
  let recomendacion: string;
  if (n?.deletedAt) {
    titulo = `Suscripción ${s.codigo} sigue cobrando y su negocio ${n.brandName} está eliminado`;
    recomendacion = `${cobra} a ${correo} y el negocio ya no existe en Clubify. Cancelarla en Hotmart, salvo que el negocio se vaya a recuperar.`;
  } else if (n) {
    const como =
      vinculo === 'correo'
        ? 'paga con el correo del negocio'
        : vinculo === 'dominio_y_telefono'
          ? 'tiene el mismo dominio de correo y el mismo teléfono'
          : 'tiene el mismo dominio de correo';
    titulo = `Suscripción ${s.codigo} sin vincular; parece de ${n.brandName}`;
    recomendacion =
      `${cobra} a ${correo} y no está vinculada a ningún negocio; ${como} que ${n.brandName}. ` +
      (n.hotmartSubscriberCode
        ? `${n.brandName} ya tiene vinculada ${n.hotmartSubscriberCode}, que no cobra estos días: confirma con el negocio cuál conserva y cancela la otra en Hotmart.`
        : `Confírmalo con el negocio y vincula ${s.codigo} a ${n.brandName}, o cancélala en Hotmart si no es suya.`);
  } else {
    titulo = `Suscripción ${s.codigo} cobra y no es de ningún negocio`;
    recomendacion =
      `${cobra} a ${correo}${s.plan ? ` (${s.plan})` : ''} y no casa con ningún negocio de Clubify. ` +
      'Busca a ese comprador: si ya paga por otra suscripción, cancela esta en Hotmart; si es un negocio nuevo o con otro correo, asígnale el pago desde «Pagos sin activar».';
  }
  return {
    id: `huerfana:${s.codigo}`,
    tipo: 'SUSCRIPCION_HUERFANA',
    gravedad: s.estado === 'en_retraso' || n?.deletedAt ? 'alta' : 'media',
    negocio: n && vinculo ? { id: n.id, nombre: n.brandName, vinculo, eliminado: !!n.deletedAt } : null,
    suscripciones: [s],
    ultimoEvento: s.ultimoEvento,
    ultimaFecha: s.ultimaFecha,
    titulo,
    recomendacion,
  };
}

/** Las alertas que todavía no se han avisado ni revisado. */
export function alertasNuevas(
  alertas: AlertaDeSuscripcion[],
  yaVistas: Iterable<string>,
): AlertaDeSuscripcion[] {
  const vistas = new Set(yaVistas);
  return alertas.filter((a) => !vistas.has(a.id));
}

/**
 * El SMS del resumen. Corto a propósito: un SMS largo se parte en varios y en
 * WhatsApp se lee mal; el detalle está en el panel. Sin tildes raras ni emojis
 * de más: sale por el mismo canal que los demás avisos del equipo.
 */
export function textoDelResumen(nuevas: AlertaDeSuscripcion[], enlace: string): string {
  const MAX = 3;
  const lineas = nuevas.slice(0, MAX).map((a) => `- ${a.titulo}. ${a.recomendacion}`);
  const resto = nuevas.length - MAX;
  return [
    `Clubify - suscripciones de Hotmart que revisar: ${nuevas.length} nueva${nuevas.length === 1 ? '' : 's'}.`,
    ...lineas,
    ...(resto > 0 ? [`Y ${resto} más.`] : []),
    `Detalle y «Marcar como revisada»: ${enlace}`,
  ].join('\n');
}
