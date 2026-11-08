import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { flowIdleMs } from './bot.service.js';
import { WhatsappContactsService } from './contacts.service.js';
import { WhatsappDirect } from './direct.service.js';
import { WhatsappNotices } from './notices.service.js';
import { WhatsappOutbox } from './outbox.service.js';
import { WhatsappSignIns } from './sign-in.service.js';

/** The `whatsapp` job (Udozo, every 5 minutes). */
@Injectable()
export class WhatsappJobs {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notices: WhatsappNotices,
    private readonly outbox: WhatsappOutbox,
    private readonly contacts: WhatsappContactsService,
    private readonly direct: WhatsappDirect,
    private readonly signIns: WhatsappSignIns,
  ) {}

  /** Notices and messages due a retry, menus idle a day reset, and messages, notices, link codes and who got a seller's number past their time deleted. */
  async run(now = new Date()) {
    const notices = await this.notices.runDue(now);
    const messages = await this.outbox.runDue(now);
    const reset = await this.prisma.whatsappContact.updateMany({ where: { flowUpdatedAt: { lt: new Date(now.getTime() - flowIdleMs) } }, data: { flow: null, flowState: Prisma.DbNull, flowUpdatedAt: null } });
    return { notices, messages, flows_reset: reset.count, messages_deleted: await this.outbox.purge(now), link_codes_deleted: await this.contacts.purgeCodes(now), direct_contacts_deleted: await this.direct.purge(now), sign_ins_deleted: await this.signIns.purge(now) };
  }
}
