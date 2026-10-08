// Emails an admin a one-time link to reset their password (admins have no "Forgot password"). Run after
// `npm run build`, with DATABASE_URL set to the database to change (production: the Neon address), in the environment
// or in apps/api/.env (read by the npm script; a DATABASE_URL already in the environment wins):
//   npm run admin:reset-password -w @bitocard/api -- --email ops@bitocard.com
// The address must be listed in ADMIN_SETUP_EMAILS (environment only), so the link can only go to an expected inbox.
// The link opens the admin app's /set-password page (ADMIN_APP_URL) and works once, for 24 hours; a new link replaces
// the last. Nothing changes until it is used: then the password is set, any lockout cleared and the admin's sessions
// signed out, and a box on the page also resets their authenticator app (for a lost phone). Both steps are audited.
// A reseller (SHQ) account with the same email is never changed.
import { parseArgs } from 'node:util';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../dist/app.module.js';
import { AdminAuthService } from '../dist/auth/admin-auth.service.js';

const { values } = parseArgs({ options: { email: { type: 'string' } } });
if (!values.email) {
  console.error('Usage: --email <admin address>');
  process.exit(2);
}

const context = await NestFactory.createApplicationContext(AppModule.register(), { logger: ['error'] });
try {
  const { admin, sentWith, expiresAt } = await context.get(AdminAuthService).sendPasswordLink(values.email, 'reset');
  if (sentWith === 'outbox') {
    console.error('No email provider is set up (Settings > Integrations > Email), so the link was NOT sent.');
    process.exitCode = 1;
  } else {
    console.log(`Emailed ${admin.email} a link to reset their password (valid until ${expiresAt.toISOString()}).`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await context.close();
}
