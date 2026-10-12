import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';

export type VariantDto = {
  id?: string;
  groupName?: string;
  name: string;
  priceDelta: number;
  isDefault?: boolean;
  position?: number;
};

export type ExtraDto = {
  id?: string;
  name: string;
  price: number;
  maxQty?: number;
  isAvailable?: boolean;
};

/** Hasta dónde llega un cambio: solo la carta que se está editando, o también
 *  las copias enganchadas de las demás. Ver `update`. */
export type AlcanceDelCambio = 'solo-esta' | 'todas';

export type ProductDto = {
  /** Lo eligió quien edita. Ausente = «todas», que es como se comportaba antes. */
  alcance?: AlcanceDelCambio;
  // null/undefined → producto sin categoría (Bloque 2 2026-06-12).
  categoryId?: string | null;
  name: string;
  description?: string;
  basePrice: number;
  /** "FIXED" (default) o "RANGE". RANGE muestra "Desde X — hasta Y". */
  priceMode?: 'FIXED' | 'RANGE';
  /** Solo aplica cuando priceMode='RANGE'. null = sin máximo (fallback FIXED). */
  priceMax?: number | null;
  /**
   * "DELTA" (default): variantes suman priceDelta al basePrice.
   * "ABSOLUTE": cada variante define su precio propio (priceDelta = precio final).
   */
  variantPriceMode?: 'DELTA' | 'ABSOLUTE';
  /**
   * Cuantas variantes puede marcar el cliente. null o 1 = una sola (radio).
   * >= 2 = casillas multiples. Solo tiene efecto en modo DELTA.
   */
  /** Carta a la que pertenece. null/undefined = menu principal. */
  menuId?: string | null;
  maxVariantsTotal?: number | null;
  /**
   * Tope de extras EN TOTAL para este producto (sumando cantidades).
   * null = sin tope. Distinto de ProductExtra.maxQty, que limita UN extra.
   */
  maxExtrasTotal?: number | null;
  imageUrl?: string;
  tags?: string[];
  isAvailable?: boolean;
  availableForMesa?: boolean;
  availableForDelivery?: boolean;
  isRecommended?: boolean;
  position?: number;
  stock?: number | null;
  stockAlert?: number | null;
  variants?: VariantDto[];
  extras?: ExtraDto[];
  /**
   * En qué sedes se vende y con qué precio. Ver `producto-en-sede.ts`.
   *
   * Si NO se manda, no se toca nada — un guardado desde una pantalla que no
   * conoce las sedes no puede borrarle al negocio lo que configuró.
   */
  sedes?: SedesDto;
};

export type SedesDto = {
  /** TODAS = también las que se abran mañana. SELECCIONADAS = solo las marcadas. */
  modo: 'TODAS' | 'SELECCIONADAS';
  filas?: {
    locationId: string;
    selected?: boolean;
    /** null = el precio del producto. */
    price?: number | null;
    /** null = lo que diga el producto. */
    isAvailable?: boolean | null;
    stock?: number | null;
    /** Foto propia de esta sede. null = la del producto. */
    imageUrl?: string | null;
    /** Texto propio de esta sede. null = el del producto. */
    description?: string | null;
  }[];
};

/**
 * Cuánto se les deja a las transacciones del catálogo.
 *
 * El default de Prisma son 5 s y este backend habla con Postgres por el proxy
 * PÚBLICO de Railway: ~140 ms por consulta. «Cambiar en todas las cartas» hacía
 * cinco consultas POR CARTA dentro de la transacción; con las 10 cartas de un
 * coworking pasaba de 5 s, Prisma cerraba la transacción (P2028) y el guardado
 * entero se deshacía: «sale un error y no guarda». La propagación ahora hace un
 * número fijo de consultas (ver `propagarASincronizados`); este margen es por
 * si el proxy va lento, no lo que lo arregla.
 */
const OPCIONES_DE_TRANSACCION = { timeout: 20_000, maxWait: 10_000 } as const;

/** Cuántos saltos de «copia de una copia» se siguen como mucho. Duplicar una
 *  carta que ya era copia crea cadenas; un ciclo no debería existir, pero si
 *  existiera no puede colgar la petición. */
const MAX_SALTOS = 10;

/** Lo que define QUÉ ES el producto y viaja a las copias. Ver
 *  `propagarASincronizados`. */
const CAMPOS_COMPARTIDOS = [
  'name',
  'description',
  'basePrice',
  'priceMode',
  'priceMax',
  'variantPriceMode',
  'maxVariantsTotal',
  'maxExtrasTotal',
  'imageUrl',
  'tags',
] as const;

/** Qué dejó hecho «guardar en todas las cartas», para contárselo al negocio. */
export type ResumenEnTodas = {
  /** Cartas donde quedó el producto, contando la actual. */
  cartas: number;
  /** Categorías que no existían en alguna carta y se crearon para no dejar el
   *  producto suelto. Ver `categoriaEquivalente`. */
  categoriasCreadas: { carta: string; categoria: string }[];
};

