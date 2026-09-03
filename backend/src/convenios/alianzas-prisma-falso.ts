/**
 * Doble falso de Prisma **en memoria** para las ALIANZAS.
 *
 * Existe por un motivo concreto: los 31 tests viejos de convenios
 * reimplementaban la lógica dentro del propio fichero de test —copiaban
 * `calcularDescuento`, copiaban las reglas de estado— y por eso pasaban en
 * verde mientras producción se rompía. Un test que prueba su propia copia no
 * protege nada.
 *
 * Con esto, los specs importan los servicios DE VERDAD
 * (`AlianzasPublicoService`, `AlianzasPortalService`, `ConveniosCanjeService`)
 * y los ejercitan contra este almacén. Si el servicio se rompe, el test se
 * pone rojo. No hace falta base de datos: todo vive en arrays.
 *
 * Lo que sí reproduce, porque el código de producción DEPENDE de ello:
 *
 *  · **Los índices únicos lanzan `code === 'P2002'`.** `activar()` atrapa ese
 *    código para devolverle al segundo envío lo que creó el primero en vez de
 *    un 500. Sin un doble que lance P2002, esa rama nunca se ejercita.
 *  · **El índice único PARCIAL `(convenioId, documento)`**, que en producción
 *    vive en SQL crudo porque Prisma no sabe expresarlo: solo aplica cuando
 *    `documento` no es null.
 *  · **`$transaction(fn)` es atómico**: si la función lanza, se restaura el
 *    almacén entero. Es lo que hace comprobable que marcar la lista blanca
 *    DENTRO de la transacción impide gastar el cupo sin emitir la tarjeta.
 *
 * Lo que NO reproduce, a propósito:
 *
 *  · Aislamiento entre transacciones concurrentes: el rollback restaura el
 *    almacén completo, así que dos transacciones solapadas que fallaran se
 *    pisarían. Ningún test de aquí depende de eso.
 *  · `$executeRawUnsafe` es un no-op: solo se usa para
 *    `pg_advisory_xact_lock`, y en un almacén de un solo hilo no hay nada que
 *    serializar.
 */

import type { PrismaService } from '../common/prisma/prisma.service';

export type Fila = Record<string, any>;

// ───────────────────────────── El esquema mínimo ─────────────────────────────

/** Índice único. `parcial` = solo aplica si TODOS los campos tienen valor
 *  (equivale al `WHERE ... IS NOT NULL` de los índices parciales de la base). */
type Unico = { campos: string[]; parcial?: boolean };

const UNICOS: Record<string, Unico[]> = {
  tenant: [{ campos: ['slug'] }],
  convenio: [
    { campos: ['tenantId', 'slug'] },
    { campos: ['reportToken'], parcial: true },
    { campos: ['aliadoToken'], parcial: true },
  ],
  convenioTarjeta: [
    { campos: ['convenioId', 'customerId'] },
    // El índice parcial que impide que la misma cédula active el convenio dos
    // veces con dos teléfonos distintos. En producción es SQL crudo.
    { campos: ['convenioId', 'documento'], parcial: true },
    { campos: ['passId'], parcial: true },
  ],
  customer: [{ campos: ['tenantId', 'phone'] }],
  pass: [
    { campos: ['cardId', 'customerId'] },
    { campos: ['serialNumber'] },
    { campos: ['qrToken'] },
  ],
};

type Relacion = {
  modelo: string;
  muchos: boolean;
  /** Campo de ESTA fila que apunta a la otra. */
  local: string;
  /** Campo de la OTRA fila con el que se compara. */
  remoto: string;
  /** Orden por defecto de las relaciones «muchos». */
  orden?: string[];
};

