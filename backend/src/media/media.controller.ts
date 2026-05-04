import {
  Controller,
  Get,
  Post,
  UploadedFile,
  UseInterceptors,
  Query,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { MediaService } from './media.service';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('media')
@Roles('TENANT_OWNER', 'TENANT_STAFF', 'SUPER_ADMIN')
export class MediaController {
  constructor(private svc: MediaService) {}

  @Get('config')
  config() {
    return { configured: this.svc.isConfigured() };
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File,
    @Query('folder') folder?: string,
  ) {
    return this.svc.upload({
      tenantId: user.tenantId ?? undefined,
      folder: folder ?? 'products',
      file,
    });
  }
}
