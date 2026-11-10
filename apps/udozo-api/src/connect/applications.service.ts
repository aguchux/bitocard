import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { StoreSellers } from '../checkout/store-sellers.js';
import { ApiError } from '../common/errors/api-error.js';
import type { CustomerWithStore } from '../customers/customers.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma, type LedgerMode } from '../generated/prisma/client.js';
import { IdentityService } from '../identity/identity.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { MediaService } from '../media/media.service.js';
import { AccountNotices } from '../notifications/account-notices.service.js';
import { InboxService } from '../notifications/inbox.service.js';
import { SettingsService } from '../settings/settings.service.js';

/** The Connect Centre agreement people accept before they submit (on udozo.com): bump it when they must accept again. */
export const connectAgreementVersion = '2026-11-09';
export const connectAgreementPath = '/legal/connect-centres';
/** Where an applicant follows their application: a udozo.com address that sends them on to connect.udozo.com. */
export const applicationPath = '/connect/application';

export const applicationNumber = (number: number) => `CA-${String(number).padStart(6, '0')}`;
export const centreNumber = (number: number) => `CC-${String(number).padStart(6, '0')}`;

export const applicationStatuses = ['draft', 'submitted', 'changes_requested', 'visit_scheduled', 'visited', 'approved', 'rejected', 'withdrawn'] as const;
export type ApplicationStatus = (typeof applicationStatuses)[number];
/** Still under way: one at a time per customer. */
const openStatuses: ApplicationStatus[] = ['draft', 'submitted', 'changes_requested', 'visit_scheduled', 'visited'];
/** What the applicant can still change. */
const editableStatuses: ApplicationStatus[] = ['draft', 'changes_requested'];
/** What Udozo's team can still decide. */
const reviewableStatuses: ApplicationStatus[] = ['submitted', 'changes_requested', 'visit_scheduled', 'visited'];

export const photoKinds = ['shopfront', 'counter', 'storage', 'other'] as const;
export type PhotoKind = (typeof photoKinds)[number];
/** The photos every application needs: the shopfront, the counter and where items are kept. */
const requiredPhotoKinds: PhotoKind[] = ['shopfront', 'counter', 'storage'];
export const maxPhotos = 12;

export type ApplicationInput = {
  business_name?: string | null;
  registration_number?: string | null;
  area_id?: string | null;
  address?: string | null;
  landmark?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  hours?: string | null;
  phone?: string | null;
  capacity?: number | null;
  person_name?: string | null;
  person_role?: string | null;
};

const invalid = (code: string, message: string, param?: string) => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', code, message, param);
const conflict = (code: string, message: string, param?: string) => new ApiError(HttpStatus.CONFLICT, 'conflict_error', code, message, param);
const notFound = (what = 'application') => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', `No such ${what}.`);
const changed = () => conflict('application_changed', 'This application changed: refresh and try again.');

const include = {
  state: { select: { id: true, name: true, slug: true } },
  area: { select: { id: true, name: true, slug: true } },
  photos: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] },
  visitor: true,
  centre: { select: { id: true, number: true, status: true } },
} satisfies Prisma.ConnectCentreApplicationInclude;
type ApplicationRow = Prisma.ConnectCentreApplicationGetPayload<{ include: typeof include }>;

