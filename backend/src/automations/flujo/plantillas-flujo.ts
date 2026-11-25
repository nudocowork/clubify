/**
 * Plantillas de flujo de Clubify: globales, no son de ningún negocio.
 *
 * Usar una COPIA la estructura en un flujo nuevo en borrador; la plantilla no
 * se toca nunca, así que cambiar un texto aquí no altera los flujos que ya se
 * crearon con ella. Viven en el código (y no en una tabla) para que cambien con
 * revisión y despliegue, como el resto del catálogo.
 *
 * Los textos van en el idioma del negocio (`Tenant.locale`): un negocio en
 * inglés que elegía una receta en español acababa escribiendo a sus clientes
 * en otro idioma ([[clubify-idioma-del-negocio]]).
 */
import { Grafo, Nodo, TipoNodo } from './grafo';

type Idioma = 'es' | 'en';
type Txt = Record<Idioma, string>;

type PasoPlantilla =
  | { t: 'wait'; amount: number; unit: 'minutes' | 'hours' | 'days' | 'weeks' }
  | { t: 'push'; title: Txt; body: Txt }
  | { t: 'condition'; field: string; op: string; value?: number; yes: PasoPlantilla[]; no: PasoPlantilla[] };

export type PlantillaFlujo = {
  key: string;
  categoria: string;
  icono: string;
  nombre: Txt;
  descripcion: Txt;
  objetivo: Txt;
  triggerType: string;
  triggerDays?: number;
  reentry: 'once' | 'after_finish';
  pasos: PasoPlantilla[];
};

const tx = (es: string, en: string): Txt => ({ es, en });
const push = (title: Txt, body: Txt): PasoPlantilla => ({ t: 'push', title, body });
const esperar = (amount: number, unit: 'days' | 'hours' = 'days'): PasoPlantilla => ({ t: 'wait', amount, unit });

