import { Module } from '@nestjs/common';
import { CountriesModule } from '../countries/countries.module';
import { TeamModule } from '../team/team.module';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthService } from './admin-auth.service';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { CodesService } from './codes.service';
import { GoogleController } from './google.controller';
import { GoogleService } from './google.service';
import { PasswordsService } from './passwords.service';
import { SessionsService } from './sessions.service';

@Module({
  imports: [TeamModule, CountriesModule],
  controllers: [AuthController, GoogleController, AdminAuthController],
  providers: [AuthService, AdminAuthService, GoogleService, CodesService, PasswordsService, SessionsService, AuthGuard],
  exports: [AdminAuthService, AuthGuard, SessionsService, PasswordsService, CodesService],
})
export class AuthModule {}
