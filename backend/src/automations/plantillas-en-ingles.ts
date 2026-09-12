/**
 * Las automatizaciones de fábrica, en inglés.
 *
 * POR QUÉ (Javier, 2026-09-11): «a JEANK se le dio traducir a inglés, ya que
 * es un negocio de Estados Unidos, sin embargo el sistema no hizo la
 * traducción total de su negocio. Los copys, los textos de las push en
 * automático, TODO».
 *
 * Las seis recetas pre-armadas estaban en español fijo: un negocio de Estados
 * Unidos activaba «Bienvenida al inscribirse» y sus clientes recibían
 * «¡Bienvenido/a Ashley! Tu tarjeta está activa». El texto es editable después,
 * pero nadie edita lo que da por hecho que ya está bien.
 *
 * Solo se traduce lo que escribimos NOSOTROS. Las variables (`{{customerName}}`,
 * `{{rewardText}}`) las rellena el sistema con datos del negocio, y esos siguen
 * como los escribió su dueño.
 *
 * Español sigue siendo el respaldo: 121 de los 123 negocios están en español y
 * no cambia nada para ellos.
 */
export type TextoDePlantilla = {
  name: string;
  description: string;
  /** Un par título/cuerpo por cada acción de la receta, en el mismo orden. */
  actions: Array<{ title?: string; body?: string }>;
};

export const PLANTILLAS_EN: Record<string, TextoDePlantilla> = {
  welcome: {
    name: 'Welcome on sign-up',
    description: 'Greets the customer as soon as they get their first loyalty card.',
    actions: [
      {
        title: 'Welcome, {{customerName}}! 🎉',
        body: 'Your {{cardName}} card is active. Start earning toward your first reward.',
      },
    ],
  },
  'near-reward': {
    name: 'Close to the reward',
    description: 'Lets the customer know when they are 1-2 stamps away from their reward.',
    actions: [
      {
        title: 'Only {{remaining}} to go! 🔥',
        body: "You're {{remaining}} away from {{rewardText}}. Come in today!",
      },
    ],
  },
  'reward-ready': {
    name: 'Reward ready to redeem',
    description: 'Tells the customer they completed the card and can redeem.',
    actions: [
      {
        title: '🎁 Reward unlocked!',
        body: '{{rewardText}} is yours. Redeem it on your next visit.',
      },
    ],
  },
  birthday: {
    name: 'Birthday greeting',
    description: 'Automatic push on the customer birthday with a personal message.',
    actions: [
      {
        title: '🎉 Happy birthday, {{customerName}}',
        body: 'Come by {{businessName}} — we have a gift for you 🎁',
      },
    ],
  },
  'reactivation-30d': {
    name: '30-day win-back',
    description: 'Message to customers who have not visited in 30 days, to bring them back.',
    actions: [
      {
        title: 'We miss you, {{customerName}} 💌',
        body: "It's been a month. Stop by this week and enjoy your rewards.",
      },
    ],
  },
  'redeemed-thanks': {
    name: 'Thanks after redeeming',
    description: 'Thanks the customer after redeeming a reward to keep them engaged.',
    actions: [
      {
        title: '🙌 Thanks for redeeming',
        body: 'Hope you enjoy it! Start earning again — there are more rewards waiting.',
      },
    ],
  },
};

/** ¿Este negocio trabaja en inglés? `Tenant.locale` = 'en-US', 'en-GB'… */
export function enIngles(locale?: string | null): boolean {
  return (locale ?? '').toLowerCase().startsWith('en');
}

/**
 * La receta en el idioma del negocio.
 *
 * Devuelve el MISMO objeto si no hay traducción, así que una receta nueva que
 * nadie tradujo sigue funcionando en español en vez de quedarse sin texto —
 * que es el fallo que se cuela cuando la traducción se hace por sustitución
 * ciega.
 */
export function plantillaEnIdioma<
  T extends {
    id: string;
    name: string;
    description: string;
    actions: Array<Record<string, unknown>>;
  },
>(tpl: T, locale?: string | null): T {
  if (!enIngles(locale)) return tpl;
  const en = PLANTILLAS_EN[tpl.id];
  if (!en) return tpl;
  return {
    ...tpl,
    name: en.name,
    description: en.description,
    actions: tpl.actions.map((a, i) => {
      const t = en.actions[i];
      if (!t) return a;
      return {
        ...a,
        ...(t.title !== undefined ? { title: t.title } : {}),
        ...(t.body !== undefined ? { body: t.body } : {}),
      };
    }),
  };
}
