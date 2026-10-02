import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { ApiExcludeController, ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, Length, Matches } from 'class-validator';
import type { Request, Response } from 'express';
import { SkipIdempotency } from '../common/idempotency/idempotency.interceptor';
import { AdminAuthService } from './admin-auth.service';
import { type Caller, CurrentCaller, Public, RealmOnly } from './caller';
import { passwordLength } from './passwords.service';
import { SessionsService } from './sessions.service';

class AdminSignInDto {
  @ApiProperty({ format: 'email', example: 'ops@bitocard.com' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  email: string;

  @ApiProperty({ minLength: 1, maxLength: passwordLength.max })
  @IsString()
  @Length(1, passwordLength.max)
  password: string;
}

class ChallengeDto {
  @ApiProperty({ description: 'The challenge_token returned by sign-in.' })
  @IsString()
  @Length(40, 120)
  challenge_token: string;
}

class MfaVerifyDto extends ChallengeDto {
  @ApiProperty({ description: '6-digit authenticator code, or a recovery code (xxxx-xxxx).', example: '492817' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @Matches(/^(\d{6}|[a-z0-9]{4}-[a-z0-9]{4})$/, { message: 'code must be a 6-digit code or a recovery code' })
  code: string;
}

/** Admin sign-in for admin.bitocard.com. Two steps: password, then an authenticator code every time. */
@ApiExcludeController()
@RealmOnly('admin')
@SkipIdempotency()
@Controller('admin/auth')
export class AdminAuthController {
  constructor(
    private readonly adminAuth: AdminAuthService,
    private readonly sessions: SessionsService,
  ) {}

  /** Step 1: email and password. Returns a 5-minute challenge to complete with an authenticator code. */
  @Public()
  @Post('signin')
  @HttpCode(HttpStatus.OK)
  signIn(@Body() body: AdminSignInDto) {
    return this.adminAuth.signIn(body.email, body.password);
  }

  /** First sign-in only: get the authenticator secret (and a QR-code URI) to add to an authenticator app. */
  @Public()
  @Post('mfa/setup')
  @HttpCode(HttpStatus.OK)
  setup(@Body() body: ChallengeDto) {
    return this.adminAuth.setup(body.challenge_token);
  }

  /** Step 2: authenticator or recovery code. Starts the session; the first time, returns 10 recovery codes once. */
  @Public()
  @Post('mfa/verify')
  @HttpCode(HttpStatus.OK)
  verify(@Body() body: MfaVerifyDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.adminAuth.verify(body.challenge_token, body.code, req, res);
  }

  @Get('session')
  session(@CurrentCaller() caller: Caller) {
    return this.adminAuth.describe(caller.kind === 'session' ? caller.userId : '');
  }

  @Post('signout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async signOut(@CurrentCaller() caller: Caller, @Res({ passthrough: true }) res: Response) {
    if (caller.kind === 'session') await this.sessions.revoke(caller.sessionId);
    this.sessions.clearCookie('admin', res);
  }
}
