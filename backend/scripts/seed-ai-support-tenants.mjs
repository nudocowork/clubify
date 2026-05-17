#!/usr/bin/env node
// Seed del knowledge base del asistente IA (audience=TENANT) + master prompt.
// Idempotente: usa upsert por (title, category, audience=TENANT) — si ya existe
// la entry, actualiza content/isActive sin duplicar. Master prompt va al
// Setting `support.masterPrompt.tenant`.
//
// Después de correr este script, conviene ir a /admin/ai-support y disparar
// re-embed (sino el retrieval cae al modo lexical en vez de semántico).
//
// Uso (contra prod):
//   DATABASE_URL="$(railway variables --service Postgres-Nq8w --kv | grep '^DATABASE_PUBLIC_URL=' | cut -d= -f2-)" \
//     node scripts/seed-ai-support-tenants.mjs

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const MASTER_PROMPT_KEY = 'support.masterPrompt.tenant';

const MASTER_PROMPT = `Eres el asistente virtual oficial de Clubify, el SaaS LATAM para negocios locales (cafeterías, restaurantes, barberías, gimnasios, autolavados, peluquerías de mascotas, lavanderías, talleres, etc.). El cliente que te escribe ES el dueño o encargado del negocio — NO es el consumidor final del comercio.

## Quién eres
- Asistente experto de Clubify. Conocés a fondo el producto y respondes dudas operativas, técnicas y comerciales.
- Sos el primer contacto: si la duda escapa al producto o requiere acción humana (reembolso, bug en producción, recuperar cuenta), derivás al equipo humano por WhatsApp.

## Cómo respondés
- Español neutro LATAM. NUNCA acento argentino exagerado (nada de "che", "boludo") ni español de España ("vosotros", "coger").
- Tuteo amable: "podés activar", "tu negocio", "tu tarjeta" funcionan bien.
- Breve: 1-3 párrafos cortos. Si la respuesta es procedural, listá pasos numerados (máximo 6 pasos).
- Concreto: dale al usuario la ruta exacta del panel cuando aplique (ej: /admin/cards, Configuración → Marca).
- No inventés funciones que no existan. Si no aparece en la base de conocimiento, decí "no tengo info confirmada de eso" y derivá a soporte humano.

## Qué nunca hacés
- Nunca prometas reembolsos, descuentos ni extensiones de trial que no estén documentados. Derivá a soporte.
- Nunca pidas datos sensibles (tarjeta, contraseña, código 2FA). El soporte real nunca los pide tampoco.
- Nunca des consejos legales/contables/tributarios. Si preguntan facturación electrónica (AFIP, DIAN, SAT), decí que Clubify hoy no emite facturas fiscales y que deben usar su sistema contable habitual.
- Nunca compares peyorativamente con competidores. Si preguntan diferencias, contá qué hace Clubify y dejá que el cliente decida.

## Cuándo derivar a soporte humano
- Bug reportado (algo no funciona como debería)
- Problema de cobro, reembolso o cambio de plan
- Recuperación de cuenta / cambio de email del owner
- Pedido de feature que no existe
- Tono del cliente enojado o queja formal

Respuesta sugerida para derivación:
"Para eso es mejor que te contacte el equipo. Escribinos por WhatsApp al número que aparece en el footer de tu panel (Configuración → Soporte) y te respondemos en horario hábil."

## Tono ante quejas
Si el cliente está frustrado: reconocé el problema en una frase ("entiendo que es molesto"), evitá excusas, derivá al humano. No defiendas el producto, no le pidas paciencia con "estamos trabajando en eso".

## Lo que NO sos
- No sos vendedor. Si pregunta planes/precios, respondé factual y derivá a la página de planes. No empujes upgrades.
- No sos consultor de negocio. Si pregunta "cómo aumento ventas", podés sugerir features de Clubify que ayudan (tarjeta de fidelización, mensajes automáticos, marketing QR) pero no te metas a hacer planes de marketing.

A continuación, la base de conocimiento curada. Usala como fuente de verdad. Si una pregunta no está cubierta, decí "no tengo info confirmada" antes que inventar.`;

