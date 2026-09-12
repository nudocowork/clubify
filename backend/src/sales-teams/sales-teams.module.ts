import { Module } from '@nestjs/common';
import { SalesTeamsService } from './sales-teams.service';
import { SalesTeamsController } from './sales-teams.controller';
import { SalesLeadsService } from './sales-leads.service';
import { ResumenDeEquipoService } from './resumen-de-equipo.service';
import { SalesLeadsController } from './sales-leads.controller';
import { SalesAgendaService } from './sales-agenda.service';
import {
  SalesAgendaController,
  PublicSalesAgendaController,
} from './sales-agenda.controller';
import { SalesChatService } from './sales-chat.service';
import { SalesChatController } from './sales-chat.controller';
import { SalesAutomationsService } from './sales-automations.service';
import { SalesInboxModule } from './sales-inbox.module';
import { ModuloVentasGuard } from './modulo-ventas.guard';
import { CrmModule } from '../crm/crm.module';
import { MarketingModule } from '../marketing/marketing.module';

@Module({
  // MarketingModule solo por el envío del recordatorio: sale por la subcuenta
  // de la marca, igual que todo lo demás. Una marca sin subcuenta propia no
  // manda — el proveedor lo devuelve como `skipped`, no como error.
  imports: [CrmModule, MarketingModule, SalesInboxModule],
  providers: [
    SalesTeamsService,
    ResumenDeEquipoService,
    SalesLeadsService,
    SalesAgendaService,
    SalesChatService,
    SalesAutomationsService,
    ModuloVentasGuard,
  ],
  controllers: [
    SalesTeamsController,
    SalesLeadsController,
    SalesAgendaController,
    PublicSalesAgendaController,
    SalesChatController,
  ],
  exports: [SalesTeamsService],
})
export class SalesTeamsModule {}
