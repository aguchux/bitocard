import { createHmac, timingSafeEqual } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/errors/api-error.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { PrismaService } from '../database/prisma.service.js';
import { contrastProblem, defaultTheme, themeColorKeys, themePresets, type ThemeColors } from './theme.js';

/** The one theme row (the product's own; each product runs on its own database). */
const themeKey = 'site';
const previewLifetimeMs = 30 * 60_000;

type StoredTheme = { preset: string | null; colors: ThemeColors };

const invalid = (code: string, message: string, param: string) => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', code, message, param);

function readStored(value: unknown): StoredTheme | null {
  if (!value || typeof value !== 'object') return null;
  const stored = value as Partial<StoredTheme>;
  const colors = stored.colors as Partial<ThemeColors> | undefined;
  if (!colors || !themeColorKeys.every(key => typeof colors[key] === 'string')) return null;
  return { preset: typeof stored.preset === 'string' ? stored.preset : null, colors: colors as ThemeColors };
}

const present = (theme: StoredTheme) => ({ preset: theme.preset, colors: theme.colors });

/**
 * The product's colour theme (docs/UDOZO_SPINOFF_PLAN.md, step 3): the admins save a draft (a ready-made theme or their
 * own colours, each checked for readable contrast), preview it with a 30-minute link, then publish it. Every app reads
 * the published theme (`GET /v1/theme`, cached) and applies it as its colour variables. Until something is published,
 * the default theme (BitoCard's navy and pink) applies.
 */
@Injectable()
export class ThemeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** The theme the apps show: the published one, or the draft through a valid preview link. */
  async current(previewToken?: string) {
    const row = await this.prisma.siteTheme.findUnique({ where: { key: themeKey } });
    if (previewToken !== undefined && !this.verifyPreview(previewToken)) {
      throw new ApiError(HttpStatus.UNAUTHORIZED, 'authentication_error', 'preview_expired', 'This preview link has expired. Open a new one from the admin app.');
    }
    const theme = (previewToken !== undefined ? readStored(row?.draft) : readStored(row?.published)) ?? { preset: defaultTheme.key, colors: defaultTheme.colors };
    return { object: 'theme' as const, ...present(theme), version: row?.version ?? 0, preview: previewToken !== undefined };
  }

  /** Admins: the draft, what is live, and the ready-made themes. */
  async get() {
    const row = await this.prisma.siteTheme.findUnique({ where: { key: themeKey } });
    const published = readStored(row?.published);
    return {
      object: 'theme_settings' as const,
      draft: present(readStored(row?.draft) ?? { preset: defaultTheme.key, colors: defaultTheme.colors }),
      published: published ? present(published) : null,
      version: row?.version ?? 0,
      published_at: row?.publishedAt ?? null,
      presets: themePresets.map(preset => ({ key: preset.key, name: preset.name, colors: preset.colors })),
    };
  }

  /** Admins: saves the draft, from a ready-made theme or the admin's own colours (never both), checked for contrast. */
  async saveDraft(actorId: string | null, input: { preset?: string; colors?: Partial<ThemeColors> }) {
    if ((input.preset === undefined) === (input.colors === undefined)) throw invalid('parameter_invalid', 'Choose a ready-made theme or set your own colours.', 'preset');
    let theme: StoredTheme;
    if (input.preset !== undefined) {
      const preset = themePresets.find(item => item.key === input.preset);
      if (!preset) throw invalid('parameter_invalid', 'Choose one of the ready-made themes.', 'preset');
      theme = { preset: preset.key, colors: { ...preset.colors } };
    } else {
      const colors = input.colors ?? {};
      const missing = themeColorKeys.find(key => typeof colors[key] !== 'string');
      if (missing) throw invalid('parameter_missing', `Set the ${missing} colour.`, `colors.${missing}`);
      theme = { preset: null, colors: Object.fromEntries(themeColorKeys.map(key => [key, colors[key]!.toLowerCase()])) as ThemeColors };
    }
    const problem = contrastProblem(theme.colors);
    if (problem) throw invalid('theme_contrast', problem.message, `colors.${problem.param}`);
    const before = await this.prisma.siteTheme.findUnique({ where: { key: themeKey } });
    const row = await this.prisma.siteTheme.upsert({
      where: { key: themeKey },
      create: { key: themeKey, draft: theme, updatedById: actorId },
      update: { draft: theme, updatedById: actorId },
    });
    await this.audit.record({ actorId, action: 'theme.draft_saved', targetType: 'theme', targetId: themeKey, before: before?.draft ?? null, after: row.draft });
    return this.get();
  }

  /** Admins: makes the draft the live theme, as the next version. */
  async publish(actorId: string | null) {
    const row = await this.prisma.siteTheme.findUnique({ where: { key: themeKey } });
    const draft = readStored(row?.draft);
    if (!row || !draft) throw invalid('theme_draft_missing', 'Save a theme first.', 'draft');
    // Checked again: what is published must be readable, whatever was saved before the rules changed.
    const problem = contrastProblem(draft.colors);
    if (problem) throw invalid('theme_contrast', problem.message, `colors.${problem.param}`);
    const updated = await this.prisma.siteTheme.update({
      where: { key: themeKey },
      data: { published: draft, version: { increment: 1 }, publishedAt: new Date(), publishedById: actorId },
    });
    await this.audit.record({ actorId, action: 'theme.published', targetType: 'theme', targetId: themeKey, before: row.published ?? null, after: updated.published });
    return this.get();
  }

  /** Admins: a link that shows the draft for 30 minutes, signed so it cannot be forged. */
  previewToken(now = Date.now()) {
    const expires = now + previewLifetimeMs;
    return { object: 'theme_preview' as const, token: `${expires}.${this.sign(expires)}`, expires_at: new Date(expires).toISOString() };
  }

  private verifyPreview(token: string, now = Date.now()) {
    const [expiresText, signature] = token.split('.');
    const expires = Number(expiresText);
    if (!Number.isFinite(expires) || expires < now || !signature) return false;
    const expected = this.sign(expires);
    return signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  }

  private sign(expires: number) {
    const key = this.config.ENCRYPTION_KEY;
    if (!key) throw new Error('ENCRYPTION_KEY is not configured');
    return createHmac('sha256', key).update(`theme-preview:${expires}`).digest('base64url');
  }
}
