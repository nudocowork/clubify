// Labels del pase de wallet (Apple .pkpass + Google LoyaltyObject) traducidos
// al idioma del cliente. Antes estaban hardcodeados en español → el pase salía
// en español aunque el cliente eligiera inglés (bug PDF 854).
//
// El locale se persiste en Customer.locale al enrolarse. Default 'es' → los
// clientes existentes (sin locale) no cambian. Variantes regionales
// (en-GB, pt-BR…) caen a su base.

export type PassLocale = 'es' | 'en' | 'pt' | 'it';

export function normalizePassLocale(raw?: string | null): PassLocale {
  const l = (raw || 'es').toLowerCase();
  if (l.startsWith('en')) return 'en';
  if (l.startsWith('pt')) return 'pt';
  if (l.startsWith('it')) return 'it';
  return 'es';
}

type Labels = {
  // Título / tipo de tarjeta
  loyalty_card: string;
  // Header por tipo
  stamps: string;
  points: string;
  visits: string;
  balance: string;
  tier: string;
  coupon: string;
  cashback: string;
  discount: string;
  // changeMessage (Apple: el "%@" lo rellena Apple con el value)
  stamps_change: string;
  points_change: string;
  visits_change: string;
  balance_change: string;
  tier_change: string;
  coupon_change: string;
  // Estados de cupón
  coupon_available: string;
  coupon_redeemed: string;
  member_default: string;
  // Tarjeta de ALIANZA (convenio con una empresa). El pase no cuenta nada: dice
  // si el beneficio está en pie. `alliance_paused` cubre las dos pausas —la del
  // negocio y la del aliado— a propósito: al empleado no se le dice cuál de las
  // dos empresas apagó su descuento, eso es asunto entre ellas.
  alliance: string;
  alliance_active: string;
  alliance_paused: string;
  alliance_ended: string;
  alliance_blocked: string;
  alliance_change: string;
  alliance_ask: (empresa: string) => string;
  // Tarjeta de CLUB (suscripción con cupo mensual). Cuenta al revés que un
  // cartón de sellos: empieza llena y se vacía. Por eso no puede reusar
  // `stamps_change` —«Sellos: 7» se lee «llevo 7», y significa «me quedan 7».
  //
  // `club_unit` es el respaldo para cuando el negocio no puso unidad: la unidad
  // de verdad («café», «lavada») la escribe él en español y no se traduce, que
  // es justo lo que la hace útil en la caja.
  club_unit: string;
  club_change: string;
  club_paused: string;
  club_hero: string;
  club_left: string;
  club_left_count: (n: number, unidad: string) => string;
  // Fields
  reward: string;
  customer: string;
  last_message: string;
  no_messages: string;
  card_number: string;
  terms: string;
  contact: string;
  created_by: (brand: string) => string;
  near_place: (brand: string) => string;
  // Hero image / textModules
  accumulate: string;
  missing_stamps: string;
  rewards: string;
  rewards_count: (n: number) => string;
  stamps_left: (n: number) => string;
  next_reward: string;
  how_to_earn: string;
  details: string;
  business: string;
};

