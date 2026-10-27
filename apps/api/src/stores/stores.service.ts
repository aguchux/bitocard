import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/errors/api-error.js';
import { CountriesService } from '../countries/countries.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { bankAccountCoolingOffMs } from '../payouts/payouts.service.js';
import { type LedgerMode, Prisma, type Reseller, type Store } from '../generated/prisma/client.js';
import { reservedSubdomains } from './reserved.js';
import { StoreHostsService } from './store-hosts.service.js';
import { designFor, storeTemplates, templateFor, type StoreTemplate } from './templates.js';
import { planFeatureRequired, planIncludes, PlanAccessService } from '../plans/plan-access.js';

export { reservedSubdomains };

/** Stores a reseller can run, each with its own template, address, branding and domains. */
/** The default store limit; each plan sets its own (`stores` in `planLimitCatalogue`). */
export const maxStoresPerReseller = 5;

const subdomainFormat = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/;

const missing = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such store.');

/** Why a subdomain cannot be used, or null if it is free. */
export function subdomainProblem(subdomain: string) {
  if (!subdomainFormat.test(subdomain) || subdomain.includes('--')) {
    return 'Use 3 to 30 lower-case letters, numbers or single hyphens, starting and ending with a letter or number.';
  }
  if (reservedSubdomains.has(subdomain)) return 'This name is reserved.';
  return null;
}

/** The store's look: its template, variant and theme, with the variant's style and the theme's colours (the store's own primary and accent win). */
export function storeDesign(store: Pick<Store, 'template' | 'variant' | 'theme' | 'primaryColor' | 'accentColor'>) {
  const { template, variant, theme } = designFor(store.template, store.variant, store.theme);
  return {
    template: template.key,
    variant: variant.key,
    theme: theme.key,
    style: variant.style,
    colors: { ...theme.colors, primary: store.primaryColor, accent: store.accentColor },
  };
}

export function presentStore(store: Store) {
  const { template, variant, theme } = designFor(store.template, store.variant, store.theme);
  return {
    object: 'store' as const,
    id: store.id,
    name: store.name,
    subdomain: store.subdomain,
    url: `https://${store.subdomain}.bitocard.com`,
    status: store.status,
    branding: { logo_url: store.logoUrl, primary_color: store.primaryColor, accent_color: store.accentColor },
    /** The store's template (what it sells), design variant and colour theme. */
    template: template.key,
    variant: variant.key,
    theme: theme.key,
    /** Single product stores: the product key it sells; otherwise null. */
    focus: template.single ? store.focus : null,
    home: { version: store.homeVersion || null, published_at: store.homePublishedAt?.toISOString() ?? null },
    checkout_mode: store.checkoutMode,
    /** The account app's menu on desktop: `rail`, `bottom`, or null to follow BitoCard's default. */
    desktop_nav: store.desktopNav,
    ai_overage: store.aiOverage,
    /** Customers are asked for the identity check where BitoCard's market rules require it (true), or never. */
    customer_verification: store.customerVerification,
    published_at: store.publishedAt?.toISOString() ?? null,
    created_at: store.createdAt.toISOString(),
  };
}

export type StoreInput = {
  name?: string;
  subdomain?: string;
  logo_url?: string | null;
  primary_color?: string;
  accent_color?: string;
  checkout_mode?: LedgerMode;
  desktop_nav?: 'rail' | 'bottom' | null;
  ai_overage?: 'stop' | 'pay';
  customer_verification?: boolean;
  template?: string;
  variant?: string;
  theme?: string;
  focus?: string | null;
};

const invalid = (code: string, message: string, param: string) => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', code, message, param);

export type DesktopNav = 'rail' | 'bottom';

/**
 * The customer account app's menu on desktop for a store: the store's own choice, else BitoCard's switch for its
 * reseller (reseller, then country, then global), else the side rail.
 */
export async function desktopNavFor(settings: SettingsService, store: Pick<Store, 'desktopNav' | 'resellerId'>): Promise<DesktopNav> {
  if (store.desktopNav === 'rail' || store.desktopNav === 'bottom') return store.desktopNav;
  return (await settings.isOn('customer_app_bottom_bar_desktop', store.resellerId)) ? 'bottom' : 'rail';
}

/**
 * Whether a store's Crypto tab hands its customers over to BitoCard Crypto (crypto.bitocard.com): only BitoCard's own
 * stores, once BitoCard Crypto is live (`crypto_app` at the global level). Resellers' stores keep their own Crypto tab.
 */
export async function cryptoSiteFor(settings: SettingsService, store: { reseller: Pick<Reseller, 'house'> }): Promise<boolean> {
  return store.reseller.house && (await settings.isOnGlobally('crypto_app'));
}

