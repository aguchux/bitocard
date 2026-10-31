import { defineConfig } from 'prisma/config';

// Load apps/api/.env for local CLI use; on Vercel the environment is already set.
try {
  process.loadEnvFile();
} catch {
  // No .env file: rely on the environment.
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // Optional so `prisma generate` works in builds without a database.
  datasource: { url: process.env.DATABASE_URL ?? '' },
});