const RELACIONES: Record<string, Record<string, Relacion>> = {
  convenio: {
    cupones: {
      modelo: 'convenioCupon',
      muchos: true,
      local: 'id',
      remoto: 'convenioId',
      orden: ['position', 'createdAt'],
    },
    sedes: { modelo: 'convenioSede', muchos: true, local: 'id', remoto: 'convenioId' },
    tarjetas: { modelo: 'convenioTarjeta', muchos: true, local: 'id', remoto: 'convenioId' },
    tenant: { modelo: 'tenant', muchos: false, local: 'tenantId', remoto: 'id' },
  },
  convenioCupon: {
    convenio: { modelo: 'convenio', muchos: false, local: 'convenioId', remoto: 'id' },
    canjes: { modelo: 'convenioCanje', muchos: true, local: 'id', remoto: 'cuponId' },
  },
  convenioTarjeta: {
    convenio: { modelo: 'convenio', muchos: false, local: 'convenioId', remoto: 'id' },
    customer: { modelo: 'customer', muchos: false, local: 'customerId', remoto: 'id' },
    canjes: { modelo: 'convenioCanje', muchos: true, local: 'id', remoto: 'tarjetaId' },
  },
  convenioCanje: {
    convenio: { modelo: 'convenio', muchos: false, local: 'convenioId', remoto: 'id' },
    cupon: { modelo: 'convenioCupon', muchos: false, local: 'cuponId', remoto: 'id' },
    tarjeta: { modelo: 'convenioTarjeta', muchos: false, local: 'tarjetaId', remoto: 'id' },
  },
  card: {
    convenio: { modelo: 'convenio', muchos: false, local: 'convenioId', remoto: 'id' },
  },
  pass: {
    card: { modelo: 'card', muchos: false, local: 'cardId', remoto: 'id' },
    customer: { modelo: 'customer', muchos: false, local: 'customerId', remoto: 'id' },
  },
};

/** Valores por defecto de cada modelo. Los mismos que el `@default(...)` del
 *  esquema: sin ellos, una fila creada por el servicio saldría con `undefined`
 *  donde el código espera `false`, `0` o `null`, y los tests mentirían. */
const POR_DEFECTO: Record<string, () => Fila> = {
  /** El cajero. Existe aquí porque el canje lee su sede para aplicar el filtro
   *  por sedes del convenio: sin este modelo, `user.findUnique` reventaba. */
  user: () => ({
    role: 'TENANT_STAFF',
    locationId: null,
  }),
  tenant: () => ({
    brandName: 'Negocio de prueba',
    logoUrl: null,
    primaryColor: '#111111',
    status: 'ACTIVE',
    conveniosEnabled: true,
    dataPolicyUrl: null,
    timezone: 'America/Bogota',
  }),
  convenio: () => ({
    name: 'Empresa aliada',
    logoUrl: null,
    description: '',
    verificacion: 'CODIGO',
    codigo: null,
    status: 'ACTIVE',
    endsAt: null,
    reportToken: null,
    aliadoToken: null,
  }),
  convenioSede: () => ({}),
  convenioCupon: () => ({
    name: 'Beneficio',
    tipo: 'PERCENT_OFF',
    valor: 0,
    description: '',
    terms: '',
    isActive: true,
    activoAliado: true,
    maxPorPersona: null,
    periodo: 'SIEMPRE',
    maxTotal: null,
    compraMinima: null,
    topeDescuento: null,
    endsAt: null,
    canjesCount: 0,
    position: 0,
  }),
  convenioTarjeta: () => ({
    passId: null,
    documento: null,
    status: 'ACTIVE',
    blockedAt: null,
    blockedBy: null,
    origen: null,
    dataPolicyAcceptedAt: null,
    dataPolicyUrl: null,
  }),
  convenioCanje: () => ({
    locationId: null,
    operatorUserId: null,
    compraMonto: null,
    descuentoMonto: null,
    revertedAt: null,
    revertedBy: null,
  }),
  convenioListaBlanca: () => ({ documento: null, email: null, usedAt: null }),
  customer: () => ({ fullName: '', phone: '', email: null }),
  card: () => ({
    convenioId: null,
    name: 'Tarjeta',
    type: 'STAMPS',
    stampsRequired: 10,
    rewardText: '',
    businessName: '',
    logoUrl: null,
    isActive: true,
  }),
  pass: () => ({
    stampsCount: 0,
    status: 'ACTIVE',
    lastActivityAt: null,
    dataPolicyAcceptedAt: null,
    dataPolicyUrl: null,
  }),
  location: () => ({ name: 'Sede' }),
};

