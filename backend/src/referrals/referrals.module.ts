import { Module } from '@nestjs/common';
import { ReferralsService } from './referrals.service';
import {
  ReferralsController,
  AdminCommissionsController,
  SellerRegistrationController,
  AmbassadorRegistrationController,
  PublicAffiliateSignupController,
  AdminAffiliateRegistrationController,
} from './referrals.controller';
import { AuthModule } from '../auth/auth.module';
import { AdminModule } from '../admin/admin.module';
import { AuditService } from '../audit/audit.service';
import { CommissionRecalcModule } from './commission-recalc.module';
import { ComisionDeEquipoService } from './comision-de-equipo.service';
import { CutoffService } from './cutoff.service';
import { PendientesPorAsignarService } from './pendientes-por-asignar.service';
import { PendientesPorAsignarController } from './pendientes-por-asignar.controller';
import { ReglasDeComisionService } from './reglas-de-comision.service';
import { ReglasDeComisionController } from './reglas-de-comision.controller';
import { ParticipacionesCron, ParticipacionesService } from './participaciones.service';

@Module({
  imports: [AuthModule, AdminModule, CommissionRecalcModule],
  // CutoffService depende de ReferralsService (para el desbloqueo del hold),
  // nunca al revés → sin ciclo, inyección directa.
  providers: [
    ReferralsService,
    AuditService,
    CutoffService,
    ComisionDeEquipoService,
    PendientesPorAsignarService,
    ReglasDeComisionService,
    // El servicio también lo provee FinanceModule (lo usa la captura del
    // ingreso); el CRON solo aquí, para que no corra dos veces.
    ParticipacionesService,
    ParticipacionesCron,
  ],
  controllers: [
    ReferralsController,
    AdminCommissionsController,
    SellerRegistrationController,
    AmbassadorRegistrationController,
    PublicAffiliateSignupController,
    AdminAffiliateRegistrationController,
    PendientesPorAsignarController,
    ReglasDeComisionController,
  ],
  exports: [ReferralsService, AuditService, CutoffService, ReglasDeComisionService],
})
export class ReferralsModule {}
