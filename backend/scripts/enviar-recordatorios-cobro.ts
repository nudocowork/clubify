/**
 * Manda los recordatorios de cobro POR CORREO sin necesidad de desplegar.
 *
 * Hace exactamente lo mismo que hará el cron cuando la PR #317 esté en
 * producción: misma ventana, misma plantilla (con los overrides de la marca),
 * mismo transporte (la subcuenta de Grow Business de cada marca) y el mismo
 * dedup por ciclo, para que el día que el cron arranque no repita nada.
 *
 * Existe porque el despliegue está bloqueado esperando a que suban el código
 * del motor de Email Marketing, y los cobros no esperan.
 *
 * Uso:
 *   # ver qué se enviaría, sin enviar nada (por defecto)
 *   railway run npx ts-node scripts/enviar-recordatorios-cobro.ts
 *
 *   # enviar de verdad
 *   railway run npx ts-node scripts/enviar-recordatorios-cobro.ts --enviar
 */
import { PrismaClient } from '@prisma/client';
import { decryptSecret } from '../src/common/crypto/secret-box';
import { emailShell } from '../src/email/templates/templates';
import {
  fmtEmailDate,
  interpolateEmail,
  resolveEmailTemplate,
  isEmailTemplateEnabled,
  findEmailTemplate,
} from '../src/email/brand-email-templates';

const API = 'https://services.leadconnectorhq.com';
const VERSION = '2021-07-28';
const ENVIAR = process.argv.includes('--enviar');

const prisma = new PrismaClient();
const dia = 24 * 60 * 60 * 1000;

/** Las cuatro ventanas del cron, con su plantilla y su marca de dedup. */
const SERIE = [
  { dias: 7, tpl: 'email_payment_reminder_7d', campo: 'preReminder7dSentFor' },
  { dias: 3, tpl: 'email_payment_reminder_3d', campo: 'preReminder3dSentFor' },
  { dias: 1, tpl: 'email_payment_reminder_tomorrow', campo: 'paymentReminderSentFor' },
  { dias: 0, tpl: 'email_payment_due_today', campo: 'preReminderTodaySentFor' },
] as const;

async function enviarPorGhl(
  creds: { locationId: string; apiKey: string },
  to: string,
  subject: string,
  html: string,
  text: string,
) {
  const headers = {
    Authorization: `Bearer ${creds.apiKey}`,
    Version: VERSION,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  const up = await fetch(`${API}/contacts/upsert`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      locationId: creds.locationId,
      email: to.trim().toLowerCase(),
    }),
  });
  if (!up.ok) return { ok: false, msg: `upsert ${up.status}` };
  const uj: any = await up.json();
  const contactId = uj?.contact?.id ?? uj?.id ?? uj?.contactId;
  if (!contactId) return { ok: false, msg: 'sin contactId' };

  const res = await fetch(`${API}/conversations/messages`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ type: 'Email', contactId, message: text, subject, html }),
  });
  const body = await res.text();
  return { ok: res.ok, msg: `${res.status} ${body.slice(0, 160)}` };
}