const MODELOS = Object.keys(POR_DEFECTO);

// ─────────────────────────────── Utilidades ───────────────────────────────

function clonar<T>(v: T): T {
  if (v instanceof Date) return new Date(v.getTime()) as unknown as T;
  if (Array.isArray(v)) return v.map(clonar) as unknown as T;
  if (v && typeof v === 'object') {
    const salida: Fila = {};
    for (const [k, val] of Object.entries(v as Fila)) salida[k] = clonar(val);
    return salida as unknown as T;
  }
  return v;
}

function comparable(v: any): any {
  return v instanceof Date ? v.getTime() : v;
}

/** ¿`k` es una clave compuesta de índice único al estilo Prisma
 *  (`convenioId_customerId`, `tenantId_phone`, `cardId_customerId`)? */
function esClaveCompuesta(k: string, v: any): boolean {
  if (!v || typeof v !== 'object' || v instanceof Date || Array.isArray(v)) return false;
  return Object.keys(v).join('_') === k;
}

function casaCampo(valor: any, cond: any): boolean {
  if (cond === null) return valor === null || valor === undefined;
  if (cond instanceof Date) {
    return valor instanceof Date && valor.getTime() === cond.getTime();
  }
  if (typeof cond === 'object' && !Array.isArray(cond)) {
    for (const [op, arg] of Object.entries(cond)) {
      switch (op) {
        case 'equals':
          if (!casaCampo(valor, arg)) return false;
          break;
        case 'not':
          if (arg === null) {
            if (valor === null || valor === undefined) return false;
          } else if (casaCampo(valor, arg)) return false;
          break;
        case 'in':
          if (!(arg as any[]).some((x) => casaCampo(valor, x))) return false;
          break;
        case 'notIn':
          if ((arg as any[]).some((x) => casaCampo(valor, x))) return false;
          break;
        case 'endsWith':
          if (typeof valor !== 'string' || !valor.endsWith(arg as string)) return false;
          break;
        case 'startsWith':
          if (typeof valor !== 'string' || !valor.startsWith(arg as string)) return false;
          break;
        case 'contains':
          if (typeof valor !== 'string' || !valor.includes(arg as string)) return false;
          break;
        case 'gte':
          if (!(comparable(valor) >= comparable(arg))) return false;
          break;
        case 'gt':
          if (!(comparable(valor) > comparable(arg))) return false;
          break;
        case 'lte':
          if (!(comparable(valor) <= comparable(arg))) return false;
          break;
        case 'lt':
          if (!(comparable(valor) < comparable(arg))) return false;
          break;
        default:
          // Mejor romper el test que dar un falso verde: si un servicio empieza
          // a usar un operador que este doble no entiende, hay que enterarse.
          throw new Error(`El doble de Prisma no soporta el operador «${op}»`);
      }
    }
    return true;
  }
  return valor === cond;
}

function casa(fila: Fila, where: any): boolean {
  if (!where) return true;
  for (const [k, v] of Object.entries(where)) {
    if (k === 'AND') {
      const lista = Array.isArray(v) ? v : [v];
      if (!lista.every((w) => casa(fila, w))) return false;
      continue;
    }
    if (k === 'OR') {
      // Un OR vacío no casa con nada, igual que en Prisma. Importa: `activar()`
      // construye el OR de la lista blanca con arrays condicionales.
      if (!(v as any[]).some((w) => casa(fila, w))) return false;
      continue;
    }
    if (k === 'NOT') {
      if (casa(fila, v)) return false;
      continue;
    }
    if (esClaveCompuesta(k, v)) {
      if (!casa(fila, v)) return false;
      continue;
    }
    if (!casaCampo(fila[k], v)) return false;
  }
  return true;
}