const ENTRIES = [
  // ============== PLANES Y FACTURACIÓN ==============
  {
    category: 'Planes y facturación',
    title: 'Cuáles son los planes y precios',
    content: `Clubify tiene un plan único: Elite, USD 50/mes recurrente.

Incluye TODO sin restricciones:
- Tarjetas de fidelización digitales ilimitadas (Apple + Google Wallet)
- Menú digital con 5 layouts
- Pedidos online y por WhatsApp
- Automatizaciones de WhatsApp (cumpleaños, recuperación, sello, etc.)
- Mensajes automáticos por evento
- Multi-ubicación + multi-staff
- Programa de referidos
- Marketing QR (carteles, reseñas, descuentos)
- Scanner PWA + control de inventario
- Dominio propio + analítica
- Soporte por chat

Es pago inmediato — no hay free trial. El cobro se procesa por Hotmart cada 30 días. La suscripción se renueva automáticamente.`,
  },
  {
    category: 'Planes y facturación',
    title: 'Cómo cancelar la suscripción',
    content: `Para cancelar:
1. Entrá a tu cuenta en hotmart.com (con el mismo email que registraste en Clubify)
2. Menú "Mis compras" → buscá "CLUBIFY - TARJETAS DE FIDELIZACION"
3. Click en "Cancelar suscripción"

La cancelación toma efecto al final del ciclo actual — seguís teniendo acceso hasta esa fecha. No hay penalidad ni permanencia.

Si querés borrar tu cuenta y datos por completo después de cancelar, escribinos por soporte y lo procesamos en 48hs hábiles.`,
  },
  {
    category: 'Planes y facturación',
    title: 'Mi pago falló o no se procesó',
    content: `Cuando Hotmart no puede cobrar (tarjeta vencida, fondos insuficientes, etc.), reintenta automáticamente durante varios días. Mientras tanto tu cuenta queda en estado "Pago pendiente" y seguís operando normalmente por unos días.

Pasos para resolver:
1. Entrá a hotmart.com → Mis compras → Clubify → "Actualizar método de pago"
2. Cargá la tarjeta nueva
3. Hotmart reintenta el cobro automático

Si después de varios reintentos sigue fallando, la cuenta se suspende temporalmente. Una vez que el pago se procesa, todo vuelve a funcionar en cuestión de minutos sin perder datos.`,
  },
  {
    category: 'Planes y facturación',
    title: 'Quiero factura fiscal',
    content: `Clubify hoy no emite facturas fiscales (AFIP/DIAN/SAT/SII). El cobro lo procesa Hotmart, que sí emite comprobante de pago descargable desde tu cuenta en hotmart.com → Mis compras → Clubify → "Ver comprobante".

Si necesitás factura fiscal para tu contabilidad, escribinos por soporte humano para evaluar tu caso según el país.`,
  },

  // ============== TARJETAS DE FIDELIZACIÓN ==============
  {
    category: 'Tarjetas de fidelización',
    title: 'Qué son las tarjetas digitales de Clubify',
    content: `Son tarjetas de fidelización 100% digitales que tus clientes guardan en Apple Wallet (iPhone) o Google Wallet (Android). No necesitan instalar ninguna app.

Hay 3 tipos:
- Visitas (sellos): el clásico "cada 10 visitas, una gratis". Cada vez que el cliente compra, le escaneás su tarjeta y suma un sello.
- Cashback: el cliente acumula un % del monto gastado y lo puede canjear como saldo en próximas compras.
- Híbrida: combina visitas + cashback en la misma tarjeta.

Además podés configurar niveles VIP (Bronze, Silver, Gold, etc.) que se desbloquean según gasto acumulado, con beneficios distintos por nivel.`,
  },
  {
    category: 'Tarjetas de fidelización',
    title: 'Cómo crear mi primera tarjeta',
    content: `1. Entrá a Tarjetas → Crear tarjeta
2. Elegí una plantilla (hay 33 prediseñadas por rubro) o partí en blanco
3. Elegí el tipo: Visitas, Cashback o Híbrida
4. Configurá la mecánica (cuántos sellos, qué % de cashback, qué premio)
5. Diseñá: subí logo, elegí colores, ícono del sello
6. Completá información de contacto y términos

Al guardar, Clubify te genera el link público de la tarjeta y el código QR para que tus clientes se la agreguen al wallet.`,
  },
  {
    category: 'Tarjetas de fidelización',
    title: 'Cómo entrego la tarjeta al cliente',
    content: `Tres formas principales:

1. QR poster en el local: imprimís el cartel QR (Marketing → QR Poster) y lo ponés en caja. El cliente escanea, completa nombre y email, y la tarjeta se agrega a su wallet.
2. Link directo por WhatsApp: copiás el link de la tarjeta desde el panel y se lo mandás. Funciona igual.
3. Inscripción asistida: vos desde el panel cargás nombre + email del cliente y le mandás el link automáticamente.

Una vez agregada al wallet, la tarjeta se actualiza sola cada vez que sumás sellos o cashback — no hay que reinstalar nada.`,
  },
  {
    category: 'Tarjetas de fidelización',
    title: 'Cómo escaneo / sumo sellos al cliente',
    content: `Desde tu celular o tablet:
1. Entrá a Scanner desde el panel (o app.soyclubify.com en el navegador del dispositivo)
2. Apuntá la cámara al código de barras de la tarjeta del cliente
3. Confirma que es el cliente correcto
4. Sumá el sello (o cargá el monto si es cashback)

Por seguridad, cada scan solo permite 1 sello. Si necesitás cargar varios sellos (ej: una compra grupal), usás el PIN de multi-stamp que está en Configuración → Scanner.

La sesión del scanner dura 6 horas — después pide login de nuevo.`,
  },
  {
    category: 'Tarjetas de fidelización',
    title: 'Niveles VIP — cómo funcionan',
    content: `Los niveles VIP recompensan a tus clientes recurrentes. Vos definís:
- Cuántos niveles tener (ej: Bronze, Silver, Gold, Platinum)
- Qué hay que alcanzar para subir (cantidad gastada o visitas)
- Qué beneficio extra tiene cada nivel (% de descuento, doble cashback, regalo especial, etc.)

El cliente ve su nivel actual en la tarjeta del wallet y la barra de progreso al siguiente nivel. Cuando sube de nivel, recibe notificación automática.

Configuralos en Tarjetas → editá una tarjeta → pestaña "Niveles VIP".`,
  },
  {
    category: 'Tarjetas de fidelización',
    title: 'Mensajes automáticos a clientes',
    content: `Clubify envía mensajes automáticos por WhatsApp o push a tus clientes en momentos clave:

- Cumpleaños: el día del cumple, mensaje + regalo personalizado
- Cliente inactivo: si no visita en X días, mensaje de "te extrañamos"
- Bienvenida: cuando se agrega la tarjeta por primera vez
- Cerca de premio: cuando le falta poco para canjear
- Subió de nivel VIP: notificación celebratoria
- Aniversario en el club: 1 año de cliente

Hay 6 plantillas listas para usar — las personalizás con tu marca. Activalos en Mensajes Automáticos → elegí cada uno y editá el texto.`,
  },

  // ============== MENÚ DIGITAL Y PEDIDOS ==============
  {
    category: 'Menú digital y pedidos',
    title: 'Cómo armo mi menú digital',
    content: `1. Entrá a Menú → Categorías → Nueva categoría (ej: Cafés, Pastelería, Bebidas frías)
2. Dentro de cada categoría, Nueva producto → cargá nombre, descripción, precio, foto
3. Si el producto tiene variantes (tamaño, sabor), agregalas en la pestaña "Variantes"
4. Si querés ofrecer extras pagos (leche vegetal, shot extra), creá una librería de adicionales en Menú → Adicionales y asignala al producto

El menú queda público en tu-subdominio.soyclubify.com y los clientes acceden con QR.`,
  },
  {
    category: 'Menú digital y pedidos',
    title: 'Cuáles son los layouts de menú disponibles',
    content: `Clubify ofrece 5 layouts visuales para el menú público. Los cambiás en Menú → Configuración → Layout:

1. CLASSIC: lista vertical con foto a la izquierda
2. GRID: cuadrícula de fotos grandes (estilo Instagram)
3. HERO: producto destacado arriba + resto en lista
4. MAGAZINE: estilo revista, fotos de borde a borde
5. SECTIONS: portadas grandes por categoría (lo más moderno, ideal para cartas tipo restaurante)

Probá distintos desde el preview y elegí el que mejor le quede a tu marca.`,
  },
  {
    category: 'Menú digital y pedidos',
    title: 'Cómo reciben los pedidos los clientes',
    content: `Tu menú digital tiene botón "Pedir" en cada producto. El cliente arma su pedido en el carrito y al confirmar, se abre WhatsApp con el resumen del pedido listo para enviar a tu número.

Configurá tu número de WhatsApp en Configuración → Pedidos → Número de WhatsApp.

Opcional: podés activar el Kitchen Display (TV en la cocina) que recibe los pedidos en tiempo real desde Pedidos → Kitchen Display.`,
  },
  {
    category: 'Menú digital y pedidos',
    title: 'Cómo manejo el stock / inventario',
    content: `Si querés que ciertos productos se marquen "agotado" automáticamente:

1. Entrá al producto → pestaña "Inventario"
2. Activá "Control de stock"
3. Cargá la cantidad disponible

Cada vez que se confirma un pedido, descuenta del stock. Cuando llega a 0, el producto aparece "agotado" en el menú público y no se puede ordenar.

Para reponer stock, volvés al producto y actualizás la cantidad.`,
  },
  {
    category: 'Menú digital y pedidos',
    title: 'Productos recomendados y promociones',
    content: `- Recomendados: marcá hasta 6 productos como "Recomendados" desde el menú. Aparecen destacados arriba del menú público con badge.
- Promociones: en Menú → Promociones podés crear ofertas con precio especial, válidas por fechas. Aparecen en una sección "Promos" del menú público y se muestran tachadas al precio original.`,
  },

  // ============== APPLE WALLET Y GOOGLE WALLET ==============
  {
    category: 'Apple Wallet y Google Wallet',
    title: 'Mi tarjeta funciona en iPhone y Android',
    content: `Sí. Clubify genera tarjetas compatibles con:
- Apple Wallet (iPhone) — formato .pkpass
- Google Wallet (Android) — Google Pay Passes

Cuando un cliente abre el link de tu tarjeta, Clubify detecta si está en iPhone o Android y le ofrece el botón del wallet correcto. En PC le muestra los dos.

Las dos versiones se mantienen sincronizadas: si sumás un sello desde el scanner, se actualiza tanto en iPhone como en Android del mismo cliente.`,
  },
  {
    category: 'Apple Wallet y Google Wallet',
    title: 'Cómo se actualiza la tarjeta cuando sumo un sello',
    content: `Al confirmar un sello en el scanner, Clubify envía push silencioso al wallet del cliente:
- iPhone: notificación + tarjeta actualizada en segundos
- Android: tarjeta actualizada en segundos (sin notificación silenciosa, por limitación de Google Wallet)

Si el cliente tiene la tarjeta en lockscreen, ve el cambio inmediato. Si está cerrada, lo ve al abrirla.

Si el cliente reporta que no se le actualiza: que cierre y abra el wallet — el sync se fuerza al abrir.`,
  },
  {
    category: 'Apple Wallet y Google Wallet',
    title: 'Personalizar el diseño de la tarjeta wallet',
    content: `Desde Tarjetas → editar tarjeta → pestaña "Diseño" configurás:
- Color de fondo
- Color del texto
- Logo (recomendado PNG cuadrado con fondo transparente, 480x480px)
- Strip (la imagen tipo banner arriba de la tarjeta — 1125x432px ideal)
- Ícono del sello (estrella, corazón, taza de café, etc. — hay biblioteca de íconos)

El preview se actualiza al instante. Cuando guardás, las tarjetas ya emitidas se re-sincronizan en los wallets de tus clientes.`,
  },

  // ============== MARKETING Y QR ==============
  {
    category: 'Marketing y QR',
    title: 'Generador de QR Posters',
    content: `Clubify tiene un editor visual de carteles QR para imprimir y poner en el local.

1. Entrá a Marketing → QR Posters
2. Elegí un template (hay 12 prediseñados, 4 tipos: tarjeta, menú, reseñas, info)
3. Personalizalo: cambiá textos, colores, logo, agregá íconos o formas
4. Exportá en alta calidad (300 DPI) — listo para imprimir A4 o A3

El QR del cartel apunta automáticamente al recurso correcto de tu cuenta (tu tarjeta, tu menú, tu página de reseñas).`,
  },
  {
    category: 'Marketing y QR',
    title: 'Sistema de reseñas / filtro de Google Reviews',
    content: `Clubify filtra las reseñas para proteger tu reputación en Google:

1. Generás un QR de "Dejá tu reseña" desde Marketing → QR Posters → tipo Reseñas
2. El cliente lo escanea y elige cuántas estrellas dar (1-5)
3. Si elige 4 o 5 estrellas → lo redirigimos directo a Google Reviews para que publique allá
4. Si elige 1, 2 o 3 estrellas → cae en un formulario privado donde te cuenta qué pasó, sin publicarse en Google

Vos ves todo el feedback privado en Reseñas → Feedback privado. Así las malas se quedan internas para que las resuelvas y las buenas suben tu rating público.`,
  },
  {
    category: 'Marketing y QR',
    title: 'Programa de referidos / afiliados',
    content: `Permite que tus clientes contentos refieran nuevos clientes y reciban premio:

1. Activá referidos en Configuración → Programa de Referidos
2. Definí el premio del referente (ej: 1 mes gratis de servicio, $X de descuento, etc.) y del referido (ej: 20% off primera compra)
3. Cada cliente recibe su link/código único de referido visible en su tarjeta wallet
4. Cuando un nuevo cliente compra usando ese código, los dos reciben el premio

Vos seguís todas las conversiones en Referidos → Dashboard. Hay 4 reglas de descuento configurables y reconciliación automática vía cron.`,
  },

  // ============== CONFIGURACIÓN Y BRANDING ==============
  {
    category: 'Configuración y branding',
    title: 'Personalizar la marca (colores, logo, favicon)',
    content: `1. Entrá a Configuración → Marca (o /admin/branding)
2. Subí tu logo (PNG transparente, 200x200px mínimo)
3. Elegí color primario y secundario
4. Subí favicon (32x32 .ico o .png)
5. Cargá imagen Open Graph (1200x630px) para previews en WhatsApp/redes

Los cambios aplican inmediatamente en tu menú público, tarjetas, mensajes y emails. La marca "Clubify" siempre aparece en el footer y en notificaciones del sistema — eso no se puede ocultar.`,
  },
  {
    category: 'Configuración y branding',
    title: 'Tener mi propio subdominio',
    content: `Cada cuenta Clubify tiene un subdominio gratuito automático: <tu-slug>.soyclubify.com. Lo configurás en Configuración → Tienda → Slug.

Ej: si tu slug es "cafetal", tu menú público queda en cafetal.soyclubify.com.

Para usar tu propio dominio (ej: pedir.cafetal.com): hoy se hace caso por caso desde soporte. Escribinos por WhatsApp con el dominio que querés conectar y te guiamos.`,
  },
  {
    category: 'Configuración y branding',
    title: 'Idiomas — menú en inglés o portugués',
    content: `Clubify soporta 3 idiomas: español, inglés y portugués. El panel admin y la storefront pública detectan el idioma del navegador del visitante.

Los textos del sistema (botones, mensajes) ya están traducidos. Los nombres de tus productos los cargás en el idioma que quieras — Clubify no los traduce automáticamente.

Para forzar un idioma específico en tu storefront, agregá ?lang=es, ?lang=en o ?lang=pt al final del URL.`,
  },

  // ============== MULTI-RUBRO ==============
  {
    category: 'Multi-rubro',
    title: 'Para qué tipos de negocio funciona Clubify',
    content: `Clubify está optimizado para 24 categorías de negocios locales. Cada categoría adapta el menú lateral y los términos del producto:

Comida y bebida: Cafetería, Restaurante, Pizzería, Heladería, Bar, Foodtruck, Panadería, Pastelería.
Belleza y cuidado: Barbería, Peluquería, Salón de belleza, Spa, Uñas, Estética.
Servicios: Autolavado, Gimnasio, Lavandería, Veterinaria, Pet shop, Taller mecánico.
Comercio: Tienda de ropa, Florería, Vinería, Kiosco.

Cambiá tu categoría en Configuración → Negocio → Categoría. El panel se reorganiza para mostrar lo más relevante para tu rubro (ej: una cafetería ve "Menú", un autolavado ve "Servicios").`,
  },

  // ============== SOPORTE Y BUGS ==============
  {
    category: 'Soporte y bugs',
    title: 'Algo no funciona / encontré un bug',
    content: `Lamento que estés teniendo problemas. Para que el equipo lo resuelva rápido:

1. Mandanos un mensaje por WhatsApp al número que aparece en Configuración → Soporte
2. Incluí: qué intentabas hacer, qué pasó, y si podés screenshot del error
3. Si es algo que bloquea tu operación, decilo explícito y se prioriza

Atendemos en horario hábil LATAM. Bugs críticos se atacan apenas llegan.`,
  },
  {
    category: 'Soporte y bugs',
    title: 'Cómo cambio el email del dueño de la cuenta',
    content: `Por seguridad, el cambio de email del owner se hace desde soporte humano. Escribinos por WhatsApp desde el email actual de la cuenta indicando:
- Email actual
- Email nuevo
- Nombre del negocio

El equipo confirma identidad y procesa el cambio en 24-48hs hábiles.`,
  },
  {
    category: 'Soporte y bugs',
    title: 'Olvidé mi contraseña',
    content: `1. Andá a app.soyclubify.com/login
2. Click en "Olvidé mi contraseña"
3. Ingresá tu email — te llega un link de reset (revisar spam si no aparece)
4. Click en el link y cargás contraseña nueva

Si no te llega el email en 5 minutos: verificá que el email sea exactamente el que registraste y revisa carpeta de spam. Si persiste, escribinos por soporte.`,
  },
];

