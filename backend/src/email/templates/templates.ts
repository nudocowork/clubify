import {
  identidadDeMarca,
  maquetarCorreo,
  type ContenidoDelCorreo,
  type IdentidadDeCorreo,
  type MarcaParaCorreo,
} from '../maquetador';

/**
 * Correos con texto propio: los que NO viven en el catálogo de
 * Automatizaciones (bienvenida, contraseña, afiliados, pedidos, equipo).
 *
 * Aquí solo se decide el TEXTO y QUIÉN FIRMA; el HTML lo pone `maquetarCorreo`,
 * igual que en el resto de los correos. No volver a escribir HTML a mano en
 * este archivo: así se colaron el verde de Clubify en correos de Sellea, los
 * recuadros con degradado que Outlook deja en blanco y los nombres de cliente
 * sin escapar dentro del HTML.
 *
 * Quién firma:
 *  - Lo que un NEGOCIO manda a sus clientes o a su equipo (pedidos, alta de
 *    personal) lo firma el negocio, con «Hecho con <marca>» si hay marca.
 *  - Lo que manda la MARCA (bienvenida, contraseña, afiliados, cuenta activa)
 *    lo firma la marca. Sin marca resuelta no se escribe ningún nombre de
 *    plataforma: antes caía a «Clubify» también en usuarios de marca blanca.
 */

/** Negocio que firma el correo. */
export type Tenant = {
  brandName: string;
  logoUrl: string | null;
  primaryColor: string | null;
  whatsappPhone: string | null;
  slug: string;
};

/**
 * Marca que firma. Con solo `name` el correo lleva el nombre en texto y colores
 * neutros; con logo y colores, su identidad completa.
 */
export type MarcaDeCorreo = MarcaParaCorreo & { name: string };

const COP = (n: number) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(n);

function identidadDeNegocio(t: Tenant | null | undefined): IdentidadDeCorreo | null {
  const nombre = (t?.brandName ?? '').trim();
  if (!nombre) return null;
  // El logo de un negocio no tiene proporción garantizada: va como ícono junto
  // a su nombre. El color sí es suyo: el de su carta y su página pública.
  return { nombre, iconoUrl: t?.logoUrl ?? null, color: t?.primaryColor ?? null };
}

function creditoDe(brand: { name?: string | null } | null | undefined): string | null {
  const nombre = (brand?.name ?? '').trim();
  return nombre ? `Hecho con ${nombre}` : null;
}

const primerNombre = (completo: string | null | undefined): string =>
  (completo ?? '').trim().split(/\s+/)[0] ?? '';

// ─────────── Pedidos (el negocio a su cliente) ───────────

export function orderCreatedTemplate(args: {
  tenant: Tenant;
  customerName: string;
  code: string;
  total: number;
  items: { name: string; qty: number; lineTotal: number }[];
  trackingUrl: string;
  brand?: { name: string } | null;
}) {
  const filas = args.items.map((i) => ({
    etiqueta: `${i.qty}× ${i.name}`,
    valor: COP(i.lineTotal),
  }));
  return {
    subject: `Pedido #${args.code} recibido — ${args.tenant.brandName}`,
    text: `Hola ${args.customerName}, recibimos tu pedido #${args.code} por ${COP(args.total)}. Te avisaremos en cuanto esté listo. Síguelo aquí: ${args.trackingUrl}`,
    html: maquetarCorreo({
      identidad: identidadDeNegocio(args.tenant),
      preheader: `Tu pedido #${args.code} ya está en cola`,
      antetitulo: `Pedido #${args.code}`,
      titulo: `¡Gracias por tu pedido, ${args.customerName}! 🎉`,
      bloques: [
        {
          tipo: 'texto',
          texto: `Recibimos tu pedido **#${args.code}**. Te avisaremos cuando lo confirmemos y cuando esté listo.`,
        },
        {
          tipo: 'datos',
          filas: [...filas, { etiqueta: 'Total', valor: COP(args.total), fuerte: true }],
        },
      ],
      boton: { texto: 'Seguir mi pedido →', url: args.trackingUrl },
      credito: creditoDe(args.brand),
    }),
  };
}