function ordenar(filas: Fila[], orderBy: any): Fila[] {
  if (!orderBy) return filas;
  const criterios: Fila[] = Array.isArray(orderBy) ? orderBy : [orderBy];
  return [...filas].sort((a, b) => {
    for (const c of criterios) {
      const [campo, dir] = Object.entries(c)[0] as [string, string];
      const x = comparable(a[campo]);
      const y = comparable(b[campo]);
      if (x == null || y == null || x === y) continue;
      if (x < y) return dir === 'desc' ? 1 : -1;
      return dir === 'desc' ? -1 : 1;
    }
    return 0;
  });
}

/** Error con la forma que Prisma le da a una violación de índice único. El
 *  código de producción distingue por `e.code === 'P2002'`; si este doble
 *  lanzara un Error pelado, esa rama no se probaría nunca. */
export class ErrorP2002 extends Error {
  code = 'P2002';
  meta: { target: string[] };
  constructor(modelo: string, campos: string[]) {
    super(`Unique constraint failed on the fields: (${campos.join(',')}) [${modelo}]`);
    this.name = 'PrismaClientKnownRequestError';
    this.meta = { target: campos };
  }
}

// ────────────────────────────── El almacén ──────────────────────────────

export class PrismaFalso {
  /** Las tablas, en crudo. Los tests miran aquí para comprobar qué se escribió. */
  datos: Record<string, Fila[]> = {};
  /** Qué candados de Postgres se pidieron. Lo usa el test del canje. */
  candados: string[] = [];

  private contador = 0;

  /** Los delegados por modelo (`db.convenioTarjeta.findFirst`, …) se montan en
   *  el constructor, así que el índice es la única forma de tiparlos. */
  [modelo: string]: any;

  constructor() {
    for (const m of MODELOS) {
      this.datos[m] = [];
      this[m] = this.delegado(m);
    }
  }

  /** El doble se le pasa a los servicios donde esperan un `PrismaService`. */
  comoPrisma(): PrismaService {
    return this as unknown as PrismaService;
  }

  private nuevoId(modelo: string) {
    this.contador += 1;
    return `${modelo}-${this.contador}`;
  }

  // ── Siembra ──

  /** Mete una fila directamente, con los valores por defecto del modelo. Es lo
   *  que usan los specs para montar el escenario, sin pasar por el servicio. */
  sembrar(modelo: string, fila: Fila): Fila {
    if (!this.datos[modelo]) throw new Error(`Modelo desconocido: ${modelo}`);
    const completa: Fila = {
      id: fila.id ?? this.nuevoId(modelo),
      createdAt: fila.createdAt ?? new Date(),
      updatedAt: fila.updatedAt ?? new Date(),
      ...POR_DEFECTO[modelo](),
      ...fila,
    };
    this.datos[modelo].push(completa);
    return completa;
  }

  /** Todas las filas de una tabla. Para las aserciones de los specs. */
  tabla(modelo: string): Fila[] {
    return this.datos[modelo] ?? [];
  }

  // ── Transacciones ──

  async $transaction(arg: any): Promise<any> {
    if (Array.isArray(arg)) {
      // Forma de array: en Prisma son promesas perezosas; aquí ya se están
      // ejecutando. Se soporta para no reventar si alguien la introduce, pero
      // ningún servicio de alianzas la usa para atomicidad.
      return Promise.all(arg);
    }
    const copia = clonar(this.datos);
    try {
      return await arg(this);
    } catch (e) {
      // Rollback: si la función lanzó, nada de lo que escribió queda. Es lo que
      // hace demostrable que la lista blanca se marca DENTRO de la transacción.
      this.datos = copia;
      throw e;
    }
  }

