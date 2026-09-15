import { Module } from '@nestjs/common';
import { SalesTeamsService } from './sales-teams.service';
import { SalesTeamsController } from './sales-teams.controller';
import { SalesLeadsService } from './sales-leads.service';
import { ResumenDeEquipoService } from './resumen-de-equipo.service';
import { ListasDeEquipoService } from './listas-de-equipo.service';
import { ImplementacionesDeEquipoService } from './implementaciones-de-equipo.service';
import { BancoDeEquipoService } from './banco-de-equipo.service';
import { BancoDeEquipoController } from './banco-de-equipo.controller';
import { ContactosDeEquipoService } from './contactos-de-equipo.service';
import { ContactosDeEquipoController } from './contactos-de-equipo.controller';
import { SeguimientosDeEquipoService } from './seguimientos-de-equipo.service';
import { SeguimientosDeEquipoController } from './seguimientos-de-equipo.controller';
import { CrmDeEquipoService } from './crm-de-equipo.service';
import { CrmDeEquipoController } from './crm-de-equipo.controller';
import { ColaboradoresDeEquipoService } from './colaboradores-de-equipo.service';
import { ColaboradoresDeEquipoController } from './colaboradores-de-equipo.controller';
import { ConversacionesDeEquipoService } from './conversaciones-de-equipo.service';
import { ConversacionesDeEquipoController } from './conversaciones-de-equipo.controller';
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
    ListasDeEquipoService,
    ImplementacionesDeEquipoService,
    BancoDeEquipoService,
    ContactosDeEquipoService,
    SeguimientosDeEquipoService,
    CrmDeEquipoService,
    ColaboradoresDeEquipoService,
    ConversacionesDeEquipoService,
    SalesLeadsService,
    SalesAgendaService,
    SalesChatService,
    SalesAutomationsService,
    ModuloVentasGuard,
  ],
  controllers: [
    SalesTeamsController,
    SalesLeadsController,
    BancoDeEquipoController,
    ContactosDeEquipoController,
    SeguimientosDeEquipoController,
    CrmDeEquipoController,
    ColaboradoresDeEquipoController,
    ConversacionesDeEquipoController,
    SalesAgendaController,
    PublicSalesAgendaController,
    SalesChatController,
  ],
  exports: [SalesTeamsService],
})
export class SalesTeamsModule {}