export function orderConfirmedTemplate(args: {
  tenant: Tenant;
  customerName: string;
  code: string;
  trackingUrl: string;
  brand?: { name: string } | null;
}) {
  return {
    subject: `Pedido #${args.code} confirmado · estamos preparándolo`,
    text: `Tu pedido #${args.code} fue confirmado. Te avisaremos cuando esté listo.`,
    html: maquetarCorreo({
      identidad: identidadDeNegocio(args.tenant),
      preheader: 'Tu pedido fue confirmado',
      antetitulo: `Pedido #${args.code}`,
      titulo: 'Tu pedido fue confirmado ✅',
      bloques: [
        {
          tipo: 'texto',
          texto: `Hola ${args.customerName}, ya estamos preparando tu pedido **#${args.code}**. Te volvemos a escribir cuando esté listo.`,
        },
      ],
      boton: { texto: 'Seguir el pedido →', url: args.trackingUrl },
      credito: creditoDe(args.brand),
    }),
  };
}

export function orderReadyTemplate(args: {
  tenant: Tenant;
  customerName: string;
  code: string;
  brand?: { name: string } | null;
}) {
  return {
    subject: `Tu pedido #${args.code} está listo 🎉`,
    text: `Tu pedido #${args.code} está listo para retirar.`,
    html: maquetarCorreo({
      identidad: identidadDeNegocio(args.tenant),
      preheader: '¡Pedido listo para retirar!',
      antetitulo: `Pedido #${args.code}`,
      titulo: '¡Tu pedido está listo! 🎉',
      bloques: [
        {
          tipo: 'texto',
          texto: `Hola ${args.customerName}, tu pedido **#${args.code}** ya está esperándote.`,
        },
      ],
      credito: creditoDe(args.brand),
    }),
  };
}

// ─────────── Equipo del negocio ───────────

export function welcomeStaffTemplate(args: {
  tenant: Tenant;
  fullName: string;
  email: string;
  tempPassword: string;
  loginUrl: string;
  brand?: { name: string } | null;
}) {
  return {
    subject: `Bienvenido al equipo de ${args.tenant.brandName}`,
    text: `Tu cuenta de ${args.tenant.brandName}\nEmail: ${args.email}\nContraseña temporal: ${args.tempPassword}\nIngresa en: ${args.loginUrl}`,
    html: maquetarCorreo({
      identidad: identidadDeNegocio(args.tenant),
      preheader: `Tu acceso al panel de ${args.tenant.brandName}`,
      antetitulo: 'Acceso al panel',
      titulo: `¡Bienvenido, ${args.fullName}!`,
      bloques: [
        {
          tipo: 'texto',
          texto: `Te crearon una cuenta para gestionar pedidos y clientes en **${args.tenant.brandName}**.`,
        },
        {
          tipo: 'datos',
          filas: [
            { etiqueta: 'Email', valor: args.email },
            { etiqueta: 'Contraseña temporal', valor: args.tempPassword, monoespaciado: true },
          ],
        },
      ],
      boton: { texto: 'Ingresar al panel →', url: args.loginUrl },
      bloquesFinales: [
        {
          tipo: 'nota',
          texto: 'Cambia tu contraseña apenas ingreses. Si recibiste este email por error, ignóralo.',
        },
      ],
      credito: creditoDe(args.brand),
    }),
  };
}

// ─────────── La marca a sus usuarios ───────────

export function passwordResetTemplate(args: {
  fullName: string;
  resetUrl: string;
  expiresInMinutes: number;
  /** Marca blanca del usuario: el correo hereda su nombre, color y logo. */
  brand?: MarcaDeCorreo | null;
}) {
  const identidad = identidadDeMarca(args.brand);
  const enMarca = identidad ? ` en ${identidad.nombre}` : '';
  return {
    subject: `Restablece tu contraseña${enMarca}`,
    text: `Hola ${args.fullName},\nPara restablecer tu contraseña usa este link (vence en ${args.expiresInMinutes} min):\n${args.resetUrl}\nSi no solicitaste esto, ignora este email.`,
    html: maquetarCorreo({
      identidad,
      preheader: `Link válido por ${args.expiresInMinutes} minutos`,
      antetitulo: 'Seguridad de tu cuenta',
      titulo: 'Restablece tu contraseña',
      bloques: [
        {
          tipo: 'texto',
          texto:
            `Hola ${args.fullName}, recibimos una solicitud para cambiar la contraseña de tu cuenta${enMarca}.\n\n` +
            `Da clic en el botón de abajo para crear una nueva. El link vence en **${args.expiresInMinutes} minutos**.`,
        },
      ],
      boton: { texto: 'Restablecer mi contraseña →', url: args.resetUrl },
      enlaceVisible: true,
      bloquesFinales: [
        {
          tipo: 'nota',
          texto: 'Si no solicitaste este cambio, simplemente ignora este email — tu contraseña actual sigue siendo válida.',
        },
      ],
    }),
  };
}

/**
 * Invitación a un afiliado nuevo (influencer/embajador/socio/vendedor). El link
 * lleva al flujo de set-password y, ya logueado, a /affiliate.
 */
