import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { customAlphabet } from 'nanoid';
import { CampaignStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { AuthService } from '../auth/auth.service';

const codeGen = customAlphabet('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 8);

export type CreateCampaignDto = {
  name: string;
  // Datos del influencer titular. Si no existe ReferralCode con ese
  // email, se crea uno nuevo con role=INFLUENCER. Si existe, se reusa
  // y solo se valida que sea INFLUENCER y no tenga otra campaña.
  influencerName: string;
  influencerEmail: string;
  influencerWhatsapp: string;
  influencerCommissionPercent?: number; // default 30
  influencerCustomCode?: string; // ej: "JUAN30" — si no, se genera
  // Password que el admin tipea en el form. Si no, generamos readable.
  influencerPassword?: string;
};

export type CreateAmbassadorDto = {
  fullName: string;
  email: string;
  whatsapp: string;
  commissionPercent?: number; // default 25
  customCode?: string;
  // Password que el admin tipea en el form. Si no, generamos readable.
  password?: string;
};

@Injectable()
export class CampaignsService {
  constructor(private prisma: PrismaService, private auth: AuthService) {}

  private assertAdmin(user: AuthUser) {
    if (user.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Solo super admin puede gestionar campañas');
    }
  }

  /**
   * Genera un código único. Si `preferred` viene, lo intenta; si choca o
   * no es válido, cae al random. Códigos siempre upper-case y alfanum.
   */
  private async resolveCode(preferred?: string): Promise<string> {
    if (preferred) {
      const clean = preferred.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (clean.length >= 3 && clean.length <= 24) {
        const exists = await this.prisma.referralCode.findUnique({
          where: { code: clean },
        });
        if (!exists) return clean;
      }
    }
    let code = codeGen();
    while (await this.prisma.referralCode.findUnique({ where: { code } })) {
      code = codeGen();
    }
    return code;
  }

  async create(user: AuthUser, dto: CreateCampaignDto) {
    this.assertAdmin(user);
    if (!dto.name?.trim()) throw new BadRequestException('Falta nombre de campaña');

    // Match-or-create del influencer.
    const email = dto.influencerEmail.trim().toLowerCase();
    let influencerCode = await this.prisma.referralCode.findFirst({
      where: { ownerEmail: email, role: 'INFLUENCER' },
      include: { ownerOfCampaign: true },
    });

    if (influencerCode?.ownerOfCampaign) {
      throw new BadRequestException(
        `Este influencer ya tiene la campaña "${influencerCode.ownerOfCampaign.name}". Crea otra cuenta o reúsala.`,
      );
    }

    if (!influencerCode) {
      const code = await this.resolveCode(dto.influencerCustomCode);
      influencerCode = await this.prisma.referralCode.create({
        data: {
          code,
          slug: code.toLowerCase(),
          ownerName: dto.influencerName,
          ownerEmail: email,
          ownerWhatsapp: dto.influencerWhatsapp,
          commissionPercent: dto.influencerCommissionPercent ?? 30,
          role: 'INFLUENCER',
        },
        include: { ownerOfCampaign: true },
      });
    }

    const campaign = await this.prisma.campaign.create({
      data: {
        name: dto.name.trim(),
        ownerCodeId: influencerCode.id,
        status: 'ACTIVE',
      },
      include: {
        ownerCode: true,
        codes: { where: { role: 'AMBASSADOR' } },
      },
    });

    // Crear cuenta de afiliado con password directo (admin lo comparte).
    // Si el admin tipeó una password en el form, se usa esa; si no,
    // generamos una readable (compat). Si falla por algún motivo, no
    // rompe la creación de campaña.
    const presetPassword =
      dto.influencerPassword?.trim() || this.auth.generateReadablePassword();
    const inviteResult = await this.auth
      .inviteAffiliate({
        email,
        fullName: dto.influencerName,
        role: 'AFFILIATE_INFLUENCER',
        referralCodeId: influencerCode.id,
        phone: dto.influencerWhatsapp,
        presetPassword,
      })
      .catch(() => null);

    return {
      ...campaign,
      // Credenciales del afiliado (solo en la response de create — el
      // admin las copia y comparte; no se persisten en plain text).
      affiliateCredentials: inviteResult?.password
        ? {
            email,
            password: inviteResult.password,
            loginUrl: '/login',
          }
        : null,
    };
  }

  async list(user: AuthUser) {
    this.assertAdmin(user);
    const campaigns = await this.prisma.campaign.findMany({
      include: {
        ownerCode: {
          include: {
            uses: {
              where: { status: { in: ['PAYING', 'ACTIVE'] } },
              select: { id: true },
            },
          },
        },
        codes: {
          where: { role: 'AMBASSADOR' },
          include: {
            uses: {
              where: { status: { in: ['PAYING', 'ACTIVE'] } },
              include: { commissions: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return campaigns.map((c) => {
      const directClients = c.ownerCode.uses.length;
      const indirectClients = c.codes.reduce((s, a) => s + a.uses.length, 0);
      const ambassadorCommissions = c.codes
        .flatMap((a) => a.uses.flatMap((u) => u.commissions))
        .reduce((s, x) => s + Number(x.amount), 0);
      return {
        id: c.id,
        name: c.name,
        status: c.status,
        createdAt: c.createdAt,
        ownerCode: {
          id: c.ownerCode.id,
          code: c.ownerCode.code,
          ownerName: c.ownerCode.ownerName,
          commissionPercent: Number(c.ownerCode.commissionPercent),
        },
        ambassadorsCount: c.codes.length,
        directClients,
        indirectClients,
        totalActiveClients: directClients + indirectClients,
        ambassadorCommissionsUsd: Math.round(ambassadorCommissions * 100) / 100,
      };
    });
  }

  async get(user: AuthUser, id: string) {
    this.assertAdmin(user);
    const c = await this.prisma.campaign.findUnique({
      where: { id },
      include: {
        ownerCode: {
          include: {
            uses: {
              include: {
                tenant: { select: { brandName: true, status: true } },
                commissions: true,
              },
            },
          },
        },
        codes: {
          where: { role: 'AMBASSADOR' },
          include: {
            uses: {
              include: {
                tenant: { select: { brandName: true, status: true } },
                commissions: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!c) throw new NotFoundException('Campaña');
    return c;
  }

  async update(
    user: AuthUser,
    id: string,
    patch: { name?: string; status?: CampaignStatus },
  ) {
    this.assertAdmin(user);
    return this.prisma.campaign.update({
      where: { id },
      data: {
        name: patch.name?.trim(),
        status: patch.status,
      },
    });
  }

  async addAmbassador(user: AuthUser, campaignId: string, dto: CreateAmbassadorDto) {
    this.assertAdmin(user);
    const camp = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { ownerCode: true },
    });
    if (!camp) throw new NotFoundException('Campaña');

    const email = dto.email.trim().toLowerCase();
    // Cross-flow dedupe: un mismo email no puede tener 2 ReferralCode como
    // AMBASSADOR (en esta campaña, en otra, o como Directo Empresa). Si ya
    // existe, no creamos otro — usar scripts/merge-ambassador-accounts.mjs
    // para reasignar/unificar.
    const dup = await this.prisma.referralCode.findFirst({
      where: { ownerEmail: email, role: 'AMBASSADOR' },
      include: { parentCode: { select: { ownerName: true, code: true } } },
    });
    if (dup) {
      const scope = dup.parentCodeId === camp.ownerCodeId
        ? 'en esta campaña'
        : dup.parentCodeId
          ? `bajo ${dup.parentCode?.ownerName ?? 'otro influencer'} [${dup.parentCode?.code ?? dup.parentCodeId}]`
          : 'como Embajador Directo Empresa';
      throw new BadRequestException(
        `Ya existe un embajador con este email ${scope} (referralCodeId=${dup.id}). ` +
          `Un mismo usuario no puede ser embajador en más de un lugar.`,
      );
    }

    const code = await this.resolveCode(dto.customCode);
    const ambassadorCode = await this.prisma.referralCode.create({
      data: {
        code,
        slug: code.toLowerCase(),
        ownerName: dto.fullName.trim(),
        ownerEmail: email,
        ownerWhatsapp: dto.whatsapp,
        commissionPercent: dto.commissionPercent ?? 25,
        role: 'AMBASSADOR',
        parentCodeId: camp.ownerCodeId,
        campaignId: camp.id,
      },
    });

    const presetPassword =
      dto.password?.trim() || this.auth.generateReadablePassword();
    const inviteResult = await this.auth
      .inviteAffiliate({
        email,
        fullName: dto.fullName,
        role: 'AFFILIATE_AMBASSADOR',
        referralCodeId: ambassadorCode.id,
        phone: dto.whatsapp,
        presetPassword,
      })
      .catch(() => null);

    return {
      ...ambassadorCode,
      affiliateCredentials: inviteResult?.password
        ? {
            email,
            password: inviteResult.password,
            loginUrl: '/login',
          }
        : null,
    };
  }

  /**
   * Endpoint público — devuelve info mínima de una campaña a partir
   * del code del influencer titular. Usado por la landing
   * /refer/[code] que muestra a posibles embajadores con quién se van
   * a sumar antes de pedir sus datos.
   */
  async getPublicByOwnerCode(ownerCode: string) {
    const clean = ownerCode.trim().toUpperCase();
    const ref = await this.prisma.referralCode.findUnique({
      where: { code: clean },
      include: {
        ownerOfCampaign: true,
        ambassadors: { where: { isActive: true }, select: { id: true } },
      },
    });
    // Antes requeríamos que el influencer tuviese una Campaign asociada.
    // Ahora aceptamos también el caso "sin campaña": el link funciona si
    // el code del influencer existe y está activo. Esto permite al
    // influencer compartir su link de registro de embajadores aunque
    // todavía no haya una campaña formal creada por el admin.
    if (!ref || !ref.isActive || ref.role !== 'INFLUENCER') {
      throw new NotFoundException('Link de invitación no válido o inactivo');
    }
    if (ref.ownerOfCampaign && ref.ownerOfCampaign.status !== 'ACTIVE') {
      throw new BadRequestException(
        'Esta campaña no está aceptando embajadores en este momento',
      );
    }
    return {
      campaignId: ref.ownerOfCampaign?.id ?? null,
      campaignName: ref.ownerOfCampaign?.name ?? null,
      influencerName: ref.ownerName,
      influencerCode: ref.code,
      ambassadorsCount: ref.ambassadors.length,
      // Default commission % que recibirá un nuevo embajador. Se lee
      // del Setting `referrals.defaultAmbassadorPercent` que el
      // super admin edita desde /admin/referrals → Configuración (mismo
      // key que usa el panel de admin para crear embajadores).
      // Fallback a 10 si no está seteado o es inválido.
      defaultCommissionPercent: await this.resolveDefaultAmbassadorCommission(),
    };
  }

  /** Lee el % de comisión por defecto para embajadores autogenerados.
   *  Reusa la misma key que usa ReferralsService para el flujo
   *  admin-creates-ambassador: `referrals.defaultAmbassadorPercent`.
   *  Valor entero entre 0 y 100. Si está vacío/inválido, retorna 10. */
  private async resolveDefaultAmbassadorCommission(): Promise<number> {
    const s = await this.prisma.setting.findUnique({
      where: { key: 'referrals.defaultAmbassadorPercent' },
    });
    const n = Number(s?.value?.trim() ?? '');
    if (Number.isFinite(n) && n >= 0 && n <= 100) return n;
    return 10;
  }

  /**
   * Endpoint público — autogeneración de embajadores. Recibe el code
   * del influencer titular + datos del aspirante; crea el embajador
   * con parentCode = ownerCode y status pendiente de aprobación si la
   * Setting referrals.requireAmbassadorApproval está activa.
   *
   * Sin auth: cualquier persona con el link puede aplicar. La validez
   * la da el Setting + la presencia de un email único.
   */
  async applyAsAmbassador(
    ownerCode: string,
    dto: {
      fullName: string;
      email: string;
      whatsapp: string;
      /** Si presente y válida (>=8), se asigna como password del embajador
       *  para que pueda entrar directo. Sino, se autogenera y se envía
       *  por email (flujo legacy). */
      password?: string;
    },
  ) {
    const clean = ownerCode.trim().toUpperCase();
    const owner = await this.prisma.referralCode.findUnique({
      where: { code: clean },
      include: { ownerOfCampaign: true },
    });
    // Aceptamos influencer activo aunque NO tenga campaña — el link de
    // registro no debe depender de que el admin haya creado una campaña.
    if (!owner || !owner.isActive || owner.role !== 'INFLUENCER') {
      throw new NotFoundException('Link de invitación no válido o inactivo');
    }
    if (owner.ownerOfCampaign && owner.ownerOfCampaign.status !== 'ACTIVE') {
      throw new BadRequestException('La campaña no está activa');
    }

    const email = dto.email.trim().toLowerCase();
    if (!email.includes('@')) throw new BadRequestException('Email inválido');
    if (!dto.fullName.trim()) throw new BadRequestException('Falta el nombre');
    if (!dto.whatsapp.trim()) throw new BadRequestException('Falta el WhatsApp');
    const usingPreset = !!dto.password && dto.password.length >= 8;

    const dup = await this.prisma.referralCode.findFirst({
      where: {
        ownerEmail: email,
        role: 'AMBASSADOR',
        parentCodeId: owner.id,
      },
    });
    if (dup) {
      // Diferenciar entre dup-pending y dup-active. Si está pending
      // (isActive=false + approvedAt=null), no enviamos email; le decimos
      // que sigue en revisión. Si está activo, re-enviamos la invitación.
      const isPending = !dup.isActive && !dup.approvedAt;
      if (!isPending) {
        await this.auth
          .inviteAffiliate({
            email,
            fullName: dup.ownerName,
            role: 'AFFILIATE_AMBASSADOR',
            referralCodeId: dup.id,
            phone: dup.ownerWhatsapp,
            presetPassword: usingPreset ? dto.password : undefined,
          })
          .catch(() => null);
      }
      return {
        ok: true,
        alreadyExists: true,
        code: dup.code,
        pendingApproval: isPending,
        message: isPending
          ? 'Tu solicitud sigue en revisión por el admin. Te avisaremos por email cuando se apruebe.'
          : usingPreset
          ? 'Ya tenías cuenta. Actualizamos tu contraseña — ya podés entrar a tu panel.'
          : 'Ya estabas inscripto como embajador de esta campaña. Te re-enviamos las instrucciones por email.',
      };
    }

    // Si requireAmbassadorApproval está on, creamos en estado pendiente
    // (approvedAt=null + isActive=false hasta que admin apruebe).
    const requireApprovalSetting = await this.prisma.setting.findUnique({
      where: { key: 'referrals.requireAmbassadorApproval' },
    });
    const requireApproval = requireApprovalSetting?.value === 'true';

    // Race protection: dos requests concurrentes con el mismo email
    // pueden pasar el findFirst de arriba simultáneamente y crear 2
    // ReferralCode duplicados. Lo manejamos catching el P2002 que tira
    // Prisma cuando colisiona el `code` único (resolveCode genera uno
    // distinto cada vez, pero el código duplicado real lo detectamos
    // re-leyendo el row existente y devolviendo alreadyExists).
    const code = await this.resolveCode();
    const defaultCommission = await this.resolveDefaultAmbassadorCommission();
    let ambassadorCode;
    try {
      ambassadorCode = await this.prisma.referralCode.create({
        data: {
          code,
          slug: code.toLowerCase(),
          ownerName: dto.fullName.trim(),
          ownerEmail: email,
          ownerWhatsapp: dto.whatsapp.trim(),
          commissionPercent: defaultCommission,
          role: 'AMBASSADOR',
          parentCodeId: owner.id,
          campaignId: owner.ownerOfCampaign?.id ?? null,
          isActive: !requireApproval,
          approvedAt: requireApproval ? null : new Date(),
        },
      });
    } catch (e: any) {
      // P2002 = unique constraint violation. Re-leemos para devolver el
      // que ya existe (creado por la otra request concurrente).
      if (e?.code === 'P2002') {
        const existing = await this.prisma.referralCode.findFirst({
          where: { ownerEmail: email, role: 'AMBASSADOR', parentCodeId: owner.id },
        });
        if (existing) {
          return {
            ok: true,
            alreadyExists: true,
            code: existing.code,
            pendingApproval: !existing.isActive && !existing.approvedAt,
            message:
              'Tu solicitud ya fue registrada. Te enviamos las instrucciones por email.',
          };
        }
      }
      throw e;
    }

    // Solo invitamos al panel si NO requiere aprobación. Si requiere
    // aprobación, el admin manda la invitación al aprobar.
    if (!requireApproval) {
      await this.auth
        .inviteAffiliate({
          email,
          fullName: dto.fullName,
          role: 'AFFILIATE_AMBASSADOR',
          referralCodeId: ambassadorCode.id,
          phone: dto.whatsapp,
          presetPassword: usingPreset ? dto.password : undefined,
        })
        .catch(() => null);
    }

    return {
      ok: true,
      code: ambassadorCode.code,
      pendingApproval: requireApproval,
      usedCustomPassword: usingPreset,
      message: requireApproval
        ? '¡Listo! Tu solicitud está en revisión. Recibirás un email cuando se apruebe.'
        : usingPreset
        ? '¡Bienvenido! Tu cuenta está activa — ya podés entrar con el email y la contraseña que elegiste.'
        : '¡Bienvenido! Te enviamos un email con tu código y el acceso al panel.',
    };
  }

  async removeAmbassador(user: AuthUser, ambassadorId: string) {
    this.assertAdmin(user);
    const code = await this.prisma.referralCode.findUnique({
      where: { id: ambassadorId },
    });
    if (!code || code.role !== 'AMBASSADOR') {
      throw new NotFoundException('Embajador');
    }
    // Soft-delete: marcamos isActive=false. No borramos para preservar
    // historial de comisiones y atribución.
    await this.prisma.referralCode.update({
      where: { id: ambassadorId },
      data: { isActive: false },
    });
    return { ok: true };
  }
}