export const PLANTILLAS_FLUJO: PlantillaFlujo[] = [
  {
    key: 'bienvenida',
    categoria: 'bienvenida',
    icono: 'sparkles',
    nombre: tx('Bienvenida a nuevos clientes', 'Welcome new customers'),
    descripcion: tx(
      'Tres mensajes en los primeros 10 días para que vuelva pronto.',
      'Three messages over the first 10 days so they come back soon.',
    ),
    objetivo: tx('Segunda visita', 'Second visit'),
    triggerType: 'PASS_CREATED',
    reentry: 'once',
    pasos: [
      esperar(2),
      push(
        tx('¡Bienvenido, {{customerName}}! 👋', 'Welcome, {{customerName}}! 👋'),
        tx(
          'Gracias por unirte a {{businessName}}. Cada visita suma para tu premio.',
          'Thanks for joining {{businessName}}. Every visit counts toward your reward.',
        ),
      ),
      esperar(3),
      push(
        tx('Tu tarjeta te espera ☕', 'Your card is waiting ☕'),
        tx(
          'Con tu tarjeta de {{businessName}} ganas {{rewardText}}. ¡Ven a sumar tu próximo sello!',
          'With your {{businessName}} card you earn {{rewardText}}. Come get your next stamp!',
        ),
      ),
      esperar(5),
      push(
        tx('Te estamos esperando', 'We are waiting for you'),
        tx(
          'Hace unos días te uniste a {{businessName}}. Pasa a visitarnos: tenemos algo especial para ti.',
          'You joined {{businessName}} a few days ago. Drop by: we have something special for you.',
        ),
      ),
    ],
  },
  {
    key: 'sin_actividad',
    categoria: 'reactivacion',
    icono: 'moon',
    nombre: tx('Cliente sin actividad', 'Inactive customer'),
    descripcion: tx(
      'A los 7 días sin visita le escribe; si a los 5 días sigue sin venir, insiste una vez.',
      'Writes after 7 days without a visit; if they still have not come 5 days later, tries once more.',
    ),
    objetivo: tx('Recuperar clientes', 'Win customers back'),
    triggerType: 'INACTIVITY',
    triggerDays: 7,
    reentry: 'after_finish',
    pasos: [
      push(
        tx('Te extrañamos, {{customerName}}', 'We miss you, {{customerName}}'),
        tx(
          'Hace una semana que no pasas por {{businessName}}. Tu tarjeta sigue sumando: te faltan {{remaining}} para tu premio.',
          'It has been a week since you visited {{businessName}}. You are {{remaining}} away from your reward.',
        ),
      ),
      esperar(5),
      {
        t: 'condition',
        field: 'tuvo_sello_desde_que_entro',
        op: 'is_false',
        yes: [
          push(
            tx('¿Volvemos a vernos? 🙌', 'See you soon? 🙌'),
            tx(
              'Tu próximo sello en {{businessName}} te acerca a {{rewardText}}. ¡Te esperamos!',
              'Your next stamp at {{businessName}} gets you closer to {{rewardText}}. See you!',
            ),
          ),
        ],
        no: [],
      },
    ],
  },
  {
    key: 'proxima_visita',
    categoria: 'fidelizacion',
    icono: 'stamp',
    nombre: tx('Incentivar la próxima visita', 'Encourage the next visit'),
    descripcion: tx(
      'Después de cada sello: si le falta poco para el premio se lo recuerda; si no, lo anima a seguir.',
      'After each stamp: if the reward is close it says so; otherwise it cheers them on.',
    ),
    objetivo: tx('Completar la tarjeta', 'Complete the card'),
    triggerType: 'STAMP_ADDED',
    reentry: 'after_finish',
    pasos: [
      {
        t: 'condition',
        field: 'sellos_faltantes',
        op: 'lte',
        value: 2,
        yes: [
          push(
            tx('¡Ya casi! 🎁', 'Almost there! 🎁'),
            tx(
              'Te faltan {{remaining}} para {{rewardText}} en {{businessName}}.',
              'You are {{remaining}} away from {{rewardText}} at {{businessName}}.',
            ),
          ),
        ],
        no: [
          push(
            tx('¡Un sello más! ✨', 'One more stamp! ✨'),
            tx(
              'Llevas {{stampsCount}} sellos en {{businessName}}. Sigue sumando para tu premio.',
              'You have {{stampsCount}} stamps at {{businessName}}. Keep going for your reward.',
            ),
          ),
        ],
      },
    ],
  },
  {
    key: 'recompensa',
    categoria: 'recompensas',
    icono: 'gift',
    nombre: tx('Recompensa desbloqueada', 'Reward unlocked'),
    descripcion: tx(
      'Lo felicita al completar la tarjeta y, si a los 2 días no ha reclamado el premio, se lo recuerda.',
      'Congratulates them on completing the card and, if the reward is not claimed in 2 days, reminds them.',
    ),
    objetivo: tx('Que reclame el premio', 'Get the reward claimed'),
    triggerType: 'PASS_COMPLETED',
    reentry: 'after_finish',
    pasos: [
      push(
        tx('¡Ganaste tu premio! 🎉', 'You earned your reward! 🎉'),
        tx(
          'Completaste tu tarjeta en {{businessName}}. Ven a reclamar {{rewardText}}.',
          'You completed your {{businessName}} card. Come claim {{rewardText}}.',
        ),
      ),
      esperar(2),
      {
        t: 'condition',
        field: 'canjeo_desde_que_entro',
        op: 'is_false',
        yes: [
          push(
            tx('Tu premio te espera', 'Your reward is waiting'),
            tx('{{rewardText}} sigue esperándote en {{businessName}}.', '{{rewardText}} is still waiting for you at {{businessName}}.'),
          ),
        ],
        no: [],
      },
    ],
  },
  {
    key: 'cupon_emitido',
    categoria: 'cupones',
    icono: 'ticket',
    nombre: tx('Cupón emitido', 'Coupon issued'),
    descripcion: tx(
      'Avisa del cupón y, si a los 2 días sigue sin usarlo, se lo recuerda.',
      'Announces the coupon and, if it is still unused 2 days later, reminds them.',
    ),
    objetivo: tx('Que use el cupón', 'Get the coupon used'),
    triggerType: 'COUPON_ISSUED',
    reentry: 'once',
    pasos: [
      push(
        tx('Tienes un cupón 🎟️', 'You have a coupon 🎟️'),
        tx('Tu cupón de {{businessName}} ya está en tu Wallet. Úsalo en tu próxima visita.', 'Your {{businessName}} coupon is in your Wallet. Use it on your next visit.'),
      ),
      esperar(2),
      {
        t: 'condition',
        field: 'cupon_activo',
        op: 'is_true',
        yes: [
          push(
            tx('No olvides tu cupón', 'Do not forget your coupon'),
            tx('Tu cupón de {{businessName}} sigue disponible. ¡Te esperamos!', 'Your {{businessName}} coupon is still available. See you!'),
          ),
        ],
        no: [],
      },
    ],
  },
  {
    key: 'cumpleanos',
    categoria: 'cumpleanos',
    icono: 'cake',
    nombre: tx('Cumpleaños', 'Birthday'),
    descripcion: tx(
      'Lo felicita el día de su cumpleaños y, si tiene un beneficio pendiente, se lo recuerda a los 2 días.',
      'Greets them on their birthday and, if they have a pending benefit, reminds them 2 days later.',
    ),
    objetivo: tx('Visita de cumpleaños', 'Birthday visit'),
    triggerType: 'BIRTHDAY',
    reentry: 'after_finish',
    pasos: [
      push(
        tx('¡Feliz cumpleaños, {{customerName}}! 🎂', 'Happy birthday, {{customerName}}! 🎂'),
        tx('En {{businessName}} te deseamos un gran día. Ven a celebrarlo con nosotros.', 'Everyone at {{businessName}} wishes you a great day. Come celebrate with us.'),
      ),
      esperar(2),
      {
        t: 'condition',
        field: 'beneficio_disponible',
        op: 'is_true',
        yes: [
          push(
            tx('Tienes un beneficio esperándote', 'A benefit is waiting for you'),
            tx('Aún tienes un beneficio sin usar en {{businessName}}. ¡Aprovéchalo!', 'You still have an unused benefit at {{businessName}}. Enjoy it!'),
          ),
        ],
        no: [],
      },
    ],
  },
  {
    key: 'cliente_regresa',
    categoria: 'retencion',
    icono: 'repeat',
    nombre: tx('Cliente que regresa', 'Returning customer'),
    descripcion: tx(
      'Cuando alguien vuelve tras 30 días o más sin venir, le da las gracias y a los 3 días lo invita a seguir.',
      'When someone returns after 30+ days away, thanks them and invites them to keep going 3 days later.',
    ),
    objetivo: tx('Que no se vuelva a ir', 'Keep them coming'),
    triggerType: 'STAMP_ADDED',
    reentry: 'after_finish',
    pasos: [
      {
        t: 'condition',
        field: 'dias_desde_visita_anterior',
        op: 'gte',
        value: 30,
        yes: [
          push(
            tx('¡Qué bueno verte de nuevo! 💚', 'Great to see you again! 💚'),
            tx('Gracias por volver a {{businessName}}, {{customerName}}.', 'Thanks for coming back to {{businessName}}, {{customerName}}.'),
          ),
          esperar(3),
          push(
            tx('Sigue sumando', 'Keep collecting'),
            tx('Llevas {{stampsCount}} sellos. Te faltan {{remaining}} para {{rewardText}}.', 'You have {{stampsCount}} stamps. {{remaining}} more for {{rewardText}}.'),
          ),
        ],
        no: [],
      },
    ],
  },
  {
    key: 'vacio',
    categoria: 'personalizado',
    icono: 'plus',
    nombre: tx('Flujo en blanco', 'Blank flow'),
    descripcion: tx('Elige el disparador y arma los pasos desde cero.', 'Pick the trigger and build the steps from scratch.'),
    objetivo: tx('El que tú definas', 'Your own goal'),
    triggerType: '',
    reentry: 'once',
    pasos: [],
  },
];

