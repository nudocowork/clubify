import { Module } from '@nestjs/common';
import { AdminUsersController } from './admin-users.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [AdminUsersController],
})
export class AdminUsersModule {}