async function main() {
  const ahora = new Date();
  console.log(
    ENVIAR
      ? '=== ENVIANDO DE VERDAD ===\n'
      : '=== SIMULACIÓN (nadie recibe nada). Agrega --enviar para mandar. ===\n',
  );

  for (const paso of SERIE) {
    // Misma ventana que el cron: [hoy+N, hoy+N+1)
    const desde = new Date(ahora);
    desde.setHours(0, 0, 0, 0);
    desde.setTime(desde.getTime() + paso.dias * dia);
    const hasta = new Date(desde.getTime() + dia);

    const negocios = await prisma.tenant.findMany({
      where: {
        status: 'ACTIVE',
        isCampaignHost: false,
        deletedAt: null,
        currentPeriodEnd: { gte: desde, lt: hasta },
      },
      select: {
        id: true,
        brandName: true,
        slug: true,
        email: true,
        logoUrl: true,
        primaryColor: true,
        whatsappPhone: true,
        currentPeriodEnd: true,
        whiteLabelId: true,
        preReminder7dSentFor: true,
        preReminder3dSentFor: true,
        paymentReminderSentFor: true,
        preReminderTodaySentFor: true,
      },
    });
    if (!negocios.length) continue;

    console.log(`--- D-${paso.dias} (${negocios.length} negocio(s)) ---`);

    for (const t of negocios) {
      const yaEnviado = (t as any)[paso.campo] as Date | null;
      if (
        yaEnviado &&
        t.currentPeriodEnd &&
        yaEnviado.getTime() === t.currentPeriodEnd.getTime()
      ) {
        console.log(`  ${t.brandName}: ya enviado este ciclo, se salta.`);
        continue;
      }

      const wl = t.whiteLabelId
        ? await prisma.whiteLabel.findUnique({
            where: { id: t.whiteLabelId },
            select: {
              name: true,
              growBusinessLocationId: true,
              growBusinessApiKey: true,
            },
          })
        : null;
      if (!wl?.growBusinessLocationId || !wl.growBusinessApiKey) {
        console.log(`  ${t.brandName}: la marca no tiene subcuenta de Grow. Se salta.`);
        continue;
      }

      const activo = await isEmailTemplateEnabled(prisma as any, paso.tpl, t.whiteLabelId);
      if (!activo) {
        console.log(`  ${t.brandName}: el correo está apagado para la marca. Se salta.`);
        continue;
      }

      // Destinatario: el dueño activo; si no hay, el correo del negocio.
      const owner = await prisma.user.findFirst({
        where: { tenantId: t.id, role: 'TENANT_OWNER', isActive: true },
        orderBy: { createdAt: 'asc' },
        select: { email: true, fullName: true },
      });
      const to = (owner?.email || t.email || '').trim();
      if (!to) {
        console.log(`  ${t.brandName}: sin correo de destino. Se salta.`);
        continue;
      }

      const def = findEmailTemplate(paso.tpl)!;
      const resuelto = await resolveEmailTemplate(prisma as any, paso.tpl, t.whiteLabelId);
      const vars: Record<string, string> = {
        platform: wl.name || 'Clubify',
        brandName: t.brandName,
        ownerName: (owner?.fullName || '').split(' ')[0] || '',
        panelUrl: 'https://soyclubify.com/app',
        chargeDate: t.currentPeriodEnd ? fmtEmailDate(t.currentPeriodEnd) : '',
      };
      const subject = interpolateEmail(resuelto?.subject ?? def.subject, vars);
      const cuerpo = interpolateEmail(resuelto?.body ?? def.default, vars);
      const html = emailShell({
        tenant: {
          brandName: t.brandName,
          logoUrl: t.logoUrl,
          primaryColor: t.primaryColor,
          whatsappPhone: t.whatsappPhone,
          slug: t.slug,
        },
        preheader: cuerpo.split('\n')[0].slice(0, 120),
        body: cuerpo
          .split('\n\n')
          .map((p) => `<p style="margin:0 0 14px">${p.replace(/\n/g, '<br/>')}</p>`)
          .join(''),
        platform: { name: wl.name || 'Clubify' },
        footer: `Enviado por ${wl.name || 'Clubify'}`,
      });

      console.log(`  ${t.brandName} → ${to}`);
      console.log(`     asunto: ${subject}`);
      if (!ENVIAR) continue;

      const creds = {
        locationId: wl.growBusinessLocationId,
        apiKey: decryptSecret(wl.growBusinessApiKey),
      };
      const r = await enviarPorGhl(creds, to, subject, html, cuerpo);
      console.log(`     ${r.ok ? '✔ enviado' : '✗ falló'} — ${r.msg}`);

      // Dedup: se marca igual que lo haría el cron, para que el día que
      // arranque no le repita el aviso al cliente.
      if (r.ok && t.currentPeriodEnd) {
        await prisma.tenant.update({
          where: { id: t.id },
          data: { [paso.campo]: t.currentPeriodEnd } as any,
        });
      }
    }
    console.log('');
  }
}

main()
  .catch((e) => console.error('ERROR:', e?.message ?? e))
  .finally(() => prisma.$disconnect());