  /** No-op: en producción solo lleva `pg_advisory_xact_lock`, y un almacén de
   *  un solo hilo no tiene nada que serializar. Se anota para poder afirmar en
   *  el test que el canje SÍ pide el candado. */
  async $executeRawUnsafe(sql: string, ...params: any[]): Promise<number> {
    this.candados.push(String(params[0] ?? sql));
    return 1;
  }

  // ── Delegados por modelo ──

  private delegado(modelo: string) {
    return {
      findUnique: async (args: any = {}) => this.buscarUno(modelo, args),
      findFirst: async (args: any = {}) => this.buscarUno(modelo, args),
      findMany: async (args: any = {}) => this.buscarMuchos(modelo, args),
      count: async (args: any = {}) =>
        this.datos[modelo].filter((f) => casa(f, args.where)).length,
      aggregate: async (args: any = {}) => this.agregar(modelo, args),
      create: async (args: any) => this.crear(modelo, args),
      update: async (args: any) => this.actualizar(modelo, args),
      updateMany: async (args: any) => this.actualizarMuchos(modelo, args),
      delete: async (args: any) => this.borrar(modelo, args),
      deleteMany: async (args: any = {}) => this.borrarMuchos(modelo, args),
      upsert: async (args: any) => {
        const previa = this.datos[modelo].find((f) => casa(f, args.where));
        return previa
          ? this.actualizar(modelo, { where: args.where, data: args.update })
          : this.crear(modelo, { data: args.create });
      },
    };
  }

  private buscarUno(modelo: string, args: any) {
    const fila = ordenar(
      this.datos[modelo].filter((f) => casa(f, args.where)),
      args.orderBy,
    )[0];
    return fila ? this.proyectar(modelo, fila, args) : null;
  }

  private buscarMuchos(modelo: string, args: any) {
    let filas = this.datos[modelo].filter((f) => casa(f, args.where));
    filas = ordenar(filas, args.orderBy);
    if (args.skip) filas = filas.slice(args.skip);
    if (args.take != null) filas = filas.slice(0, args.take);
    return filas.map((f) => this.proyectar(modelo, f, args));
  }

  private agregar(modelo: string, args: any) {
    const filas = this.datos[modelo].filter((f) => casa(f, args.where));
    const salida: Fila = {};
    if (args._count) salida._count = filas.length;
    for (const clave of ['_sum', '_avg', '_min', '_max'] as const) {
      if (!args[clave]) continue;
      const parcial: Fila = {};
      for (const campo of Object.keys(args[clave])) {
        const valores = filas
          .map((f) => f[campo])
          .filter((v) => v !== null && v !== undefined);
        if (valores.length === 0) {
          // Prisma devuelve null cuando no hay nada que sumar, no 0. La
          // diferencia importa: el portal pinta «—» con null y «$0» con cero.
          parcial[campo] = null;
        } else if (clave === '_sum') {
          parcial[campo] = valores.reduce((a, b) => a + b, 0);
        } else if (clave === '_avg') {
          parcial[campo] = valores.reduce((a, b) => a + b, 0) / valores.length;
        } else if (clave === '_min') {
          parcial[campo] = valores.reduce((a, b) => (a < b ? a : b));
        } else {
          parcial[campo] = valores.reduce((a, b) => (a > b ? a : b));
        }
      }
      salida[clave] = parcial;
    }
    return salida;
  }

  // ── Escrituras ──

  private crear(modelo: string, args: any) {
    const fila: Fila = {
      id: args.data.id ?? this.nuevoId(modelo),
      createdAt: args.data.createdAt ?? new Date(),
      updatedAt: new Date(),
      ...POR_DEFECTO[modelo](),
      ...args.data,
    };
    this.exigirUnicos(modelo, fila, null);
    this.datos[modelo].push(fila);
    return this.proyectar(modelo, fila, args);
  }

  private filaUnica(modelo: string, where: any): Fila {
    const fila = this.datos[modelo].find((f) => casa(f, where));
    if (!fila) {
      const e: any = new Error(`No ${modelo} found`);
      e.code = 'P2025';
      throw e;
    }
    return fila;
  }

