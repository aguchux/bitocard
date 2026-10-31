import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEmail, IsString, Length } from 'class-validator';
import { AdminRoles, type Caller, CurrentCaller, RealmOnly, StepUp } from './caller.js';
import { AdminTeamService } from './admin-team.service.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const lowerTrim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);

class InviteAdminDto {
  @Transform(trim) @IsString() @Length(2, 100)
  name: string;

  @Transform(lowerTrim) @IsEmail() @Length(3, 254)
  email: string;

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(4) @IsString({ each: true })
  roles: string[];
}

class RolesDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(4) @IsString({ each: true })
  roles: string[];
}

class ReasonDto {
  @Transform(trim) @IsString() @Length(3, 500)
  reason: string;
}

const actor = (caller: Caller) => (caller.kind === 'session' ? caller.userId : '');

/** The admin team (Settings > Team): super admins only, every change after step-up. */
@ApiExcludeController()
@RealmOnly('admin')
@AdminRoles('super_admin')
@Controller('admin/team')
export class AdminTeamController {
  constructor(private readonly team: AdminTeamService) {}

  @Get()
  list() {
    return this.team.list();
  }

  /** Invites a member of staff: their account with the roles chosen, and a link to set their password. */
  @StepUp()
  @Post()
  invite(@CurrentCaller() caller: Caller, @Body() body: InviteAdminDto) {
    return this.team.invite(actor(caller), body);
  }

  @StepUp()
  @Patch(':id')
  setRoles(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: RolesDto) {
    return this.team.setRoles(actor(caller), id, body.roles);
  }

  @StepUp()
  @Post(':id/password-link')
  @HttpCode(HttpStatus.OK)
  passwordLink(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
    return this.team.passwordLink(actor(caller), id);
  }

  @StepUp()
  @Post(':id/authenticator/reset')
  @HttpCode(HttpStatus.OK)
  resetAuthenticator(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReasonDto) {
    return this.team.resetAuthenticator(actor(caller), id, body.reason);
  }

  @StepUp()
  @Post(':id/suspend')
  @HttpCode(HttpStatus.OK)
  suspend(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReasonDto) {
    return this.team.suspend(actor(caller), id, body.reason);
  }

  @StepUp()
  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  restore(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReasonDto) {
    return this.team.restore(actor(caller), id, body.reason);
  }
}
