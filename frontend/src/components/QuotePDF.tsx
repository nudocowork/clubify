// Documento PDF de cotización profesional Clubify.
// Renderizado 100% client-side con @react-pdf/renderer (no necesita backend).
// El contenido replica visualmente el QuotePreviewPremium del wizard pero
// adaptado a estilos PDF (Flexbox limitado, sin hover/transitions, sin
// Tailwind). Mantener ambos sincronizados al editar copy o beneficios.

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Image,
  Font,
} from '@react-pdf/renderer';
import type { QuoteTemplate } from '@/lib/quote-templates';
import {
  getPlanBenefits,
  COMPARISON_FEATURES,
  type QuotePlan,
} from '@/lib/quote-benefits';

// Helvetica viene built-in en @react-pdf/renderer (no requiere Font.register).
// Si más adelante queremos Inter, hay que servirla en /public y registrarla.
Font.registerHyphenationCallback((word) => [word]); // evita hyphens automáticos feos

const COLORS = {
  ink: '#0F172A',
  ink2: '#1F2937',
  mute: '#6B7280',
  mute2: '#9CA3AF',
  line: '#E5E7EB',
  bg: '#FFFFFF',
  bg2: '#F4F5F7',
  brand: '#22C55E',
  brandSoft: '#DCFCE7',
  brandInk: '#15803D',
};