/**
 * Whether a store asks shoppers to install bitocard.com as an app: only BitoCard's own stores (root bitocard.com and
 * each market's country store, whose house account resolves the market's `storefront_install_prompt`, root's the
 * global one), never a reseller's, whose site is installed under BitoCard's name.
 */
export async function installPromptFor(settings: SettingsService, store: Pick<Store, 'resellerId'> & { reseller: Pick<Reseller, 'house'> }): Promise<boolean> {
  return store.reseller.house && (await settings.isOn('storefront_install_prompt', store.resellerId));
}

/** Hosted storefronts on <subdomain>.bitocard.com, and the reseller's business details. */
@Injectable()
export class StoresService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly countries: CountriesService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly hosts: StoreHostsService,
    private readonly planAccess: PlanAccessService,
  ) {}

  /** Business name, and the country if it is not yet set (Google sign-ups choose it during onboarding). */
  async updateReseller(resellerId: string, input: { name?: string; country?: string }) {
    const reseller = await this.prisma.reseller.findUniqueOrThrow({ where: { id: resellerId } });
    if (input.country) {
      const country = input.country.toUpperCase();
      if (reseller.country && reseller.country !== country) {
        throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'country_locked', 'Your business country is set. Contact support to change it.', 'country');
      }
      await this.countries.assertSignupOpen(country);
    }
    const updated = await this.prisma.reseller.update({ where: { id: resellerId }, data: { name: input.name, country: input.country?.toUpperCase() } });
    // Payout accounts may match the business name, so a rename after verification restarts every account's 24-hour wait:
    // a stolen session cannot rename the business to match its own account and withdraw at once.
    if (input.name !== undefined && input.name !== reseller.name && reseller.verifiedAt) {
      await this.prisma.bankAccount.updateMany({
        where: { resellerId, mode: 'live', removedAt: null },
        data: { payoutsFrom: new Date(Date.now() + bankAccountCoolingOffMs) },
      });
    }
    return { object: 'reseller' as const, id: updated.id, name: updated.name, country: updated.country, status: updated.status };
  }

  async availability(subdomain: string) {
    const name = subdomain.toLowerCase();
    const problem = subdomainProblem(name) ?? ((await this.prisma.store.findUnique({ where: { subdomain: name } })) ? 'This name is taken.' : null);
    return { object: 'subdomain_availability' as const, subdomain: name, available: problem === null, reason: problem };
  }

  async create(resellerId: string, input: Required<Pick<StoreInput, 'name' | 'subdomain'>> & StoreInput) {
    const reseller = await this.prisma.reseller.findUniqueOrThrow({ where: { id: resellerId }, include: { stores: true, plan: true } });
    if (!reseller.country) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'country_required', 'Set your business country before creating a store.');
    }
    // A second store needs a plan with several stores.
    if (reseller.stores.length >= 1 && !planIncludes(reseller, 'multiple_stores')) throw planFeatureRequired('multiple_stores', reseller.plan.name);
    await this.planAccess.requireRoom(resellerId, 'stores', reseller.stores.length, { code: 'store_limit_reached', param: 'name' });
    const design = await this.chooseDesign(resellerId, { template: input.template ?? 'all_in_one', variant: input.variant, theme: input.theme, focus: input.focus ?? null });
    const subdomain = await this.assertSubdomain(input.subdomain);
    try {
      const store = await this.prisma.store.create({
        data: {
          resellerId,
          name: input.name,
          subdomain,
          logoUrl: input.logo_url ?? null,
          template: design.template.key,
          variant: design.variant.key,
          theme: design.theme.key,
          focus: design.focus,
          // The theme's colours, unless the reseller chose their own.
          primaryColor: input.primary_color?.toLowerCase() ?? design.theme.colors.primary,
          accentColor: input.accent_color?.toLowerCase() ?? design.theme.colors.accent,
        },
      });
      // Its address on bitocard.com is set up at once (DNS and HTTPS take a few minutes), so it is ready by publishing.
      await this.hosts.sync(store.id);
      return presentStore(store);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw taken();
      throw error;
    }
  }

  async list(resellerId: string) {
    const stores = await this.prisma.store.findMany({ where: { resellerId }, orderBy: { createdAt: 'asc' } });
    return { object: 'list' as const, data: stores.map(presentStore) };
  }

  async get(resellerId: string, id: string) {
    const store = await this.prisma.store.findFirst({ where: { id, resellerId } });
    if (!store) throw missing();
    return store;
  }

  /**
   * Branding and name can change any time; the subdomain only while the store is a draft. Checkout goes live only for a
   * verified (active) business; until then the store's customers buy in the sandbox.
   */
  async update(resellerId: string, id: string, input: StoreInput) {
    const store = await this.get(resellerId, id);
    if (input.checkout_mode === 'live' && store.checkoutMode !== 'live') {
      const reseller = await this.prisma.reseller.findUniqueOrThrow({ where: { id: resellerId } });
      if (reseller.status !== 'active') {
        throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'reseller_not_verified', 'Your store can take real payments once your business is verified. Use test checkout until then.', 'checkout_mode');
      }
    }
    // A new template starts from its variant's home page (SHQ asks first); a new variant or theme keeps the page.
    const templateChanged = input.template !== undefined && input.template !== store.template;
    const variantChanged = input.variant !== undefined && input.variant !== store.variant;
    const designChanged = templateChanged || variantChanged || (input.theme !== undefined && input.theme !== store.theme) || input.focus !== undefined;
    const design = designChanged
      ? await this.chooseDesign(resellerId, {
          template: input.template ?? store.template,
          variant: input.variant ?? (templateChanged ? undefined : store.variant),
          theme: input.theme ?? (templateChanged || variantChanged ? undefined : store.theme),
          focus: input.focus !== undefined ? input.focus : store.focus,
        }, store.template)
      : null;
    const themeChanged = Boolean(design && design.theme.key !== store.theme);
    let subdomain: string | undefined;
    if (input.subdomain && input.subdomain.toLowerCase() !== store.subdomain) {
      if (store.status !== 'draft') {
        throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'subdomain_locked', 'Unpublish the store before changing its address.', 'subdomain');
      }
      subdomain = await this.assertSubdomain(input.subdomain);
    }
    try {
      const updated = await this.prisma.store.update({
        where: { id },
        data: {
          name: input.name,
          subdomain,
          logoUrl: input.logo_url,
          // A new theme brings its colours, unless the reseller sends their own.
          primaryColor: input.primary_color?.toLowerCase() ?? (themeChanged ? design!.theme.colors.primary : undefined),
          accentColor: input.accent_color?.toLowerCase() ?? (themeChanged ? design!.theme.colors.accent : undefined),
          ...(design ? { template: design.template.key, variant: design.variant.key, theme: design.theme.key, focus: design.focus } : {}),
          ...(templateChanged ? { homeDraft: Prisma.DbNull, homePublished: Prisma.DbNull } : {}),
          checkoutMode: input.checkout_mode,
          desktopNav: input.desktop_nav,
          aiOverage: input.ai_overage,
          customerVerification: input.customer_verification,
          ...(subdomain ? { hostStatus: 'pending' } : {}),
        },
      });
      if (subdomain) await this.hosts.sync(id);
      return presentStore(updated);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw taken();
      throw error;
    }
  }

  /** Puts the store live. Paid checkout still needs funding and verification (later milestones). */
  async publish(resellerId: string, id: string) {
    const store = await this.get(resellerId, id);
    if (store.status === 'suspended') {
      throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'store_suspended', 'This store has been suspended. Contact support.');
    }
    const reseller = await this.prisma.reseller.findUniqueOrThrow({ where: { id: resellerId }, include: { members: { include: { user: true } } } });
    if (reseller.status === 'suspended') {
      throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'reseller_suspended', 'Your account is suspended. Contact support.');
    }
    const owner = reseller.members.find(member => member.role === 'owner');
    if (!owner?.user.emailVerifiedAt) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'email_verification_required', 'Confirm your email address before publishing.');
    }
    const updated = await this.prisma.store.update({ where: { id }, data: { status: 'published', publishedAt: store.publishedAt ?? new Date() } });
    return presentStore(updated);
  }

  async unpublish(resellerId: string, id: string) {
    const store = await this.get(resellerId, id);
    if (store.status === 'suspended') return presentStore(store);
    return presentStore(await this.prisma.store.update({ where: { id }, data: { status: 'draft' } }));
  }

  /** Public: what the storefront app needs to render a published store. */
  async storefront(subdomain: string) {
    const store = await this.prisma.store.findUnique({ where: { subdomain: subdomain.toLowerCase() }, include: { reseller: { include: { countryRef: true } } } });
    if (!store || store.status !== 'published' || store.reseller.status === 'suspended') throw missing();
    return {
      object: 'storefront' as const,
      name: store.name,
      subdomain: store.subdomain,
      branding: { logo_url: store.logoUrl, primary_color: store.primaryColor, accent_color: store.accentColor },
      design: storeDesign(store),
      focus: templateFor(store.template)?.single ? store.focus : null,
      country: store.reseller.country,
      currency: store.reseller.countryRef?.currency ?? null,
      checkout_mode: store.checkoutMode,
      /** bitocard.com's own retail arm in this market (`docs/BITOCARD_COUNTRY_STORES_PLAN.md`), never a reseller's. */
      house: store.reseller.house,
      /** The store's plan has Your brand only: its pages leave BitoCard's name out. */
      white_label: await this.planAccess.storeHas(store.id, 'white_label'),
      app: { desktop_nav: await desktopNavFor(this.settings, store), install_prompt: await installPromptFor(this.settings, store), crypto_site: await cryptoSiteFor(this.settings, store) },
      domain: (await this.prisma.storeDomain.findFirst({ where: { storeId: store.id, status: 'active', primary: true }, select: { name: true } }))?.name ?? null,
    };
  }

  /** Admin: suspend a store (or return it to draft). */
  async adminSetStatus(actorId: string | null, id: string, status: 'suspended' | 'draft') {
    const before = await this.prisma.store.findUnique({ where: { id } });
    if (!before) throw missing();
    const after = await this.prisma.store.update({ where: { id }, data: { status } });
    await this.audit.record({ actorId, action: `store.${status}`, targetType: 'store', targetId: id, before, after });
    return presentStore(after);
  }

  /**
   * Whether a template is open to the reseller, and why not: its admin switch (`store_template_<key>`, on by default),
   * for the crypto desk their exchange or P2P switched on, and for the Resale shop
   * their `reseller_resale` switch and a verified account.
   */
  async templateAvailability(resellerId: string, template: StoreTemplate) {
    if (!(await this.settings.isOn(`store_template_${template.key}`, resellerId))) return { available: false, reason: 'BitoCard does not offer this template for your stores at the moment.' };
    if (template.resale) {
      // B2B reselling: the reseller's own switch and a verified account (the resale catalogue checks the rest).
      if (!(await this.settings.isOn('reseller_resale', resellerId))) return { available: false, reason: 'Reselling BitoCard Shop listings is not open to your account yet.' };
      const reseller = await this.prisma.reseller.findUnique({ where: { id: resellerId }, select: { status: true } });
      return reseller?.status === 'active' ? { available: true, reason: null } : { available: false, reason: 'Finish your identity check to open a Resale shop.' };
    }
    // Crypto has left BitoCard (docs/CRYPTO_SPINOFF_PLAN.md): the crypto desk is never offered again.
    if (template.crypto) return { available: false, reason: 'The crypto desk is no longer offered.' };
    return { available: true, reason: null };
  }

  /** Every template, its variants and themes, and whether each is open to the reseller (the crypto desk left with crypto). */
  async templates(resellerId: string) {
    return {
      object: 'list' as const,
      data: await Promise.all(
        storeTemplates.filter(template => !template.crypto).map(async template => ({
          object: 'store_template' as const,
          key: template.key,
          name: template.name,
          tagline: template.tagline,
          description: template.description,
          categories: template.categories,
          single_product: template.single,
          crypto: template.crypto,
          resale: Boolean(template.resale),
          sections: template.sections,
          ...(await this.templateAvailability(resellerId, template)),
          variants: template.variants.map(variant => ({
            key: variant.key,
            name: variant.name,
            description: variant.description,
            style: variant.style,
            themes: variant.themes.map(theme => ({ key: theme.key, name: theme.name, colors: theme.colors })),
          })),
        })),
      ),
    };
  }

  /** Checks a template, variant, theme and (single product stores) the product, all of which must exist and be open. */
  private async chooseDesign(resellerId: string, input: { template: string; variant?: string; theme?: string; focus: string | null }, current?: string) {
    const template = templateFor(input.template);
    if (!template) throw invalid('template_unknown', 'Choose one of the store templates.', 'template');
    // A store keeps the template it has (its design and colours can still change); only choosing one is checked.
    const { available, reason } = template.key === current ? { available: true, reason: null } : await this.templateAvailability(resellerId, template);
    if (!available) throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'template_unavailable', reason ?? 'This template is not available.', 'template');
    if (input.variant !== undefined && !template.variants.some(item => item.key === input.variant)) throw invalid('variant_unknown', `Choose one of the ${template.name} designs.`, 'variant');
    const { variant, theme } = designFor(template.key, input.variant);
    const chosenTheme = input.theme !== undefined ? variant.themes.find(item => item.key === input.theme) : theme;
    if (!chosenTheme) throw invalid('theme_unknown', `Choose one of the ${variant.name} colour themes.`, 'theme');
    let focus: string | null = null;
    if (template.single) {
      if (!input.focus) throw invalid('focus_required', 'Choose the product this store sells.', 'focus');
      const listed = await this.prisma.resellerListing.findFirst({ where: { resellerId, product: { key: input.focus, active: true } } });
      if (!listed) throw invalid('focus_not_listed', 'List this product in your catalogue first, then choose it for the store.', 'focus');
      focus = input.focus;
    }
    return { template, variant, theme: chosenTheme, focus };
  }

  private async assertSubdomain(raw: string) {
    const { subdomain, available, reason } = await this.availability(raw);
    if (!available) {
      throw reason === 'This name is taken.' ? taken() : new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'subdomain_invalid', reason ?? 'Invalid name.', 'subdomain');
    }
    return subdomain;
  }
}

function taken() {
  return new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'subdomain_taken', 'This name is taken.', 'subdomain');
}
