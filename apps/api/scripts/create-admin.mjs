// Creates an admin account (there is no public admin sign-up). Run after `npm run build`, with DATABASE_URL set:
//   npm run admin:create -w @bitocard/api -- --email ops@bitocard.com --name "Ops Lead" --roles super_admin
// A strong temporary password is printed once. The admin sets up their authenticator app at first sign-in.
import { parseArgs } from 'node:util';
import { randomBytes } from 'node:crypto';
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
  const password = randomBytes(18).toString('base64url');
  const admin = await context.get(AdminAuthService).createAdmin({ email: values.email, name: values.name, password, roles: values.roles.split(',') });
  console.log(`Created admin ${admin.email} (${admin.adminRoles.join(', ')}).`);
  console.log(`Temporary password (shown once): ${password}`);
} finally {
  await context.close();
}