  private aplicar(fila: Fila, data: Fila) {
    for (const [k, v] of Object.entries(data)) {
      if (v && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v)) {
        if ('increment' in v) {
          fila[k] = (fila[k] ?? 0) + (v as any).increment;
          continue;
        }
        if ('decrement' in v) {
          fila[k] = (fila[k] ?? 0) - (v as any).decrement;
          continue;
        }
        if ('set' in v) {
          fila[k] = (v as any).set;
          continue;
        }
      }
      fila[k] = v;
    }
    fila.updatedAt = new Date();
  }

  private actualizar(modelo: string, args: any) {
    const fila = this.filaUnica(modelo, args.where);
    const antes = clonar(fila);
    this.aplicar(fila, args.data);
    try {
      this.exigirUnicos(modelo, fila, fila);
    } catch (e) {
      Object.assign(fila, antes);
      throw e;
    }
    return this.proyectar(modelo, fila, args);
  }

  private actualizarMuchos(modelo: string, args: any) {
    const filas = this.datos[modelo].filter((f) => casa(f, args.where));
    for (const f of filas) this.aplicar(f, args.data);
    return { count: filas.length };
  }

  private borrar(modelo: string, args: any) {
    const fila = this.filaUnica(modelo, args.where);
    this.datos[modelo] = this.datos[modelo].filter((f) => f !== fila);
    return fila;
  }

  private borrarMuchos(modelo: string, args: any) {
    const quedan = this.datos[modelo].filter((f) => !casa(f, args.where));
    const count = this.datos[modelo].length - quedan.length;
    this.datos[modelo] = quedan;
    return { count };
  }

  /** Los índices únicos del esquema. `salvo` es la propia fila en un update. */
  private exigirUnicos(modelo: string, fila: Fila, salvo: Fila | null) {
    for (const u of UNICOS[modelo] ?? []) {
      const valores = u.campos.map((c) => fila[c]);
      if (u.parcial && valores.some((v) => v === null || v === undefined)) continue;
      const choca = this.datos[modelo].some(
        (f) =>
          f !== salvo && u.campos.every((c, i) => casaCampo(f[c], valores[i] ?? null)),
      );
      if (choca) throw new ErrorP2002(modelo, u.campos);
    }
  }

  // ── Proyección: select / include ──

  private proyectar(modelo: string, fila: Fila, args: any): Fila {
    const select = args?.select;
    const include = args?.include;
    if (select) {
      const salida: Fila = {};
      for (const [k, v] of Object.entries(select)) {
        if (!v) continue;
        const rel = RELACIONES[modelo]?.[k];
        salida[k] = rel
          ? this.resolver(rel, fila, v === true ? {} : (v as any))
          : clonar(fila[k]);
      }
      return salida;
    }
    const salida: Fila = clonar(fila);
    for (const [k, v] of Object.entries(include ?? {})) {
      if (!v) continue;
      const rel = RELACIONES[modelo]?.[k];
      if (!rel) throw new Error(`El doble no conoce la relación ${modelo}.${k}`);
      salida[k] = this.resolver(rel, fila, v === true ? {} : (v as any));
    }
    return salida;
  }

  private resolver(rel: Relacion, fila: Fila, opciones: any) {
    if (fila[rel.local] === null || fila[rel.local] === undefined) {
      return rel.muchos ? [] : null;
    }
    const donde = { [rel.remoto]: fila[rel.local] };
    if (!rel.muchos) {
      return this.buscarUno(rel.modelo, { ...opciones, where: donde });
    }
    const orderBy = opciones.orderBy ?? rel.orden?.map((c) => ({ [c]: 'asc' as const }));
    return this.buscarMuchos(rel.modelo, { ...opciones, where: donde, orderBy });
  }
}

// ───────────────────── Cola falsa (pushes de billetera) ─────────────────────