export function inviteAffiliateTemplate(args: {
  fullName: string;
  inviteUrl: string;
  role:
    | 'AFFILIATE_INFLUENCER'
    | 'AFFILIATE_AMBASSADOR'
    | 'AFFILIATE_SOCIO'
    | 'AFFILIATE_VENDOR';
  code: string;
  commissionPercent: number;
  campaignName: string | null;
  parentName: string | null;
  /** Marca del afiliado (ReferralCode.whiteLabelId). */
  brand?: MarcaDeCorreo | null;
}) {
  const identidad = identidadDeMarca(args.brand);
  const brandName = identidad?.nombre ?? '';
  const isInfluencer = args.role === 'AFFILIATE_INFLUENCER';
  const isSocio = args.role === 'AFFILIATE_SOCIO';
  const isVendor = args.role === 'AFFILIATE_VENDOR';
  const roleLabel = isSocio
    ? 'socio'
    : isInfluencer
      ? 'influencer'
      : isVendor
        ? 'vendedor'
        : 'embajador';
  // «Eres», no «Sos»: el resto de los correos tutea.
  const greeting = isSocio
    ? `Eres socio${brandName ? ` de ${brandName}` : ''} y recibirás el ${args.commissionPercent}% de TODAS las ventas`
    : isInfluencer
      ? `Te asignamos la campaña ${args.campaignName ?? 'tuya'}`
      : isVendor
        ? `Te invitamos a ser vendedor del equipo de ${args.parentName ?? 'tu embajador'}`
        : `Te invitamos a ser embajador de ${args.parentName ?? 'la campaña'}`;
  const nombre = primerNombre(args.fullName);

  return {
    subject: brandName
      ? `Bienvenido a ${brandName} — eres ${roleLabel} 🎉`
      : `Bienvenido — eres ${roleLabel} 🎉`,
    text: `Hola ${args.fullName},\n${greeting}.\nTu código: ${args.code} (${args.commissionPercent}% de comisión recurrente).\nActiva tu cuenta aquí:\n${args.inviteUrl}\nEl link vence en 7 días.`,
    html: maquetarCorreo({
      identidad,
      preheader: `Tu código: ${args.code} · ${args.commissionPercent}% recurrente`,
      antetitulo: `Invitación de ${roleLabel}`,
      titulo: brandName ? `¡Bienvenido a ${brandName}, ${nombre}!` : `¡Bienvenido, ${nombre}!`,
      bloques: [
        {
          tipo: 'texto',
          texto: `${greeting}. Aquí ganas **${args.commissionPercent}% recurrente** por cada cliente que se registre con tu código.`,
        },
        { tipo: 'codigo', etiqueta: 'Tu código', valor: args.code },
        {
          tipo: 'texto',
          texto: 'Para activar tu cuenta y ver tu panel con clientes y comisiones, haz clic en el botón. **El link vence en 7 días.**',
        },
      ],
      boton: { texto: 'Activar mi cuenta →', url: args.inviteUrl },
      enlaceVisible: true,
    }),
  };
}

