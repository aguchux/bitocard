import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsString, Length } from 'class-validator';
import { type Caller, CurrentCaller, Roles, SessionOnly } from '../auth/caller.js';
import { ApiError } from '../common/errors/api-error.js';
import { SkipIdempotency } from '../common/idempotency/idempotency.interceptor.js';
import type { ResellerRole } from '../generated/prisma/client.js';
import { TeamService, staffRoles } from './team.service.js';

class InviteDto {
  @ApiProperty({ format: 'email', example: 'chidi@example.com' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  email: string;

  @ApiProperty({ enum: staffRoles, description: 'admin manages the team and keys; developer manages keys; finance and support have their own areas.' })
  @IsIn(staffRoles)
  role: ResellerRole;
}

class RoleDto {
  @ApiProperty({ enum: staffRoles })
  @IsIn(staffRoles)
  role: ResellerRole;
}

class AcceptDto {
  @ApiProperty({ description: 'The token from the invitation link.' })
  @IsString()
  @Length(20, 100)
  token: string;
}

function sessionReseller(caller: Caller) {
  if (caller.kind !== 'session' || !caller.resellerId) {
    throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'not_permitted', 'Choose a reseller account first.');
  }
  return { resellerId: caller.resellerId, userId: caller.userId };
}

/** Team management for owners and admins. Signed-in people only; API keys cannot manage the team. */
@ApiTags('Team')
@SessionOnly()
@Controller('team')
export class TeamController {
  constructor(private readonly team: TeamService) {}

  /** Members and pending invitations. Every member can see the team. */
  @ApiOperation({ summary: 'Members and pending invitations', description: 'Every member can see the team.' })
  @Get()
  list(@CurrentCaller() caller: Caller) {
    return this.team.team(sessionReseller(caller).resellerId);
  }

  /** Invite someone by email. They get a link valid for 7 days. */
  @ApiOperation({ summary: 'Invite someone by email', description: 'They get a link valid for 7 days.' })
  @Roles('admin')
  @Post('invitations')
  invite(@CurrentCaller() caller: Caller, @Body() body: InviteDto) {
    const { resellerId, userId } = sessionReseller(caller);
    return this.team.invite(resellerId, userId, body.email, body.role);
  }

  @ApiOperation({ summary: 'Cancel a pending invitation' })
  @Roles('admin')
  @Delete('invitations/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  revoke(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
    return this.team.revokeInvitation(sessionReseller(caller).resellerId, id);
  }

  /** Accept an invitation while signed in with the invited email. New people can instead sign up with the token. */
  @ApiOperation({ summary: 'Accept an invitation while signed in with the invited email', description: 'New people can instead sign up with the token.' })
  @Post('invitations/accept')
  @SkipIdempotency()
  @HttpCode(HttpStatus.OK)
  accept(@CurrentCaller() caller: Caller, @Body() body: AcceptDto) {
    if (caller.kind !== 'session') throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'not_permitted', 'Sign in first.');
    return this.team.accept(caller.userId, body.token);
  }

  @ApiOperation({ summary: "Change a member's role", description: 'The owner cannot be changed.' })
  @Roles('admin')
  @Patch('members/:userId')
  changeRole(@CurrentCaller() caller: Caller, @Param('userId', ParseUUIDPipe) userId: string, @Body() body: RoleDto) {
    return this.team.changeRole(sessionReseller(caller).resellerId, userId, body.role);
  }

  @ApiOperation({ summary: 'Remove a member', description: 'They lose access at once. The owner cannot be removed.' })
  @Roles('admin')
  @Delete('members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentCaller() caller: Caller, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.team.remove(sessionReseller(caller).resellerId, userId);
  }
}