/** Doble de `QueueService`: solo anota qué se encoló. El portal empuja pases
 *  por aquí, y la mitad de sus decisiones son «¿hace falta empujar o no?». */
export class ColaFalsa {
  encolados: { nombre: string; datos: any }[] = [];

  async enqueue(nombre: string, datos: any) {
    this.encolados.push({ nombre, datos });
    return { id: `job-${this.encolados.length}` };
  }

  pushes() {
    return this.encolados.filter((j) => j.nombre === 'wallet.push');
  }

  limpiar() {
    this.encolados = [];
  }
}

// ───────────────────────────── Escenario base ─────────────────────────────

export type OpcionesEscenario = {
  verificacion?: 'ABIERTO' | 'CODIGO' | 'LISTA';
  codigo?: string | null;
  status?: 'ACTIVE' | 'PAUSED' | 'FINISHED';
  endsAt?: Date | null;
  conveniosEnabled?: boolean;
  tenantStatus?: string;
  dataPolicyUrl?: string | null;
  /** `false` = convenio sin ningún cupón (enlace repartido antes de tiempo). */
  conCupon?: boolean;
  cupon?: Fila;
  /** Sedes en las que aplica el convenio. Vacío = en todas. */
  sedes?: string[];
  /** Sede asignada al cajero que atiende. `null` = sin sede, como el dueño. */
  sedeDelCajero?: string | null;
};

/**
 * El montaje que comparten los tres specs: un negocio, un convenio y un cupón.
 * Devuelve el doble y las filas ya sembradas para poder afirmar sobre ellas.
 */
export function escenario(op: OpcionesEscenario = {}) {
  const db = new PrismaFalso();
  const tenant = db.sembrar('tenant', {
    id: 'tenant-cafe',
    slug: 'cafe-luna',
    brandName: 'Café Luna',
    logoUrl: 'https://cdn.ejemplo/cafe-luna.png',
    primaryColor: '#2E7D32',
    status: op.tenantStatus ?? 'ACTIVE',
    conveniosEnabled: op.conveniosEnabled ?? true,
    dataPolicyUrl: op.dataPolicyUrl === undefined ? 'https://cafeluna.co/datos' : op.dataPolicyUrl,
    timezone: 'America/Bogota',
  });
  const convenio = db.sembrar('convenio', {
    id: 'convenio-confe',
    tenantId: tenant.id,
    slug: 'confenalco',
    name: 'Confenalco',
    logoUrl: 'https://cdn.ejemplo/confenalco.png',
    description: 'Beneficios para afiliados',
    verificacion: op.verificacion ?? 'ABIERTO',
    codigo: op.codigo === undefined ? null : op.codigo,
    status: op.status ?? 'ACTIVE',
    endsAt: op.endsAt ?? null,
    reportToken: 'informe-confe',
    aliadoToken: 'portal-confe',
  });
  const cupon =
    op.conCupon === false
      ? null
      : db.sembrar('convenioCupon', {
          id: 'cupon-10',
          convenioId: convenio.id,
          name: '10% en el almuerzo',
          tipo: 'PERCENT_OFF',
          valor: 10,
          position: 1,
          ...(op.cupon ?? {}),
        });
  for (const locationId of op.sedes ?? []) {
    db.sembrar('convenioSede', { convenioId: convenio.id, locationId });
  }
  const cajero = db.sembrar('user', {
    id: 'cajero-1',
    tenantId: tenant.id,
    locationId: op.sedeDelCajero ?? null,
  });
  return { db, tenant, convenio, cupon, cajero, prisma: db.comoPrisma() };
}

/** Los datos que manda el formulario del enlace, ya aceptada la política. */
export function formulario(p: Fila = {}): any {
  return {
    fullName: 'Ana Pérez',
    phone: '+573001112233',
    documento: '1020304',
    email: null,
    codigo: null,
    via: 'qr',
    dataPolicyAccepted: true,
    ...p,
  };
}
