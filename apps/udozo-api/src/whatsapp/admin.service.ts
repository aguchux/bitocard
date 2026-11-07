import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { ProviderError } from '../payments/provider-error.js';
import { WhatsappCloud, whatsappConfigured, whatsappDigits } from './cloud-api.js';
import { e164 } from './contacts.service.js';
import { templateLanguage, templateNames, templateSubmission, whatsappTemplates, type TemplateName } from './templates.js';

const dayMs = 86_400_000;

const unavailable = () => new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'api_error', 'whatsapp_not_configured', 'Set up WhatsApp in Settings > Integrations first.');
const metaProblem = (error: unknown) =>
  new ApiError(HttpStatus.BAD_GATEWAY, 'api_error', 'whatsapp_unreachable', `Meta did not answer: ${error instanceof Error ? error.message.replace(/^whatsapp: /, '') : 'unknown error'}.`);

/** Udozo's admin Site > WhatsApp. */
@Injectable()
export class WhatsappAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
    private readonly audit: AuditService,
  ) {}

  private cloud() {
    return new WhatsappCloud(this.integrations.config);
  }

  /** The number as Meta sees it, and the last 7 days: contacts, messages in and out, and the failed sends. */
  async overview(now = new Date()) {
    const config = this.integrations.config;
    let number: { name: string | null; display: string | null; quality: string | null; error: string | null } | null = null;
    if (whatsappConfigured(config)) {
      try {
        const reply = await this.cloud().phoneNumber();
        number = { name: reply.verified_name ?? null, display: reply.display_phone_number ?? null, quality: reply.quality_rating ?? null, error: null };
      } catch (error) {
        number = { name: null, display: null, quality: null, error: error instanceof ProviderError ? error.message.replace(/^whatsapp: /, '') : 'Meta did not answer.' };
      }
    }
    const since = new Date(now.getTime() - 7 * dayMs);
    const [contacts, linked, optedOut, inbound, outbound, failed, recentFailures] = await Promise.all([
      this.prisma.whatsappContact.count(),
      this.prisma.whatsappContact.count({ where: { customerId: { not: null } } }),
      this.prisma.whatsappContact.count({ where: { optedOutAt: { not: null } } }),
      this.prisma.whatsappMessage.count({ where: { direction: 'in', createdAt: { gt: since } } }),
      this.prisma.whatsappMessage.groupBy({ by: ['status'], where: { direction: 'out', createdAt: { gt: since } }, _count: { _all: true } }),
      this.prisma.whatsappMessage.count({ where: { direction: 'out', status: 'failed', createdAt: { gt: since } } }),
      this.prisma.whatsappMessage.findMany({ where: { direction: 'out', status: 'failed', createdAt: { gt: since } }, orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, kind: true, template: true, error: true, createdAt: true, contact: { select: { waId: true } } } }),
    ]);
    return {
      object: 'whatsapp_overview' as const,
      configured: whatsappConfigured(config),
      number: whatsappDigits(config) ? `+${whatsappDigits(config)}` : null,
      meta: number,
      contacts: { total: contacts, linked, opted_out: optedOut },
      week: {
        received: inbound,
        sent: Object.fromEntries(outbound.map(row => [row.status, row._count._all])),
        failed,
      },
      failures: recentFailures.map(row => ({ id: row.id, kind: row.kind, template: row.template, error: row.error, phone: `${e164(row.contact.waId).slice(0, -4)}••••`, created_at: row.createdAt.toISOString() })),
    };
  }

  /** Udozo's templates beside Meta's: approved, pending, rejected (with why) or not submitted yet. */
  async templates() {
    if (!whatsappConfigured(this.integrations.config) || !this.integrations.config.WHATSAPP_BUSINESS_ACCOUNT_ID?.trim()) throw unavailable();
    let remote: Awaited<ReturnType<WhatsappCloud['templates']>>;
    try {
      remote = await this.cloud().templates();
    } catch (error) {
      throw metaProblem(error);
    }
    return {
      object: 'list' as const,
      data: templateNames.map(name => {
        const found = remote.find(item => item.name === name && item.language === templateLanguage);
        return { object: 'whatsapp_template' as const, name, purpose: whatsappTemplates[name].purpose, body: whatsappTemplates[name].body, button: whatsappTemplates[name].button, language: templateLanguage, status: found ? found.status.toLowerCase() : 'not_submitted', rejected_reason: found?.rejected_reason ?? null };
      }),
    };
  }

  /** Submits the templates Meta does not have (or the one named) for its approval. */
  async submitTemplates(actorId: string | null, name?: string) {
    if (name && !(templateNames as string[]).includes(name)) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', 'No such template.', 'name');
    const current = await this.templates();
    const missing = current.data.filter(item => (name ? item.name === name : item.status === 'not_submitted') && item.status !== 'approved' && item.status !== 'pending');
    const submitted: string[] = [];
    const failed: Array<{ name: string; error: string }> = [];
    for (const item of missing) {
      try {
        await this.cloud().createTemplate(templateSubmission(item.name as TemplateName));
        submitted.push(item.name);
      } catch (error) {
        failed.push({ name: item.name, error: error instanceof Error ? error.message.replace(/^whatsapp: /, '') : 'unknown error' });
      }
    }
    await this.audit.record({ actorId, action: 'whatsapp.templates_submitted', targetType: 'integration', targetId: 'whatsapp', before: null, after: { submitted, failed: failed.map(item => item.name) } });
    return { object: 'whatsapp_template_submission' as const, submitted, failed, templates: (await this.templates()).data };
  }

  /** A number's contact: whether it is linked, opted in or out, and its last messages (never what they said). */
  async contact(phone: string) {
    const waId = phone.replace(/\D/g, '');
    const contact = await this.prisma.whatsappContact.findUnique({
      where: { waId },
      include: { customer: { select: { id: true, name: true, email: true } }, messages: { orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, direction: true, kind: true, template: true, status: true, error: true, createdAt: true } } },
    });
    if (!contact) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'This number has not written to Udozo.');
    return {
      object: 'whatsapp_contact' as const,
      id: contact.id,
      phone: e164(contact.waId),
      country: contact.country,
      customer: contact.customer,
      linked_at: contact.linkedAt?.toISOString() ?? null,
      opted_in_at: contact.optedInAt?.toISOString() ?? null,
      opted_out_at: contact.optedOutAt?.toISOString() ?? null,
      unreachable_at: contact.unreachableAt?.toISOString() ?? null,
      last_inbound_at: contact.lastInboundAt?.toISOString() ?? null,
      flow: contact.flow,
      messages: contact.messages.map(message => ({ ...message, created_at: message.createdAt.toISOString(), createdAt: undefined })),
    };
  }

  /** Stops Udozo writing to a number (they can still send START). */
  async optOut(actorId: string | null, id: string, reason: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such contact.');
    const contact = await this.prisma.whatsappContact.findUnique({ where: { id } });
    if (!contact) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such contact.');
    await this.prisma.whatsappContact.update({ where: { id }, data: { optedOutAt: new Date(), flow: null, flowUpdatedAt: null } });
    await this.audit.record({ actorId, action: 'whatsapp.contact_opted_out', targetType: 'whatsapp_contact', targetId: id, before: { opted_out: Boolean(contact.optedOutAt) }, after: { opted_out: true, reason } });
    return this.contact(contact.waId);
  }
}
