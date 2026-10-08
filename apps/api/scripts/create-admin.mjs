// Creates an admin account (there is no public admin sign-up) and emails them a one-time link to choose their password.
// Run after `npm run build`, with DATABASE_URL set (in the environment or apps/api/.env, which the npm script reads):
//   npm run admin:create -w @bitocard/api -- --email ops@bitocard.com --name "Ops Lead" --roles super_admin
// The address must be listed in ADMIN_SETUP_EMAILS (environment only), so the link can only go to an expected inbox.
// The link opens the admin app's /set-password page (ADMIN_APP_URL) and works once, for 72 hours. No password is ever
// printed. The admin sets up their authenticator app at first sign-in.
import { parseArgs } from 'node:util';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../dist/app.module.js';
import { AdminAuthService } from '../dist/auth/admin-auth.service.js';

const { values } = parseArgs({ options: { email: { type: 'string' }, name: { type: 'string' }, roles: { type: 'string', default: 'support' } } });
if (!values.email || !values.name) {
  console.error('Usage: --email <address> --name <full name> [--roles super_admin,operations,finance,support]');
  process.exit(2);
}

const context = await NestFactory.createApplicationContext(AppModule.register(), { logger: ['error'] });
try {
  const { admin, sentWith, expiresAt } = await context.get(AdminAuthService).inviteAdmin({ email: values.email, name: values.name, roles: values.roles.split(',') });
  console.log(`Created admin ${admin.email} (${admin.adminRoles.join(', ')}).`);
  if (sentWith === 'outbox') console.log('No email provider is set up (Settings > Integrations > Email), so the link was NOT sent. Set one up, then run admin:reset-password for this address.');
  else console.log(`Emailed them a link to set their password (valid until ${expiresAt.toISOString()}).`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await context.close();
}
