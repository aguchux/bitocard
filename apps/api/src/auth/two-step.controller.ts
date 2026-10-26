import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiExcludeController, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';
import { SkipIdempotency } from '../common/idempotency/idempotency.interceptor.js';
import { AdminRoles, AllowTwoStepPending, type Caller, CurrentCaller, personOf, RealmOnly, SessionOnly, StepUp } from './caller.js';
import { TwoStepCodeDto, TwoStepConfirmDto, TwoStepSetupDto } from './auth.dto.js';
import { TwoStepService } from './two-step.service.js';

const sessionOf = (caller: Caller) => (caller.kind === 'session' ? caller.sessionId : '');

/**
 * Two-step sign-in for SHQ: each person's own setting (an authenticator app, emailed codes or text messages), required
 * where BitoCard switches it on. These routes work on a session still waiting for its second step. They skip idempotency
 * keys: their answers carry secrets (an authenticator secret, recovery codes) that must never be stored for replay.
 */
@ApiTags('Authentication')
@SkipIdempotency()
@SessionOnly()
@AllowTwoStepPending()
@Controller('auth/two-step')
export class TwoStepController {
  constructor(private readonly twoStep: TwoStepService) {}

  @ApiOperation({
    summary: 'Your two-step sign-in settings',
    description: 'Your method, whether your account requires two-step sign-in, whether this session still has to finish it, and the methods you can choose.',
  })
  @Get()
  settings(@CurrentCaller() caller: Caller) {
    return this.twoStep.settings(personOf(caller), sessionOf(caller));
  }

  @ApiOperation({
    summary: 'Start setting up a two-step method',
    description:
      'An authenticator app gets a new secret to scan (`otpauth_uri`); email and SMS get a 6-digit code sent to your primary address or confirmed mobile number (10 minutes). Changing an existing method needs a code from it (`current_code`). Confirm with `POST /v1/auth/two-step/setup/confirm`.',
  })
  @Post('setup')
  @HttpCode(HttpStatus.OK)
  setup(@CurrentCaller() caller: Caller, @Body() body: TwoStepSetupDto) {
    return this.twoStep.setup(personOf(caller), sessionOf(caller), body.method, body.current_code);
  }

  @ApiOperation({
    summary: 'Confirm the two-step method being set up',
    description: 'With its first code. Returns 10 recovery codes, shown only this once; this session counts as signed in with the new method.',
  })
  @Post('setup/confirm')
  @HttpCode(HttpStatus.OK)
  confirm(@CurrentCaller() caller: Caller, @Body() body: TwoStepConfirmDto) {
    return this.twoStep.confirmSetup(personOf(caller), sessionOf(caller), body.code);
  }

  @ApiOperation({
    summary: 'Send your emailed or texted two-step code',
    description: 'To finish signing in, or to confirm a change. At most one a minute (`sent: false` sooner: the last code still works). Authenticator apps need nothing sent.',
  })
  @Post('challenge')
  @HttpCode(HttpStatus.OK)
  challenge(@CurrentCaller() caller: Caller) {
    return this.twoStep.challenge(personOf(caller));
  }

  @ApiOperation({
    summary: 'Finish signing in with your two-step code',
    description: 'The code from your method, or a recovery code (each works once). Five wrong codes lock the account for 15 minutes, as wrong passwords do.',
  })
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  verify(@CurrentCaller() caller: Caller, @Body() body: TwoStepCodeDto) {
    return this.twoStep.verify(personOf(caller), sessionOf(caller), body.code);
  }

  @ApiOperation({ summary: 'Turn two-step sign-in off', description: 'Needs a current code. Refused (`two_step_enforced`) while your reseller account requires two-step sign-in.' })
  @Post('disable')
  @HttpCode(HttpStatus.OK)
  disable(@CurrentCaller() caller: Caller, @Body() body: TwoStepCodeDto) {
    return this.twoStep.disable(personOf(caller), body.code);
  }

  @ApiOperation({ summary: 'Replace your recovery codes', description: 'Needs a current code. Returns 10 new recovery codes, shown only this once; the old ones stop working.' })
  @Post('recovery-codes')
  @HttpCode(HttpStatus.OK)
  recoveryCodes(@CurrentCaller() caller: Caller, @Body() body: TwoStepCodeDto) {
    return this.twoStep.regenerateRecoveryCodes(personOf(caller), body.code);
  }
}

class ResetReasonDto {
  @IsString()
  @Length(3, 500)
  reason: string;
}

/** Admin: reset a reseller team member's two-step sign-in (a lost phone or authenticator), signing them out everywhere. */
@ApiExcludeController()
@RealmOnly('admin')
@Controller('admin/resellers/:id/members/:user/two-step')
export class AdminTwoStepController {
  constructor(private readonly twoStep: TwoStepService) {}

  @AdminRoles('operations')
  @StepUp()
  @Post('reset')
  @HttpCode(HttpStatus.OK)
  reset(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Param('user', ParseUUIDPipe) user: string, @Body() body: ResetReasonDto) {
    return this.twoStep.reset(caller.kind === 'session' ? caller.userId : null, id, user, body.reason.trim());
  }
}
