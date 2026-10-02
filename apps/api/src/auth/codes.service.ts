import { HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { numericCode, sameDigest, sha256 } from '../common/crypto';
import { ApiError } from '../common/errors/api-error';
import type { CodePurpose } from '../generated/prisma/client';

const lifetimeMs = 30 * 60 * 1000;
const resendAfterMs = 60 * 1000;
export const maxCodeAttempts = 5;

const digest = (userId: string, purpose: CodePurpose, code: string) => sha256(`${purpose}:${userId}:${code}`);

/** Single-use 6-digit codes for email, SMS and password reset. Only a hash is stored; a new code replaces older ones. */
@Injectable()
export class CodesService {
  constructor(private readonly prisma: PrismaService) {}

  async issue(userId: string, purpose: CodePurpose, target: string) {
    const latest = await this.prisma.verificationCode.findFirst({
      where: { userId, purpose, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (latest && Date.now() - latest.createdAt.getTime() < resendAfterMs) {
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'rate_limit_error', 'code_recently_sent', 'A code was just sent. Wait a minute before asking for another.');
    }
    const code = numericCode();
    await this.prisma.$transaction([
      this.prisma.verificationCode.updateMany({ where: { userId, purpose, consumedAt: null }, data: { consumedAt: new Date() } }),
      this.prisma.verificationCode.create({
        data: { userId, purpose, target, codeHash: digest(userId, purpose, code), expiresAt: new Date(Date.now() + lifetimeMs) },
      }),
    ]);
    return code;
  }

  /** Cancels outstanding codes, for example when sending one failed, so a new one can be requested at once. */
  cancel(userId: string, purpose: CodePurpose) {
    return this.prisma.verificationCode.updateMany({ where: { userId, purpose, consumedAt: null }, data: { consumedAt: new Date() } });
  }

  /** Consumes the code if it matches; returns the target it was sent to. */
  async consume(userId: string, purpose: CodePurpose, code: string) {
    const record = await this.prisma.verificationCode.findFirst({
      where: { userId, purpose, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    const invalid = new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'code_invalid', 'That code is not valid. Check it or ask for a new one.', 'code');
    if (!record) throw invalid;
    if (record.expiresAt <= new Date()) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'code_expired', 'That code has expired. Ask for a new one.', 'code');
    }
    if (record.attempts >= maxCodeAttempts) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'code_attempts_exceeded', 'Too many wrong attempts. Ask for a new code.', 'code');
    }
    if (!sameDigest(record.codeHash, digest(userId, purpose, code))) {
      await this.prisma.verificationCode.update({ where: { id: record.id }, data: { attempts: { increment: 1 } } });
      throw invalid;
    }
    const consumed = await this.prisma.verificationCode.updateMany({ where: { id: record.id, consumedAt: null }, data: { consumedAt: new Date() } });
    if (consumed.count === 0) throw invalid;
    return record.target;
  }
}
