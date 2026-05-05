type Tenant = {
  brandName: string;
  logoUrl: string | null;
  primaryColor: string | null;
  whatsappPhone: string | null;
  slug: string;
};

const COP = (n: number) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(n);

function shell(opts: {
  tenant: Tenant;
  preheader: string;
  body: string;
  cta?: { label: string; href: string };
  footer?: string;
}) {
  const primary = opts.tenant.primaryColor ?? '#6366F1';
  const logo = opts.tenant.logoUrl
    ? `<img src="${opts.tenant.logoUrl}" alt="${opts.tenant.brandName}" style="max-height:40px;border-radius:8px"/>`
    : `<div style="display:inline-block;width:40px;height:40px;background:${primary};color:#fff;border-radius:8px;font-weight:700;font-size:18px;line-height:40px;text-align:center;font-family:system-ui">${opts.tenant.brandName[0]}</div>`;

  return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width"/><title>${opts.tenant.brandName}</title></head>
<body style="margin:0;padding:0;background:#F4F5F7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0F172A">
<span style="display:none;color:transparent;height:0;width:0;overflow:hidden">${opts.preheader}</span>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F4F5F7;padding:24px 0">
  <tr><td align="center">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 2px rgba(15,23,42,.04)">
      <tr><td style="padding:24px 28px;border-bottom:1px solid #E5E7EB">
        ${logo}
        <span style="font-weight:700;font-size:16px;margin-left:10px;vertical-align:middle">${opts.tenant.brandName}</span>
      </td></tr>
      <tr><td style="padding:28px">
        ${opts.body}
        ${
          opts.cta
            ? `<div style="margin-top:24px"><a href="${opts.cta.href}" style="display:inline-block;background:${primary};color:#fff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:999px;font-size:14px">${opts.cta.label}</a></div>`
            : ''
        }
      </td></tr>
      <tr><td style="padding:18px 28px;background:#F9FAFB;border-top:1px solid #E5E7EB;font-size:12px;color:#6B7280;text-align:center">
        ${opts.footer ? `${opts.footer}<br/>` : `Enviado por ${opts.tenant.brandName}<br/>`}
        <span style="font-size:11px;color:#9CA3AF">Hecho con <a href="https://soyclubify.com" style="color:#6366F1;text-decoration:none;font-weight:600">Clubify</a></span>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

// ─────────── Plantillas ───────────

export function orderCreatedTemplate(args: {
  tenant: Tenant;
  customerName: string;
  code: string;
  total: number;
  items: { name: string; qty: number; lineTotal: number }[];
  trackingUrl: string;
}) {
  const itemsRows = args.items
    .map(
      (i) =>
        `<tr><td style="padding:6px 0;color:#0F172A">${i.qty}× ${i.name}</td><td style="padding:6px 0;text-align:right;color:#6B7280">${COP(i.lineTotal)}</td></tr>`,
    )
    .join('');
  return {
    subject: `Pedido #${args.code} recibido — ${args.tenant.brandName}`,
    text: `Hola ${args.customerName}, recibimos tu pedido #${args.code} por ${COP(args.total)}. Te avisaremos en cuanto esté listo. Seguilo aquí: ${args.trackingUrl}`,
    html: shell({
      tenant: args.tenant,
      preheader: `Tu pedido #${args.code} ya está en cola`,
      body: `
        <h2 style="margin:0 0 12px;font-size:22px;font-weight:700">¡Gracias por tu pedido, ${args.customerName}! 🎉</h2>
        <p style="margin:0 0 16px;color:#374151;line-height:1.55">Recibimos tu pedido <b>#${args.code}</b>. Te avisaremos cuando lo confirmemos y cuando esté listo.</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #E5E7EB;border-bottom:1px solid #E5E7EB;margin:18px 0">
          ${itemsRows}
          <tr><td style="padding:10px 0 0;font-weight:700">Total</td><td style="padding:10px 0 0;text-align:right;font-weight:700">${COP(args.total)}</td></tr>
        </table>
      `,
      cta: { label: 'Seguir mi pedido →', href: args.trackingUrl },
    }),
  };
}

export function orderConfirmedTemplate(args: {
  tenant: Tenant;
  customerName: string;
  code: string;
  trackingUrl: string;
}) {
  return {
    subject: `Pedido #${args.code} confirmado · estamos preparándolo`,
    text: `Tu pedido #${args.code} fue confirmado. Te avisaremos cuando esté listo.`,
    html: shell({
      tenant: args.tenant,
      preheader: 'Tu pedido fue confirmado',
      body: `
        <h2 style="margin:0 0 12px;font-size:22px;font-weight:700">Tu pedido fue confirmado ✅</h2>
        <p style="margin:0 0 16px;color:#374151;line-height:1.55">Hola ${args.customerName}, ya estamos preparando tu pedido <b>#${args.code}</b>. Te volvemos a escribir cuando esté listo.</p>
      `,
      cta: { label: 'Seguir el pedido →', href: args.trackingUrl },
    }),
  };
}

export function orderReadyTemplate(args: {
  tenant: Tenant;
  customerName: string;
  code: string;
}) {
  return {
    subject: `Tu pedido #${args.code} está listo 🎉`,
    text: `Tu pedido #${args.code} está listo para retirar.`,
    html: shell({
      tenant: args.tenant,
      preheader: '¡Pedido listo para retirar!',
      body: `
        <h2 style="margin:0 0 12px;font-size:22px;font-weight:700">¡Tu pedido está listo! 🎉</h2>
        <p style="margin:0 0 16px;color:#374151;line-height:1.55">Hola ${args.customerName}, tu pedido <b>#${args.code}</b> ya está esperándote.</p>
      `,
    }),
  };
}

export function welcomeStaffTemplate(args: {
  tenant: Tenant;
  fullName: string;
  email: string;
  tempPassword: string;
  loginUrl: string;
}) {
  return {
    subject: `Bienvenido al equipo de ${args.tenant.brandName}`,
    text: `Tu cuenta de ${args.tenant.brandName} en Clubify\nEmail: ${args.email}\nContraseña temporal: ${args.tempPassword}\nIngresa en: ${args.loginUrl}`,
    html: shell({
      tenant: args.tenant,
      preheader: 'Tu acceso al panel de Clubify',
      body: `
        <h2 style="margin:0 0 12px;font-size:22px;font-weight:700">¡Bienvenido, ${args.fullName}!</h2>
        <p style="margin:0 0 12px;color:#374151;line-height:1.55">Te crearon una cuenta para gestionar pedidos y clientes en <b>${args.tenant.brandName}</b>.</p>
        <div style="background:#F4F5F7;border-radius:12px;padding:14px 16px;font-family:Menlo,Monaco,monospace;font-size:13px;line-height:1.6;color:#0F172A">
          <b>Email:</b> ${args.email}<br/>
          <b>Contraseña temporal:</b> ${args.tempPassword}
        </div>
        <p style="margin:16px 0 0;color:#6B7280;font-size:13px">Cambia tu contraseña apenas ingreses. Si recibiste este email por error, ignóralo.</p>
      `,
      cta: { label: 'Ingresar al panel →', href: args.loginUrl },
    }),
  };
}

export function passwordResetTemplate(args: {
  fullName: string;
  resetUrl: string;
  expiresInMinutes: number;
}) {
  const tenant: Tenant = {
    brandName: 'Clubify',
    primaryColor: '#6366F1',
    logoUrl: null,
    whatsappPhone: null,
    slug: 'clubify',
  };
  return {
    subject: 'Restablece tu contraseña en Clubify',
    text: `Hola ${args.fullName},\nPara restablecer tu contraseña usa este link (vence en ${args.expiresInMinutes} min):\n${args.resetUrl}\nSi no solicitaste esto, ignora este email.`,
    html: shell({
      tenant,
      preheader: `Link válido por ${args.expiresInMinutes} minutos`,
      body: `
        <h2 style="margin:0 0 12px;font-size:22px;font-weight:700">Restablece tu contraseña</h2>
        <p style="margin:0 0 14px;color:#374151;line-height:1.55">
          Hola ${args.fullName}, recibimos una solicitud para cambiar la contraseña de tu cuenta en Clubify.
        </p>
        <p style="margin:0 0 14px;color:#374151;line-height:1.55">
          Haz click en el botón de abajo para crear una nueva. El link vence en <b>${args.expiresInMinutes} minutos</b>.
        </p>
        <p style="margin:16px 0 0;color:#6B7280;font-size:13px">Si no solicitaste este cambio, simplemente ignora este email — tu contraseña actual sigue siendo válida.</p>
      `,
      cta: { label: 'Restablecer mi contraseña →', href: args.resetUrl },
    }),
  };
}

export function welcomeOwnerTemplate(args: {
  tenant: Tenant;
  fullName: string;
  trialEndsAt: Date | null;
  appUrl: string;
}) {
  const firstName = args.fullName.split(' ')[0];
  return {
    subject: `Bienvenido a Clubify, ${firstName}`,
    text: `Tu cuenta de ${args.tenant.brandName} ya está creada. Completa el pago en Hotmart y entras al panel a vender. ${args.appUrl}/app`,
    html: shell({
      tenant: args.tenant,
      preheader: `Completa el pago para activar ${args.tenant.brandName}`,
      body: `
        <h2 style="margin:0 0 12px;font-size:24px;font-weight:700">¡Bienvenido, ${firstName}!</h2>
        <p style="margin:0 0 14px;color:#374151;line-height:1.55">
          Tu cuenta de <b>${args.tenant.brandName}</b> en Clubify ya está creada.
          Solo falta completar el pago seguro en Hotmart para activarla.
        </p>
        <div style="background:linear-gradient(135deg,#22C55E,#15803D);border-radius:14px;padding:18px 20px;color:#fff">
          <div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;opacity:.85">Activa tu cuenta</div>
          <div style="font-size:22px;font-weight:700;margin-top:4px">Pago en Hotmart · activación inmediata</div>
          <div style="font-size:13px;opacity:.85;margin-top:6px">Apenas se aprueba entras al panel y empiezas a vender</div>
        </div>
        <p style="margin:18px 0 8px;color:#374151;line-height:1.55">Una vez dentro, lo siguiente:</p>
        <ol style="margin:0;padding-left:20px;color:#374151;line-height:1.8">
          <li>Sube tu menú (categorías + productos)</li>
          <li>Personaliza tu tarjeta de fidelización</li>
          <li>Comparte tu link público en Instagram y WhatsApp</li>
          <li>Activa la primera automatización (mensaje al cliente)</li>
        </ol>
        <p style="margin:16px 0 0;color:#6B7280;font-size:13px">Si te trabas en algo, escríbenos por WhatsApp y te ayudamos en vivo.</p>
      `,
      cta: { label: 'Ir al panel →', href: `${args.appUrl}/app` },
    }),
  };
}
