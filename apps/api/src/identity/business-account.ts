import { Body, Controller, Get, HttpStatus, Injectable, Patch, Put } from '@nestjs/common';
import { ApiExcludeController, ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { AuditService } from '../audit/audit.service.js';
import { type Caller, CurrentCaller, personOf, resellerOf, Roles, SessionOnly } from '../auth/caller.js';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Reseller } from '../generated/prisma/client.js';
import { KycService } from '../kyc/kyc.service.js';
import { InboxService } from '../notifications/inbox.service.js';
import { businessVerified, IdentityService } from './identity.service.js';

export type AccountType = 'individual' | 'business';

/** The profile fields a reseller keeps, with their database columns and limits. Empty clears one. */
const profileFields = {
  legal_name: { column: 'legalName', max: 200 },
  address_line: { column: 'addressLine', max: 200 },
  city: { column: 'city', max: 80 },
  state: { column: 'state', max: 80 },
  postal_code: { column: 'postalCode', max: 20 },
  phone: { column: 'businessPhone', max: 25 },
  description: { column: 'businessDescription', max: 1000 },
} as const;
type ProfileField = keyof typeof profileFields;

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

class BusinessProfileDto {
  @ApiPropertyOptional({
    description: 'The business’s legal (registered) name.',
    maxLength: 200,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  legal_name?: string;

  @ApiPropertyOptional({ description: 'Street address.', maxLength: 200 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  address_line?: string;

  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  city?: string;

  @ApiPropertyOptional({
    description: 'State, region or county.',
    maxLength: 80,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  state?: string;

  @ApiPropertyOptional({ maxLength: 20 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(20)
  postal_code?: string;

  @ApiPropertyOptional({
    description: 'A contact number for the business (never confirmed).',
    example: '+234 803 123 4567',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Matches(/^$|^\+?[0-9][0-9 ()-]{5,23}$/, {
    message: 'Enter a telephone number: digits, spaces, brackets and dashes, optionally starting with +.',
  })
  phone?: string;

  @ApiPropertyOptional({
    description: 'What the business does.',
    maxLength: 1000,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  description?: string;
}

class AccountTypeDto {
  @ApiProperty({ enum: ['individual', 'business'] })
  @IsIn(['individual', 'business'])
  account_type: AccountType;
}

export function presentBusinessProfile(reseller: Reseller) {
  const verified = businessVerified(reseller);
  return {
    object: 'business_profile' as const,
    /** How the reseller sells: as an individual (the owner's identity) or a business (also KYB of the registered business). */
    account_type: (reseller.accountType === 'business' ? 'business' : 'individual') as AccountType,
    name: reseller.name,
    country: reseller.country,
    status: reseller.status,
    legal_name: reseller.legalName,
    address_line: reseller.addressLine,
    city: reseller.city,
    state: reseller.state,
    postal_code: reseller.postalCode,
    phone: reseller.businessPhone,
    description: reseller.businessDescription,
    /** The owner's identity is verified (KYC). */
    owner_verified: reseller.verifiedAt !== null,
    /** The registered business passed KYB, with its details as checked. */
    business_verified: verified,
    verified_business: verified
      ? {
          registered_name: reseller.registeredName,
          registration_number: reseller.registrationNumber,
          business_address: reseller.businessAddress,
          verified_at: reseller.kybVerifiedAt!.toISOString(),
        }
      : null,
    /** Paused (pending) until the business passes KYB, after switching to business while live. */
    paused_for_kyb: reseller.kybPausedAt !== null,
  };
}

/**
 * A reseller sells as an individual or as a business. The business profile is the reseller's own (never checked); the
 * account type decides what the identity check covers. Switching a live account to business pauses it until the
 * business passes KYB; switching back to individual with the owner's identity approved makes it live again.
 */
@Injectable()
export class BusinessAccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly kyc: KycService,
    private readonly audit: AuditService,
    private readonly inbox: InboxService,
  ) {}

  async profile(resellerId: string) {
    return presentBusinessProfile(
      await this.prisma.reseller.findUniqueOrThrow({
        where: { id: resellerId },
      }),
    );
  }

  async updateProfile(resellerId: string, actorId: string, input: Partial<Record<ProfileField, string>>) {
    const before = await this.prisma.reseller.findUniqueOrThrow({
      where: { id: resellerId },
    });
    const data: Record<string, string | null> = {};
    for (const [field, { column }] of Object.entries(profileFields) as Array<[ProfileField, (typeof profileFields)[ProfileField]]>) {
      const value = input[field];
      if (value !== undefined) data[column] = value === '' ? null : value;
    }
    if (!Object.keys(data).length) return presentBusinessProfile(before);
    const updated = await this.prisma.reseller.update({
      where: { id: resellerId },
      data,
    });
    const pick = (row: Reseller) => Object.fromEntries(Object.keys(data).map(column => [column, row[column as keyof Reseller] ?? null]));
    await this.audit.record({
      actorId,
      action: 'reseller.profile_updated',
      targetType: 'reseller',
      targetId: resellerId,
      before: pick(before),
      after: pick(updated),
    });
    return presentBusinessProfile(updated);
  }

  async setAccountType(resellerId: string, actorId: string, type: AccountType) {
    const reseller = await this.prisma.reseller.findUniqueOrThrow({
      where: { id: resellerId },
    });
    if (reseller.house) throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'not_permitted', 'This account’s type cannot be changed.');
    if (reseller.accountType === type) return presentBusinessProfile(reseller);
    if (await this.identity.ownerCheckInReview(resellerId)) {
      throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'verification_in_review', 'A check is being reviewed: change the account type once it is decided.');
    }
    const ownerCase = await this.identity.openOwnerCase(resellerId);
    let updated: Reseller;
    if (type === 'business') {
      // A live account whose business has not passed KYB is paused until it does.
      const pause = reseller.status === 'active' && !businessVerified(reseller);
      updated = await this.prisma.reseller.update({
        where: { id: resellerId },
        data: {
          accountType: 'business',
          ...(pause ? { status: 'pending', kybPausedAt: new Date() } : {}),
        },
      });
      if (ownerCase)
        await this.kyc.presetBusiness(ownerCase, {
          type: 'registered',
          registeredName: reseller.legalName,
          businessAddress: [reseller.addressLine, reseller.city, reseller.state, reseller.postalCode].filter(Boolean).join(', ') || null,
        });
      await this.inbox.reseller(resellerId, 'verification.updated', {
        subject: `account-type:business:${Date.now()}`,
        title: 'You switched to a business account',
        body: businessVerified(reseller)
          ? 'Your business is already verified: you now sell as a business.'
          : pause
            ? 'Live selling is paused until your business passes its check. Start it from Identity check; your sandbox works meanwhile.'
            : 'Verify your business from Identity check.',
        link: '/settings/verification',
      });
    } else {
      // Back to an individual: a business check in progress is closed, and an account paused for it goes live again
      // when the owner's identity is approved (or it is a test account).
      await this.identity.closeBusinessCheck(resellerId, actorId);
      const resume = reseller.kybPausedAt !== null && reseller.status === 'pending' && (reseller.verifiedAt !== null || reseller.testAccountAt !== null);
      updated = await this.prisma.reseller.update({
        where: { id: resellerId },
        data: {
          accountType: 'individual',
          kybPausedAt: null,
          ...(resume ? { status: 'active' } : {}),
        },
      });
      if (ownerCase) await this.kyc.presetBusiness(ownerCase, { type: 'unregistered' });
      await this.inbox.reseller(resellerId, 'verification.updated', {
        subject: `account-type:individual:${Date.now()}`,
        title: 'You switched to an individual account',
        body: resume ? 'Your identity is verified: live selling is back on.' : 'You now sell as an individual.',
        link: '/settings/verification',
      });
    }
    await this.audit.record({
      actorId,
      action: 'reseller.account_type_changed',
      targetType: 'reseller',
      targetId: resellerId,
      before: { account_type: reseller.accountType, status: reseller.status },
      after: { account_type: updated.accountType, status: updated.status },
    });
    return presentBusinessProfile(updated);
  }
}

/** SHQ's business profile and account type (sessions only). */
@ApiExcludeController()
@SessionOnly()
@Controller('reseller')
export class BusinessAccountController {
  constructor(private readonly accounts: BusinessAccountService) {}

  @Get('profile')
  profile(@CurrentCaller() caller: Caller) {
    return this.accounts.profile(resellerOf(caller));
  }

  @Roles('admin')
  @Patch('profile')
  update(@CurrentCaller() caller: Caller, @Body() body: BusinessProfileDto) {
    return this.accounts.updateProfile(resellerOf(caller), personOf(caller), body);
  }

  /** The owner only: it decides what the identity check covers and may pause live selling. */
  @Roles()
  @Put('account-type')
  accountType(@CurrentCaller() caller: Caller, @Body() body: AccountTypeDto) {
    return this.accounts.setAccountType(resellerOf(caller), personOf(caller), body.account_type);
  }
}
