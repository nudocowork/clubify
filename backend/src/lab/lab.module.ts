import { Module } from '@nestjs/common';
import { LabService } from './lab.service';
import { LabController } from './lab.controller';
import { LabAdminController } from './lab-admin.controller';
import { AuthModule } from '../auth/auth.module';
import { EmailModule } from '../email/email.module';

/**
 * Clubify Lab (item 13 sprint). Sistema de propuestas de comunidad:
 * - Clientes / afiliados crean propuestas (CLIENTS o AFFILIATES).
 * - Equipo Clubify revisa, aprueba o rechaza con motivo.
 * - Las aprobadas pasan a votación pública con 4 tipos de voto.
 * - Las más votadas entran al roadmap (status progresa por etapas).
 *
 * Depende de AuthModule (PreregAlertsService → SMS team) y EmailModule
 * (notificación al autor cuando cambia el status).
 */
@Module({
  imports: [AuthModule, EmailModule],
  providers: [LabService],
  controllers: [LabController, LabAdminController],
  exports: [LabService],
})
export class LabModule {}
