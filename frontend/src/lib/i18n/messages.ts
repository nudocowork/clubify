// Diccionarios de strings públicos (storefront, infolink, wallet, signup,
// reseñas, scanner público). El admin/panel sigue en español.
//
// Convención: claves planas con dot.notation. Los placeholders usan {{var}}.

export const messages = {
  es: {
    // Genéricos
    'common.loading': 'Cargando…',
    'common.close': 'Cerrar',
    'common.cancel': 'Cancelar',
    'common.continue': 'Continuar',
    'common.save': 'Guardar',
    'common.send': 'Enviar',
    'common.sending': 'Enviando…',
    'common.search': 'Buscar',
    'common.searching': 'Buscando…',
    'common.required': 'Obligatorio',
    'common.optional': 'opcional',
    'common.error': 'Algo salió mal. Intentá de nuevo.',
    'common.back': 'Volver',
    'common.edit': 'Editar',
    'common.add': 'Agregar',
    'common.remove': 'Quitar',
    'common.delete': 'Eliminar',
    'common.confirm': 'Confirmar',
    'common.next': 'Siguiente',
    'common.prev': 'Anterior',
    'common.total': 'Total',
    'common.subtotal': 'Subtotal',
    'common.yes': 'Sí',
    'common.no': 'No',
    'common.brand_powered': 'Powered by Clubify',

    // Storefront
    'storefront.unavailable_title': 'Negocio no disponible',
    'storefront.unavailable_msg':
      'Esta tienda no está activa en este momento. Contactá directamente al negocio o intentá más tarde.',
    'storefront.tab_menu': 'Menú',
    'storefront.tab_promos': 'Promociones',
    'storefront.menu_empty_title': 'Pronto publicamos el menú',
    'storefront.menu_empty_sub':
      'Mientras tanto, escribinos por WhatsApp para hacer tu pedido.',
    'storefront.menu_chat_wa': 'Hablar por WhatsApp →',
    'storefront.promos_empty_title': 'No hay promos activas',
    'storefront.promos_empty_sub':
      'Volvé pronto, siempre estamos lanzando algo nuevo.',
    'storefront.promo_label': '🎁 Promo',
    'storefront.promo_until': 'Hasta {{date}}',
    'storefront.promo_order_wa': '💬 Ordenar esta promo por WhatsApp',
    'storefront.promo_see_menu': 'Ver el menú →',
    'storefront.directions': 'Cómo llegar',
    'storefront.cart_items': '🛒 {{count}} items',
    'storefront.cart_order': 'Pedir →',

    // Producto modal
    'product.extras': 'Extras',
    'product.notes': 'Notas (opcional)',
    'product.add_to_cart': 'Agregar · {{total}}',

    // Carrito
    'cart.title': 'Tu pedido',
    'cart.empty': 'Tu carrito está vacío.',
    'cart.checkout_wa': 'Finalizar pedido por WhatsApp',

    // Checkout
    'checkout.title': 'Tus datos',
    'checkout.first_name': 'Nombre',
    'checkout.last_name': 'Apellido',
    'checkout.whatsapp': 'WhatsApp',
    'checkout.fulfillment_q': '¿Es para...?',
    'checkout.fulfillment_dinein': '🍽 Mesa',
    'checkout.fulfillment_dinein_hint': 'Escaneá el QR de tu mesa',
    'checkout.fulfillment_delivery': '🛵 Domicilio',
    'checkout.fulfillment_delivery_hint': 'Disponible en plan Pro',
    'checkout.no_options_title': '📍 Para pedir desde aquí',
    'checkout.no_options_sub':
      'Escaneá el QR de tu mesa, o contáctanos por WhatsApp para hacer tu pedido.',
    'checkout.table_locked': 'Pidiendo desde la mesa {{n}} · entregamos a tu mesa',
    'checkout.shipping_title': '📦 Dirección de envío',
    'checkout.dept': 'Departamento',
    'checkout.muni': 'Municipio',
    'checkout.muni_other': 'Nombre del municipio',
    'checkout.address': 'Dirección',
    'checkout.address_ph': 'Ej: Calle 123 #45-67, Apto 301, Barrio…',
    'checkout.notes': 'Notas (opcional)',
    'checkout.submit': 'Enviar pedido por WhatsApp',
    'checkout.error_address':
      'Completá departamento, municipio y dirección para entregar a domicilio.',

    // Card join (/c/[cardId])
    'card.join_title': 'Sumate al programa',
    'card.join_sub': 'Completá tus datos y empezá a acumular',
    'card.full_name': 'Nombre completo',
    'card.phone': 'Teléfono / WhatsApp',
    'card.email': 'Email (opcional)',
    'card.birthday': 'Cumpleaños (opcional)',
    'card.birth_day': 'Día',
    'card.birth_month': 'Mes',
    'card.submit': 'Quiero mi tarjeta',
    'card.submitting': 'Creando tu tarjeta…',
    'card.success_title': '¡Listo! Tu tarjeta ya está activa',
    'card.success_sub': 'Mostrala en cada compra para acumular',
    'card.unavailable_title': 'Tarjeta no disponible',
    'card.unavailable_msg':
      'Es posible que el negocio la haya pausado o que el link sea incorrecto. Pedile al negocio uno actualizado.',

    // Wallet view (/w/[passId])
    'wallet.add_apple': 'Añadir a Apple Wallet',
    'wallet.add_google': 'Añadir a Google Wallet',
    'wallet.show_at_counter': 'Mostrá este código al cajero',
    'wallet.stamps_progress': '{{n}} de {{total}}',
    'wallet.points_balance': 'Puntos disponibles',
    'wallet.cashback_balance': 'Saldo cashback',
    'wallet.visits_count': '{{n}} visitas',
    'wallet.tier': 'Nivel',

    // Reviews (/r/[slug])
    'review.title': '¿Cómo estuvo tu experiencia?',
    'review.sub': 'Tu opinión nos ayuda a mejorar',
    'review.5_stars_q': '¿Querés dejarnos tu reseña en Google?',
    'review.5_stars_cta': 'Dejá tu reseña en Google',
    'review.bad_title': 'Lamentamos lo que pasó',
    'review.bad_sub':
      'Contanos qué pasó para resolverlo. El dueño del negocio recibe esto al instante.',
    'review.your_name': 'Tu nombre',
    'review.your_phone': 'Tu WhatsApp',
    'review.your_message': '¿Qué pasó?',
    'review.send': 'Enviar feedback',
    'review.thanks_title': 'Gracias por tu feedback',
    'review.thanks_sub': 'El dueño del negocio se va a contactar con vos.',

    // Signup público
    'signup.title': 'Creá tu cuenta',
    'signup.sub': 'Activá Clubify para tu negocio en 1 minuto',
    'signup.business_name': 'Nombre del negocio',
    'signup.your_name': 'Tu nombre',
    'signup.email': 'Email',
    'signup.phone': 'WhatsApp',
    'signup.password': 'Contraseña',
    'signup.submit': 'Crear cuenta',
    'signup.have_account': '¿Ya tenés cuenta?',
    'signup.login': 'Ingresá',
  },

  en: {
    // Common
    'common.loading': 'Loading…',
    'common.close': 'Close',
    'common.cancel': 'Cancel',
    'common.continue': 'Continue',
    'common.save': 'Save',
    'common.send': 'Send',
    'common.sending': 'Sending…',
    'common.search': 'Search',
    'common.searching': 'Searching…',
    'common.required': 'Required',
    'common.optional': 'optional',
    'common.error': 'Something went wrong. Try again.',
    'common.back': 'Back',
    'common.edit': 'Edit',
    'common.add': 'Add',
    'common.remove': 'Remove',
    'common.delete': 'Delete',
    'common.confirm': 'Confirm',
    'common.next': 'Next',
    'common.prev': 'Previous',
    'common.total': 'Total',
    'common.subtotal': 'Subtotal',
    'common.yes': 'Yes',
    'common.no': 'No',
    'common.brand_powered': 'Powered by Clubify',

    // Storefront
    'storefront.unavailable_title': 'Business unavailable',
    'storefront.unavailable_msg':
      'This shop is not active right now. Reach out to the business directly or try again later.',
    'storefront.tab_menu': 'Menu',
    'storefront.tab_promos': 'Promotions',
    'storefront.menu_empty_title': 'Menu coming soon',
    'storefront.menu_empty_sub':
      'In the meantime, message us on WhatsApp to place your order.',
    'storefront.menu_chat_wa': 'Chat on WhatsApp →',
    'storefront.promos_empty_title': 'No active promotions',
    'storefront.promos_empty_sub':
      'Check back soon — we are always launching new offers.',
    'storefront.promo_label': '🎁 Promo',
    'storefront.promo_until': 'Until {{date}}',
    'storefront.promo_order_wa': '💬 Order this promo on WhatsApp',
    'storefront.promo_see_menu': 'See the menu →',
    'storefront.directions': 'Directions',
    'storefront.cart_items': '🛒 {{count}} items',
    'storefront.cart_order': 'Order →',

    // Product modal
    'product.extras': 'Extras',
    'product.notes': 'Notes (optional)',
    'product.add_to_cart': 'Add · {{total}}',

    // Cart
    'cart.title': 'Your order',
    'cart.empty': 'Your cart is empty.',
    'cart.checkout_wa': 'Place order on WhatsApp',

    // Checkout
    'checkout.title': 'Your details',
    'checkout.first_name': 'First name',
    'checkout.last_name': 'Last name',
    'checkout.whatsapp': 'WhatsApp',
    'checkout.fulfillment_q': "What's it for?",
    'checkout.fulfillment_dinein': '🍽 Dine-in',
    'checkout.fulfillment_dinein_hint': 'Scan your table QR',
    'checkout.fulfillment_delivery': '🛵 Delivery',
    'checkout.fulfillment_delivery_hint': 'Available on Pro plan',
    'checkout.no_options_title': '📍 To order from here',
    'checkout.no_options_sub':
      'Scan your table QR, or contact us on WhatsApp to place your order.',
    'checkout.table_locked': 'Ordering from table {{n}} · we deliver to your table',
    'checkout.shipping_title': '📦 Shipping address',
    'checkout.dept': 'State / Department',
    'checkout.muni': 'City / Town',
    'checkout.muni_other': 'City name',
    'checkout.address': 'Address',
    'checkout.address_ph': 'Ex: 123 Main St, Apt 301, neighborhood…',
    'checkout.notes': 'Notes (optional)',
    'checkout.submit': 'Place order on WhatsApp',
    'checkout.error_address':
      'Fill in state, city and address for delivery.',

    // Card join
    'card.join_title': 'Join the rewards program',
    'card.join_sub': 'Complete your details and start earning',
    'card.full_name': 'Full name',
    'card.phone': 'Phone / WhatsApp',
    'card.email': 'Email (optional)',
    'card.birthday': 'Birthday (optional)',
    'card.birth_day': 'Day',
    'card.birth_month': 'Month',
    'card.submit': 'Get my card',
    'card.submitting': 'Creating your card…',
    'card.success_title': "All set! Your card is active",
    'card.success_sub': 'Show it at every visit to earn',
    'card.unavailable_title': 'Card unavailable',
    'card.unavailable_msg':
      'The business may have paused this card or the link may be wrong. Ask the business for an updated one.',

    // Wallet view
    'wallet.add_apple': 'Add to Apple Wallet',
    'wallet.add_google': 'Add to Google Wallet',
    'wallet.show_at_counter': 'Show this code at the counter',
    'wallet.stamps_progress': '{{n}} of {{total}}',
    'wallet.points_balance': 'Available points',
    'wallet.cashback_balance': 'Cashback balance',
    'wallet.visits_count': '{{n}} visits',
    'wallet.tier': 'Tier',

    // Reviews
    'review.title': 'How was your experience?',
    'review.sub': 'Your feedback helps us improve',
    'review.5_stars_q': 'Would you leave us a review on Google?',
    'review.5_stars_cta': 'Leave your review on Google',
    'review.bad_title': "We're sorry to hear that",
    'review.bad_sub':
      "Tell us what happened so we can fix it. The owner gets this instantly.",
    'review.your_name': 'Your name',
    'review.your_phone': 'Your WhatsApp',
    'review.your_message': 'What happened?',
    'review.send': 'Send feedback',
    'review.thanks_title': 'Thanks for your feedback',
    'review.thanks_sub': 'The owner will reach out to you.',

    // Signup
    'signup.title': 'Create your account',
    'signup.sub': 'Activate Clubify for your business in 1 minute',
    'signup.business_name': 'Business name',
    'signup.your_name': 'Your name',
    'signup.email': 'Email',
    'signup.phone': 'WhatsApp',
    'signup.password': 'Password',
    'signup.submit': 'Create account',
    'signup.have_account': 'Already have an account?',
    'signup.login': 'Sign in',
  },

  pt: {
    // Common
    'common.loading': 'Carregando…',
    'common.close': 'Fechar',
    'common.cancel': 'Cancelar',
    'common.continue': 'Continuar',
    'common.save': 'Salvar',
    'common.send': 'Enviar',
    'common.sending': 'Enviando…',
    'common.search': 'Buscar',
    'common.searching': 'Buscando…',
    'common.required': 'Obrigatório',
    'common.optional': 'opcional',
    'common.error': 'Algo deu errado. Tente novamente.',
    'common.back': 'Voltar',
    'common.edit': 'Editar',
    'common.add': 'Adicionar',
    'common.remove': 'Remover',
    'common.delete': 'Excluir',
    'common.confirm': 'Confirmar',
    'common.next': 'Próximo',
    'common.prev': 'Anterior',
    'common.total': 'Total',
    'common.subtotal': 'Subtotal',
    'common.yes': 'Sim',
    'common.no': 'Não',
    'common.brand_powered': 'Powered by Clubify',

    // Storefront
    'storefront.unavailable_title': 'Negócio indisponível',
    'storefront.unavailable_msg':
      'Esta loja não está ativa no momento. Entre em contato com o negócio ou tente mais tarde.',
    'storefront.tab_menu': 'Cardápio',
    'storefront.tab_promos': 'Promoções',
    'storefront.menu_empty_title': 'Em breve publicamos o cardápio',
    'storefront.menu_empty_sub':
      'Enquanto isso, escreva pelo WhatsApp para fazer seu pedido.',
    'storefront.menu_chat_wa': 'Falar no WhatsApp →',
    'storefront.promos_empty_title': 'Sem promoções ativas',
    'storefront.promos_empty_sub':
      'Volte em breve — sempre estamos lançando algo novo.',
    'storefront.promo_label': '🎁 Promo',
    'storefront.promo_until': 'Até {{date}}',
    'storefront.promo_order_wa': '💬 Pedir esta promo no WhatsApp',
    'storefront.promo_see_menu': 'Ver o cardápio →',
    'storefront.directions': 'Como chegar',
    'storefront.cart_items': '🛒 {{count}} itens',
    'storefront.cart_order': 'Pedir →',

    // Product modal
    'product.extras': 'Extras',
    'product.notes': 'Notas (opcional)',
    'product.add_to_cart': 'Adicionar · {{total}}',

    // Cart
    'cart.title': 'Seu pedido',
    'cart.empty': 'Seu carrinho está vazio.',
    'cart.checkout_wa': 'Finalizar pedido no WhatsApp',

    // Checkout
    'checkout.title': 'Seus dados',
    'checkout.first_name': 'Nome',
    'checkout.last_name': 'Sobrenome',
    'checkout.whatsapp': 'WhatsApp',
    'checkout.fulfillment_q': 'É para...?',
    'checkout.fulfillment_dinein': '🍽 Mesa',
    'checkout.fulfillment_dinein_hint': 'Escaneie o QR da sua mesa',
    'checkout.fulfillment_delivery': '🛵 Entrega',
    'checkout.fulfillment_delivery_hint': 'Disponível no plano Pro',
    'checkout.no_options_title': '📍 Para pedir daqui',
    'checkout.no_options_sub':
      'Escaneie o QR da sua mesa, ou fale conosco pelo WhatsApp para fazer seu pedido.',
    'checkout.table_locked': 'Pedindo da mesa {{n}} · entregamos na sua mesa',
    'checkout.shipping_title': '📦 Endereço de entrega',
    'checkout.dept': 'Estado',
    'checkout.muni': 'Cidade',
    'checkout.muni_other': 'Nome da cidade',
    'checkout.address': 'Endereço',
    'checkout.address_ph': 'Ex: Rua 123 nº 45, Apto 301, bairro…',
    'checkout.notes': 'Notas (opcional)',
    'checkout.submit': 'Enviar pedido pelo WhatsApp',
    'checkout.error_address':
      'Preencha estado, cidade e endereço para entrega.',

    // Card join
    'card.join_title': 'Entre no programa',
    'card.join_sub': 'Preencha seus dados e comece a acumular',
    'card.full_name': 'Nome completo',
    'card.phone': 'Telefone / WhatsApp',
    'card.email': 'Email (opcional)',
    'card.birthday': 'Aniversário (opcional)',
    'card.birth_day': 'Dia',
    'card.birth_month': 'Mês',
    'card.submit': 'Quero meu cartão',
    'card.submitting': 'Criando seu cartão…',
    'card.success_title': 'Pronto! Seu cartão está ativo',
    'card.success_sub': 'Mostre em cada visita para acumular',
    'card.unavailable_title': 'Cartão indisponível',
    'card.unavailable_msg':
      'O negócio pode ter pausado este cartão ou o link pode estar errado. Peça um novo ao negócio.',

    // Wallet view
    'wallet.add_apple': 'Adicionar à Apple Wallet',
    'wallet.add_google': 'Adicionar à Google Wallet',
    'wallet.show_at_counter': 'Mostre este código no caixa',
    'wallet.stamps_progress': '{{n}} de {{total}}',
    'wallet.points_balance': 'Pontos disponíveis',
    'wallet.cashback_balance': 'Saldo cashback',
    'wallet.visits_count': '{{n}} visitas',
    'wallet.tier': 'Nível',

    // Reviews
    'review.title': 'Como foi sua experiência?',
    'review.sub': 'Seu feedback nos ajuda a melhorar',
    'review.5_stars_q': 'Pode deixar sua avaliação no Google?',
    'review.5_stars_cta': 'Deixe sua avaliação no Google',
    'review.bad_title': 'Lamentamos o ocorrido',
    'review.bad_sub':
      'Conte o que aconteceu para resolvermos. O dono recebe na hora.',
    'review.your_name': 'Seu nome',
    'review.your_phone': 'Seu WhatsApp',
    'review.your_message': 'O que aconteceu?',
    'review.send': 'Enviar feedback',
    'review.thanks_title': 'Obrigado pelo feedback',
    'review.thanks_sub': 'O dono entrará em contato com você.',

    // Signup
    'signup.title': 'Crie sua conta',
    'signup.sub': 'Ative o Clubify para seu negócio em 1 minuto',
    'signup.business_name': 'Nome do negócio',
    'signup.your_name': 'Seu nome',
    'signup.email': 'Email',
    'signup.phone': 'WhatsApp',
    'signup.password': 'Senha',
    'signup.submit': 'Criar conta',
    'signup.have_account': 'Já tem conta?',
    'signup.login': 'Entrar',
  },
} as const;

export type MessageKey = keyof typeof messages.es;
