import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';

/** Contact that moves a trade off Afrippa: links, emails, handles and phone numbers. */
const contactPattern = /https?:\/\/|www\.|\b[\w-]+\.(com|net|org|io|ng|gh|ke|co|me|app|link)\b|\b[\w.+-]+@[\w-]+\.\w+|(?:^|\s)@\w{2,}|(?:\+?\d[\s-]?){10,}/i;

/** Text as words are matched in it: lower case, anything not a letter, number or hyphen a space, padded. */
const words = (text: string) => ` ${text.toLowerCase().replace(/[^\p{L}\p{N}-]+/gu, ' ')} `;

/**
 * Afrippa's refused words (docs/CRYPTO_SPINOFF_PLAN.md, instruments: the lifted moderation): BitoCard Shop's word list,
 * Afrippa's own rows (`platform: afrippa`, refusing only), everywhere or in one market, kept by Afrippa's admins. Ad
 * terms, nicknames and feedback are refused when they carry contact that moves a trade off Afrippa (links, emails,
 * handles, phone numbers) or one of these phrases. The order room is not checked: payment details are given there.
 */
@Injectable()
export class P2pWordsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Refuses `text` (`code`, on `param`) when it carries contact or a refused phrase for `market`. */
  async check(text: string | null | undefined, market: string | null, param: string, code = 'text_refused') {
    if (!text?.trim()) return;
    const refused = () => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', code, 'This cannot carry links, emails, handles, phone numbers or words Afrippa does not allow.', param);
    if (contactPattern.test(text)) throw refused();
    const rows = await this.prisma.classifiedProhibitedWord.findMany({ where: { platform: 'afrippa', OR: [{ country: null }, ...(market ? [{ country: market }] : [])] }, select: { phrase: true } });
    const said = words(text);
    if (rows.some(row => said.includes(words(row.phrase)))) throw refused();
  }

  async list() {
    const rows = await this.prisma.classifiedProhibitedWord.findMany({ where: { platform: 'afrippa' }, orderBy: [{ phrase: 'asc' }] });
    return { object: 'list' as const, data: rows.map(present) };
  }

  /** Adds a phrase Afrippa refuses (everywhere, or in one market). Operations; audited in Afrippa's trail. */
  async add(adminId: string | null, input: { phrase: string; market?: string | null }) {
    const phrase = input.phrase.trim().toLowerCase().replace(/\s+/g, ' ');
    if (phrase.length < 2 || phrase.length > 60) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', 'Use 2 to 60 characters.', 'phrase');
    const market = input.market ? input.market.toUpperCase() : null;
    if (market && !(await this.prisma.country.findUnique({ where: { code: market }, select: { code: true } }))) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', 'Choose a market Afrippa trades in, or none for every market.', 'market');
    }
    try {
      const row = await this.prisma.classifiedProhibitedWord.create({ data: { platform: 'afrippa', phrase, action: 'block', country: market, createdById: adminId } });
      await this.audit.record({ actorId: adminId, action: 'p2p_word.added', targetType: 'refused_word', targetId: row.id, after: present(row), platform: 'afrippa' });
      return present(row);
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'word_exists', 'This word is already on the list.');
      throw error;
    }
  }

  async remove(adminId: string | null, id: string) {
    const row = await this.prisma.classifiedProhibitedWord.findUnique({ where: { id } });
    // Afrippa's admins remove only Afrippa's words.
    if (!row || row.platform !== 'afrippa') throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such word.', 'id');
    await this.prisma.classifiedProhibitedWord.delete({ where: { id } });
    await this.audit.record({ actorId: adminId, action: 'p2p_word.removed', targetType: 'refused_word', targetId: id, before: present(row), platform: 'afrippa' });
    return { ...present(row), removed: true };
  }
}

function present(row: { id: string; phrase: string; country: string | null }) {
  return { object: 'refused_word' as const, id: row.id, phrase: row.phrase, market: row.country };
}