type CategoriaFila = {
  id: string;
  menuId: string | null;
  parentId: string | null;
  slug: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  tagline: string | null;
  coverConfig: Prisma.JsonValue | null;
  position: number;
};

/** Igual que el `slugify` de `categories.service.ts`: es con lo que se generó
 *  el slug de cada categoría, así que es con lo que se comparan nombres. */
function slugDe(s: string) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  private tid(user: AuthUser, override?: string) {
    if (user.role === 'SUPER_ADMIN') {
      if (!override) throw new ForbiddenException('tenantId required');
      return override;
    }
    if (!user.tenantId) throw new ForbiddenException();
    return user.tenantId;
  }

  /**
   * @param menuId carta que se esta editando. `undefined` = el menú
   *        principal (`menuId: null`), que es donde vive todo el catalogo de
   *        siempre. Sin este filtro, un negocio con dos cartas veria los
   *        productos de ambas mezclados en el panel.
   */
  list(
    user: AuthUser,
    override?: string,
    categoryId?: string,
    menuId?: string,
  ) {
    const tid = this.tid(user, override);
    return this.prisma.product.findMany({
      where: {
        tenantId: tid,
        menuId: menuId ?? null,
        ...(categoryId ? { categoryId } : {}),
      },
      include: {
        variants: true,
        extras: true,
        category: true,
        // El panel necesita saber si este producto sigue al original y si el
        // original todavia existe, para pintar el interruptor de sincronia.
        sourceProduct: { select: { id: true, name: true } },
      },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async get(user: AuthUser, id: string) {
    const p = await this.prisma.product.findUnique({
      where: { id },
      include: {
        variants: true,
        extras: true,
        category: true,
        // Para que el panel pinte el selector con lo que ya hay guardado.
        // Sin filas = «todas las sedes», que es lo normal.
        productLocations: true,
      },
    });
    if (!p) throw new NotFoundException();
    if (user.role !== 'SUPER_ADMIN' && p.tenantId !== user.tenantId) {
      throw new ForbiddenException();
    }
    return p;
  }

  /**
   * Guarda en qué sedes se vende el producto y qué tiene distinto en cada una.
   *
   * Dos cosas que no son opcionales:
   *
   *  · **Solo sedes de ESTE negocio.** Sin el filtro, una llamada a la API a
   *    mano podría escribirle el precio de un producto en la sede de otro
   *    negocio. El panel nunca lo haría; la API no la escribe solo el panel.
   *  · **Las filas vacías no se guardan.** «Sin filas = en todas las sedes» es
   *    la regla de la que cuelga todo lo demás (`producto-en-sede.ts`), y
   *    dejar filas que no dicen nada la va oxidando: mañana alguien cuenta
   *    filas para saber si un producto está personalizado y le sale que sí.
   */
  /**
   * Texto en blanco = «lo mismo que el producto», no «esta sede no tiene».
   *
   * El panel manda cadena vacía cuando el usuario borra el campo, y quien lo
   * borra quiere volver al catálogo. Guardarlo tal cual dejaba el producto
   * mudo en esa sede y sin forma de deshacerlo desde la interfaz.
   */
  private sinVacio(v: string | null | undefined): string | null {
    const t = typeof v === 'string' ? v.trim() : v;
    return t == null || t === '' ? null : t;
  }

  private async guardarSedes(
    tx: Prisma.TransactionClient,
    productId: string,
    tenantId: string,
    sedes: SedesDto,
  ) {
    // El interruptor manda, y se comprueba AQUI y no solo en el panel: esconder
    // el bloque no impide que alguien llame a la API a mano. Un negocio al que
    // no se le habilito la funcion no puede tener precios por sede.
    const negocio = await tx.tenant.findUnique({
      where: { id: tenantId },
      select: { sedeMenuEnabled: true },
    });
    if (!negocio?.sedeMenuEnabled) return;

    const modo = sedes.modo === 'SELECCIONADAS' ? 'SELECCIONADAS' : 'TODAS';

    const mias = new Set(
      (
        await tx.location.findMany({
          where: { tenantId },
          select: { id: true },
        })
      ).map((l) => l.id),
    );

    const filas = (sedes.filas ?? [])
      .filter((f) => f.locationId && mias.has(f.locationId))
      .map((f) => ({
        locationId: f.locationId,
        selected: f.selected !== false,
        price: f.price ?? null,
        isAvailable: f.isAvailable ?? null,
        stock: f.stock ?? null,
        imageUrl: this.sinVacio(f.imageUrl),
        description: this.sinVacio(f.description),
      }))
      // Una fila solo se guarda si dice ALGO: o marca la sede (cuando el
      // producto va por sedes elegidas), o lleva precio/agotado/stock propios.
      .filter(
        (f) =>
          (modo === 'SELECCIONADAS' && f.selected) ||
          f.price !== null ||
          f.isAvailable !== null ||
          f.stock !== null ||
          f.imageUrl !== null ||
          f.description !== null,
      );

    await tx.product.update({
      where: { id: productId },
      data: { locationMode: modo },
    });

    const quedan = filas.map((f) => f.locationId);
    await tx.productLocation.deleteMany({
      where: {
        productId,
        ...(quedan.length ? { locationId: { notIn: quedan } } : {}),
      },
    });

    for (const f of filas) {
      await tx.productLocation.upsert({
        where: {
          productId_locationId: { productId, locationId: f.locationId },
        },
        create: { productId, ...f },
        update: {
          selected: f.selected,
          price: f.price,
          isAvailable: f.isAvailable,
          stock: f.stock,
          imageUrl: f.imageUrl,
          description: f.description,
        },
      });
    }
  }

  /**
   * Crea el producto en la carta que se está editando o, con
   * `alcance: 'todas'`, en todas las cartas del negocio.
   *
   * Sin `alcance` (o `'solo-esta'`) es exactamente lo de siempre: una carta.
   */
  async create(user: AuthUser, dto: ProductDto, override?: string) {
    const tid = this.tid(user, override);
    if (dto.alcance === 'todas') {
      return this.crearEnTodas(tid, dto);
    }
    return this.prisma.$transaction(async (tx) => {
      const creado = await this.crearEnCarta(tx, tid, dto, {
        menuId: dto.menuId ?? null,
        categoryId: dto.categoryId ?? null,
      });
      // Va DENTRO de la misma transacción: si guardar las sedes falla, el
      // producto tampoco se crea. Peor que no crearlo es crearlo a medias
      // y que se venda donde no toca.
      if (dto.sedes) {
        await this.guardarSedes(tx, creado.id, tid, dto.sedes);
      }
      return creado;
    }, OPCIONES_DE_TRANSACCION);
  }

  /**
   * «Guardar en todas las cartas» (pedido de Nudo, 2026-10-12: tiene una carta
   * por sala y crear un producto obligaba a repetirlo en cada una).
   *
   * Se crea con la MISMA forma que deja duplicar una carta
   * (`MenusService.duplicarCatalogo`): el original en el MENÚ PRINCIPAL y en
   * cada otra carta una copia enganchada (`sourceProductId` +
   * `syncWithSource`). Así el producto nuevo se comporta igual que los que ya
   * venían duplicados: editarlo en el principal ofrece «cambiar en todas», y
   * eliminarlo ofrece «eliminar de todas». Si el original quedara en la carta
   * de una sala, el principal sería una copia y esas dos preguntas nunca
   * saldrían para él.
   *
   * Lo que es de cada carta no se copia: el stock (es físico de cada sede, el
   * mismo criterio que al duplicar) y los precios por sede, que el formulario
   * configuró para la carta en la que se está.
   *
   * Todo en UNA transacción: o queda en todas, o en ninguna.
   */
  private async crearEnTodas(tid: string, dto: ProductDto) {
    const cartaActual = dto.menuId ?? null;
    return this.prisma.$transaction(async (tx) => {
      const menus = await tx.menu.findMany({
        where: { tenantId: tid },
        select: { id: true, name: true },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      });
      if (cartaActual && !menus.some((m) => m.id === cartaActual)) {
        throw new BadRequestException('Esa carta no es de este negocio.');
      }
      const cartas: { id: string | null; name: string }[] = [
        { id: null, name: 'Menú principal' },
        ...menus,
      ];

      // Todas las categorías del negocio de una vez: emparejarlas carta por
      // carta con una consulta por cada una es lo que hizo caer «cambiar en
      // todas» por tiempo.
      const categorias: CategoriaFila[] = await tx.category.findMany({
        where: { tenantId: tid },
        select: {
          id: true,
          menuId: true,
          parentId: true,
          slug: true,
          name: true,
          description: true,
          imageUrl: true,
          tagline: true,
          coverConfig: true,
          position: true,
        },
      });
      let origen: CategoriaFila | null = null;
      if (dto.categoryId) {
        origen = categorias.find((c) => c.id === dto.categoryId) ?? null;
        // Una categoría de otro negocio, o de otra carta, no tiene equivalente
        // que buscar: es una petición mal hecha, no un caso a adivinar.
        if (!origen || origen.menuId !== cartaActual) {
          throw new BadRequestException(
            'Esa categoría no es de la carta que estás editando.',
          );
        }
      }

      const resumen: ResumenEnTodas = { cartas: cartas.length, categoriasCreadas: [] };
      const categoriaEn = async (carta: { id: string | null; name: string }) =>
        origen
          ? this.categoriaEquivalente(tx, tid, origen, carta, categorias, resumen)
          : null;

      const original = await this.crearEnCarta(tx, tid, dto, {
        menuId: null,
        categoryId: await categoriaEn(cartas[0]),
        // El stock es de la carta en la que se está creando.
        conStock: cartaActual === null,
      });

      // Las copias van en TRES consultas (productos, variantes, extras) tenga el
      // negocio 2 cartas o 20 —con un `create` anidado por carta eran unas tres
      // por carta—. Es la misma lección del error de «cambiar en todas»: cada
      // consulta cuesta ~140 ms por el proxy y la transacción tiene reloj. Los
      // ids se generan aquí para poder colgarles variantes y extras sin
      // volver a leerlos.
      const copias: { id: string; carta: { id: string | null; name: string } }[] = [];
      const filas: Prisma.ProductCreateManyInput[] = [];
      for (const carta of cartas.slice(1)) {
        const id = randomUUID();
        const categoryId = await categoriaEn(carta);
        copias.push({ id, carta });
        filas.push({
          ...this.datosDelProducto(dto, carta.id === cartaActual),
          id,
          tenantId: tid,
          menuId: carta.id,
          categoryId,
          // Nace SIGUIENDO al original, como las de duplicar una carta.
          sourceProductId: original.id,
          syncWithSource: true,
        });
      }
      if (filas.length) {
        await tx.product.createMany({ data: filas });
        const ids = copias.map((c) => c.id);
        if (dto.variants?.length) {
          const variantes = dto.variants;
          await tx.productVariant.createMany({
            data: ids.flatMap((productId) =>
              variantes.map((v) => ({
                productId,
                groupName: v.groupName ?? 'Tamaño',
                name: v.name,
                priceDelta: v.priceDelta,
                isDefault: v.isDefault ?? false,
                position: v.position ?? 0,
              })),
            ),
          });
        }
        if (dto.extras?.length) {
          const extras = dto.extras;
          await tx.productExtra.createMany({
            data: ids.flatMap((productId) =>
              extras.map((e) => ({
                productId,
                name: e.name,
                price: e.price,
                maxQty: e.maxQty ?? 1,
                isAvailable: e.isAvailable ?? true,
              })),
            ),
          });
        }
      }

      // Lo que vuelve es el producto de la carta que se estaba editando.
      const idActual =
        cartaActual === null
          ? original.id
          : (copias.find((c) => c.carta.id === cartaActual)?.id ?? original.id);
      if (dto.sedes) {
        await this.guardarSedes(tx, idActual, tid, dto.sedes);
      }
      const enLaCartaActual =
        idActual === original.id
          ? original
          : await tx.product.findUnique({
              where: { id: idActual },
              include: { variants: true, extras: true, category: true },
            });
      return { ...enLaCartaActual, enTodas: resumen };
    }, OPCIONES_DE_TRANSACCION);
  }

  /**
   * La categoría de `carta` que corresponde a `origen`, creándola si no hay.
   *
   * No hay un vínculo guardado entre categorías de cartas distintas (duplicar
   * las copia sin enlazarlas), así que se empareja por el SLUG: duplicar lo
   * copia tal cual y renombrar una categoría no lo cambia, de modo que «Bebidas»
   * renombrada a «Bebidas frías» en una sala sigue casando con la del
   * principal. Si no hay slug igual, por el nombre normalizado (una categoría
   * creada a mano en cada carta con el mismo nombre). Las subcategorías casan
   * DENTRO de la categoría padre equivalente, no en toda la carta.
   *
   * Si la carta no la tiene, se CREA (con el nombre, la foto y la portada de la
   * original) en vez de saltarse esa carta: quien eligió «en todas» quiere el
   * producto en todas, y dejarlo «Sin categoría» lo escondería al final del
   * menú. Se cuenta en `resumen` para que el panel lo diga.
   */
  private async categoriaEquivalente(
    tx: Prisma.TransactionClient,
    tenantId: string,
    origen: CategoriaFila,
    carta: { id: string | null; name: string },
    categorias: CategoriaFila[],
    resumen: ResumenEnTodas,
  ): Promise<string> {
    if (origen.menuId === carta.id) return origen.id;

    const padreOrigen = origen.parentId
      ? categorias.find((c) => c.id === origen.parentId)
      : undefined;
    const padreDestino = padreOrigen
      ? await this.categoriaEquivalente(tx, tenantId, padreOrigen, carta, categorias, resumen)
      : null;

    const hermanas = categorias.filter(
      (c) => c.menuId === carta.id && c.parentId === padreDestino,
    );
    const igual =
      hermanas.find((c) => c.slug === origen.slug) ??
      hermanas.find((c) => slugDe(c.name) === slugDe(origen.name));
    if (igual) return igual.id;

    const ultima = hermanas.reduce((m, c) => Math.max(m, c.position), -1);
    const nueva = await tx.category.create({
      data: {
        tenantId,
        menuId: carta.id,
        parentId: padreDestino,
        name: origen.name,
        slug: origen.slug,
        description: origen.description,
        imageUrl: origen.imageUrl,
        tagline: origen.tagline,
        coverConfig: (origen.coverConfig ?? undefined) as Prisma.InputJsonValue | undefined,
        position: ultima + 1,
      },
      select: { id: true },
    });
    // Al conjunto en memoria: la siguiente carta, o un hijo de esta misma
    // categoría, tiene que encontrarla en vez de crearla dos veces.
    categorias.push({ ...origen, id: nueva.id, menuId: carta.id, parentId: padreDestino, position: ultima + 1 });
    resumen.categoriasCreadas.push({ carta: carta.name, categoria: origen.name });
    return nueva.id;
  }

  private crearEnCarta(
    tx: Prisma.TransactionClient,
    tid: string,
    dto: ProductDto,
    donde: {
      menuId: string | null;
      categoryId: string | null;
      /** `false` = esta carta arranca sin stock propio. Por defecto sí. */
      conStock?: boolean;
    },
  ) {
    return tx.product.create({
      data: {
        ...this.datosDelProducto(dto, donde.conStock !== false),
        tenantId: tid,
        // La carta que se esta editando. Sin esto, un producto creado desde la
        // carta de la sede 2 aparecia en el menu principal.
        menuId: donde.menuId,
        categoryId: donde.categoryId,
        variants: dto.variants
          ? {
              create: dto.variants.map((v) => ({
                groupName: v.groupName ?? 'Tamaño',
                name: v.name,
                priceDelta: v.priceDelta,
                isDefault: v.isDefault ?? false,
                position: v.position ?? 0,
              })),
            }
          : undefined,
        extras: dto.extras
          ? {
              create: dto.extras.map((e) => ({
                name: e.name,
                price: e.price,
                maxQty: e.maxQty ?? 1,
                isAvailable: e.isAvailable ?? true,
              })),
            }
          : undefined,
      },
      include: { variants: true, extras: true, category: true },
    });
  }

  /** Los campos propios del producto al crearlo, sin carta ni categoría.
   *  `conStock = false` → esta carta arranca sin stock propio (es físico de
   *  cada sede; el mismo criterio que al duplicar una carta). */
  private datosDelProducto(dto: ProductDto, conStock: boolean) {
    return {
      name: dto.name,
      description: dto.description ?? '',
      basePrice: dto.basePrice,
      priceMode: dto.priceMode ?? 'FIXED',
      priceMax:
        dto.priceMode === 'RANGE' && dto.priceMax != null ? dto.priceMax : null,
      variantPriceMode: dto.variantPriceMode ?? 'DELTA',
      maxVariantsTotal:
        dto.maxVariantsTotal != null && dto.maxVariantsTotal > 1
          ? Math.floor(dto.maxVariantsTotal)
          : null,
      maxExtrasTotal:
        dto.maxExtrasTotal != null && dto.maxExtrasTotal > 0
          ? Math.floor(dto.maxExtrasTotal)
          : null,
      imageUrl: dto.imageUrl,
      tags: dto.tags ?? [],
      isAvailable: dto.isAvailable ?? true,
      availableForMesa: dto.availableForMesa ?? true,
      availableForDelivery: dto.availableForDelivery ?? true,
      isRecommended: dto.isRecommended ?? false,
      position: dto.position ?? 0,
      stock: conStock ? (dto.stock ?? null) : null,
      stockAlert: conStock ? (dto.stockAlert ?? null) : null,
    };
  }

  /**
   * Cuántas cartas siguen a este producto, y cuáles.
   *
   * Se cuenta en el BACKEND justo antes de enseñar el aviso, igual que se hace
   * al borrar una carta (`menus.service.ts`): así el panel no puede enseñar un
   * número distinto del que se va a cambiar. Calcularlo en el frontend con lo
   * que ya tiene cargado daría un número viejo en cuanto otra pestaña
   * enganchara o desenganchara una copia.
   */
  async copiasEnganchadas(user: AuthUser, id: string) {
    // `get` ya comprueba que el producto es del negocio de quien pregunta.
    const p = await this.get(user, id);
    // La MISMA búsqueda que usa `propagarASincronizados`: el número del aviso
    // tiene que ser el de las cartas que de verdad se van a cambiar.
    const ids = await this.copiasSincronizadas(this.prisma, p.tenantId, id);
    return { count: ids.length, cartas: await this.nombresDeCartas(p.tenantId, ids) };
  }

  /**
   * En qué OTRAS cartas está este mismo producto. Lo pide el panel antes de
   * eliminar, para preguntar «¿de todas las cartas o solo de esta?» y decir de
   * cuáles. Cuenta TODAS las copias, también las desenganchadas: siguen siendo
   * ese producto en esa carta aunque tengan precio propio.
   */
  async enOtrasCartas(user: AuthUser, id: string) {
    const p = await this.get(user, id);
    const otros = (await this.familia(p.tenantId, id)).filter((x) => x !== id);
    return { count: otros.length, cartas: await this.nombresDeCartas(p.tenantId, otros) };
  }

  private async nombresDeCartas(tenantId: string, ids: string[]) {
    if (!ids.length) return [];
    const filas = await this.prisma.product.findMany({
      where: { tenantId, id: { in: ids } },
      select: { menu: { select: { name: true } } },
    });
    // `null` es el menú principal: no tiene fila en `Menu`.
    return filas.map((c) => c.menu?.name ?? 'Menú principal');
  }

  /**
   * Las copias que SIGUEN a `sourceId`, también las copias de copias (duplicar
   * una carta que ya era copia de otra). Una consulta por nivel, no por copia.
   * Solo atraviesa copias enganchadas: una desenganchada va por libre, y lo
   * que cuelgue de ella la sigue a ella.
   */
  private async copiasSincronizadas(
    db: Prisma.TransactionClient,
    tenantId: string,
    sourceId: string,
  ): Promise<string[]> {
    const vistos = new Set<string>([sourceId]);
    const copias: string[] = [];
    let frontera = [sourceId];
    for (let i = 0; i < MAX_SALTOS && frontera.length; i++) {
      const filas = await db.product.findMany({
        where: { tenantId, sourceProductId: { in: frontera }, syncWithSource: true },
        select: { id: true },
      });
      frontera = filas.map((f) => f.id).filter((x) => !vistos.has(x));
      for (const x of frontera) vistos.add(x);
      copias.push(...frontera);
    }
    return copias;
  }

  /**
   * Todos los productos que son «este mismo» en alguna carta: se sube al
   * original por `sourceProductId` y se baja a todas sus copias, enganchadas o
   * no. Incluye el propio `id`.
   *
   * Es el único vínculo que hay entre cartas. Un producto que se creó a mano
   * en cada carta, sin duplicar, no tiene familia: no se empareja por nombre
   * porque dos «Café» de dos salas pueden ser productos distintos, y borrar el
   * equivocado no tiene deshacer.
   */
  private async familia(tenantId: string, id: string): Promise<string[]> {
    let raiz = id;
    for (let i = 0; i < MAX_SALTOS; i++) {
      const p = await this.prisma.product.findFirst({
        where: { id: raiz, tenantId },
        select: { sourceProductId: true },
      });
      if (!p?.sourceProductId) break;
      raiz = p.sourceProductId;
    }
    const todos = new Set<string>([raiz, id]);
    let frontera = [raiz];
    for (let i = 0; i < MAX_SALTOS && frontera.length; i++) {
      const filas = await this.prisma.product.findMany({
        where: { tenantId, sourceProductId: { in: frontera } },
        select: { id: true },
      });
      frontera = filas.map((f) => f.id).filter((x) => !todos.has(x));
      for (const x of frontera) todos.add(x);
    }
    return [...todos];
  }

  async update(user: AuthUser, id: string, dto: Partial<ProductDto>) {
    const existing = await this.get(user, id);
    return this.prisma.$transaction(async (tx) => {
      // Update base
      const updated = await tx.product.update({
        where: { id },
        data: {
          // categoryId: si el caller mandó null explícito, limpiamos
          // (producto sin categoría). undefined = no tocar el valor existente.
          categoryId:
            dto.categoryId === null
              ? null
              : dto.categoryId !== undefined
              ? dto.categoryId
              : undefined,
          name: dto.name ?? undefined,
          description: dto.description ?? undefined,
          basePrice: dto.basePrice ?? undefined,
          priceMode: dto.priceMode ?? undefined,
          // priceMax depende del modo elegido: si el caller pisó priceMode
          // a FIXED, limpiamos el max; si pasó RANGE con un número, lo
          // guardamos; si no tocó nada, undefined deja el valor previo.
          priceMax:
            dto.priceMode === 'FIXED'
              ? null
              : dto.priceMax === undefined
              ? undefined
              : dto.priceMax,
          variantPriceMode: dto.variantPriceMode ?? undefined,
          // 1 se guarda como null: "elige una" es el comportamiento por
          // defecto, no un tope que haya que recordar.
          maxVariantsTotal:
            dto.maxVariantsTotal === undefined
              ? undefined
              : dto.maxVariantsTotal != null && dto.maxVariantsTotal > 1
                ? Math.floor(dto.maxVariantsTotal)
                : null,
          // null explicito = quitar el tope; undefined = no tocarlo. Un `??`
          // aqui haria imposible volver a "sin tope" desde el panel.
          maxExtrasTotal:
            dto.maxExtrasTotal === undefined
              ? undefined
              : dto.maxExtrasTotal != null && dto.maxExtrasTotal > 0
                ? Math.floor(dto.maxExtrasTotal)
                : null,
          imageUrl: dto.imageUrl ?? undefined,
          tags: dto.tags ?? undefined,
          isAvailable: dto.isAvailable ?? undefined,
          availableForMesa: dto.availableForMesa ?? undefined,
          availableForDelivery: dto.availableForDelivery ?? undefined,
          isRecommended: dto.isRecommended ?? undefined,
          position: dto.position ?? undefined,
          stock: dto.stock === undefined ? undefined : dto.stock,
          stockAlert: dto.stockAlert === undefined ? undefined : dto.stockAlert,
        },
      });
      // Replace variants if provided
      if (dto.variants) {
        await tx.productVariant.deleteMany({ where: { productId: id } });
        if (dto.variants.length) {
          await tx.productVariant.createMany({
            data: dto.variants.map((v) => ({
              productId: id,
              groupName: v.groupName ?? 'Tamaño',
              name: v.name,
              priceDelta: v.priceDelta,
              isDefault: v.isDefault ?? false,
              position: v.position ?? 0,
            })),
          });
        }
      }
      if (dto.extras) {
        await tx.productExtra.deleteMany({ where: { productId: id } });
        if (dto.extras.length) {
          await tx.productExtra.createMany({
            data: dto.extras.map((e) => ({
              productId: id,
              name: e.name,
              price: e.price,
              maxQty: e.maxQty ?? 1,
              isAvailable: e.isAvailable ?? true,
            })),
          });
        }
      }
      // Propagar a las copias SINCRONIZADAS de otras cartas.
      //
      // Se hace al ESCRIBIR y no al leer a proposito: el menu publico es la
      // consulta mas caliente del producto y resolver el original en cada
      // lectura la encarecia para todos, incluidos los negocios de una sola
      // carta, que son la inmensa mayoria.
      //
      // EL ALCANCE LO DECIDE QUIEN EDITA (Javier, 2026-09-18): «cuando se hace
      // un cambio en el menú principal, que aparezca una notificación que
      // indique si se quiere el cambio para solo ese menú o para todos los
      // submenús también». Hasta hoy propagaba SIEMPRE y sin preguntar: quien
      // corregía una errata en el principal le cambiaba el producto a las 10
      // cartas de sus oficinas sin enterarse.
      //
      // Sin `alcance` se propaga, que es lo que hacía antes: un cliente viejo
      // —o una importación, o el editor rápido de precios— no puede cambiar de
      // comportamiento por no mandar un campo que no conoce.
      if (dto.alcance !== 'solo-esta') {
        await this.propagarASincronizados(tx, existing.tenantId, id, dto);
      }

      // Solo si el guardado trae sedes. Una pantalla que no las conoce —el
      // editor rápido de precios, una importación— no puede borrarle al
      // negocio lo que configuró por no mandarlas.
      if (dto.sedes) {
        await this.guardarSedes(tx, id, existing.tenantId, dto.sedes);
      }

      return tx.product.findUnique({
        where: { id },
        include: {
          variants: true,
          extras: true,
          category: true,
          productLocations: true,
        },
      });
    }, OPCIONES_DE_TRANSACCION);
  }

  /**
   * Copia a las copias sincronizadas lo que define QUE ES el producto.
   *
   * NO se propaga como se MUESTRA en cada carta — visible, mesa, domicilio,
   * destacado, posicion, categoria y stock son de cada sede. Ese es el punto
   * entero de tener dos cartas: la sede B esconde lo que no tiene sin dejar de
   * recibir los cambios de precio del menu principal.
   *
   * Las variantes y extras se reemplazan enteras cuando vienen en el dto,
   * igual que en el producto original.
   */
  private async propagarASincronizados(
    tx: Prisma.TransactionClient,
    tenantId: string,
    sourceId: string,
    dto: Partial<ProductDto>,
  ) {
    const ids = await this.copiasSincronizadas(tx, tenantId, sourceId);
    if (!ids.length) return;

    // EL ERROR DE «CAMBIAR EN TODAS» (Nudo, 2026-10-12): esto iba copia por
    // copia —actualizar, borrar variantes, crearlas, borrar extras, crearlos—,
    // cinco consultas por carta dentro de la transacción. Con 10 cartas eran
    // más de 50 a ~140 ms cada una por el proxy público: pasaba de los 5 s de
    // Prisma, la transacción caducaba (P2028) y se deshacía TODO, también el
    // cambio del menú principal. Ahora son cinco consultas en total, tenga el
    // negocio 2 cartas o 20.
    const compartido = this.camposCompartidos(dto);
    if (Object.keys(compartido).length) {
      await tx.product.updateMany({
        where: { tenantId, id: { in: ids } },
        data: compartido,
      });
    }
    if (dto.variants) {
      const variantes = dto.variants;
      await tx.productVariant.deleteMany({ where: { productId: { in: ids } } });
      const filas = ids.flatMap((productId) =>
        variantes.map((v) => ({
          productId,
          groupName: v.groupName ?? 'Tamaño',
          name: v.name,
          priceDelta: v.priceDelta,
          isDefault: v.isDefault ?? false,
          position: v.position ?? 0,
        })),
      );
      if (filas.length) await tx.productVariant.createMany({ data: filas });
    }
    if (dto.extras) {
      const extras = dto.extras;
      await tx.productExtra.deleteMany({ where: { productId: { in: ids } } });
      const filas = ids.flatMap((productId) =>
        extras.map((e) => ({
          productId,
          name: e.name,
          price: e.price,
          maxQty: e.maxQty ?? 1,
          isAvailable: e.isAvailable ?? true,
        })),
      );
      if (filas.length) await tx.productExtra.createMany({ data: filas });
    }
  }

  /**
   * Los campos de `CAMPOS_COMPARTIDOS` que trae el dto, normalizados IGUAL que
   * en el original. Antes se copiaban crudos: el original guardaba «elige 1»
   * como `null` y la copia como `1`, y un tope con decimales llegaba a la
   * copia sin redondear.
   */
  private camposCompartidos(
    dto: Partial<ProductDto>,
  ): Prisma.ProductUpdateManyMutationInput {
    const d: Record<string, unknown> = {};
    for (const k of CAMPOS_COMPARTIDOS) {
      if (dto[k] !== undefined) d[k] = dto[k];
    }
    if (dto.priceMode === 'FIXED') d.priceMax = null;
    if (dto.maxVariantsTotal !== undefined) {
      d.maxVariantsTotal =
        dto.maxVariantsTotal != null && dto.maxVariantsTotal > 1
          ? Math.floor(dto.maxVariantsTotal)
          : null;
    }
    if (dto.maxExtrasTotal !== undefined) {
      d.maxExtrasTotal =
        dto.maxExtrasTotal != null && dto.maxExtrasTotal > 0
          ? Math.floor(dto.maxExtrasTotal)
          : null;
    }
    // `null` en campos que no lo admiten (nombre, precio, descripción,
    // etiquetas...) se queda fuera: en el original `?? undefined` los ignora,
    // y aquí harían fallar el guardado entero.
    for (const k of ['name', 'description', 'basePrice', 'priceMode', 'variantPriceMode', 'tags']) {
      if (d[k] === null) delete d[k];
    }
    return d as Prisma.ProductUpdateManyMutationInput;
  }

  /**
   * Engancha o desengancha una copia del producto original.
   *
   * Al enganchar se traen de una vez los datos del original, para que no quede
   * a medias: el negocio espera ver el precio del menu principal en cuanto lo
   * activa, no en el proximo cambio.
   */
  async setSync(user: AuthUser, id: string, sync: boolean) {
    const p = await this.get(user, id);
    if (!p.sourceProductId) {
      throw new BadRequestException(
        'Este producto no salió de otra carta, no hay nada con que sincronizarlo.',
      );
    }
    if (sync) {
      const origen = await this.prisma.product.findUnique({
        where: { id: p.sourceProductId },
        include: { variants: true, extras: true },
      });
      if (!origen) {
        throw new BadRequestException(
          'El producto original ya no existe. Este queda independiente.',
        );
      }
      await this.prisma.$transaction(async (tx) => {
        await tx.product.update({
          where: { id },
          data: {
            syncWithSource: true,
            name: origen.name,
            description: origen.description,
            basePrice: origen.basePrice,
            priceMode: origen.priceMode,
            priceMax: origen.priceMax,
            variantPriceMode: origen.variantPriceMode,
            maxVariantsTotal: origen.maxVariantsTotal,
            maxExtrasTotal: origen.maxExtrasTotal,
            imageUrl: origen.imageUrl,
            tags: origen.tags,
          },
        });
        await tx.productVariant.deleteMany({ where: { productId: id } });
        if (origen.variants.length) {
          await tx.productVariant.createMany({
            data: origen.variants.map((v) => ({
              productId: id,
              groupName: v.groupName,
              name: v.name,
              priceDelta: v.priceDelta,
              isDefault: v.isDefault,
              position: v.position,
            })),
          });
        }
        await tx.productExtra.deleteMany({ where: { productId: id } });
        if (origen.extras.length) {
          await tx.productExtra.createMany({
            data: origen.extras.map((e) => ({
              productId: id,
              name: e.name,
              price: e.price,
              maxQty: e.maxQty,
              isAvailable: e.isAvailable,
            })),
          });
        }
      });
    } else {
      await this.prisma.product.update({
        where: { id },
        data: { syncWithSource: false },
      });
    }
    return this.get(user, id);
  }

  /**
   * Elimina el producto de esta carta o, con `alcance: 'todas'`, de todas las
   * cartas donde está (ver `familia`).
   *
   * «Todas» va en UN `deleteMany` filtrado por negocio: o se borra en todas o
   * en ninguna, y un id ajeno colado en la familia no puede tocar otro negocio.
   * Los pedidos no se tocan: guardan nombre y precio copiados, sin clave
   * foránea al producto.
   */
  async remove(user: AuthUser, id: string, alcance?: AlcanceDelCambio) {
    const p = await this.get(user, id);
    if (alcance !== 'todas') {
      await this.prisma.product.delete({ where: { id } });
      return { ok: true, eliminados: 1 };
    }
    const ids = await this.familia(p.tenantId, id);
    const r = await this.prisma.product.deleteMany({
      where: { tenantId: p.tenantId, id: { in: ids } },
    });
    return { ok: true, eliminados: r.count };
  }

  async setAvailable(user: AuthUser, id: string, isAvailable: boolean) {
    await this.get(user, id);
    return this.prisma.product.update({
      where: { id },
      data: { isAvailable },
    });
  }

  async reorder(user: AuthUser, ids: string[]) {
    const tid = user.role === 'SUPER_ADMIN' ? null : user.tenantId;
    await this.prisma.$transaction(
      ids.map((id, position) =>
        this.prisma.product.updateMany({
          where: { id, ...(tid ? { tenantId: tid } : {}) },
          data: { position },
        }),
      ),
    );
    return { ok: true };
  }
}
