// Resets an admin's password (admins have no "Forgot password"). Run after `npm run build`, with DATABASE_URL set to
// the database to change (production: the Neon address):
//   npm run admin:reset-password -w @bitocard/api -- --email ops@bitocard.com [--reset-authenticator]
// A strong temporary password is printed once. Any lockout is cleared and the admin's sessions are signed out. With
// --reset-authenticator the admin also sets up their authenticator app again at the next sign-in (for a lost phone).
// The reset is written to the audit log. A reseller (SHQ) account with the same email is never changed.
import { parseArgs } from 'node:util';
import { randomBytes } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../dist/app.module.js';
import { AdminAuthService } from '../dist/auth/admin-auth.service.js';
import { AuditService } from '../dist/audit/audit.service.js';

const { values } = parseArgs({ options: { email: { type: 'string' }, 'reset-authenticator': { type: 'boolean', default: false } } });
if (!values.email) {
  console.error('Usage: --email <admin address> [--reset-authenticator]');
  process.exit(2);
}

const context = await NestFactory.createApplicationContext(AppModule.register(), { logger: ['error'] });
try {
  const password = randomBytes(18).toString('base64url');
  const resetAuthenticator = values['reset-authenticator'];
  const admin = await context.get(AdminAuthService).resetPassword(values.email, password, { resetAuthenticator });
  await context.get(AuditService).record({ actorId: null, action: 'admin.password_reset', targetType: 'user', targetId: admin.id, after: { email: admin.email, authenticator_reset: resetAuthenticator, by: 'admin:reset-password script' } });
  console.log(`Reset the password of admin ${admin.email}${resetAuthenticator ? ' and their authenticator (set it up again at sign-in)' : ''}. Their sessions were signed out.`);
  console.log(`Temporary password (shown once): ${password}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await context.close();
}
