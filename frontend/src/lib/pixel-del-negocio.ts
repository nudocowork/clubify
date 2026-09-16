/**
 * El píxel de Meta DEL NEGOCIO, en su menú público.
 *
 * QUÉ LO DIFERENCIA DEL DE LA MARCA
 * ---------------------------------
 * `WhiteLabel.metaPixelId` mide la landing de Sellea o de Clubify: gente que
 * podría comprar la plataforma. Este mide el menú de un restaurante: gente que
 * quiere un bubble tea. Son dos cuentas publicitarias distintas y de dueños
 * distintos, así que **los eventos de uno no pueden caer en el otro**.
 *
 * Por eso todo sale por `trackSingle`, que manda el evento SOLO al píxel que se
 * nombra. Con `fbq('track', …)` a secas, Meta lo reparte a **todos** los
 * píxeles inicializados en la página: en `app.selleala.com` un pedido de un
 * cliente del restaurante aparecería como conversión de Sellea, y las
 * audiencias de las dos cuentas quedarían mezcladas sin que nadie lo note.
 *
 * POR QUÉ UN MÓDULO CON ESTADO Y NO UNAS PROPS
 * --------------------------------------------
 * El carrito se toca desde media docena de componentes hijos (la ficha del
 * producto, las promociones, el carrito flotante). Pasar el id por props hasta
 * cada uno es la clase de hilo que alguien corta sin querer al mover un
 * componente, y el evento deja de mandarse **en silencio**. Se configura una
 * vez cuando llega el menú —igual que `configureTenantLocale`— y se dispara
 * desde donde haga falta.
 *
 * Lo pidió la agencia de Quipao el 2026-09-14. Sirve para cualquier negocio: el
 * id se guarda en el negocio, no en el código.
 */
import { pixelIdValido } from './meta-pixel';
// La regla de «qué sede va en el evento» vive aparte y en `.mjs` para poder
// probarla desde node: este módulo toca `window.fbq` y no se puede importar.
import { paramsConSede } from './sede-del-pixel.mjs';

/**
 * El cargador de Meta, tal cual lo entrega ellos, hasta justo antes del `init`.
 * Solo crea `window.fbq` y su cola; a quién se le manda cada evento lo deciden
 * las llamadas de abajo.
 */
const CARGADOR_DE_META = `!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window,document,'script',
'https://connect.facebook.net/en_US/fbevents.js');`;

/** El píxel del negocio que se está mirando. null = este negocio no mide. */
let pixelDelNegocio: string | null = null;
/**
 * La moneda del negocio, para no mandar nunca un importe sin ella.
 *
 * Meta DESCARTA en silencio un evento con `value` y sin `currency`: se ve
 * exactamente igual que «no llega nada», que es el peor fallo posible para
 * quien está pagando anuncios.
 */
let monedaDelNegocio = 'COP';
/** Ids ya inicializados en esta página, para no llamar `init` dos veces. */
const iniciados = new Set<string>();
/**
 * La sucursal desde la que se está pidiendo. null = el negocio no tiene sedes,
 * o todavía no se sabe cuál es.
 *
 * Va aquí, y no en cada evento, porque `AddToCart` se dispara desde
 * `lib/cart.ts` —el único sitio por el que entra algo al carrito— y allí no
 * hay forma de saber en qué sucursal está el cliente.
 */
let sedeDelNegocio: { id: string; nombre: string } | null = null;

/**
 * Dice desde qué sede se está pidiendo. Se llama cuando se sabe: al abrir el
 * menú con `?sede=`, y otra vez si el cliente elige una en el checkout.
 *
 * Sin id no hay sede: un nombre suelto no identifica nada y no se manda.
 */
export function configurarSedeDelNegocio(
  id: string | null | undefined,
  nombre?: string | null,
): void {
  const limpio = (id ?? '').trim();
  sedeDelNegocio = limpio
    ? { id: limpio, nombre: (nombre ?? '').trim() }
    : null;
}

/**
 * Deja listo el píxel del negocio y manda su `PageView`.
 *
 * Idempotente: se llama en cada carga del menú y al cambiar de sección, y solo
 * la primera inyecta el script.
 */
export function configurarPixelDelNegocio(
  raw: string | null | undefined,
  moneda?: string | null,
): void {
  const id = pixelIdValido(raw);
  pixelDelNegocio = id;
  const m = (moneda ?? '').trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(m)) monedaDelNegocio = m;
  if (!id || typeof window === 'undefined') return;
  if (iniciados.has(id)) return;

  // El código base solo se inyecta si no lo puso ya el layout de la marca:
  // define `window.fbq` y su cola, y meterlo dos veces la reinicia.
  //
  // Es el cargador de Meta SIN el `init`/`PageView` que trae el suyo: esos dos
  // van abajo y con `trackSingle`, para que el PageView del negocio no se le
  // cuente también al píxel de la marca.
  if (!window.fbq) {
    const s = document.createElement('script');
    s.innerHTML = CARGADOR_DE_META;
    document.head.appendChild(s);
  }
  // `Window.fbq` lo declara `components/MetaPixel.tsx`; declararlo otra vez
  // aquí con otra firma no compila (TS2717).
  window.fbq?.('init', id);
  iniciados.add(id);
  window.fbq?.('trackSingle', id, 'PageView');
}

/**
 * Un evento estándar de Meta para el píxel del negocio.
 *
 * Sin negocio configurado no hace nada — ni error ni evento a nadie: un menú
 * cuyo dueño no puso píxel no tiene por qué enterar a Meta de nada.
 */
export function eventoDelNegocio(
  evento: 'AddToCart' | 'InitiateCheckout' | 'Purchase' | 'ViewContent' | 'Contact',
  params?: Record<string, unknown>,
): void {
  if (!pixelDelNegocio || typeof window === 'undefined') return;
  const p = { ...(params ?? {}) };
  // La moneda se pone sola siempre que haya importe: ver `monedaDelNegocio`.
  if (p.value != null && p.currency == null) p.currency = monedaDelNegocio;
  // Y la sede, por la misma razón por la que el píxel es un módulo con estado:
  // `AddToCart` se dispara desde `lib/cart.ts`, que no tiene forma de saber en
  // qué sucursal está el cliente. Puesto aquí, los cuatro eventos del embudo
  // lo llevan sin que nadie tenga que acordarse en cada sitio.
  window.fbq?.(
    'trackSingle',
    pixelDelNegocio,
    evento,
    paramsConSede(p, sedeDelNegocio),
  );
}

/** Para las pruebas y para saber si hay que pintar el aviso de medición. */
export function pixelDelNegocioActivo(): string | null {
  return pixelDelNegocio;
}
