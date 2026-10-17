import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { bogotaDayEndUtc, bogotaDayStartUtc } from './cutoff-calendar';
import {
  ajusteDeLaRegla,
  APLICA_A,
  elegirReglaDeColaborador,
  TIPOS_DE_REGLA,
  type AjusteDeRegla,
  type ReglaDeColaborador,
  type TipoDeVenta,
  type VentaParaRegla,
} from './reglas-de-comision';
import { MARGEN_MISMO_COBRO_MS } from './clave-del-periodo';
import {
  anularParticipacionesDevueltas,
  cargarReglas,
  evaluarIngresos,
  SELECT_INGRESO,
} from './participaciones-motor';

/** Lo que llega del panel para crear o editar una regla (las dos clases). */
export type DatosDeRegla = {
  nombre?: string | null;
  tipo?: string;
  valor?: number;
  aplicaA?: string;
  periodicidades?: string[];
  planIds?: string[];
  /** YYYY-MM-DD en hora de Bogotá; null = abierta. */
  vigenteDesde?: string | null;
  vigenteHasta?: string | null;
  activo?: boolean;
  // Solo participaciones:
  beneficiarioCodeId?: string;
  negociosIncluidos?: string[];
  negociosExcluidos?: string[];
  // Solo colaborador:
  codeId?: string;
  prioridad?: number;
};

type Ambito = 'PARTICIPACION' | 'COLABORADOR';

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Configuración de las reglas de comisión: participaciones globales (socio,
 * PM) y reglas por colaborador. Cada cambio queda en `ReglaDeComisionHistorial`
 * con quién, cuándo, antes, después y un MOTIVO obligatorio — es dinero de
 * personas, y «¿quién le subió el % a este?» tiene que tener respuesta.
 *
 * Nada de lo que se haga aquí reescribe comisiones ya creadas: las reglas solo
 * se leen al crear una (ver `reglas-de-comision.ts`).
 */
@Injectable()
export class ReglasDeComisionService {
  constructor(private prisma: PrismaService) {}

  // ── Lectura ────────────────────────────────────────────────────────────
  async listar() {
    const [participaciones, colaboradores] = await Promise.all([
      this.prisma.participacionGlobal.findMany({
        orderBy: [{ activo: 'desc' }, { createdAt: 'asc' }],
        include: {
          beneficiarioCode: { select: { id: true, code: true, ownerName: true, ownerEmail: true, role: true, isActive: true } },
          _count: { select: { comisiones: true } },
        },
      }),
      this.prisma.reglaComisionColaborador.findMany({
        orderBy: [{ activo: 'desc' }, { prioridad: 'desc' }, { createdAt: 'asc' }],
        include: { code: { select: { id: true, code: true, ownerName: true, ownerEmail: true, role: true, commissionPercent: true } } },
      }),
    ]);
    return {
      participaciones: participaciones.map((p) => ({
        ...p,
        valor: Number(p.valor),
        comisionesGeneradas: p._count.comisiones,
        _count: undefined,
      })),
      colaboradores: colaboradores.map((r) => ({
        ...r,
        valor: Number(r.valor),
        code: { ...r.code, commissionPercent: Number(r.code.commissionPercent) },
      })),
    };
  }