/** A short line of text: spaces tidied, within its length, or null when empty. */
function text(value: string | null | undefined, param: string, min: number, max: number, what: string) {
  if (value === undefined) return undefined;
  const cleaned = (value ?? '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  if (cleaned.length < min || cleaned.length > max) throw invalid('parameter_invalid', `${what} must be ${min} to ${max} characters.`, param);
  if (/https?:\/\/|www\./i.test(cleaned)) throw invalid('parameter_invalid', `${what} cannot hold a link.`, param);
  return cleaned;
}

const money = (minor: bigint | null) => (minor === null ? null : Number(minor));

/**
 * Applications to run a Connect Centre (docs/UDOZO_CONNECT_PLAN.md, phase 2). A Udozo customer fills one in on
 * connect.udozo.com (their office, its hours and photos, the person in charge), meets the requirements (a passed identity
 * check whatever `customer_identity_check` says, a confirmed mobile, the Connect Centre agreement, the market's deposit in
 * their UdozoPay wallet) and submits it, which takes the deposit into their own `connect_centre_deposit` account. Udozo's
 * team reviews it online, asks for changes, schedules a visit by its staff or a trained agent, records the visit, then
 * approves it (it becomes a centre) or rejects it (the deposit goes back); the applicant can withdraw it while it is
 * under way (the deposit goes back too). Behind `connect_applications`, per market, with each state open unless
 * switched off.
 */
@Injectable()
export class ConnectApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly stores: StoreSellers,
    private readonly identity: IdentityService,
    private readonly ledger: LedgerService,
    private readonly media: MediaService,
    private readonly inbox: InboxService,
    private readonly notices: AccountNotices,
    private readonly audit: AuditService,
  ) {}

  // ---- Context ----

  private country(customer: CustomerWithStore) {
    if (!customer.country) throw conflict('country_required', 'Choose your country on your Udozo account first.', 'country');
    return customer.country;
  }

  async open(country: string) {
    return this.settings.isOnForCountry('connect_applications', country);
  }

  private async requireOpen(country: string) {
    if (!(await this.open(country))) throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'connect_unavailable', 'Connect Centre applications are not open in your country yet.');
  }

  private async market(country: string) {
    const [row, settings] = await Promise.all([
      this.prisma.country.findUniqueOrThrow({ where: { code: country }, select: { currency: true, name: true } }),
      this.prisma.connectSettings.findUnique({ where: { country } }),
    ]);
    return { currency: row.currency, name: row.name, depositMinor: settings?.depositMinor ?? null };
  }

  /** The states of a market and whether each takes applications (open unless an admin switched it off). */
  async states(country: string) {
    const [states, closed] = await Promise.all([
      this.prisma.classifiedArea.findMany({ where: { country, kind: 'state', enabled: true }, orderBy: [{ position: 'asc' }, { name: 'asc' }], select: { id: true, name: true, slug: true } }),
      this.prisma.connectState.findMany({ where: { country, enabled: false }, select: { stateId: true } }),
    ]);
    const off = new Set(closed.map(row => row.stateId));
    return states.map(state => ({ id: state.id, name: state.name, slug: state.slug, open: !off.has(state.id) }));
  }

  private async stateOpen(stateId: string) {
    const row = await this.prisma.connectState.findUnique({ where: { stateId } });
    return row?.enabled ?? true;
  }

  private async agreed(customerId: string) {
    return (await this.prisma.connectAgreementAcceptance.findUnique({ where: { customerId_version: { customerId, version: connectAgreementVersion } } })) !== null;
  }

  /** Whether the customer passed the identity check: in the sandbox, as for UdozoPay, everyone has. */
  private async identityChecked(customer: CustomerWithStore) {
    const mode = this.stores.mode(customer.store);
    if (mode === 'test') return { mode, checked: true };
    const house = await this.stores.sellerFor(customer);
    return { mode, checked: await this.identity.isCustomerVerified(house.id, mode, customer.id) };
  }

  private async walletBalance(customerId: string, mode: LedgerMode, currency: string) {
    const account = await this.prisma.ledgerAccount.findFirst({ where: { kind: 'customer_wallet', customerId, mode, currency }, select: { balanceMinor: true } });
    return account?.balanceMinor ?? 0n;
  }

  // ---- Applicants ----

  /** What applying needs in the customer's market, and their application under way (if any). */
  async applySettings(customer: CustomerWithStore) {
    const country = this.country(customer);
    const [open, market, states, accepted, current] = await Promise.all([
      this.open(country),
      this.market(country),
      this.states(country),
      this.agreed(customer.id),
      this.prisma.connectCentreApplication.findFirst({ where: { customerId: customer.id, status: { in: openStatuses } }, select: { id: true } }),
    ]);
    return {
      object: 'connect_apply_settings' as const,
      country,
      open,
      deposit: market.depositMinor === null ? null : { amount: Number(market.depositMinor), currency: market.currency },
      states,
      agreement: { version: connectAgreementVersion, path: connectAgreementPath, accepted },
      photos: { kinds: photoKinds, required: requiredPhotoKinds, max: maxPhotos },
      application_id: current?.id ?? null,
    };
  }

  async acceptAgreement(customer: CustomerWithStore, version: string) {
    if (version !== connectAgreementVersion) throw conflict('agreement_changed', 'The Connect Centre agreement has changed: read it again, then accept it.', 'version');
    await this.prisma.connectAgreementAcceptance.upsert({
      where: { customerId_version: { customerId: customer.id, version } },
      create: { customerId: customer.id, version },
      update: {},
    });
    return { object: 'connect_agreement' as const, version, path: connectAgreementPath, accepted: true };
  }

  async list(customer: CustomerWithStore) {
    const rows = await this.prisma.connectCentreApplication.findMany({ where: { customerId: customer.id }, include, orderBy: { createdAt: 'desc' }, take: 20 });
    return { object: 'list' as const, data: rows.map(row => this.present(row)) };
  }

  async get(customer: CustomerWithStore, id: string) {
    const row = await this.own(customer, id);
    return this.presentWithRequirements(customer, row);
  }

  private async own(customer: CustomerWithStore, id: string) {
    const row = await this.prisma.connectCentreApplication.findUnique({ where: { id }, include });
    if (!row || row.customerId !== customer.id) throw notFound();
    return row;
  }

  async create(customer: CustomerWithStore, input: ApplicationInput) {
    const country = this.country(customer);
    await this.requireOpen(country);
    const current = await this.prisma.connectCentreApplication.findFirst({ where: { customerId: customer.id, status: { in: openStatuses } }, select: { id: true } });
    if (current) throw conflict('application_open', 'You already have an application under way: carry on with it.', 'application_id');
    const market = await this.market(country);
    const data = await this.fields(country, input);
    try {
      const row = await this.prisma.connectCentreApplication.create({ data: { customerId: customer.id, country, currency: market.currency, ...data } as Prisma.ConnectCentreApplicationUncheckedCreateInput, include });
      return this.presentWithRequirements(customer, row);
    } catch (error) {
      // Two at once: the partial unique index lets one through.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw conflict('application_open', 'You already have an application under way: carry on with it.', 'application_id');
      throw error;
    }
  }

  async update(customer: CustomerWithStore, id: string, input: ApplicationInput) {
    const row = await this.own(customer, id);
    if (!editableStatuses.includes(row.status as ApplicationStatus)) throw conflict('application_locked', 'This application cannot be changed now.');
    const data = await this.fields(row.country, input);
    const updated = await this.prisma.connectCentreApplication.updateMany({ where: { id, status: { in: editableStatuses } }, data: data as Prisma.ConnectCentreApplicationUncheckedUpdateManyInput });
    if (!updated.count) throw changed();
    return this.presentWithRequirements(customer, await this.own(customer, id));
  }

  /** The columns a request changes, each checked; the area decides the state. */
  private async fields(country: string, input: ApplicationInput) {
    const data: Record<string, unknown> = {};
    const set = (key: string, value: unknown) => {
      if (value !== undefined) data[key] = value;
    };
    set('businessName', text(input.business_name, 'business_name', 2, 120, 'The business name'));
    set('registrationNumber', text(input.registration_number, 'registration_number', 3, 40, 'The registration number'));
    set('address', text(input.address, 'address', 10, 300, 'The address'));
    set('landmark', text(input.landmark, 'landmark', 3, 120, 'The landmark'));
    set('hours', text(input.hours, 'hours', 3, 200, 'The opening hours'));
    set('personName', text(input.person_name, 'person_name', 2, 80, "The person in charge's name"));
    set('personRole', text(input.person_role, 'person_role', 2, 60, 'Their role'));
    if (input.phone !== undefined) {
      const phone = (input.phone ?? '').replace(/[\s()-]/g, '');
      if (phone && !/^\+?\d{7,15}$/.test(phone)) throw invalid('parameter_invalid', "Give the office's phone number, digits only.", 'phone');
      data.phone = phone || null;
    }
    if (input.capacity !== undefined) {
      const capacity = input.capacity;
      if (capacity !== null && (!Number.isInteger(capacity) || capacity < 1 || capacity > 100_000)) throw invalid('parameter_invalid', 'Say how many items the office can hold: a whole number from 1.', 'capacity');
      data.capacity = capacity;
    }
    for (const [key, limit] of [['latitude', 90], ['longitude', 180]] as const) {
      const value = input[key];
      if (value === undefined) continue;
      if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > limit)) throw invalid('parameter_invalid', 'Give the map position in degrees.', key);
      data[key] = value === null ? null : new Prisma.Decimal(value.toFixed(6));
    }
    if (input.area_id !== undefined) {
      if (input.area_id === null) Object.assign(data, { areaId: null, stateId: null });
      else {
        const area = await this.prisma.classifiedArea.findFirst({ where: { id: input.area_id, country, kind: 'area', enabled: true }, select: { id: true, parentId: true } });
        if (!area) throw invalid('parameter_invalid', 'Choose an area in your country.', 'area_id');
        Object.assign(data, { areaId: area.id, stateId: area.parentId });
      }
    }
    return data;
  }

  // ---- Photos ----

  private actor(customer: CustomerWithStore) {
    return { realm: 'person' as const, userId: customer.id, owner: 'customers' as const };
  }

  private async editable(customer: CustomerWithStore, id: string) {
    const row = await this.own(customer, id);
    if (!editableStatuses.includes(row.status as ApplicationStatus)) throw conflict('application_locked', 'This application cannot be changed now.');
    return row;
  }

  /** A signed link to send a photo of the office to storage (10 minutes): PUT it there, then `addPhoto` it. */
  async startPhoto(customer: CustomerWithStore, id: string, input: { filename: string; content_type: string; size: number }) {
    const row = await this.editable(customer, id);
    if (row.photos.length >= maxPhotos) throw conflict('too_many_photos', `An application can have at most ${maxPhotos} photos.`);
    return this.media.createUpload(this.actor(customer), { ...input, purpose: 'connect_photo' });
  }

  async addPhoto(customer: CustomerWithStore, id: string, mediaId: string, kind: PhotoKind) {
    const row = await this.editable(customer, id);
    if (row.photos.length >= maxPhotos) throw conflict('too_many_photos', `An application can have at most ${maxPhotos} photos.`);
    if (row.photos.some(photo => photo.mediaId === mediaId)) return this.presentWithRequirements(customer, row);
    // Only an office photo of this person's: never another of their uploads.
    const upload = await this.prisma.mediaAsset.findUnique({ where: { id: mediaId }, select: { purpose: true } });
    if (!upload || upload.purpose !== 'connect_photo') throw notFound('upload');
    const asset = await this.media.complete(this.actor(customer), mediaId);
    await this.prisma.connectApplicationPhoto.create({ data: { applicationId: id, mediaId, url: asset.url, kind, position: row.photos.length } });
    return this.presentWithRequirements(customer, await this.own(customer, id));
  }

  async removePhoto(customer: CustomerWithStore, id: string, photoId: string) {
    const row = await this.editable(customer, id);
    const photo = row.photos.find(item => item.id === photoId);
    if (!photo) throw notFound('photo');
    await this.prisma.connectApplicationPhoto.delete({ where: { id: photoId } });
    await this.media.discardFile(photo.mediaId).catch(() => undefined);
    return this.presentWithRequirements(customer, await this.own(customer, id));
  }

  // ---- Requirements and submitting ----

  /** Everything submitting needs, each met or not, in the order the applicant puts them right. */
  private async requirements(customer: CustomerWithStore, row: ApplicationRow) {
    const market = await this.market(row.country);
    const [{ mode, checked }, accepted, stateOpen] = await Promise.all([this.identityChecked(customer), this.agreed(customer.id), row.stateId ? this.stateOpen(row.stateId) : Promise.resolve(true)]);
    const details = Boolean(row.businessName && row.areaId && row.address && row.hours && row.phone && row.capacity && row.personName);
    const kinds = new Set(row.photos.map(photo => photo.kind));
    const balance = row.depositPaidAt ? null : await this.walletBalance(customer.id, mode, row.currency);
    const deposit = market.depositMinor;
    return [
      { key: 'details', met: details, label: 'Your business, office, opening hours, phone, capacity and the person in charge' },
      { key: 'photos', met: requiredPhotoKinds.every(kind => kinds.has(kind)), label: 'Photos of the shopfront, the counter and where items are kept' },
      { key: 'state', met: stateOpen, label: 'An office in a state where Connect is open' },
      { key: 'identity', met: checked, label: 'Your identity check' },
      { key: 'mobile', met: customer.phoneVerifiedAt !== null, label: 'A confirmed mobile number' },
      { key: 'agreement', met: accepted, label: 'The Connect Centre agreement' },
      {
        key: 'deposit',
        met: row.depositPaidAt !== null || (deposit !== null && balance !== null && balance >= deposit),
        label: deposit === null ? 'The deposit (not set in your country yet)' : 'The deposit in your UdozoPay wallet',
      },
    ];
  }

  async submit(customer: CustomerWithStore, id: string, expectedDeposit?: number) {
    const row = await this.own(customer, id);
    if (!editableStatuses.includes(row.status as ApplicationStatus)) throw conflict('application_locked', 'This application has already been sent.');
    await this.requireOpen(row.country);
    const unmet = (await this.requirements(customer, row)).find(item => !item.met);
    if (unmet) throw invalid('application_incomplete', `Still needed: ${unmet.label.charAt(0).toLowerCase()}${unmet.label.slice(1)}.`, unmet.key);
    const market = await this.market(row.country);
    const mode = this.stores.mode(customer.store);
    const now = new Date();
    const first = row.depositPaidAt === null;
    const deposit = first ? market.depositMinor! : row.depositMinor!;
    if (first && expectedDeposit !== undefined && BigInt(expectedDeposit) !== deposit) throw conflict('deposit_changed', 'The deposit has changed: check it, then send your application again.', 'expected_deposit');
    const entry =
      first && deposit > 0n
        ? await this.ledger.prepare({
            mode,
            type: 'connect_deposit',
            reference: `connect_deposit:${id}:paid`,
            description: `Connect Centre deposit for ${applicationNumber(row.number)}`,
            lines: [
              { account: { kind: 'customer_wallet', currency: row.currency, customerId: customer.id }, debit: deposit },
              { account: { kind: 'connect_centre_deposit', currency: row.currency, customerId: customer.id }, credit: deposit },
            ],
          })
        : null;
    await this.prisma.$transaction(async tx => {
      const claimed = await tx.connectCentreApplication.updateMany({
        where: { id, status: row.status },
        data: {
          status: 'submitted',
          submittedAt: now,
          agreementVersion: connectAgreementVersion,
          ...(first ? { depositMinor: deposit, depositMode: mode, depositPaidAt: now } : {}),
        },
      });
      if (!claimed.count) throw changed();
      // The wallet's own check refuses it when the balance moved since (insufficient_funds), and nothing is sent.
      if (entry) await this.ledger.write(tx, entry);
    });
    const resubmitted = row.status === 'changes_requested';
    await this.inbox.admins('admin.connect.application', {
      subject: `connect_application:${id}:${now.getTime()}`,
      title: resubmitted ? 'A Connect Centre application was sent back with changes' : 'A new Connect Centre application',
      body: `${applicationNumber(row.number)}: ${row.businessName}, ${row.address}.`,
      link: `/connect/applications/${id}`,
    });
    this.tell(row, 'We have your application', resubmitted ? 'Thank you for the changes. Our team will review your application again.' : 'Thank you for applying to be a Udozo Connect Centre. Our team will review it and arrange a visit to your office.');
    return this.get(customer, id);
  }

  /** The applicant stops their application while it is under way: the deposit, if paid, goes back to their wallet. */
  async withdraw(customer: CustomerWithStore, id: string) {
    const row = await this.own(customer, id);
    if (!openStatuses.includes(row.status as ApplicationStatus)) throw conflict('application_closed', 'This application has already ended.');
    await this.close(row, 'withdrawn', {});
    this.tell(row, 'You withdrew your application', row.depositPaidAt ? 'Your application has stopped and your deposit is back in your UdozoPay wallet.' : 'Your application has stopped.');
    return this.get(customer, id);
  }

  async confirmVisit(customer: CustomerWithStore, id: string) {
    const row = await this.own(customer, id);
    if (row.status !== 'visit_scheduled') throw conflict('visit_not_scheduled', 'No visit is waiting for your answer.');
    const updated = await this.prisma.connectCentreApplication.updateMany({ where: { id, status: 'visit_scheduled', visitAt: row.visitAt }, data: { visitConfirmedAt: new Date(), visitRescheduleNote: null } });
    if (!updated.count) throw changed();
    return this.get(customer, id);
  }

  async rescheduleVisit(customer: CustomerWithStore, id: string, note: string) {
    const row = await this.own(customer, id);
    if (row.status !== 'visit_scheduled') throw conflict('visit_not_scheduled', 'No visit is waiting for your answer.');
    const cleaned = text(note, 'note', 3, 300, 'When suits you');
    if (!cleaned) throw invalid('parameter_missing', 'Say when suits you instead.', 'note');
    const updated = await this.prisma.connectCentreApplication.updateMany({ where: { id, status: 'visit_scheduled', visitAt: row.visitAt }, data: { visitConfirmedAt: null, visitRescheduleNote: cleaned } });
    if (!updated.count) throw changed();
    await this.inbox.admins('admin.connect.application', {
      subject: `connect_application:${id}:reschedule:${Date.now()}`,
      title: 'An applicant asked for another visit time',
      body: `${applicationNumber(row.number)}: ${cleaned}`,
      link: `/connect/applications/${id}`,
    });
    return this.get(customer, id);
  }

  // ---- Udozo's team ----

  async adminList(filter: { status?: string; country?: string; q?: string; limit?: number; offset?: number }) {
    const q = filter.q?.trim();
    const number = q && /^(ca-?)?\d+$/i.test(q) ? Number(q.replace(/^ca-?/i, '')) : null;
    const where: Prisma.ConnectCentreApplicationWhereInput = {
      ...(filter.status ? { status: filter.status } : { status: { not: 'draft' } }),
      ...(filter.country ? { country: filter.country } : {}),
      ...(q
        ? {
            OR: [
              ...(number !== null ? [{ number }] : []),
              { businessName: { contains: q, mode: 'insensitive' as const } },
              { customer: { email: { contains: q, mode: 'insensitive' as const } } },
              { customer: { name: { contains: q, mode: 'insensitive' as const } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.connectCentreApplication.findMany({ where, include, orderBy: [{ submittedAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }], take: filter.limit ?? 50, skip: filter.offset ?? 0 }),
      this.prisma.connectCentreApplication.count({ where }),
    ]);
    const customers = await this.prisma.customer.findMany({ where: { id: { in: rows.map(row => row.customerId) } }, select: { id: true, name: true, email: true } });
    const byId = new Map(customers.map(item => [item.id, item]));
    return { object: 'list' as const, total, data: rows.map(row => ({ ...this.present(row, true), applicant: byId.get(row.customerId) ?? null })) };
  }

  async adminGet(id: string) {
    const row = await this.prisma.connectCentreApplication.findUnique({ where: { id }, include });
    if (!row) throw notFound();
    const customer = await this.prisma.customer.findUniqueOrThrow({ where: { id: row.customerId }, include: { store: { include: { reseller: { select: { house: true } } } } } });
    const { checked } = await this.identityChecked(customer as CustomerWithStore);
    return {
      ...this.present(row, true),
      applicant: {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        phone_confirmed: customer.phoneVerifiedAt !== null,
        identity_checked: checked,
        since: customer.createdAt.toISOString(),
      },
      requirements: await this.requirements(customer as CustomerWithStore, row),
    };
  }

  private async reviewable(id: string, allowed: ApplicationStatus[] = reviewableStatuses) {
    const row = await this.prisma.connectCentreApplication.findUnique({ where: { id }, include });
    if (!row) throw notFound();
    if (!allowed.includes(row.status as ApplicationStatus)) throw conflict('application_not_reviewable', `This application is ${row.status.replace(/_/g, ' ')}: that cannot be done now.`);
    return row;
  }

  async requestChanges(adminId: string | null, id: string, note: string) {
    const row = await this.reviewable(id, ['submitted', 'visit_scheduled', 'visited']);
    const cleaned = text(note, 'note', 3, 1000, 'What to change');
    if (!cleaned) throw invalid('parameter_missing', 'Say what the applicant should change.', 'note');
    const updated = await this.prisma.connectCentreApplication.updateMany({ where: { id, status: row.status }, data: { status: 'changes_requested', changesNote: cleaned, changesAt: new Date() } });
    if (!updated.count) throw changed();
    await this.audit.record({ actorId: adminId, action: 'connect_application.changes_requested', targetType: 'connect_application', targetId: id, before: { status: row.status }, after: { status: 'changes_requested', note: cleaned } });
    this.tell(row, 'Please update your application', `Our team asks you to change something before we carry on: ${cleaned}`);
    return this.adminGet(id);
  }

  async scheduleVisit(adminId: string | null, id: string, input: { visitor_id: string; at: string; note?: string | null }) {
    const row = await this.reviewable(id, ['submitted', 'visit_scheduled', 'visited']);
    const visitor = await this.prisma.connectVisitor.findUnique({ where: { id: input.visitor_id } });
    if (!visitor || !visitor.active || visitor.country !== row.country) throw invalid('parameter_invalid', 'Choose an active visitor in the applicant’s country.', 'visitor_id');
    if (visitor.kind === 'agent' && !visitor.trainedAt) throw invalid('visitor_untrained', 'This agent has not finished Udozo’s training yet.', 'visitor_id');
    const at = new Date(input.at);
    if (Number.isNaN(at.getTime()) || at.getTime() < Date.now()) throw invalid('parameter_invalid', 'Choose a time in the future for the visit.', 'at');
    const note = text(input.note, 'note', 3, 500, 'The note') ?? null;
    const updated = await this.prisma.connectCentreApplication.updateMany({
      where: { id, status: row.status },
      data: { status: 'visit_scheduled', visitorId: visitor.id, visitAt: at, visitNote: note, visitConfirmedAt: null, visitRescheduleNote: null, visitedAt: null, visitPassed: null, visitReport: null },
    });
    if (!updated.count) throw changed();
    await this.audit.record({ actorId: adminId, action: 'connect_application.visit_scheduled', targetType: 'connect_application', targetId: id, before: { status: row.status }, after: { status: 'visit_scheduled', visitor_id: visitor.id, at: at.toISOString() } });
    this.tell(row, 'We will visit your office', `${visitor.name} from Udozo will visit on ${at.toUTCString().replace(/:\d\d GMT$/, ' GMT')}. Confirm the time, or say what suits you better, on your application.${note ? ` ${note}` : ''}`);
    return this.adminGet(id);
  }

  async recordVisit(adminId: string | null, id: string, input: { passed: boolean; report: string }) {
    const row = await this.reviewable(id, ['visit_scheduled']);
    const report = text(input.report, 'report', 3, 2000, 'The report');
    if (!report) throw invalid('parameter_missing', 'Write what the visitor found.', 'report');
    const updated = await this.prisma.connectCentreApplication.updateMany({ where: { id, status: 'visit_scheduled' }, data: { status: 'visited', visitedAt: new Date(), visitPassed: input.passed, visitReport: report } });
    if (!updated.count) throw changed();
    await this.audit.record({ actorId: adminId, action: 'connect_application.visited', targetType: 'connect_application', targetId: id, before: { status: row.status }, after: { status: 'visited', passed: input.passed } });
    this.tell(row, 'We visited your office', 'Thank you for having us. Our team will be in touch with the outcome soon.');
    return this.adminGet(id);
  }

  /** Approves a visited, passed application: it becomes a centre run by the applicant, holding the deposit they paid. */
  async approve(adminId: string | null, id: string) {
    const row = await this.reviewable(id, ['visited']);
    if (!row.visitPassed) throw conflict('visit_not_passed', 'The visit did not pass: schedule another visit, or reject the application.');
    if (!row.depositPaidAt || row.depositReturnedAt) throw conflict('deposit_missing', 'The deposit has not been paid.');
    if (!row.businessName || !row.stateId || !row.areaId || !row.address || !row.hours || !row.phone || !row.capacity) throw conflict('application_incomplete', 'The application is missing details: ask the applicant for changes.');
    const now = new Date();
    const centre = await this.prisma.$transaction(async tx => {
      const made = await tx.connectCentre.create({
        data: {
          partnerId: row.customerId,
          country: row.country,
          stateId: row.stateId!,
          areaId: row.areaId!,
          name: row.businessName!,
          address: row.address!,
          landmark: row.landmark,
          latitude: row.latitude,
          longitude: row.longitude,
          hours: row.hours!,
          phone: row.phone!,
          capacity: row.capacity!,
          depositMinor: row.depositMinor ?? 0n,
          currency: row.currency,
          photos: row.photos.map(photo => photo.url),
        },
      });
      const claimed = await tx.connectCentreApplication.updateMany({ where: { id, status: 'visited' }, data: { status: 'approved', decidedAt: now, decidedById: adminId, centreId: made.id } });
      if (!claimed.count) throw changed();
      // The partner who applied is its owner on connect.udozo.com.
      await tx.connectCentreMember.create({ data: { centreId: made.id, customerId: row.customerId, role: 'owner' } });
      return made;
    });
    await this.audit.record({ actorId: adminId, action: 'connect_application.approved', targetType: 'connect_application', targetId: id, before: { status: row.status }, after: { status: 'approved', centre_id: centre.id } });
    this.tell(row, 'You are a Udozo Connect Centre', `Welcome! ${row.businessName} is now Connect Centre ${centreNumber(centre.number)}. You will run it on connect.udozo.com.`);
    return this.adminGet(id);
  }

  async reject(adminId: string | null, id: string, reason: string) {
    const row = await this.reviewable(id);
    const cleaned = text(reason, 'reason', 3, 1000, 'The reason');
    if (!cleaned) throw invalid('parameter_missing', 'Say why the application is rejected.', 'reason');
    await this.close(row, 'rejected', { decidedAt: new Date(), decidedById: adminId, rejectReason: cleaned });
    await this.audit.record({ actorId: adminId, action: 'connect_application.rejected', targetType: 'connect_application', targetId: id, before: { status: row.status }, after: { status: 'rejected', reason: cleaned } });
    this.tell(row, 'Your application was not approved', `${cleaned}${row.depositPaidAt ? ' Your deposit is back in your UdozoPay wallet.' : ''}`);
    return this.adminGet(id);
  }

  /** Ends an application under way (rejected or withdrawn), returning a paid deposit in the same transaction. */
  private async close(row: ApplicationRow, status: 'rejected' | 'withdrawn', data: Prisma.ConnectCentreApplicationUncheckedUpdateManyInput) {
    const now = new Date();
    const refund = row.depositPaidAt && !row.depositReturnedAt && row.depositMinor && row.depositMinor > 0n;
    const entry = refund
      ? await this.ledger.prepare({
          mode: row.depositMode as LedgerMode,
          type: 'connect_deposit_return',
          reference: `connect_deposit:${row.id}:returned`,
          description: `Connect Centre deposit returned for ${applicationNumber(row.number)}`,
          lines: [
            { account: { kind: 'connect_centre_deposit', currency: row.currency, customerId: row.customerId }, debit: row.depositMinor! },
            { account: { kind: 'customer_wallet', currency: row.currency, customerId: row.customerId }, credit: row.depositMinor! },
          ],
        })
      : null;
    await this.prisma.$transaction(async tx => {
      const claimed = await tx.connectCentreApplication.updateMany({
        where: { id: row.id, status: row.status },
        data: { ...data, status, ...(status === 'withdrawn' ? { withdrawnAt: now } : {}), ...(refund ? { depositReturnedAt: now } : {}) },
      });
      if (!claimed.count) throw changed();
      if (entry) await this.ledger.write(tx, entry);
    });
  }

  /** Tells the applicant (inbox, push and email), never failing the change. */
  private tell(row: { id: string; customerId: string; number: number }, title: string, body: string) {
    void this.prisma.customer
      .findUnique({ where: { id: row.customerId }, select: { storeId: true } })
      .then(customer =>
        customer
          ? this.inbox.customer({ customerId: row.customerId, storeId: customer.storeId }, 'customer.connect.application', {
              subject: `connect_application:${row.id}:${title}:${Date.now()}`,
              title,
              body,
              link: applicationPath,
            })
          : undefined,
      )
      .catch(() => undefined);
    this.notices.customer(row.customerId, { title, body, path: applicationPath, action: 'See your application' });
  }

  // ---- Presenting ----

  present(row: ApplicationRow, staff = false) {
    return {
      object: 'connect_application' as const,
      id: row.id,
      number: applicationNumber(row.number),
      status: row.status as ApplicationStatus,
      country: row.country,
      business_name: row.businessName,
      registration_number: row.registrationNumber,
      state: row.state ? { id: row.state.id, name: row.state.name } : null,
      area: row.area ? { id: row.area.id, name: row.area.name } : null,
      address: row.address,
      landmark: row.landmark,
      latitude: row.latitude === null ? null : Number(row.latitude),
      longitude: row.longitude === null ? null : Number(row.longitude),
      hours: row.hours,
      phone: row.phone,
      capacity: row.capacity,
      person_name: row.personName,
      person_role: row.personRole,
      photos: row.photos.map(photo => ({ id: photo.id, url: photo.url, kind: photo.kind })),
      deposit: { amount: money(row.depositMinor), currency: row.currency, paid_at: row.depositPaidAt?.toISOString() ?? null, returned_at: row.depositReturnedAt?.toISOString() ?? null },
      submitted_at: row.submittedAt?.toISOString() ?? null,
      changes: row.changesNote ? { note: row.changesNote, at: row.changesAt?.toISOString() ?? null } : null,
      visit: row.visitAt
        ? {
            at: row.visitAt.toISOString(),
            note: row.visitNote,
            visitor: row.visitor ? { name: row.visitor.name, phone: row.visitor.phone, ...(staff ? { id: row.visitor.id, kind: row.visitor.kind } : {}) } : null,
            confirmed_at: row.visitConfirmedAt?.toISOString() ?? null,
            reschedule_note: row.visitRescheduleNote,
            visited_at: row.visitedAt?.toISOString() ?? null,
            // The outcome and report are Udozo's team's until the decision.
            ...(staff ? { passed: row.visitPassed, report: row.visitReport } : {}),
          }
        : null,
      decision: row.decidedAt ? { at: row.decidedAt.toISOString(), reason: row.rejectReason } : null,
      withdrawn_at: row.withdrawnAt?.toISOString() ?? null,
      centre: row.centre ? { id: row.centre.id, number: centreNumber(row.centre.number), status: row.centre.status } : null,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
    };
  }

  private async presentWithRequirements(customer: CustomerWithStore, row: ApplicationRow) {
    const editable = editableStatuses.includes(row.status as ApplicationStatus);
    return { ...this.present(row), editable, requirements: editable ? await this.requirements(customer, row) : null };
  }
}