export function welcomeOwnerTemplate(args: {
  tenant: Tenant;
  fullName: string;
  trialEndsAt: Date | null;
  appUrl: string;
  /** Marca del negocio (Sellea/Clubify). */
  brand?: MarcaDeCorreo | null;
  /** Link al panel de la marca. Si no viene, cae al panel global. */
  loginUrl?: string;
  /**
   * La cuenta YA quedó pagada al crearse: el comprador pagó primero y creó la
   * cuenta después. Sin esto el correo le pedía «completa el pago» a alguien
   * que acababa de pagar (caso real 2026-08-22, Mr. Pedidos).
   */
  yaPago?: boolean;
}) {
  const firstName = primerNombre(args.fullName);
  // Sin marca resuelta NO se escribe «Clubify»: un negocio de marca blanca
  // leería el nombre de otra plataforma en su propio correo de bienvenida.
  const brandName = args.brand?.name?.trim() || null;
  const enMarca = brandName ? ` en ${brandName}` : '';
  const link = args.loginUrl || `${args.appUrl}/app`;
  const yaPago = args.yaPago === true;
  const negocio = args.tenant.brandName;

  const contenido: ContenidoDelCorreo = {
    preheader: yaPago
      ? `Tu cuenta de ${negocio} ya está activa`
      : `Completa el pago para activar ${negocio}`,
    antetitulo: yaPago ? 'Pago confirmado' : 'Activa tu cuenta',
    titulo: yaPago ? `¡Listo, ${firstName}!` : `¡Bienvenido, ${firstName}!`,
    bloques: [
      {
        tipo: 'texto',
        texto: yaPago
          ? `Recibimos tu pago y tu cuenta de **${negocio}**${enMarca} ya quedó **activa**. No tienes que hacer nada más: entra y empieza.`
          : `Tu cuenta de **${negocio}**${enMarca} ya está creada. Solo falta completar el pago seguro para activarla.`,
      },
      yaPago
        ? { tipo: 'destacado', titulo: 'Tu panel está abierto', texto: 'Ya puedes cargar tu menú y empezar a vender' }
        : { tipo: 'destacado', titulo: 'Pago seguro · activación inmediata', texto: 'Apenas se aprueba entras al panel y empiezas a vender' },
    ],
    boton: { texto: yaPago ? 'Entrar a mi panel →' : 'Ir a mi cuenta →', url: link },
    bloquesFinales: [
      {
        tipo: 'texto',
        texto:
          'Lo siguiente:\n' +
          '1. Sube tu menú (categorías + productos)\n' +
          '2. Personaliza tu tarjeta de fidelización\n' +
          '3. Comparte tu link público en Instagram y WhatsApp\n' +
          '4. Activa la primera automatización (mensaje al cliente)',
      },
      { tipo: 'nota', texto: 'Si te trabas en algo, escríbenos por WhatsApp y te ayudamos en vivo.' },
    ],
    motivo: 'Recibes este correo porque creaste tu cuenta en {marca}.',
  };

  return {
    subject: yaPago
      ? `Tu cuenta ya está activa, ${firstName}`
      : brandName
        ? `Bienvenido a ${brandName}, ${firstName}`
        : `Bienvenido, ${firstName}`,
    text: yaPago
      ? `Tu cuenta de ${negocio} ya está activa. Entra al panel: ${link}`
      : `Tu cuenta de ${negocio} ya está creada. Completa el pago para activarla y entrar al panel: ${link}`,
    html: maquetarCorreo({ ...contenido, identidad: identidadDeMarca(args.brand) }),
    /**
     * Viaja en el mismo spread hasta `BrandEmailService.sendRaw`, que conoce la
     * marca completa y le pone su marco (logo, color, contacto). Quien arma
     * este correo solo sabe el NOMBRE de la marca: sin esto la bienvenida de
     * Sellea saldría sin su logo.
     */
    contenido,
  };
}

/**
 * CUENTA ACTIVADA (pago confirmado) al dueño del negocio, con sus datos de
 * acceso y el link al panel de la marca. Se dispara desde el Onboarding.
 */
export function accountActivatedTemplate(args: {
  tenant: Tenant;
  fullName?: string;
  loginEmail: string;
  loginUrl: string;
  brand?: MarcaDeCorreo | null;
}) {
  const firstName = primerNombre(args.fullName);
  const identidad = identidadDeMarca(args.brand);
  const brandName = identidad?.nombre ?? '';
  const enMarca = brandName ? ` en ${brandName}` : '';
  const hi = firstName ? `¡Listo, ${firstName}!` : '¡Tu cuenta está activa!';
  return {
    subject: `Tu cuenta de ${brandName || args.tenant.brandName} ya está activa 🎉`,
    text: `${hi} Tu cuenta de ${args.tenant.brandName}${enMarca} quedó activa. Ingresa con ${args.loginEmail} en ${args.loginUrl}`,
    html: maquetarCorreo({
      identidad,
      preheader: `Tu cuenta de ${args.tenant.brandName} quedó activa — ya puedes ingresar`,
      antetitulo: 'Cuenta activa',
      titulo: hi,
      bloques: [
        {
          tipo: 'texto',
          texto: `Confirmamos tu pago y tu cuenta de **${args.tenant.brandName}**${enMarca} quedó **activa**. Ya puedes ingresar al panel y empezar.`,
        },
        {
          tipo: 'datos',
          filas: [
            { etiqueta: 'Usuario', valor: args.loginEmail },
            { etiqueta: 'Ingreso', valor: args.loginUrl.replace(/^https?:\/\//i, '') },
          ],
        },
      ],
      boton: { texto: 'Ingresar al panel →', url: args.loginUrl },
      bloquesFinales: [
        {
          tipo: 'nota',
          texto: 'Tu contraseña es la que definiste al registrarte. ¿La olvidaste? Puedes recuperarla desde el login.',
        },
        {
          tipo: 'texto',
          texto: 'Primeros pasos: sube tu menú, personaliza tu tarjeta de fidelización y comparte tu link. Cualquier duda, escríbenos.',
        },
      ],
      motivo: 'Recibes este correo porque tienes una cuenta en {marca}.',
    }),
  };
}
