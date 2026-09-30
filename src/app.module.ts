import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';
import { OrganizationsModule } from './organizations/organizations.module.js';

@Module({
  imports: [AuthModule, OrganizationsModule],
})
export class AppModule {}