export function idiomaDe(locale: string | null | undefined): Idioma {
  return String(locale ?? '').toLowerCase().startsWith('en') ? 'en' : 'es';
}

/** Convierte los pasos de una plantilla en un grafo con ids nuevos. */
export function grafoDePlantilla(p: PlantillaFlujo, idioma: Idioma, nuevoId: () => string): Grafo {
  const nodes: Record<string, Nodo> = {};
  const armar = (pasos: PasoPlantilla[]): string | null => {
    let primero: string | null = null;
    let anterior: Nodo | null = null;
    for (const paso of pasos) {
      const id = nuevoId();
      let n: Nodo;
      if (paso.t === 'wait') {
        n = { id, type: 'wait', config: { amount: paso.amount, unit: paso.unit }, next: null };
      } else if (paso.t === 'push') {
        n = { id, type: 'push', config: { title: paso.title[idioma], body: paso.body[idioma] }, next: null };
      } else {
        n = {
          id,
          type: 'condition' as TipoNodo,
          config: { field: paso.field, op: paso.op, ...(paso.value !== undefined ? { value: paso.value } : {}) },
          yes: null,
          no: null,
        };
        nodes[id] = n;
        n.yes = armar(paso.yes);
        n.no = armar(paso.no);
      }
      nodes[id] = n;
      if (anterior) anterior.next = id;
      else primero = id;
      // Tras una condición no se encadena nada: cada rama termina por su cuenta.
      anterior = n.type === 'condition' ? null : n;
      if (n.type === 'condition') break;
    }
    return primero;
  };
  const rootId = armar(p.pasos);
  return { rootId, nodes };
}

export function contarPasos(p: PlantillaFlujo): number {
  const c = (ps: PasoPlantilla[]): number =>
    ps.reduce((a, x) => a + 1 + (x.t === 'condition' ? c(x.yes) + c(x.no) : 0), 0);
  return c(p.pasos);
}
