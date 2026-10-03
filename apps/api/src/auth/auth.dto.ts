import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, Length, Matches, MaxLength, ValidateIf } from 'class-validator';
import { passwordLength } from './passwords.service.js';

const lowerTrim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const upperTrim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);

const passwordDoc = {
  description: 'At least 10 characters. Passwords found in public data breaches are refused.',
  minLength: passwordLength.min,
  maxLength: passwordLength.max,
  example: 'correct horse battery',
};
const codeDoc = { description: 'The 6-digit code that was sent to you.', pattern: '^\\d{6}$', example: '482913' };

export class SignUpDto {
  @ApiProperty({ description: 'Your full name.', minLength: 2, maxLength: 100, example: 'Ada Obi' })
  @Transform(trim)
  @IsString()
  @Length(2, 100)
  name: string;

  @ApiProperty({ description: 'Email address; a 6-digit code is sent to confirm it.', format: 'email', maxLength: 254, example: 'ada@example.com' })
  @Transform(lowerTrim)
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiProperty(passwordDoc)
  @IsString()
  @Length(passwordLength.min, passwordLength.max)
  password: string;

  @ApiPropertyOptional({ description: 'Business name shown on the reseller account. Defaults to your name.', minLength: 2, maxLength: 100, example: 'Ada Digital' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 100)
  business_name?: string;

  @ApiPropertyOptional({
    description: 'Country the business operates in (ISO 3166-1 alpha-2). During the pilot: NG, GH or KE. Not needed with an invitation.',
    pattern: '^[A-Z]{2}$',
    example: 'NG',
  })
  @ValidateIf((dto: SignUpDto) => !dto.invitation_token)
  @Transform(upperTrim)
  @IsString()
  @Matches(/^[A-Z]{2}$/, { message: 'country must be a 2-letter country code' })
  country?: string;

  @ApiPropertyOptional({ description: "Join a reseller's team from an invitation link, instead of creating a reseller account." })
  @IsOptional()
  @IsString()
  @Length(20, 100)
  invitation_token?: string;
}

export class SignInDto {
  @ApiProperty({
    description: 'Email address, or a verified mobile number in international format.',
    minLength: 3,
    maxLength: 254,
    example: 'ada@example.com',
  })
  @Transform(lowerTrim)
  @IsString()
  @Length(3, 254)
  identifier: string;

  @ApiProperty({ minLength: 1, maxLength: passwordLength.max, example: 'correct horse battery' })
  @IsString()
  @Length(1, passwordLength.max)
  password: string;
}

export class CodeDto {
  @ApiProperty(codeDoc)
  @Transform(trim)
  @Matches(/^\d{6}$/, { message: 'code must be 6 digits' })
  code: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ format: 'email', example: 'ada@example.com' })
  @Transform(lowerTrim)
  @IsEmail()
  email: string;
}

export class ResetPasswordDto {
  @ApiProperty({ format: 'email', example: 'ada@example.com' })
  @Transform(lowerTrim)
  @IsEmail()
  email: string;

  @ApiProperty(codeDoc)
  @Transform(trim)
  @Matches(/^\d{6}$/, { message: 'code must be 6 digits' })
  code: string;

  @ApiProperty(passwordDoc)
  @IsString()
  @Length(passwordLength.min, passwordLength.max)
  password: string;
}

export class PhoneDto {
  @ApiProperty({
    description: 'Mobile number in international format, or local format for your business country.',
    minLength: 6,
    maxLength: 20,
    example: '+2348012345678',
  })
  @Transform(trim)
  @IsString()
  @Length(6, 20)
  phone: string;
}