const DICT: Record<PassLocale, Labels> = {
  es: {
    loyalty_card: 'Tarjeta de sellos',
    stamps: 'SELLOS', points: 'PUNTOS', visits: 'VISITAS', balance: 'SALDO', tier: 'NIVEL', coupon: 'CUPÓN', cashback: 'SALDO CASHBACK', discount: 'DESCUENTO',
    stamps_change: 'Sellos: %@', points_change: 'Puntos: %@', visits_change: 'Visitas: %@',
    balance_change: 'Saldo: %@', tier_change: 'Nuevo nivel: %@', coupon_change: 'Cupón: %@',
    coupon_available: 'DISPONIBLE', coupon_redeemed: 'REDIMIDO', member_default: 'Miembro',
    alliance: 'BENEFICIO', alliance_active: 'ACTIVO', alliance_paused: 'EN PAUSA',
    alliance_ended: 'FINALIZADO', alliance_blocked: 'DESACTIVADA',
    alliance_change: 'Beneficio: %@',
    alliance_ask: (e) => `Consulta con ${e}`,
    club_unit: 'BENEFICIOS', club_change: 'Te quedan: %@', club_paused: 'EN PAUSA',
    club_hero: 'Tu cupo del mes', club_left: 'Te quedan',
    club_left_count: (n, u) => `${n} ${u}`,
    reward: 'RECOMPENSA', customer: 'CLIENTE', last_message: 'Último mensaje',
    no_messages: 'Aún no hay mensajes', card_number: 'Número de tarjeta', terms: 'Condiciones', contact: 'Contacto',
    created_by: (b) => `Creado por ${b}`, near_place: (b) => `Estás cerca de ${b}`,
    accumulate: 'Acumula sellos y obtén beneficios', missing_stamps: 'Sellos faltantes',
    rewards: 'Recompensas', rewards_count: (n) => `${n} ${n === 1 ? 'premio' : 'premios'}`,
    stamps_left: (n) => `${n} ${n === 1 ? 'sello' : 'sellos'}`,
    next_reward: 'Premio siguiente', how_to_earn: 'Cómo ganar', details: 'Detalles', business: 'Negocio',
  },
  en: {
    loyalty_card: 'Loyalty Card',
    stamps: 'STAMPS', points: 'POINTS', visits: 'VISITS', balance: 'BALANCE', tier: 'TIER', coupon: 'COUPON', cashback: 'CASHBACK', discount: 'DISCOUNT',
    stamps_change: 'Stamps: %@', points_change: 'Points: %@', visits_change: 'Visits: %@',
    balance_change: 'Balance: %@', tier_change: 'New tier: %@', coupon_change: 'Coupon: %@',
    coupon_available: 'AVAILABLE', coupon_redeemed: 'REDEEMED', member_default: 'Member',
    alliance: 'BENEFIT', alliance_active: 'ACTIVE', alliance_paused: 'ON HOLD',
    alliance_ended: 'ENDED', alliance_blocked: 'DEACTIVATED',
    alliance_change: 'Benefit: %@',
    alliance_ask: (e) => `Check with ${e}`,
    club_unit: 'BENEFITS', club_change: 'Left: %@', club_paused: 'ON HOLD',
    club_hero: 'Your monthly allowance', club_left: 'Left',
    club_left_count: (n, u) => `${n} ${u}`,
    reward: 'REWARD', customer: 'MEMBER', last_message: 'Latest message',
    no_messages: 'No messages yet', card_number: 'Card number', terms: 'Terms', contact: 'Contact',
    created_by: (b) => `Made with ${b}`, near_place: (b) => `You're near ${b}`,
    accumulate: 'Collect stamps and earn rewards', missing_stamps: 'Stamps left',
    rewards: 'Rewards', rewards_count: (n) => `${n} ${n === 1 ? 'reward' : 'rewards'}`,
    stamps_left: (n) => `${n} ${n === 1 ? 'stamp' : 'stamps'}`,
    next_reward: 'Next reward', how_to_earn: 'How to earn', details: 'Details', business: 'Business',
  },
  pt: {
    loyalty_card: 'Cartão de selos',
    stamps: 'SELOS', points: 'PONTOS', visits: 'VISITAS', balance: 'SALDO', tier: 'NÍVEL', coupon: 'CUPOM', cashback: 'SALDO CASHBACK', discount: 'DESCONTO',
    stamps_change: 'Selos: %@', points_change: 'Pontos: %@', visits_change: 'Visitas: %@',
    balance_change: 'Saldo: %@', tier_change: 'Novo nível: %@', coupon_change: 'Cupom: %@',
    coupon_available: 'DISPONÍVEL', coupon_redeemed: 'RESGATADO', member_default: 'Membro',
    alliance: 'BENEFÍCIO', alliance_active: 'ATIVO', alliance_paused: 'EM PAUSA',
    alliance_ended: 'FINALIZADO', alliance_blocked: 'DESATIVADO',
    alliance_change: 'Benefício: %@',
    alliance_ask: (e) => `Consulte com ${e}`,
    club_unit: 'BENEFÍCIOS', club_change: 'Restam: %@', club_paused: 'EM PAUSA',
    club_hero: 'Sua cota do mês', club_left: 'Restam',
    club_left_count: (n, u) => `${n} ${u}`,
    reward: 'RECOMPENSA', customer: 'CLIENTE', last_message: 'Última mensagem',
    no_messages: 'Ainda sem mensagens', card_number: 'Número do cartão', terms: 'Condições', contact: 'Contato',
    created_by: (b) => `Feito com ${b}`, near_place: (b) => `Você está perto de ${b}`,
    accumulate: 'Acumule selos e ganhe benefícios', missing_stamps: 'Selos faltantes',
    rewards: 'Recompensas', rewards_count: (n) => `${n} ${n === 1 ? 'prêmio' : 'prêmios'}`,
    stamps_left: (n) => `${n} ${n === 1 ? 'selo' : 'selos'}`,
    next_reward: 'Próximo prêmio', how_to_earn: 'Como ganhar', details: 'Detalhes', business: 'Negócio',
  },
  it: {
    loyalty_card: 'Tessera fedeltà',
    stamps: 'BOLLI', points: 'PUNTI', visits: 'VISITE', balance: 'SALDO', tier: 'LIVELLO', coupon: 'COUPON', cashback: 'SALDO CASHBACK', discount: 'SCONTO',
    stamps_change: 'Bolli: %@', points_change: 'Punti: %@', visits_change: 'Visite: %@',
    balance_change: 'Saldo: %@', tier_change: 'Nuovo livello: %@', coupon_change: 'Coupon: %@',
    coupon_available: 'DISPONIBILE', coupon_redeemed: 'RISCATTATO', member_default: 'Membro',
    alliance: 'VANTAGGIO', alliance_active: 'ATTIVO', alliance_paused: 'IN PAUSA',
    alliance_ended: 'TERMINATO', alliance_blocked: 'DISATTIVATA',
    alliance_change: 'Vantaggio: %@',
    alliance_ask: (e) => `Rivolgiti a ${e}`,
    club_unit: 'VANTAGGI', club_change: 'Restano: %@', club_paused: 'IN PAUSA',
    club_hero: 'Il tuo credito del mese', club_left: 'Restano',
    club_left_count: (n, u) => `${n} ${u}`,
    reward: 'PREMIO', customer: 'CLIENTE', last_message: 'Ultimo messaggio',
    no_messages: 'Ancora nessun messaggio', card_number: 'Numero tessera', terms: 'Condizioni', contact: 'Contatto',
    created_by: (b) => `Creato con ${b}`, near_place: (b) => `Sei vicino a ${b}`,
    accumulate: 'Colleziona bolli e ottieni vantaggi', missing_stamps: 'Bolli mancanti',
    rewards: 'Premi', rewards_count: (n) => `${n} ${n === 1 ? 'premio' : 'premi'}`,
    stamps_left: (n) => `${n} ${n === 1 ? 'bollo' : 'bolli'}`,
    next_reward: 'Prossimo premio', how_to_earn: 'Come guadagnare', details: 'Dettagli', business: 'Attività',
  },
};

export function passLabels(locale?: string | null): Labels {
  return DICT[normalizePassLocale(locale)];
}
