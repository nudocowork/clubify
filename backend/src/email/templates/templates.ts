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
        ${opts.footer ?? `Enviado por ${opts.tenant.brandName} · vía Clubify`}
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
    text: `Tu cuenta de ${args.tenant.brandName} en Clubify\nEmail: ${args.email}\nContraseña temporal: ${args.tempPassword}\nIngresá en: ${args.loginUrl}`,
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
        <p style="margin:16px 0 0;color:#6B7280;font-size:13px">Cambiá tu contraseña apenas ingreses. Si recibiste este email por error, ignoralo.</p>
      `,
      cta: { label: 'Ingresar al panel →', href: args.loginUrl },
    }),
  };
}