  historial(ambito: Ambito, reglaId: string) {
    return this.prisma.reglaDeComisionHistorial.findMany({
      where: { ambito, reglaId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  /** Buscador de beneficiarios: cualquier código (también SOCIO), de Clubify. */
  async buscarCodigos(q: string) {
    const t = (q ?? '').trim();
    const wl = await this.prisma.whiteLabel
      .findFirst({ where: { slug: 'clubify' }, select: { id: true } })
      .catch(() => null);
    return this.prisma.referralCode.findMany({
      where: {
        ...(wl ? { OR: [{ whiteLabelId: wl.id }, { whiteLabelId: null }] } : {}),
        ...(t
          ? {
              AND: [
                {
                  OR: [
                    { ownerName: { contains: t, mode: 'insensitive' as const } },
                    { ownerEmail: { contains: t, mode: 'insensitive' as const } },
                    { code: { contains: t.toUpperCase() } },
                  ],
                },
              ],
            }
          : {}),
      },
      select: { id: true, code: true, ownerName: true, ownerEmail: true, role: true, isActive: true, commissionPercent: true },
      orderBy: { ownerName: 'asc' },
      take: 30,
    });
  }

  // ── Escritura ──────────────────────────────────────────────────────────
  async crearParticipacion(user: AuthUser, datos: DatosDeRegla, motivo: string) {
    this.exigirMotivo(motivo);
    if (!datos.beneficiarioCodeId) throw new BadRequestException('Elige el beneficiario.');
    await this.exigirCodigo(datos.beneficiarioCodeId);
    const data = this.normalizar(datos, true);
    if (!data.nombre) throw new BadRequestException('Ponle un nombre a la participación.');
    const creada = await this.prisma.participacionGlobal.create({
      data: {
        nombre: data.nombre,
        beneficiarioCodeId: datos.beneficiarioCodeId,
        tipo: data.tipo ?? 'PORCENTAJE',
        valor: data.valor as number,
        aplicaA: data.aplicaA ?? 'AMBAS',
        periodicidades: data.periodicidades ?? [],
        planIds: data.planIds ?? [],
        negociosIncluidos: data.negociosIncluidos ?? [],
        negociosExcluidos: data.negociosExcluidos ?? [],
        vigenteDesde: data.vigenteDesde ?? null,
        vigenteHasta: data.vigenteHasta ?? null,
        activo: data.activo ?? true,
        creadoPorId: user.id,
      },
    });
    await this.anotar(user, 'PARTICIPACION', creada.id, 'CREADA', null, creada, motivo);
    return creada;
  }

  async editarParticipacion(user: AuthUser, id: string, datos: DatosDeRegla, motivo: string) {
    this.exigirMotivo(motivo);
    const antes = await this.prisma.participacionGlobal.findUnique({ where: { id } });
    if (!antes) throw new NotFoundException('Esa participación no existe.');
    // El beneficiario no se cambia: la UNIQUE (regla, cobro) es el candado de
    // dedup, y cambiar de persona en la misma regla haría que los cobros ya
    // pagados a uno «cubrieran» al otro. Para otra persona, otra regla.
    if (datos.beneficiarioCodeId && datos.beneficiarioCodeId !== antes.beneficiarioCodeId) {
      throw new BadRequestException('El beneficiario no se cambia: desactiva esta participación y crea otra.');
    }
    const { nombre, ...resto } = this.normalizar(datos, false);
    const data = nombre ? { ...resto, nombre } : resto; // el nombre no se vacía
    const despues = await this.prisma.participacionGlobal.update({ where: { id }, data });
    await this.anotar(user, 'PARTICIPACION', id, this.accion(antes.activo, despues.activo), antes, despues, motivo);
    return despues;
  }

  async crearReglaDeColaborador(user: AuthUser, datos: DatosDeRegla, motivo: string) {
    this.exigirMotivo(motivo);
    if (!datos.codeId) throw new BadRequestException('Elige el colaborador.');
    await this.exigirCodigo(datos.codeId);
    const data = this.normalizar(datos, true);
    const creada = await this.prisma.reglaComisionColaborador.create({
      data: {
        codeId: datos.codeId,
        nombre: data.nombre ?? null,
        prioridad: Number.isFinite(datos.prioridad) ? Math.trunc(datos.prioridad as number) : 0,
        tipo: data.tipo ?? 'PORCENTAJE',
        valor: data.valor as number,
        aplicaA: data.aplicaA ?? 'AMBAS',
        periodicidades: data.periodicidades ?? [],
        planIds: data.planIds ?? [],
        vigenteDesde: data.vigenteDesde ?? null,
        vigenteHasta: data.vigenteHasta ?? null,
        activo: data.activo ?? true,
        creadoPorId: user.id,
      },
    });
    await this.anotar(user, 'COLABORADOR', creada.id, 'CREADA', null, creada, motivo);
    return creada;
  }

  async editarReglaDeColaborador(user: AuthUser, id: string, datos: DatosDeRegla, motivo: string) {
    this.exigirMotivo(motivo);
    const antes = await this.prisma.reglaComisionColaborador.findUnique({ where: { id } });
    if (!antes) throw new NotFoundException('Esa regla no existe.');
    if (datos.codeId && datos.codeId !== antes.codeId) {
      throw new BadRequestException('El colaborador no se cambia: desactiva esta regla y crea otra.');
    }
    const { negociosIncluidos: _i, negociosExcluidos: _e, ...data } = this.normalizar(datos, false);
    const despues = await this.prisma.reglaComisionColaborador.update({
      where: { id },
      data: {
        ...data,
        ...(Number.isFinite(datos.prioridad) ? { prioridad: Math.trunc(datos.prioridad as number) } : {}),
      },
    });
    await this.anotar(user, 'COLABORADOR', id, this.accion(antes.activo, despues.activo), antes, despues, motivo);
    return despues;
  }

  // ── Vista previa (solo lectura, la misma cuenta que el backfill) ──────
  /**
   * Lo que generarían las participaciones activas sobre los cobros de un rango,
   * sin escribir nada. Es la misma evaluación del backfill y del cron: si aquí
   * dice $X, el backfill escribe $X (menos lo que ya exista).
   */
  async simularParticipaciones(desde?: string, hasta?: string) {
    const where: Record<string, unknown> = {};
    if (desde && YMD.test(desde)) where.saleDate = { ...(where.saleDate as object), gte: bogotaDayStartUtc(desde) };
    if (hasta && YMD.test(hasta)) where.saleDate = { ...(where.saleDate as object), lt: bogotaDayEndUtc(hasta) };
    const [reglas, ingresos] = await Promise.all([
      cargarReglas(this.prisma),
      this.prisma.incomeRecord.findMany({ where, select: SELECT_INGRESO, orderBy: { saleDate: 'asc' } }),
    ]);
    const evaluaciones = await evaluarIngresos(this.prisma, ingresos as any, reglas, { enVivo: false });
    const ya = await this.prisma.commission.findMany({
      where: { participacionId: { not: null }, ingresoId: { in: ingresos.map((i) => i.id) } },
      select: { participacionId: true, ingresoId: true },
    });
    const existe = new Set(ya.map((c) => `${c.participacionId}|${c.ingresoId}`));
    const porRegla = new Map<string, { reglaId: string; nombre: string; ventas: number; totalUsd: number; yaCreadas: number }>();
    const exclusiones = new Map<string, number>();
    for (const e of evaluaciones) {
      if (e.exclusion) exclusiones.set(e.exclusion, (exclusiones.get(e.exclusion) ?? 0) + 1);
      for (const f of e.filas) {
        const r = reglas.find((x) => x.id === f.participacionId);
        const acc = porRegla.get(f.participacionId) ?? { reglaId: f.participacionId, nombre: r?.nombre ?? '', ventas: 0, totalUsd: 0, yaCreadas: 0 };
        acc.ventas += 1;
        acc.totalUsd = Math.round((acc.totalUsd + f.amount) * 100) / 100;
        if (existe.has(`${f.participacionId}|${f.ingresoId}`)) acc.yaCreadas += 1;
        porRegla.set(f.participacionId, acc);
      }
    }
    return {
      cobrosRevisados: ingresos.length,
      porRegla: [...porRegla.values()],
      excluidos: Object.fromEntries(exclusiones),
    };
  }

  /** Lo que el cron hace solo cada 15 minutos; expuesto para lanzarlo a mano. */
  async anularDevueltas(simular: boolean) {
    return anularParticipacionesDevueltas(this.prisma, { simular });
  }

  // ── Para el motor del vendedor ─────────────────────────────────────────
  /**
   * Qué regla de colaborador manda para cada código de la cadena en esta venta.
   * La excepción por cliente (`CommissionException`) gana: si el código tiene
   * una activa para este negocio, aquí no se devuelve nada para él.
   */
  async ajustesParaCadena(args: {
    tenantId: string;
    codeIds: Array<string | null | undefined>;
    venta: VentaParaRegla;
  }): Promise<Map<string, AjusteDeRegla>> {
    const ids = [...new Set(args.codeIds.filter((x): x is string => !!x))];
    const out = new Map<string, AjusteDeRegla>();
    if (!ids.length) return out;
    const reglas = await this.prisma.reglaComisionColaborador
      .findMany({ where: { codeId: { in: ids }, activo: true } })
      .catch(() => []);
    if (!reglas.length) return out;
    const conExcepcion = new Set(
      (
        await this.prisma.commissionException
          .findMany({
            where: { tenantId: args.tenantId, recipientCodeId: { in: ids }, isActive: true },
            select: { recipientCodeId: true },
          })
          .catch(() => [])
      ).map((e) => e.recipientCodeId),
    );
    const planas: ReglaDeColaborador[] = reglas.map((r) => ({ ...r, valor: Number(r.valor) }));
    for (const id of ids) {
      if (conExcepcion.has(id)) continue;
      const r = elegirReglaDeColaborador(planas, id, args.venta);
      const a = r ? ajusteDeLaRegla(r) : null;
      if (a) out.set(id, a);
    }
    return out;
  }

  /**
   * ¿Este cobro es venta NUEVA, RENOVACIÓN o UPGRADE? Primero lo que dice el
   * libro de ingresos (la categoría de ESE cobro); si todavía no está escrito
   * —el webhook lo registra en paralelo—, por historia: con un cobro o una
   * comisión anterior del negocio, es renovación.
   */
  async tipoDeVentaDelCobro(tenantId: string, tx: string | null | undefined, fecha: Date): Promise<TipoDeVenta> {
    if (tx) {
      const r = await this.prisma.incomeRecord
        .findFirst({ where: { externalTxId: tx, tenantId }, select: { category: true, isFirstPayment: true } })
        .catch(() => null);
      if (r?.category === 'NUEVA' || r?.category === 'RENOVACION' || r?.category === 'UPGRADE') return r.category;
    }
    const antes = new Date(fecha.getTime() - MARGEN_MISMO_COBRO_MS);
    const ingresoAnterior = await this.prisma.incomeRecord
      .findFirst({ where: { tenantId, status: 'PAGADO', saleDate: { lt: antes } }, select: { id: true } })
      .catch(() => null);
    if (ingresoAnterior) return 'RENOVACION';
    const comisionAnterior = await this.prisma.commission
      .findFirst({
        where: {
          referralUse: { tenantId },
          status: { not: 'REJECTED' },
          participacionId: null,
          businessDate: { lt: antes },
        },
        select: { id: true },
      })
      .catch(() => null);
    return comisionAnterior ? 'RENOVACION' : 'NUEVA';
  }

  // ── Internos ───────────────────────────────────────────────────────────
  private exigirMotivo(motivo: string | null | undefined) {
    if (!motivo || motivo.trim().length < 5) {
      throw new BadRequestException('Escribe el motivo del cambio (mínimo 5 caracteres). Queda en la auditoría.');
    }
  }

  private async exigirCodigo(id: string) {
    const c = await this.prisma.referralCode.findUnique({ where: { id }, select: { id: true } });
    if (!c) throw new BadRequestException('Ese código no existe.');
  }

  private accion(antes: boolean, despues: boolean) {
    if (antes === despues) return 'EDITADA';
    return despues ? 'ACTIVADA' : 'DESACTIVADA';
  }

  /** Valida y convierte lo que llega del panel. `completo` = es una creación. */
  private normalizar(d: DatosDeRegla, completo: boolean) {
    const out: {
      nombre?: string | null;
      tipo?: string;
      valor?: number;
      aplicaA?: string;
      periodicidades?: string[];
      planIds?: string[];
      negociosIncluidos?: string[];
      negociosExcluidos?: string[];
      vigenteDesde?: Date | null;
      vigenteHasta?: Date | null;
      activo?: boolean;
    } = {};
    if (d.nombre !== undefined) out.nombre = d.nombre?.trim() || null;
    if (d.tipo !== undefined || completo) {
      const tipo = d.tipo ?? 'PORCENTAJE';
      if (!(TIPOS_DE_REGLA as readonly string[]).includes(tipo)) throw new BadRequestException('Tipo inválido.');
      out.tipo = tipo;
    }
    if (d.valor !== undefined || completo) {
      const v = Number(d.valor);
      if (!Number.isFinite(v) || v <= 0) throw new BadRequestException('El valor tiene que ser mayor que 0.');
      const tipo = out.tipo ?? d.tipo;
      if (tipo !== 'FIJO' && v > 100) throw new BadRequestException('Un porcentaje no puede pasar de 100.');
      if (v > 99_999_999) throw new BadRequestException('Valor demasiado grande.');
      out.valor = Math.round(v * 100) / 100;
    }
    if (d.aplicaA !== undefined || completo) {
      const a = d.aplicaA ?? 'AMBAS';
      if (!(APLICA_A as readonly string[]).includes(a)) throw new BadRequestException('«Aplica a» inválido.');
      out.aplicaA = a;
    }
    if (d.periodicidades !== undefined) out.periodicidades = d.periodicidades.map((p) => p.toUpperCase());
    if (d.planIds !== undefined) out.planIds = d.planIds;
    if (d.negociosIncluidos !== undefined) out.negociosIncluidos = d.negociosIncluidos;
    if (d.negociosExcluidos !== undefined) out.negociosExcluidos = d.negociosExcluidos;
    const dia = (s: string | null | undefined, fin: boolean) => {
      if (s == null || s === '') return null;
      if (!YMD.test(s)) throw new BadRequestException('Fecha inválida (usa AAAA-MM-DD).');
      // «Hasta el 31» incluye el 31 entero, en hora de Bogotá: se guarda la
      // medianoche siguiente y se compara como exclusiva.
      return fin ? bogotaDayEndUtc(s) : bogotaDayStartUtc(s);
    };
    if (d.vigenteDesde !== undefined) out.vigenteDesde = dia(d.vigenteDesde, false);
    if (d.vigenteHasta !== undefined) out.vigenteHasta = dia(d.vigenteHasta, true);
    if (out.vigenteDesde && out.vigenteHasta && out.vigenteHasta <= out.vigenteDesde) {
      throw new BadRequestException('La vigencia termina antes de empezar.');
    }
    if (d.activo !== undefined) out.activo = !!d.activo;
    return out;
  }

  private async anotar(
    user: AuthUser,
    ambito: Ambito,
    reglaId: string,
    accion: string,
    antes: unknown,
    despues: unknown,
    motivo: string,
  ) {
    // JSON plano: Decimal y Date a texto, para que el historial se lea igual
    // dentro de un año aunque cambie el modelo.
    const plano = (x: unknown) => (x == null ? undefined : JSON.parse(JSON.stringify(x)));
    await this.prisma.reglaDeComisionHistorial.create({
      data: {
        ambito,
        reglaId,
        accion,
        antes: plano(antes),
        despues: plano(despues),
        motivo: motivo.trim(),
        actorId: user.impersonatedBy ?? user.id,
        actorEmail: user.email,
      },
    });
  }
}
