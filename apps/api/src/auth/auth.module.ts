import { Module } from '@nestjs/common';
import { CountriesModule } from '../countries/countries.module.js';
import { TeamModule } from '../team/team.module.js';
import { AdminAuthController } from './admin-auth.controller.js';
import { AdminAuthService } from './admin-auth.service.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { CodesService } from './codes.service.js';
import { DocsTokensService } from './docs-tokens.service.js';
import { GoogleController } from './google.controller.js';
import { GoogleService } from './google.service.js';
import { PasswordsService } from './passwords.service.js';
import { SignupVerificationService } from './signup-verification.service.js';
import { SessionsService } from './sessions.service.js';

@Module({
  imports: [TeamModule, CountriesModule],
  controllers: [AuthController, GoogleController, AdminAuthController],
  providers: [AuthService, AdminAuthService, GoogleService, CodesService, SignupVerificationService, PasswordsService, SessionsService, AuthGuard, DocsTokensService],
  exports: [AdminAuthService, AuthGuard, SessionsService, PasswordsService, CodesService],
})
export class AuthModule {}