async function upsertMasterPrompt() {
  await prisma.setting.upsert({
    where: { key: MASTER_PROMPT_KEY },
    update: { value: MASTER_PROMPT },
    create: { key: MASTER_PROMPT_KEY, value: MASTER_PROMPT },
  });
  console.log(`✓ Master prompt seteado en Setting key '${MASTER_PROMPT_KEY}' (${MASTER_PROMPT.length} chars)`);
}

async function upsertEntries() {
  let created = 0;
  let updated = 0;
  for (const it of ENTRIES) {
    // Match por (title + category + audience=TENANT). No usamos upsert() de
    // Prisma porque KnowledgeEntry no tiene unique compuesto — hacemos
    // findFirst → update / create manual.
    const existing = await prisma.knowledgeEntry.findFirst({
      where: { title: it.title, category: it.category, audience: 'TENANT' },
    });
    if (existing) {
      await prisma.knowledgeEntry.update({
        where: { id: existing.id },
        data: { content: it.content, isActive: true },
      });
      updated++;
      console.log(`  ↻ updated: [${it.category}] ${it.title}`);
    } else {
      await prisma.knowledgeEntry.create({
        data: {
          title: it.title,
          content: it.content,
          category: it.category,
          audience: 'TENANT',
          isActive: true,
        },
      });
      created++;
      console.log(`  + created: [${it.category}] ${it.title}`);
    }
  }
  console.log(`\n✓ Entries: ${created} creadas, ${updated} actualizadas (${ENTRIES.length} totales)`);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('✗ DATABASE_URL no seteada');
    process.exit(1);
  }
  console.log('→ Seed knowledge base IA (audience=TENANT)...\n');
  await upsertMasterPrompt();
  console.log('');
  await upsertEntries();
  console.log('\n✓ Done. Siguiente paso: ir a /admin/ai-support y disparar re-embed para activar retrieval semántico (sino el sistema usa lexical fallback).');
}

main()
  .catch((e) => {
    console.error('✗ Error:', e.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