const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 10,
    color: COLORS.ink,
    backgroundColor: COLORS.bg,
    paddingTop: 36,
    paddingBottom: 60,
    paddingHorizontal: 36,
  },
  // ── Header & footer comunes
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 28,
  },
  logo: { width: 90, height: 26, objectFit: 'contain' },
  headerMeta: {
    textAlign: 'right',
    fontSize: 8,
    color: COLORS.mute,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  footer: {
    position: 'absolute',
    bottom: 22,
    left: 36,
    right: 36,
    fontSize: 8,
    color: COLORS.mute,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: COLORS.line,
    paddingTop: 8,
  },

  // ── Hero
  eyebrow: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: COLORS.mute,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  heroTitle: {
    fontSize: 26,
    fontFamily: 'Helvetica-Bold',
    color: COLORS.ink,
    marginTop: 6,
    lineHeight: 1.15,
  },
  heroSubtitle: {
    fontSize: 11,
    color: COLORS.mute,
    marginTop: 8,
    lineHeight: 1.5,
  },
  heroRow: {
    flexDirection: 'row',
    gap: 18,
    marginTop: 18,
  },
  heroLeft: { flex: 1.4 },
  heroRight: { flex: 1 },
  templateChip: {
    alignSelf: 'flex-start',
    marginTop: 14,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
  },

  // ── Plan card destacada
  planCard: {
    backgroundColor: COLORS.ink,
    borderRadius: 14,
    padding: 18,
    color: '#FFFFFF',
  },
  planCardEyebrow: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: 'rgba(255,255,255,0.6)',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  planCardName: {
    fontSize: 22,
    fontFamily: 'Helvetica-Bold',
    color: '#FFFFFF',
    marginTop: 4,
  },
  planCardPrice: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: 12,
    gap: 4,
  },
  planCardPriceMain: {
    fontSize: 24,
    fontFamily: 'Helvetica-Bold',
    color: '#FFFFFF',
  },
  planCardPriceSub: { fontSize: 10, color: 'rgba(255,255,255,0.65)' },
  planCardDivider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.12)',
    marginVertical: 14,
  },
  planCardSmallTitle: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: 'rgba(255,255,255,0.6)',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: 4,
  },
  planCardSmallText: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.92)',
    lineHeight: 1.5,
  },

  // ── Sección
  section: { marginTop: 28 },
  sectionDivider: {
    height: 1,
    backgroundColor: COLORS.line,
    marginTop: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontFamily: 'Helvetica-Bold',
    color: COLORS.ink,
    marginTop: 4,
    lineHeight: 1.2,
  },
  sectionDesc: {
    fontSize: 10,
    color: COLORS.mute,
    marginTop: 6,
    lineHeight: 1.5,
    maxWidth: 380,
  },

  // ── Bento beneficios
  bento: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 14,
    gap: 10,
  },
  benefit: {
    width: '48%',
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 10,
    padding: 12,
  },
  benefitIcon: {
    width: 26,
    height: 26,
    borderRadius: 8,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 1.85,
    marginBottom: 8,
  },
  benefitTitle: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    color: COLORS.ink,
  },
  benefitDesc: {
    fontSize: 9,
    color: COLORS.mute,
    marginTop: 3,
    lineHeight: 1.45,
  },

  // ── Highlights
  highlight: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 10,
  },
  highlightBullet: {
    width: 10,
    fontFamily: 'Helvetica-Bold',
  },
  highlightText: {
    flex: 1,
    fontSize: 10.5,
    color: COLORS.ink,
    lineHeight: 1.5,
  },

  // ── Comparativa
  compTable: {
    marginTop: 14,
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 10,
    overflow: 'hidden',
  },
  compRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: COLORS.line,
  },
  compHeader: {
    flexDirection: 'row',
    backgroundColor: COLORS.bg2,
  },
  compHeaderProBg: { backgroundColor: COLORS.brandSoft },
  compCell: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 9.5,
  },
  compCellFeature: {
    flex: 1,
    color: COLORS.ink,
  },
  compCellPlan: {
    width: 80,
    textAlign: 'center',
  },
  compHeaderText: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: COLORS.mute,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  compCheck: {
    color: COLORS.brand,
    fontFamily: 'Helvetica-Bold',
    fontSize: 13,
    textAlign: 'center',
  },
  compCross: {
    color: COLORS.mute2,
    fontSize: 13,
    textAlign: 'center',
  },
  altRow: { backgroundColor: '#FAFBFC' },

  // ── Footer CTA / asesor
  ctaBox: {
    marginTop: 28,
    borderRadius: 14,
    padding: 18,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  ctaLeft: { flex: 1, paddingRight: 20 },
  advisorEyebrow: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: '#FFFFFF',
    opacity: 0.7,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  advisorName: {
    fontSize: 14,
    fontFamily: 'Helvetica-Bold',
    color: '#FFFFFF',
    marginTop: 4,
  },
  advisorBody: {
    fontSize: 10,
    color: '#FFFFFF',
    opacity: 0.92,
    marginTop: 4,
    lineHeight: 1.5,
  },
  ctaPriceBox: {
    backgroundColor: 'rgba(0,0,0,0.18)',
    borderRadius: 12,
    padding: 14,
    minWidth: 170,
    alignItems: 'center',
  },
  ctaPriceLabel: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: '#FFFFFF',
    opacity: 0.85,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  ctaPriceMain: {
    fontSize: 22,
    fontFamily: 'Helvetica-Bold',
    color: '#FFFFFF',
    marginTop: 4,
  },
  ctaPriceSub: {
    fontSize: 8,
    color: '#FFFFFF',
    opacity: 0.8,
    marginTop: 4,
  },
});

function fmtMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function fmtDateLong(d: Date) {
  return d.toLocaleDateString('es-CO', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export type QuotePDFProps = {
  customerName: string;
  businessName: string;
  phone?: string | null;
  email?: string | null;
  plan: QuotePlan;
  template: QuoteTemplate;
  price: number;
  currency: string;
  advisorName: string;
  /** Para PDFs regenerados de cotizaciones viejas. Si no se pasa usa now(). */
  date?: Date;
  /** URL absoluta del logo Clubify. Si está vacía se omite. Default `/clubify-logo.png`. */
  logoUrl?: string;
  /** Datos de contacto del asesor para footer. */
  advisorWhatsapp?: string | null;
  advisorEmail?: string | null;
};

export function QuotePDF(props: QuotePDFProps) {
  const {
    customerName,
    businessName,
    phone,
    email,
    plan,
    template,
    price,
    currency,
    advisorName,
    date = new Date(),
    logoUrl = '/clubify-logo.png',
    advisorWhatsapp,
    advisorEmail,
  } = props;
  const benefits = getPlanBenefits(plan);
  const planLabel = plan === 'PRO' ? 'Pro' : 'Elite';
  const accent = template.accent;

  return (
    <Document
      title={`Propuesta Clubify · ${businessName}`}
      author={advisorName}
      subject={`Cotización Plan ${planLabel} para ${businessName}`}
      creator="Clubify"
    >
      <Page size="A4" style={styles.page} wrap>
        {/* Header con logo + meta */}
        <View style={styles.header} fixed>
          {logoUrl ? <Image src={logoUrl} style={styles.logo} /> : <View />}
          <View style={styles.headerMeta}>
            <Text>Propuesta comercial</Text>
            <Text style={{ marginTop: 2, color: COLORS.ink2 }}>
              {fmtDateLong(date)}
            </Text>
          </View>
        </View>

        {/* Hero */}
        <View style={styles.heroRow}>
          <View style={styles.heroLeft}>
            <Text style={styles.eyebrow}>
              Hola {customerName || 'cliente'},
            </Text>
            <Text style={styles.heroTitle}>
              Propuesta Clubify para{'\n'}
              {businessName || 'tu negocio'}
            </Text>
            <Text style={styles.heroSubtitle}>{template.tagline}.</Text>
            <View
              style={[
                styles.templateChip,
                { backgroundColor: `${accent}1F`, color: accent },
              ]}
            >
              <Text style={{ color: accent, fontSize: 9 }}>
                Plantilla {template.name}
              </Text>
            </View>
          </View>

          {/* Plan card */}
          <View style={styles.heroRight}>
            <View style={styles.planCard}>
              <Text style={styles.planCardEyebrow}>Plan recomendado</Text>
              <Text style={styles.planCardName}>{planLabel}</Text>
              <View style={styles.planCardPrice}>
                <Text style={styles.planCardPriceMain}>
                  {fmtMoney(price, currency)}
                </Text>
                <Text style={styles.planCardPriceSub}>/ mes</Text>
              </View>
              <View style={styles.planCardDivider} />
              <Text style={styles.planCardSmallTitle}>Incluye</Text>
              <Text style={styles.planCardSmallText}>
                {benefits.length} módulos activos · Setup en 24h · Soporte
                directo por WhatsApp
              </Text>
            </View>
          </View>
        </View>

        {/* Beneficios */}
        <View style={styles.section}>
          <Text style={styles.eyebrow}>¿Qué incluye?</Text>
          <Text style={styles.sectionTitle}>
            Lo que tu cliente recibe con {planLabel}
          </Text>
          <Text style={styles.sectionDesc}>
            {benefits.length} módulos profesionales listos para usar el día 1.
            Sin contratos largos, sin instalaciones, sin app que tu cliente
            tenga que descargar.
          </Text>
          <View style={styles.bento}>
            {benefits.map((b) => (
              <View key={b.title} style={styles.benefit}>
                <Text
                  style={[
                    styles.benefitIcon,
                    { backgroundColor: `${accent}1F` },
                  ]}
                >
                  {b.icon}
                </Text>
                <Text style={styles.benefitTitle}>{b.title}</Text>
                <Text style={styles.benefitDesc}>{b.description}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Highlights de plantilla */}
        {template.highlights.length > 0 && (
          <View style={styles.section} break>
            <Text style={styles.eyebrow}>
              Diseñado para {template.name.toLowerCase()}
            </Text>
            <Text style={styles.sectionTitle}>
              Por qué Clubify funciona en {template.name.toLowerCase()}
            </Text>
            <Text style={styles.sectionDesc}>
              Ganchos comerciales específicos del rubro que ayudan a cerrar la
              venta.
            </Text>
            {template.highlights.map((h, i) => (
              <View key={i} style={styles.highlight}>
                <Text style={[styles.highlightBullet, { color: accent }]}>
                  ▸
                </Text>
                <Text style={styles.highlightText}>{h}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Comparativa */}
        <View style={styles.section}>
          <Text style={styles.eyebrow}>Elite vs Pro</Text>
          <Text style={styles.sectionTitle}>Comparativa completa</Text>
          <Text style={styles.sectionDesc}>
            Qué incluye cada plan, en detalle. Si el cliente arranca con Elite,
            puede saltar a Pro cuando quiera sin perder data.
          </Text>
          <View style={styles.compTable}>
            <View style={styles.compHeader}>
              <View style={[styles.compCell, styles.compCellFeature]}>
                <Text style={styles.compHeaderText}>Característica</Text>
              </View>
              <View style={[styles.compCell, styles.compCellPlan]}>
                <Text style={styles.compHeaderText}>Elite</Text>
              </View>
              <View
                style={[
                  styles.compCell,
                  styles.compCellPlan,
                  styles.compHeaderProBg,
                ]}
              >
                <Text
                  style={[styles.compHeaderText, { color: COLORS.brandInk }]}
                >
                  Pro
                </Text>
              </View>
            </View>
            {COMPARISON_FEATURES.map((f, i) => (
              <View
                key={f.label}
                style={[styles.compRow, i % 2 === 1 ? styles.altRow : {}]}
              >
                <View style={[styles.compCell, styles.compCellFeature]}>
                  <Text>{f.label}</Text>
                </View>
                <View style={[styles.compCell, styles.compCellPlan]}>
                  <Text style={f.elite ? styles.compCheck : styles.compCross}>
                    {f.elite ? '✓' : '—'}
                  </Text>
                </View>
                <View
                  style={[
                    styles.compCell,
                    styles.compCellPlan,
                    { backgroundColor: `${COLORS.brandSoft}80` },
                  ]}
                >
                  <Text style={f.pro ? styles.compCheck : styles.compCross}>
                    {f.pro ? '✓' : '—'}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* Footer CTA + asesor */}
        <View style={[styles.ctaBox, { backgroundColor: accent }]} wrap={false}>
          <View style={styles.ctaLeft}>
            <Text style={styles.advisorEyebrow}>Tu asesor Clubify</Text>
            <Text style={styles.advisorName}>{advisorName}</Text>
            <Text style={styles.advisorBody}>
              Cualquier duda escribime y armamos el setup. La activación
              completa toma 24 horas hábiles.
            </Text>
            {(advisorWhatsapp || advisorEmail) && (
              <Text style={[styles.advisorBody, { fontSize: 9, marginTop: 6 }]}>
                {advisorWhatsapp ? `WhatsApp: ${advisorWhatsapp}` : ''}
                {advisorWhatsapp && advisorEmail ? '   ·   ' : ''}
                {advisorEmail ? `Email: ${advisorEmail}` : ''}
              </Text>
            )}
            {(phone || email) && (
              <Text style={[styles.advisorBody, { fontSize: 9, marginTop: 4, opacity: 0.85 }]}>
                Prospect: {phone ?? ''}
                {phone && email ? ' · ' : ''}
                {email ?? ''}
              </Text>
            )}
          </View>
          <View style={styles.ctaPriceBox}>
            <Text style={styles.ctaPriceLabel}>Inversión mensual</Text>
            <Text style={styles.ctaPriceMain}>{fmtMoney(price, currency)}</Text>
            <Text style={styles.ctaPriceSub}>
              Pago directo · sin contrato largo
            </Text>
          </View>
        </View>

        {/* Footer fijo */}
        <View style={styles.footer} fixed>
          <Text>Clubify · Software para negocios locales · soyclubify.com</Text>
          <Text
            render={({ pageNumber, totalPages }) =>
              `${pageNumber} / ${totalPages}`
            }
          />
        </View>
      </Page>
    </Document>
  );
}
