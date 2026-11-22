import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { EmailService } from '../notifications/email.service.js';
import { resellerTeamEmail } from '../notifications/templates.js';
import { customEmailKey, paragraphsOf, quickEmails, type ResellerEmailState } from './catalogue.js';

/** The same quick email to the same reseller at most this often, so a double click never sends it twice. */
export const resendAfterMs = 10 * 60_000;
const action = 'reseller.email_sent';

const notFound = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such reseller.');

/** Emails from BitoCard's team to a reseller's owner, from the reseller's page in the admin app. */
@Injectable()
export class ResellerEmailsService {
  private readonly logger = new Logger('ResellerEmails');

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly audit: AuditService,
    private readonly integrations: IntegrationsService,
  ) {}

  private async load(resellerId: string) {
    const reseller = await this.prisma.reseller.findUnique({
      where: { id: resellerId },
      include: { countryRef: { select: { whatsappGroupUrl: true } }, members: { where: { role: 'owner' }, include: { user: { include: { phones: { select: { verifiedAt: true } } } } } } },
    });
    if (!reseller || reseller.house || reseller.platform !== 'bitocard') throw notFound();
    return { reseller, owner: reseller.members[0]?.user ?? null, whatsappGroupUrl: reseller.countryRef?.whatsappGroupUrl ?? null };
  }

  private async state(resellerId: string): Promise<ResellerEmailState> {
    const { reseller, owner, whatsappGroupUrl } = await this.load(resellerId);
    const [stores, publishedStores, listedProducts, liveApiKeys] = await Promise.all([
      this.prisma.store.count({ where: { resellerId } }),
      this.prisma.store.count({ where: { resellerId, status: 'published' } }),
      this.prisma.resellerListing.count({ where: { resellerId } }),
      this.prisma.apiKey.count({ where: { resellerId, mode: 'live', revokedAt: null } }),
    ]);
    return {
      status: reseller.status,
      verified: Boolean(reseller.verifiedAt),
      testAccount: Boolean(reseller.testAccountAt),
      emailConfirmed: Boolean(owner?.emailVerifiedAt),
      mobileConfirmed: Boolean(owner?.phoneVerifiedAt) || Boolean(owner?.phones.length),
      stores,
      publishedStores,
      listedProducts,
      liveApiKeys,
      market: reseller.country,
      whatsappGroup: Boolean(whatsappGroupUrl),
    };
  }

  /** The quick emails with whether each applies now, who they go to, and what was sent lately. */
  async overview(resellerId: string) {
    const { owner } = await this.load(resellerId);
    const state = await this.state(resellerId);
    const sent = await this.prisma.auditLog.findMany({
      where: { action, targetType: 'reseller', targetId: resellerId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    const actorIds = [...new Set(sent.map(entry => entry.actorId).filter((id): id is string => Boolean(id)))];
    const actors = new Map((await this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })).map(user => [user.id, user.name]));
    const lastSent = new Map<string, Date>();
    for (const entry of sent) {
      const key = (entry.after as { template?: string } | null)?.template;
      if (key && !lastSent.has(key)) lastSent.set(key, entry.createdAt);
    }
    return {
      object: 'reseller_emails' as const,
      to: owner ? { name: owner.name, email: owner.email } : null,
      templates: quickEmails.map(email => ({
        key: email.key,
        kind: email.kind,
        label: email.label,
        description: email.description,
        subject: email.subject,
        suggested: email.suggested(state),
        // Gated by market: the WhatsApp group email only where admins set the reseller’s market’s group link.
        available: !email.whatsappGroup || state.whatsappGroup,
        unavailable_reason: email.whatsappGroup && !state.whatsappGroup ? (state.market ? 'No WhatsApp group link is set for this reseller’s market (Settings > Markets).' : 'This reseller has no market yet.') : null,
        last_sent_at: lastSent.get(email.key)?.toISOString() ?? null,
      })),
      sent: sent.map(entry => {
        const after = (entry.after ?? {}) as { template?: string; subject?: string; to?: string };
        return {
          object: 'reseller_email' as const,
          template: after.template ?? null,
          subject: after.subject ?? null,
          to: after.to ?? null,
          sent_by: entry.actorId && actors.has(entry.actorId) ? { name: actors.get(entry.actorId)! } : null,
          sent_at: entry.createdAt.toISOString(),
        };
      }),
    };
  }

  /** Sends a quick email (`template`, with an optional personal note) or a custom one (`subject` and `message`). */
  async send(actorId: string | null, resellerId: string, input: { template: string; subject?: string; message?: string }) {
    const { reseller, owner, whatsappGroupUrl } = await this.load(resellerId);
    if (!owner) throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'no_owner', 'This reseller has no owner to email.');
    const custom = input.template === customEmailKey;
    const template = custom ? null : quickEmails.find(email => email.key === input.template);
    if (!custom && !template) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', 'Choose one of the quick emails, or custom.', 'template');
    const note = paragraphsOf(input.message ?? '');
    if (custom && !input.subject?.trim()) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_missing', 'Give the email a subject.', 'subject');
    if (custom && !note.length) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_missing', 'Write the message.', 'message');

    if (template?.whatsappGroup && !whatsappGroupUrl) {
      throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'whatsapp_group_missing', 'No WhatsApp group link is set for this reseller’s market. Add one in Settings > Markets.', 'template');
    }
    if (template) {
      const recent = await this.prisma.auditLog.findFirst({
        where: { action, targetType: 'reseller', targetId: resellerId, createdAt: { gt: new Date(Date.now() - resendAfterMs) }, after: { path: ['template'], equals: template.key } },
      });
      if (recent) throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'email_recently_sent', 'This email was sent to them in the last 10 minutes.');
    }

    const firstName = owner.name.trim().split(/\s+/)[0] || 'there';
    const dashboard = this.integrations.config.DASHBOARD_URL.replace(/\/+$/, '');
    const subject = template ? template.subject : input.subject!.trim();
    const message = template
      ? resellerTeamEmail(owner.email, {
          subject,
          heading: template.heading,
          paragraphs: [...template.paragraphs({ firstName, business: reseller.name }), ...note],
          link: { label: template.linkLabel, url: template.whatsappGroup ? whatsappGroupUrl! : `${dashboard}${template.path}` },
        })
      : resellerTeamEmail(owner.email, { subject, heading: subject, paragraphs: [`Hi ${firstName},`, ...note], link: { label: 'Open BitoCard SHQ', url: `${dashboard}/` } });
    try {
      await this.email.send(message);
    } catch (error) {
      this.logger.warn({ err: error, resellerId }, 'Could not send a team email');
      throw new ApiError(HttpStatus.BAD_GATEWAY, 'api_error', 'email_failed', 'The email could not be sent. Try again shortly.');
    }
    await this.audit.record({
      actorId,
      action,
      targetType: 'reseller',
      targetId: resellerId,
      after: { template: input.template, subject, to: owner.email, ...(note.length ? { message: note.join('\n\n') } : {}) },
    });
    return this.overview(resellerId);
  }
}
