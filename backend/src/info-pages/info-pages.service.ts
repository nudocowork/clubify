import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { toCSV } from '../common/csv';

// Neutraliza inyección de fórmulas en CSV (los valores vienen de un POST público sin
// auth y el CSV lo abre un admin en Excel/Sheets → `=`, `+`, `-`, `@`, tab, CR al
// inicio se ejecutarían como fórmula). Prefija con apóstrofo para forzar texto.
function csvGuard(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

// Longitud máxima por valor de lead (el body JSON global admite ~15MB → sin cap un
// solo lead podría inflar la DB/CSV desde el endpoint público).
const LEAD_VALUE_MAX = 2000;

// Campo de formulario configurable. `type` mapea a un <input> del render público.
export type InfoFormField = {
  key: string;
  label: string;
  type: 'text' | 'email' | 'tel' | 'number' | 'textarea' | 'select';
  required?: boolean;
  options?: string[];
};

// Slugs FIJOS de las páginas de plataforma. Bloqueados: no se crean/borran/renombran
// desde el panel — el admin solo edita el contenido. Sembrados al iniciar el módulo.
const SEED_PAGES: {
  slug: string;
  name: string;
  tag: string;
  title: string;
  subtitle: string;
  description: string;
  sections: { heading: string; body: string }[];
  ctaText: string;
  formFields: InfoFormField[];
}[] = [
  {
    slug: 'informacion',
    name: 'Información General',
    tag: 'Información General',
    title: 'Clubify — Fideliza, vende y automatiza tu negocio',
    subtitle:
      'La plataforma todo-en-uno para negocios locales: tarjeta de fidelización, menú digital, pedidos y automatizaciones.',
    description:
      'Clubify reúne en un solo lugar todo lo que tu negocio necesita para crecer: programa de puntos y sellos, catálogo y pedidos, reservas, y automatizaciones de WhatsApp/SMS para que vuelvan tus clientes.',
    sections: [
      { heading: '¿Qué es Clubify?', body: 'Un sistema operativo para negocios locales que combina fidelización, menú digital, pedidos y marketing automatizado.' },
      { heading: 'Beneficios', body: 'Más clientes recurrentes, ticket promedio más alto, y menos trabajo manual gracias a las automatizaciones.' },
      { heading: 'Casos de éxito', body: 'Restaurantes, gimnasios y comercios que aumentaron sus ventas recurrentes con Clubify.' },
    ],
    ctaText: 'Quiero más información',
    formFields: [
      { key: 'nombre', label: 'Nombre', type: 'text', required: true },
      { key: 'apellido', label: 'Apellido', type: 'text', required: true },
      { key: 'empresa', label: 'Empresa', type: 'text', required: true },
      { key: 'tipo_negocio', label: 'Tipo de negocio', type: 'text', required: true },
      { key: 'ciudad', label: 'Ciudad', type: 'text', required: true },
      { key: 'whatsapp', label: 'WhatsApp', type: 'tel', required: true },
      { key: 'correo', label: 'Correo electrónico', type: 'email', required: true },
      { key: 'sucursales', label: 'Número de sucursales', type: 'number', required: false },
      { key: 'comentarios', label: 'Comentarios', type: 'textarea', required: false },
    ],
  },
  {
    slug: 'informacion1',
    name: 'Campaña Especial',
    tag: 'Campaña Especial',
    title: 'Oferta especial de Clubify',
    subtitle: 'Aprovecha una promoción exclusiva y lleva tu negocio al siguiente nivel.',
    description:
      'Por tiempo limitado, accede a beneficios exclusivos al activar Clubify en tu negocio. Déjanos tus datos y te contactamos con la oferta.',
    sections: [
      { heading: 'La oferta', body: 'Condiciones especiales de activación por tiempo limitado.' },
      { heading: 'Beneficios exclusivos', body: 'Acompañamiento de puesta en marcha y funciones premium incluidas.' },
    ],
    ctaText: 'Quiero la oferta',
    formFields: [
      { key: 'nombre_completo', label: 'Nombre completo', type: 'text', required: true },
      { key: 'whatsapp', label: 'WhatsApp', type: 'tel', required: true },
      { key: 'correo', label: 'Correo electrónico', type: 'email', required: true },
      { key: 'empresa', label: 'Empresa', type: 'text', required: false },
      { key: 'cargo', label: 'Cargo', type: 'text', required: false },
      { key: 'interes', label: 'Interés principal', type: 'text', required: false },
    ],
  },
];

// Campos de contenido editables desde el panel. El slug queda EXCLUIDO a propósito
// (bloqueado). Cualquier otra clave del body se ignora.
const EDITABLE = [
  'name', 'tag', 'title', 'subtitle', 'logoUrl', 'heroImageUrl', 'videoUrl', 'description',
  'sections', 'ctaText', 'ctaUrl', 'formEnabled', 'formFields', 'theme', 'isPublished',
] as const;

@Injectable()
export class InfoPagesService implements OnModuleInit {
  constructor(private prisma: PrismaService) {}

  // Siembra las páginas fijas si no existen (idempotente). No pisa contenido ya
  // editado: solo crea las que falten.
  async onModuleInit() {
    for (const p of SEED_PAGES) {
      const exists = await this.prisma.infoPage.findUnique({ where: { slug: p.slug } });
      if (exists) continue;
      await this.prisma.infoPage
        .create({
          data: {
            slug: p.slug,
            name: p.name,
            tag: p.tag,
            title: p.title,
            subtitle: p.subtitle,
            description: p.description,
            sections: p.sections,
            ctaText: p.ctaText,
            formFields: p.formFields as any,
            formEnabled: true,
            isPublished: false, // nace en borrador; el admin publica cuando esté lista
          },
        })
        .catch(() => null); // carrera de arranque multi-instancia → ignora el duplicado
    }
  }

  // ── Público ──────────────────────────────────────────────────────────────
  async getPublic(slug: string) {
    const page = await this.prisma.infoPage.findUnique({ where: { slug } });
    if (!page || !page.isPublished) throw new NotFoundException('Página no encontrada');
    // Contador de vistas best-effort (no bloquea la respuesta).
    this.prisma.infoPage.update({ where: { id: page.id }, data: { views: { increment: 1 } } }).catch(() => null);
    return {
      slug: page.slug,
      title: page.title,
      subtitle: page.subtitle,
      logoUrl: page.logoUrl,
      heroImageUrl: page.heroImageUrl,
      videoUrl: page.videoUrl,
      description: page.description,
      sections: page.sections,
      ctaText: page.ctaText,
      ctaUrl: page.ctaUrl,
      formEnabled: page.formEnabled,
      formFields: page.formFields,
      theme: page.theme,
    };
  }

  async submitLead(slug: string, data: Record<string, unknown>) {
    const page = await this.prisma.infoPage.findUnique({ where: { slug } });
    if (!page || !page.isPublished) throw new NotFoundException('Página no encontrada');
    if (!page.formEnabled) throw new BadRequestException('El formulario no está disponible');

    // Valida requeridos según los campos configurados y limpia claves ajenas. Solo
    // se aceptan ESCALARES (string/number/boolean) → se coaccionan a string y se
    // capan: rechaza objetos/arrays (evita "[object Object]" y payloads anidados
    // grandes desde el POST público sin auth). Las claves no definidas se ignoran.
    const fields = (page.formFields as unknown as InfoFormField[]) || [];
    const clean: Record<string, string> = {};
    for (const f of fields) {
      const v = data?.[f.key];
      const isScalar = v == null || ['string', 'number', 'boolean'].includes(typeof v);
      const s = isScalar && v != null ? String(v).trim() : '';
      if (f.required && s === '') {
        throw new BadRequestException(`Falta el campo: ${f.label}`);
      }
      if (s !== '') clean[f.key] = s.slice(0, LEAD_VALUE_MAX);
    }

    await this.prisma.infoPageLead.create({
      data: { infoPageId: page.id, data: clean as any, tag: page.tag, source: page.slug },
    });
    return { ok: true };
  }

  // ── Admin (superadmin) ─────────────────────────────────────────────────────
  async list() {
    const pages = await this.prisma.infoPage.findMany({ orderBy: { slug: 'asc' } });
    const counts = await this.prisma.infoPageLead.groupBy({
      by: ['infoPageId'],
      _count: { _all: true },
    });
    const byId = new Map(counts.map((c) => [c.infoPageId, c._count._all]));
    return pages.map((p) => ({
      id: p.id,
      slug: p.slug,
      name: p.name,
      title: p.title,
      logoUrl: p.logoUrl,
      isPublished: p.isPublished,
      formEnabled: p.formEnabled,
      views: p.views,
      leadCount: byId.get(p.id) ?? 0,
      updatedAt: p.updatedAt,
    }));
  }

  async get(slug: string) {
    const page = await this.prisma.infoPage.findUnique({ where: { slug } });
    if (!page) throw new NotFoundException('Página no encontrada');
    return page;
  }

  // Actualiza SOLO contenido. El slug queda bloqueado (no está en EDITABLE) y no
  // hay método de borrado. Cualquier clave no permitida se descarta.
  async update(slug: string, body: Record<string, unknown>) {
    const page = await this.prisma.infoPage.findUnique({ where: { slug } });
    if (!page) throw new NotFoundException('Página no encontrada');
    const data: Record<string, unknown> = {};
    for (const key of EDITABLE) {
      if (key in body) data[key] = (body as any)[key];
    }
    const updated = await this.prisma.infoPage.update({ where: { slug }, data: data as any });
    return updated;
  }

  async listLeads(slug: string, q?: string) {
    const page = await this.prisma.infoPage.findUnique({ where: { slug } });
    if (!page) throw new NotFoundException('Página no encontrada');
    const leads = await this.prisma.infoPageLead.findMany({
      where: { infoPageId: page.id },
      orderBy: { createdAt: 'desc' },
      take: 2000,
    });
    const term = (q || '').trim().toLowerCase();
    const filtered = term
      ? leads.filter((l) => JSON.stringify(l.data).toLowerCase().includes(term))
      : leads;
    return {
      page: { slug: page.slug, name: page.name, tag: page.tag, formFields: page.formFields },
      leads: filtered.map((l) => ({ id: l.id, data: l.data, createdAt: l.createdAt })),
    };
  }

  async leadsCsv(slug: string): Promise<string> {
    const page = await this.prisma.infoPage.findUnique({ where: { slug } });
    if (!page) throw new NotFoundException('Página no encontrada');
    const fields = (page.formFields as unknown as InfoFormField[]) || [];
    const leads = await this.prisma.infoPageLead.findMany({
      where: { infoPageId: page.id },
      orderBy: { createdAt: 'desc' },
    });
    const columns = [
      { key: 'createdAt', label: 'Fecha', format: (v: any) => new Date(v).toISOString() },
      { key: 'source', label: 'Origen', format: (v: any) => csvGuard(v) },
      ...fields.map((f) => ({
        key: f.key,
        label: f.label,
        format: (_v: any, row: any) => csvGuard((row.data ?? {})[f.key] ?? ''),
      })),
    ];
    return toCSV(leads as any[], columns as any);
  }
}
