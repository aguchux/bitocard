import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { houseRootId } from '../checkout/house.service.js';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { InboxService } from '../notifications/inbox.service.js';
import { ProviderError } from '../payments/provider-error.js';
import { AiService } from './ai/ai.service.js';
import { GithubIssues, withoutPersonalData } from './github.js';
import { ticketReference } from './tickets.service.js';

const notFound = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such ticket.');
const conflict = (code: string, message: string) => new ApiError(HttpStatus.CONFLICT, 'conflict_error', code, message);

/**
 * Escalating a ticket to engineering: BitoCard's operations open a GitHub issue (drafted from the ticket by BitoCard's
 * AI when one is set up, else from a template), with no personal data. The ticket shows the issue; when GitHub says it
 * was closed (or reopened), the ticket comes back to BitoCard to confirm the fix with the requester.
 */
@Injectable()
export class EngineeringService {
  private readonly logger = new Logger('SupportEngineering');

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
    private readonly ai: AiService,
    private readonly inbox: InboxService,
    private readonly audit: AuditService,
  ) {}

  github() {
    const config = this.integrations.config;
    return new GithubIssues({ token: config.GITHUB_TOKEN as string | undefined, repo: config.GITHUB_REPO as string | undefined, baseUrl: String(config.GITHUB_API_URL ?? 'https://api.github.com') });
  }

  /** A draft issue for the admin to edit: written by BitoCard's AI from the ticket, or a template when no AI is set up. */
  async draft(ticketId: string) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId }, include: { messages: { where: { draft: false }, orderBy: { createdAt: 'asc' } } } });
    if (!ticket) throw notFound();
    const conversation = ticket.messages.map(message => `${message.author}: ${withoutPersonalData(message.body)}`).join('\n').slice(0, 8000);
    const fallback = {
      title: withoutPersonalData(ticket.subject).slice(0, 120),
      body: ['## What happened', withoutPersonalData(ticket.messages[0]?.body ?? ticket.subject), '', '## Steps to reproduce', '1. ', '', '## Expected', '', '## Actual', '', `## Area\n${ticket.category}`, '', `Mode: ${ticket.mode}`].join('\n'),
      drafted_by: 'template' as const,
    };
    const model = this.ai.bitocardModels()[0];
    if (!model) return fallback;
    try {
      const reply = await this.ai.reply(
        { funding: 'bitocard', provider: model.provider, model: model.model, resellerId: houseRootId, storeId: null, botId: null, mode: 'live', kind: 'generate' },
        {
          system: 'You write GitHub issues for BitoCard engineers from support tickets. Output a first line "TITLE: <a short title>", then a Markdown body with the sections What happened, Steps to reproduce, Expected, Actual and Area. Never include names, emails, phone numbers, codes or account numbers.',
          messages: [{ role: 'user', content: `Ticket ${ticketReference(ticket.number)} (${ticket.category}): ${withoutPersonalData(ticket.subject)}\n\n${conversation}` }],
          maxTokens: 900,
        },
      );
      const text = withoutPersonalData(reply.text ?? '');
      const match = /^TITLE:\s*(.+)$/m.exec(text);
      if (!match) return fallback;
      return { title: match[1].trim().slice(0, 120), body: text.replace(match[0], '').trim(), drafted_by: 'ai' as const };
    } catch (error) {
      this.logger.warn({ err: error }, 'Could not draft an issue with AI; using the template');
      return fallback;
    }
  }

  /** Opens the issue (redacted again on the way out) and links it to the ticket. */
  async escalate(actorId: string | null, ticketId: string, input: { title: string; body: string; kind: 'bug' | 'feature' }) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw notFound();
    if (ticket.githubIssueNumber) throw conflict('ticket_has_issue', `This ticket is already issue #${ticket.githubIssueNumber}.`);
    const github = this.github();
    if (!github.configured()) throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'api_error', 'github_not_configured', 'Set up Engineering (GitHub) in Settings > Integrations first.');
    let issue: { number: number; html_url: string; state: string };
    try {
      issue = await github.createIssue({
        title: withoutPersonalData(input.title).slice(0, 200),
        body: `${withoutPersonalData(input.body).slice(0, 20000)}\n\n---\nFrom BitoCard support ticket ${ticketReference(ticket.number)}. No personal data is included: look the ticket up in the admin app.`,
        labels: ['support', input.kind],
      });
    } catch (error) {
      if (error instanceof ProviderError && error.definite) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'github_refused', `GitHub refused the issue: ${error.message.replace(/^github: /, '')}`);
      throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'api_error', 'github_unreachable', 'GitHub could not be reached. Try again in a moment.');
    }
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.supportTicket.update({ where: { id: ticketId }, data: { githubIssueNumber: issue.number, githubIssueUrl: issue.html_url, githubIssueState: issue.state, githubRepo: github.repo, engineeringAt: now, lastMessageAt: now } }),
      this.prisma.supportTicketMessage.createMany({
        data: [
          { ticketId, author: 'system', body: 'We have passed this to our engineers. We will update you here.', visibility: 'all', createdAt: now },
          { ticketId, author: 'system', body: `Engineering issue #${issue.number}: ${issue.html_url}`, visibility: 'staff', createdAt: new Date(now.getTime() + 1) },
        ],
      }),
    ]);
    await this.audit.record({ actorId, action: 'support_ticket.github_issue', targetType: 'support_ticket', targetId: ticketId, before: null, after: { issue: issue.number, repo: github.repo } });
    if (ticket.requester === 'customer') await this.inbox.reseller(ticket.resellerId, 'support.ticket_updated', { subject: `${ticketId}:issue`, title: `BitoCard passed ${ticketReference(ticket.number)} to its engineers`, body: ticket.subject, link: `/support/${ticketId}`, mode: ticket.mode });
    return { number: issue.number, url: issue.html_url, state: issue.state };
  }

  /**
   * GitHub's `issues` notifications for the repository: a closed issue sends its ticket back to BitoCard to confirm the
   * fix with the requester; a reopened one says so. Other events, repositories and unknown issues are ignored.
   */
  async notice(event: string | undefined, payload: { action?: string; issue?: { number?: number; state?: string; state_reason?: string | null }; repository?: { full_name?: string } }) {
    if (event !== 'issues' || !payload.issue?.number || !['closed', 'reopened'].includes(payload.action ?? '')) return 'ignored';
    const ticket = await this.prisma.supportTicket.findFirst({ where: { githubIssueNumber: payload.issue.number, githubRepo: payload.repository?.full_name ?? '' } });
    if (!ticket) return 'unknown';
    const closed = payload.action === 'closed';
    if (ticket.githubIssueState === (closed ? 'closed' : 'open')) return 'unchanged';
    const now = new Date();
    const fixed = closed && payload.issue.state_reason !== 'not_planned';
    await this.prisma.$transaction([
      this.prisma.supportTicket.update({ where: { id: ticket.id }, data: { githubIssueState: closed ? 'closed' : 'open', ...(closed ? { status: 'open', resolvedAt: null } : {}), lastMessageAt: now } }),
      this.prisma.supportTicketMessage.create({
        data: { ticketId: ticket.id, author: 'system', visibility: 'staff', createdAt: now, body: closed ? `Engineering closed issue #${payload.issue.number}${fixed ? ' as done' : ' as not planned'}: confirm with the requester and resolve the ticket.` : `Engineering reopened issue #${payload.issue.number}.` },
      }),
    ]);
    if (closed) {
      await this.inbox.admins('admin.support.issue_closed', { subject: `${ticket.id}:${payload.issue.number}:${now.getTime()}`, title: `Issue #${payload.issue.number} closed: ${ticketReference(ticket.number)}`, body: 'Confirm the fix with the requester, then resolve the ticket.', link: `/support/${ticket.id}`, mode: ticket.mode });
    }
    return closed ? 'closed' : 'reopened';
  }
}
