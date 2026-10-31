import { Body, Controller, Get, Header, HttpCode, HttpStatus, Post, Put, Query } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsOptional, IsString, Matches, MaxLength, ValidateNested } from 'class-validator';
import { AdminRoles, type Caller, CurrentCaller, Public, RealmOnly, StepUp } from '../auth/caller.js';
import { adminId } from '../countries/countries.controller.js';
import { ProductOnly } from '../products/product.js';
import { themePresets } from './theme.js';
import { ThemeService } from './theme.service.js';

const color = () => Matches(/^#[0-9a-fA-F]{6}$/, { message: 'Colours are #rrggbb' });

class ThemeColorsDto {
  @IsOptional() @IsString() @color() primary?: string;
  @IsOptional() @IsString() @color() accent?: string;
  @IsOptional() @IsString() @color() ink?: string;
  @IsOptional() @IsString() @color() page?: string;
}

class ThemeDraftDto {
  @IsOptional() @IsIn(themePresets.map(preset => preset.key)) preset?: string;
  @IsOptional() @ValidateNested() @Type(() => ThemeColorsDto) colors?: ThemeColorsDto;
}

class ThemeQueryDto {
  @IsOptional() @IsString() @MaxLength(200) preview?: string;
}

/** Every app's colour theme, public and cached a minute; `?preview=` shows the draft. */
@ApiExcludeController()
@Public()
@Controller('theme')
@ProductOnly('udozo')
export class ThemeController {
  constructor(private readonly theme: ThemeService) {}

  @Get()
  @Header('Cache-Control', 'public, max-age=60')
  current(@Query() query: ThemeQueryDto) {
    return this.theme.current(query.preview);
  }
}

/** Admins: the product's colour theme (docs/UDOZO_SPINOFF_PLAN.md, step 3). */
@ApiExcludeController()
@RealmOnly('admin')
@Controller('admin/theme')
@ProductOnly('udozo')
export class AdminThemeController {
  constructor(private readonly theme: ThemeService) {}

  @AdminRoles('operations', 'support')
  @Get()
  get() {
    return this.theme.get();
  }

  @AdminRoles('operations')
  @Put('draft')
  saveDraft(@CurrentCaller() caller: Caller, @Body() body: ThemeDraftDto) {
    return this.theme.saveDraft(adminId(caller), body);
  }

  @AdminRoles('operations', 'support')
  @Post('preview')
  @HttpCode(HttpStatus.OK)
  preview() {
    return this.theme.previewToken();
  }

  @AdminRoles('operations')
  @StepUp()
  @Post('publish')
  @HttpCode(HttpStatus.OK)
  publish(@CurrentCaller() caller: Caller) {
    return this.theme.publish(adminId(caller));
  }
}
