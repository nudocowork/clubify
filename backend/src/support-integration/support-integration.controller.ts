import { Controller, Get, Headers, UnauthorizedException } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { SupportIntegrationService } from './support-integration.service';

// API server-to-server para las fichas de Team Soporte (TeamClubify). Misma llave
// que el resto de integraciones (`x-api-key` == TEAM_INTEGRATION_KEY). Solo lectura:
// Clubify PRO es la fuente oficial de los datos comerciales y soporte no los edita.
@Controller('integration/support')
export class SupportIntegrationController {
  constructor(private svc: SupportIntegrationService) {}

  @Public()
  @Get('businesses')
  businesses(@Headers('x-api-key') apiKey?: string) {
    const expected = process.env.TEAM_INTEGRATION_KEY;
    if (!expected || apiKey !== expected) throw new UnauthorizedException();
    return this.svc.businesses();
  }
}
