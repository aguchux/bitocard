import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/errors/api-error.js';
import { CountriesService } from '../countries/countries.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { type LedgerMode, Prisma, type Store } from '../generated/prisma/client.js';

export const maxStoresPerReseller = 1;

/** Names that belong to BitoCard itself and can never be a store's subdomain. */
export const reservedSubdomains = new Set([
  'admin', 'api', 'app', 'apps', 'assets', 'auth', 'billing', 'bitocard', 'blog', 'cdn', 'checkout', 'dashboard', 'dev', 'docs',
  'email', 'ftp', 'golojan', 'help', 'internal', 'legal', 'legals', 'login', 'mail', 'ns1', 'ns2', 'pay', 'payments', 'portal',
  'preview', 'reseller', 'resellers', 'sandbox', 'secure', 'shop', 'signin', 'signup', 'smtp', 'staging', 'static', 'status',
  'store', 'stores', 'support', 'test', 'wallet', 'webhooks', 'www',
]);

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

export function presentStore(store: Store) {
  return {
    object: 'store' as const,
    id: store.id,
    name: store.name,
    subdomain: store.subdomain,
    url: `https://${store.subdomain}.bitocard.com`,
    status: store.status,
    branding: { logo_url: store.logoUrl, primary_color: store.primaryColor, accent_color: store.accentColor },
    checkout_mode: store.checkoutMode,
    /** The account app's menu on desktop: `rail`, `bottom`, or null to follow BitoCard's default. */
    desktop_nav: store.desktopNav,
    published_at: store.publishedAt?.toISOString() ?? null,
    created_at: store.createdAt.toISOString(),
  };
}

export type StoreInput = { name?: string; subdomain?: string; logo_url?: string | null; primary_color?: string; accent_color?: string; checkout_mode?: LedgerMode; desktop_nav?: 'rail' | 'bottom' | null };

export type DesktopNav = 'rail' | 'bottom';

/**
 * The customer account app's menu on desktop for a store: the store's own choice, else BitoCard's switch for its
 * reseller (reseller, then country, then global), else the side rail.
 */
export async function desktopNavFor(settings: SettingsService, store: Pick<Store, 'desktopNav' | 'resellerId'>): Promise<DesktopNav> {
  if (store.desktopNav === 'rail' || store.desktopNav === 'bottom') return store.desktopNav;
  return (await settings.isOn('customer_app_bottom_bar_desktop', store.resellerId)) ? 'bottom' : 'rail';
}

/** Hosted storefronts on <subdomain>.bitocard.com, and the reseller's business details. */
@Injectable()
export class StoresService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly countries: CountriesService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
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
    return { object: 'reseller' as const, id: updated.id, name: updated.name, country: updated.country, status: updated.status };
  }

  async availability(subdomain: string) {
    const name = subdomain.toLowerCase();
    const problem = subdomainProblem(name) ?? ((await this.prisma.store.findUnique({ where: { subdomain: name } })) ? 'This name is taken.' : null);
    return { object: 'subdomain_availability' as const, subdomain: name, available: problem === null, reason: problem };
  }

  async create(resellerId: string, input: Required<Pick<StoreInput, 'name' | 'subdomain'>> & StoreInput) {
    const reseller = await this.prisma.reseller.findUniqueOrThrow({ where: { id: resellerId }, include: { stores: true } });
    if (!reseller.country) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'country_required', 'Set your business country before creating a store.');
    }
    if (reseller.stores.length >= maxStoresPerReseller) {
      throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'store_limit_reached', 'You already have a store.');
    }
    const subdomain = await this.assertSubdomain(input.subdomain);
    try {
      const store = await this.prisma.store.create({
        data: {
          resellerId,
          name: input.name,
          subdomain,
          logoUrl: input.logo_url ?? null,
          primaryColor: input.primary_color?.toLowerCase(),
          accentColor: input.accent_color?.toLowerCase(),
        },
      });
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
          primaryColor: input.primary_color?.toLowerCase(),
          accentColor: input.accent_color?.toLowerCase(),
          checkoutMode: input.checkout_mode,
          desktopNav: input.desktop_nav,
        },
      });
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
      country: store.reseller.country,
      currency: store.reseller.countryRef?.currency ?? null,
      checkout_mode: store.checkoutMode,
      app: { desktop_nav: await desktopNavFor(this.settings, store) },
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
